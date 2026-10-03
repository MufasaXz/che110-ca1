/* ==========================================================================
   glacier.js — the glacier tongue, retreating entirely on the GPU
   --------------------------------------------------------------------------
   The tongue is built ONCE along the real Khumbu valley centreline (from the
   DEM metadata). Its shape is baked into vertex attributes; the vertex shader
   then melts it with `uMelt`:
     • the terminus marches up-valley (toward +Z),
     • ice thins as it melts,
     • everything down-valley of the terminus sinks under the terrain, so the
       retreat is smooth with no popping and no per-frame geometry rebuild.
   ========================================================================== */

import * as THREE from "three";

const NOISE_GLSL = /* glsl */ `
float glHash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}
float glNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(glHash(i), glHash(i + vec2(1,0)), u.x),
             mix(glHash(i + vec2(0,1)), glHash(i + vec2(1,1)), u.x), u.y);
}
float glFbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * glNoise(p); p *= 2.03; a *= 0.5; }
  return s;
}`;

/* Resample the centreline (longitude-ordered) to a fixed number of stations. */
function resampleCenterline(cl, n) {
  const out = [];
  const last = cl.length - 1;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * last;
    const i0 = Math.floor(t);
    const i1 = Math.min(last, i0 + 1);
    const f = t - i0;
    const a = cl[i0];
    const b = cl[i1];
    out.push({
      x: a.x + (b.x - a.x) * f,
      z: a.z + (b.z - a.z) * f,
      half: a.half + (b.half - a.half) * f,
    });
  }
  return out;
}

export function buildGlacier(sampler, meta, opts = {}) {
  const N = opts.along ?? 72; // stations down the tongue
  const M = opts.cross ?? 26; // cross-section resolution
  const HALF_FRACTION = opts.halfFraction ?? 0.56;

  const cl = resampleCenterline(meta.centerline, N);
  const zHead = cl[0].z;
  const zTail = cl[cl.length - 1].z;
  const retreat = (zHead - zTail) * 0.62;

  const count = (N + 1) * (M + 1);
  const positions = new Float32Array(count * 3);
  const aFloorY = new Float32Array(count);
  const aAlong = new Float32Array(count);
  const aCross = new Float32Array(count);
  const aHalf = new Float32Array(count);
  const aBump = new Float32Array(count);
  const indices = [];

  for (let i = 0; i <= N; i++) {
    const c = cl[i];
    const u = i / N;
    const half = Math.max(6, c.half * HALF_FRACTION);
    for (let j = 0; j <= M; j++) {
      const cross = (j / M) * 2 - 1;
      const x = c.x + cross * half;
      const z = c.z;
      const k = i * (M + 1) + j;
      positions[k * 3] = x;
      positions[k * 3 + 1] = 0;
      positions[k * 3 + 2] = z;
      aFloorY[k] = sampler.heightAt(x, z);
      aAlong[k] = u;
      aCross[k] = cross;
      aHalf[k] = half;
      aBump[k] = 0.82 + 0.36 * glHashJs(x * 0.11, z * 0.11);
    }
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < M; j++) {
      const a = i * (M + 1) + j;
      const b = a + M + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aFloorY", new THREE.BufferAttribute(aFloorY, 1));
  geo.setAttribute("aAlong", new THREE.BufferAttribute(aAlong, 1));
  geo.setAttribute("aCross", new THREE.BufferAttribute(aCross, 1));
  geo.setAttribute("aHalf", new THREE.BufferAttribute(aHalf, 1));
  geo.setAttribute("aBump", new THREE.BufferAttribute(aBump, 1));
  geo.computeBoundingSphere();

  const uniforms = {
    uMelt: { value: 0 },
    uThickness: { value: opts.thickness ?? 34 },
    uBand: { value: opts.band ?? 12 },
    uTermZ0: { value: zTail },
    uTermZ1: { value: zTail + retreat },
    uMeltNoise: { value: 0 },
  };

  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#a9d8ee"),
    metalness: 0.0,
    roughness: 0.42,
    envMapIntensity: 0.9,
    transparent: false,
  });

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         attribute float aFloorY;
         attribute float aAlong;
         attribute float aCross;
         attribute float aHalf;
         attribute float aBump;
         uniform float uMelt;
         uniform float uThickness;
         uniform float uBand;
         uniform float uTermZ0;
         uniform float uTermZ1;
         varying float vAlong;
         varying float vGone;
         varying vec3 vWPos;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         float glCross = pow( max( 0.0, 1.0 - aCross * aCross ), 0.5 );
         float glAlong = aAlong;
         float glThick = uThickness * ( 1.0 - 0.42 * uMelt ) *
                         pow( 1.0 - glAlong, 0.55 ) * glCross * aBump;
         float glTerm = mix( uTermZ0, uTermZ1, uMelt );
         float glGone = smoothstep( glTerm + uBand, glTerm - uBand, transformed.z );
         // a small frontal bulge just above the terminus reads as a calving snout
         float glSnout = smoothstep( uBand * 2.2, 0.0, abs( transformed.z - glTerm ) );
         transformed.y = mix( aFloorY + glThick + glSnout * 5.0, aFloorY - 14.0, glGone );
         vAlong = glAlong;
         vGone = glGone;
         vec4 glWorld = modelMatrix * vec4( transformed, 1.0 );
         vWPos = glWorld.xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         varying float vAlong;
         varying float vGone;
         varying vec3 vWPos;
         uniform float uMelt;
         uniform float uMeltNoise;
         ${NOISE_GLSL}`
      )
      .replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>
         // The shape is displaced in the vertex shader, so derive the true
         // geometric normal from screen-space derivatives.
         vec3 glFdx = dFdx( vViewPosition );
         vec3 glFdy = dFdy( vViewPosition );
         vec3 glGeo = normalize( cross( glFdx, glFdy ) );
         if ( dot( glGeo, normalize( vViewPosition ) ) < 0.0 ) glGeo = -glGeo;
         normal = glGeo;`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
         vec2 gp = vWPos.xz; // gp.x = world x, gp.y = world z
         // transverse crevasses: high frequency along flow (z), lower across
         float glCrevasse = glFbm( vec2( gp.x * 0.28, gp.y * 0.55 ) + uMeltNoise );
         float glCrack = smoothstep( 0.36, 0.74, glCrevasse );
         vec3 glIce = mix( vec3( 0.34, 0.55, 0.68 ), vec3( 0.86, 0.95, 1.0 ), glCrack );
         // medial moraines: thin dirt bands running along the flow direction
         float glDirt = smoothstep( 0.52, 0.9, glFbm( vec2( gp.x * 1.5, gp.y * 0.045 ) + 7.3 ) );
         glIce = mix( glIce, vec3( 0.34, 0.30, 0.27 ), glDirt * 0.5 );
         // melt exposes darker, wetter ice toward the terminus
         glIce = mix( glIce, vec3( 0.42, 0.50, 0.56 ), uMelt * ( 1.0 - vAlong ) * 0.6 );
         diffuseColor.rgb = glIce;`
      );
  };
  mat.customProgramCacheKey = () => "hima-glacier-melt";

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "glacier";
  mesh.castShadow = false; // vertex displacement would desync the depth pass
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;

  return { mesh, uniforms };
}

/* small JS hash so the baked bump is stable */
function glHashJs(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}
