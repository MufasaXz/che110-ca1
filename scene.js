/* ==========================================================================
   Hima-Drishti — 3D Himalayan scene
   A scroll-driven WebGL flythrough of a procedural glacier range.
   Built on Three.js (vendored). Degrades gracefully to the CSS backdrop.
   ========================================================================== */

import * as THREE from "./vendor/three.module.min.js";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const docEl = document.documentElement;

/* ------------------------------------------------------------------ *
 *  Deterministic value noise (no external dependency)
 * ------------------------------------------------------------------ */
function hash2(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}
function smooth(t) {
  return t * t * (3 - 2 * t);
}
function valueNoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  const u = smooth(xf);
  const v = smooth(yf);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
/* Ridged multifractal — sharp alpine crests. */
function ridged(x, y, octaves) {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    let n = valueNoise(x * freq, y * freq);
    n = 1 - Math.abs(n * 2 - 1);
    n *= n;
    sum += amp * n;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}
/* Gentle rolling component so the range reads as land, not spikes. */
function rolling(x, y, octaves) {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 1.97;
  }
  return sum / norm;
}

/* ------------------------------------------------------------------ *
 *  Palette (kept in sync with styles.css)
 * ------------------------------------------------------------------ */
const COLORS = {
  skyTop: new THREE.Color("#071426"),
  skyHorizon: new THREE.Color("#1d4568"),
  skyBottom: new THREE.Color("#060d16"),
  fog: new THREE.Color("#173a59"),
  sun: new THREE.Color("#ffc98a"),
  rockLow: new THREE.Color("#263c54"),
  rockHigh: new THREE.Color("#5a7ea3"),
  ice: new THREE.Color("#c2eefb"),
  snow: new THREE.Color("#f8fcff"),
};

/* ------------------------------------------------------------------ *
 *  Terrain
 * ------------------------------------------------------------------ */
const TERRAIN = { size: 1400, segments: 240, peak: 118 };

function terrainHeight(x, z) {
  const s = 0.0026;
  const base = ridged(x * s + 11.3, z * s + 4.7, 5);
  const detail = rolling(x * 0.011, z * 0.011, 3);
  /* A long ridge running across the scene keeps the silhouette readable. */
  const spine = Math.exp(-Math.pow(z * 0.0016, 2)) * 0.45;
  let h = base * 0.82 + detail * 0.24 + spine;
  /* Fade the edges so the plane never shows a hard border. */
  const edge = Math.min(1, (TERRAIN.size * 0.5 - Math.max(Math.abs(x), Math.abs(z))) / 180);
  h *= Math.max(0, Math.min(1, edge));
  return h * TERRAIN.peak;
}

function buildTerrain() {
  const geo = new THREE.PlaneGeometry(
    TERRAIN.size,
    TERRAIN.size,
    TERRAIN.segments,
    TERRAIN.segments
  );
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const rockLow = COLORS.rockLow;
  const rockHigh = COLORS.rockHigh;
  const ice = COLORS.ice;
  const snow = COLORS.snow;
  const c = new THREE.Color();
  const snowLine = TERRAIN.peak * 0.3;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);

    /* Snow line wobbles a little so it does not look banded. */
    const wobble = (valueNoise(x * 0.02, z * 0.02) - 0.5) * 26;
    const line = snowLine + wobble;
    if (h > line) {
      const t = Math.min(1, (h - line) / (TERRAIN.peak * 0.5));
      c.copy(ice).lerp(snow, smooth(t));
    } else {
      const t = Math.min(1, h / Math.max(1, line));
      c.copy(rockLow).lerp(rockHigh, smooth(t));
    }
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.94,
    metalness: 0.0,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

/* ------------------------------------------------------------------ *
 *  Sky dome + sun + snow
 * ------------------------------------------------------------------ */
function buildSky() {
  const uniforms = {
    topColor: { value: COLORS.skyTop },
    horizonColor: { value: COLORS.skyHorizon },
    bottomColor: { value: COLORS.skyBottom },
    offset: { value: 60 },
    exponent: { value: 0.9 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 bottomColor;
      uniform float offset; uniform float exponent;
      varying vec3 vWorld;
      void main() {
        float h = normalize(vWorld + vec3(0.0, offset, 0.0)).y;
        vec3 col = h > 0.0
          ? mix(horizonColor, topColor, pow(max(h, 0.0), exponent))
          : mix(horizonColor, bottomColor, pow(max(-h, 0.0), exponent));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(2600, 32, 16), mat);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

function radialTexture(inner, outer, size) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.4, outer);
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildSun() {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: radialTexture("rgba(255,236,206,0.95)", "rgba(255,170,110,0.35)", 256),
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending,
    })
  );
  sprite.scale.set(420, 420, 1);
  sprite.position.set(-360, 150, -900);
  return sprite;
}

function buildSnow() {
  const COUNT = 900;
  const positions = new Float32Array(COUNT * 3);
  const speeds = new Float32Array(COUNT);
  const spread = 320;
  for (let i = 0; i < COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * spread * 3;
    positions[i * 3 + 1] = Math.random() * 260 - 20;
    positions[i * 3 + 2] = (Math.random() - 0.5) * spread * 3;
    speeds[i] = 4 + Math.random() * 10;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    size: 1.7,
    map: radialTexture("rgba(255,255,255,0.9)", "rgba(210,235,255,0.35)", 64),
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });

  const points = new THREE.Points(geo, mat);
  points.userData.speeds = speeds;
  points.frustumCulled = false;
  return points;
}

