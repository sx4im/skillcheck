// Landing-page module: wires Clerk auth buttons, copy buttons, the footer year,
// the Framer Motion entrance/scroll animations, nav scroll shadow, and signed-in state.
import { bindAuthButtons, currentUser } from './auth.js';
import { initMotion } from './motion.js';

const year = document.getElementById('year');
if (year) year.textContent = String(new Date().getFullYear());

// Nav shadow on scroll
const nav = document.querySelector('.nav');
if (nav) {
  window.addEventListener('scroll', function () {
    nav.classList.toggle('scrolled', window.scrollY > 4);
  }, { passive: true });
}

function copyText(text, done) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, function () { fallback(text, done); });
  } else {
    fallback(text, done);
  }
}
function fallback(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  document.body.removeChild(ta); if (done) done();
}

document.querySelectorAll('.copy').forEach(function (btn) {
  btn.addEventListener('click', function () {
    const host = document.getElementById(btn.getAttribute('data-copy'));
    if (!host) return;
    const text = host.childNodes[0] ? host.childNodes[0].textContent : host.textContent;
    copyText(text.trim(), function () {
      const prev = btn.textContent; btn.textContent = 'Copied';
      setTimeout(function () { btn.textContent = prev; }, 1200);
    });
  });
});

bindAuthButtons();
initMotion();

// Signed-in state: swap navbar and set avatar
(async function checkSession() {
  try {
    const user = await currentUser();
    const signedOut = document.getElementById('navSignedOut');
    const signedIn = document.getElementById('navSignedIn');
    const avatar = document.getElementById('userAvatar');
    if (user && signedOut && signedIn) {
      signedOut.style.display = 'none';
      signedIn.style.display = 'flex';
      if (avatar) {
        const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || 'U';
        avatar.textContent = name.slice(0, 2).toUpperCase();
        avatar.title = name;
      }
    }
  } catch {
    // Not signed in — keep default state
  }
})();
