# Current Engine Audit — Rally Championship 2026

**Date:** 2026-09-03  
**Scope:** Full repository engineering + visual audit (read-only).  
**Live build referenced:** https://jordanz00.github.io/rally-championship-2026/  
**Local boot (this tree):** `js/main.js?v=598` · `css/game.css?v=37` · `config.js?v=189`  

**Important:** Public GitHub Pages may lag the local working tree. Claims below are grounded in **this repository**. Do not assume Pages matches `?v=598` until that revision is pushed/merged.

**Mandate for this document:** Inspect and prioritize only. **No gameplay or rendering changes** until explicit approval.

**Product identity (source of truth):** Arcade rally inspired by Sega Rally Championship feel — fast, heavy, surface-first, readable — see [`docs/AM3-RESEARCH.md`](AM3-RESEARCH.md). Not a hardcore sim; not a generic asphalt racer.

**Follow-on targets:** [`docs/QUALITY_TARGET.md`](QUALITY_TARGET.md) · [`docs/PERFORMANCE_RULES.md`](PERFORMANCE_RULES.md)

---

## Executive summary

The project is a **mature, shippable browser arcade rally stack**, not a prototype. Core loops (title → garage → stage load → countdown → race → result), three cars, four stages, championship/time attack/practice, keyboard/gamepad/touch/tilt, multi-distance chase + POV, HUD, and audio are all present and wired.

The architecture is **custom WebGL (Three.js r160) + custom vehicle physics + a very large procedural track builder**. Strengths are surface-driven handling, streaming world construction, and a large automated QA harness. Weaknesses that block a “professional product” feel are primarily:

1. **Frame-time honesty** — absolute 60 fps is still an open PARTIAL on M1-class GPUs at cinema settings.  
2. **Stage-build cost** — cold Desert (and cup) loads remain a player-visible hitch wedge.  
3. **World coupling fragility** — road / terrain / tunnel / jump systems keep producing clip and plant regressions.  
4. **Monolithic ownership** — `track.js` (~10.8k LOC) and `game.js` (~4.8k LOC) concentrate risk.

This audit recommends **targeted, approved improvements**, never a rewrite.

---

## Inventory of existing player features (confirmed in repo)

| Feature | Evidence |
|---|---|
| Title screen + showroom | `index.html` `#screen-title`, `game.js` title stage |
| Garage / car select | `#screen-cars`, `celica.js` templates |
| GLB vehicles | Celica / Delta / Stratos under `assets/` + `js/cars/celica.js` |
| Championship / Time Attack / Practice | `game.js` `_onMenu`, `CHAMPIONSHIP` |
| Desert / Forest / Mountain / Lakeside | `js/tracks/courses.js` |
| AT / MT, handbrake, shift | `js/input.js`, `vehicle.js` gear path |
| Keyboard / gamepad / touch / tilt | `input.js`, `ui/touch-controls.js` |
| Chase distances + POV | `CAMERA.views`, `_chaseCam`, cockpit |
| Race HUD / pause / results | `ui/hud.js`, screens in `index.html` |
| Surface info / FPS | HUD fields; FPS debug / overlay paths |
| Mobile | viewport meta, touch overlay, phone perf defaults |

---

## Technology baseline

| Item | Finding |
|---|---|
| **Engine** | Custom ES modules; **no `package.json`**, no bundler |
| **Three.js** | Vendored `vendor/three.module.js` — **`REVISION = '160'`** (2010–2023 copyright header) |
| **Loaders** | `vendor/GLTFLoader.js`, `vendor/RGBELoader.js`, `BufferGeometryUtils.js`, `SimplifyModifier.js` |
| **API** | **WebGL only** (`THREE.WebGLRenderer`). **No WebGPU** |
| **Boot** | `index.html` → `js/main.js` → `RallyGame` |
| **Cache bust** | Query `?v=` on every relative module import (static audit enforced) |
| **QA** | ~125 `tools/qa-*.mjs` + CDP harness; Chrome often blocked in agent hosts unless `RALLY_QA_ALLOW_CHROME=1` |
| **Asset weight (approx.)** | Music ~59 MB · props ~37 MB · sky HDR ~19 MB · celica folder ~10 MB (hero GLB ~7.2 MB, rival LOD ~3.0 MB) |

