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
    const ease = [0.16, 1, 0.3, 1];

    // Hero: staggered fade + rise on load.
    const hero = document.querySelector('[data-motion="hero"]');
    if (hero) {
      animate(hero.children, { opacity: [0, 1], y: [18, 0] }, { delay: stagger(0.08), duration: 0.6, ease });
    }

    // Single elements that reveal on scroll.
    document.querySelectorAll('[data-reveal]').forEach((el) => {
      inView(
        el,
        () => {
          animate(el, { opacity: [0, 1], y: [20, 0] }, { duration: 0.6, ease });
        },
        { amount: 0.2 }
      );
    });

    // Grids whose children reveal in a stagger on scroll.
    document.querySelectorAll('[data-reveal-children]').forEach((grid) => {
      inView(
        grid,
        () => {
          animate(grid.children, { opacity: [0, 1], y: [20, 0] }, { delay: stagger(0.1), duration: 0.6, ease });
        },
        { amount: 0.15 }
      );
    });
  } catch {
    // CDN unavailable — show everything rather than leaving it hidden.
    root.classList.remove('anim');
  }
}
