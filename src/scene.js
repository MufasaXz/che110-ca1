/* ==========================================================================
   scene.js — the 3D glacier experience
   --------------------------------------------------------------------------
   A real-DEM Himalayan valley (Everest / Khumbu) lights from an HDRI. As you
   scroll, the snow line retreats up the peaks (uMeltProgress), the glacier
   tongue melts back on the GPU, and a proglacial lake grows in its place.
   ========================================================================== */

import * as THREE from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";

import { loadDem, createSampler, buildTerrain } from "./terrain.js";
import { buildGlacier } from "./glacier.js";
import { buildLake, updateLake } from "./lake.js";
import { buildSnowfall } from "./snowfall.js";
import { createCameraRig, attachDrag } from "./camera.js";
import { createMeltController, applyHud } from "./melt.js";

const docEl = document.documentElement;

function setStatus(msg) {
  const el = document.getElementById("scene-status");
  if (el) el.textContent = msg;
}

/** Pick a quality profile from the device. */
function detectQuality() {
  const cores = navigator.hardwareConcurrency || 8;
  const mobile =
    /Mobi|Android|Tablet|iPad/i.test(navigator.userAgent) || window.innerWidth < 820;
  const low = mobile || cores <= 4;
  return low
    ? { segments: 256, shadows: false, snow: 800, dpr: 1.25, antialias: false, shadowMap: 1024, triplanar: false }
    : { segments: 512, shadows: true, snow: 1400, dpr: 1.5, antialias: true, shadowMap: 2048, triplanar: true };
}

/* ---- sky dome (soft vertical gradient, matches the fog) ------------------ */
function buildSky(fogColor) {
  const geo = new THREE.SphereGeometry(4200, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color("#3f74b8") },
      uBottom: { value: new THREE.Color(fogColor) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize( position );
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop; uniform vec3 uBottom;
      varying vec3 vDir;
      void main() {
        float t = smoothstep( -0.06, 0.55, vDir.y );
        gl_FragColor = vec4( mix( uBottom, uTop, t ), 1.0 );
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "sky";
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

/* ---- main ---------------------------------------------------------------- */
export function initScene() {
  const canvas = document.getElementById("scene");
  if (!canvas) return;

  const q = detectQuality();

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: q.antialias,
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

  const FOG = "#9dbdd8";
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = q.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false; // static terrain + static sun = one bake

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(new THREE.Color(FOG), 1100, 3100);
  scene.add(buildSky(FOG));

  const camera = new THREE.PerspectiveCamera(
    48,
    window.innerWidth / window.innerHeight,
    0.5,
    9000
  );

  /* ---- lighting -------------------------------------------------------- */
  const key = new THREE.DirectionalLight(0xeaf3ff, 1.15);
  key.position.set(-900, 1400, 1100);
  scene.add(key);
  scene.add(key.target);
  if (q.shadows) {
    key.castShadow = true;
    key.shadow.mapSize.set(q.shadowMap, q.shadowMap);
    key.shadow.bias = -0.0008;
    key.shadow.normalBias = 3.0;
    const sc = key.shadow.camera;
    sc.left = -1080;
    sc.right = 1080;
    sc.top = 1080;
    sc.bottom = -1080;
    sc.near = 1;
    sc.far = 5200;
    sc.updateProjectionMatrix();
  }
  scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x2a2620, 0.35));

  /* ---- assets ---------------------------------------------------------- */
  const manager = new THREE.LoadingManager();
  const texLoader = new THREE.TextureLoader(manager);
  const rgbe = new HDRLoader(manager);

  const loadTex = (url, srgb) => {
    const t = texLoader.load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };

  const maps = {
    snowDiff: loadTex("/assets/snow_diff.jpg", true),
    snowNor: loadTex("/assets/snow_nor.jpg", false),
    snowRough: loadTex("/assets/snow_rough.jpg", false),
    rockDiff: loadTex("/assets/rock_diff.jpg", true),
    rockNor: loadTex("/assets/rock_nor.jpg", false),
    rockRough: loadTex("/assets/rock_rough.jpg", false),
  };

  /* ---- build + run ----------------------------------------------------- */
  let terrain = null;
  let glacier = null;
  let lake = null;
  let snow = null;
  let rig = null;
  let melt = null;

  const quality = { segments: q.segments, snow: q.snow };
  let lastMelt = -1;
  let running = true;
  let last = performance.now();

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const dpr = Math.min(window.devicePixelRatio || 1, q.dpr);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    if (snow) snow.material.uniforms.uPixelRatio.value = dpr;
  }
  window.addEventListener("resize", resize);

  function tick(now) {
    if (!running) return;
    const dt = Math.min(48, now - last) / 1000;
    last = now;

    melt.update(dt);
    const m = melt.state.melt;

    rig.updateDrag(dt);
    rig.place(camera, melt.state.cam);

    terrain.uniforms.uMeltProgress.value = m;
    terrain.uniforms.uMeltNoise.value = now * 0.00006;
    glacier.uniforms.uMelt.value = m;
    glacier.uniforms.uMeltNoise.value = now * 0.00006;

    if (Math.abs(m - lastMelt) > 0.002) {
      updateLake(lake, m, { rise: 52, start: 0.08 });
      lastMelt = m;
    }
    applyHud(m);

    snow.material.uniforms.uTime.value = now / 1000;
    lake.uniforms.uTime.value = now / 1000;

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

  document.addEventListener("visibilitychange", () => {
    running = !document.hidden;
    if (running) {
      last = performance.now();
      requestAnimationFrame(tick);
    }
  });

  async function start() {
    setStatus("Loading terrain…");
    const dem = await loadDem();
    const sampler = createSampler(dem);

    terrain = buildTerrain(sampler, maps, { segments: quality.segments, triplanar: q.triplanar });
    terrain.mesh.castShadow = q.shadows;
    scene.add(terrain.mesh);

    glacier = buildGlacier(sampler, dem.meta, {});
    scene.add(glacier.mesh);

    lake = buildLake(sampler, dem.meta, {});
    scene.add(lake.mesh);

    snow = buildSnowfall({ count: quality.snow });
    snow.material.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, q.dpr);
    scene.add(snow.points);

    rig = createCameraRig(sampler, dem.meta, {});
    attachDrag(rig, document.querySelector(".hero") || canvas, docEl);

    melt = createMeltController({});
    rig.place(camera, melt.state.cam);

    if (q.shadows) renderer.shadowMap.needsUpdate = true;

    setStatus("Loading environment…");
    await new Promise((resolve) => {
      rgbe.load(
        "/assets/pizzo_pernice_1k.hdr",
        (hdr) => {
          hdr.mapping = THREE.EquirectangularReflectionMapping;
          const pmrem = new THREE.PMREMGenerator(renderer);
          pmrem.compileEquirectangularShader();
          scene.environment = pmrem.fromEquirectangular(hdr).texture;
          pmrem.dispose();
          hdr.dispose();
          resolve();
        },
        undefined,
        () => resolve()
      );
    });

    setStatus("");
    docEl.classList.add("webgl-ready");
    last = performance.now();
    requestAnimationFrame(tick);

    /* opt-in debug hook: ?debug exposes the renderer for profiling */
    if (new URLSearchParams(location.search).has("debug")) {
      window.__hima = { renderer, scene, camera, terrain, glacier, lake, snow, melt };
    }

    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => melt.refresh());
    window.addEventListener("load", () => melt.refresh());
    melt.refresh();
  }

  start().catch((err) => {
    console.error("[scene] failed to start:", err);
    setStatus("3D scene unavailable");
    docEl.classList.add("no-webgl");
  });
}
