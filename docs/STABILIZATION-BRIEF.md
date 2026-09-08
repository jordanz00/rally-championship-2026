# Stabilization brief — Rally Championship 2026

**Status:** Binding working packet for humans and LLMs.  
**Date:** 2026-09-08  
**Boot:** `index.html` → `js/main.js?v=771`  
**Live URL may lag this tree.**

This document replaces `docs/GPT-OPTIMIZATION-BRIEF.md` and `docs/AI_EXECUTIVE_STATE.md` as **current engine state**. Those files are historical and marked SUPERSEDED.

**Constitution:** [`CURSOR_GAME_DIRECTIVE.md`](../CURSOR_GAME_DIRECTIVE.md) · [`QUALITY_STANDARD.md`](QUALITY_STANDARD.md) · [`WORLD_GEOMETRY_RULES.md`](WORLD_GEOMETRY_RULES.md)  
**Newest hotfix log:** [`QA-REPORT.md`](QA-REPORT.md) (read from the top)

---

## 0. How to use this file

This is a **stabilization pass**, not a feature pass. Do not rewrite `track.js` or `vehicle.js`. Inspect constants first. One problem, one coherent fix, then QA.

If you are ChatGPT / Cursor: inspect the listed files, then patch. Do not invent APIs from this brief alone.

---

## 1. Product (current)

Browser arcade rally inspired by Sega Rally Championship **feel** — original stages and cars, not a Sega rip, not a sim.

- Three cars: Celica GT-Four, Delta HF, Stratos HF (not six)
- Four stages: Desert, Forest, Mountain, Lakeside (+ `?physlab=1` / F8)
- Championship / Time Attack / Practice
- 14 AI rivals on the same `Vehicle` class
- Static HTML + ES modules, Three.js **r160 WebGL** default. Phase **R.2 opt-in:** `?webgpu=1` (r170 WebGPURenderer / WebGL2 backend) or `?webgpu=native`. No `src/**/*.ts`

**Priority:** fun → feel → visuals where the player looks → performance → maintainability → sim.

**Friend-test:** 10-minute Desert drive, no clip/float/hitch/blue flash, rivals on the road, weight on landings.

Do **not** claim absolute 60 fps unless a headed probe on the target GPU supports it. Safety floor is lock-30.

---

## 2. Architecture (how it works)

```
index.html
  → js/main.js
    → js/game.js          scene, 60 Hz phys accum, cameras, championship
         ├── js/config.js
         ├── js/physics/vehicle.js     pose authority
         ├── js/physics/collide.js     walls, env OBB, tunnel clamp, TOI sweep
         ├── js/physics/jump.js
         ├── js/tracks/track.js        spline world (do not rewrite)
         ├── js/tracks/stages/*-definition.js
         ├── js/cars/celica.js         GLB garage + plant + POV
         ├── js/ai.js                  pack brain → Vehicle.step
         └── js/gfx/*                  lights, post, perf tier
```

- `FIXED_DT = 1/60`. Meshes follow `drawPose()`. Never write `Vehicle.position` from the mesh.
- `Track.query(x,z)` is the shared height/surface authority (`splineY + ROAD_DECK + micro`).
- Visual plant lives on **child** meshes, not `root.position.y` (sync overwrites the wrapper).
- Default camera is medium Saturn chase: ~4.16 m back, XZ glued (`lockPos`) so throttle cannot trail, travel-follow yaw on slides. POV and far unchanged.
- Cache-bust: every first-party import is `file.js?v=N`. **One file → one version in the whole graph.** `game.js` and `ai.js` must share `vehicle.js` and `celica.js` versions or ES modules create two singletons.

---

## 3. Already shipped (do not re-implement)

Inspect before “fixing” these — they are in the tree as of 2026-09-05/06:

