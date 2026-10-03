/* ==========================================================================
   Hima-Drishti — interactive 3D glacier experience
   --------------------------------------------------------------------------
   A real HDRI environment (Poly Haven, CC0) lights a high-detail Himalayan
   valley. A glacier tongue fills the valley and, as you scroll, it melts:
   the terminus retreats up-valley, the ice thins and a proglacial lake grows.
   Drag to look around; scroll to travel through time.
   Built on Three.js (vendored). Degrades gracefully to the CSS backdrop.
   ========================================================================== */

import * as THREE from "./vendor/three.module.min.js";
import { RGBELoader } from "./vendor/RGBELoader.js";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const docEl = document.documentElement;

/* ------------------------------------------------------------------ *
 *  Math helpers
 * ------------------------------------------------------------------ */
function hash2(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}
function smooth(t) {
  return t * t * (3 - 2 * t);
}
function valueNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  const u = smooth(xf), v = smooth(yf);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
function ridged(x, y, octaves) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    let n = valueNoise(x * freq, y * freq);
    n = 1 - Math.abs(n * 2 - 1);
    n *= n;
    sum += amp * n; norm += amp;
    amp *= 0.5; freq *= 2.03;
  }
  return sum / norm;
}
function rolling(x, y, octaves) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq);
    norm += amp; amp *= 0.5; freq *= 1.97;
  }
  return sum / norm;
}
function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/* ------------------------------------------------------------------ *
 *  World constants
 * ------------------------------------------------------------------ */
const WORLD = {
  size: 1700,          // terrain plane extent
  segments: 300,       // terrain resolution
  zTop: 520,           // up-valley (high, cold)
  zEnd: -620,          // down-valley (warm, lake)
};

/* Valley floor rises toward +Z so the glacier flows downhill toward -Z. */
function valleyFloor(z) {
  return -36 + (z + 700) * 0.072;
}

/* Cross-section half-width of the valley at a given z. */
function valleyHalf(z) {
  return 205 + 42 * Math.sin(z * 0.0055) + 22 * valueNoise(z * 0.01, 3.3);
}

/* Terrain height at (x,z): U-shaped valley with ridged mountain walls. */
function terrainHeight(x, z) {
  /* Gentle floor undulation gives lake shorelines and moraine a natural edge. */
  const floor = valleyFloor(z) + (valueNoise(x * 0.02, z * 0.02) - 0.5) * 7;
  const half = valleyHalf(z);
  const a = Math.abs(x) / half;
  const wall = smoothstep(0.66, 2.4, a);

  const r = ridged(x * 0.0031 + 5.1, z * 0.0031 + 2.3, 5);
  const r2 = rolling(x * 0.011, z * 0.011, 3);
  const scale = 150 + 70 * Math.sin(z * 0.0032 + 1.1);
  const mtn = (r * 0.86 + r2 * 0.14) * scale;

  let h = floor + wall * mtn;

  /* Fade the plane edges so no hard border is ever visible. */
  const edge = Math.min(1, (WORLD.size * 0.5 - Math.max(Math.abs(x), Math.abs(z))) / 220);
  h = floor + (h - floor) * clamp01(edge);
  return h;
}

/* ------------------------------------------------------------------ *
 *  Palette
 * ------------------------------------------------------------------ */
const COLORS = {
  fog: new THREE.Color("#8fb4d6"),
  rockTint: new THREE.Color("#8d7f6f"),
};

/* ------------------------------------------------------------------ *
 *  Terrain — real PBR snow + rock, blended by height and slope
 * ------------------------------------------------------------------ */
