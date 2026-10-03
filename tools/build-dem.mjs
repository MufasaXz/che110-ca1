#!/usr/bin/env node
/* ==========================================================================
   build-dem.mjs — turn real satellite elevation tiles into a runtime heightmap.
   --------------------------------------------------------------------------
   Source: Mapzen / AWS "Terrarium" terrain tiles (public domain, no API key)
     https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
   Decode: elev_metres = R*256 + G + B/256 - 32768

   Region: the Everest / Khumbu massif (z=12, 4x4 tiles -> 1024x1024 px,
   ~33.8 m/px, ~34.6 km across, ~3420-8753 m). Covers Everest, Lhotse,
   Nuptse, Pumori and the Khumbu Glacier.

   Output (committed):
     public/assets/dem/khumbu_elev.u16.bin   raw Uint16 little-endian metres
     public/assets/dem/khumbu_dem.json       bounds, scales, glacier centerline

   Why a raw .bin and not a 16-bit PNG? Browsers normalise decoded PNGs to
   8-bit RGBA, which would quantise a 5.3 km relief into ~20 m steps. A raw
   Uint16 buffer keeps full metre precision.

   Run: npm run dem
   ========================================================================== */

import { PNG } from "pngjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = path.join(ROOT, "tools/.tile-cache");
const OUT_DIR = path.join(ROOT, "public/assets/dem");

/* ---- region + world mapping ---------------------------------------------- */
const Z = 12;
const X0 = 3034;
const Y0 = 1714;
const NX = 4;
const NY = 4;
const W = NX * 256;
const H = NY * 256;

const WORLD_SIZE = 2000; // scene units across the region
const VERT_EXAG = 1.4; // vertical exaggeration (keeps the peaks dramatic)

/* ---- corridor used to trace the Khumbu glacier (avoids the deeper,
       neighbouring Gokyo/Ngozumpa valley to the west) ----------------------- */
const CORRIDOR = { lonL: 86.79, lonR: 86.92, latS: 27.9, latN: 28.03 };
const HALF_WIDTH_RISE = 250; // metres above the thalweg that marks the valley wall

/* Verified fallback if detection fails (lon, lat, elev m, half-width m). */
const FALLBACK = [
  [86.86, 28.002, 5330, 320],
  [86.85, 27.99, 5299, 300],
  [86.83, 27.975, 5079, 280],
  [86.823, 27.955, 4965, 260],
  [86.815, 27.94, 4950, 240],
];

/* ---- Web Mercator helpers ------------------------------------------------ */
const tile2lon = (x) => (x / 2 ** Z) * 360 - 180;
const tile2lat = (y) => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** Z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

const lonL = tile2lon(X0);
const lonR = tile2lon(X0 + NX);
const latT = tile2lat(Y0);
const latB = tile2lat(Y0 + NY);
const meanLat = (latT + latB) / 2;

const metersPerPixel = (156543.03392 * Math.cos((meanLat * Math.PI) / 180)) / 2 ** Z;
const regionWidthM = W * metersPerPixel;
const scale = WORLD_SIZE / regionWidthM; // scene units per metre (horizontal)
const verticalScale = scale * VERT_EXAG; // scene units per metre (vertical)

