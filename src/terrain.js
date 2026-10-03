/* ==========================================================================
   terrain.js — real-DEM Himalayan terrain + the "melting" shader
   --------------------------------------------------------------------------
   The heightmap is a raw Uint16 buffer of real satellite elevations (see
   tools/build-dem.mjs). We displace the plane ONCE on the CPU so normals,
   shadows and the ground-clamp height function all stay correct, then drive
   only the *appearance* of melting through `uMeltProgress` in the shader:

     • the snow line rises from the valleys up toward the peaks,
     • a wet, glossy melt band sits along the line,
     • snow / bedrock PBR maps are blended by the resulting coverage.
   ========================================================================== */

import * as THREE from "three";

/* ---- shared GLSL noise --------------------------------------------------- */
const NOISE_GLSL = /* glsl */ `
float himaHash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}
float himaNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = himaHash(i);
  float b = himaHash(i + vec2(1.0, 0.0));
  float c = himaHash(i + vec2(0.0, 1.0));
  float d = himaHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float himaFbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * himaNoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s;
}`;

/* ---- DEM loading + sampling ---------------------------------------------- */

export async function loadDem() {
  const [binRes, metaRes] = await Promise.all([
    fetch("/assets/dem/khumbu_elev.u16.bin"),
    fetch("/assets/dem/khumbu_dem.json"),
  ]);
  if (!binRes.ok || !metaRes.ok) throw new Error("DEM assets unavailable");
  const meta = await metaRes.json();
  const data = new Uint16Array(await binRes.arrayBuffer());
  return { data, meta };
}

