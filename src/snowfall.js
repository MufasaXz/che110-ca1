/* ==========================================================================
   snowfall.js — GPU-animated snowfall (no per-frame CPU work)
   ========================================================================== */

import * as THREE from "three";

export function buildSnowfall(opts = {}) {
  const count = opts.count ?? 1400;
  const areaX = opts.areaX ?? 1500;
  const areaZ = opts.areaZ ?? 1700;
  const height = opts.height ?? 520;

  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const offsets = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * areaX;
    positions[i * 3 + 1] = Math.random() * height;
    positions[i * 3 + 2] = (Math.random() - 0.5) * areaZ;
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
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: opts.size ?? 2.4 },
      uPixelRatio: { value: 1 },
      uHeight: { value: height },
    },
    vertexShader: /* glsl */ `
      uniform float uTime; uniform float uSize; uniform float uPixelRatio; uniform float uHeight;
      attribute float aSpeed; attribute float aOffset;
      void main() {
        vec3 p = position;
        p.y = mod(p.y - uTime * aSpeed, uHeight);
        p.x += sin(uTime * 0.35 + aOffset) * 8.0;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uSize * uPixelRatio * (300.0 / max(1.0, -mv.z));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
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
  return { points, material: mat };
}