---

## System-by-system audit

Cost scale: **Low / Medium / High** (relative to this project’s budget).  
Modify risk: likelihood of player-visible regressions if touched casually.

---

### 1. Rendering architecture

**Current implementation**  
Single `THREE.WebGLRenderer` in `RallyGame._initRenderer` (`js/game.js`): `powerPreference: "high-performance"`, antialias typically off when post is active, `outputColorSpace` SRGB, ACES via `configurePBRRenderer` (`js/gfx/lighting-rig.js`). Race presents through `PhotoRealPost` (`js/gfx/postfx.js`): full-res scene+depth → half-res SSAO → quarter-res bloom → grade/vignette composite. Title/menu often skip post RTs for responsiveness. Shadow maps use `autoUpdate = false` with cadence from the perf tier. CSS class `.saturn-canvas` / `js/gfx/saturn.js` are **shared procedural material/texture kits**, not a true low-res Saturn blit. `INTERNAL_WIDTH/HEIGHT` (1600×900) in `config.js` are **defined but unused** by the present path.

| | |
|---|---|
| **Strengths** | Clear race vs title present split; quality ladder; shadows decoupled from every physics tick |
| **Weaknesses** | Multi-pass race cost; dead internal-resolution constants; grade runs after ACES into RTs (tonemap order quirks) |
| **CPU** | Medium (orchestration, tier, stream) |
| **GPU** | **High** (scene + shadows + optional mirror + post) |
| **Memory** | Medium–High (DPR-scaled RTs) |
| **Visual impact** | Critical to “premium” look |
| **Gameplay impact** | Indirect — frame time and lock-30 cadence |
| **Modify risk** | **High** |

---

### 2. Three.js version

**Current implementation**  
Pinned vendored **r160**. No npm upgrade path.

| | |
|---|---|
| **Strengths** | Stable, known; loaders matched |
| **Weaknesses** | Behind current Three; color/API fixes and AgX etc. unused |
| **Costs** | Baseline (N/A as runtime cost) |
| **Visual / gameplay** | Indirect |
| **Modify risk** | **High** if bumping revision without a dedicated migration sprint |

---

### 3. Scene architecture

**Current implementation**  
One `THREE.Scene` with a **fixed light pool** from boot (hemi, sun+target, fill, sky rim, ambient, cave spot, **14 tunnel wall points**, title rim/kick, cabin fill). Lights are not added/removed at runtime (avoids shader recompiles). Race adds `track.group`, cars, sky dome, effects. Title uses a showcase world on the same scene with careful teardown. State machine: `title` → `menu` → `loading` → `countdown` → `race` / `paused` → `result`.

| | |
|---|---|
| **Strengths** | Stable light count; coherent race flow; track as one streamable group |
| **Weaknesses** | Monolithic `game.js` (~4816 lines); title/race share one scene |
| **CPU** | Medium |
| **GPU** | Dominated by world/cars, not graph depth |
| **Memory** | Medium (caches + world) |
| **Visual / gameplay** | High / High |
| **Modify risk** | **High** |

---

### 4. Vehicle physics / tire model / suspension

**Current implementation**  
Custom arcade sim in `js/physics/vehicle.js`, tunables in `HANDLING` / chassis (`js/config.js`). Simplified **Pacejka** + friction ellipse (`pacejka`, `combinedTire`), load sensitivity, camber thrust. Player tire **substeps = 4** inside 60 Hz steps; AI cheaper. Suspension: travel `wheelTravelMax: 0.14`, bump/rebound rates, anti-roll / load coupling (recent realism pass). Bicycle yaw blended with tire Mz; AM3 slide tools (handbrake, trail brake, gear-drift kick). Jump technique in `js/physics/jump.js`.

| | |
|---|---|
| **Strengths** | Surface-first AM3 intent; readable weight transfer; documented knobs |
| **Weaknesses** | Huge coupled parameter space; not multi-body; simplified Pacejka |
| **CPU** | Medium–High (player + up to **14** AI cars × substeps × road probes) |
| **GPU** | None (authority) |
| **Memory** | Low |
| **Visual impact** | Medium (stance, lean, travel) |
| **Gameplay impact** | **Critical** |
| **Modify risk** | **High** |

