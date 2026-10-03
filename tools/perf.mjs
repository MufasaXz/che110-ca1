/* ==========================================================================
   perf.mjs — frame-time + draw-call probe
   --------------------------------------------------------------------------
   Loads the built site with ?debug, waits for the scene, then samples real
   requestAnimationFrame intervals while the page is scrolled (so the melt,
   camera and lake are all active). Prints draw calls, triangles, geometry /
   texture counts and frame-time percentiles.

   Usage:  npm run preview   (in one shell)
           node tools/perf.mjs
   ========================================================================== */

import fs from "node:fs";
import puppeteer from "puppeteer";

const URL = (process.env.VERIFY_URL || "http://localhost:4173/") + "?debug";
const CHROME =
  process.env.CHROME_PATH ||
  "/home/aosp/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: true,
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: [
    "--no-sandbox",
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--disable-dev-shm-usage",
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => m.type() === "error" && errs.push(m.text()));

await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });
await page.waitForFunction(() => !!window.__hima, { timeout: 45000 });
await sleep(2000);

const stats = await page.evaluate(() => {
  const r = window.__hima.renderer;
  return {
    calls: r.info.render.calls,
    triangles: r.info.render.triangles,
    geometries: r.info.memory.geometries,
    textures: r.info.memory.textures,
    programs: r.info.programs?.length ?? 0,
  };
});
console.log("draw stats:", JSON.stringify(stats));

/* sample rAF intervals across a scroll sweep so everything is animating */
const frames = await page.evaluate(async () => {
  const geo = document.getElementById("glacier").getBoundingClientRect();
  const top = geo.top + window.scrollY;
  const span = Math.max(1, geo.height - window.innerHeight);

  let i = 0;
  const driver = setInterval(() => {
    i = (i + 1) % 21;
    window.scrollTo(0, top + (i / 20) * span);
  }, 110);

  const samples = [];
  let lastT = 0;
  await new Promise((resolve) => {
    const onFrame = (t) => {
      if (lastT) samples.push(t - lastT);
      lastT = t;
      if (samples.length >= 150) {
        clearInterval(driver);
        resolve();
        return;
      }
      requestAnimationFrame(onFrame);
    };
    requestAnimationFrame(onFrame);
  });

  samples.sort((a, b) => a - b);
  const q = (f) => samples[Math.min(samples.length - 1, Math.floor(samples.length * f))];
  return {
    n: samples.length,
    p50: q(0.5),
    p90: q(0.9),
    p99: q(0.99),
    max: samples[samples.length - 1],
  };
});
const fps = (ms) => (1000 / ms).toFixed(1);
console.log(
  `frame ms  p50=${frames.p50.toFixed(1)} (${fps(frames.p50)} fps)  ` +
    `p90=${frames.p90.toFixed(1)} (${fps(frames.p90)} fps)  ` +
    `p99=${frames.p99.toFixed(1)}  max=${frames.max.toFixed(1)}  n=${frames.n}`
);
console.log("(note: SwiftShader software rendering — real GPUs are far faster)");
if (errs.length) console.log("errors:", errs.slice(0, 10));

await browser.close();