function buildTerrain(maps) {
  const geo = new THREE.PlaneGeometry(WORLD.size, WORLD.size, WORLD.segments, WORLD.segments);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();

  const snowRepeat = 44;
  maps.snowDiff.wrapS = maps.snowDiff.wrapT = THREE.RepeatWrapping;
  maps.snowNor.wrapS = maps.snowNor.wrapT = THREE.RepeatWrapping;
  maps.snowRough.wrapS = maps.snowRough.wrapT = THREE.RepeatWrapping;
  maps.snowDiff.repeat.set(snowRepeat, snowRepeat);
  maps.snowNor.repeat.set(snowRepeat, snowRepeat);
  maps.snowRough.repeat.set(snowRepeat, snowRepeat);

  const mat = new THREE.MeshStandardMaterial({
    map: maps.snowDiff,
    normalMap: maps.snowNor,
    roughnessMap: maps.snowRough,
    metalness: 0.0,
    roughness: 1.0,
    envMapIntensity: 1.0,
  });

  const uniforms = {
    rockDiff: { value: maps.rockDiff },
    rockNor: { value: maps.rockNor },
    rockRough: { value: maps.rockRough },
    uRockUv: { value: 7.0 },
    uSnowLow: { value: -72 },
    uSnowHigh: { value: 58 },
  };

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec3 vWPos;
         varying vec3 vWNrm;
         varying float vSnow;
         uniform float uSnowLow;
         uniform float uSnowHigh;
         float h21(vec2 p){ p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vec4 wp = modelMatrix * vec4(position, 1.0);
         vWPos = wp.xyz;
         vWNrm = normalize(mat3(modelMatrix) * normal);
         float slope = 1.0 - clamp(vWNrm.y, 0.0, 1.0);
         float byH = smoothstep(uSnowLow, uSnowHigh, vWPos.y);
         float byS = smoothstep(0.8, 0.3, slope);
         float nz = h21(floor(vWPos.xz * 0.09));
         vSnow = clamp(byH * byS + (nz - 0.5) * 0.3, 0.0, 1.0);`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec3 vWPos;
         varying vec3 vWNrm;
         varying float vSnow;
         uniform sampler2D rockDiff;
         uniform sampler2D rockNor;
         uniform sampler2D rockRough;
         uniform float uRockUv;`
      )
      .replace(
        "#include <map_fragment>",
        `vec4 snowT = texture2D( map, vMapUv );
         vec4 rockT = texture2D( rockDiff, vMapUv * uRockUv );
         diffuseColor *= mix( rockT, snowT, vSnow );`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `float snowR = texture2D( roughnessMap, vMapUv ).g;
         float rockR = texture2D( rockRough, vMapUv * uRockUv ).g;
         float roughnessFactor = roughness * mix( rockR, snowR, vSnow );`
      )
      .replace(
        "#include <normal_fragment_maps>",
        `vec3 snowN = texture2D( normalMap, vMapUv ).xyz * 2.0 - 1.0;
         vec3 rockN = texture2D( rockNor, vMapUv * uRockUv ).xyz * 2.0 - 1.0;
         vec3 mapN = mix( rockN, snowN, vSnow );
         mapN.xy *= normalScale;
         normal = normalize( tbn * mapN );`
      );
  };
  mat.customProgramCacheKey = () => "hima-terrain-blend";

  const mesh = new THREE.Mesh(geo, mat);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  mesh.name = "terrain";
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

/* ------------------------------------------------------------------ *
 *  Glacier — a tongue of ice that retreats and thins as it melts
 * ------------------------------------------------------------------ */
const GLACIER = {
  uSegments: 130,
  vSegments: 34,
  zTop: 760,
  zTerminusStart: -260,
  retreat: 700,        // how far up-valley the terminus pulls back at full melt
  thickness: 84,
};