---

### 5. Surface system

**Current implementation**  
Seven surfaces in `SURFACES` (`tarmac` … `mud`): peak/slide µ, brake/slide holds, dust, sink, Pacejka coeffs. `js/physics/surfaces.js` blends axle L/R and front/rear. Track `query()` feeds surface ids into physics, dust, audio, and ribbon paint.

| | |
|---|---|
| **Strengths** | Core identity mechanic; visual+audio+feel aligned |
| **Weaknesses** | Some surfaces lack full Pacejka overrides; blend bags incomplete for some fields |
| **CPU** | Low–Medium |
| **GPU** | Low (material variants) |
| **Memory** | Low |
| **Visual / gameplay** | High / **Critical** |
| **Modify risk** | Medium |

---

### 6. Physics timestep / render loop

**Current implementation**  
`FIXED_DT = 1/60`, `MAX_SUBSTEPS = 3`. RAF `_loop` clamps `dt`, accumulates `_physAccum`, steps player + AI at fixed dt, then presents (optional skip for FPS lock via `GFX.lockRenderFps` / `preferLock30`). Perf tier samples **present interval**, not pure CPU `render()` cost.

| | |
|---|---|
| **Strengths** | Physics decoupled from present; hitch cap; honest FPS sampling path |
| **Weaknesses** | Max 3 phys steps drops sim time under long stalls; lock-30 changes feel |
| **CPU** | Medium when catching up |
| **GPU** | Only on present frames |
| **Memory** | Low |
| **Gameplay impact** | High |
| **Modify risk** | **High** |

---

### 7. Camera system

**Current implementation**  
`CAMERA` modes POV / medium / far with C-key blend. `_chaseCam`: yaw stiffness, slide→velocity blend, FOV punch, roll follow. POV from cockpit rig; rearview RT (`GFX.mirrorW×H`) with cadence. Occlusion fade + pack ghosting for chase readability (`occlusion-fade.js`).

| | |
|---|---|
| **Strengths** | Arcade-readable; POV/mirror polish; blend avoids hard cuts |
| **Weaknesses** | Many coupled constants; mirror is an extra scene draw |
| **CPU** | Medium |
| **GPU** | Medium (mirror) |
| **Memory** | Low |
| **Visual / gameplay** | High / High |
| **Modify risk** | Medium–High |

---

### 8. Lighting / shadows / materials / textures / IBL

**Current implementation**  
Per-stage `LIGHTING` applied via `applyStageLights` / tunnel follow / shadow frustum (`lighting-rig.js`). Sun: PCF soft, map size from tier (`GFX.shadowMap` base 1536). Materials: `pbr.js` MeshStandard/Physical (player clearcoat; AI cheaper). World roads/land use procedural canvas maps + PBR stacks in `track.js`. Sky: equirect HDR (`sky.js`, Poly Haven CC0) → `PMREMGenerator` (`_bakeSkyEnv`, `_skyEnvCache`, `pmremSize: 64`). Live CubeCamera reflections effectively off for race (`reflectEvery: 0`).

| | |
|---|---|
| **Strengths** | Stage identity; Kelvin sun; IBL cache; tunnel dim without light thrash |
| **Weaknesses** | Soft shadows expensive; soft PMREM; many always-present tunnel points; procedural map bake cost |
| **CPU** | High at bake / stage apply |
| **GPU** | **High** |
| **Memory** | Medium–High (HDR + PMREM + maps + shadow atlas) |
| **Visual impact** | Critical |
| **Gameplay impact** | Low–Medium (tunnel readability) |
| **Modify risk** | **High** |

---

### 9. Track generation

**Current implementation**  
Authored courses in `courses.js` (pieces: straight/curve/jump, surfaces, tunnels, landmarks). `Track` in `track.js` (~10811 lines): spline, ribbon mesh, corridor scrub, portals, checkpoints, async `buildAsync` with progress yields, streaming chunks (`CHUNK_LEN = 220`). Pace VO is **geometry-driven** (`pace-call.mjs`); authored `pace-notes.js` is archived/unused at runtime.

