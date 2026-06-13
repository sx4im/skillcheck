// Ambient line-art background for the landing sections below the hero: white
// icon glyphs drawn as clean vector strokes — a restrained, technical set
// (checks, diamonds, chevrons, brackets, arrows, code tags </>, terminal
// prompts >_, plus a few hand-drawn-style motion marks: curve/squiggle arrow,
// spiral, double-chevron) — drifting gently upward, woven through a few smooth
// zigzag lines that undulate across the page. No emoji/emoticon glyphs: this
// layer stays professional and quiet behind the copy.
// Placement keeps a minimum gap between glyphs so they never overlap, motion
// is a slow uniform drift with a fixed tilt (no spinning), and everything is
// monochrome white at low alpha so headlines and cards stay readable; brand
// color stays in the content. The hero has its own image background that
// covers this layer.
//
// Self initializing: creates a fixed full-screen <canvas> (#bg). Honors
// prefers-reduced-motion (one static frame), pauses while the tab is hidden,
// and thins out on small screens. Zero dependencies.

const TWO_PI = Math.PI * 2;
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// --- icon vocabulary: each draws a unit glyph centered at the origin, to be
// stroked by the caller (which has already translated, rotated and scaled). ---
function iCheck(ctx, s) {
  ctx.moveTo(-0.5 * s, 0.02 * s);
  ctx.lineTo(-0.12 * s, 0.42 * s);
  ctx.lineTo(0.55 * s, -0.46 * s);
}
function iDiamond(ctx, s) {
  ctx.moveTo(0, -0.6 * s);
  ctx.lineTo(0.6 * s, 0);
  ctx.lineTo(0, 0.6 * s);
  ctx.lineTo(-0.6 * s, 0);
  ctx.closePath();
}
function iCircle(ctx, s) {
  ctx.moveTo(0.5 * s, 0);
  ctx.arc(0, 0, 0.5 * s, 0, TWO_PI);
}
function iPlus(ctx, s) {
  ctx.moveTo(-0.5 * s, 0);
  ctx.lineTo(0.5 * s, 0);
  ctx.moveTo(0, -0.5 * s);
  ctx.lineTo(0, 0.5 * s);
}
function iTriangle(ctx, s) {
  ctx.moveTo(0, -0.56 * s);
  ctx.lineTo(0.52 * s, 0.4 * s);
  ctx.lineTo(-0.52 * s, 0.4 * s);
  ctx.closePath();
}
function iChevron(ctx, s) {
  ctx.moveTo(-0.36 * s, -0.42 * s);
  ctx.lineTo(0.22 * s, 0);
  ctx.lineTo(-0.36 * s, 0.42 * s);
}
function iHex(ctx, s) {
  for (let i = 0; i < 6; i += 1) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    const x = Math.cos(a) * 0.56 * s;
    const y = Math.sin(a) * 0.56 * s;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}