function buildGlacier(maps) {
  const { uSegments: NU, vSegments: NV } = GLACIER;
  const geo = new THREE.BufferGeometry();
  const count = (NU + 1) * (NV + 1);
  const positions = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const indices = [];

  for (let iu = 0; iu <= NU; iu++) {
    const u = iu / NU;
    for (let iv = 0; iv <= NV; iv++) {
      const v = iv / NV;
      const k = iu * (NV + 1) + iv;
      uvs[k * 2] = u;
      uvs[k * 2 + 1] = v;
    }
  }
  for (let iu = 0; iu < NU; iu++) {
    for (let iv = 0; iv < NV; iv++) {
      const a = iu * (NV + 1) + iv;
      const b = a + NV + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  geo.setIndex(indices);
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));

  /* Crevasse detail borrowed from the snow normal/roughness maps. */
  const iceNor = maps.snowNor.clone();
  iceNor.wrapS = iceNor.wrapT = THREE.RepeatWrapping;
  iceNor.repeat.set(7, 14);
  iceNor.needsUpdate = true;
  const iceRough = maps.snowRough.clone();
  iceRough.wrapS = iceRough.wrapT = THREE.RepeatWrapping;
  iceRough.repeat.set(7, 14);
  iceRough.needsUpdate = true;

  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#8ecbeb"),
    normalMap: iceNor,
    normalScale: new THREE.Vector2(1.4, 1.4),
    roughnessMap: iceRough,
    roughness: 0.5,
    metalness: 0.0,
    envMapIntensity: 0.75,
    emissive: new THREE.Color("#0c2a40"),
    emissiveIntensity: 0.2,
    transparent: true,
    opacity: 0.95,
    flatShading: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "glacier";
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  updateGlacier(mesh, 0);
  return mesh;
}

function updateGlacier(mesh, melt) {
  const { uSegments: NU, vSegments: NV } = GLACIER;
  const pos = mesh.geometry.attributes.position;
  const terminus = GLACIER.zTerminusStart + melt * GLACIER.retreat;
  const thickness = GLACIER.thickness * (1 - 0.42 * melt);

  for (let iu = 0; iu <= NU; iu++) {
    const u = iu / NU;
    const z = GLACIER.zTop + (terminus - GLACIER.zTop) * u;
    const half =
      valleyHalf(z) * 0.3 * (1 - 0.28 * u) * (0.82 + 0.36 * valueNoise(z * 0.02, 7.1));
    /* Rounded, tapering tongue profile. */
    const along = Math.pow(1 - u, 0.55);
    const endTaper = smoothstep(0.0, 0.18, 1 - u);
    for (let iv = 0; iv <= NV; iv++) {
      const v = iv / NV;
      const across = v * 2 - 1;
      const x = across * half;
      const floorY = terrainHeight(x, z);
      const cross = Math.pow(Math.max(0, 1 - across * across), 0.5);
      const bump = 0.82 + 0.36 * valueNoise(x * 0.03, z * 0.03);
      /* Edges sink under the terrain so the ice emerges cleanly. */
      const thick = thickness * along * cross * endTaper * bump - 10;
      const k = (iu * (NV + 1) + iv) * 3;
      pos.array[k] = x;
      pos.array[k + 1] = floorY + thick;
      pos.array[k + 2] = z;
    }
  }
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingSphere();
}

/* ------------------------------------------------------------------ *
 *  Proglacial lake — a level water surface that only shows where the
 *  valley floor sits below the waterline, so the shoreline is natural.
 * ------------------------------------------------------------------ */
const LAKE = { seg: 96, sizeX: 900, sizeZ: 1200, centerZ: -140 };

function buildLake() {
  const geo = new THREE.PlaneGeometry(LAKE.sizeX, LAKE.sizeZ, LAKE.seg, LAKE.seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const ground = new Float32Array(pos.count);
  const colors = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    ground[i] = terrainHeight(pos.getX(i), pos.getZ(i) + LAKE.centerZ);
    colors[i * 4] = 1;
    colors[i * 4 + 1] = 1;
    colors[i * 4 + 2] = 1;
    colors[i * 4 + 3] = 0;
  }
  geo.setAttribute("aGround", new THREE.BufferAttribute(ground, 1));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 4));

  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#2a6f9c"),
    roughness: 0.07,
    metalness: 0.0,
    envMapIntensity: 1.35,
    transparent: true,
    vertexColors: true,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.z = LAKE.centerZ;
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  mesh.name = "lake";
  mesh.visible = false;
  return mesh;
}