| | |
|---|---|
| **Strengths** | Strong stage authorship; streaming; progress UI; corridor scrub tooling |
| **Weaknesses** | Extreme monolith; opaque piece→world coupling; dead authored pace table debt |
| **CPU** | **High** at build; Medium at query |
| **GPU** | High (ribbon + portals + land) |
| **Memory** | High |
| **Visual / gameplay** | Critical / Critical |
| **Modify risk** | **Very high** |

---

### 10. Terrain generation / streaming / deform

**Current implementation**  
Heightmapped land tiles (`STREAM.terrainTileSize` 256, segs ~24–28). `_groundHeight` / `_biomeHeight` with trench/chaseFlat guards, tunnel mouth prisms, landmark washes. Aerial perspective vertex lerp. Soft-surface `WheelDeformField` + `WheelRutMesh` (`surface-deform.js`). Micro washboard/puddles (`road-micro.js`).

| | |
|---|---|
| **Strengths** | Explicit env-clip defenses; biome silhouette; deform batched uploads |
| **Weaknesses** | Coarse cells vs fine ribbon = perpetual clip class; deform maps can grow over long soft laps |
| **CPU** | High build + query |
| **GPU** | High fill |
| **Memory** | High |
| **Visual / gameplay** | Huge / plant & clip feel |
| **Modify risk** | **Very high** |

---

### 11. Vegetation / props / crowd / landmarks / backdrop

**Current implementation**  
`prop-kit.js` GLB kit; `trees.js` procedural/cards; `crowd.js` instanced gallery; backdrop rings + hero landmarks in `track.js`. Distance LOD via `STREAM.lodNear` and cards.

| | |
|---|---|
| **Strengths** | Stage kits; instancing; roadway keep-clear QA; recent far rings |
| **Weaknesses** | Instance/overdraw still a GPU lever; silhouette fidelity at far chase |
| **CPU** | Medium |
| **GPU** | High when dense |
| **Memory** | Medium–High (GLB cache) |
| **Visual / gameplay** | High immersion / low direct |
| **Modify risk** | Medium–High |

---

### 12. Particles / effects

**Current implementation**  
`Dust` (rear wake, shared pools), `TireMarks`, `ImpactSparks` in `effects.js`. Atmosphere from `LIGHTING`. Soft-surface ruts complement marks.

| | |
|---|---|
| **Strengths** | Surface-coloured wake; AI caps; skip idle GPU uploads |
| **Weaknesses** | Transparent overdraw; pack dust vs player wake competition |
| **CPU** | Medium |
| **GPU** | Medium–High (alpha) |
| **Memory** | Medium (pools) |
| **Visual / gameplay** | High feedback / High feel |
| **Modify risk** | Medium |

---

### 13. LOD / instancing / culling / occlusion

**Current implementation**  
Fog-tied stream load/unload; chunk visibility; tree GLB→card LOD; rival shadow far cull; heavy `InstancedMesh` usage; cam→car occlusion discard; pack opacity ghosting.

| | |
|---|---|
| **Strengths** | Real streaming; GPU savings when healthy |
| **Weaknesses** | Pop risk if fog/stream misaligned; discard shimmer |
| **CPU** | Medium (stream update) |
| **GPU** | Savings High when working |
| **Memory** | Medium until unload |
| **Visual / gameplay** | High / Medium |
| **Modify risk** | **High** |

---

### 14. GLB loading / asset caching

**Current implementation**  
`GLTFLoader` in `celica.js`: hero URLs + `rival.glb` LOD templates; body panel merge; title uses LOD-first; race promotes hero. Props: in-memory kit + `KIT_ASSET_V`. Sky HDR texture cache. Browser HTTP cache used (not `no-store`). Module graph `?v=` for code.

| | |
|---|---|
| **Strengths** | LOD vs hero split; warm paths; panel merge |
| **Weaknesses** | Large Sketchfab assets; parse hitch; dual version strings (kit vs boot); templates live process-lifetime |
| **CPU** | **High** on parse |
| **GPU / Memory** | High for hero meshes/textures |
| **Visual / gameplay** | High / load time |
| **Modify risk** | Medium |

---

