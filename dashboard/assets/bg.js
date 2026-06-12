// Ambient background floor: a faint engineering grid plus a soft spotlight
// that drifts toward the pointer. The scroll-driven 3D hero object
// (assets/hero3d.js) provides the page's motion; this layer stays calm.
// Self initializing: creates its own <canvas>, so pages opt in with one
// script tag. Honors prefers-reduced-motion (static grid only) and pauses
// while the tab is hidden. Zero dependencies.

const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const CELL = 44; // grid pitch, matches the design system rhythm
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

  function tick() {
    if (!running) return;


    // Ease the spotlight toward the pointer.
    spotX += (targetX - spotX) * 0.04;
    spotY += (targetY - spotY) * 0.04;

    drawFrame();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

initBackground();