/* ---- tile fetch (cached, retried) ---------------------------------------- */
async function fetchTile(x, y) {
  const cacheFile = path.join(CACHE_DIR, `${Z}_${x}_${y}.png`);
  if (existsSync(cacheFile)) return readFile(cacheFile);
  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`;
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(cacheFile, buf);
      return buf;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 300 * attempt));
    }
  }
  throw new Error(`tile ${Z}/${x}/${y} failed: ${lastErr && lastErr.message}`);
}

function decodeTerrarium(buf) {
  const png = PNG.sync.read(buf);
  const out = new Float32Array(png.width * png.height);
  for (let i = 0; i < out.length; i++) {
    const r = png.data[i * 4];
    const g = png.data[i * 4 + 1];
    const b = png.data[i * 4 + 2];
    out[i] = r * 256 + g + b / 256 - 32768;
  }
  return out;
}

/* ---- main ---------------------------------------------------------------- */
async function main() {
  await mkdir(CACHE_DIR, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });

  console.log(`Fetching ${NX * NY} terrarium tiles (z${Z})…`);
  const elev = new Float32Array(W * H).fill(NaN);
  for (let ty = 0; ty < NY; ty++) {
    for (let tx = 0; tx < NX; tx++) {
      const gx = X0 + tx;
      const gy = Y0 + ty;
      const buf = await fetchTile(gx, gy);
      const tile = decodeTerrarium(buf);
      const ox = tx * 256;
      const oy = ty * 256;
      for (let r = 0; r < 256; r++) {
        for (let c = 0; c < 256; c++) {
          elev[(oy + r) * W + (ox + c)] = tile[r * 256 + c];
        }
      }
      process.stdout.write(`  ${gx}/${gy} ok\r`);
    }
  }
  console.log("");

  let minElev = Infinity;
  let maxElev = -Infinity;
  for (let i = 0; i < elev.length; i++) {
    if (elev[i] < minElev) minElev = elev[i];
    if (elev[i] > maxElev) maxElev = elev[i];
  }
  if (!isFinite(minElev) || !isFinite(maxElev)) throw new Error("elevation grid has no finite values");
  console.log(`Elevation range: ${minElev.toFixed(0)}–${maxElev.toFixed(0)} m`);

  /* ---- corridor-constrained thalweg ------------------------------------- */
  const lonToPx = (lon) => ((lon - lonL) / (lonR - lonL)) * (W - 1);
  const latToPy = (lat) => ((latT - lat) / (latT - latB)) * (H - 1);

  const pxL = Math.max(0, Math.round(lonToPx(CORRIDOR.lonL)));
  const pxR = Math.min(W - 1, Math.round(lonToPx(CORRIDOR.lonR)));
  const pyN = Math.max(0, Math.round(latToPy(CORRIDOR.latN)));
  const pyS = Math.min(H - 1, Math.round(latToPy(CORRIDOR.latS)));

  const line = [];
  for (let py = pyN; py <= pyS; py++) {
    let bestPx = -1;
    let bestE = Infinity;
    for (let px = pxL; px <= pxR; px++) {
      const e = elev[py * W + px];
      if (e < bestE) {
        bestE = e;
        bestPx = px;
      }
    }
    /* half-width: walk outward until the wall rises HALF_WIDTH_RISE above */
    let left = bestPx;
    while (left > 0 && elev[py * W + left] < bestE + HALF_WIDTH_RISE) left--;
    let right = bestPx;
    while (right < W - 1 && elev[py * W + right] < bestE + HALF_WIDTH_RISE) right++;
    const halfM = ((right - left) / 2) * metersPerPixel;
    line.push({ px: bestPx, py, elev: bestE, halfM });
  }

  /* validate: descending, long enough, finite */
  const descends = line.length > 1 && line[0].elev - line[line.length - 1].elev > 100;
  const lengthM = (line.length - 1) * metersPerPixel;
  const finite = line.every((p) => isFinite(p.elev) && isFinite(p.halfM));
  const ok = descends && lengthM > 8000 && finite && line.length > 20;

  let centerline;
  if (ok) {
    /* smooth elevation + half-width (moving average, window 5) */
    const smoothArr = (arr, key) =>
      arr.map((p, i) => {
        let s = 0;
        let n = 0;
        for (let k = -2; k <= 2; k++) {
          const q = arr[i + k];
          if (q) {
            s += q[key];
            n++;
          }
        }
        return s / n;
      });
    const smE = smoothArr(line, "elev");
    const smH = smoothArr(line, "halfM");
    centerline = line.map((p, i) => {
      const lon = lonL + (p.px / (W - 1)) * (lonR - lonL);
      const lat = latT - (p.py / (H - 1)) * (latT - latB);
      return {
        lon,
        lat,
        elev: smE[i],
        halfM: smH[i],
        x: (p.px / (W - 1) - 0.5) * WORLD_SIZE,
        z: (0.5 - p.py / (H - 1)) * WORLD_SIZE,
        y: (smE[i] - minElev) * verticalScale,
        half: smH[i] * scale,
      };
    });
    console.log(`Centerline: ${line.length} points, ${(lengthM / 1000).toFixed(1)} km, ` +
      `${line[0].elev.toFixed(0)} → ${line[line.length - 1].elev.toFixed(0)} m (detected)`);
  } else {
    centerline = FALLBACK.map(([lon, lat, e, halfM]) => ({
      lon,
      lat,
      elev: e,
      halfM,
      x: (lonToPx(lon) / (W - 1) - 0.5) * WORLD_SIZE,
      z: (0.5 - latToPy(lat) / (H - 1)) * WORLD_SIZE,
      y: (e - minElev) * verticalScale,
      half: halfM * scale,
    }));
    console.warn("Centerline detection rejected — using verified fallback polyline.");
  }

  /* ---- write Uint16 heightmap (metres) ---------------------------------- */
  const u16 = new Uint16Array(W * H);
  for (let i = 0; i < elev.length; i++) u16[i] = Math.max(0, Math.min(65535, Math.round(elev[i])));
  await writeFile(path.join(OUT_DIR, "khumbu_elev.u16.bin"), Buffer.from(u16.buffer));

  const meta = {
    width: W,
    height: H,
    z: Z,
    x0: X0,
    y0: Y0,
    nx: NX,
    ny: NY,
    minElev,
    maxElev,
    lonL,
    lonR,
    latT,
    latB,
    metersPerPixel,
    regionWidthM,
    worldSize: WORLD_SIZE,
    verticalExaggeration: VERT_EXAG,
    scale,
    verticalScale,
    centerline,
    source: "Mapzen/AWS Terrarium terrain tiles (public domain)",
  };
  await writeFile(path.join(OUT_DIR, "khumbu_dem.json"), JSON.stringify(meta));

  console.log(`Wrote ${W}x${H} heightmap (${(W * H * 2 / 1048576).toFixed(1)} MB) + meta to public/assets/dem/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
