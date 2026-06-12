// Scroll-driven 3D hero object: a machined checkmark (the verdict) that
// travels through the page as you scroll, the way a product hero moves
// through a beverage site. It idles beside the terminal, sweeps left past
// the problem section, spins through the pipeline, lands center stage in
// verdict green at the result section, then drifts off toward pricing.
//
// Three.js is loaded lazily from the CDN; if WebGL or the CDN is missing the
// page simply keeps its 2D background. Reduced motion gets a static pose
// that still follows scroll position (no idle spin, no smoothing).

const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';

// Choreography waypoints across total scroll progress p ∈ [0, 1].
// x/y are viewport fractions (0 = left/top, 1 = right/bottom).
const WAYPOINTS = [
  { p: 0.0,  x: 0.68, y: 0.24, s: 0.48, ry: 0.6,  rz: 0.15, color: 0x22d3ee },
  { p: 0.12, x: 0.14, y: 0.46, s: 1.0,  ry: 2.2,  rz: -0.2, color: 0x22d3ee },
  { p: 0.32, x: 0.84, y: 0.5,  s: 1.12, ry: 4.4,  rz: 0.25, color: 0x1c69d4 },
  { p: 0.52, x: 0.13, y: 0.55, s: 1.0,  ry: 6.6,  rz: -0.3, color: 0x6366f1 },
  { p: 0.68, x: 0.56, y: 0.44, s: 1.45, ry: 8.0,  rz: 0.0,  color: 0x0fa336 },
  { p: 0.84, x: 0.86, y: 0.42, s: 0.9,  ry: 9.6,  rz: 0.3,  color: 0x1c69d4 },
  { p: 1.0,  x: 0.5,  y: 0.22, s: 0.62, ry: 11.0, rz: 0.0,  color: 0x22d3ee }
];

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

export async function initHero3d() {
  if (window.innerWidth < 560) return; // protect small screens
  let THREE;
  try {
    // Cap the CDN wait so a hung network never leaves dangling work.
    THREE = await Promise.race([
      import(THREE_URL),
      new Promise(function (_, reject) { setTimeout(function () { reject(new Error('timeout')); }, 12000); })
    ]);
  } catch {
    return; // CDN unavailable: the 2D background carries the page
  }

  const canvas = document.createElement('canvas');
  canvas.id = 'bg3d';
  canvas.setAttribute('aria-hidden', 'true');
  // Paint above the 2D grid layer (later sibling wins at equal z-index).
  const floor = document.getElementById('bg');
  if (floor) {
    floor.after(canvas);
  } else {
    document.body.prepend(canvas);
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch {
    canvas.remove();
    return; // no WebGL
  }
  renderer.setPixelRatio(Math.min(window.innerWidth < 980 ? 1.5 : 2, window.devicePixelRatio || 1));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
  camera.position.set(0, 0, 4);

  // --- the machined check: two sharp bars joined at the elbow ---
  const material = new THREE.MeshStandardMaterial({
    color: 0xb9c4d6,
    metalness: 0.55,
    roughness: 0.28,
    emissive: 0x22d3ee,
    emissiveIntensity: 0.18
  });
  const W = 0.34; // bar thickness
  const D = 0.3;  // extrusion depth
  const check = new THREE.Group();

  function bar(from, to) {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const len = Math.hypot(dx, dy);
    const geometry = new THREE.BoxGeometry(len + W * 0.9, W, D);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, 0);
    mesh.rotation.z = Math.atan2(dy, dx);
    // Machined hairline edges, matching the site's 1px outlines.
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 })
    );
    mesh.add(edges);
    return mesh;
  }

  const S = [-0.85, 0.12];
  const E = [-0.28, -0.48];
  const T = [0.85, 0.66];
  check.add(bar(S, E));
  check.add(bar(E, T));
  scene.add(check);

  // --- tricolor studio lighting ---
  scene.add(new THREE.AmbientLight(0xffffff, 0.16));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(2, 4, 3);
  scene.add(key);
  const cyan = new THREE.PointLight(0x22d3ee, 14, 30);
  cyan.position.set(-5, 2, 3);
  scene.add(cyan);
  const indigo = new THREE.PointLight(0x6366f1, 14, 30);
  indigo.position.set(5, -2, 3);
  scene.add(indigo);

  // --- viewport mapping: fraction of screen → world units on the z=0 plane ---
  let halfH = 1;
  let halfW = 1;
  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    halfH = Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
    halfW = halfH * camera.aspect;
  }
  resize();
  window.addEventListener('resize', resize, { passive: true });

  function scrollProgress() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
  }

  // Piecewise interpolation between waypoints.
  const colorA = new THREE.Color();
  const colorB = new THREE.Color();
  function poseAt(p) {
    let a = WAYPOINTS[0];
    let b = WAYPOINTS[WAYPOINTS.length - 1];
    for (let i = 0; i < WAYPOINTS.length - 1; i += 1) {
      if (p >= WAYPOINTS[i].p && p <= WAYPOINTS[i + 1].p) {
        a = WAYPOINTS[i];
        b = WAYPOINTS[i + 1];
        break;
      }
    }
    const span = b.p - a.p || 1;
    const t = smoothstep(Math.min(1, Math.max(0, (p - a.p) / span)));
    colorA.setHex(a.color);
    colorB.setHex(b.color);
    return {
      x: (a.x + (b.x - a.x) * t) * 2 - 1,
      y: 1 - (a.y + (b.y - a.y) * t) * 2,
      s: a.s + (b.s - a.s) * t,
      ry: a.ry + (b.ry - a.ry) * t,
      rz: a.rz + (b.rz - a.rz) * t,
      color: colorA.lerp(colorB, t)
    };
  }

  let mouseX = 0;
  let mouseY = 0;
  window.addEventListener('mousemove', function (event) {
    mouseX = (event.clientX / window.innerWidth - 0.5) * 2;
    mouseY = (event.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });

  let smoothP = scrollProgress();
  let lastY = window.scrollY;
  let tiltVel = 0;

  function apply(p, time) {
    const pose = poseAt(p);
    check.position.set(pose.x * halfW, pose.y * halfH, 0);
    const idle = reduceMotion ? 0 : Math.sin(time * 0.0011) * 0.16;
    const bob = reduceMotion ? 0 : Math.sin(time * 0.0017) * 0.05;
    check.position.y += bob;
    check.rotation.set(
      mouseY * 0.18 + tiltVel,
      pose.ry + idle + mouseX * 0.25,
      pose.rz
    );
    check.scale.setScalar(pose.s);
    material.emissive.copy(pose.color);
    renderer.render(scene, camera);
  }

  if (reduceMotion) {
    apply(scrollProgress(), 0);
    window.addEventListener('scroll', function () { apply(scrollProgress(), 0); }, { passive: true });
    window.addEventListener('resize', function () { apply(scrollProgress(), 0); }, { passive: true });
    return;
  }

  let running = true;
  document.addEventListener('visibilitychange', function () {
    running = !document.hidden;
    if (running) requestAnimationFrame(tick);
  });

  function tick(time) {
    if (!running) return;
    const target = scrollProgress();
    smoothP += (target - smoothP) * 0.075;

    // Scroll velocity tips the check forward, like inertia on a hero product.
    const velocity = window.scrollY - lastY;
    lastY = window.scrollY;
    tiltVel += (Math.max(-0.5, Math.min(0.5, velocity * 0.004)) - tiltVel) * 0.08;

    apply(smoothP, time);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

initHero3d();
