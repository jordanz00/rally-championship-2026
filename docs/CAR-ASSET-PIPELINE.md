# Car assets — what ships, and the wiring still owed

## What is on disk now

Rebuild any of this with `bash tools/build-car-lods.sh`; inspect with
`node tools/glbstats.mjs assets/*/*.glb`.

| File | Triangles | Primitives | Role |
|---|---|---|---|
| `assets/celica/gt4.glb` | 44,624 | 172 | Celica hero (player) |
| `assets/celica/rival.glb` | 10,304 | 172 | Celica rival LOD |
| `assets/delta/integrale.glb` | 45,616 | 27 | Delta hero (player) |
| `assets/delta/rival.glb` | 15,619 | 27 | Delta rival LOD |
| `assets/stratos/stratos.glb` | 12,638 | 4 | Stratos hero — 1974 CAD GLB (wheels split at load) |
| `assets/stratos/rival.glb` | 6,950 | 4 | Stratos rival LOD (`build-car-lods.sh` ratio 0.55) |

Originals are archived in `.backups/models/`.

### What changed and why

- **The Celica was never loading.** `toyota_celica_gt4_rally.glb` sat in the
  parent directory instead of `assets/celica/`, so the default car silently fell
  back to the procedural mesh on every boot. Installed as `gt4.glb`. Its front
  bumper and headlights are at +Z, which matches the game's forward axis, so it
  needs no `yaw` correction (the Delta does).
- **The Delta was decimated** from 149,583 to 45,616 triangles — it was 3.3x the
  Celica and the heaviest asset in the game.
- **`KHR_materials_clearcoat`, `_specular` and `_ior` are stripped** from every
  car. Those extensions promote a material to `MeshPhysicalMaterial` in
  three.js, adding lighting lobes per pixel for a wet sheen a 1995 rally game
  never had (`docs/AM3-RESEARCH.md` section 5).

### Why rival LODs exist

A full Sega Rally grid is 15 cars. At hero detail that is ~670,000 triangles per
frame; the rival LODs bring the 14-car pack to ~144,000. AM3 hit this same wall
on Saturn and thinned the on-screen pack to protect the frame rate, which is why
the port is famously "lonely".

### Why the pipeline does NOT run `gltf-transform join`

`join` implicitly flattens the node hierarchy, which deletes the transform-only
`WHEEL_*` hub nodes **even with `--keepNamed`** (measured: 384 nodes to 38, zero
wheel nodes surviving). `findWheels()` in `js/cars/celica.js` locates wheels by
node name, so joining at asset level stops the wheels rotating. Draw-call
merging therefore has to happen at load time in JS, where wheel subtrees can be
excluded explicitly.

---

## Wiring still owed in `js/cars/celica.js`

This file is owned by the graphics workstream. The assets above are in place and
serving; the code still needs these changes.

1. **Load the rival LOD.** Add `rival.glb` to each `GARAGE` entry and load it
   into a second template set. `createRivalCar()` should clone that template
   instead of calling `buildGenericRival()`, so every car on track is genuinely
   the same car rather than a different procedural silhouette.

2. **Merge body panels at load time, once per template.** The Celica rival is
   still 172 primitives, so a 14-car pack is ~2,400 draw calls. Using the
   vendored `BufferGeometryUtils.mergeGeometries`, merge all meshes **not**
   inside a `WHEEL_*` subtree, grouped by material, and leave the four wheel
   hubs untouched. Target: under ~40 draw calls per rival. Do this on the
   template, never per instance.

3. **Stop cloning materials per instance.** `cloneCar()` currently clones every
   material for every car (34 for the Celica), so nothing batches. Rivals should
   share one material set, with only the body paint varying across the eight
   `AI_TINTS` liveries — eight shared paint materials, not 14 x 34 clones.

4. **Remove `cache: "no-store"` from `tryLocalGltf`.** It forces a re-download of
   every car GLB on every page load — about 12 MB now — and defeats the browser
   cache entirely. Normal caching is correct here; the garage drop path already
   handles user-supplied files separately.

5. **Demote the procedural cars to a genuine last resort.** `buildSaturnCar()`
   and `buildGenericRival()` should only run if a GLB actually fails to load,
   not as the routine path. When they do run, log it, because a silent fallback
   to the low-poly mesh is exactly the failure that went unnoticed for days.

## Still outstanding

- **The Stratos hero is the user-supplied 1974 CAD GLB** (~12.6k tris, 2048
  PBR maps). Axles ship fused; `prepStratosCadModel` splits them into `WHEEL_*`
  hubs at load. Rival LOD via `build-car-lods.sh`.
- Per-instance wheel rotation on rivals must be re-verified after any merge
  work — check `node tools/glbstats.mjs` reports 4 wheel hubs, and confirm in
  play that rival wheels actually turn.
