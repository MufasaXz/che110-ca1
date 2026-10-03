#!/usr/bin/env node
/* ==========================================================================
   validate-dem.mjs — sanity-check the generated heightmap + metadata.
   Run: node tools/validate-dem.mjs
   ========================================================================== */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "public/assets/dem");

const fail = (msg) => {
  console.error("FAIL:", msg);
  process.exitCode = 1;
};
const ok = (msg) => console.log("  ok  " + msg);

const meta = JSON.parse(await readFile(path.join(DIR, "khumbu_dem.json"), "utf8"));
const buf = await readFile(path.join(DIR, "khumbu_elev.u16.bin"));
const u16 = new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);

/* dimensions */
if (u16.length !== meta.width * meta.height) fail(`bin length ${u16.length} != ${meta.width}x${meta.height}`);
else ok(`dimensions ${meta.width}x${meta.height}`);

/* elevation range */
let min = Infinity;
let max = -Infinity;
for (let i = 0; i < u16.length; i++) {
  const v = u16[i];
  if (v < min) min = v;
  if (v > max) max = v;
}
if (min < 3000 || max > 9000) fail(`elevation range ${min}–${max} outside expected 3000–9000 m`);
else ok(`elevation range ${min}–${max} m`);

/* bounds sanity */
if (!(meta.lonL < meta.lonR && meta.latB < meta.latT)) fail("bounds ordering is wrong");
else ok(`bounds lon ${meta.lonL.toFixed(4)}–${meta.lonR.toFixed(4)}, lat ${meta.latB.toFixed(4)}–${meta.latT.toFixed(4)}`);
ok(`resolution ${meta.metersPerPixel.toFixed(1)} m/px, region ${(meta.regionWidthM / 1000).toFixed(1)} km, scale ${meta.scale.toFixed(5)} u/m`);

/* centerline: descending, long enough, finite */
const cl = meta.centerline;
if (!Array.isArray(cl) || cl.length < 5) {
  fail("centerline missing or too short");
} else {
  const bad = cl.find((p) => !isFinite(p.x) || !isFinite(p.z) || !isFinite(p.y) || !isFinite(p.half));
  if (bad) fail("centerline has non-finite values");
  else ok(`centerline ${cl.length} points, all finite`);

  const drop = cl[0].elev - cl[cl.length - 1].elev;
  if (drop < 100) fail(`centerline does not descend (drop ${drop.toFixed(0)} m)`);
  else ok(`centerline descends ${drop.toFixed(0)} m (${cl[0].elev.toFixed(0)} → ${cl[cl.length - 1].elev.toFixed(0)} m)`);

  const zSpan = Math.abs(cl[0].z - cl[cl.length - 1].z);
  if (zSpan < 200) fail(`centerline z-span too short (${zSpan.toFixed(0)} units)`);
  else ok(`centerline spans ${zSpan.toFixed(0)} scene units`);
}

if (!process.exitCode) console.log("\nDEM validation passed.");
