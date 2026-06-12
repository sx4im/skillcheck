// Clerk integration for the static dashboard.
//
// Clerk is loaded lazily from the CDN on first use (inside getClerk), so a CDN
// hiccup never breaks the rest of the page's module graph. The landing page does
// NOT load Clerk on visit — only when the user clicks a sign-in / get-key button.

let clerkPromise = null;

// Derive the Clerk Frontend API host from the publishable key. The key is
// `pk_(test|live)_<base64url("<host>$")>`, so decoding the middle segment yields
// e.g. "verified-lioness-0.clerk.accounts.dev". That lets us load ClerkJS from
// Clerk's own CDN — the same origin the browser already uses for sign-in.
function frontendApiFromKey(publishableKey) {
  const encoded = String(publishableKey || '').replace(/^pk_(test|live)_/, '').replace(/-/g, '+').replace(/_/g, '/');
  let decoded = '';
  try { decoded = atob(encoded); } catch (e) { decoded = ''; }
  return decoded.replace(/\$+$/, '');
}

// Load ClerkJS from Clerk's official hosted bundle (clerk.browser.js) instead of
// a third-party ESM CDN. The jsdelivr "+esm" build of clerk-js is a ~3 MB
// on-the-fly transform that intermittently takes 6–15s+ or hangs the import
// entirely — which froze the whole dashboard on "Loading…" and left sign-out
// unwired. Clerk's own CDN is fast (~0.2s) and same-origin with the FAPI.
function loadClerkFromCdn(publishableKey) {
  return new Promise((resolve, reject) => {
    if (window.Clerk) return resolve(window.Clerk);
    const host = frontendApiFromKey(publishableKey);
    if (!host) return reject(new Error('Could not determine the Clerk frontend API from the publishable key.'));
    const script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.setAttribute('data-clerk-loader', '1');
    script.setAttribute('data-clerk-publishable-key', publishableKey);
    script.src = `https://${host}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`;
    script.addEventListener('load', () => {
      let clerk = window.Clerk;
      if (!clerk) return reject(new Error('Clerk loaded but window.Clerk is unavailable.'));
      // Depending on the bundle, window.Clerk is either the constructor or a
      // ready instance (when data-clerk-publishable-key is present).
      if (typeof clerk === 'function') {
        try { clerk = new clerk(publishableKey); window.Clerk = clerk; } catch (e) { return reject(e); }
      }
      resolve(clerk);
    });
    script.addEventListener('error', () => reject(new Error('Failed to load the Clerk script from its CDN.')));
    document.head.appendChild(script);
  });
}

export async function getClerk() {
  if (clerkPromise) return clerkPromise;
  clerkPromise = (async () => {
    const config = await (await fetch('/api/config')).json();
    if (!config.clerkPublishableKey) {
      throw new Error('Sign-in is not configured yet. Set CLERK_PUBLISHABLE_KEY on the server.');
    }
    const clerk = await loadClerkFromCdn(config.clerkPublishableKey);
    await clerk.load({ appearance: CLERK_APPEARANCE });
    return clerk;
  })();
  // Reset on failure so a later call (e.g. after a refresh) can retry cleanly.
  clerkPromise.catch(() => { clerkPromise = null; });
  return clerkPromise;
}

const appUrl = () => `${location.origin}/app.html`;

// Clerk UI styled to the SkillCheck system: dark surfaces, zero border
// radius, Inter. Applied to clerk.load() and to every opened component so
// no Clerk surface ships with rounded consumer-tech corners.
const CLERK_APPEARANCE = {
  variables: {
    colorPrimary: '#1c69d4',
    colorBackground: '#1a1a1a',
    colorText: '#ffffff',
    colorTextSecondary: '#bbbbbb',
    colorInputBackground: '#0d0d0d',
    colorInputText: '#ffffff',
    colorDanger: '#e22718',
    borderRadius: '0px',
    fontFamily: "'Inter', -apple-system, sans-serif"
  }
};

function reportError(error) {
  const message = error && error.message ? error.message : 'Sign-in failed. Please try again.';
  const banner = document.getElementById('authError');
  if (banner) {
    banner.textContent = message;
    banner.style.display = 'block';
  } else {
    alert(message);
  }
}

// Open Clerk's hosted sign-in / sign-up (shows every provider enabled in Clerk:
// Google, GitHub, email, …). Only called on an explicit button click.
export async function openSignIn() {
  try {
    const clerk = await getClerk();
    if (typeof clerk.openSignIn === 'function') {
      // In-page modal keeps users on skillcheck.page and inherits our theme.
      clerk.openSignIn({ appearance: CLERK_APPEARANCE, forceRedirectUrl: appUrl(), signUpForceRedirectUrl: appUrl() });
    } else {
      clerk.redirectToSignIn({ signInForceRedirectUrl: appUrl(), signUpForceRedirectUrl: appUrl() });
    }
  } catch (error) {
    reportError(error);
  }
}

export async function openSignUp() {
  try {
    const clerk = await getClerk();
    if (typeof clerk.openSignUp === 'function') {
      clerk.openSignUp({ appearance: CLERK_APPEARANCE, forceRedirectUrl: appUrl(), signInForceRedirectUrl: appUrl() });
    } else {
      clerk.redirectToSignUp({ signInForceRedirectUrl: appUrl(), signUpForceRedirectUrl: appUrl() });
    }
  } catch (error) {
    reportError(error);
  }
}

// Start a specific provider directly (strategy: 'oauth_google' | 'oauth_github').
// Falls back to the hosted page if that provider isn't enabled in Clerk.
export async function signInWith(strategy) {
  try {
    const clerk = await getClerk();
    await clerk.client.signIn.authenticateWithRedirect({
      strategy,
      redirectUrl: `${location.origin}/sso-callback.html`,
      redirectUrlComplete: appUrl()
    });
  } catch (error) {
    try {
      const clerk = await getClerk();
      clerk.redirectToSignIn({ signInForceRedirectUrl: appUrl() });
    } catch (inner) {
      reportError(inner);
    }
  }
}

export async function getToken() {
  const clerk = await getClerk();
  return clerk.session ? clerk.session.getToken() : null;
}

export async function currentUser() {
  const clerk = await getClerk();
  return clerk.user || null;
}

export async function signOut() {
  try {
    const clerk = await getClerk();
    await clerk.signOut({ redirectUrl: `${location.origin}/` });
  } catch {
    location.href = '/';
  }
}

// Wire any element with data-action="signin|signup|signout" or data-provider="…".
export function bindAuthButtons() {
  document.querySelectorAll('[data-action]').forEach((el) => {
    el.addEventListener('click', (event) => {
      const action = el.getAttribute('data-action');
      if (action === 'provider') return; // handled below
      event.preventDefault();
      if (action === 'signin') openSignIn();
      else if (action === 'signup') openSignUp();
      else if (action === 'signout') signOut();
    });
  });
  document.querySelectorAll('[data-provider]').forEach((el) => {
    el.addEventListener('click', (event) => {
      event.preventDefault();
      signInWith(el.getAttribute('data-provider'));
    });
  });
}
