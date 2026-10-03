/* ==========================================================================
   verify.mjs — headless smoke test / visual capture
   --------------------------------------------------------------------------
   Serves the built site (run `npm run preview` first), drives it in headless
   Chromium (software WebGL via SwiftShader), and captures screenshots at
   several scroll positions across the glacier section. Also reports any
   console errors and the HUD values so we can confirm the melt is advancing.

   Usage:  npm run preview   (in one shell)
           node tools/verify.mjs [outDir]
   ========================================================================== */

import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";

const URL = process.env.VERIFY_URL || "http://localhost:4173/";
const OUT = process.argv[2] || "/tmp/hima-shots";
fs.mkdirSync(OUT, { recursive: true });

const CHROME =
  process.env.CHROME_PATH ||
  "/home/aosp/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: true,
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--ignore-gpu-blocklist",
    "--disable-dev-shm-usage",
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
page.on("requestfailed", (r) =>
  logs.push(`[reqfail] ${r.url()} — ${r.failure()?.errorText}`)
);

console.log(`→ ${URL}`);
await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });

/* wait until either the scene is ready or it gave up */
try {
  await page.waitForFunction(
    () =>
      document.documentElement.classList.contains("webgl-ready") ||
      document.documentElement.classList.contains("no-webgl"),
    { timeout: 45000 }
  );
} catch {
  logs.push("[fatal] timed out waiting for webgl-ready / no-webgl");
}

const state = await page.evaluate(() => ({
  ready: document.documentElement.classList.contains("webgl-ready"),
  noWebgl: document.documentElement.classList.contains("no-webgl"),
  status: document.getElementById("scene-status")?.textContent || "",
  hasCanvas: !!document.getElementById("scene"),
  canvasW: document.getElementById("scene")?.width || 0,
  canvasH: document.getElementById("scene")?.height || 0,
}));
console.log("state:", JSON.stringify(state));

await sleep(2500); // let textures + first frames settle

async function shot(name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  const hud = await page.evaluate(() => ({
    year: document.getElementById("hud-year")?.textContent,
    volume: document.getElementById("hud-volume")?.textContent,
  }));
  console.log(`  ${name.padEnd(16)} year=${hud.year} volume=${hud.volume} -> ${file}`);
  return hud;
}

await shot("00-hero");

/* the glacier section defines the melt timeline */
const geo = await page.evaluate(() => {
  const el = document.getElementById("glacier");
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    top: r.top + window.scrollY,
    height: r.height,
    vh: window.innerHeight,
  };
});
console.log("glacier section:", JSON.stringify(geo));

if (geo) {
  const span = Math.max(1, geo.height - geo.vh);
  for (const p of [0, 0.25, 0.5, 0.75, 1.0]) {
    await page.evaluate((y) => window.scrollTo(0, y), geo.top + p * span);
    await sleep(2200); // let the damped melt catch up
    await shot(`melt-${String(Math.round(p * 100)).padStart(3, "0")}`);
  }
}

console.log("\n--- console ---");
if (!logs.length) console.log("(clean)");
else logs.slice(0, 60).forEach((l) => console.log(l));

await browser.close();