### 15. Mobile rendering / perf tiers

**Current implementation**  
`createPerfTier` (`perf-tier.js`): `high|medium|low|min` — DPR, shadow size, post, mirror/shadow cadence; optional **lock present to 30 Hz** (`GFX.preferLock30`). `GFX.lockRaceQuality: true` avoids mid-race visual downgrade. Phones: start lower tier + DPR scale; touch overlay.

| | |
|---|---|
| **Strengths** | Single quality owner; prefer clean 30 over judder |
| **Weaknesses** | Locked quality can leave phones heavy once settled; absolute 60 still open |
| **CPU** | Policy overhead Low |
| **GPU** | Still Medium–High at medium+ |
| **Memory** | Scales with DPR/RTs |
| **Visual / gameplay** | High / High (cadence feel) |
| **Modify risk** | Medium–High |

---

### 16. Memory management

**Current implementation**  
Track `dispose()` walks geos/maps/mats (skips `userData.shared`). Saturn shared caches. Track preload cache with eviction helpers. Post/shadow RT dispose on resize. Car templates generally retained for session.

| | |
|---|---|
| **Strengths** | Explicit stage dispose; shared art tagged |
| **Weaknesses** | Long championship sessions can retain GLB templates; non-shared map leak risk |
| **CPU** | Low (dispose spikes) |
| **GPU** | N/A |
| **Memory** | Medium–High over long play |
| **Visual / gameplay** | Low unless hitch/OOM |
| **Modify risk** | Medium |

---

### 17. AI

**Current implementation**  
`js/ai.js` `Opponent`: lane slots, look-ahead, corner speed, deterministic wander, rubber band / respect, `Vehicle` with `lowDetail`. Pack size `CHAMPIONSHIP.opponents: 14`. Collide glance + pack see-through elsewhere.

| | |
|---|---|
| **Strengths** | Beatable, deterministic, surface-aware; failure isolation |
| **Weaknesses** | 14 cars × physics is a major CPU cost; rubber band can feel soft |
| **CPU** | **High** |
| **GPU** | Medium (meshes/shadows) |
| **Memory** | Medium |
| **Visual / gameplay** | Pack spectacle / championship challenge |
| **Modify risk** | Medium–High |

---

### 18. Audio

**Current implementation**  
`RallyAudio` + mixer buses (music/SFX/nav), powertrain voice, skid beds, codriver grade clips, stage beds, reverb zones, crowd bed, sample bank. Nav bus isolated from SFX duck.

| | |
|---|---|
| **Strengths** | Surface beds; unlock safety; co-driver without TTS on race path |
| **Weaknesses** | Decode cost at unlock; procedural IR ≠ measured spaces; VO coverage limited |
| **CPU** | Medium (decode + graph) |
| **GPU** | N/A |
| **Memory** | Medium (buffers; music is large on disk) |
| **Visual** | N/A (aural) |
| **Gameplay** | High feel |
| **Modify risk** | Medium |

---

### 19. UI / HUD / transitions

**Current implementation**  
DOM screens in `index.html` + `hud.js`. Curtain fades (`#fx-curtain`) serialize menu/load/HUD swaps. Loading progress lerp + settle. Touch overlay + optional tilt.

| | |
|---|---|
| **Strengths** | Soft fades; loading settle; chase vs POV gauge split |
| **Weaknesses** | Some HUD paths historically frame-coupled; mobile chrome complexity |
| **CPU / GPU / Memory** | Low–Medium / Low / Low |
| **Visual / gameplay** | Readability / Critical UX |
| **Modify risk** | Medium |

---

### 20. Input

**Current implementation**  
`Input.poll`: keys, gamepad, edges, touch bind, finite clamps, blur release. Digital steer without stacked lag filters (by design).

| | |
|---|---|
| **Strengths** | Hardened; pad/keyboard clear; QA hold path |
| **Weaknesses** | Tilt quality device-dependent; feel couples to present cadence |
| **Costs** | Negligible |
| **Gameplay** | Critical |
| **Modify risk** | Medium (easy to reintroduce lag) |

---

### 21. Championship / ghost / telemetry

