// Landing page module: Clerk auth buttons, copy buttons, footer year, nav
// scroll shadow, signed-in state, scroll reveals, the animated terminal demo,
// and stat count-ups. Zero runtime dependencies; Clerk loads lazily on click.
import { bindAuthButtons, currentUser } from './auth.js';

const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const year = document.getElementById('year');
if (year) year.textContent = String(new Date().getFullYear());

// --- Nav shadow on scroll ---
const nav = document.querySelector('.nav');
if (nav) {
  window.addEventListener('scroll', function () {
    nav.classList.toggle('scrolled', window.scrollY > 4);
  }, { passive: true });
}

// --- Scroll reveal: .reveal elements fade and rise once when they enter view.
// CSS only hides them under html.js, so the page is fully readable without JS.
(function initReveal() {
  const targets = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window) || reduceMotion) {
    targets.forEach(function (el) { el.classList.add('in'); });
    return;
  }
  const io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
  targets.forEach(function (el) { io.observe(el); });
})();

// --- Stat count-up on first view ---
(function initCounters() {
  const nums = document.querySelectorAll('[data-count]');
  if (!nums.length) return;
  const fmt = function (n) { return n.toLocaleString('en-US'); };
  if (!('IntersectionObserver' in window) || reduceMotion) return; // final values are already in the HTML
  const io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      io.unobserve(entry.target);
      const el = entry.target;
      const target = Number(el.getAttribute('data-count')) || 0;
      const start = performance.now();
      const dur = 900;
      (function tick(now) {
        const t = Math.max(0, Math.min(1, (now - start) / dur));
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = fmt(Math.round(target * eased));
        if (t < 1) requestAnimationFrame(tick);
      })(start);
    });
  }, { threshold: 0.6 });
  nums.forEach(function (el) { io.observe(el); });
})();

// --- Copy buttons ---
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

// --- Terminal demo: types the command, then replays the real CLI experience
// (receipt lines, then the result card with an animating satisfaction bar).
(function initTerminal() {
  const body = document.getElementById('terminalBody');
  if (!body) return;

  const CMD = 'skillcheck check ./SKILL.md';
  const RECEIPTS = [
    '✓ Evaluation tasks ready · 12s',
    '✓ Trials complete (30/30) · 1m 38s',
    '✓ Grading complete (30/30) · 41s',
    '✓ Analysis complete · 2m 33s'
  ];

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const promptLine = el('div', 't-line');
  const promptSign = el('span', 't-prompt', '$ ');
  const cmdSpan = el('span', 't-cmd', '');
  const caret = el('span', 't-caret');
  promptLine.appendChild(promptSign);
  promptLine.appendChild(cmdSpan);
  promptLine.appendChild(caret);
  body.appendChild(promptLine);

  function addReceipt(text) {
    const line = el('div', 't-line');
    line.appendChild(el('span', 't-ok', '✓ '));
    line.appendChild(el('span', 't-dim', text.slice(2)));
    body.appendChild(line);
  }

  function addCard() {
    const card = el('div', 't-card');
    const verdictRow = el('div', 'row');
    verdictRow.appendChild(el('span', 'label', 'Verdict'));
    verdictRow.appendChild(el('span', 't-verdict', 'HELPS'));
    card.appendChild(verdictRow);

    const effectRow = el('div', 'row');
    effectRow.appendChild(el('span', 'label', 'Skill effect'));
    effectRow.appendChild(el('span', 't-ok', '+25.0 pp'));
    card.appendChild(effectRow);

    const ciRow = el('div', 'row');
    ciRow.appendChild(el('span', 'label', 'Confidence'));
    ciRow.appendChild(el('span', 't-dim', '+8.0 pp to +42.0 pp (95%)'));
    card.appendChild(ciRow);

    const bar = el('div', 't-bar');
    const track = el('div', 'track');
    const fill = el('div', 'fill');
    track.appendChild(fill);
    bar.appendChild(track);
    const val = el('span', 'val', '0.0/100');
    bar.appendChild(val);
    card.appendChild(bar);
    body.appendChild(card);

    // Sweep the satisfaction bar to 75.
    requestAnimationFrame(function () {
      fill.style.width = '75%';
    });
    const start = performance.now();
    (function tick(now) {
      const t = Math.max(0, Math.min(1, (now - start) / 1400));
      const eased = 1 - Math.pow(1 - t, 3);
      val.textContent = (75 * eased).toFixed(1) + '/100';
      if (t < 1) requestAnimationFrame(tick);
      else val.textContent = '75.0/100 GOOD';
    })(start);
  }

  function playReceipts() {
    let i = 0;
    (function next() {
      if (i < RECEIPTS.length) {
        addReceipt(RECEIPTS[i]);
        i += 1;
        setTimeout(next, 460);
      } else {
        setTimeout(addCard, 320);
      }
    })();
  }

  if (reduceMotion) {
    cmdSpan.textContent = CMD;
    caret.remove();
    RECEIPTS.forEach(addReceipt);
    addCard();
    return;
  }

  // Start typing when the terminal first becomes visible.
  let started = false;
  function start() {
    if (started) return;
    started = true;
    let i = 0;
    (function type() {
      if (i <= CMD.length) {
        cmdSpan.textContent = CMD.slice(0, i);
        i += 1;
        setTimeout(type, 34 + Math.random() * 40);
      } else {
        setTimeout(function () {
          caret.remove();
          playReceipts();
        }, 350);
      }
    })();
  }
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting; })) {
        io.disconnect();
        setTimeout(start, 420);
      }
    }, { threshold: 0.3 });
    io.observe(body);
  } else {
    setTimeout(start, 600);
  }
})();

// --- FAQ Accordion: Single open item at a time (keeps section height stable) ---
(function initFaqAccordion() {
  const faqContainer = document.querySelector('.faq');
  if (!faqContainer) return;
  const detailsList = faqContainer.querySelectorAll('details');
  if (!detailsList.length) return;

  detailsList[0].setAttribute('open', '');

  detailsList.forEach(function (targetDetail) {
    const summary = targetDetail.querySelector('summary');
    if (!summary) return;

    summary.addEventListener('click', function (e) {
      e.preventDefault();
      detailsList.forEach(function (detail) {
        detail.removeAttribute('open');
      });
      targetDetail.setAttribute('open', '');
    });
  });
})();

// --- Auth ---
bindAuthButtons();

// Signed-in state: swap navbar and set avatar.
(async function checkSession() {
  try {
    const user = await currentUser();
    const signedOut = document.getElementById('navSignedOut');
    const signedIn = document.getElementById('navSignedIn');
    const avatar = document.getElementById('userAvatar');
    if (user && signedOut && signedIn) {
      signedOut.style.display = 'none';
      signedIn.style.display = 'flex';
      // Signed-in visitors: the primary CTAs lead to the dashboard, so label
      // them honestly instead of "get your key".
      document.querySelectorAll('.hero [data-action="signup"], .cta-band [data-action="signup"]').forEach(function (btn) {
        btn.textContent = 'Open your dashboard';
      });
      if (avatar) {
        const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || 'U';
        avatar.textContent = name.slice(0, 2).toUpperCase();
        avatar.title = name;
      }
    }
  } catch {
    // Not signed in. Keep the default state.
  }
})();
