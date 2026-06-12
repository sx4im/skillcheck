// Ambient background: a field of floating CLI doodles (glyphs, file names,
// verdicts) drifting on a fixed canvas behind the page, with depth-based
// scroll/mouse parallax and an occasional tricolor speed streak. Self
// initializing: creates its own <canvas>, so pages opt in with one script
// tag. Honors prefers-reduced-motion (renders a single static frame) and
// pauses while the tab is hidden. Zero dependencies.

const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const GLYPHS = [
  '✓', '✓', '✓', '✗', '█', '▰▰▱', '░░', '⠋', '⠹', '⠼',
  '$', '%', '{ }', '</>', '[ ]', '→', '+25.0 pp', '95%', 'A/B',
  'SKILL.md', 'AGENTS.md', 'CLAUDE.md', 'chk_live_', 'HELPS', 'PLACEBO',
  'skillcheck', '0.5.2', '· · ·', '#', '|', '——', '≠', '∆'
];

// Mostly faint white; a minority carry the tricolor at low alpha.
const TINTS = [
  { color: '255, 255, 255', weight: 7 },
  { color: '34, 211, 238', weight: 1 },
  { color: '28, 105, 212', weight: 1 },
  { color: '99, 102, 241', weight: 1 }
];

function pickTint() {
  const total = TINTS.reduce(function (sum, t) { return sum + t.weight; }, 0);
  let roll = Math.random() * total;
  for (const t of TINTS) {
    roll -= t.weight;
    if (roll <= 0) return t.color;
  }
  return TINTS[0].color;
}

export function initBackground() {
  const canvas = document.createElement('canvas');
  canvas.id = 'bg';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let width = 0;
  let height = 0;

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', function () { resize(); seed(); drawFrame(0); }, { passive: true });

  // --- doodle particles ---
  let doodles = [];
  function seed() {
    // Density scales with viewport area; "crowded but readable".
    const count = Math.max(34, Math.min(120, Math.round((width * height) / 17000)));
    doodles = [];
    for (let i = 0; i < count; i += 1) {
      const depth = 0.25 + Math.random() * 0.75; // far → near
      doodles.push({
        text: GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
        x: Math.random() * width,
        y: Math.random() * height,
        depth,
        size: 10 + depth * 17,
        alpha: 0.07 + depth * 0.16,
        tint: pickTint(),
        vy: (0.06 + Math.random() * 0.12) * depth, // slow float upward
        sway: Math.random() * Math.PI * 2,
        swaySpeed: 0.002 + Math.random() * 0.004,
        swayAmp: 6 + Math.random() * 14,
        rot: (Math.random() - 0.5) * 0.5
      });
    }
  }
  seed();

  // --- tricolor speed streaks ---
  const STREAK_COLORS = ['34, 211, 238', '28, 105, 212', '99, 102, 241'];
  let streaks = [];
  let nextStreakAt = 1200;
  function spawnStreak(now) {
    streaks.push({
      y: height * (0.1 + Math.random() * 0.8),
      x: -240,
      speed: 9 + Math.random() * 7,
      len: 160 + Math.random() * 220,
      color: STREAK_COLORS[Math.floor(Math.random() * STREAK_COLORS.length)],
      alpha: 0.22 + Math.random() * 0.18
    });
    nextStreakAt = now + 2200 + Math.random() * 3200;
  }

  // --- parallax inputs ---
  let mouseX = 0;
  let mouseY = 0;
  window.addEventListener('mousemove', function (event) {
    mouseX = (event.clientX / width - 0.5) * 2;
    mouseY = (event.clientY / height - 0.5) * 2;
  }, { passive: true });

  function drawFrame(time) {
    ctx.clearRect(0, 0, width, height);
    const scroll = window.scrollY || 0;

    for (const d of doodles) {
      const sway = Math.sin(d.sway + time * d.swaySpeed) * d.swayAmp;
      const px = d.x + sway + mouseX * 18 * d.depth;
      // Scroll parallax: deeper doodles trail the page slightly.
      let py = d.y - scroll * 0.06 * d.depth + mouseY * 10 * d.depth;
      py = ((py % height) + height) % height;

      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(d.rot * 0.05);
      ctx.font = `${d.size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      ctx.fillStyle = `rgba(${d.tint}, ${d.alpha})`;
      ctx.fillText(d.text, 0, 0);
      ctx.restore();
    }

    for (const s of streaks) {
      const grad = ctx.createLinearGradient(s.x - s.len, s.y, s.x, s.y);
      grad.addColorStop(0, `rgba(${s.color}, 0)`);
      grad.addColorStop(1, `rgba(${s.color}, ${s.alpha})`);
      ctx.fillStyle = grad;
      ctx.fillRect(s.x - s.len, s.y, s.len, 1.5);
    }
  }

  if (reduceMotion) {
    drawFrame(0);
    return;
  }

  let running = true;
  document.addEventListener('visibilitychange', function () {
    running = !document.hidden;
    if (running) requestAnimationFrame(tick);
  });

  function tick(now) {
    if (!running) return;
    for (const d of doodles) {
      d.y -= d.vy;
      if (d.y < -40) {
        d.y = height + 30;
        d.x = Math.random() * width;
        d.text = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      }
    }
    if (now > nextStreakAt) spawnStreak(now);
    for (const s of streaks) s.x += s.speed;
    streaks = streaks.filter(function (s) { return s.x - s.len < width + 80; });

    drawFrame(now);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

initBackground();