/** Bilinear elevation sampler in world coordinates. */
export function createSampler(dem) {
  const { data, meta } = dem;
  const { width: W, height: H, worldSize, minElev, verticalScale } = meta;

  const elevAt = (px, py) => {
    const x = Math.min(W - 1, Math.max(0, px));
    const y = Math.min(H - 1, Math.max(0, py));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(W - 1, x0 + 1);
    const y1 = Math.min(H - 1, y0 + 1);
    const fx = x - x0;
    const fy = y - y0;
    const a = data[y0 * W + x0];
    const b = data[y0 * W + x1];
    const c = data[y1 * W + x0];
    const d = data[y1 * W + x1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };

  /** World-space height (scene units) at world x/z. */
  const heightAt = (x, z) => {
    const px = (x / worldSize + 0.5) * (W - 1);
    const py = (0.5 - z / worldSize) * (H - 1);
    return (elevAt(px, py) - minElev) * verticalScale;
  };

  return { heightAt, meta };
}

/* ---- terrain mesh -------------------------------------------------------- */

export function buildTerrain(sampler, maps, opts = {}) {
  const { meta } = sampler;
  const segments = opts.segments ?? 512;
  const size = meta.worldSize;

  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, sampler.heightAt(pos.getX(i), pos.getZ(i)));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  /* Triplanar sampling kills the vertical smearing that a top-down planar UV
     produces on steep slopes (the "wood grain" look). It costs 3 taps per
     texture, so the low-end profile keeps the cheap planar path. */
  const triplanar = opts.triplanar !== false;

  const mat = new THREE.MeshStandardMaterial({
    map: maps.snowDiff,
    roughnessMap: maps.snowRough,
    metalness: 0.0,
    roughness: 1.0,
    envMapIntensity: 1.0,
  });
  if (triplanar) mat.defines = { HIMA_TRIPLANAR: "" };

  const uniforms = {
    uMeltProgress: { value: 0 },
    uSnowLow: { value: opts.snowLow ?? 42 },
    uSnowHigh: { value: opts.snowHigh ?? 372 },
    uWetBand: { value: opts.wetBand ?? 26 },
    uSnowUv: { value: opts.snowUv ?? 56 },
    uRockUv: { value: opts.rockUv ?? 15 },
    uNoiseScale: { value: opts.noiseScale ?? 0.9 },
    uMeltNoise: { value: 0 },
    rockDiff: { value: maps.rockDiff },
    rockNor: { value: maps.rockNor },
    rockRough: { value: maps.rockRough },
    snowNor: { value: maps.snowNor },
  };

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    /* -------- vertex: pass world position / normal / elevation -------- */
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec3 vWPos;
         varying vec3 vWNrm;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vec4 himaWorld = modelMatrix * vec4( transformed, 1.0 );
         vWPos = himaWorld.xyz;
         vWNrm = normalize( mat3( modelMatrix ) * objectNormal );`
      );

    /* -------- fragment: snow-line retreat + wet band ------------------ */
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec3 vWPos;
         varying vec3 vWNrm;
         uniform float uMeltProgress;
         uniform float uSnowLow;
         uniform float uSnowHigh;
         uniform float uWetBand;
         uniform float uSnowUv;
         uniform float uRockUv;
         uniform float uNoiseScale;
         uniform float uMeltNoise;
         uniform sampler2D rockDiff;
         uniform sampler2D rockNor;
         uniform sampler2D rockRough;
         uniform sampler2D snowNor;
         ${NOISE_GLSL}
#ifdef HIMA_TRIPLANAR
         /* World-space triplanar fetch: blend the three axis projections by the
            world normal so no surface is ever stretched. */
         vec4 himaTri( sampler2D t, vec3 p, vec3 n, float s ) {
           vec3 bw = pow( abs( n ), vec3( 4.0 ) );
           bw /= ( bw.x + bw.y + bw.z + 1e-5 );
           return texture2D( t, p.zy * s ) * bw.x
                + texture2D( t, p.xz * s ) * bw.y
                + texture2D( t, p.xy * s ) * bw.z;
         }
         /* Same blend, but for a tangent-space normal map: map each projection's
            normal back into world space and blend. */
         vec3 himaTriN( sampler2D t, vec3 p, vec3 n, float s ) {
           vec3 bw = pow( abs( n ), vec3( 4.0 ) );
           bw /= ( bw.x + bw.y + bw.z + 1e-5 );
           vec3 nx = texture2D( t, p.zy * s ).xyz * 2.0 - 1.0;
           vec3 ny = texture2D( t, p.xz * s ).xyz * 2.0 - 1.0;
           vec3 nz = texture2D( t, p.xy * s ).xyz * 2.0 - 1.0;
           nx = vec3( nx.z, nx.y, nx.x );
           ny = vec3( ny.x, ny.z, ny.y );
           return normalize( nx * bw.x + ny * bw.y + nz * bw.z + n );
         }
#else
         vec4 himaTri( sampler2D t, vec3 p, vec3 n, float s ) { return texture2D( t, vMapUv * s ); }
         vec3 himaTriN( sampler2D t, vec3 p, vec3 n, float s ) { return n; }
#endif
         // snow coverage 0 (bare rock) .. 1 (deep snow) for this fragment
         float himaSnow() {
           float slope = 1.0 - clamp( vWNrm.y, 0.0, 1.0 );
           float snowLine = mix( uSnowLow, uSnowHigh, uMeltProgress );
           float byH = smoothstep( snowLine - 34.0, snowLine + 34.0, vWPos.y );
           float byS = smoothstep( 0.84, 0.30, slope );
           float n = himaFbm( vWPos.xz * uNoiseScale );
           return clamp( byH * byS + ( n - 0.5 ) * 0.5, 0.0, 1.0 );
         }
         // how close this fragment is to the active melt line (for wetting)
         float himaWet() {
           float snowLine = mix( uSnowLow, uSnowHigh, uMeltProgress );
           float d = abs( vWPos.y - snowLine );
           return ( 1.0 - smoothstep( 0.0, uWetBand, d ) ) * smoothstep( 0.02, 0.25, uMeltProgress );
         }`
      )
      .replace(
        "#include <map_fragment>",
        `float himaCover = himaSnow();
         float himaWet = himaWet();
         vec3 hwN = normalize( vWNrm );
         vec4 snowT = himaTri( map, vWPos, hwN, uSnowUv );
         vec4 rockT = himaTri( rockDiff, vWPos, hwN, uRockUv );
         // cool the warm sandstone toward cold Himalayan granite
         float rockLum = dot( rockT.rgb, vec3( 0.299, 0.587, 0.114 ) );
         vec3 rockCool = mix( rockT.rgb, vec3( rockLum ), 0.55 ) * vec3( 0.88, 0.92, 1.02 );
         vec3 himaBase = mix( rockCool, snowT.rgb, himaCover );
         // wet rock darkens and gains a faint blue meltwater sheen
         himaBase = mix( himaBase, himaBase * vec3( 0.42, 0.47, 0.55 ), himaWet );
         diffuseColor.rgb *= himaBase;`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `float himaSnowR = himaTri( roughnessMap, vWPos, hwN, uSnowUv ).g;
         float himaRockR = himaTri( rockRough, vWPos, hwN, uRockUv ).g;
         float himaR = mix( himaRockR, himaSnowR, himaCover );
         himaR = mix( himaR, 0.22, himaWet );
         float roughnessFactor = roughness * himaR;`
      )
      .replace(
        "#include <normal_fragment_maps>",
        `vec3 himaGeoN = normalize( vWNrm );
         vec3 himaRockN = himaTriN( rockNor, vWPos, himaGeoN, uRockUv );
         vec3 himaSnowN = himaTriN( snowNor, vWPos, himaGeoN, uSnowUv );
         vec3 himaDetN = normalize( mix( himaRockN, himaSnowN, himaCover ) );
         vec3 himaN = normalize( mix( himaGeoN, himaDetN, 0.95 ) );
         // meltwater roughens the surface right at the retreating edge
         float himaRipple = himaFbm( vWPos.xz * 3.1 + uMeltNoise );
         himaN.xz += ( himaRipple - 0.5 ) * himaWet * 0.22;
         normal = normalize( ( viewMatrix * vec4( himaN, 0.0 ) ).xyz );`
      );
  };
  mat.customProgramCacheKey = () => (triplanar ? "hima-terrain-melt-tri" : "hima-terrain-melt");

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "terrain";
  mesh.receiveShadow = true;
  mesh.castShadow = false; // static terrain doesn't need to cast; saves a pass
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();

  return { mesh, uniforms };
}
