/* ==========================================================================
   lake.js — a proglacial lake that grows as the glacier retreats
   --------------------------------------------------------------------------
   The water body follows the SAME valley corridor as the glacier tongue. It is
   revealed only where:
     • the real terrain floor sits below the waterline (so the shoreline is the
       valley floor, never a flat rectangle), and
     • the ground is DOWN-VALLEY of the current GPU terminus (so the lake fills
       exactly the corridor the ice has vacated).
   The waterline rises with the melt, so the lake deepens and spreads up-valley
   through the scroll. Everything is computed in the shader from three baked
   attributes — no per-frame CPU work.
   ========================================================================== */

import * as THREE from "three";

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

export function buildLake(sampler, meta, opts = {}) {
  const N = opts.along ?? 100; // stations down the corridor
  const M = opts.cross ?? 30; // cross-section resolution
  const HALF_FRACTION = opts.halfFraction ?? 0.94;

  const cl = resampleCenterline(meta.centerline, N);
  const zHead = cl[0].z;
  const zTail = cl[cl.length - 1].z;
  const retreat = (zHead - zTail) * (opts.retreatFraction ?? 0.62);
  const tailY = meta.centerline[meta.centerline.length - 1].y;

  /* only build stations that can ever be under water (down-valley half) */
  const zLimit = zTail + retreat + 60;
  const keep = [];
  for (let i = 0; i <= N; i++) if (cl[i].z <= zLimit) keep.push(i);
  const i0 = keep[0] ?? N;
  const i1 = keep[keep.length - 1] ?? N;
  const rows = i1 - i0 + 1;

  const count = rows * (M + 1);
  const positions = new Float32Array(count * 3);
  const aGround = new Float32Array(count);
  const aCross = new Float32Array(count);
  const aZ = new Float32Array(count);
  const indices = [];

  for (let r = 0; r < rows; r++) {
    const c = cl[i0 + r];
    const half = Math.max(10, c.half * HALF_FRACTION);
    for (let j = 0; j <= M; j++) {
      const cross = (j / M) * 2 - 1;
      const x = c.x + cross * half;
      const z = c.z;
      const k = r * (M + 1) + j;
      positions[k * 3] = x;
      positions[k * 3 + 1] = 0; // y comes from uLevel in the shader
      positions[k * 3 + 2] = z;
      aGround[k] = sampler.heightAt(x, z);
      aCross[k] = cross;
      aZ[k] = z;
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let j = 0; j < M; j++) {
      const a = r * (M + 1) + j;
      const b = a + M + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  /* The surface is horizontal (it is lifted to uLevel in the shader), so give
     it an explicit up normal — without it objectNormal is (0,0,0) and the
     lighting normal comes out NaN, rendering the water black. */
  const normals = new Float32Array(count * 3);
  for (let k = 0; k < count; k++) normals[k * 3 + 1] = 1;
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geo.setAttribute("aGround", new THREE.BufferAttribute(aGround, 1));
  geo.setAttribute("aCross", new THREE.BufferAttribute(aCross, 1));
  geo.setAttribute("aZ", new THREE.BufferAttribute(aZ, 1));
  geo.computeBoundingSphere();

  const uniforms = {
    uLevel: { value: tailY },
    uTermZ: { value: zTail },
    uTime: { value: 0 },
    uShore: { value: opts.shore ?? 11 },
    uRipple: { value: opts.ripple ?? 3.5 },
  };

  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#ffffff"),
    roughness: 0.14,
    metalness: 0.0,
    envMapIntensity: 1.25,
    transparent: true,
    depthWrite: false,
  });

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         attribute float aGround;
         attribute float aCross;
         attribute float aZ;
         uniform float uLevel;
         varying float vGround;
         varying float vCross;
         varying float vZ;
         varying vec3 vWPos;
         varying vec3 vWNrm;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         transformed.y = uLevel;
         vGround = aGround;
         vCross = aCross;
         vZ = aZ;
         vec4 lakeWorld = modelMatrix * vec4( transformed, 1.0 );
         vWPos = lakeWorld.xyz;
         vWNrm = normalize( mat3( modelMatrix ) * objectNormal );`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform float uLevel;
         uniform float uTermZ;
         uniform float uTime;
         uniform float uShore;
         uniform float uRipple;
         varying float vGround;
         varying float vCross;
         varying float vZ;
         varying vec3 vWPos;
         varying vec3 vWNrm;

         /* surface alpha: shoreline (valley floor) x vacated-corridor gate */
         float lakeAlpha() {
           float shore = 1.0 - smoothstep( uLevel - uShore, uLevel, vGround );
           float gate = smoothstep( uTermZ + 34.0, uTermZ - 34.0, vZ );
           float cross = 1.0 - smoothstep( 0.42, 1.0, abs( vCross ) );
           return clamp( shore * gate * cross * 1.45, 0.0, 0.95 );
         }
         /* gentle wind ripples, used to perturb the mirror-flat normal */
         float lakeWave( vec2 p ) {
           return sin( p.x * 0.30 + uTime * 0.8 ) * 0.06
                + sin( p.y * 0.47 - uTime * 1.15 ) * 0.05
                + sin( ( p.x + p.y ) * 0.12 + uTime * 0.5 ) * 0.04;
         }`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
         float lakeA = lakeAlpha();
         if ( lakeA < 0.004 ) discard;
         // rock-flour turquoise near the shore deepening to cold blue
         float lakeDepth = clamp( ( uLevel - vGround ) / 20.0, 0.0, 1.0 );
         vec3 lakeCol = mix( vec3( 0.62, 0.86, 0.88 ), vec3( 0.06, 0.30, 0.46 ), lakeDepth );
         diffuseColor.rgb *= lakeCol;
         diffuseColor.a *= lakeA;`
      )
      .replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>
         vec3 lakeN = normalize( vWNrm );
         float e = 1.2;
         float w0 = lakeWave( vWPos.xz );
         float wx = lakeWave( vWPos.xz + vec2( e, 0.0 ) );
         float wz = lakeWave( vWPos.xz + vec2( 0.0, e ) );
         lakeN = normalize( lakeN + vec3( -( wx - w0 ) / e, 0.0, -( wz - w0 ) / e ) * uRipple );
         normal = normalize( ( viewMatrix * vec4( lakeN, 0.0 ) ).xyz );`
      );
  };
  mat.customProgramCacheKey = () => "hima-lake";

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "lake";
  mesh.renderOrder = 2;
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  mesh.visible = false;

  return {
    mesh,
    uniforms,
    zTail,
    zHead,
    retreat,
    tailY,
    termZ0: zTail,
    termZ1: zTail + retreat,
  };
}

/**
 * Advance the lake for a melt value 0..1. The waterline rises and the corridor
 * gate follows the glacier terminus, so the lake fills the vacated valley.
 */
export function updateLake(lake, melt, opts = {}) {
  const start = opts.start ?? 0.1;
  const t = Math.max(0, Math.min(1, (melt - start) / (1 - start)));
  if (t <= 0.002) {
    lake.mesh.visible = false;
    return;
  }
  lake.mesh.visible = true;

  const rise = opts.rise ?? 52;
  const level = lake.tailY + rise * t - 2.0;
  const termZ = lake.termZ0 + (lake.termZ1 - lake.termZ0) * melt;

  lake.uniforms.uLevel.value = level;
  lake.uniforms.uTermZ.value = termZ;
}