function iArrow(ctx, s) {
  ctx.moveTo(-0.5 * s, 0);
  ctx.lineTo(0.5 * s, 0);
  ctx.moveTo(0.22 * s, -0.26 * s);
  ctx.lineTo(0.5 * s, 0);
  ctx.lineTo(0.22 * s, 0.26 * s);
}
function iBracket(ctx, s) {
  ctx.moveTo(-0.16 * s, -0.5 * s);
  ctx.lineTo(-0.42 * s, -0.5 * s);
  ctx.lineTo(-0.42 * s, 0.5 * s);
  ctx.lineTo(-0.16 * s, 0.5 * s);
  ctx.moveTo(0.16 * s, -0.5 * s);
  ctx.lineTo(0.42 * s, -0.5 * s);
  ctx.lineTo(0.42 * s, 0.5 * s);
  ctx.lineTo(0.16 * s, 0.5 * s);
}
function iDot(ctx, s) {
  ctx.moveTo(0.18 * s, 0);
  ctx.arc(0, 0, 0.18 * s, 0, TWO_PI);
}
// Code tag </> — the developer's favorite doodle.
function iCode(ctx, s) {
  ctx.moveTo(-0.2 * s, -0.32 * s);
  ctx.lineTo(-0.46 * s, 0);
  ctx.lineTo(-0.2 * s, 0.32 * s);
  ctx.moveTo(0.12 * s, -0.4 * s);
  ctx.lineTo(-0.12 * s, 0.4 * s);
  ctx.moveTo(0.2 * s, -0.32 * s);
  ctx.lineTo(0.46 * s, 0);
  ctx.lineTo(0.2 * s, 0.32 * s);
}
// Terminal prompt >_
function iTerminal(ctx, s) {
  ctx.moveTo(-0.46 * s, -0.3 * s);
  ctx.lineTo(-0.12 * s, 0);
  ctx.lineTo(-0.46 * s, 0.3 * s);
  ctx.moveTo(0.04 * s, 0.34 * s);
  ctx.lineTo(0.44 * s, 0.34 * s);
}
// --- Hand-drawn-style arrows & motion marks (inspired by the arrow set) ---
// A chevron arrowhead at (x, y) pointing along `angle`, drawn as part of the
// current path so the caller's single stroke covers it.
function arrowHead(ctx, x, y, angle, len) {
  ctx.moveTo(x + Math.cos(angle + Math.PI * 0.82) * len, y + Math.sin(angle + Math.PI * 0.82) * len);
  ctx.lineTo(x, y);
  ctx.lineTo(x + Math.cos(angle - Math.PI * 0.82) * len, y + Math.sin(angle - Math.PI * 0.82) * len);
}
// A rising swoosh arrow.
function iCurveArrow(ctx, s) {
  ctx.moveTo(-0.46 * s, 0.28 * s);
  ctx.quadraticCurveTo(-0.1 * s, 0.34 * s, 0.4 * s, -0.3 * s);
  arrowHead(ctx, 0.4 * s, -0.3 * s, Math.atan2(-0.64, 0.5), 0.2 * s);
}
// A wavy arrow skating to the right.
function iSquiggleArrow(ctx, s) {
  const steps = 30;
  const x0 = -0.46 * s;
  const x1 = 0.34 * s;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    const y = Math.sin(t * Math.PI * 3) * 0.15 * s;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  arrowHead(ctx, x1, 0, 0, 0.2 * s);
}
// An open spiral / coil.
function iSpiral(ctx, s) {
  const steps = 46;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const a = t * 2.6 * TWO_PI;
    const r = 0.07 * s + t * 0.46 * s;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}
// A double chevron » (fast-forward).
function iChevrons(ctx, s) {
  ctx.moveTo(-0.4 * s, -0.34 * s);
  ctx.lineTo(-0.05 * s, 0);
  ctx.lineTo(-0.4 * s, 0.34 * s);
  ctx.moveTo(0.05 * s, -0.34 * s);
  ctx.lineTo(0.4 * s, 0);
  ctx.lineTo(0.05 * s, 0.34 * s);
}

