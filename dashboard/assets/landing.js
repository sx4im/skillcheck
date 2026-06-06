// Landing-page module: wires Clerk auth buttons, copy buttons, the footer year,
// and the Framer Motion entrance/scroll animations.
import { bindAuthButtons } from './auth.js';
import { initMotion } from './motion.js';

const year = document.getElementById('year');
if (year) year.textContent = String(new Date().getFullYear());

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
