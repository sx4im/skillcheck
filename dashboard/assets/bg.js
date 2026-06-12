// Ambient background: an engineering grid with light beams traveling along
// its lines (cyan, blue, indigo) and a soft spotlight that drifts toward the
// pointer. The 21st.dev "background beams" genre, tuned to the SkillCheck
// motorsport system: black floor, machined lines, brand tricolor energy.
// Self initializing: creates its own <canvas>, so pages opt in with one
// script tag. Honors prefers-reduced-motion (static grid only) and pauses
// while the tab is hidden. Zero dependencies.

const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const CELL = 44; // grid pitch, matches the design system rhythm
const BEAM_COLORS = ['34, 211, 238', '28, 105, 212', '99, 102, 241'];

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

  // --- static grid, drawn to an offscreen layer once per resize ---
  let gridLayer = document.createElement('canvas');
  function paintGrid() {
    gridLayer = document.createElement('canvas');
    gridLayer.width = Math.round(width * dpr);
    gridLayer.height = Math.round(height * dpr);
    const g = gridLayer.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.strokeStyle = 'rgba(148, 163, 184, 0.07)';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0.5; x <= width; x += CELL) {
      g.moveTo(x, 0);
      g.lineTo(x, height);
    }
    for (let y = 0.5; y <= height; y += CELL) {
      g.moveTo(0, y);
      g.lineTo(width, y);
    }
    g.stroke();
    // Slightly brighter nodes at sparse intersections, like solder points.
    g.fillStyle = 'rgba(148, 163, 184, 0.12)';
    for (let x = 0; x <= width; x += CELL * 4) {
      for (let y = 0; y <= height; y += CELL * 4) {
        g.fillRect(x - 1, y - 1, 2, 2);
      }
    }
  }
  paintGrid();
  window.addEventListener('resize', function () { resize(); paintGrid(); drawFrame(); }, { passive: true });

  // --- beams: light pulses running along grid lines ---
  let beams = [];
  function spawnBeam() {
    const horizontal = Math.random() < 0.5;
    const lanes = Math.floor((horizontal ? height : width) / CELL);
    if (lanes <= 2) return;
    const lane = (1 + Math.floor(Math.random() * (lanes - 1))) * CELL + 0.5;
    const forward = Math.random() < 0.5;
    beams.push({
      horizontal,
      lane,
      forward,
      pos: forward ? -40 : (horizontal ? width : height) + 40,
      speed: (2.2 + Math.random() * 3.4) * (forward ? 1 : -1),
      len: 90 + Math.random() * 180,
      color: BEAM_COLORS[Math.floor(Math.random() * BEAM_COLORS.length)],
      alpha: 0.5 + Math.random() * 0.4
    });
  }

  // --- soft spotlight that eases toward the pointer ---
  let targetX = width * 0.7;
  let targetY = height * 0.3;
  let spotX = targetX;
  let spotY = targetY;
  window.addEventListener('mousemove', function (event) {
    targetX = event.clientX;
    targetY = event.clientY;
  }, { passive: true });

  function drawFrame() {
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(gridLayer, 0, 0, width, height);

    // Spotlight
    const radius = Math.max(width, height) * 0.4;
    const spot = ctx.createRadialGradient(spotX, spotY, 0, spotX, spotY, radius);
    spot.addColorStop(0, 'rgba(28, 105, 212, 0.07)');
    spot.addColorStop(1, 'rgba(28, 105, 212, 0)');
    ctx.fillStyle = spot;
    ctx.fillRect(0, 0, width, height);

    // Beams
    for (const b of beams) {
      const tail = b.pos - b.len * Math.sign(b.speed);
      const grad = b.horizontal
        ? ctx.createLinearGradient(tail, 0, b.pos, 0)
        : ctx.createLinearGradient(0, tail, 0, b.pos);
      grad.addColorStop(0, `rgba(${b.color}, 0)`);
      grad.addColorStop(1, `rgba(${b.color}, ${b.alpha})`);
      ctx.fillStyle = grad;
      if (b.horizontal) {
        ctx.fillRect(Math.min(tail, b.pos), b.lane - 0.75, Math.abs(b.pos - tail), 1.5);
      } else {
        ctx.fillRect(b.lane - 0.75, Math.min(tail, b.pos), 1.5, Math.abs(b.pos - tail));
      }
      // Bright head
      ctx.fillStyle = `rgba(${b.color}, ${Math.min(1, b.alpha + 0.3)})`;
      if (b.horizontal) {
        ctx.fillRect(b.pos - 1.5, b.lane - 1.5, 3, 3);
      } else {
        ctx.fillRect(b.lane - 1.5, b.pos - 1.5, 3, 3);
      }
    }
  }

  if (reduceMotion) {
    drawFrame();
    return;
  }

  let running = true;
  document.addEventListener('visibilitychange', function () {
    running = !document.hidden;
    if (running) requestAnimationFrame(tick);
  });

  let nextBeamAt = 0;
  function tick(now) {
    if (!running) return;

    if (now > nextBeamAt && beams.length < 9) {
      spawnBeam();
      nextBeamAt = now + 420 + Math.random() * 700;
    }
    for (const b of beams) b.pos += b.speed;
    beams = beams.filter(function (b) {
      const limit = b.horizontal ? width : height;
      return b.forward ? b.pos - b.len < limit + 60 : b.pos + b.len > -60;
    });

    // Ease the spotlight toward the pointer.
    spotX += (targetX - spotX) * 0.04;
    spotY += (targetY - spotY) * 0.04;

    drawFrame();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

initBackground();