function updateLake(mesh, melt) {
  const t = clamp01((melt - 0.12) / 0.88);
  if (t <= 0.001) {
    mesh.visible = false;
    return;
  }
  mesh.visible = true;
  const terminus = GLACIER.zTerminusStart + melt * GLACIER.retreat;
  const level = valleyFloor(terminus) - 6;
  const zNear = terminus + 6;
  const zFar = terminus - (150 + 300 * t);
  const pos = mesh.geometry.attributes.position;
  const colors = mesh.geometry.attributes.color;
  const ground = mesh.geometry.attributes.aGround.array;
  for (let i = 0; i < pos.count; i++) {
    pos.array[i * 3 + 1] = level;
    const wz = pos.array[i * 3 + 2] + LAKE.centerZ;
    let a = smoothstep(level + 0.8, level - 0.8, ground[i]);
    a *= smoothstep(zFar, zFar + 70, wz) * smoothstep(zNear, zNear - 70, wz);
    colors.array[i * 4 + 3] = a * (0.5 + 0.4 * t);
  }
  pos.needsUpdate = true;
  colors.needsUpdate = true;
}

/* ------------------------------------------------------------------ *
 *  Snowfall — animated entirely on the GPU (no per-frame CPU work)
 * ------------------------------------------------------------------ */
function buildSnowfall() {
  const COUNT = 1400;
  const positions = new Float32Array(COUNT * 3);
  const speeds = new Float32Array(COUNT);
  const offsets = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 1100;
    positions[i * 3 + 1] = Math.random() * 320;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 1400;
    speeds[i] = 6 + Math.random() * 16;
    offsets[i] = Math.random() * 6.28;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aSpeed", new THREE.BufferAttribute(speeds, 1));
  geo.setAttribute("aOffset", new THREE.BufferAttribute(offsets, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: 2.4 },
      uPixelRatio: { value: 1 },
    },
    vertexShader: `
      uniform float uTime; uniform float uSize; uniform float uPixelRatio;
      attribute float aSpeed; attribute float aOffset;
      void main() {
        vec3 p = position;
        p.y = mod(p.y - uTime * aSpeed, 320.0);
        p.x += sin(uTime * 0.35 + aOffset) * 8.0;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uSize * uPixelRatio * (300.0 / max(1.0, -mv.z));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.0, d) * 0.85;
        gl_FragColor = vec4(1.0, 1.0, 1.0, a);
      }`,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.name = "snowfall";
  return points;
}

/* ------------------------------------------------------------------ *
 *  Boot
 * ------------------------------------------------------------------ */
function setLoading(msg) {
  const el = document.getElementById("scene-status");
  if (el) el.textContent = msg;
}

