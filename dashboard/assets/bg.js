// Ambient line-art background for the landing sections below the hero: white
// icon glyphs drawn as clean vector strokes — checks, diamonds, chevrons,
// brackets, arrows, code tags </>, terminal prompts >_, hearts, stars, a few
// hand-drawn-style arrows (curve, squiggle, spiral, double-chevron) and a cast
// of emoticon faces (smile, frown, wink, surprised, cool, X-eyes) — floating
// upward, woven through a few smooth zigzag lines that undulate across the
// page. The arrow + face families are original glyphs drawn in this house
// style, inspired by (not copied from) the doodle reference sets.
// Everything is monochrome white at low alpha so headlines and cards stay
// readable; brand color stays in the content. (Deliberately line-art, not
// full-color emoji, so the layer never competes with the copy on top of it.)
// The hero has its own image background that covers this layer.
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
// Face helpers: a dot eye and an arc mouth. Each starts with a moveTo so the
// subpath doesn't connect a stray line to the previous one in the same stroke.
function eye(ctx, x, y, r) {
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, TWO_PI);
}
function mouth(ctx, cx, cy, r, start, end) {
  ctx.moveTo(cx + Math.cos(start) * r, cy + Math.sin(start) * r);
  ctx.arc(cx, cy, r, start, end);
}
// A round face with a smile :)
function iSmile(ctx, s) {
  ctx.moveTo(0.5 * s, 0);
  ctx.arc(0, 0, 0.5 * s, 0, TWO_PI);
  eye(ctx, -0.17 * s, -0.13 * s, 0.06 * s);
  eye(ctx, 0.17 * s, -0.13 * s, 0.06 * s);
  mouth(ctx, 0, 0.05 * s, 0.26 * s, 0.18 * Math.PI, 0.82 * Math.PI);
}
// ...and one with a frown :(
function iFrown(ctx, s) {
  ctx.moveTo(0.5 * s, 0);
  ctx.arc(0, 0, 0.5 * s, 0, TWO_PI);
  eye(ctx, -0.17 * s, -0.13 * s, 0.06 * s);
  eye(ctx, 0.17 * s, -0.13 * s, 0.06 * s);
  mouth(ctx, 0, 0.42 * s, 0.26 * s, 1.18 * Math.PI, 1.82 * Math.PI);
}
function iHeart(ctx, s) {
  ctx.moveTo(0, 0.36 * s);
  ctx.bezierCurveTo(-0.62 * s, -0.08 * s, -0.32 * s, -0.52 * s, 0, -0.16 * s);
  ctx.bezierCurveTo(0.32 * s, -0.52 * s, 0.62 * s, -0.08 * s, 0, 0.36 * s);
}
function iStar(ctx, s) {
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? 0.56 * s : 0.24 * s;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
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

// --- More emoticon faces (inspired by the emoji-doodle set) ---
// An X eye for the dizzy/dead face.
function cross(ctx, x, y, r) {
  ctx.moveTo(x - r, y - r);
  ctx.lineTo(x + r, y + r);
  ctx.moveTo(x + r, y - r);
  ctx.lineTo(x - r, y + r);
}
// A wink ;) — one open eye, one happy closed eye, a smile.
function iWink(ctx, s) {
  ctx.moveTo(0.5 * s, 0);
  ctx.arc(0, 0, 0.5 * s, 0, TWO_PI);
  eye(ctx, -0.17 * s, -0.12 * s, 0.06 * s);
  mouth(ctx, 0.17 * s, -0.08 * s, 0.1 * s, 1.15 * Math.PI, 1.85 * Math.PI);
  mouth(ctx, 0, 0.05 * s, 0.26 * s, 0.18 * Math.PI, 0.82 * Math.PI);
}
// A surprised face :o — wide eyes and a round mouth.
function iSurprised(ctx, s) {
  ctx.moveTo(0.5 * s, 0);
  ctx.arc(0, 0, 0.5 * s, 0, TWO_PI);
  eye(ctx, -0.17 * s, -0.14 * s, 0.075 * s);
  eye(ctx, 0.17 * s, -0.14 * s, 0.075 * s);
  ctx.moveTo(0.12 * s, 0.17 * s);
  ctx.arc(0, 0.17 * s, 0.12 * s, 0, TWO_PI);
}
// A cool face B) — sunglasses (a brow bar with two hanging lenses) and a grin.
function iCool(ctx, s) {
  ctx.moveTo(0.5 * s, 0);
  ctx.arc(0, 0, 0.5 * s, 0, TWO_PI);
  ctx.moveTo(-0.34 * s, -0.16 * s);
  ctx.lineTo(0.34 * s, -0.16 * s);
  ctx.moveTo(-0.04 * s, -0.16 * s);
  ctx.arc(-0.18 * s, -0.16 * s, 0.14 * s, 0, Math.PI);
  ctx.moveTo(0.32 * s, -0.16 * s);
  ctx.arc(0.18 * s, -0.16 * s, 0.14 * s, 0, Math.PI);
  mouth(ctx, 0, 0.1 * s, 0.24 * s, 0.2 * Math.PI, 0.8 * Math.PI);
}
// A knocked-out face x_x — crossed eyes and a flat line mouth.
function iDead(ctx, s) {
  ctx.moveTo(0.5 * s, 0);
  ctx.arc(0, 0, 0.5 * s, 0, TWO_PI);
  cross(ctx, -0.17 * s, -0.12 * s, 0.08 * s);
  cross(ctx, 0.17 * s, -0.12 * s, 0.08 * s);
  ctx.moveTo(-0.13 * s, 0.2 * s);
  ctx.lineTo(0.13 * s, 0.2 * s);
}

const ICONS = [
  iCheck, iCheck, iDiamond, iCircle, iPlus, iTriangle, iChevron, iHex, iArrow, iBracket, iDot,
  iCode, iCode, iTerminal, iHeart, iStar,
  iCurveArrow, iSquiggleArrow, iSpiral, iChevrons,
  iSmile, iFrown, iWink, iSurprised, iCool, iDead
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

  function makeIcon(y) {
    const depth = 0.32 + Math.random() * 0.68;
    return {
      draw: ICONS[Math.floor(Math.random() * ICONS.length)],
      x: Math.random() * width,
      y,
      depth,
      size: 14 + depth * 26,
      alpha: 0.05 + depth * 0.13,
      vy: (0.05 + Math.random() * 0.13) * depth,
      sway: Math.random() * TWO_PI,
      swaySpeed: 0.0015 + Math.random() * 0.003,
      swayAmp: 7 + Math.random() * 16,
      rot: Math.random() * TWO_PI,
      rotSpeed: (Math.random() - 0.5) * 0.004
    };
  }

  function seed() {
    const area = width * height;
    const iconCount = Math.max(16, Math.min(70, Math.round(area / (window.innerWidth < 760 ? 42000 : 26000))));
    icons = [];
    for (let i = 0; i < iconCount; i += 1) icons.push(makeIcon(Math.random() * height));

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
      const px = d.x + sway + mouseX * 18 * d.depth;
      let py = d.y - scroll * 0.06 * d.depth + mouseY * 10 * d.depth;
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
      d.rot += d.rotSpeed;
      if (d.y < -60) Object.assign(d, makeIcon(height + 40));
    }
    for (const line of lines) line.y -= line.drift;
    drawFrame(time);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

initBackground();