| Plan item | Where it already lives |
|---|---|
| `Track.query` for player plant | `vehicle.js` `_solidFloorAt`, `_axleRoad`, step |
| AI cheap probe + snap to query height | `vehicle.js` `_axleRoadCheap` + `groundY` from `query` |
| Terrain under ribbon (no sand through deck) | `track.js` `_addLandTile` `Math.min(h, roadY - bedDrop)` + `_groundHeight` trench |
| Tunnel volumes / mouth floor | `tunnel-volume.js`, `_tunnelMouthFloorY` |
| Airborne env collision | `glanceObstacles` every step; not gated on `onGround` |
| TOI sweep for env | `collide.js` `glanceObstacles` 0.28 m samples |
| Deck sweep jumps | `vehicle.js` `_sweepSolidDeck` |
| Plant on visual children | `celica.js` `plantOnContactPatch` |
| No `Track.create` during live race | `game.js` `_pumpPreloadQueue` blocks `race` / `countdown` |
| Next stage queued at halfway, built on result | `_armNextStagePreload` + `_finish` → `_scheduleTrackPreload` |
| Compile into scratch RT (no blue flash) | `game.js` settle / stream compile |
| Stream compile off 3-2-1 / freeze / GO warms | `_drainStreamCompileUnderOverlay` + `_compileStreamSlices` gate |
| Medium cam locked behind the car | `config.js` `CAMERA.views[1]` — rally chase, XZ lock, no orbit |
| Rival tire plant | `plantOnContactPatch` + zero lowDetail fake wheel travel |
| Version conflict = FAIL | `tools/qa-static-audit.mjs` `checkVersionConsistency` |
| Off-road recoverable | `bounceOffRoad` + player verge speed floor |
| Screen-space LOD + SSGI (R.2 WebGL) | `gpu-lod.js` + `postfx.js` SSGI; WebGPU opt-in `?webgpu=1` |
| Progressive grip envelope (PATCH 1) | `combinedTire` peak-hold + breakaway + recover floor; `pedalLoadBlend` into axle load. Jumps not in this patch. |
| Forest hero photogrammetry (rocks/logs) | `prop-kit.js` `FOREST_HERO_KINDS`. Trees still REJECT — see [`ASSET-QUALITY-GATE.md`](ASSET-QUALITY-GATE.md). |

**Do not** start mid-race `Track.create` again. 14 ms yield slices still hitch M1. Result / loading own the warmup.

---

## 3b. Environment reconstruction (blocked on content)

**Target:** UE5-inspired photorealism at the player's focal distance (browser WebGL). Not Nanite. Not arcade decoration.

Forest is the reference stage. **Phase 1 is blocked** until hero trees exist.

- Audit: [`ENVIRONMENT-AUDIT.md`](ENVIRONMENT-AUDIT.md) — read before generator edits
- Gate: `node tools/qa-asset-quality.mjs` (FOREST_TREE_LARGE PASS; tunnel/ferns still open)
- Manifest: [`ASSET-ACQUISITION-MANIFEST.md`](ASSET-ACQUISITION-MANIFEST.md)
- Do not generate primitive trees. Do not skim Desert/Mountain/Lakeside yet.

---

## 4. Remaining work (dependency order)

Do these **in order**. Geometry and hitch invalidates feel/visual tuning.

### Pass 1 — World coupling (P0-A) — verify, then fix generators

If a drive still shows clip / float / bury:

1. Confirm height comes from `track.query`, not a second terrain function.
2. Harden `_groundHeight` / `_addLandTile` so `terrainY <= road underside`.
3. Tunnel mouth = volumes + airborne OBB, not a bigger hole.
4. Keep TOI sweep; do not skip `glanceObstacles` when `!onGround`.
5. Keep plant on children.

QA: `qa-world-geometry.mjs` · `qa-env-clip.mjs` · `qa-desert-tunnel-mouth.mjs` · `?worldvalidate=1`

### Pass 2 — Cache / versions

`qa-static-audit` already fails dual `?v=` for the same file. Also keep `qa-garage-cars` game↔ai celica/vehicle match. After any module edit, bump the importer chain: `index → main → game` and matching `ai` imports.

### Pass 3 — Stage-build scheduling (P0-C)