function init() {
  const canvas = document.getElementById("scene");
  if (!canvas) return;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  } catch (err) {
    docEl.classList.add("no-webgl");
    return;
  }
  if (!renderer || !renderer.getContext()) {
    docEl.classList.add("no-webgl");
    return;
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.98;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(new THREE.Color("#9dbdd8"), 700, 2400);

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 6000);

  const manager = new THREE.LoadingManager();
  const texLoader = new THREE.TextureLoader(manager);
  const rgbe = new RGBELoader(manager);

  const maps = {
    snowDiff: texLoader.load("assets/snow_diff.jpg"),
    snowNor: texLoader.load("assets/snow_nor.jpg"),
    snowRough: texLoader.load("assets/snow_rough.jpg"),
    rockDiff: texLoader.load("assets/rock_diff.jpg"),
    rockNor: texLoader.load("assets/rock_nor.jpg"),
    rockRough: texLoader.load("assets/rock_rough.jpg"),
  };
  for (const t of [maps.snowDiff, maps.rockDiff]) t.colorSpace = THREE.SRGBColorSpace;

  const terrain = buildTerrain(maps);
  scene.add(terrain);
  const glacier = buildGlacier(maps);
  scene.add(glacier);
  const lake = buildLake();
  scene.add(lake);
  const snow = buildSnowfall();
  scene.add(snow);

  /* Lighting is mostly the HDRI; one key light adds shape and shadows. */
  const key = new THREE.DirectionalLight(0xeaf3ff, 1.05);
  key.position.set(-600, 900, 700);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 2.5;
  const shadowCam = key.shadow.camera;
  shadowCam.left = -560;
  shadowCam.right = 560;
  shadowCam.top = 560;
  shadowCam.bottom = -560;
  shadowCam.near = 1;
  shadowCam.far = 3200;
  scene.add(key);
  scene.add(key.target);
  scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x2a2620, 0.3));

  /* Camera journey: a wide valley vista while the glacier melts, then a
     flight down the valley. Progress is remapped so the vista holds. */
  const camPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 345, 1070),
    new THREE.Vector3(-72, 330, 905),
    new THREE.Vector3(10, 318, 815),
    new THREE.Vector3(72, 298, 555),
    new THREE.Vector3(-70, 262, 155),
    new THREE.Vector3(70, 244, -245),
    new THREE.Vector3(0, 300, -720),
  ]);
  const lookPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 82, 665),
    new THREE.Vector3(0, 74, 480),
    new THREE.Vector3(0, 66, 255),
    new THREE.Vector3(0, 60, -45),
    new THREE.Vector3(0, 58, -385),
    new THREE.Vector3(0, 68, -725),
    new THREE.Vector3(0, 90, -1045),
  ]);

  /* Hold the vista for the first ~35% of the page (hero + showcase). */
  function camProgress(p) {
    const hold = 0.35;
    const holdT = 0.26;
    if (p <= hold) return (p / hold) * holdT;
    return holdT + ((p - hold) / (1 - hold)) * (1 - holdT);
  }

  const state = {
    target: 0,
    current: reduceMotion ? 0.02 : -0.05,
    melt: 0,
    orbitYaw: 0,
    orbitPitch: 0,
    dragYaw: 0,
    dragPitch: 0,
    dragging: false,
    lastX: 0,
    lastY: 0,
    running: true,
  };

  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();
  const offset = new THREE.Vector3();

  function scrollProgress() {
    const max = docEl.scrollHeight - window.innerHeight;
    if (max <= 0) return 0;
    return clamp01((window.scrollY || docEl.scrollTop) / max);
  }

  /* Melt timeline follows the pinned showcase section, so the retreat is
     always on screen while it happens (0 before it, 1 after it). */
  function meltProgress() {
    const el = document.getElementById("glacier");
    if (!el) return 0;
    const total = el.offsetHeight - window.innerHeight;
    if (total <= 0) return 0;
    const p = clamp01(-el.getBoundingClientRect().top / total);
    return smooth(p);
  }

  function applyCamera(p) {
    const t = 0.04 + camProgress(p) * 0.92;
    camPath.getPoint(t, pos);
    lookPath.getPoint(t, look);

    /* Drag-to-look: orbit the eye around the look target. */
    const yaw = state.orbitYaw;
    const pitch = state.orbitPitch;
    offset.copy(pos).sub(look);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const ox = offset.x * cy - offset.z * sy;
    const oz = offset.x * sy + offset.z * cy;
    offset.x = ox;
    offset.z = oz;
    offset.y += pitch * 160;
    pos.copy(look).add(offset);

    /* Never let the eye sink into a peak. */
    const ground = terrainHeight(pos.x, pos.z) + 42;
    if (pos.y < ground) pos.y = ground;

    camera.position.copy(pos);
    camera.lookAt(look);
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(w, h, false);
    snow.material.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, 1.5);
  }
  window.addEventListener("resize", resize);
  snow.material.uniforms.uPixelRatio.value = dpr;

  /* Drag to look around (mouse only, so touch scrolling is never hijacked). */
  const dragTarget = document.querySelector(".hero") || canvas;
  dragTarget.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse") return;
    state.dragging = true;
    state.lastX = e.clientX;
    state.lastY = e.clientY;
    docEl.classList.add("scene-dragging");
  });
  dragTarget.addEventListener("pointermove", (e) => {
    if (!state.dragging) return;
    const dx = e.clientX - state.lastX;
    const dy = e.clientY - state.lastY;
    state.lastX = e.clientX;
    state.lastY = e.clientY;
    state.dragYaw = Math.max(-0.9, Math.min(0.9, state.dragYaw + dx * 0.004));
    state.dragPitch = Math.max(-0.5, Math.min(0.5, state.dragPitch + dy * 0.002));
  });
  const endDrag = () => {
    state.dragging = false;
    docEl.classList.remove("scene-dragging");
  };
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);

  document.addEventListener("visibilitychange", () => {
    state.running = !document.hidden;
    if (state.running) {
      last = performance.now();
      requestAnimationFrame(tick);
    }
  });

  const yearEl = document.getElementById("hud-year");
  const volEl = document.getElementById("hud-volume");
  let lastMeltApplied = -1;
  let lastGeomUpdate = 0;

  let last = performance.now();
  function tick(now) {
    if (!state.running) return;
    const dt = Math.min(48, now - last) / 1000;
    last = now;

    state.target = scrollProgress();
    const ease = reduceMotion ? 1 : 1 - Math.pow(0.0015, dt);
    state.current += (state.target - state.current) * ease;

    state.orbitYaw += (state.dragYaw - state.orbitYaw) * Math.min(1, dt * 3);
    state.orbitPitch += (state.dragPitch - state.orbitPitch) * Math.min(1, dt * 3);

    const p = clamp01(state.current);
    applyCamera(p);

    /* Keep the shadow volume centred on the viewer for crisp shadows. */
    const cx = camera.position.x * 0.35;
    const cz = camera.position.z;
    key.position.set(cx - 600, 900, cz + 700);
    key.target.position.set(cx, 0, cz - 150);
    key.target.updateMatrixWorld();

    /* Melt the glacier. Rebuilding the geometry is throttled so fast
       scrolling never stalls the frame. */
    state.melt = meltProgress();
    const delta = Math.abs(state.melt - lastMeltApplied);
    if (delta > 0.02 || (delta > 0.004 && now - lastGeomUpdate > 40)) {
      updateGlacier(glacier, state.melt);
      updateLake(lake, state.melt);
      lastMeltApplied = state.melt;
      lastGeomUpdate = now;
    }

    if (yearEl) {
      const year = Math.round(1990 + state.melt * 110);
      if (yearEl.textContent !== String(year)) yearEl.textContent = String(year);
    }
    if (volEl) {
      const loss = Math.round(state.melt * 68);
      const txt = "−" + loss + "%";
      if (volEl.textContent !== txt) volEl.textContent = txt;
    }

    snow.material.uniforms.uTime.value = now / 1000;

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

  function start() {
    applyCamera(Math.max(0, state.current));
    renderer.render(scene, camera);
    docEl.classList.add("webgl-ready");
    requestAnimationFrame(tick);
  }

  /* Real HDRI: environment lighting + visible sky. */
  setLoading("Loading environment…");
  rgbe.load("assets/pizzo_pernice_1k.hdr", (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const envRT = pmrem.fromEquirectangular(hdr);
    scene.environment = envRT.texture;
    scene.background = hdr;
    scene.backgroundBlurriness = 0.04;
    scene.backgroundIntensity = 0.9;
    pmrem.dispose();
    setLoading("");
    start();
  }, undefined, () => {
    /* If the HDRI fails, still show the scene with the key light only. */
    setLoading("");
    start();
  });
}

/* Only build the scene when the browser is idle, so first paint stays fast. */
if ("requestIdleCallback" in window) {
  window.requestIdleCallback(init, { timeout: 1500 });
} else {
  window.addEventListener("load", () => setTimeout(init, 80));
}