**Current implementation**  
Modes + stage clocks + checkpoint bonus in `CHAMPIONSHIP`. Grid carry / next-stage preload. Ghost recorder/player @ ~10 Hz → `localStorage` (`telemetry/ghost.js`). Live QA hooks in `telemetry/live-qa.js`.

| | |
|---|---|
| **Strengths** | Machine championship gates; ghost keyed by course+car |
| **Weaknesses** | Entangled in `game.js`; ghost local-only; full human cup still the bar |
| **CPU** | Low (ghost) / High (full pack race) |
| **Modify risk** | High inside `game.js` |

---

### 22. QA / process

**Current implementation**  
Large Node+CDP matrix; `qa-static-audit`, boot smoke, frame probe, stage/tunnel/championship probes. Agent hosts often cannot run Chrome without explicit allow.

| | |
|---|---|
| **Strengths** | Unusual depth for a browser game; prevents silent regressions |
| **Weaknesses** | False confidence if headed probes skipped; docs PARTIAL vs “Done” drift needs discipline |
| **Modify risk** | Ops — keep gates when changing hot paths |

---

## Priority backlog (player-professional bar)

### CRITICAL PROBLEMS

Problems that currently prevent the game from consistently feeling professional.

1. **Absolute 60 fps still open (honest PARTIAL)**  
   - **Evidence:** QA-REPORT Sprint 76/96 continuity; headed M1 probes historically ~28–37 ms at full/min paths; `preferLock30` is the safety floor.  
   - **Player moment:** Championship Desert pack hitch or judder; or a clean-but-soft 30 Hz cadence that reads “not premium” on 120 Hz displays.  
   - **Do not “fix” by silently claiming 60.**

2. **Cold stage-build wedge**  
   - **Evidence:** Explicitly called out as untouched in Sprint 76/96 closeout; `Track.buildAsync` is heavy; `qa-stage-build-time.mjs` exists.  
   - **Player moment:** Long loading / main-thread freezes before first 3-2-1, especially Desert cold.

3. **Road ↔ terrain ↔ tunnel ↔ jump coupling (regression class)**  
   - **Evidence:** Repeated ship-blockers across Sprints 38–92 and v585/v594; tools `qa-env-clip`, `qa-desert-tunnel-mouth`, jump probes. Many marked Done, **still high-risk**.  
   - **Player moment:** Sand through asphalt, floating portal lips, under-road plant, jump-3 teleport — instantly unprofessional when it recurs.

4. **Monolithic hot paths**  
   - **Evidence:** `track.js` ~10.8k LOC, `game.js` ~4.8k, `celica.js` ~5.1k, `vehicle.js` ~4.0k.  
   - **Player impact:** Indirect but real — every “small” fix has blast radius; review/QA cost stays high; Pages/local drift is easy.

---

### HIGH PRIORITY

Significantly affect quality; should be next after CRITICAL if approved.

1. **Lighting / present continuity** (title → load → countdown → GO) — human-watch debt remains even after settle work.  
2. **Pack GPU/CPU cost** — 14 AI + shadows + dust + instances vs mobile/M1 budget.  
3. **Draw-call / overdraw levers** — instance density, stream `castShadow` cull, particle alpha (named next levers in QA after scaler knobs).  
4. **Hero GLB parse hitch** (~7 MB Celica) vs title LOD discipline — race promotion still expensive.  
5. **Surface contrast / mud–gravel teaching moments** — identity is good; consistency across all four stages still needs human sign-off.  
6. **Public Pages vs local version drift** — live URL may not include latest tunnel/sky/fade work until merged.

---

### MEDIUM PRIORITY

Important, non-blocking if CRITICAL/HIGH are owned.

1. Unify / delete dead config (`INTERNAL_WIDTH/HEIGHT`, unused volumetric sky leftovers, archived pace notes).  
2. Stronger lakeside/forest sky identity already improved locally — verify on Pages + all stages.  
3. Memory: long-session track/car template eviction policy.  
4. Cobble / incomplete Pacejka field blends.  
5. Ghost is local-only (fine for v1; not a online product).  
6. Three.js r160 upgrade evaluation (dedicated sprint only).  
7. Audio IR quality / more co-driver coverage (content, not graph rewrite).

---

