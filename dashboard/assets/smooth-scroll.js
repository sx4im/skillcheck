// Smooth momentum scrolling (Lenis-style, zero dependencies).
//
// Modern marketing sites ease the wheel instead of jumping the page: each notch
// nudges a *target* scroll position and the page glides toward it, a touch
// slower than the raw wheel delta. This module does exactly that.
//
// It deliberately stays out of the way:
//   - off for prefers-reduced-motion and for touch/coarse pointers (native
//     momentum already feels right on phones — we never hijack touch),
//   - never swallows pinch-zoom (ctrl+wheel) or wheels that land inside a
//     scrollable element (e.g. the Clerk sign-in modal),
//   - resyncs whenever the keyboard, scrollbar, or a layout change moves the
//     page by other means, so the next wheel never jumps from a stale target.
// The real window scroll position still updates every frame, so the parallax
// background, the nav shadow, and scroll-reveal all keep working unchanged.

const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

if (!reduce && !coarse) {
  const EASE = 0.085; // per-frame approach to target; lower = smoother + slower settle
  const SPEED = 0.8; // wheel distance multiplier; < 1 makes the page travel slower

  // CSS smooth anchor scrolling would fight the per-frame scrollTo below, so we
  // take auto here and animate anchor jumps ourselves through the same lerp.
  const root = document.documentElement;
  root.style.scrollBehavior = 'auto';

  let target = window.scrollY;
  let current = window.scrollY;
  let raf = null;
  let animating = false;

  const maxScroll = () => root.scrollHeight - window.innerHeight;
  const clamp = (v) => Math.max(0, Math.min(v, maxScroll()));

  function loop() {
    const diff = target - current;
    if (Math.abs(diff) < 0.4) {
      current = target;
      window.scrollTo(0, Math.round(current));
      raf = null;
      animating = false;
      return;
    }
    current += diff * EASE;
    window.scrollTo(0, current);
    raf = requestAnimationFrame(loop);
  }

  function start() {
    animating = true;
    if (raf == null) raf = requestAnimationFrame(loop);
  }

  // True when the wheel is over something that can scroll on its own — let the
  // browser handle those so modals and inner panes still work.
  function insideScrollable(node) {
    let depth = 0;
    while (node && node.nodeType === 1 && node !== document.body && node !== root && depth < 12) {
      const oy = getComputedStyle(node).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight + 1) return true;
      node = node.parentNode;
      depth += 1;
    }
    return false;
  }

  window.addEventListener('wheel', function (event) {
    if (event.ctrlKey || event.defaultPrevented) return; // zoom / already-handled
    if (insideScrollable(event.target)) return; // inner scroller (e.g. Clerk modal)
    event.preventDefault();
    target = clamp(target + event.deltaY * SPEED);
    start();
  }, { passive: false });

  // Smooth in-page anchor links through the same lerp (accounting for the
  // sticky nav). Links still work normally when this module is disabled.
  document.addEventListener('click', function (event) {
    const link = event.target.closest && event.target.closest('a[href^="#"]');
    if (!link) return;
    const id = link.getAttribute('href').slice(1);
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    event.preventDefault();
    const top = el.getBoundingClientRect().top + window.scrollY - 72;
    target = clamp(top);
    start();
    history.pushState(null, '', '#' + id);
  });

  // Keyboard, scrollbar drag, or layout shifts move the page outside the lerp:
  // when we're idle, adopt the real position so the next wheel starts fresh.
  window.addEventListener('scroll', function () {
    if (!animating) { current = target = window.scrollY; }
  }, { passive: true });
  window.addEventListener('resize', function () {
    current = target = clamp(window.scrollY);
  }, { passive: true });
}
