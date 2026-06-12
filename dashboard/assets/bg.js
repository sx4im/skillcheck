// Ambient interactive background: a field of dots that bulge away from the
// cursor, with a soft brand glow that follows the pointer. Ported from the
// React Bits "DotField" component to dependency-free vanilla JS and rebranded
// to the SkillCheck tricolor (cyan, blue, indigo). The scroll-driven 3D
// verdict check (assets/hero3d.js) layers on top of this floor.
//
// Self initializing: creates its own fixed full-screen <canvas> (#bg). Honors
// prefers-reduced-motion (static dot grid, no interaction), pauses while the
// tab is hidden, and stops redrawing once the field settles so an idle page
// costs nothing.

const TWO_PI = Math.PI * 2;
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Tuned for the dark motorsport surface: small, low-alpha dots so body text
// stays readable, a generous cursor radius for a soft bulge, and a faint
// brand-blue bloom around the pointer.
const DOT_RADIUS = 1.6;
const DOT_SPACING = 16;
const STEP = DOT_RADIUS + DOT_SPACING;
const CURSOR_RADIUS = 460;
const BULGE_STRENGTH = 60;
const GRADIENT_FROM = 'rgba(34, 211, 238, 0.28)'; // cyan, top-left
const GRADIENT_TO = 'rgba(99, 102, 241, 0.14)'; // indigo, bottom-right
const GLOW_RGB = '60, 130, 246'; // brand blue
const GLOW_RADIUS = 200;

export function initBackground() {
  const canvas = document.createElement('canvas');
  canvas.id = 'bg';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rad = DOT_RADIUS / 2;
  const crSq = CURSOR_RADIUS * CURSOR_RADIUS;
  let width = 0;
  let height = 0;
  let dots = [];

  // Each dot remembers its anchor (ax, ay) and eased screen position (sx, sy).
  function buildDots() {
    const cols = Math.floor(width / STEP);
    const rows = Math.floor(height / STEP);
    const padX = (width % STEP) / 2;
    const padY = (height % STEP) / 2;
    dots = new Array(rows * cols);
    let idx = 0;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const ax = padX + col * STEP + STEP / 2;
        const ay = padY + row * STEP + STEP / 2;
        dots[idx] = { ax, ay, sx: ax, sy: ay };
        idx += 1;
      }
    }
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildDots();
    idleFrames = 0; // force a repaint at the new size
  }

  const mouse = { x: -9999, y: -9999, prevX: -9999, prevY: -9999, speed: 0 };
  window.addEventListener('mousemove', function (event) {
    mouse.x = event.clientX;
    mouse.y = event.clientY;
  }, { passive: true });

  // Sample pointer speed on an interval and smooth it; the bulge "engages"
  // with speed so the field reacts to movement, not a resting cursor.
  setInterval(function () {
    const dx = mouse.prevX - mouse.x;
    const dy = mouse.prevY - mouse.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    mouse.speed += (dist - mouse.speed) * 0.5;
    if (mouse.speed < 0.001) mouse.speed = 0;
    mouse.prevX = mouse.x;
    mouse.prevY = mouse.y;
  }, 20);

  let engagement = 0;
  let glowOpacity = 0;
  let idleFrames = 0;

  function draw() {
    const targetEngagement = Math.min(mouse.speed / 5, 1);
    engagement += (targetEngagement - engagement) * 0.06;
    if (engagement < 0.001) engagement = 0;
    const eng = engagement;
    glowOpacity += (eng - glowOpacity) * 0.08;

    ctx.clearRect(0, 0, width, height);

    // Soft brand bloom around the pointer, fading in with engagement.
    if (glowOpacity > 0.01 && mouse.x > -9000) {
      const bloom = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, GLOW_RADIUS);
      bloom.addColorStop(0, `rgba(${GLOW_RGB}, ${(0.1 * glowOpacity).toFixed(3)})`);
      bloom.addColorStop(1, `rgba(${GLOW_RGB}, 0)`);
      ctx.fillStyle = bloom;
      ctx.fillRect(0, 0, width, height);
    }

    // All dots share one diagonal gradient and one batched path fill.
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, GRADIENT_FROM);
    grad.addColorStop(1, GRADIENT_TO);
    ctx.fillStyle = grad;
    ctx.beginPath();

    for (let i = 0; i < dots.length; i += 1) {
      const d = dots[i];
      const dx = mouse.x - d.ax;
      const dy = mouse.y - d.ay;
      const distSq = dx * dx + dy * dy;
      if (distSq < crSq && eng > 0.01) {
        const dist = Math.sqrt(distSq) || 1;
        const falloff = 1 - dist / CURSOR_RADIUS;
        const push = falloff * falloff * BULGE_STRENGTH * eng;
        const inv = 1 / dist;
        // Ease toward a point shoved directly away from the cursor.
        d.sx += (d.ax - dx * inv * push - d.sx) * 0.15;
        d.sy += (d.ay - dy * inv * push - d.sy) * 0.15;
      } else {
        // Relax back to the anchor.
        d.sx += (d.ax - d.sx) * 0.1;
        d.sy += (d.ay - d.sy) * 0.1;
      }
      ctx.moveTo(d.sx + rad, d.sy);
      ctx.arc(d.sx, d.sy, rad, 0, TWO_PI);
    }
    ctx.fill();
  }

  resize();
  window.addEventListener('resize', resize, { passive: true });

  if (reduceMotion) {
    draw();
    window.addEventListener('resize', draw, { passive: true });
    return;
  }

  let running = true;
  document.addEventListener('visibilitychange', function () {
    running = !document.hidden;
    if (running) requestAnimationFrame(tick);
  });

  // Keep the rAF alive to catch the next pointer move, but skip the expensive
  // redraw once the field has settled (a short tail past the last motion).
  function tick() {
    if (!running) return;
    const active = mouse.speed > 0.01 || engagement > 0.001 || glowOpacity > 0.001;
    idleFrames = active ? 0 : idleFrames + 1;
    if (idleFrames < 45) {
      draw();
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

initBackground();