### LOW PRIORITY

Polish.

1. Far crowd silhouette fidelity.  
2. Mountain crowd absence (intentional gap).  
3. Title rock / pad micro-art.  
4. HUD chrome density on mobile.  
5. Attribution / doc housekeeping.  
6. Optional AgX / newer tonemap after Three upgrade.  
7. Remove misleading “Saturn framebuffer” naming if it confuses new contributors.

---

## Recommended approval gates (before any implementation)

When you approve work, pick **one vertical** per sprint and require proof:

| If approving… | Required proof |
|---|---|
| Perf / 60 | Headed `qa-frame-probe` with `RALLY_QA_ALLOW_CHROME=1` + honest FPS writeup |
| Stage build | `qa-stage-build-time` + loading bar human check |
| Env / tunnel / jump | Matching `qa-desert-*` / tunnel / jump tools + 2-minute human drive |
| Handling | AM3 surface checklist + no stealth retune of unrelated knobs |
| Visual only | Screenshots / short drive; no physics churn |

**Default refusal:** rewrite of `track.js`, `vehicle.js`, or renderer “from scratch”; WebGPU migration; Three major bump without a migration plan.

---

## Suggested next-sprint options (awaiting approval)

Ranked for player value vs risk. **Do not start until approved.**

1. **Perf honesty sprint** — measure current `?v=` on target hardware; cut draw/overdraw (not fidelity tier collapse); document 60 vs clean-30.  
2. **Stage-build wedge** — profile `Track.create` hotspots; yield/cache more; never skip settle.  
3. **Env-clip hardening pass** on Desert teaching path only (tunnel + jump 3 + mud exit) with regression tools.  
4. **Pages sync** — ship local `main` so the live URL matches the audited tree.

---

## Appendix A — Primary file map

| Area | Primary files |
|---|---|
| Boot / loop | `index.html`, `js/main.js`, `js/game.js` |
| Config | `js/config.js` |
| Physics | `js/physics/vehicle.js`, `surfaces.js`, `jump.js`, `collide.js` |
| Track / world | `js/tracks/track.js`, `courses.js`, `surface-deform.js`, `prop-kit.js`, `trees.js`, `crowd.js` |
| Cars | `js/cars/celica.js`, `cockpit-anim.js` |
| GFX | `js/gfx/postfx.js`, `lighting-rig.js`, `pbr.js`, `perf-tier.js`, `occlusion-fade.js`, `saturn.js` |
| Sky | `js/sky.js`, `assets/sky/*` |
| Effects | `js/effects.js` |
| AI | `js/ai.js` |
| Audio | `js/audio/*` |
| UI / input | `js/ui/hud.js`, `touch-controls.js`, `js/input.js` |
| Telemetry | `js/telemetry/ghost.js`, `live-qa.js` |
| Intent / QA | `docs/AM3-RESEARCH.md`, `docs/QA-REPORT.md`, `docs/QA-CHECKLIST.md`, `tools/qa-*.mjs` |

---

## Appendix B — Cost heatmap (at-a-glance)

| System | CPU | GPU | Memory | Modify risk |
|---|---|---|---|---|
| Track build / terrain | High | High | High | Very high |
| Race present + shadows + post | Medium | High | Med–High | High |
| Vehicle + 14 AI | High | Medium | Medium | High |
| Props / crowd / instances | Medium | High | Med–High | Med–High |
| Particles | Medium | Med–High | Medium | Medium |
| GLB parse | High (load) | High (hero) | High | Medium |
| Audio | Medium | — | Medium | Medium |
| UI / input | Low | Low | Low | Medium |
| Perf tier policy | Low | (saves) | (saves) | Med–High |

---

## Appendix C — What this audit deliberately did not do

- Did not change gameplay, rendering, assets, or cache-bust versions for features.  
- Did not rewrite systems.  
- Did not claim the live Pages build equals local `?v=598` without a deploy check.  
- Did not re-run headed frame probes in this pass (Chrome often blocked in agent hosts); perf PARTIAL status is taken from `docs/QA-REPORT.md` + code policy (`preferLock30`, `lockRaceQuality`).

---

**Status:** Audit complete. Awaiting approval before any implementation.