/* ------------------------------------------------------------------ *
 *  Boot
 * ------------------------------------------------------------------ */
function init() {
  const canvas = document.getElementById("scene");
  if (!canvas) return;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
  } catch (err) {
    docEl.classList.add("no-webgl");
    return;
  }
  if (!renderer || !renderer.getContext()) {
    docEl.classList.add("no-webgl");
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setClearColor(COLORS.fog, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(COLORS.fog.getHex(), 0.0007);

  const camera = new THREE.PerspectiveCamera(
    52,
    window.innerWidth / window.innerHeight,
    0.5,
    4000
  );

  scene.add(buildSky());
  const sun = buildSun();
  scene.add(sun);
  scene.add(buildTerrain());
  const snow = buildSnow();
  scene.add(snow);

  /* Lighting: a low warm sun raking the crests + cool sky fill. */
  const sunLight = new THREE.DirectionalLight(0xffd7a8, 2.5);
  sunLight.position.set(-0.55, 0.42, -0.72);
  scene.add(sunLight);
  scene.add(new THREE.HemisphereLight(0xa8ccff, 0x0d1b2e, 1.05));

  /* Cinematic camera journey, sampled by scroll progress. */
  const camPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 70, 360),
    new THREE.Vector3(-44, 88, 210),
    new THREE.Vector3(48, 110, 60),
    new THREE.Vector3(-38, 132, -80),
    new THREE.Vector3(44, 156, -230),
    new THREE.Vector3(-10, 182, -390),
  ]);
  const lookPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 62, 60),
    new THREE.Vector3(-16, 74, -10),
    new THREE.Vector3(20, 90, -70),
    new THREE.Vector3(-12, 106, -150),
    new THREE.Vector3(16, 124, -250),
    new THREE.Vector3(0, 142, -350),
  ]);

  const state = {
    target: 0,
    current: reduceMotion ? 0.02 : -0.06, // eases in on load
    mouseX: 0,
    mouseY: 0,
    mouseXTarget: 0,
    mouseYTarget: 0,
    running: true,
  };

  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();

  function scrollProgress() {
    const max = docEl.scrollHeight - window.innerHeight;
    if (max <= 0) return 0;
    return Math.min(1, Math.max(0, (window.scrollY || docEl.scrollTop) / max));
  }

  function applyCamera(p) {
    /* Keep the first/last ~6% of the curve as headroom. */
    const t = 0.05 + p * 0.9;
    camPath.getPoint(t, pos);
    lookPath.getPoint(t, look);

    /* Mouse parallax, strongest up close. */
    pos.x += state.mouseX * 34;
    pos.y += state.mouseY * 20;
    look.x += state.mouseX * 10;

    /* Never let the camera dip inside a peak. */
    const ground = terrainHeight(pos.x, pos.z) + 16;
    if (pos.y < ground) pos.y = ground;

    camera.position.copy(pos);
    camera.lookAt(look);
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(w, h, false);
  }
  window.addEventListener("resize", resize);

  if (!reduceMotion) {
    window.addEventListener(
      "pointermove",
      (e) => {
        state.mouseXTarget = (e.clientX / window.innerWidth) * 2 - 1;
        state.mouseYTarget = -((e.clientY / window.innerHeight) * 2 - 1);
      },
      { passive: true }
    );
  }

  document.addEventListener("visibilitychange", () => {
    state.running = !document.hidden;
    if (state.running) {
      last = performance.now();
      requestAnimationFrame(tick);
    }
  });

  let last = performance.now();
  function tick(now) {
    if (!state.running) return;
    const dt = Math.min(48, now - last) / 1000;
    last = now;

    state.target = scrollProgress();
    /* Critically-damped-ish follow for a smooth, premium glide. */
    const ease = reduceMotion ? 1 : 1 - Math.pow(0.001, dt);
    state.current += (state.target - state.current) * ease;
    state.mouseX += (state.mouseXTarget - state.mouseX) * Math.min(1, dt * 3);
    state.mouseY += (state.mouseYTarget - state.mouseY) * Math.min(1, dt * 3);

    applyCamera(Math.min(1, Math.max(0, state.current)));

    if (!reduceMotion) {
      /* Drifting snow around the camera. */
      const arr = snow.geometry.attributes.position.array;
      const sp = snow.userData.speeds;
      const camZ = camera.position.z;
      for (let i = 0; i < sp.length; i++) {
        const iy = i * 3 + 1;
        arr[iy] -= sp[i] * dt;
        arr[i * 3] += Math.sin(now * 0.0004 + i) * dt * 3;
        if (arr[iy] < -20) {
          arr[iy] = 250;
          arr[i * 3] = (Math.random() - 0.5) * 960;
          arr[i * 3 + 2] = camZ + (Math.random() - 0.5) * 700;
        }
      }
      snow.geometry.attributes.position.needsUpdate = true;
    }

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

  applyCamera(Math.max(0, state.current));
  renderer.render(scene, camera);
  requestAnimationFrame(tick);

  docEl.classList.add("webgl-ready");
}

/* Only build the scene when the browser is idle, so first paint stays fast. */
if ("requestIdleCallback" in window) {
  window.requestIdleCallback(init, { timeout: 1200 });
} else {
  window.addEventListener("load", () => setTimeout(init, 60));
}