const ICONS = [
  iCheck, iCheck, iDiamond, iCircle, iPlus, iTriangle, iChevron, iHex, iArrow, iBracket, iDot,
  iCode, iCode, iTerminal,
  iCurveArrow, iSquiggleArrow, iSpiral, iChevrons
];

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
  let icons = [];
  let lines = [];

  // Every placement must clear this gap (px) from existing icons, so the field
  // reads as tidy and deliberate and glyphs never overlap. With a low count and
  // gentle, near-uniform motion, the spacing holds as they drift.
  const MIN_GAP = 96;

  function tooClose(x, y) {
    for (const o of icons) {
      const dx = x - o.x;
      const dy = y - o.y;
      if (dx * dx + dy * dy < MIN_GAP * MIN_GAP) return true;
    }
    return false;
  }

  // Find a spot that doesn't crowd the existing icons. bandY === null spreads
  // across the full height (initial seed); a number pins near the bottom edge
  // (respawn), with a little scatter so respawns don't line up. Falls back to
  // the last try after a bounded number of attempts.
  function placeXY(bandY) {
    let x = Math.random() * width;
    let y = bandY == null ? Math.random() * height : bandY + Math.random() * 90;
    for (let attempt = 0; attempt < 30 && tooClose(x, y); attempt += 1) {
      x = Math.random() * width;
      y = bandY == null ? Math.random() * height : bandY + Math.random() * 90;
    }
    return { x, y };
  }

  function makeIcon(bandY) {
    // Narrow depth range -> similar sizes and near-uniform speed, so the field
    // drifts as one calm layer and parallax can't shuffle glyphs into overlap.
    const depth = 0.5 + Math.random() * 0.5;
    const pos = placeXY(bandY);
    return {
      draw: ICONS[Math.floor(Math.random() * ICONS.length)],
      x: pos.x,
      y: pos.y,
      depth,
      size: 17 + depth * 20,
      alpha: 0.05 + depth * 0.1,
      vy: 0.16 + depth * 0.05,
      sway: Math.random() * TWO_PI,
      swaySpeed: 0.0009 + Math.random() * 0.0011,
      swayAmp: 4 + Math.random() * 6,
      rot: (Math.random() - 0.5) * 0.5 // fixed slight tilt; no spinning
    };
  }

  function seed() {
    const area = width * height;
    // Sparser than before: an airy, professional scatter that leaves room for
    // the min-gap spacing to keep every glyph clear of its neighbours.
    const iconCount = Math.max(10, Math.min(38, Math.round(area / (window.innerWidth < 760 ? 60000 : 38000))));
    icons = [];
    for (let i = 0; i < iconCount; i += 1) icons.push(makeIcon(null));

    // A few smooth zigzag lines spanning the width at different bands.
    const lineCount = window.innerWidth < 760 ? 3 : 5;
    lines = [];
    for (let i = 0; i < lineCount; i += 1) {
      const depth = 0.4 + Math.random() * 0.6;
      lines.push({
        y: ((i + 0.5) / lineCount) * height + (Math.random() - 0.5) * 60,
        depth,
        amp: 26 + Math.random() * 46,
        freq: 0.004 + Math.random() * 0.005,
        freq2: 0.011 + Math.random() * 0.01,
        speed: 0.00018 + Math.random() * 0.00026,
        phase: Math.random() * TWO_PI,
        alpha: 0.05 + depth * 0.07,
        cyan: Math.random() < 0.4, // a few carry a faint brand tint
        drift: (0.04 + Math.random() * 0.08) * depth
      });
    }
  }

  function resize() {
    // Use the content width (excludes the scrollbar). window.innerWidth would
    // include it, making the fixed canvas a few px wider than the viewport and
    // forcing a horizontal scrollbar. Display size is left to CSS (#bg is
    // width:100%); we only size the backing store here.
    width = document.documentElement.clientWidth || window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  let mouseX = 0;
  let mouseY = 0;
  window.addEventListener('mousemove', function (event) {
    mouseX = (event.clientX / width - 0.5) * 2;
    mouseY = (event.clientY / height - 0.5) * 2;
  }, { passive: true });

  function drawLine(line, time, scroll) {
    const baseY = ((line.y - scroll * 0.05 * line.depth) % height + height) % height + mouseY * 12 * line.depth;
    ctx.beginPath();
    for (let x = -20; x <= width + 20; x += 7) {
      const y =
        baseY +
        Math.sin(x * line.freq + time * line.speed + line.phase) * line.amp +
        Math.sin(x * line.freq2 + time * line.speed * 1.4) * line.amp * 0.32;
      if (x === -20) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineWidth = 1 + line.depth * 0.4;
    ctx.strokeStyle = line.cyan
      ? `rgba(34, 211, 238, ${(line.alpha * 0.9).toFixed(3)})`
      : `rgba(230, 237, 247, ${line.alpha.toFixed(3)})`;
    ctx.stroke();
  }

  function drawFrame(time) {
    ctx.clearRect(0, 0, width, height);
    const scroll = window.scrollY || 0;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const line of lines) drawLine(line, time, scroll);

    for (const d of icons) {
      const sway = Math.sin(d.sway + time * d.swaySpeed) * d.swayAmp;
      const px = d.x + sway + mouseX * 10 * d.depth;
      let py = d.y - scroll * 0.03 * d.depth + mouseY * 6 * d.depth;
      py = ((py % height) + height) % height;

      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(d.rot);
      ctx.beginPath();
      d.draw(ctx, d.size);
      ctx.lineWidth = 1.2 + d.depth * 0.5;
      ctx.strokeStyle = `rgba(230, 237, 247, ${d.alpha.toFixed(3)})`;
      ctx.stroke();
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
    for (const d of icons) {
      d.y -= d.vy;
      if (d.y < -60) Object.assign(d, makeIcon(height + 40));
    }
    for (const line of lines) line.y -= line.drift;
    drawFrame(time);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

initBackground();
