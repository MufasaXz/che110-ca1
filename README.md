# Hima-Drishti

A scroll-driven, **real-terrain** 3D Himalayan glacier-melting experience for the
CHE110 environment-awareness project. The valley is built from public-domain
satellite elevation data; as you scroll, the snow line retreats up the peaks, the
glacier tongue melts back on the GPU, and a proglacial lake grows in the corridor
it leaves behind.

Live: <https://himdristi.vercel.app>

## Stack

| Piece | Choice |
| --- | --- |
| Build | Vite 7 (vanilla, no framework) |
| 3D | Three.js 0.180 |
| Scroll | GSAP 3 + ScrollTrigger |
| Terrain | Real DEM (Mapzen / AWS Terrarium tiles, public domain) |
| Surface | Poly Haven CC0 HDRI + PBR snow/rock textures |

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # -> dist/
npm run preview    # serve dist/ locally
```

## Regenerating the terrain

The committed heightmap in `public/assets/dem/` is derived from real satellite
data, so you normally don't need to rebuild it. To regenerate or retarget the
region:

```bash
npm run dem        # downloads tiles, builds khumbu_elev.u16.bin + khumbu_dem.json, validates
```

`tools/build-dem.mjs` fetches 16 Terrarium tiles at zoom 12, decodes the
elevation (`elev_m = R*256 + G + B/256 - 32768`), constrains a thalweg
(valley-centreline) to a lon/lat corridor, and writes:

- `khumbu_elev.u16.bin` — 1024² raw `Uint16` elevations
- `khumbu_dem.json` — dimensions, world scale, vertical exaggeration, and the
  centreline polyline used by the glacier, lake and camera

Adjust `CORRIDOR` / `TILES` in the script to move to a different mountain.

## How it works

```
src/
  main.js       entry: styles + GSAP + UI + scene
  scene.js      orchestrator: renderer, lights, sky, asset load, render loop
  terrain.js    CPU-displaced real DEM + the snow-retreat shader (uMeltProgress)
  glacier.js    GPU-retreating glacier tongue (baked attributes, vertex melt)
  lake.js       proglacial lake that fills the vacated corridor
  snowfall.js   GPU point-sprite snowfall
  camera.js     fly-through rig along the centreline + drag-to-look
  melt.js       ScrollTrigger → damped melt/camera progress + HUD
  ui.js         nav, scroll reveals, counters
```

**Melting** is a single `uMeltProgress` uniform (0 frozen → 1 barren rock):

- the snow line (`mix(uSnowLow, uSnowHigh, uMeltProgress)`) climbs the peaks,
- a wet, glossy melt band tracks the receding line,
- snow and bedrock PBR maps are blended by the resulting coverage,
- the glacier terminus marches up-valley and the ice sinks below the floor,
- the lake waterline rises and its corridor gate follows the terminus.

Terrain surfaces use **world-space triplanar mapping**, so steep slopes never
smear into stretched "wood grain". The low-end quality profile falls back to the
cheaper planar path.

## Performance

- Adaptive quality: resolution, shadows, snow count, DPR and triplanar are
  chosen from `hardwareConcurrency` / viewport.
- `shadowMap.autoUpdate = false` — the terrain and sun are static, so the shadow
  map is baked once.
- The glacier is displaced entirely in the vertex shader; no per-frame geometry
  rebuilds.
- The render loop never reads layout (`getBoundingClientRect`), and the melt is
  damped toward a ScrollTrigger-recorded target.
- 4 draw calls, ~0.5 M triangles at the desktop profile.

Probe it yourself:

```bash
npm run preview
node tools/perf.mjs        # draw calls, triangles, frame-time percentiles
node tools/verify.mjs      # headless screenshots across the melt timeline
```

## Deploying

```bash
npm run build
VERCEL_TOKEN=xxxx node tools/deploy-vercel.mjs
```

The script uploads `dist/` through the Vercel files API and creates a production
deployment. Set `VERCEL_PROJECT` (default `himdristi`) and `VERCEL_TEAM` if
needed. `vercel.json` pins the output directory for CLI/Git deploys too.

## Using a scanned mesh instead of the DEM

The terrain path here is elevation data (Option A). If you would rather ship a
photogrammetry/scan mesh (Option B), drop it in `public/assets/models/`, load it
with `GLTFLoader`, and compress it with Draco first:

```bash
# one-time: get the glTF toolchain
npm i -g gltf-pipeline

# Draco-compress a large terrain mesh (quantise positions/normals/uvs)
gltf-pipeline -i glacier_raw.glb -o glacier_draco.glb -d \
  --draco.compressionLevel 7 \
  --draco.quantizePositionBits 14 \
  --draco.quantizeNormalBits 10 \
  --draco.quantizeTexcoordBits 12

# or bake the transforms with the Khronos tools
npx gltf-transform optimize glacier_raw.glb glacier_draco.glb \
  --compress draco --texture-compress webp
```

Then in `scene.js`:

```js
const draco = new DRACOLoader().setDecoderPath("/draco/");
const loader = new GLTFLoader().setDRACOLoader(draco);
const gltf = await loader.loadAsync("/assets/models/glacier_draco.glb");
scene.add(gltf.scene);
```

Keep the same `uMeltProgress` material injection from `terrain.js` and the
melting behaviour carries over unchanged.

## Credits

- Elevation: [Mapzen / AWS Terrarium tiles](https://registry.opendata.aws/terrain-tiles/) (public domain).
- Environment HDRI + PBR snow/rock textures: [Poly Haven](https://polyhaven.com/) (CC0).
- Climate findings and figures: [ICIMOD HI-WISE](https://hkh.icimod.org/hi-wise/ice/) and ISRO.
