// Framer Motion (the `motion` library) entrance + scroll-reveal animations for
// the landing page. Loaded lazily; if the CDN fails or reduced motion is
// requested, everything is revealed immediately (no hidden content).

export async function initMotion() {
  const root = document.documentElement;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {
    root.classList.remove('anim');
    return;
  }

  try {
    const { animate, inView, stagger } = await import('https://cdn.jsdelivr.net/npm/motion@11.18.0/+esm');
    const ease = [0.16, 1, 0.3, 1]; // smooth spring-like ease
    // Cancel the HTML fallback timeout — motion loaded successfully.
    if (window.__motionRevealTimeout) {
      clearTimeout(window.__motionRevealTimeout);
      delete window.__motionRevealTimeout;
    }

    // Hero: staggered fade + rise + slight scale on load.
    const hero = document.querySelector('[data-motion="hero"]');
    if (hero) {
      animate(hero.children, {
        opacity: [0, 1],
        y: [24, 0],
        scale: [0.98, 1]
      }, { delay: stagger(0.1), duration: 0.7, ease });
    }

    // Single elements that reveal on scroll.
    document.querySelectorAll('[data-reveal]').forEach((el) => {
      inView(
        el,
        () => {
          animate(el, {
            opacity: [0, 1],
            y: [28, 0],
            scale: [0.98, 1]
          }, { duration: 0.7, ease });
        },
        { amount: 0.2 }
      );
    });

    // Grids whose children reveal in a stagger on scroll.
    document.querySelectorAll('[data-reveal-children]').forEach((grid) => {
      inView(
        grid,
        () => {
          animate(grid.children, {
            opacity: [0, 1],
            y: [28, 0],
            scale: [0.98, 1]
          }, { delay: stagger(0.12), duration: 0.7, ease });
        },
        { amount: 0.15 }
      );
    });
  } catch {
    // CDN unavailable — show everything rather than leaving it hidden.
    root.classList.remove('anim');
  }
}