Keep: race **queues**, result **pumps**. Do not preload all four stages. Dispose the stage behind the player (`_pruneTrackCache`).

### Pass 4 — Frame-time (P0-B)

Honest target: best sustainable rate on high tier; lock-30 as safety. No “we run 60.” Audit `Track.create`, GLB parse, shadow cadence (`autoUpdate = false`), post RT alloc, AI cheap path. Headed: `RALLY_QA_ALLOW_CHROME=1 node tools/qa-frame-probe.mjs`

### Pass 5 — Lighting continuity (P1-D)

State machine conceptually TITLE → LOADING → RACE_INTRO → RACING → TUNNEL → TUNNEL_EXIT. Interpolate exposure; never `compile()` onto the on-screen buffer during 3-2-1.

### Pass 6 — Rival distance tiers (P1-E)

Keep 14 cars. Near / mid / far cost (shadows, FX). `GFX.rivalShadowFar` already exists — extend, do not cut the pack.

### Pass 7 — Camera (P1-F)

Default medium is a **behind-car rally chase** (height 1.70, look-ahead 10.4, XZ lock, HF height damper). Do not add SmoothDamp lag or L/R orbit. POV and far are separate. Retune only after a human drive.

### Pass 8 — Surfaces (P1-G)

Physics Lab only. Off-road = slower and recoverable, not a parking brake. Axle blend.

### Pass 9 — P2 polish

Hero GLB: title LOD already; race hero. Damage: keep procedural. Co-driver: geometry-driven calls; `pace-notes.js` is not a second spline authority. Ghosts: local-only + layout revision reject (see `ghost.js`).

---

## 5. Hard constraints

1. Evolve `js/`. No TypeScript `src/` tree. No new engine.
2. No `track.js` / `vehicle.js` rewrites for cleanliness.
3. WebGL r160 production default. Phase R.2 opt-in is `?webgpu=1` / `?webgpu=native` with WebGL fallback. No default cutover.
4. Cache-bust every touched module. One file, one `?v=`.
5. Fix generators, not one-off props.
6. Arcade, not sim. Lab for handling.
7. Do not hide bugs with fog, darkness, or disabled collision.
8. Chrome QA from Cursor often SIGABRTs on macOS. Static Node QA is the default.

---

## 6. QA gate (after each fix)

```bash
node tools/qa-world-geometry.mjs
node tools/qa-env-clip.mjs
node tools/qa-desert-tunnel-mouth.mjs
node tools/qa-static-audit.mjs
node tools/qa-validate.mjs
node tools/qa-garage-cars.mjs
node tools/qa-chrome-safe.mjs
```

Then a short `docs/QA-REPORT.md` entry: player moment, cause, files, proof command, boot `?v=`.

---

## 7. Files to inspect before coding

```
index.html
js/main.js
js/game.js
js/config.js
js/physics/vehicle.js
js/physics/collide.js
js/physics/jump.js
js/physics/surfaces.js
js/tracks/track.js
js/tracks/tunnel-volume.js
js/ai.js
js/cars/celica.js
js/gfx/lighting-rig.js
js/gfx/perf-tier.js
js/gfx/postfx.js
js/gfx/quality-manager.js
tools/qa-*.mjs
```

---

## 8. Stale documents

| File | Use |
|---|---|
| `docs/GPT-OPTIMIZATION-BRIEF.md` | SUPERSEDED — six cars, `?v=320`, Sprint 40 snapshot |
| `docs/AI_EXECUTIVE_STATE.md` | SUPERSEDED — `main.js?v=652` snapshot |
| `docs/CURRENT_ENGINE_AUDIT.md` | Bottlenecks still valid; boot `?v=` and LOC are stale |
| This file + `QA-REPORT.md` top | Current |

Prompt footer for other models:

> Inspect js/ first. Do not rewrite track.js. Cache-bust. Keep game.js and ai.js on the same vehicle.js and celica.js versions. Fix the generator. Run qa-validate and the specific qa-* for this bug. Update docs/QA-REPORT.md.
