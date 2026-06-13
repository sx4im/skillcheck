// Ambient background art for the sections below the hero: a slow drift of
// floating SkillCheck doodles, like marks sketched onto an engineering
// canvas. Verdicts, checks, file names and small geometric glyphs rise and
// sway with brand-tinted color and a gentle twinkle, parallaxing against
// scroll and pointer. The hero has its own image background (assets/bg.jpg)
// that covers this layer; the doodles are visible everywhere below it.
//
// Self initializing: creates a fixed full-screen <canvas> (#bg). Honors
// prefers-reduced-motion (one static frame, no drift), pauses while the tab
// is hidden, and thins itself out on small screens. Zero dependencies.

const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// A mix of CLI tokens and small art glyphs.
const GLYPHS = [
  '✓', '✓', '✓', '✗', '◆', '◇', '✦', '▰▰▱', '░', '⟨ ⟩', '{ }', '[ ]',
  '</>', '→', '·', '%', '$', '#', '+', '≈', '∆', '|',
  'HELPS', 'PLACEBO', 'A/B', '95%', '+25.0 pp', 'SKILL.md', 'AGENTS.md',
  'CLAUDE.md', 'chk_live_', 'skillcheck', '0.5.x', '· · ·'
];

// Mostly faint white; a minority carry the SkillCheck tricolor.
const TINTS = [
  { rgb: '230, 237, 247', weight: 8 },
  { rgb: '34, 211, 238', weight: 2 },
  { rgb: '28, 105, 212', weight: 2 },
  { rgb: '99, 102, 241', weight: 2 }
];

function pickTint() {
  const total = TINTS.reduce(function (sum, t) { return sum + t.weight; }, 0);
  let roll = Math.random() * total;
  for (const t of TINTS) {
    roll -= t.weight;
    if (roll <= 0) return t.rgb;
  }
  return TINTS[0].rgb;
}

export function initBackground() {
  const canvas = document.createElement('canvas');
  canvas.id = 'bg';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let width = 0;
  let height = 0;
  let doodles = [];

  function seed() {
    // Density scales with viewport; lighter on phones.
    const base = window.innerWidth < 760 ? 34000 : 22000;
    const count = Math.max(20, Math.min(96, Math.round((width * height) / base)));
    doodles = [];
    for (let i = 0; i < count; i += 1) {
      doodles.push(makeDoodle(Math.random() * height));
    }
  }

  function makeDoodle(y) {
    const depth = 0.3 + Math.random() * 0.7; // far -> near
    return {
      text: GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
      x: Math.random() * width,
      y,
      depth,
      size: 11 + depth * 16,
      baseAlpha: 0.06 + depth * 0.16,
      rgb: pickTint(),
      vy: (0.05 + Math.random() * 0.12) * depth,
      sway: Math.random() * Math.PI * 2,
      swaySpeed: 0.0015 + Math.random() * 0.0035,
      swayAmp: 6 + Math.random() * 16,
      rot: (Math.random() - 0.5) * 0.5,
      twinkle: Math.random() * Math.PI * 2,
      twinkleSpeed: 0.001 + Math.random() * 0.0025
    };
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  let mouseX = 0;
  let mouseY = 0;
  window.addEventListener('mousemove', function (event) {
    mouseX = (event.clientX / window.innerWidth - 0.5) * 2;
    mouseY = (event.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });

  function drawFrame(time) {
    ctx.clearRect(0, 0, width, height);
    const scroll = window.scrollY || 0;
    for (const d of doodles) {
      const sway = Math.sin(d.sway + time * d.swaySpeed) * d.swayAmp;
      const px = d.x + sway + mouseX * 20 * d.depth;
      // Deeper doodles trail the scroll slightly for parallax depth.
      let py = d.y - scroll * 0.05 * d.depth + mouseY * 12 * d.depth;
      py = ((py % height) + height) % height;
      const twinkle = 0.7 + 0.3 * Math.sin(d.twinkle + time * d.twinkleSpeed);

      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(d.rot * 0.06);
      ctx.font = `${d.size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      ctx.fillStyle = `rgba(${d.rgb}, ${(d.baseAlpha * twinkle).toFixed(3)})`;
      ctx.fillText(d.text, 0, 0);
      ctx.restore();
    }
  }

  resize();
  window.addEventListener('resize', function () { resize(); drawFrame(0); }, { passive: true });

  if (reduceMotion) {
    drawFrame(0);
    return;
  }

  let running = true;
  document.addEventListener('visibilitychange', function () {
    running = !document.hidden;
    if (running) requestAnimationFrame(tick);
  });

  function tick(time) {
    if (!running) return;
    for (const d of doodles) {
      d.y -= d.vy;
      if (d.y < -40) {
        Object.assign(d, makeDoodle(height + 30));
      }
    }
    drawFrame(time);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

initBackground();
