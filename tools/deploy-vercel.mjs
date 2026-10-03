/* ==========================================================================
   deploy-vercel.mjs — deploy the built `dist/` straight to Vercel
   --------------------------------------------------------------------------
   Uses the Vercel REST API directly (no CLI install required):

     1. walk dist/ and hash every file (sha1)
     2. upload each file to POST /v2/files  (deduped by digest — a 409 means
        the file already exists, which is fine)
     3. create a production deployment with POST /v13/deployments

   Required:
     VERCEL_TOKEN     a Vercel access token (vercel.com/account/tokens)

   Optional:
     VERCEL_PROJECT   project name           (default: himdristi)
     VERCEL_TEAM      team slug, if the project lives in a team
     VERCEL_TARGET    production | preview    (default: production)

   Usage:
     VERCEL_TOKEN=xxx node tools/deploy-vercel.mjs
   ========================================================================== */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const TOKEN = process.env.VERCEL_TOKEN;
const PROJECT = process.env.VERCEL_PROJECT || "himdristi";
const TEAM = process.env.VERCEL_TEAM || "";
const TARGET = process.env.VERCEL_TARGET || "production";
const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist");

if (!TOKEN) {
  console.error("Missing VERCEL_TOKEN. Create one at https://vercel.com/account/tokens");
  process.exit(1);
}
if (!fs.existsSync(DIST)) {
  console.error("No dist/ directory — run `npm run build` first.");
  process.exit(1);
}

const api = (p) => `https://api.vercel.com${p}${TEAM ? `?teamId=${TEAM}` : ""}`;
const auth = { Authorization: `Bearer ${TOKEN}` };

/** Recursively collect files relative to dist/. */
function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

const rel = walk(DIST);
console.log(`→ ${rel.length} files from dist/`);

/* ---- upload ------------------------------------------------------------- */
const manifest = [];
for (const file of rel) {
  const buf = fs.readFileSync(path.join(DIST, file));
  const sha = crypto.createHash("sha1").update(buf).digest("hex");

  const res = await fetch(api("/v2/files"), {
    method: "POST",
    headers: {
      ...auth,
      "Content-Type": "application/octet-stream",
      "x-now-digest": sha,
      "x-now-size": String(buf.length),
    },
    body: buf,
  });

  if (res.status === 409) {
    process.stdout.write("="); // already uploaded — deduped
  } else if (res.ok) {
    process.stdout.write("+");
  } else {
    console.error(`\nUpload failed for ${file}: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  manifest.push({ file, sha, size: buf.length });
}
console.log("");

/* ---- create deployment -------------------------------------------------- */
const body = {
  name: PROJECT,
  project: PROJECT,
  target: TARGET,
  files: manifest,
  projectSettings: { framework: null, outputDirectory: null, buildCommand: null },
};

const dep = await fetch(api("/v13/deployments"), {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

if (!dep.ok) {
  console.error(`Deployment failed: ${dep.status} ${await dep.text()}`);
  process.exit(1);
}

const json = await dep.json();
console.log(`✓ ${json.readyState || "queued"} — https://${json.url}`);
if (json.alias?.length) console.log(`  aliases: ${json.alias.join(", ")}`);
