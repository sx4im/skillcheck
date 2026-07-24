// Shared clipboard and string formatting utilities for dashboard frontend assets.

export function copyText(text, done) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => fallback(text, done));
  } else {
    fallback(text, done);
  }
}

function fallback(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } catch {
    // Browser environment fallback for clipboard copy
  }
  document.body.removeChild(ta);
  if (done) done();
}

export function flash(btn, label = 'Copied') {
  const prev = btn.textContent;
  btn.textContent = label;
  setTimeout(() => {
    btn.textContent = prev;
  }, 1200);
}

export function maskApiKey(key) {
  return key && key.length > 15 ? `${key.slice(0, 11)}…${key.slice(-4)}` : key;
}
