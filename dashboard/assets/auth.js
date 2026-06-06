// Clerk integration for the static dashboard.
//
// Clerk is loaded lazily from the CDN on first use (inside getClerk), so a CDN
// hiccup never breaks the rest of the page's module graph. The landing page does
// NOT load Clerk on visit — only when the user clicks a sign-in / get-key button.

let clerkPromise = null;

export async function getClerk() {
  if (clerkPromise) return clerkPromise;
  clerkPromise = (async () => {
    const config = await (await fetch('/api/config')).json();
    if (!config.clerkPublishableKey) {
      throw new Error('Sign-in is not configured yet. Set CLERK_PUBLISHABLE_KEY on the server.');
    }
    const { Clerk } = await import('https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/+esm');
    const clerk = new Clerk(config.clerkPublishableKey);
    await clerk.load();
    return clerk;
  })();
  return clerkPromise;
}

const appUrl = () => `${location.origin}/app.html`;

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
    clerk.redirectToSignIn({ signInForceRedirectUrl: appUrl(), signUpForceRedirectUrl: appUrl() });
  } catch (error) {
    reportError(error);
  }
}

export async function openSignUp() {
  try {
    const clerk = await getClerk();
    clerk.redirectToSignUp({ signInForceRedirectUrl: appUrl(), signUpForceRedirectUrl: appUrl() });
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
