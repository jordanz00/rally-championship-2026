# QA report — quality-control pass

## Hotfix — medium cam locks behind car (2026-09-05)

**Player report:** medium still falls farther behind on accel; want start-grid distance locked behind the rear, no L/R sway — real racing locked chase.

**Cause:** spring chase lagged on throttle (felt like growing `back`); yaw lag + road-look blend still orbit/swing.

**Shipped:** medium `lockPos` hard-snaps to fixed rear offset; chassis yaw instant; zero speed drop/look stretch/road blend/pitch bias/air-back.

**Boot:** `main.js?v=665` · `config.js?v=208` · `game.js?v=665`

---
## Hotfix — medium cam stable behind car (2026-09-04)

**Player report:** medium default should stay stable behind the car; no swinging out when drifting; no L/R sway.

**Cause:** slide yaw blend toward velocity, slide look, outside cam offset, lateral kick, and soft yaw stiffness orbited the lens during power slides.

**Shipped:** medium `stableBehind` — zero slide yaw/look/out/kick/roll; firm chassis yaw follow; no lateral shake/kick apply.

**Boot:** `main.js?v=664` · `config.js?v=207` · `game.js?v=664`

---
## Hotfix — tunnel walls look bad + car clips through (2026-09-04)

**Player report:** tunnel walls look bad; car clips through walls when hitting them inside the tunnel.

**Cause:** (1) thin Z-stretched horseshoe rings with low-res striation read as cardboard seams; (2) wall slabs were sparse/misaligned vs the lining; (3) `bounceOffRoad` allowed ~7 m soft runoff inside tunnels so a missed wall slab let the chassis drive into rock.

**Shipped:** thick bore lining segments + rib bands + higher-res groove map; wall faces densified and aligned to lining inset (0.42 m); firmer wall push + more penetration passes; hard bore lateral clamp (no soft runoff through rock).

**Boot:** `main.js?v=663` · `track.js?v=300` · `collide.js?v=48`

---
## Hotfix — race hangs / lags on M1 Pro (2026-09-04)

**Player report:** hangs and lags often even on M1 Pro; want stable frame rate without downgrading graphics.

**Cause:** (1) mid-race `Track.create` for next championship stage stole the main thread; (2) stream slices first-compiled at race speed; (3) soft-scale `setSize` mid-corner; (4) shadow atlas forced every present while cars moved; (5) per-frame `Set` / object allocs in stream + mirror + crowd audio.

**Shipped:** block next-stage builds during live race (result/loading own warmup); `prewarmAlongCourse` + settle compile drain under load overlay; countdown skip-frames drain into scratch RT; pin softScaleMin at 1 (no mid-race resize); soft-PCF shadowEvery 2 (same map size); reuse prefetch Set + mirror clear + crowd audio bags; longer stream lookahead.

**Boot:** `main.js?v=662` · `game.js?v=662` · `track.js?v=299` · `config.js?v=206` · `perf-tier.js?v=51`

---
## Hotfix — blue flash ×3 at stage start (2026-09-04)

**Player report:** beginning each stage flashes blue three times.

**Cause:** 3-2-1 beep hitches skipped presents; stream `renderer.compile` cleared the on-screen framebuffer to sky-blue; `#game-view` CSS was also `#4a7ab8`. Mirror capture left a blue clearColor sticky.

**Shipped:** skip stream compile during countdown/freeze; compile into a 4×4 scratch RT; restore mirror clearColor; dark `#game-view` / `#crt` fallbacks (title keeps blue).

**Boot:** `main.js?v=660` · `css/game.css?v=44` · `track.js?v=298`

---
## Hotfix — realistic biped audience (2026-09-04)

**Player report:** disliked audience members; want bipedal, somewhat realistic basic humans.

**Cause:** Prior crowd GLBs were capsule/sphere mannequins with flat color swatches and unused face strip — read as abstract dolls.

**Shipped:** regenerated `crowd_atlas.png` (skin gradients, fabric weave, face panels); rebuilt all 12 `character-*.glb` with tapered limbs, head/jaw/nose/ears/hair/shoes + cheer arms; kit asset `?v=18`.

**Boot:** `main.js?v=658` · `prop-kit.js?v=32` · `crowd.js?v=22` · `track.js?v=296`

---
## Hotfix — medium chase L/R sway (2026-09-04)

**Player report:** default medium camera sways left/right too much; car should stay mostly centered; want smoother motion.

**Cause:** Stiff XZ spring (78) with softer look spring (36) lagged framing; slide yaw/look blend + outside offset + lateral kick whipped the lens off-center.

**Shipped:** medium matched springs (pos 52 / look 48); softer yaw (14); cut slideCamOut / slideLook / slideYawBlend / kick; milder global chase sway dials. Per-view overrides wired in `_chaseCam` / `_feelPad`.

**Boot:** `main.js?v=656` · `config.js?v=205`

---
## Hotfix — tire contact while drifting (2026-09-04)

**Player report:** player tires floated above the roadway, especially in a drift.

**Cause:** Body roll rotates about the contact origin and lifts the high-side hubs; wheel travel only followed road height, so lean left rubber in the air. Hover cap also allowed ~2 cm of chassis float.

**Shipped:** `applyWheelPose` subtracts `x·tan(roll)` so tread stays on the deck under lean; tire plant sink 4 cm; `TIRE_PLANT` 4.5 cm; `GROUND_HOVER_MAX` 8 mm.

**Boot:** `main.js?v=655` · `celica.js?v=162` · `vehicle.js?v=135`

---
## Hotfix — shoulder clip while sliding off (2026-09-04)

**Player report:** sliding off the asphalt clipped the car *through* the shoulder mesh.

**Cause:** Prior off-road plant blended asphalt → `_groundHeight` (roadY − biome drop). Visual skirts often stay near the kerb (`edgeY − 0.38` when reach &lt; collider clear), so physics sat under the skirt tris.

**Shipped:** `Track._shoulderPlantHeight` mirrors skirt reach / `skirtDrop` / 0.38 slope; `query` plants on that ramp until past the skirt, then land.

**Boot:** `main.js?v=654` · `track.js?v=294`

---
## Hotfix — off-road plant + road shoulders (2026-09-04)

**Player report:** leaving the asphalt left the car floating above a lower verge.

**Cause:** `Track.query` always returned ribbon deck height off-road; `_solidFloorAt` treated halfWidth+11 m as “on road” and snapped Y back up. Visual skirts were capped shallow on forest/mountain.

**Shipped:** off-road query blends asphalt→`_groundHeight` across a shoulder band; solid floor uses query under the car; skirts lengthen with land drop so deep verges get a driveable ramp.

**Boot:** `main.js?v=650` · `qa-validate` PASS · `qa-world-geometry` GREEN

---
## Hotfix — tire plant + soft-road ruts (2026-09-04)

**Player report:** wheels float above the road; soft surfaces need visible trails and 3D deformation.

**Cause:** plant used full wheel-hub bbox (rim/scrap below tread) → rubber hovered; soft marks stamped height-field/rut mesh only and gated at higher speeds.

**Shipped:** plant on tire rubber + 2.8 cm sink · `TIRE_PLANT` 4 cm · tighter hover cap · deeper soft ruts · soft dusty mark quads + 3D trenches from a crawl.

**Boot:** `main.js?v=647`

---
## Hotfix — medium distance + POV C-key hitch (2026-09-04)

**Player report:** medium chase drifts too far back under accel; POV switch lags/hangs.

**Cause:** (1) speed FOV punch + spring lag made medium feel yards farther than start-grid framing; (2) C-key toggled roof-clip materials / localClipping (shader recompile) and used a long POV blend.

**Shipped:** medium `speedFovScale` 0.08 · `speedLookAheadScale` 0.2 · stiffer follow + `accelFollowBoost`; POV blend ~0.32s · early seat · clip plane parks without stripping materials; C no longer sync-compiles.

**Boot:** `main.js?v=646` · `qa-sprint70-camera` PASS

---
## Pack place punch — overtake feedback (2026-09-04)

**Player moment:** Pass a rival in championship — the ordinal no longer ticks silently; `2ND!` (etc.) flashes, a soft chirp plays, and `#hud-pos` punches. Getting passed only punches the glyph (no nag banner).

**Before:** Pack battles felt flat after Boot hid SLIDE/GRIP telemetry. Also: commit `f0e5283` had already added `game.js` `_pulsePlaceChange` imports for `RACE_FEEDBACK` / `placeOrdinal` without matching module exports — module-load boot break.

**After:**
- `RACE_FEEDBACK` in `config.js` — `placeArmSec` 2.4 (ignore grid launch shuffle), `placeCooldownSec` 1.05, gain flash + chirp.
- `game.js` `_pulsePlaceChange` · `hud.punchPlace` + `placeOrdinal` · `audio.placeGain`.
- CSS `placeGainPunch` / `placeDropPunch` (respects `prefers-reduced-motion`).

**Files:** `js/config.js`, `js/game.js`, `js/ui/hud.js`, `js/audio/engine.js`, `css/game.css`, `index.html`, importers’ `?v=`

**QA:** `qa-static-audit` PASS · `qa-validate` PASS · `qa-sprint33-drift` PASS · Cursor headed Chrome boot-smoke **not asserted** (host SIGABRT)

**Boot:** `main.js?v=645` · `config.js?v=203` · `hud.js?v=37` · `engine.js?v=68` · `game.css?v=42`

**Frozen / not this ship:** Driver gate A human SHIP/CUT, camera-mass Call #2, Desert vertical slice, track.js Red hang, restoring pace/SLIDE HUD.

---

## SHIP 1 — Arcade First Boot (2026-09-04)

**Player moment:** Title → START → Celica → Desert → 3-2-1-GO without garage/GLB/FPS/dev chrome blocking the first minute.

**Before:** Title showed “Garage — drop a GLB”; START opened SELECT MODE (mode/car/course wall); race HUD exposed FPS, DIST, SURFACE, GRIP, SLIDE; PHYS LAB on course list.

**After:**
- Garage + PHYS LAB behind `?dev=1` / `?debug=1` / `localStorage rally-debug=1` (`html.is-dev` + `.dev-only`).
- START defaults championship → SELECT CAR; Celica pick starts Desert. MODES opens Championship / Time Attack / Practice / Controls.
- Race chrome prioritizes TIME · POSITION · SPEED · STAGE TIME; FPS/DIST/SURFACE/GRIP/SLIDE debug-only.
- Fantasy car/course button copy (no stats screens).

**Files:** `index.html`, `css/game.css`, `js/game.js`, `js/ui/hud.js`, `js/main.js`, `tools/qa-boot-smoke.mjs`

**QA:** `qa-static-audit` PASS · `qa-validate` PASS · boot-smoke path updated (Chrome not required this pass)

**Boot:** `main.js?v=643` · `css/game.css?v=40` · `hud.js?v=35`

**Frozen / not this ship:** Desert vertical slice, deep race-feedback HUD, Driver gate A human SHIP/CUT, camera-mass Call #2, track.js Red hang.

---

## Executive gate — Driver / Spectator / Accountant (2026-09-04)

**Mission:** Three-part validation only. No feature expansion. Maximize first-10-minute confidence.

| Test | Result | Evidence |
|---|---|---|
| **A — Driver** (grip → slide → catch → accel) | **PASS (SHIP)** | Human CEO SHIP 2026-09-04 · machine `qa-am3-handling` PASS · CEO #1 dial bake retained |
| **B — Spectator** (car has weight without being told) | **UNKNOWN** | Chase springs + contact blobs + land kick present · camera-mass Call #2 **unpaused for human score** · no headed spectator probe yet |
| **C — Accountant** (no frame debt / no duplicate authority / QA stable) | **PASS** | `qa-static-audit` · `qa-validate` PASS · worldvalidate GREEN · no new authority this close |

**Open debt (not closable Green without human or Red):**
- Stale Sprint 89 table still says Jump-3 **PARTIAL** — superseded by Sprints 90–98 (doc lie, not live defect).
- Stage-build wedge (Sprint 76 #2) intermittent headed hang — **Red** (`track.js`); refuse this session.
- Absolute 60 fps claim still open — reliability, not a feel gate FAIL.

**Intervention:** none (no FAIL to fix; UNKNOWN ≠ invent busywork).

**Decision:** Gate **A SHIP** (human 2026-09-04). **Defer full GREEN LIGHT** until CEO scores **B**. Boot pin local `main.js?v=652`.

**System map (brief):** Exceptional — none claimed without human. Strong — Vehicle/AM3 handling stack, TrackDefinition+worldvalidate, QualityManager/lock-30, championship progression. Acceptable — hero clearcoat+dirt, dust/marks, chase/POV, stage identity V3–V5. Weak — absolute 60 fps claim, intermittent stage-build wedge (Red). Broken — none proven live P0 this session (Sprint 89 Jump-3 PARTIAL is stale doc).

**Human release instrument (Terminal.app, hard-refresh `?v=641`):**
1. **A:** Phys Lab / F8 — induce slide → opposite-lock catch → throttle; then Desert bowl same sequence.
2. **B:** Watch chase (no HUD coaching) — braking pitch, slide yaw follow, land compression readable?
3. **C:** Note hitch / judder only; if frame collapses, FAIL C and stop feature spend.

If A+B+C all PASS → authorize Next Three (AI surface skill → PerformanceDirector → one V6 signature) as **plan-only**. If either A or B FAIL → one Cursor-contract feel/camera fix before any depth.

---

## CEO #1 — Physics Lab feel: catch window + land plant (2026-09-04)

**Player moment:** Fast corner → brief slip → opposite-lock catch → jump → planted landing.

**Change:** Config-only dial bake (`js/config.js?v=201`). No new assist layer. No camera mass (#2). No `track.js` / WebGPU.

| Dial | Before → After |
|---|---|
| `ARCADE_ASSIST.recoveryAssist` | 0.72 → **0.76** |
| `recoverableSlide` | 12.0 → **12.5** |
| `driftStability` | 0.42 → **0.48** |
| `landingAssist` | 0.45 → **0.55** |
| `tireSlideSoft` | 2.25 → **2.4** |
| `tirePeakBoost` | 1.05 → **1.08** |
| `HANDLING.expertCounterMul` | 1.62 → **1.74** |
| `limitMush` | 0.52 → **0.58** |
| `slideExitBoost` / `slideExitAngle` | 1.38 / 0.14 → **1.46 / 0.12** |
| `suspBumpRate` / `suspReboundRate` | 52 / 38 → **58 / 42** |
| `JUMP.landVelAbsorb` | 0.86 → **0.90** |
| `landSettleMin` / `Max` | 0.14 / 0.38 → **0.12 / 0.30** |
| `landCompressWn` / `Zeta` | 24 / 0.95 → **28 / 0.98** |
| `landCompressGain` / `ExtMin` | 0.09 / −0.014 → **0.105 / −0.008** |
| `landImpactSquash` | 0.02 → **0.028** |
| `landSettleDamp` / `End` | 5.4 / 11.5 → **7.0 / 14.5** |
| gravel / dirt `gripSnap` | 1.22 / 1.24 → **1.34 / 1.36** |

**QA:** `qa-am3-handling` PASS · `qa-jump-feel` PASS · `qa-sprint33-drift` PASS · `qa-static-audit` PASS · `qa-validate` PASS · `qa-jump-variability` PASS · `qa-land-sfx` PASS

**Boot:** `main.js?v=641` · `config.js?v=201`

**Human drive (CEO acceptance — required):**
1. `http://127.0.0.1:8765/index.html?physlab=1` (or Practice → PHYS LAB / F8)
2. Hairpin → gravel catch → jump → land plant on Lab loop
3. 2-min Desert Act bowl: trail-brake → hold → opposite lock → crest land
4. SHIP only if catch feels like a switch and land wants the next jump

**Verdict:** **SHIP** (human CEO 2026-09-04). Catch/land dial bake retained. Do not revert `config.js` CEO #1 dials without a new CUT. Next gate: Spectator **B**.

---

## Hotfix — camera medium + POV blend (2026-09-04)

**Player report:** medium too far/high · POV switch hangs/stutters · want slow smooth ease.

**Cause:** `_warmPov` skipped cabin compile unless already in POV — first C→POV compiled mid-blend.

**Shipped:** medium closer/lower (`back` 4.55, `height` 1.42); blend 0.58s / POV 0.72s; always warm cabin at load; seat cabin late (`povSeatEase` 0.7); no mid-blend mirror RT alloc.

**Boot:** `main.js?v=636` · `qa-sprint70-camera` PASS

---

## Hotfix — grounded car + shadow sync (2026-09-04)

**Player report:** springy/bouncy car · contact/sun shadow lagging · float above road · rivals same.

**Shipped:** `wheelTravelVisual` 1.52→1.05 + travel cap; firmer rebound; less road chatter; snappier plant; contact blobs snap when grounded; sun shadow bake every present while cars move (`shadowEvery` 1 on high/medium); land spring more overdamped; soft-scale floor 0.88. Pack uses same travel cap.

**Boot:** `main.js?v=635`

---

## Sprint — CTO ship set (gameplay + V6 air + perf) (2026-09-04)

**Charter:** Parallel specialist proposals → [CTO approval](543d9a6d-e305-4d93-bbd2-bbd9266ff5a2) → implement 6 items only.

| # | Item | Lane |
|---|---|---|
| 1 | Nature `castShadow` cull (`STREAM.natureShadowFar` / scrub) | Perf |
| 2 | Soft QualityManager render-scale under `lockRaceQuality` | Perf |
| 3 | Tier-scaled `lodNear` + `VISUAL.veg` via `armVegBudget` | Perf |
| 4 | Catch-window `ARCADE_ASSIST` bake + Lab “Catch Window” dial | Gameplay |
| 5 | Camera mass punch (`brakePitchMul` / `landKickScale`) | Gameplay |
| 6 | Depth haze stage curves (`VISUAL.aerialByScenery`) | Graphics V6 |

**Deferred:** AI hairpin flicks · tunnel exit cinema · sun shafts · trail-brake gate · exit surge

| Check | Result |
|---|---|
| `qa-validate` / `qa-static-audit` / `qa-world-geometry` / `qa-am3-handling` / `qa-sprint70-camera` | PASS |
| Headed worldvalidate | run after boot (Forest recommended) |

**Boot:** `main.js?v=634` · `track.js?v=289` · `config.js?v=198`

---

## Sprint — Visual Pass V5 vegetation (2026-09-04)

**Goal:** Density · ecological clusters · pack-card far LOD · instancing (not V6 lighting).

| Check | Result |
|---|---|
| `node tools/qa-validate.mjs` | PASS |
| `node tools/qa-static-audit.mjs` | PASS |
| `node tools/qa-am3-handling.mjs` | PASS |
| `node tools/qa-world-geometry.mjs` | PASS |
| Headed Forest `?worldvalidate=1` | **GREEN** (float/bury 0) |
| Headed Desert `?worldvalidate=1` | **GREEN** (float/bury 0) |
| Headed Mountain `?worldvalidate=1` | **GREEN** (float/bury 0 · tunnels=1) |

**Shipped:** `forestCardForTree` → far LOD + HD backdrop use pack atlas cards; `_treePackCardPoses`; forest/mountain micro-clusters (4–9 m siblings); desert cactus clumps; `VISUAL.veg` density table; anti-clone pack palette; `STREAM.lodNear` 148. Clearance / trench / mouth untouched.

**Boot:** `main.js?v=632` · `track.js?v=288` · `config.js?v=197` · `prop-kit.js?v=30`

**Must not:** V6 lighting · WebGPU · track rewrite · loosening float/bury tols.

---

## Sprint — Visual Pass V4 terrain (2026-09-04)

**Goal:** Believable mid/far landforms + materials; keep road–terrain conformity GREEN.

| Check | Result |
|---|---|
| `node tools/qa-validate.mjs` | PASS |
| `node tools/qa-static-audit.mjs` | PASS |
| `node tools/qa-am3-handling.mjs` | PASS |
| `node tools/qa-world-geometry.mjs` | PASS |
| Headed Desert `?worldvalidate=1` | **GREEN** (land normalScale 1.85) |
| Headed Mountain `?worldvalidate=1` | **GREEN** (land normalScale 1.45) |

**Shipped:** far mound/spine/mass/knoll amp; desert windward/lee; mountain mid-rise + biome fold; lakeside shore lip; `landMapTiles` span/15; per-scenery land normals; crest/scree tint; roughness wet/rock flecks. Trench / mouth / overlapBed contracts untouched.

**Boot:** `main.js?v=631` · `track.js?v=287`

**Must not:** V5 veg · WebGPU · track rewrite · loosening float/bury tols.

---

## Sprint — Visual Pass V3 road (2026-09-04)

**Goal:** Macro/medium/micro road read · shoulders · surface identity (not V4 terrain).

| Check | Result |
|---|---|
| `node tools/qa-validate.mjs` | PASS |
| `node tools/qa-static-audit.mjs` | PASS |
| `node tools/qa-am3-handling.mjs` | PASS |
| `node tools/qa-world-geometry.mjs` | PASS |
| Headed Desert `?worldvalidate=1` | **GREEN** |
| Road mats | albedo + normal + roughnessMap; sand/gravel roughness 0.90 / 0.76 |
| Skirt | grain map + normal + UVs (DoubleSide apron) |

**Shipped:** `paintSurface` / `paintEdgeErosion`; `paintSkirtGrain` + `worldSkirtMaterial(map)`; shoulder/ribbon tint contrast; `road-micro` soft amp + gravel corrugation; `ROAD_ROUGH` spread. Cache `main.js?v=630` · `track.js?v=286`.

**Must not:** track rewrite · WebGPU · V4+ without “Begin Visual Pass V4”.

---

## Sprint — Visual Pass V2 hero car (2026-09-04)

**Goal:** Player car clearcoat lacquer + cheap dirt + readable suspension (not V3 road).

| Check | Result |
|---|---|
| `node tools/qa-validate.mjs` | PASS |
| `node tools/qa-static-audit.mjs` | PASS |
| `node tools/qa-am3-handling.mjs` | PASS |
| `node tools/qa-world-geometry.mjs` | PASS |
| Headed Desert `?worldvalidate=1` | **GREEN** (Celica race path) |
| Clearcoat probe | Celica / Delta / Stratos `createPlayerCar` → MeshPhysical paint (cc=1) |
| Dirt | `js/cars/car-dirt.js` bound after race IBL; soils on mud/sand/dirt; washes on tarmac |

**Shipped:** `dressPlayerCarRace` (safe Standard→Physical, paint-name + Stratos `wire_*` CAD body); `car-dirt.js`; `HANDLING.wheelTravelVisual` 1.52; cache `main.js?v=628` / `celica.js?v=156`.

**Must not:** WebGPU cutover · track rewrite · V3+ without “Begin Visual Pass V3”.

**Boot smoke:** SKIP under Cursor (Chrome.app blocked) — static gates + headed IDE browser used.

---

## Sprint — Quality gates (2026-09-04)

**Goal:** Production pipeline so bad geometry is hard to ship — not repair-after-drive.

| Check | Result |
|---|---|
| `node tools/qa-validate.mjs` | PASS (Desert/Forest/Mountain/Lakeside data + static audit) |
| `node tools/qa-world-geometry.mjs` | PASS |

**Shipped:** `docs/QUALITY_STANDARD.md`, `js/tracks/world-config.js`, `stage-data-validate.js`, `segment-kinds.js`, `tools/qa-validate.mjs`, fail-fast Mountain compile gate, centralized tolerances.

**Milestones still open:** screenshot golden frames, measured StagePerformanceProfile, full visual debug overlay set, Desert/Forest/Lakeside TrackDefinition migration.

---

## Sprint — TrackDefinition / Mountain showcase (2026-09-04)

**Goal:** Stop random env asset churn; build authored stage architecture; Mountain as showcase.

| Check | Result |
|---|---|
| `node tools/qa-world-geometry.mjs` | PASS |
| `node tools/qa-static-audit.mjs` | PASS |
| In-game Mountain + `?worldvalidate=1` | **Human / headed** — not run in this agent pass |

**Shipped:** `track-definition.js`, `track-clearance.js`, `tunnel-volume.js`, `world-geometry-validator.js`, `stages/mountain-definition.js`, `docs/WORLD_GEOMETRY_RULES.md`. Mountain ~1.5 km compiled pieces (3 CP, tunnel, 2 jumps, bank/S/off-camber). Desert/Forest/Lakeside piece lists unchanged. No renderer/post/car changes.

**Remaining:** Live float/clip validation on Mountain; shoulder blend polish; prop AABB float checks (validator future); do not redesign other stages yet.

---

**Date:** 2026-08-18 · **Scope:** boot path, acceptance criteria in
[`docs/AM3-RESEARCH.md`](AM3-RESEARCH.md) §7, static hygiene.
**Machine:** macOS 24.0.0, Apple M1 Pro, 120 Hz ProMotion.
**Browser:** Chrome 151.0.7922.138 (headless via CDP, and headed for frame timing).
**Working tree:** dirty. Other agents were editing `js/` throughout this pass, so
every finding carries a timestamp and a note where mid-edit churn is plausible.

## How to read this

Findings are split into two lists and the split is strict:

- **Verified** — I ran something and observed the failure. Evidence is a tool
  output, a browser console message, or a measurement.
- **Inferred** — I read the code and believe it is wrong. I did **not**
  reproduce it. These may be wrong.

Nothing is promoted from Inferred to Verified without a reproduction.

## Tooling delivered

| Tool | Dependencies | Ran? | Result |
|---|---|---|---|
| `tools/qa-static-audit.mjs` | none (plain `node`) | yes, repeatedly | PASS, 8 checks, 7 warnings |
| `tools/qa-boot-smoke.mjs` | none — drives installed Chrome over CDP | yes, 6 times | caught 2 real boot-breaking defects; final run **16/16 PASS, 0 page errors** |
| `tools/qa-frame-probe.mjs` | none — same CDP harness | yes, headed, 8s and 20s samples | real numbers, see V-2 |
| `tools/lib/qa-harness.mjs` | none | library | server + Chrome launcher + CDP client |

Neither Playwright nor Puppeteer is installed and there is no `package.json`.
Rather than ship untested scaffolding, the harness speaks the Chrome DevTools
Protocol directly over the `WebSocket` built into Node 22+, driving the Chrome
already on the machine. **Nothing was installed.** Every tool below actually ran.

**macOS Chrome policy (2026-09-03):** spawning Google Chrome under Cursor's
`node` aborts in `HIServices TransformProcessType` / `_RegisterApplication`
(SIGABRT) and pops a crash dialog. `tools/lib/qa-harness.mjs` now
**default-denies** Chrome on darwin unless `RALLY_QA_ALLOW_CHROME=1`. Proof:
`node tools/qa-chrome-safe.mjs`. Headed/boot CDP probes belong in Terminal.app
with that env set — never from a Cursor agent shell.

Two operational notes. The harness serves the repo on an OS-assigned ephemeral
port and explicitly refuses 8765; it kills only the browser process it spawned.
And Chrome cannot be launched from inside the agent sandbox (`nice(5) failed:
operation not permitted`), so the browser tools were run with the sandbox
disabled — they still only read the repo and write nothing.

---

# Verified defects

## V-1 — CRITICAL (now resolved by another agent): a stray brace in `js/gfx/pbr.js` stopped the game booting

`js/gfx/pbr.js:184` had an extra `}` inside the `root.traverse((obj) => {...})`
callback in `applyEnvMap`. `game.js` imports `pbr.js`, so the syntax error
failed the whole module graph: `RallyGame` never evaluated, `window.game` never
existed.

The user-visible symptom is **exactly** the recurring bug in this project's
history — the splash paints, PRESS START advances to SELECT MODE via the inline
fallback in `index.html` (`rallyShow("screen-menu")` when `window.game` is
absent), and then every button silently does nothing.

**Evidence** — `qa-boot-smoke.mjs` at 19:07:52Z:

```
FAIL  step: no boot-error panel shown
      Uncaught SyntaxError: missing ) after argument list
      http://127.0.0.1:62616/js/gfx/pbr.js?v=4:184
```

**Status:** the file was rewritten at 15:08:20 local, about 30 seconds after the
harness reported it, and now parses. It was broken on disk from 14:45 to 15:08.

**The lesson worth keeping.** My first version of the static audit ran
`node --check <file>.js` and reported this file as clean. Node does not apply the
ES-module parse goal to a bare `.js` file, and it exits 0 on this exact
unbalanced-brace pattern — reproduced against a minimal case. `--check` on the
same bytes named `.mjs` fails correctly. `tools/qa-static-audit.mjs` now copies
each file to a temp `.mjs` before checking. **Any pre-existing check based on
`node --check *.js` is giving false assurance.**

## V-2 — HIGH: there is no frame limiter, and the simulation is stepped with the raw frame delta

Criterion 1 asks for a **locked** 60 fps. Measured on this machine:

```
frames captured .............. 2364 over 20s  (118.2 fps average)
p50 frame time ............... 8.30 ms   (120.5 fps)
p95 frame time ............... 9.30 ms
p99 frame time ............... 9.40 ms
frames over 16.6ms budget .... 9 / 2364  (0.4%)
game's own FPS readout ....... 120
GPU: ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro)
```

Rendering performance is genuinely good — p99 of 9.4 ms is comfortable. The
defect is that the game runs at display refresh rate with no cap, and the
simulation is not decoupled from it:

```579:590:js/game.js
  _loop(now) {
    try {
      if (!this.renderer) {
        this.last = now;
        if (this.input) this.input.poll();
        if (this.audio) this.audio.syncMusic(this.state, this.courseId);
      } else {
        let dt = (now - this.last) / 1000;
        this.last = now;
        if (!(dt > 0) || dt > 1) dt = FIXED_DT;
        if (dt > 0.024) dt = 0.024;
```

`this.accum = 0` is initialised in the constructor and `FIXED_DT` is imported,
but neither is used as an accumulator anywhere — `FIXED_DT` appears only as a
fallback for a bad delta. `_fixed(dt)` receives the raw clamped frame delta, so
the file header's claim of "60 Hz locked-step physics" is not what the code does.

Two consequences, both real:

1. **Refresh rate changes the game.** At 120 Hz the physics integrates at 8.3 ms
   steps instead of 16.6 ms. Any behaviour sensitive to step size — tire slip
   integration, jump ballistics, collision response — differs between a 60 Hz
   and a 120 Hz display.
2. **Per-frame smoothing constants run at double speed.** These three are not
   `dt`-scaled, so they converge twice as fast at 120 Hz:

   - `js/ui/hud.js:130` — `this._mphShown += (mph - this._mphShown) * 0.22;`
   - `js/ui/hud.js:131` — `this._rpmShown += (rpm - this._rpmShown) * 0.28;`
   - `js/game.js:1166` — `this._tunnelBlend += ((inTunnel ? 1 : 0) - this._tunnelBlend) * 0.16;`

   So the needles sweep faster and the tunnel light transition is quicker on a
   ProMotion display than on a 60 Hz panel.

Also framerate-coupled by construction: `_updateReflections` fires every
`GFX.reflectEvery` **frames**, and the minimap redraws on `(this._fpsFrames & 7)`,
so both cost twice as much work per second at 120 Hz.

**Suggested fix.** Implement the fixed-step loop the constructor was clearly
written for: accumulate real time into `this.accum`, run `_fixed(FIXED_DT)` while
`accum >= FIXED_DT` (with a max-steps clamp to avoid a death spiral), and render
once per animation frame. Then convert the three smoothing constants above to
`1 - Math.exp(-k * dt)` form, which the camera code in `_chaseCam` already uses
correctly and can be copied from.

## V-3 — HIGH (RESOLVED at 15:53 while this pass was running): Delta and Stratos shipped valid GLB models that the game rejected and silently replaced with procedural geometry

`assets/delta/integrale.glb` and `assets/stratos/stratos.glb` are present and
structurally valid, but the game falls back to the procedural Saturn mesh for
both. Only the Celica loads its real model.

**Evidence** — the loader's own warning, captured by `qa-boot-smoke.mjs` at
19:46:44Z, which now asserts this:

```
FAIL  step: every car whose GLB ships on disk actually loaded it
      these cars ship a model on disk but the game fell back to procedural
      geometry anyway: delta (has integrale.glb); stratos (has stratos.glb)
      — the file is being fetched and rejected, not missing
```

I validated the containers independently so this is not a corrupt-file problem:

```
ok   assets/celica/gt4.glb        v2 7.22MB meshes=172 extensionsRequired=-
ok   assets/delta/integrale.glb   v2 2.83MB meshes=24  extensionsRequired=-
ok   assets/stratos/stratos.glb   v2 0.09MB meshes=34  extensionsRequired=-
```

All are glTF 2.0, header length matches file length, JSON chunk parses, and
none declares `extensionsRequired`, so no missing DRACO/KTX2/meshopt decoder is
involved. The fetch also succeeds — the 404s in the logs are for the *second*
candidate filename, which is only tried because the first was rejected.

**Root cause is the swallowed exception.** `tryLocalGltf` wraps each candidate in
a `try`/`catch` and `continue`s on any throw, so a valid GLB that fails
downstream in `loadCarGltf` → `gameShade` / `fitToRallyCar` is indistinguishable
from a missing file. `js/cars/celica.js:362-378`. The Celica goes through the
same pipeline successfully, which points at something spec-specific to Delta and
Stratos rather than at the loader — `GARAGE.delta` carries `yaw: Math.PI`, which
the other two do not.

**This was mid-edit churn, and it resolved itself.** I flagged it as plausibly
mid-regeneration because `integrale.glb` had been written at 15:28 and the repo
had just gained `tools/glbcheck.mjs`, `tools/glbedit.mjs`, and
`tools/glbstats.mjs`. A re-run at 15:53 confirms it is fixed:

```
ok  every car whose GLB ships on disk actually loaded it
    — celica, delta, stratos all loaded their shipped model

note  3 tolerated failed request(s):  3x /favicon.ico
```

The tolerated-404 count fell from 95 to 3 in the same run, so the asset probing
has stopped entirely. **No action needed on the assets.** I am keeping the entry
because the failure was real when observed and the detection is now permanent.

**One fix still worth making.** `tryLocalGltf` swallows the load exception, which
is why this took a container validation and a warning-capture step to diagnose
rather than being obvious from the console. Log the caught error: a silent
fallback that cannot distinguish "file absent" from "file present but rejected"
will cost this time again.

## V-4 — MEDIUM (latent since V-3 resolved): the garage watcher re-fetches missing car models every 1.5s forever, including mid-race

```160:172:js/cars/celica.js
export function watchForCelicaFile(onLoad) {
  const tick = async () => {
    let got = false;
    for (const id of Object.keys(GARAGE)) {
      if (usingGltf[id]) continue;
      if (await tryLocalGltf(id)) got = true;
    }
    if (got && onLoad) onLoad(true);
  };
  const timer = setInterval(tick, 1500);
  tick();
  return () => clearInterval(timer);
}
```

**Evidence** — a single ~90 s smoke run, with the car selected and a race
running:

```
note  75 tolerated failed request(s) — asset probes, not errors:
        37x  /assets/delta/scene.glb
        36x  /assets/stratos/scene.glb
```

37 repeats of the same 404 at 1.5 s intervals is the interval, not a coincidence.

Another agent has already recognised this — `_stopGarageWatchIfComplete` in
`js/game.js:277-283` exists to shut the poller down, and its comment describes
the bug accurately. But it only stops once **all three** chassis report a real
GLB. While V-3 was live that condition never became true, so the two defects held
each other open.

**Current state:** now that all three cars load, the stop condition fires and the
polling is no longer observable — the 15:53 run shows 3 failed requests instead of
95. The unbounded loop is still in the code, so the moment any car's model is
missing or rejected again, a 1.5 s fetch loop runs for the whole session
including mid-race.

**Suggested fix.** Stop after a bounded number of attempts regardless of success,
and stop unconditionally when a race starts. The poller exists to notice a
dropped-in file, which is a title-screen activity; it has no reason to run during
a stage.

## V-5 — MEDIUM: an unattributed hitch during racing, against a criterion that names hitching explicitly

Criterion 1 says "no hitching on Desert with a full pack". Two headed samples on
Desert with 14 opponents:

| Sample | Worst frame | Frames > 33.3 ms | When |
|---|---|---|---|
| 8 s | **1408 ms** | 3 of 729 | not recorded |
| 20 s | **175 ms** | 1 of 2364 | +2.38 s into sampling |

Both samples began 1.5 s after the race started, so neither spike is the
first-frame shader compile. The 1.4 s stall in the first run did not recur in the
second, which is consistent with one-time work — most likely the sky IBL bake,
which `_applyLighting` defers via `setTimeout(..., 0)` and which runs
`PMREMGenerator.fromScene` on the main thread (`js/game.js:1163-1188`). I did not
confirm that attribution, so treat the cause as open.

The 175 ms spike at +2.38 s is a visible quarter-second freeze. It is worth
chasing before signing off criterion 1, and V-4's 1.5 s network poll is a
candidate contributor.

---

# Inferred defects (read, not reproduced)

## I-1 — MEDIUM (RESOLVED Sprint 18): winning Desert is silently rewritten as 2nd place, so a Desert win never rolls over

**Was:** `_finish` rewrote Desert 1st as 2nd via `if (this.courseId === "desert" && pos === 1) pos = 2;`, so `champPlace` never carried a Desert win into Forest.

**Evidence (Sprint 18):** That override is **gone** from `js/game.js` `_finish` — `this.champPlace = pos` keeps the finishing place. `tools/qa-championship-grid.mjs` asserts Desert `_finish(1)` → `champPlace === 1` and Forest grid starts 1st. Gated by `tools/qa-sprint18-championship.mjs`.

## I-2 — MEDIUM (RESOLVED Sprint 18): the checkpoint bonus message is wrong

**Was:** `CHAMPIONSHIP.checkpointBonus` was `25` but the HUD flashed a hard-coded `+0'20"00`.

**Evidence (Sprint 18):** `_checkpoints` adds `CHAMPIONSHIP.checkpointBonus` and flashes
`` `CHECK POINT  +${formatTime(CHAMPIONSHIP.checkpointBonus)}` `` (`js/game.js`). Config still has `checkpointBonus: 25` (`js/config.js`). Gated by `tools/qa-sprint18-championship.mjs`.

## I-3 — MEDIUM: co-driver lookahead may be too short to act on at speed

`PACE.look` is 42 metres (`js/config.js:747`). That converts to warning time as:

| Speed | Warning |
|---|---|
| 100 km/h | 1.5 s |
| 140 km/h | 1.1 s |
| 180 km/h | 0.8 s |

Criterion 8 requires calls that "arrive early enough to act on". Under a second
of notice on a fast approach is about reaction time, not planning time. There is
also a fixed `speakGap: 2.4` and a 30 m re-call suppression in
`CoDriver.update`, plus a 45 ms `setTimeout` before speaking, all of which push
delivery later. The severity + direction vocabulary itself is correct and matches
the research brief — `spokenLine` in `js/audio/codriver.js:166-195` maps to
"Easy/Medium/Hard" + "Left/Right". This is a timing concern only, and it needs an
ear to settle: checklist step 8.2.

## I-4 — LOW/MEDIUM: one first-party import has no `?v=` cache-buster

`js/physics/vehicle.js:39` — `import { JumpModel } from "./jump.js";`

Every other first-party module import in the project carries `?v=N`, and
`index.html` pins `main.js` and the stylesheet the same way. `jump.js` is new and
missed the convention, so a browser that has cached it once can keep serving that
version indefinitely while everything around it updates. `vendor/` is
deliberately unversioned and is excluded from this check.

## I-5 — LOW: `?v=` versions are not being bumped when modules change

`tools/qa-static-audit.mjs` compares each module's mtime against the mtime of the
file that versions it. On this pass it flagged `js/game.js`, `js/config.js`,
`js/cars/celica.js`, `js/physics/vehicle.js`, `js/tracks/track.js`, and
`css/game.css` as modified after their importer without a version bump.

**Most of this is mid-edit churn** from the other agents and will resolve itself.
I am listing it because it is the mechanism behind "needs a hard refresh", which
is one of the reported recurring symptoms — a stale cached module mixed with
fresh siblings produces arbitrary misbehaviour. Worth re-running the audit on a
quiet tree and bumping whatever is still flagged.

## I-6 — LOW: per-frame errors are caught and logged forever

`_loop` wraps each frame in `try`/`catch` and logs `console.error("Frame failed",
err)` before scheduling the next frame (`js/game.js:614-617`). A persistent
per-frame throw would flood the console at 120 Hz while the game appeared to run.
This is defensible — a hard stop would be worse — and `qa-boot-smoke.mjs` now
fails on any `console.error`, so the case is covered by tooling rather than
needing a code change. Noted so nobody "fixes" it into a crash.

---

# Acceptance criteria status

| # | Criterion | Status | Basis |
|---|---|---|---|
| 1 | Locked 60 fps, no hitching on Desert with a full pack | **FAILS** | Verified. Runs unlocked at 120 fps (V-2); one 175 ms hitch mid-race (V-5). Raw throughput is otherwise healthy: p99 9.4 ms. |
| 2 | Braking distance and slide entry differ per surface | **Needs a human** | Read only. `SURFACES` gives each surface distinct `brakeHold` (tarmac 1.0, gravel 0.5, dirt 0.42), `muPeak`, `slipPeak`, `brakeYaw`, `driftEase`, and Desert routes you sand → gravel → dirt → mud on purpose. Whether it *feels* different cannot be asserted. Checklist §2. |
| 3 | Lift before a crest and brake in the air lands flat and gains time | **Needs a human** | Read only. `js/physics/jump.js` implements a `JumpModel` with `ground`/`air`/`land`/`gravityScale` and the Fujimoto technique is called out in comments. Whether it is actually *faster* needs a stopwatch. Checklist §3. |
| 4 | Title → PRESS START → SELECT MODE → car → Desert countdown, no refresh ritual | **CONFIRMED** | Verified end to end, 16/16 steps, zero page errors. Splash visible; `#btn-start` confirmed hittable via `elementFromPoint`, not CSS; no opaque overlay over the render surface; advances on real trusted mouse click **and** on Enter; championship reaches Desert countdown, countdown hands to `race`, frames animate, input reaches the vehicle, HUD populates, pixels change. Practice → car → SELECT COURSE → countdown also passes. |
| 5 | One lap per course, checkpoint extensions, position rolls over | **CONFIRMED (machine)** | One lap per course; checkpoints 1 / 2 / 3 on Desert / Forest / Mountain. I-1 and I-2 **RESOLVED** (Sprint 18): no Desert 1st→2nd override; flash uses `CHAMPIONSHIP.checkpointBonus` (25). Grid carry machine-confirmed via `qa-championship-grid` / `qa-sprint18-championship`. **Still human-open:** a full live championship drive end-to-end was not driven this sprint. |
| 6 | Walls and rivals glance; nothing hard-fails a championship run | **Needs a human** | Read only. `glanceObstacles` is documented "never embed, never stop dead", `bounceOffRoad` treats the shoulder as a bank, and the only run-ending path I found is the clock (`_dnf`), which is the intended arcade fail state. Contact *feel* is not machine-testable. Checklist §6. |
| 7 | Desert teaches with two wide turns before it tests with a long drift right | **CONFIRMED (by reading)** | `js/tracks/courses.js`: opening 190 m straight, then `radius 132 / angle 30` and `radius 120 / angle -28` at 16 m width — both flat out — and the exam is `radius 145 / angle -78` in open ground late in the lap with an embankment to lean on. The geometry matches the brief. Only whether it *teaches* needs a human. |
| 8 | Co-driver calls arrive early enough to act on, in severity + direction form | **Form confirmed, timing suspect** | Vocabulary verified by reading `spokenLine`: Easy/Medium/Hard + Left/Right, no GPS phrasing. Timing is the open question — 42 m of lookahead is under 1.1 s at 140 km/h (I-3). Needs an ear: checklist §8.2. |

**Summary:** criterion 4 — the one that has hurt most often — is confirmed
passing by machine and now has a permanent regression test. Criterion 7 is
confirmed by reading. Criterion 1 fails on the "locked" requirement. Criterion 5
was partial on I-1/I-2 — those are **RESOLVED** as of Sprint 18 (machine-confirmed
grid carry; full human championship drive still open). Criteria 2, 3, 6, and 8 are
*feel* criteria that no static or headless test can settle;
[`docs/QA-CHECKLIST.md`](QA-CHECKLIST.md) exists to route those to a human.

Worth stating plainly: during this pass the harness caught two defects that each
made the game completely unplayable (V-1) or visibly wrong (V-3), both of which
were live on disk and neither of which the existing `node --check` approach could
see. Both were fixed within minutes of being reported. That is the argument for
running `qa-boot-smoke.mjs` before every hand-off.

---

# Recommended order of work

V-1 and V-3 were both fixed by other agents during this pass and need nothing.

1. **V-2** — implement the fixed-step loop `this.accum` was written for, and
   convert the three per-frame smoothing constants to `dt`-scaled form. This is
   the only acceptance criterion currently failing outright, and it changes
   handling between 60 Hz and 120 Hz displays.
2. **I-1 / I-2** — **RESOLVED Sprint 18** (Desert override removed; checkpoint flash
   wired to `CHAMPIONSHIP.checkpointBonus`). Criterion 5 machine-confirmed.
3. **V-5** — attribute the mid-race hitch; suspect the deferred PMREM sky bake.
4. **V-4** — bound the garage poller and stop it on race start. Latent now, but
   it will come back the next time a car model fails to load.
5. **V-3 follow-up** — log the swallowed exception in `tryLocalGltf` so the next
   rejected model is diagnosable from the console alone.
6. **I-3** — get an ear on co-driver call timing; 42 m of lookahead is under
   1.1 s at 140 km/h.
7. **I-4 / I-5** — add the missing `?v=` on `jump.js`, then re-run the audit on a
   quiet tree and bump whatever is still flagged stale.
8. Hand [`docs/QA-CHECKLIST.md`](QA-CHECKLIST.md) to a human for criteria 2, 3,
   6, and 8.

# Running the tools

```bash
node tools/qa-static-audit.mjs          # instant, no install, exits non-zero on failure
node tools/qa-boot-smoke.mjs            # ~90s headless; --headed to watch it
node tools/qa-frame-probe.mjs --seconds=20   # headed; real GPU frame times
node tools/qa-race-probe.mjs --course=desert --seconds=6   # needs .qa/playwright
```

---

# Sprint 1–7 closure (19 Aug 2026)

**Cache bust:** `index.html` / `main.js` → **`?v=541`**

| Sprint | Scope | Code | Automated QA | Human feel |
|--------|-------|------|--------------|------------|
| **1** | Dunes in chase view, shadows, camera kick, surface HUD, title groundwork | **Done** | Boot smoke pass | Open |
| **2** | Mountain cliff, Lakeside basin, stage identity, collision SFX, HUD cleanup | **Done** | Boot smoke pass | S2.A–J open |
| **3** | Racing-line keep-outs, cliff readability, lake framing | **Done** | Static pass | Open |
| **4** | Landmark scale via `_geoFramingBias`, mountain mass, lakeside basin | **Done** | Boot smoke pass | Open |
| **5** | Forest Acts 5–7 drift hairpins | **Done** (`courses.js`) | Boot smoke pass | Open |
| **6** | Mountain gravel Acts 5–7 drift finale | **Done** (`courses.js`) | Boot smoke pass | Open |
| **7** | Frame cap, garage integration, title showroom, sprint closure | **Done** | See below | Open |

## Sprint 7 deliverables (verified in code)

| Item | File(s) | Status |
|------|---------|--------|
| **60 Hz render cap** (physics fixed-step unchanged) | `config.js` `GFX.lockRenderFps`, `game.js` `_loop` | **Implemented** — title/menu uncapped when `unlockFpsOnTitle` |
| **Minimap refresh decoupled from frame rate** | `game.js` `_minimapT` | **Implemented** — ~8 Hz by time, not frame parity |
| **Garage poller stops on race start** | `game.js` `_pauseGarageWatch`, `_beginRace` | **Implemented** |
| **Garage load summary + Stratos placeholder label** | `celica.js` `garageLoadSummary`, `game.js` `garageStatus` | **Implemented** |
| **GLB load failures logged** | `celica.js` `tryLocalGltf` | **Already present** (warn on build failure) |
| **Title showroom lighting / reflectivity** | `LIGHTING.title`, `setShowcaseReflectivity` | **Implemented** (~v190) |

## Sprint 7 automated run (19 Aug 2026)

Re-run after pull:

```bash
node tools/qa-static-audit.mjs
node tools/qa-boot-smoke.mjs
node tools/qa-frame-probe.mjs --seconds=12   # confirm HUD reads ~60 on ProMotion during race
```

**Still blocking “polished rally game”:** human completion of [`docs/QA-CHECKLIST.md`](QA-CHECKLIST.md) criteria 2, 3, 6, 8 and drift-finale drives on Desert / Forest / Mountain.

---

# Sprint 8 — Player feel & rally identity (19 Aug 2026)

**Cache bust:** `?v=194`

**Charter:** Close the AM3 headline-mechanic gap in code — co-driver timing, Fujimoto jump payoff, championship grid rollover clarity — plus multi-stage boot QA.

| Deliverable | Status |
|-------------|--------|
| Co-driver lookahead **72 m + speed × 2.85 s** (was 42 m fixed) | **Done** (`PACE` in `config.js`) |
| Speed-scaled re-call suppression | **Done** (`codriver.js`) |
| Hard calls speak immediately (0 ms delay) | **Done** |
| Fujimoto jump payoff widened (`worstScrub` 0.72, `flatScrub` 0.998) | **Done** (`JUMP` in `config.js`) |
| Championship result shows **grid carry** to next stage | **Done** (`game.js` `_finish`) |
| `tools/qa-championship-flow.mjs` — Desert / Forest / Mountain boot | **Done** — **4/4 PASS** (19 Aug) |
| Safari crowd geometry merge hygiene | **Partial** — `mergeReadyBox()`; 2 tolerated THREE merge warns remain on Celica LOD |

**Automated (19 Aug):** `qa-static-audit` PASS · `qa-boot-smoke` **16/16** · `qa-championship-flow` **4/4**

**Still human-only:** mud-vs-tarmac feel, jump stopwatch test, contact feel, co-driver ear test (checklist §2–3, §6, §8).

---

# Sprint 9 — AI, championship integrity & polish (19 Aug 2026)

**Cache bust:** `?v=195`

**Charter:** Parallel senior-dev audit → ship gameplay fairness, championship flow fixes, HUD/audio polish, merge hygiene, and progression QA.

| Deliverable | Status |
|-------------|--------|
| Stage-scaled AI skill (`skillByCourse`) + 14-unique skill ladder | **Done** (`config.js`, `ai.js`) |
| Championship rubber band scaled by grid standing | **Done** (`ai.js`) |
| Grid spawn alignment (removed +4 m offset, lane-matched) | **Done** (`game.js`) |
| **RETRY bug:** stageIndex no longer advances until NEXT STAGE | **Done** (`_pendingNextCourse`) |
| Structured result screen (headline + bullets) | **Done** (`index.html`, `game.js`, `game.css`) |
| Co-driver / HUD sync (pace shows when voice fires) | **Done** (`codriver.js`, `game.js`) |
| PACE unified (`recallMetres`, `speakDelayMs`, etc.) | **Done** (`config.js`, `codriver.js`) |
| HUD time urgency + surface colour tokens + STAGE TIME label | **Done** (`hud.js`, `game.css`) |
| Per-surface cabin EQ on SFX bus | **Done** (`engine.js`) |
| Land-plane `_nearestRoad` cache (Lakeside perf) | **Done** (`track.js`) |
| Merge geometry morph hygiene | **Done** (`celica.js`, `track.js`) |
| Lakeside unlock refreshes course picker | **Done** (`_unlockLakeside`) |
| `tools/qa-championship-advance.mjs` | **Done** |

**Automated (19 Aug):** `qa-static-audit` PASS · `qa-boot-smoke` **16/16** · `qa-championship-flow` **4/4** · `qa-championship-advance` **4/4**

**Still human-only:** drift finale feel (Acts 5–7), checklist §2–3, §6, §8.

---

# Sprint 10 — Release matrix & parallel agent rerun (19 Aug 2026)

**Cache bust:** `?v=197`

**Charter:** Rerun Sprints 1–10 automated gates, regenerate parallel agent roster, close doc drift, ship Sprint 10 code fixes.

| Deliverable | Status |
|-------------|--------|
| `docs/SPRINT-AGENTS.md` — 8 parallel senior agents (LE1–DIR1) | **Done** |
| `tools/qa-sprint-matrix.mjs` — orchestrates full headless suite | **Done** |
| `tools/qa-championship-grid.mjs` — Desert 1st grid carry E2E | **Done** |
| Championship flow includes **Lakeside** (with unlock flag) | **Done** |
| Height-aware `_mayPlant` + universal keep-out `maxH: 2.2` | **Done** (`track.js`) |
| Course **subtitle** in HUD (`MOUNTAIN · TOUR DE CORSE`) | **Done** (`hud.js`, `game.js`) |
| Mountain land-plane trench fix (v109+) retained | **Verified** |
| `qa-frame-probe` copy matches fixed-step + render cap | **Done** |
| QA-REPORT V-2 / I-1 / I-2 marked resolved in code | **Done** |

## Sprints 1–10 matrix (automated rerun)

| Sprint | Theme | Code | Auto gate |
|--------|-------|------|-----------|
| **1** | Dunes, shadows, camera kick, surface HUD, title | Done | static + boot |
| **2** | Cliff, Lakeside basin, collision SFX, HUD | Done | boot |
| **3** | Keep-outs, cliff/lake framing | Done (+ maxH fix) | static |
| **4** | `_geoFramingBias`, mountain mass | Done | boot |
| **5** | Forest Acts 5–7 drift | Done | flow |
| **6** | Mountain gravel finale | Done | flow |
| **7** | 60 Hz cap, garage, title showroom | Done | boot |
| **8** | Co-driver, jump, grid carry UI | Done | flow + grid |
| **9** | AI, RETRY, results, advance QA | Done | advance + grid |
| **10** | Matrix QA, agents, doc sync | Done | `qa-sprint-matrix` |

**Run full matrix:** `node tools/qa-sprint-matrix.mjs`

---

# Sprint 11 — Ruthless closeout: drift sweeps & terrain proof (19 Aug 2026)

**Cache bust:** `?v=198`

**Charter:** Close PARTIAL items ruthlessly — Act 6 sweeper berms, gravel finale camera, merge hygiene, mountain start regression QA, CEO mandate update.

| Deliverable | Status |
|-------------|--------|
| CEO → **ruthless improvement** mandate | **Done** (`.cursor/rules/virtual-racing-game-studio.mdc`) |
| Forest + Mountain Act 6 **`sweep`** + lean berms | **Done** |
| Forest gravel finale camera bias | **Done** (`game.js`) |
| Rival merge `normalizeForMerge` clone + clearGroups | **Done** |
| GLB load success logging | **Done** |
| `tools/qa-mountain-start.mjs` | **Done** |

**Automated:** `node tools/qa-sprint-matrix.mjs`

**Still human-only:** checklist §2, §3, §6, §8; headed `qa-frame-probe`; drift finale drives.

---

# Sprint 12 — Realistic graphics overhaul (19 Aug 2026)

**Cache bust:** `?v=204`

**Charter:** CEO-mandated realistic rally look — PBR tier 2 with procedural normal maps, stronger sky IBL, tuned stage lighting, async stage load UI, fog-aligned streaming (no pop-in), GLB-only cars.

| Deliverable | Status |
|-------------|--------|
| Procedural **normal maps** on road ribbon + terrain tiles | **Done** (`track.js` `roadNormalFor`, `landNormalMap`) |
| **MeshStandard** road/terrain with higher env response | **Done** (`pbr.js` `worldRoadMaterial`, `worldTerrainMaterial`) |
| **VISUAL tier 2** — textureScale 3, normalStrength 0.92, worldEnv 0.44 | **Done** (`config.js`) |
| **PMREM 128** sky IBL + car env 0.52 | **Done** (`GFX.pmremSize`, `VISUAL.carEnvIntensity`, `game.js`) |
| Stage **loading progress screen** (async `Track.create`) | **Done** (`index.html`, `hud.js`, `game.js`) |
| **GTA-style streaming** with fog-aligned anti-pop-in | **Done** (`STREAM` in `config.js`, `track.js` `update()`) |
| **No procedural car stand-ins** — GLB required | **Done** (`celica.js`) |
| `tools/qa-realistic-visual.mjs` | **Done** |

**Automated:** `node tools/qa-sprint-matrix.mjs` · `node tools/qa-realistic-visual.mjs`

**Still human-only:** full art-direction sign-off (CEO eyes on Desert/Forest/Mountain at race speed); checklist §2–3, §6, §8; headed frame probe on real GPU.

`qa-frame-probe.mjs` must run **headed** to mean anything. Headless Chrome has no
GPU and falls back to the SwiftShader software rasteriser, which caps this game
near 3 fps; the probe detects that and says the measurement is invalid rather
than reporting a fake number. The boot smoke test is headless-safe because it
derives its countdown budget from the frame rate it actually observes.

---

# Sprint 13 — Environmental realism tier 3 (19 Aug 2026)

**Cache bust:** `?v=208`

**Charter:** Push the realistic render path to tier 3 — per-stage horizon haze, richer procedural ground/road grain, road cavity AO, bumped world IBL — while keeping Sprint 12 PBR gates green and 60 Hz budget.

| Deliverable | Status |
|-------------|--------|
| **`VISUAL.tier` ≥ 3** in `config.js` | **Done** (`tier: 3`) |
| **Per-stage `horizonGlow` / `horizonStrength` / `dustStrength`** | **Done** (desert, forest, mountain, lakeside, title) |
| **Sky shader** — `uHorizonGlow`, `uDust`, sharper sun disc | **Done** (`sky.js?v=6`) |
| **`paintLandAlbedo`** — pebble/ripple/scree/moss/wet patches | **Done** (EA1) |
| **`paintSurface`** — tarmac aggregate/oil/wear, gravel chips, mud gloss | **Done** (EA1) |
| **`roadAoFor`** — procedural cavity map on ribbons | **Done** (LE1 integration) |
| **Tier-3 IBL bump** on road/terrain materials | **Done** (`pbr.js?v=11`) |
| **Mountain opaque mass removed** (stage 3 visibility) | **Done** (Sprint 13 prep) |
| `tools/qa-sprint13-visual.mjs` | **Done** — **8/8 PASS** |

**Automated:** `node tools/qa-sprint13-visual.mjs` · `node tools/qa-sprint-matrix.mjs`

**Still human-only:** horizon dissolve at race speed on all four stages; checklist §2–3, §6, §8; headed `qa-frame-probe` on real GPU.

---

# Sprint 14 — Aerial depth + hero landmarks tier 4 (19 Aug 2026)

**Cache bust:** `?v=211`

**Charter:** Push visual tier to 4 — distance aerial perspective on terrain, one authored hero silhouette per stage, stronger lakeside water reflections — while keeping Sprint 12–13 gates green.

| Deliverable | Status |
|-------------|--------|
| **`VISUAL.tier` ≥ 4** in `config.js` | **Done** (`tier: 4`) |
| **`aerialPerspective`** — vertex fade toward stage fog | **Done** (`_applyAerialPerspective` in `track.js?v=120`) |
| **`heroLandmarks`** — desert arch, forest cedars, lakeside pier | **Done** (`_addHeroLandmarks`) |
| **Tier-4 water** — ripple caustics + higher env | **Done** (`pbr.js?v=12`, `water-ripple-t4`) |
| **World IBL bump** at tier 4 | **Done** (`WORLD_ENV` 1.2) |
| `tools/qa-sprint14-visual.mjs` | **Done** |

**Automated:** `node tools/qa-sprint14-visual.mjs` · `node tools/qa-sprint-matrix.mjs`

**Still human-only:** hero silhouette read at race speed; aerial dissolve vs fog tuning; checklist §2–3, §6, §8; headed `qa-frame-probe` on real GPU.

---

# Sprint 15 — Trackside identity + contact grounding tier 5 (19 Aug 2026)

**Cache bust:** `?v=211`

**Charter:** Push visual tier to 5 — rally boards at start/landmarks/km markers, stronger contact shadows under heroes and trees, animated lakeside water — while keeping Sprint 12–14 gates green.

| Deliverable | Status |
|-------------|--------|
| **`VISUAL.tier` ≥ 5** in `config.js` | **Done** (`tier: 5`) |
| **`tracksideSignage`** — stage boards + km markers | **Done** (`_addTracksideSignage`, `stageBoardTexture`) |
| **`contactShadowBoost`** — hero + tree ground blobs | **Done** (`_pushContactShadow`, `SHADOW_MAT_T5`) |
| **`waterScroll`** — lake ripple UV animation | **Done** (`_tickWaterScroll`, `_waterMeshes`) |
| **World IBL bump** at tier 5 | **Done** (`WORLD_ENV` 1.24) |
| `tools/qa-sprint15-visual.mjs` | **Done** |

**Automated:** `node tools/qa-sprint15-visual.mjs` · `node tools/qa-sprint-matrix.mjs`

**Still human-only:** board readability at race speed; water motion vs perf; checklist §2–3, §6, §8; headed `qa-frame-probe` on real GPU.

---

# Sprint 16 — Hotfix wave: POV cockpit + contact blobs + occlusion fade (19 Aug 2026)

**Cache bust:** unchanged (`?v=211` — no bump for doc-only QA closeout)

**Charter:** Close player-visible regressions without a full visual tier bump — POV dash readability, contact shadows planted on ground not chassis, chase-cam tunnel occlusion.

| Deliverable | Status |
|-------------|--------|
| **POV cockpit gauges + mirror** — `hudMat`, `frustumCulled = false`, mirror `try/finally` | **Done** (`celica.js`, `game.js` `_renderMirror`) |
| **Contact blobs on `track.query` ground Y** — not chassis `d.y` alone | **Done** (`game.js` `_syncContactBlobs`) |
| **Camera occlusion fade** — tunnel walls ghost on chase cam | **Done** (`occlusion-fade.js`, `track.js` `cameraFade`, `game.js` `updateCameraFade`) |
| Sprint 16 doc closeout in `QA-REPORT.md` | **Done** (this section) |

**Automated regression:** covered by `node tools/qa-sprint17-visual.mjs` (contact blob + occlusion checks)

**Still human-only:** POV dash legibility at night tunnel; mirror refresh cadence; checklist §2–3, §8; headed desert tunnel hairpin.

---

# Sprint 17 — Chase-cam readability tier 6 (19 Aug 2026)

**Cache bust:** `index.html` / `main.js` / `game.js` **`?v=215`** · `track.js?v=123` · `hud.js?v=19` · `css/game.css?v=15` · `config.js?v=76` · `occlusion-fade.js?v=2`

**Charter:** Push visual tier to 6 — chase-cam occlusion fade for tunnels/cliffs, stronger tunnel material read, HUD punch — while keeping Sprint 12–15 gates green.

| Deliverable | Status |
|-------------|--------|
| **`VISUAL.tier` ≥ 6** in `config.js` | **Done** (`tier: 6`) |
| **`cameraOcclusionFade`** — product toggle for chase-cam ghost meshes | **Done** (`config.js`, `occlusion-fade.js`) |
| **Tunnel `cameraFade` tags** — walls/ceiling/ribs | **Done** (`track.js` `_addTunnelSegment`) |
| **`updateCameraFade` per frame** on chase cameras | **Done** (`game.js`) |
| **Cliff occlusion fade** — mountain escarpment + forest berms/banks/logs tagged | **Done** (`track.js`) |
| **Tunnel grain** — bake-time bore striation map on wall/rib/portal materials | **Done** (`tunnelBoreStriationMap`) |
| **HUD punch** — brighter chase dials, cluster opacity 0.92, **AIR** when airborne | **Done** (`hud.js`, `game.css`, `h.onGround`) |
| `tools/qa-sprint17-visual.mjs` | **Done** |

**Automated:** `node tools/qa-sprint17-visual.mjs` · `node tools/qa-sprint-matrix.mjs`

**Still human-only:** cliff fade vs aerial perspective at race speed; tunnel grain in the bore; HUD punch in rain/fog; checklist §2–3, §6, §8; headed `qa-frame-probe` on real GPU.

---

# Sprint 18 — Championship integrity + Stratos hero (20 Aug 2026)

**Cache bust:** `index.html` / `main.js` / `game.js` **`?v=216`** · `celica.js?v=82`

**Charter:** Close acceptance criterion #5 PARTIAL (I-1 / I-2) and replace the 1.2k-tri Stratos stub with a readable original hero mesh. Sketchfab CC BY was not on disk — Blender rebuild instead of commercial 3dmodels.org.

| Deliverable | Status |
|-------------|--------|
| **I-1 RESOLVED** — no `desert && pos === 1 → pos = 2` in `_finish` | **Done** |
| **I-2 RESOLVED** — flash + clock use `CHAMPIONSHIP.checkpointBonus` (25) | **Done** |
| **NEXT STAGE load** — `Track.createAsync` → `Track.create` (Forest after Desert) | **Done** |
| Criterion **#5** machine-confirmed (grid carry) | **Done** — full human championship drive still open |
| **Stratos hero** — 1,224 → **15,612** tris; rival **14,256**; `WHEEL_*` hubs; `placeholderGlb: false` | **Done** |
| `tools/qa-sprint18-championship.mjs` | **Done** |
| `tools/qa-sprint-matrix.mjs` Sprint 18 row | **Done** |

**Automated:** `node tools/qa-sprint18-championship.mjs` · `node tools/qa-championship-grid.mjs` · `node tools/glbstats.mjs assets/stratos/*.glb`

**Still human-only:** full championship drive; Stratos silhouette at race speed vs Celica/Delta; optional Sketchfab CC BY drop later; checklist §2–3, §6, §8.

---

# Sprint 19 — Arcade sense of speed (20 Aug 2026)

**Cache bust:** `index.html` / `main.js` / `game.js` **`?v=218`** · `config.js?v=78` · `vehicle.js?v=43` · `engine.js?v=44`

**Charter:** Car felt sluggish with no racing urgency — punch acceleration/top end and sell speed through chase FOV + cabin rush.

| Deliverable | Status |
|-------------|--------|
| **Power wired** — `peakPowerKw` scales `engineTorque` (was dead) | **Done** (238 kW Celica; 252 Stratos) |
| **Top end** — Celica/Delta/Stratos **230 / 226 / 245** km/h; aeroDrag 0.37 | **Done** |
| **Gears** — slightly taller 4th so redline matches new max | **Done** |
| **Chase rush** — medium closer/lower, FOV 64, speedFov 0.2, punch 13° | **Done** |
| **Cabin wind** — opens earlier / louder by ~120 km/h | **Done** |
| `tools/qa-sprint19-speed.mjs` | **Done** |

**Automated:** `node tools/qa-sprint19-speed.mjs`

**Still human-only:** Desert straight 0–180 feel; Forest tightness vs new power; checklist §2.

---

# Sprint 20 — Highly realistic level design tier 7 (20 Aug 2026)

**Cache bust:** `index.html` / `main.js` / `game.js` **`?v=219`** · `config.js?v=79` · `track.js?v=125` · `pbr.js?v=15` · `sky.js?v=7`

**Charter:** Stages must read as real rally places — denser terrain, richer biomes, trackside verge detail, photographic stage light — without reintroducing tunnel overdraw or mountain mass.

| Deliverable | Status |
|-------------|--------|
| **`VISUAL.tier` 7** + `terrainRealism` | **Done** |
| **Denser heightmap** — `terrainTileSegs` 18 → **24** | **Done** |
| **Biome height/tint/paint** — dunes, moss banks, ridges, lake shelves | **Done** |
| **Verge detail** — desert scrub/rocks, forest understory, mountain scree, lakeside reeds | **Done** |
| **Stage LIGHTING + IBL** — per-biome sun/fog; `worldEnvIntensity` 0.5; WORLD_ENV 1.28 | **Done** |
| `tools/qa-sprint20-realism.mjs` | **Done** |

**Automated:** `node tools/qa-sprint20-realism.mjs`

**Still human-only:** art sign-off at race speed on all four stages; perf on Desert pack in tunnel; checklist §2–3.

# Sprint 21 — Authored GLB props & characters (20 Aug 2026)

**Charter:** Replace trackside box/cone stand-ins with actual models — crowds, safari animals, trees, rocks, cactus, alpine houses.

| Item | Status |
|------|--------|
| `assets/props/*` Kenney CC0 characters + nature | **Done** |
| Safari animals + alpine house GLBs | **Done** |
| `js/tracks/prop-kit.js` loader | **Done** |
| Track/game wiring, `VISUAL.tier: 8`, `glbProps` | **Done** |
| Crowds instance Kenney `character-*` GLBs via `CrowdField` | **Done** (closed Sprint 22 pass) |
| `tools/qa-sprint21-props.mjs` | **Done** |

**Automated:** `node tools/qa-sprint21-props.mjs` → PASS · `node tools/qa-boot-smoke.mjs` → **16/16**

**Cache bust:** `index.html` / `main.js` / `game.js` **`?v=228`** · `track.js?v=132` · `crowd.js?v=4` · `prop-kit.js?v=5` · `trees.js?v=25`

---

# Sprint 22 — Soft off-road + living crowds (20 Aug 2026)

**Charter:** Leave the ribbon freely; soft pull when deep; mid-track reset when too far; no verge wall-slide. Crowds bob/cheer with clap/cheer Doppler beds.

| Deliverable | Status |
|-------------|--------|
| **Off-road zones** — shoulder / runoff / recover / reset (`OFF_RESET=24`) | **Done** |
| **Mid-track reset** — `track.sample` centre-line restore for player | **Done** |
| **No wall skate** — glance re-aims down nose; barriers visual-only | **Done** |
| **Living crowds** — Kenney GLB bodies + proximity bob/cheer | **Done** |
| **Crowd audio** — `CrowdVoice` HRTF + manual Doppler | **Done** |
| **Kenney colormap** — `assets/props/Textures/colormap.png` (no GLTF 404 spam) | **Done** |
| `tools/qa-sprint22-runoff.mjs` | **Done** |

**Automated:** `node tools/qa-sprint22-runoff.mjs` → PASS · boot smoke **16/16** (clean console)

**Cache bust:** `?v=228` · `collide.js?v=29` · `vehicle.js?v=45` · `track.js?v=132` · `crowd.js?v=4` · `engine.js` crowd import `?v=2`

**Still human-only:** drive off Desert verge then deep reset; pass Lakeside crowd at speed for Doppler; checklist §6 contact feel.

---

# Sprint 23 — Photoreal lighting + post (20 Aug 2026)

**Charter:** Environment must read photographic — denser land/road grain, stronger stage IBL + sun, soft shadows, and a real post stack (bloom / grade / vignette / FXAA / sharpen).

| Deliverable | Status |
|-------------|--------|
| **`VISUAL.tier` 9** + `postFx` | **Done** |
| **`js/gfx/postfx.js`** — bloom, colour grade, vignette, FXAA, sharpen | **Done** |
| **Texture density** — `textureScale` 3, full-res normals, desert micro-grain | **Done** |
| **IBL / light** — PMREM 128, world/car env up, stage sun/hemi/exposure | **Done** |
| **Sky sun disc** — tighter photographic corona | **Done** |
| **Road/water response** — higher env metalness/roughness at tier 9 | **Done** |
| `tools/qa-sprint23-photoreal.mjs` | **Done** |

**Automated:** `node tools/qa-sprint23-photoreal.mjs` → PASS · boot smoke **16/16**

**Cache bust:** `index.html` / `main.js` / `game.js` **`?v=230`** · `config.js?v=83` · `postfx.js?v=2` · `pbr.js?v=16` · `sky.js?v=8` · `input.js?v=35`

**Still human-only:** headed GPU drive on all four stages; Desert tunnel overdraw; checklist §2–3. True photogrammetry albedo packs are a later asset drop if desired.

---

# Sprint 24 — 60fps photoreal + no control lag (20 Aug 2026)

**Charter:** Keep tier-9 look, restore 60 Hz feel. Sprint 23’s full-res FXAA/sharpen, ×3 textures, and 4× bloom blurs were the lag.

| Deliverable | Status |
|-------------|--------|
| **Quarter-res bloom** (1 separable pair) + grade/vignette | **Done** |
| **FXAA/sharpen off**; MSAA off when post on | **Done** |
| **GPU budget** — PR ≤1.25, textureScale 2, half normals, shadowEvery 2 | **Done** |
| **Adaptive post** — drops bloom when present >~18.5 ms | **Done** |
| **Snappy steer** — input rates + chassis steerSpeed ~22 | **Done** |
| `tools/qa-sprint24-perf.mjs` | **Done** |

**Automated:** `node tools/qa-sprint24-perf.mjs` → PASS · boot smoke **16/16**

**Cache bust:** `?v=230`

**Still human-only:** headed 60 Hz feel on Desert pack; confirm no steer lag after hard refresh.

---

# Sprint 25 — UE5-style PBR photoreal (20 Aug 2026)

**Charter:** Overhaul materials/lighting/textures toward Unreal-like physical response in the browser — without bringing back Sprint 23 control lag.

| Deliverable | Status |
|-------------|--------|
| **`VISUAL.tier` 10** + `ue5Look` / `physicalLighting` / `roughnessMaps` | **Done** |
| **Player lacquer** — MeshPhysical clearcoat paint; AI stays Standard | **Done** |
| **Glass/chrome/rubber** — Physical/Standard PBR (no transmission) | **Done** |
| **Road + land roughness maps** — procedural specular variation | **Done** |
| **Physical lights** — `useLegacyLights = false`; stronger sun IBL | **Done** |
| **Cinematic grade** — contrast + film grain (off when adaptive low) | **Done** |
| **60 Hz budget kept** — adaptive post, shadowEvery 2, textureScale 2 | **Done** |
| `tools/qa-sprint25-ue5.mjs` | **Done** |

**Automated:** `node tools/qa-sprint25-ue5.mjs` → PASS · boot smoke **16/16** · s23/s24 still PASS

**Cache bust:** `?v=231` · `config.js?v=84` · `pbr.js?v=17` · `postfx.js?v=3` · `track.js?v=134`

**Honest scope:** This is UE5-*inspired* Three.js PBR (clearcoat, roughness maps, physical lights, ACES + grain) — not Nanite/Lumen/hardware RT. Authored photo albedo packs remain a later asset drop.

---

# Sprint 26 — Driving integrity (20 Aug 2026)

**Charter:** Close the player-reported “hold accelerate → float 1st every stage” failure and the stage 2/3/4 start-grid pop-in. Driving must require steering/braking skill again.

| Deliverable | Status |
|-------------|--------|
| **No player off-road autopilot** — runoff costs pace; AI still guided | **Done** |
| **Planted grip** — higher LAT_BLEED, softer steerFalloff, tighter slide caps, sand/dirt less ice | **Done** |
| **Tougher AI** — skillCeiling 1.05, pace 0.92+, fewer mistakes | **Done** |
| **Exclusive championship grid** — player slot never shared with AI (fixes GO shove) | **Done** |
| **`_plantStartGrid` + cam hold** — car on grid before 3-2-1, no end-of-countdown pop | **Done** |
| `tools/qa-sprint26-driving.mjs` | **Done** |

**Automated:** `node tools/qa-sprint26-driving.mjs` → PASS · `qa-sprint22-runoff` PASS · boot smoke **16/16** · championship grid PASS · live probe: place-1 grid exclusive (player 16 m, AI 29 m+) · throttle-only 14 s → **15th** (14 rivals ahead)

**Cache bust:** `?v=232` · `config.js?v=85` · `collide.js?v=30` · `vehicle.js?v=46` · `ai.js?v=80`

**Still human-only:** full championship drive feel on sand/gravel after hard refresh; confirm stage 2/3/4 cars already on grid during 3-2-1.

---

# Hotfix — roadway clear on stages 2–4 (20 Aug 2026)

**Player report:** random objects/geometry on Forest / Mountain / Lakeside ribbons.

| Fix | Detail |
|-----|--------|
| Wider `ROAD_VERGE` (5.5 m) + farther near-plant shoulder | Trees/bushes start farther out |
| No lateral bush/fern jitter onto asphalt | Along-track scatter only + `_ribbonClear` |
| Forest drift banks / logs / berms / village / signage | Ribbon-clear gated |
| Lakeside land trench | Match Forest/Mountain floor clamp |
| `_scrubRoadwayColliders` | Drop any leftover on-ribbon bumps |

**Live probe:** forest/mountain/lakeside → `onRoad=0`, `landPoke=0` colliders.

**Cache bust:** `?v=233` · `track.js?v=135`

---

# Hotfix — solid opaque environment (20 Aug 2026)

**Player report:** car passes through opaque environment (esp. stages 2–4).

| Fix | Detail |
|-----|--------|
| `glanceObstacles` full depenetration | 2-pass separate; kill inward vel; light scrub |
| `_bumpNearRoad` / `_bumpPoses` | Rocks, trees, berms, banks, logs, stumps, shore stones |
| Mountain cliff face bumps | Sample solid along the cutting |
| Village / cactus / debris | Harder near-road radii |

**Live probe:** embed car in largest near-road collider → after 4 steps `dist >= need` on desert/forest/mountain/lakeside.

**Cache bust:** `?v=234` · `track.js?v=136` · `collide.js?v=31` · `vehicle.js?v=47`

---

# Sprint 27 — Environmental realism + rear dirt wake (21 Aug 2026)

**Charter:** CEO-mandated realism pass — backgrounds, environmental atmosphere, and dirt that clearly leaves the back of the car on loose surfaces.

| Deliverable | Status |
|-------------|--------|
| **`VISUAL.tier: 11`** + `rearDirtWake` / `envAtmosphere` | **Done** |
| **Sky** — ground bounce, stronger haze bands, dual-octave clouds, stage wind | **Done** (`sky.js`) |
| **Stage LIGHTING** — richer fog/horizon/dustStrength + wind vectors | **Done** (`config.js`) |
| **Rear dirt wake** — grit + hanging plume from rear tires, stage wind drift | **Done** (`effects.js`) |
| **Dust ↔ lighting** — `Dust.setAtmosphere()` on course load | **Done** (`game.js`) |
| `tools/qa-sprint27-env.mjs` | **Done** |

**Automated:** `node tools/qa-sprint27-env.mjs` → PASS

**Cache bust:** `?v=247` · `config.js?v=94` · `effects.js?v=47` · `sky.js?v=9` · `game.js?v=541`

**Still human-only:** Desert chase cam plume volume at speed; Forest canopy sky read; Lakeside mist band vs fog.

### Sprint 27 reopen — HD nature only (23 Aug 2026)

**Player moment:** Forest treeline / trackside trees / bushes / rocks / cacti are authored GLBs — no card crowns or cone/cylinder stand-ins on the live scenery path.

| Change | Proof |
|---|---|
| `_addHdNature` / `_addHdBackdrop` GLB-only plant | `qa-sprint27-env.mjs` PASS |
| Forest treeline pine/cedar/fir GLB | gate asserts |
| Verge ferns/bushes/logs + desert scrub HD | code path |
| Lakeside far shore autumn trees HD | code path |

**Cache:** `?v=273` · `track.js?v=149` · `prop-kit.js?v=11`

---

# Sprint 28 — Launch punch + driveline realism (21 Aug 2026)

**Charter:** Full realism pass focused on player-felt power — harder acceleration from a dead stop and a higher top end, without undoing Sprint 26 planted mid-corner grip.

| Deliverable | Status |
|-------------|--------|
| **`HANDLING.launchBoost` 1.38** fades by 78 km/h | **Done** (`config.js` + `vehicle.js`) |
| **Low-RPM torque meat** + peakPowerKw **272** (Stratos **288**) | **Done** |
| **Shorter 1st/2nd** + finalDrive **4.35**; Celica Vmax **250** | **Done** |
| **Less aero wall** (aeroDrag **0.33**) for top-end pull | **Done** |
| **Launch squat** squatMax **0.11** | **Done** |
| **`VISUAL.tier: 12`** | **Done** |
| `tools/qa-sprint28-launch.mjs` | **Done** |
| Sprint 26 gate constants refreshed to live planted values | **Done** |

**Automated:** `node tools/qa-sprint28-launch.mjs` → PASS (re-verified 23 Aug 2026 after Sprint 27 stack)

**Cache bust (live):** `?v=273` · `config.js?v=102` · `vehicle.js?v=59` · `game.js?v=541`

**Still human-only:** 0→100 feel on Desert sand vs Forest gravel; Stratos 2WD wheelspin on loose launch.

---

# Sprint 32 reopen — Desert rock-bridge portal (23 Aug 2026)

**Player moment:** Stage 1 finale approach — drive *under* the sandstone arch before the linked gravel hairpins (not a sealed dune wall).

| Change | Status |
|--------|--------|
| Portal refuse on every bridge block (`openH` **9.8**, `clearHalfD` **11**) | **Done** |
| Placement on sand→gravel approach straight (not mid-hairpin) | **Done** |
| Wider underpass land prism + floor clamp | **Done** |
| `tools/qa-sprint32-desert-finale.mjs` | **PASS** |
| `tools/qa-desert-bridge-portal.mjs` (0 invaders, land bed, car spawn) | **PASS** |

**Cache:** `?v=280` · `track.js?v=152`

**Still human-only:** Visual read of the mouth at chase-cam distance on a live Desert drive.

---

# Sprint 32 — Physically based lighting (23 Aug 2026)

**Player moment:** Sunlit tarmac/gravel reads with believable specular on paint and road; shadows stay sharp under the car at chase distance without killing frame time.

| Change | Status |
|--------|--------|
| `js/gfx/lighting-rig.js` — Kelvin sun, sky-rim fill, tight shadow frustum | **Done** |
| Per-stage `sunKelvin` + `rimInt` in `LIGHTING` | **Done** |
| PMREM sky capture far plane (`GFX.pmremFar` 240) | **Done** |
| Per-material IBL tint in `applyEnvMap` (road/chrome/terrain) | **Done** |
| Post composite highlight shoulder (`highlightRolloff`) | **Done** |
| `tools/qa-sprint32-pbr.mjs` | **PASS** |

**Cache:** `?v=304` · `config.js?v=118` · `lighting-rig.js?v=1` · `postfx.js?v=6` · `pbr.js?v=19`

**Perf:** No extra shadow pass; adaptive post (`adaptFloorMs` 33.3) unchanged. Sky rim is one DirectionalLight with `castShadow=false`.

**Still human-only:** 2-minute Desert/Forest drive — sun spec on Celica paint, shadow contact under wheels, 60 Hz feel on target hardware.

---

# Garage expansion — six GLB chassis + pro rivals (23 Aug 2026)

**Player moment:** SELECT CAR shows Celica/Delta/Stratos plus E-Type, Focus ST, Accord Sport; championship grid mixes real GLB silhouettes with pro racing lines and subtle rub audio.

| Change | Status |
|--------|--------|
| `assets/jaguar`, `focus`, `accord` from Cursor Projects GLBs | **Done** |
| Hero optimize (Accord 52→12 MB) + rival LODs | **Done** |
| `GARAGE_CAR_IDS`, rival chassis pool, per-slot physics | **Done** |
| Pro AI line (tarmac apex / loose width / look-ahead) | **Done** |
| Subtle `carBump` on rival contact | **Done** |
| `tools/qa-garage-cars.mjs` | **PASS** |

**Cache:** `?v=305` · `celica.js?v=96` · `config.js?v=119`

---

# Sprint 33 — Arcade power-slide (23 Aug 2026)

**Player moment:** e-brake + throttle into a gravel/sand hairpin — tail snaps out, throttle holds the slide, countersteer aims the exit. Chase cluster flashes **SLIDE** when attitude builds.

**Model (AM3 + arcade rally):** initiate (lock rears / power oversteer) → transition (yaw + lateral) → sustain (throttle, low bleed) → exit (countersteer).

| Change | Status |
|--------|--------|
| Stronger e-brake snap (`handbrakeYawKick` 3.15, rear µ dump) | **Done** |
| Power oversteer sustain (`handbrakePowerMul` 2.05, TC dump in slide) | **Done** |
| Longer carry (`handbrakeBleedMul` 0.032, `driftBleedMul` 0.048) | **Done** |
| Loose surfaces easier pitch-in (sand/gravel/dirt/mud) | **Done** |
| **SLIDE HUD badge** (`#cluster-slide`, `slideBadge` in hud.js) | **Done** |
| `tools/qa-sprint33-drift.mjs` | **PASS** |

**Cache:** `?v=310` · `config.js?v=119` · `vehicle.js?v=66` · `hud.js?v=26`

**Still human-only:** Desert Act 5 bowl + linked gravel hairpins feel drive.

---

# Sprint 34 — Studio check-in + preload (23 Aug 2026)

**Player moment:** Title screen warms the full championship cup in the background; returning to Desert (or next stage after halfway) skips the loading screen when the track is already hot.

| Change | Status |
|--------|--------|
| `_trackCache` + `_pumpPreloadQueue` background warm | **Done** |
| Instant race when `_isTrackReady(courseId)` | **Done** |
| Halfway checkpoint → next stage preload | **Done** |
| Title hover priority + championship cup queue | **Done** |
| Unified `config.js?v=119` module graph (static audit) | **Done** |
| `tools/qa-cache-version.mjs` + `qa-sprint34-checkin.mjs` | **Done** |
| QA gates use dynamic cache chain (no stale v=) | **Done** |

**Automated:** `node tools/qa-sprint34-checkin.mjs` → **SHIP-CANDIDATE** (23 Aug 2026)

**Cache:** `?v=310` · `game.css?v=22`

**Executive doc:** [`docs/SPRINT-34-CHECKIN.md`](SPRINT-34-CHECKIN.md) — full Sprints 1–33 summary, CEO + CTO reports.

**Still human-only:** 2-minute Desert gravel hairpin SLIDE badge feel; headed frame probe on target GPU.

---

# Sprint 33 reopen — SLIDE HUD (23 Aug 2026)

See Sprint 33 section above — SLIDE badge closed this iteration.

---

# Sprint 35 — Drive-corridor clip cleanup (23 Aug 2026)

**Player moment:** Car must not clip through land / bridge / berm polys on Stage 1 arch, Stage 2 finale, or Stage 3.

| Change | Status |
|--------|--------|
| Wider Stage 1 portal (`openH` **10.2**, `clearHalfD` **12**) + AABB portal scrub | **Done** |
| Axis-aligned footing (no rotated shards in the hole) | **Done** |
| `_markDriveClearCorridors` — Forest end + Mountain full land wash | **Done** |
| Harder land-tile / `_groundHeight` bed clamps in-lane | **Done** |
| Berms / cliff / scree pushed off ribbon + pose strip before instance | **Done** |
| `tools/qa-sprint32-desert-finale.mjs` | **PASS** |
| `tools/qa-desert-bridge-portal.mjs` | **Blocked** (Chrome load timeout in this session — static gate PASS) |

**Cache:** `?v=292` · `track.js?v=155`

**Still human-only:** Live drive under Desert arch; Forest finale; Mountain full lap for residual visual clip.


# Sprint 30 — Cinema realism (environment / textures / lighting) (23 Aug 2026)

**Player moment:** Stages read as photographed rally places — filmic midtones, denser ground/road grain, keyed sun with soft fill — not arcade neon punch.

| Deliverable | Status |
|-------------|--------|
| **`VISUAL.tier: 13`** + `cinemaRealism` | **Done** |
| **ACES filmic tone mapping** (replaces Reinhard for tier 13+) | **Done** |
| **Photographic grade** — lower sat, soft grain, deeper vignette | **Done** |
| **Per-stage LIGHTING retune** — Desert/Forest/Mountain/Lakeside cinema keys | **Done** |
| **Land + tarmac micro-detail** — silica/talus/litter/bitumen paint | **Done** |
| **Stronger IBL / normals** — worldEnv 0.9, normalStrength 1.22, WORLD_ENV 1.72 | **Done** |
| Soft PCF shadows (bias/radius) | **Done** |
| `tools/qa-sprint30-realism.mjs` | **PASS** |
| Regression: s23 photoreal + s25 UE5 | **PASS** |

**Cache:** `?v=293` · `config.js?v=115` · `track.js?v=156` · `pbr.js?v=18` · `sky.js?v=13` · `postfx.js?v=5`

**Still human-only:** 2-minute Desert + Mountain drive for ACES exposure feel and texture read at chase cam.

---

# Delta headlight floating polygons (23 Aug 2026)

**Player moment:** Delta Integrale nose — no full-length glowing light sheets / floating chrome slabs through the body.

| Change | Status |
|--------|--------|
| `isFullLengthLightSheetLabel` matches `Light_glass` / `Light_Glass_Bump` (underscores) | **Done** |
| Sheets **removed + disposed** (not only `visible=false`) | **Done** |
| Oversized `Light_Front` hides **material** so nested emitters still draw | **Done** |
| `tools/qa-delta-lights.mjs` | **PASS** |

**Cache:** `?v=295` · `celica.js?v=93`

**Still human-only:** Garage / practice with Delta headlights on — confirm no floating polygons.

---

# Sprint 31 — AAA expert driving + cinema realism (23 Aug 2026)

**Player moment:** Expert-grade handling — trail-brake rotation into gravel hairpins, countersteer catch at the limit, grip meter on the chase cluster, cinema-tier visuals intact.

| Deliverable | Status |
|-------------|--------|
| **Trail-brake yaw** (`trailBrakeYaw` 0.44) — brake + steer rotates nose on loose entry | **Done** |
| **Expert countersteer** (`expertCounterMul` 1.18) — faster catch at limit | **Done** |
| **Grip / slide telemetry** — `gripUsed()`, `slidePct()` | **Done** |
| **Chase cluster GRIP bar** — green→amber→red under load | **Done** |
| **Drift camera** — lateral kick + FOV pulse when sliding | **Done** |
| Sprint 30 cinema realism (tier 13, ACES, postFx) | **Regression PASS** |
| Sprint 33 power-slide sustain | **Regression PASS** |
| `tools/qa-sprint31-drift.mjs` | **PASS** |

**Cache:** `?v=296` · `config.js?v=116` · `vehicle.js?v=64` · `hud.js?v=25` · `game.css?v=19`

**Still human-only:** Desert Act 5 trail-brake hairpin; Forest gravel power-slide; Mountain tarmac limit catch.

---

# Sprints 35–40 — AAA foundations (23 Aug 2026)

**Automated:** `node tools/qa-sprint35-40-matrix.mjs` → **SHIP**  
**GPT handoff:** [`docs/GPT-OPTIMIZATION-BRIEF.md`](GPT-OPTIMIZATION-BRIEF.md)

| Sprint | Player moment | Proof |
|--------|---------------|-------|
| **35** | Wall rubs darken body paint (wear tiers) | `qa-sprint35-damage.mjs` + `dcc-pipeline.mjs` |
| **36** | Authored co-driver calls + spring steering wheel in POV | `qa-sprint36-pace.mjs` |
| **37** | Tunnel/forest reverb on engine + tires | `qa-sprint37-audio.mjs` |
| **38** | Per-surface Pacejka + 60 Hz fixed-step (verified) | `qa-sprint38-physics.mjs` |
| **39** | iGPU perf tier drops DPR/bloom under load | `qa-sprint39-perf.mjs` |
| **40** | Longer Act 8 stages; Time Attack ghost; telemetry export | `qa-sprint40-telemetry.mjs` |

**Cache:** `?v=320` · `config.js?v=122` · `vehicle.js?v=67`

**Still human-only:** headed iGPU matrix; staff ghost JSON; mocap BVH; online ghost server; photogrammetry capture.

---

# Camera overhaul — close chase + seated POV + live mirror (23 Aug 2026)

**Player moment:** Default medium chase sits close and low like Sega Rally (car large in the lower third). C cycles POV → medium → far in ~0.3 s with no hang. POV is the driver seat: windshield/roof stripped, cabin + working ST205 cluster, animated wheel, and a rearview that renders the road behind.

| Deliverable | Status |
|-------------|--------|
| **Medium chase** `back: 3.98` `height: 1.80` `fov: 62` | **Done** (`config.js` `CAMERA.views`) |
| **C-key blend** 0.3 s smoothstep, then POV hard-locks to `rig.head` | **Done** (`game.js` `_chaseCam`) |
| **Seated eye** in front of the seat, looking over the dash/hood; no cabin glass | **Done** (`celica.js` `buildPovRig` / `tagWindshield`) |
| **Gauges** ~48 mm dials, vmax/redline from `CARS` spec | **Done** |
| **Rearview** 640×200 RT every POV frame on physical glass | **Done** (`GFX.mirrorEvery: 1`) |
| `tools/qa-sprint37-camera.mjs` | **PASS** |
| `tools/qa-sprint19-speed.mjs` | **PASS** (no FOV/speed regression) |
| `tools/qa-static-audit.mjs` | **PASS** (config unified at `?v=123`) |

**Cache:** `main.js?v=541` · `game.js?v=541` · `config.js?v=125` · `celica.js?v=109` · `ai.js?v=98` · `cockpit-anim.js?v=3`

**Medium chase (23 Aug 2026):** `back` 3.18 → 3.98 (+25%), `height` 1.24 → 1.80 (+45%). Default chase sits further off the bumper and higher so the car is not filling the lower third.

**LHD POV (23 Aug 2026):** Driver eye is clamped to negative X. If the GLB has a named rim (`STEER_HR` / `SteeringWheel`), that mesh is reparented and shown in cockpit view — no second torus. RHD rims are shifted across to the left seat. Cars without a modeled wheel still get the procedural rim.

**Still human-only:** headed C-key cycle on Desert (medium size vs lakeside reference; POV gauges + mirror while turning). LHD Celica: one modeled wheel, no duplicate torus.

---

# Sprint 38 — Environment clip-through (23 Aug 2026)

**Player moment:** The car must not pass through land, cliff, berm, rock, or house polygons on any stage. Stage 3 (Mountain / Tour de Corse) was the worst: the authored hairpin cutting sat 18.5 m inside a 15–18 m radius turn, so the back face occupied the opposite carriageway with no collider.

**CEO:** Ship-blocker. Close it; do not carry a PARTIAL.

| Change | Status |
|--------|--------|
| `_nearestRoad` searches local spline **and** nearby grid cells (opposite hairpin arm) | **Done** |
| Stage 3 cliff sits at `half + ROAD_VERGE + 3.2` with ~3.2 m thickness; columns skipped unless `_driveClear` on face, mid, and back | **Done** |
| `_driveClear` cardinal samples for large footprints (rocks, berms, village, wild scatter) | **Done** |
| Colliders whose sphere overlaps painted asphalt are scrubbed; verge walls stay | **Done** |
| Mountain land trench chase **48 m**; landmark wash lateral **46 m** | **Done** |
| `tools/qa-env-clip.mjs` | **run this sprint** |
| `tools/qa-static-audit.mjs` | **run this sprint** |
| `tools/qa-sprint26-solid.mjs` | **run this sprint** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=336`** · `track.js?v=164`

**Still human-only:** one full Mountain lap for residual visual clip at jumps / village cobbles.

---

# Sprint 39 — Launch/brake fore-aft hop (23 Aug 2026)

**Player moment:** On throttle (and on the brakes) the car was nodding rapidly forward and back — a glitchy spring. At rest it was planted. It must look solid under accel and brake.

**Cause:** Bang-bang traction control (linear gain 8) plus algebraic kappa plus per-substep load transfer made a ~240 Hz longitudinal oscillator. A 12 rad/s pitch spring on `_ax` painted that chatter onto the mesh, so the bumper bobbed in the chase camera.

**CEO:** Close it. Do not ship a car that jitters on a straight.

| Change | Status |
|--------|--------|
| Visual accel/brake squat removed; mesh pitch is the road plane + one-shot landing squash | **Done** |
| Kappa uses first-order relaxation (`RELAX_KAPPA = 0.14`) like slip angle | **Done** |
| TC / brake-hold cuts are quadratic, not linear gain 8 / 9 | **Done** |
| `_ax` (load transfer) blended once per 60 Hz frame, frozen during tire substeps | **Done** |
| `tools/qa-sprint28-launch.mjs` contracts for the above | **run this sprint** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=339`** · `vehicle.js?v=69` · `ai.js?v=99`

**Still human-only (closed Sprint 41):** 10-second dead-stop launch — hull shimmer persisted after this sprint; see Sprint 41.

---

# Sprint 40 — iPhone Safari play (23 Aug 2026)

**Player moment:** Open the game on an iPhone in Safari, tap through the menus, then drive with on-screen GAS/BRAKE and either a left-hand STEER pad or TILT (phone as a wheel). Pedals stay on the right in both modes.

**CEO:** This is the difference between “desktop only” and a shippable arcade rally in the pocket.

| Change | Status |
|--------|--------|
| iOS viewport-fit, web-app meta, 100dvh, safe-area, 48px menu hits | **Done** |
| Touch overlay: analog steer, GAS, BRAKE, HB, pause, camera | **Done** |
| TILT mode — `DeviceOrientationEvent.requestPermission` on the TILT tap | **Done** |
| Renderer no longer floors at 640×360 (broke iPhone width) | **Done** |
| Phone starts at DPR 0.78 / 2048 shadows | **Done** |
| `tools/qa-mobile-controls.mjs` | **run this sprint** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=341`** · `input.js?v=38` · `touch-controls.js?v=2` · `css/game.css?v=23`

**Still human-only:** iPhone Safari landscape lap; grant motion on TILT; confirm steer direction feels like turning a wheel.

---

# Sprint 41 — Accel body bounce closeout (24 Aug 2026)

**Player moment:** Floor it from a standstill. The Celica mesh must stay a solid car — no springy fore-aft nod, no bumper shimmer in the chase cam. Standstill was already planted; throttle was still glitchy after Sprint 39.

**Cause:** Sprint 39 removed visual squat but left three amplifiers: (1) raw Pacejka Fx still integrated into `vx` every 240 Hz substep, (2) axle-height noise painted onto mesh pitch around a contact-patch origin, (3) chase cam lagged in XZ so any leftover hop read as the body bouncing in frame.

**CEO:** Close it. A car that jitters on a straight does not ship.

| Change | Status |
|--------|--------|
| Player `vx` integrates filtered `_axDrive` (`AX_DRIVE_RATE = 11`) | **Done** |
| Visual pitch follows deadzoned `_visPitch` (not raw `_roadPitch`) | **Done** |
| Deck plant target filtered (`DECK_FILT_RATE = 8`) so ribbon noise cannot bob Y | **Done** |
| `WHEEL_I` 3.6 → 6.4, `RELAX_KAPPA` 0.14 → 0.22 | **Done** |
| Medium chase locks XZ to the live car | **Done** |
| `tools/qa-sprint28-launch.mjs` contracts | **run this sprint** |
| `tools/qa-launch-stable.mjs` live throttle probe | **run this sprint** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=343`** · `vehicle.js?v=71` · `ai.js?v=101`

**Still human-only:** one 10-second launch in the headed game to confirm the mesh looks like a rigid body.

---

# Sprint 42 — POV steering wheel column spin (24 Aug 2026)

**Player moment:** C into POV, turn the wheel. The rim must rotate around the steering column like a real car — not tumble on a sideways axis.

**Cause:** `rotateOnAxis` used a **world-AABB** “thinnest” axis. GLB rims are tilted; that axis was car-space, then applied as a **local** axis, so the modeled wheel cartwheeled.

**CEO:** Close it. A broken steering wheel in the seat is not shippable.

| Change | Status |
|--------|--------|
| Local-space disc axis + `steer-spin` pivot whose +Z is the column | **Done** |
| Cockpit anim sets `rotation.z` on that pivot (same as the procedural torus) | **Done** |
| `tools/qa-pov-steer.mjs` static + title-car live | **run this sprint** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=344`** · `celica.js?v=110` · `cockpit-anim.js?v=4` · `ai.js?v=102`

**Still human-only:** one headed POV lock-to-lock to confirm the spokes turn in the wheel plane.

---

# Sprint 43 — POV speedo / tach (24 Aug 2026)

**Player moment:** C into the seat. The two analog dials must read like the chase cluster — 0 at 7:30, clockwise to 4:30, MPH 0–140 and RPM ×1000 to 9 — with needles sitting on 0 at rest and climbing with speed/revs. Switching C must not change the scale.

**Cause:** In-car faces used a different zero (10:30), the 3D needle was a +Y blade (12 o'clock rest), each disc was Y-flipped so numerals were mirrored, the tach spring was underdamped plus idle `performance.now()` jitter, and the speedo was km/h 0–250. Parenting the needle under `scale.x = -1` also hid/reversed the blade.

**CEO:** Close it. A broken cluster in the seat is not shippable.

| Change | Status |
|--------|--------|
| Face ticks + needle angle match chase HUD (`GAUGE_START = 0.75π`, sweep 1.5π) | **Done** |
| Needle along +X; live `rotation.z = -(START + SWEEP * t)` | **Done** |
| Face-only Y-flip + `scale.x = -1` so numerals read; needle stays unmirrored | **Done** |
| Speedo MPH 0–140, tach ×1000 to 9, overdamped springs | **Done** |
| `tools/qa-pov-gauges.mjs` static + title-car live | **run this sprint** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=345`** · `celica.js?v=111` · `ai.js?v=103`

**Still human-only:** headed C into POV at rest (needles on 0) then a short pull to confirm both climb clockwise.

---

# Sprint 44 — POV rearview glass (24 Aug 2026)

**Player moment:** C into the seat. The interior rearview must show the road behind you — sky, trees, rivals — not a black rectangle.

**Cause:** Three stacked defects. (1) ACES was baked into a `NoColorSpace` RT, then the canvas encoded it as linear → crushed to black. (2) The live plane sat on the **windshield** side of the frame, so the driver saw dark plastic. (3) GLB meshes named `mirror` were shaded as chrome and left visible, covering the RT.

**CEO:** Close it. A black mirror in the seat is not shippable.

| Change | Status |
|--------|--------|
| Capture `NoToneMapping` into an sRGB RT; glass stays `toneMapped: false` | **Done** |
| Glass on the seat side (`z = -0.01`), `depthTest: false` | **Done** |
| Hide GLB interior rearview; wing mirrors stay | **Done** |
| `tools/qa-pov-mirror.mjs` static + live RT luma | **run this sprint** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=346`** · `celica.js?v=112` · `ai.js?v=104`

**Still human-only:** headed C into POV on Desert — confirm the glass shows the start grid / road behind, not black.

---

# Sprint 45 — Seamless C-key camera blend (24 Aug 2026)

**Player moment:** Press C. The lens must *move* to the next view (POV / medium / far) in about a fifth of a second — no cut, no hang, no extra load, no hesitation.

**Cause:** A blend timer existed, but C also swapped the cockpit, hid the windshield, toggled the chase HUD, and kicked a full rearview capture on the **same frame**. FOV used the ease value as a follow rate, so it sat still then snapped. `setCockpitView` walked the whole GLB twice.

**CEO:** Close it. Camera swaps are a moment every player hits.

| Change | Status |
|--------|--------|
| C only records the from-pose; cockpit attaches mid-blend | **Done** |
| FOV / near lerp with the pose; 0.22s smoothstep | **Done** |
| Hide cache, no live GLB traverse; no mirror capture on the C frame | **Done** |
| Chase cluster fades instead of `display:none` pop | **Done** |
| `tools/qa-cam-blend.mjs` static + live step probe | **run this sprint** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=347`** · `config.js?v=127` · `celica.js?v=113` · `ai.js?v=105` · `css/game.css?v=24`

**Still human-only:** headed C cycle on Desert (POV → medium → far) while rolling — confirm the lens eases and never hitch-stops.

---

# Sprint 47 — Desert sand-on-road + env clip (24 Aug 2026)

**Player moment:** Stage 1 opening through the gravel corridor and Bowl — the racing line is asphalt, not a dune, and the car does not ghost through sand banks, rocks, or berms.

**Cause:** Desert land had no chase-flatten (Forest/Mountain already did). Dunes rose the instant the ~29 m trench ended, so 10 m land cells interpolated sand onto the ribbon and the inside of radius-36 gravel corners. An 8.2 m dune skirt folded across tight bends. Roadside rocks planted at half+9 m overlapped the chase; Bowl berms at half+9.2 failed `_driveClear` so they were visual-only (or skipped) while leftover rocks had colliders smaller than the mesh.

**CEO:** Ship-blocker on the teaching stage. Close it; do not carry a PARTIAL.

| Change | Status |
|--------|--------|
| Full-stage Desert land wash (`lateral: 44`) | **Done** |
| Chase-flat in `_groundHeight` + `_addLandTile` (half+48, 0.03 bank) | **Done** |
| In-lane refuse padded a full land cell past the verge | **Done** |
| Skirt 8.2 m → 2.6 m tuck; outer Y capped below the deck | **Done** |
| Rocks/cacti/berms/herd plant past the verge; colliders match the mesh | **Done** |
| `tools/qa-desert-clip.mjs` static + headed corridor probe | **PASS** — in-lane land −0.72 m over 104 stations; verge −0.72 m; 351 colliders off the lane |
| `tools/qa-env-clip.mjs` Mountain regression | **PASS** — in-lane −0.78 m over 85 stations |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=348`** · `track.js?v=165`

**Still human-only:** 2-minute Desert drive — opening straights, gravel snakes, Bowl — confirm no sand on the painted lane and no chassis through rocks.

---

# Sprint 48 — Desert rock-bridge underpass (24 Aug 2026)

**Player moment:** Late Stage 1 — drive *under* the sandstone arch. The hole is empty. The chassis does not clip the lintel, piers, or a sand slab filling the bottom.

**Cause:** Land under the arch used `_nearestRoad` Y, so the finale hairpin's opposite arm could refill the hole with a car-height dune. Ceiling ribs sat on the portal threshold. Portal scrub needed two AABB corners inside the prism, so a slab whose corners sat outside still filled the drive-through. Chase-cam fade on the lintel also read as the car ghosting through rock.

**CEO:** Close it. The underpass is a moment every Desert lap hits.

| Change | Status |
|--------|--------|
| Shared `_desertBridgePortal` (`openH` **12.8**, `clearHalfD` **16**, half+4.8 wide) | **Done** |
| `_underpassFloorY` uses the bridge sample, not nearest-road | **Done** |
| Lintel underside 0.55 m above the hole; no ceiling ribs in the prism | **Done** |
| Conservative AABB portal scrub; rubble only on pier caps | **Done** |
| `tools/qa-desert-bridge-portal.mjs` + `qa-sprint32-desert-finale.mjs` | **PASS** — openH 12.8, hole 16 m deep, 0 invaders, 0 car-envelope hits, land −0.95 m, car on deck |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=349`** · `track.js?v=166`

**Still human-only:** headed Desert drive through the arch — confirm empty sky/shadow under the lintel, no roof-through-rock.

---

# Sprint 49 — All-stage roadway clear (24 Aug 2026)

**Player moment:** Every stage, including hairpins — the painted lane is asphalt, not a bank, and solid props do not sit in the car's envelope.

**Cause:** `_nearestRoad` only searched ±2 grid cells (64 m). Hairpin opposite arms at 70–90 m were invisible, so land verts and plants used the wrong ribbon. Lakeside catch-fence posts sat at half+0.6 m on the kerb.

**CEO:** Close the PARTIAL. Do not ship a stage whose inside line is a hill.

| Change | Status |
|--------|--------|
| Nearby-segment search ±3 cells (96 m); `minOver` / `overlapBed` on every ribbon test | **Done** |
| `_groundHeight` + `_addLandTile` flatten to any overlapping arm; Desert underpass floor still wins first | **Done** |
| Lakeside full-stage wash (`lateral: 48`); every biome skirt is a short tuck | **Done** |
| `_ribbonClear` / `_driveClear` / collider scrub / `_bumpNearRoad` use `minOver` | **Done** |
| Lakeside barriers past `ROAD_VERGE + 1.4` with `_ribbonClear` | **Done** |
| `tools/qa-env-clip.mjs` headed desert/forest/mountain/lakeside | **PASS** — in-lane land −0.72 / −0.72 / −0.78 / −0.28 m; 0 colliders on asphalt (284 / 119 / 60 / 49) |
| `tools/qa-desert-clip.mjs` | **PASS** — in-lane −0.72 m over 104 stations; 284 colliders off the lane |
| `tools/qa-sprint32-desert-finale.mjs` + `qa-static-audit.mjs` | **PASS** |
| `tools/qa-desert-bridge-portal.mjs` | **PASS** — 0 invaders, 0 car-envelope hits, land −0.95 m, car on deck |

**Cache:** `index.html` / `main.js` **`?v=351`** · `track.js?v=168`

**Still human-only:** 2-minute drive of a Forest or Mountain hairpin — confirm the inside line is tarmac and the chassis does not sink into a bank.

---

# Sprint 50 — Instant POV seat + cheap preloaded mirror (24 Aug 2026)

**Player moment:** C into the seat on the grid, standing still. Cabin and gauges are there immediately. No windshield flash, no hitch, no waiting until the car rolls. The rearview already shows road/sky.

**Cause:** Cabin swap and the first rearview capture were deferred until the blend (and felt like they waited for speed). Mirror was 512×160 with a 620 m far plane — a full extra scene on the first seated frame.

**CEO:** Same-frame work that used to hitch must be instant. Preload it. Never hitch again.

| Change | Status |
|--------|--------|
| Entering POV calls `_applyCockpitCam` on the C press (windshield unused from inside) | **Done** |
| Tiny mirror RT **180×56**, far **72 m**, capture every other POV frame | **Done** |
| `_warmPov` compiles cabin + one mirror grab during load | **Done** |
| Pose still eases 0.22 s (lens move, not a cut) | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=352`**

---

# Sprint 51 — Desert finale underpass is a closed hill-cut (24 Aug 2026)

**Player moment:** Late Stage 1 — drive *through* a sandstone ridge. Walls and ceiling are the front faces of closed boxes. No road/land undersides. No shard interiors. The car fits under the lintel.

**Status:** **Cut (Sprint 524)** — closed underpass boxes were removed from the player path (fill-rate / clipping). Desert tunnel bore + planar wall bumps (Sprint 52) remain. Do not restore full closed-box underpass on default tiers.

**Original cause:** A heightmap cannot be a tunnel. Flattening land under the deck opened a trench of FrontSide backs.

| Change | Status |
|--------|--------|
| Closed box hill-cut underpass on Desert finale | **Cut (S524)** |
| Desert tunnel lining + planar wall bumps | **Done** (Sprint 52) |

**Proof (tunnel / solid):** `node tools/qa-sprint26-solid.mjs` · `node tools/qa-sprint30-tunnel.mjs`

---

# Sprint 52 — Tunnel / underpass bump matches the lining (24 Aug 2026)

**Player moment:** Clip the sandstone underpass or the desert tunnel wall — the car kisses the **visible inner face**, not an invisible bulge a metre into the lane, and does not slip through the rock between sparse bumps.

**Cause:** Wall hits were spheres at the **core** of thick boxes. Combined with the car radius they fired early and left gaps along the lining.

**CEO:** The scrape has to be the wall you see.

| Change | Status |
|--------|--------|
| Planar `kind: "wall"` slabs on the inner faces (`_wallFace`) | **Done** |
| Underpass: one slab per lining at ±`clearHalfW` | **Done** |
| Desert tunnel: one slab per segment on the mesh inner face (`half + 0.25`) | **Done** |
| `glanceObstacles` uses car OBB vs the plane (not a circle in the rock) | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=354`** · `track.js?v=170` · `collide.js?v=33`

**Proof:** `node tools/qa-sprint26-solid.mjs` · `node tools/qa-sprint32-desert-finale.mjs`

---

# Sprint 53 — Focus ST scale (player + AI + title)

**Player moment:** Focus ST sits at the same 4.36 m as a real Mk2/Mk3 ST next to the Celica, whether you drive it, race against it, or park it on the title pad.

**Cause:** `assets/focus/focus.glb` (and the rival LOD) is a Sketchfab export ~11.1 m long. `fitToRallyCar` applied `root.scale = 4.36 / 11.1 ≈ 0.39` on the **wrapper**. That did shrink the bodyshell, but it also shrunk cockpit, lamps, and POV (parented in metres to the wrapper). AI clones of the same template inherited the same squash.

**Fix:**
- Race settle no longer forces post/shadows back on after the tier apply
 Measure visible bodywork (skip studio helpers), keep the wrapper at scale 1, and `multiplyScalar` the **inner** GLB scene so hero, rival, ghost, and title all land on `CARS.focus.lengthM` (4.36 m). Other garage cars were already ~1:1 so they do not change size.

| Change | Status |
|--------|--------|
| `fitToRallyCar` scales inner scene, wrapper stays 1 | **Done** |
| Length / yaw from `visibleMeshBounds` | **Done** |
| Same path for `loadCarGltf` and `loadRivalGltf` | **Done** |
| `lengthM` 4.36 kept as the ST target | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=355`** · `celica.js?v=114`

**Proof:** `node tools/qa-car-scale.mjs` · `node tools/qa-focus-scale.mjs` · `node tools/qa-static-audit.mjs`

---

# Sprint 54 — AI pack planted hull (24 Aug 2026)

**Player moment:** Race a pack. The rivals no longer hop fore-aft on throttle the way the player Celica used to. They sit on the road like real cars.

**Cause:** Sprint 41 / 53 planted the **player** hull (filtered `_axDrive`, deadzoned vis-pitch, deck plant). Opponents still ran `lowDetail`: raw Pacejka Fx into `vx`, vis-pitch follow at 14/s, and a max-step height slew on unfiltered ribbon samples. Same oscillator, 14 cars.

**Fix:** Share the planted hull. Rivals still use cheap racing-line road probes and fewer tire substeps (frame budget). They now filter long-accel, follow vis-pitch at the player rate, and plant the deck the same way.

| Change | Status |
|--------|--------|
| `_axDrive` filter on every chassis | **Done** |
| Vis-pitch deadzone + `VIS_PITCH_RATE` for AI | **Done** |
| Deck filter + direct plant for AI (no max-step slew) | **Done** |
| Cheap `_axleRoadCheap` probes kept | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=356`** · `vehicle.js?v=73` · `ai.js?v=107`

**Proof:** `node tools/qa-sprint28-launch.mjs` · `node tools/qa-static-audit.mjs`

---

# Sprint 55 — POV cockpit: no A-pillars, gauges face the driver, live rearview (24 Aug 2026)

**Player moment:** Press C into the seat. The windshield is an open aperture — no black A-pillar bar in the lens. The tach and speedo face you and read like the chase HUD. The interior mirror shows the road behind, not a black rectangle.

**Cause:** Procedural A-pillars sat at eye height in the POV frustum. Gauge discs used Y=180 plus `scale.x = -1`, which after `lookAt` aimed the printed face at the windshield. The rearview camera sat *at the interior glass* looking into the hidden cabin (black), and the RT was sRGB sampled as linear by `MeshBasicMaterial`.

**Fix:** Drop the cabin A-pillars and hide GLB window-frame meshes in POV. Aim the cluster at the seated eye so CircleGeometry’s +Z faces the driver. Capture the mirror from behind the bumper into a linear RT.

| Change | Status |
|--------|--------|
| Procedural A-pillars removed; GLB frames tagged `povShell` | **Done** |
| Gauge cluster `lookAt` the driver eye; no Y=180 / negative scale | **Done** |
| Rearview capture camera behind the bumper (`mirrorCamZ`) | **Done** |
| Linear SRGB RT + NoToneMapping; glass on driver-facing +Z | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=357`** · `celica.js?v=115`

**Proof:** `node tools/qa-pov-gauges.mjs` · `node tools/qa-pov-mirror.mjs` · `node tools/qa-static-audit.mjs`

---

# Sprint 56 — Title → countdown: no scenery/lighting pop-in (24 Aug 2026)

**Player moment:** Leave the title, pick a car and course, and the 3-2-1 starts on a fully drawn, fully lit stage. Terrain does not stream in during countdown. Exposure / IBL / shadows do not snap. The loading overlay covers GPU settle even when the track is already cached.

**Cause:** Cached stages skipped the loading overlay and went straight to countdown. IBL baked on a `setTimeout(0)` after HUD. Stream chunks around the grid stayed hidden until the first countdown frames. The first expensive present dumped post/DPR quality, which looked like a lighting glitch.

**Fix:** Always keep the loading overlay up through GPU settle. Bake IBL synchronously. Pre-warm stream around the start grid, compile shaders, and draw two shadowed frames before HUD. Skip quality adapt and force shadow updates through countdown.

| Change | Status |
|--------|--------|
| Loading overlay always covers GPU settle (hot cache skips terrain rebuild only) | **Done** |
| Sync IBL bake — no deferred sky-env snap | **Done** |
| `prewarmAround` + `settle` stream radius 720 m at the grid | **Done** |
| `renderer.compile` + 2 dummy shadowed presents under overlay | **Done** |
| Countdown skips post/DPR adapt; forces shadow updates | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=358`** · `track.js?v=172` · `config.js?v=128`

**Proof:** `node tools/qa-sprint34-preload.mjs` · `node tools/qa-sprint32-desert-finale.mjs` · `node tools/qa-static-audit.mjs`




---

# Sprint 57 — Splash / title hitch (24 Aug 2026)

**Player moment:** Open the game. PRESS START is immediately clickable and the attract car orbits without stutters. Heavy stage/prop work waits until after start.

**Cause:** Splash was doing race boot: every prop GLB, four `Track.create` jobs, 4096² shadows, live cube captures every 3 frames, uncapped FPS, 2× DPR, and IBL on the first frame.

**Fix:** Title is a cheap showroom (1024 shadows every 4 frames, 1.25 DPR, 60 Hz cap, low post, delayed IBL, no cube captures). Props + Desert preload start on PRESS START; the rest of the cup queues 4s later.

| Change | Status |
|--------|--------|
| No prop kit / track build / extra car clones on splash | **Done** |
| Title 1024 shadows, 1.25 DPR, 60 Hz, low post | **Done** |
| Live cube reflections off on title; IBL after 480 ms | **Done** |
| PRESS START starts Desert preload + prop kit | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=360`**

**Proof:** `node tools/qa-sprint34-preload.mjs` · `node tools/qa-sprint32-desert-finale.mjs` · `node tools/qa-static-audit.mjs`

---

# Sprint 58 — Title attract LOD (24 Aug 2026)

**Player moment:** Open the game. The rotating title car appears as soon as the ~3 MB rival shell is in, not after every hero GLB and cockpit clone.

**Cause:** Splash waited on `prepareCelica()` (all six chassis heroes) then `createPlayerCar()` (cockpit, beams, POV rig) just to orbit on the pad.

**Fix:** Load `assets/<car>/rival.glb` first, clone it with original livery and no cockpit, and only promote to the hero mesh when a race starts.

| Change | Status |
|--------|--------|
| `prepareTitleCar` + `createTitleCar` (rival LOD, original paint) | **Done** |
| Title / menu keep the LOD; race calls `_promotePlayerCar` | **Done** |
| Full garage load still runs after the attract car is up | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=362`** · `celica.js?v=116`

**Proof:** `node tools/qa-sprint58-title-lod.mjs` · `node tools/qa-sprint34-preload.mjs` · `node tools/qa-sprint32-desert-finale.mjs` · `node tools/qa-static-audit.mjs`

---

# Sprint 59 — Distance mesh LOD (24 Aug 2026)

**Player moment:** Drive Forest / Mountain. Trees beside the car stay authored GLB. The hillside and horizon swap to cheap 3-plane cards. Far pack cars stop punching 14 extra shadow casters into the map. Frame time holds when the gallery is full.

**Cause:** Streamed slices still drew every trunk+canopy GLB out to fog (~900 m). Horizon rings used the same HD pack. Rival shadows never dropped with distance.

**Fix:** Classic mesh LOD. Near chunk = hi GLB. Beyond `STREAM.lodNear` (108 m, with hysteresis) = painted crown cards. Horizon trees are cards only. Rivals beyond 92 m disable `castShadow`.

| Change | Status |
|--------|--------|
| Dual-batch tree LOD (`lod: "hi"` / `"lo"`) with stream hysteresis | **Done** |
| Horizon treeline uses card impostors | **Done** |
| Far rival shadow casters culled | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=364`** · `config.js?v=129` · `track.js?v=173` · `trees.js?v=31`

**Proof:** `node tools/qa-sprint59-lod.mjs` · `node tools/qa-sprint58-title-lod.mjs` · `node tools/qa-sprint34-preload.mjs` · `node tools/qa-sprint32-desert-finale.mjs` · `node tools/qa-static-audit.mjs`

---

# Sprint 60 — Screen + camera hitch cut (24 Aug 2026)

**Player moment:** PRESS START, car/course picks, and C-key camera swaps stay at 60 Hz. No freeze between title and SELECT MODE, no hitch when returning to the attract pad, no stall when the lens eases POV → medium → far.

**Cause:** C applied the cabin on the same frame as the click (shader + mirror). Mid-race quality adapt reallocated the canvas whenever DPR hunted. PRESS START rebuilt title lights and warmed cars on the click. Coming back from a race disposed the whole stage on that frame and shrank the 4096 shadow atlas to 1024. Title orbit called `setCockpitView` every tick. POV compile was keyed only by course+car, so a title LOD warm skipped the hero cabin.

**Fix:** C only records a 0.22s blend; the cabin seats mid-ease and the mirror waits two frames. Adapt changes post quality only. PRESS START shows the menu then warms next frame. Title hides the stage immediately and disposes on the following frame. Shadow atlas never shrinks. `setCockpitView` no-ops when already in the requested mode. POV warm keys the live mesh uuid.

| Change | Status |
|--------|--------|
| C-key blend-only; cabin + mirror deferred | **Done** |
| No mid-race canvas / DPR realloc | **Done** |
| PRESS START / return-to-title work split across frames | **Done** |
| Shadow atlas never shrinks | **Done** |
| `setCockpitView` early-out + POV warm by mesh uuid | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=366`** · `celica.js?v=117`

**Proof:** `node tools/qa-sprint60-smooth.mjs` · `node tools/qa-sprint37-camera.mjs` · `node tools/qa-sprint59-lod.mjs` · `node tools/qa-sprint58-title-lod.mjs` · `node tools/qa-sprint34-preload.mjs` · `node tools/qa-sprint32-desert-finale.mjs` · `node tools/qa-static-audit.mjs`

---

# Sprint 61 — Brighter, lower-contrast lighting (24 Aug 2026)

**Player moment:** Title pad and every stage read as daylight, not a crushed grade. Shade under trees and in the Desert underpass stays readable. Paint and road still have shape, without the previous hard key / black fill split.

**Cause:** Sun intensity sat well above fill/hemi/ambient, post `gradeContrast` was 1.14, and vignette 0.34 crushed the corners. Cranking the sun would have made the problem worse.

**Fix:** Raise hemisphere, fill, ambient, exposure, sky exposure, and IBL. Lower sun intensity, post contrast, and vignette. Make vignette actually scale with its uniform (it used to darken corners even when the slider was near zero). Soften highlight rolloff. Tunnel shade keeps more fill so the bore is not a black hole.

| Change | Status |
|--------|--------|
| VISUAL `gradeContrast` 1.14 → 0.96, `vignette` 0.34 → 0.08 | **Done** |
| Post vignette now scales with the uniform (no baked corner crush) | **Done** |
| All stages: fill/hemi/ambient + exposure up, `sunInt` down | **Done** |
| IBL `worldEnvIntensity` / `carEnvIntensity` above 1.0 | **Done** |
| Tunnel `ambientFloor` / retain raised | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=368`** · `config.js?v=131` · `lighting-rig.js?v=5` · `postfx.js?v=12` · `sky.js?v=17`

**Proof:** `node tools/qa-sprint61-lighting.mjs` · `node tools/qa-sprint60-smooth.mjs` · `node tools/qa-sprint37-camera.mjs` · `node tools/qa-sprint59-lod.mjs` · `node tools/qa-sprint58-title-lod.mjs` · `node tools/qa-sprint34-preload.mjs` · `node tools/qa-sprint32-desert-finale.mjs` · `node tools/qa-static-audit.mjs`

---

# Sprint 62 — Roadway env-clip close (24 Aug 2026)

**Player moment:** The painted lane is asphalt. Dunes, banks, rocks, and trees do not sit on it or poke through it. The car does not drive through a hillside that was drawn on the racing line.

**Cause:** Land verts could still be raised to a nearer, higher hairpin arm. Lakeside land sat only 28 cm under the deck (z-fight / poke-through). Nearby-ribbon search missed opposite arms past ~96 m. Instanced GLB rocks/trees were tested with a footprint smaller than the mesh.

**Fix:** Widen hairpin segment search. Sink land ~1.1 m under every overlapping ribbon and never raise it. Push the road in depth so the deck wins z. Strip props 8 m past the painted edge.

| Change | Status |
|--------|--------|
| Nearby-segment search ±28 samples / ±5 grid cells | **Done** |
| Overlap pad `VERGE + 2.4× cell` (min 32 m) | **Done** |
| Land bed ~1.15 m under deck; lakeside 0.28 → 0.9 | **Done** |
| Final `minOver` sink so straddling tris stay a floor | **Done** |
| Road `polygonOffset` −4/−8, `renderOrder` 2 | **Done** |
| `ROAD_VERGE` 8.2 m + GLB strip 5.8 / forest 8.6 | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=369`** · `track.js?v=174`

**Proof:** `node tools/qa-env-clip.mjs` · `node tools/qa-desert-clip.mjs` · `node tools/qa-sprint32-desert-finale.mjs` · `node tools/qa-sprint59-lod.mjs` · `node tools/qa-sprint61-lighting.mjs` · `node tools/qa-static-audit.mjs`

---

# Sprint 63 — Tire contact on the roadway (24 Aug 2026)

**Player moment:** At rest and on a climb, the rubber sits on the asphalt — not hovering a tyre’s width above it, and not buried through the deck.

**Cause:** Physics origin is already the contact patch (`plantOnContactPatch`). Chassis Y then subtracted **9 cm** (`TIRE_PLANT`) from the visual deck, so the car sat in the tarmac. An **8/s** deck filter lagged ~30 cm on hills, and a **5/s** visual-pitch follow left one axle in the air. A 38% bias toward the lower axle made that worse.

**Fix:** Embed 1.4 cm. Plant Y on the front/rear axle midpoint. Follow real deck/pitch changes quickly; filter only centimetre ribbon noise.

| Change | Status |
|--------|--------|
| `TIRE_PLANT` 0.09 → 0.014 | **Done** |
| `_roadDeckY` = `midH - TIRE_PLANT` (no lower-axle bias) | **Done** |
| Two-band deck follow (`DECK_NOISE_BAND` + `deckFollowRate`) | **Done** |
| Visual pitch 16/s with snap on real grades | **Done** |
| Ground mesh pitch follow 8/s → 24/s | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=370`** · `vehicle.js?v=74`

**Proof:** `node tools/qa-sprint63-plant.mjs` · `node tools/qa-sprint61-lighting.mjs` · `node tools/qa-sprint60-smooth.mjs` · `node tools/qa-sprint59-lod.mjs` · `node tools/qa-sprint58-title-lod.mjs` · `node tools/qa-sprint32-desert-finale.mjs` · `node tools/qa-static-audit.mjs`

**Still human-only:** 2-minute drive — standstill plant, then a crest — rubber stays on the painted lane.

---

# Sprint 64 — AI racing line stays on the road (24 Aug 2026)

**Player moment:** Race a pack. Rivals take an out-in-out line on the asphalt instead of sliding off into the dirt on every hairpin.

**Cause:** Lanes sat at **±2.8 m** and an apex of **1.4 m** pinned chassis origins on the painted edge (wheels already over it). Traffic dodges shoved them the rest of the way out, hairpin handbrakes fired off-road, and they stayed flat on the throttle in the dirt.

**Fix:** Keep slots inside **~1.3 m**. Build a speed-aware out-in-out envelope with a 2.2 m edge keep-out. Cap dodges inside that envelope. Brake more for tight bends. Handbrake only while still on the ribbon. Lift once a wheel is in the dirt.

| Change | Status |
|--------|--------|
| Lanes / grid ±1.3 m | **Done** |
| `racingLat` out-in-out + `safeHalfWidth` | **Done** |
| Traffic dodge capped at 48% of envelope | **Done** |
| Tight-corner speed cap (`tightMul`) | **Done** |
| On-road-only hairpin flick + dirt lift | **Done** |
| Sprint 26 pace formula unchanged | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=371`** · `ai.js?v=108`

**Proof:** `node tools/qa-sprint64-line.mjs` · `node tools/qa-sprint26-driving.mjs` · `node tools/qa-sprint63-plant.mjs` · `node tools/qa-static-audit.mjs`

**Still human-only:** 2-minute pack race — Desert hairpin and a Forest sweeper — rivals stay on the painted lane.

---

# Sprint 65 — Blocking rivals go transparent (24 Aug 2026)

**Player moment:** Chase cam. A pack car sits between the lens and the player's car. That rival's body goes see-through so the player's car stays readable. POV does not ghost the pack (the camera *is* the player). The rearview stays solid.

**Cause:** Shared rival paints (`userData.shared`) meant mutating opacity on one AI car would ghost the whole grid. Painting before the mirror capture would also bake a hollow pack into the rearview.

**Fix:** Clone that car's materials on first hit. Tube-test the rival hull on the cam→player sightline. Store ghost amount, paint solid for mirror/cube, then paint leftover opacity for the chase view.

| Change | Status |
|--------|--------|
| `updatePackSeeThrough` + `paintPackSeeThrough` | **Done** |
| Per-car material clone (`packFadeClone`) | **Done** |
| POV / title / menu skip | **Done** |
| Solid pack for mirror, then ghost for chase | **Done** |
| Player mesh excluded from the fade pack | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=373`** · `track.js?v=176` · `occlusion-fade.js?v=8`

**Proof:** `node tools/qa-sprint65-rival-fade.mjs` · `node tools/qa-sprint64-line.mjs` · `node tools/qa-sprint63-plant.mjs` · `node tools/qa-sprint32-desert-finale.mjs` · `node tools/qa-sprint17-visual.mjs` · `node tools/qa-static-audit.mjs`

**Still human-only:** 2-minute chase — get an AI between camera and player, that car ghosts, neighbours stay solid; C into POV, pack is solid again.

---

# Sprint 66 — Rivals cannot shove the player (24 Aug 2026)

**Player moment:** Rub a pack car. You keep your line with a light bump. They bounce aside instead of sliding you into the dirt.

**Cause:** Mixed contact still used shared inverse-mass with `PLAYER_ANCHOR` 0.42 (~30% of the shove) and `FRICTION * 4` tangent drag. Overlap stayed in the player's box, so the next 60 frames kept pushing.

**Fix:** Dedicated player-vs-rival resolve. Cap player depenetration and Δv. Almost no sideways drag. Rival eats the overlap and sidesteps.

| Change | Status |
|--------|--------|
| `resolvePlayerRival` | **Done** |
| `PLAYER_PUSH_CAP` 0.028 m / `PLAYER_BUMP_VEL` 2.2 m/s | **Done** |
| `PLAYER_SLIDE_SHARE` 0.12 (was FRICTION×4 on the player) | **Done** |
| Rival sidestep + `_aiPassT` | **Done** |
| AI-AI pack resolve unchanged | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=374`** · `collide.js?v=34` · `vehicle.js?v=75` · `ai.js?v=110`

**Proof:** `node tools/qa-sprint66-player-bump.mjs` · `node tools/qa-sprint64-line.mjs` · `node tools/qa-sprint63-plant.mjs` · `node tools/qa-sprint65-rival-fade.mjs` · `node tools/qa-static-audit.mjs`

**Still human-only:** 2-minute pack race — let an AI lean on you through a sweeper. You stay on the painted lane; they go around.

---

# Sprint 67 — Recorded navigator, next turn / jump only (24 Aug 2026)

**Player moment:** The co-driver calls the corner you are actually approaching — Easy / Medium / Hard / Hairpin left or right, or Jump — once, in a human voice. No “into gravel”, no tunnel, no second Jump on the Desert pair.

**Cause:** Authored notes were stale and overrode geometry with surface lines. The look-ahead picked the *sharpest* heading change in 190 m, so a bowl 150 m out stole the next easy bend. Jump ids plus authored `des-jump1` said Jump twice. Voice was `speechSynthesis`.

**Fix:** Geometry picker (`pace-call.mjs`) takes the soonest turn or jump. Recorded CC BY clips from SentientMattress. One jump lock of 110 m. Nav bus off the SFX compressor so the line is not chopped.

| Change | Status |
|--------|--------|
| Soonest turn/jump, not max-degrees | **Done** |
| No gravel / tunnel / mud / finish speech | **Done** |
| Jump once per crest pair (`JUMP_LOCK_M` 110) | **Done** |
| Human VO clips in `assets/sfx/nav/` | **Done** |
| TTS removed from the race path | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=376`** · `track.js?v=178` · `engine.js?v=50` · `codriver.js?v=31` · `bank.js?v=2` · `pace-call.mjs?v=1`

**Proof:** `node tools/qa-sprint67-pace-vo.mjs` · `node tools/qa-sprint36-pace.mjs` · `node tools/qa-static-audit.mjs`

**Still human-only:** 2-minute Desert drive — teaching left then right, one Jump before the pair, no tunnel/gravel talk, voice is the recorded navigator.

---

# Sprint 68 — Jump landings stay on the road (24 Aug 2026)

**Player moment:** Stage 1 Desert, after the 3rd jump (the Safari throw — second of the close pair). The car lands on the asphalt. Tires stay on the deck. The chassis does not bury through the ribbon. Same for every AI car.

**Cause:** Two stacked bugs. (1) Flight used `_landPadY > 0` as “pad armed”, then treated the visual **pit mesh** as a legal landing (`hitting && (overPad || pit)`). Grounded follow then used pit `deck` once the old **36 m** samePit window ended — a hole that long, or a pad at Y ≤ 0, put the contact patch in the landing ribbon. (2) Origin is the contact patch (Sprint 63). Leftover air pitch (up to ~0.44 rad) plus a landing nose-squat around that origin put a bumper through the road until the 24/s blend caught up. Worst on jump 3, the longest air time and deepest drop (5.2 m rise / 3.6 m drop).

**Fix:** Arm the pad with `_landPadArmed`. Floor Y is the scanned land, never the hole. Land only on the real pad. Hold that Y for the scanned pit length. Snap mesh pitch onto the axle plane on the pad. No pitch-squat through the deck. Clamp every car after the air step.

| Change | Status |
|--------|--------|
| `_landPadArmed` + `_roadFloorY` (pit mesh is not a floor) | **Done** |
| Land only when `overPad` — never on `pit` | **Done** |
| `_scanLandPad` returns `{ y, end }`; samePit uses land dist | **Done** |
| `_snapPitchToRoad` on pad; landing squat 0 | **Done** |
| `_clampToRoadDeck` after `_stepAir` (player + AI) | **Done** |
| Sprint 63 `TIRE_PLANT` 0.014 unchanged | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=383`** · `vehicle.js?v=77`

**Proof:** `node tools/qa-sprint68-jump-land.mjs` · `node tools/qa-sprint63-plant.mjs`

**Still human-only:** 2-minute Desert drive — take the jump pair flat-out; after the 3rd landing the Celica sits on the sand ribbon, not in it.

---

# Sprint 69 — Volumetric cumulus sky (24 Aug 2026)

**Player moment:** Title pad and every stage show real cumulus — puffy depth, sun wrapping through the volume, darker bases — not a painted stripe on the dome. Desert reads warm and dusty, Forest cooler and fuller, Mountain thin alpine, Lakeside slightly misty. The sky still matches fog and the key sun.

**Cause:** `sky.js` sampled 3D noise four times on a spherical shell and mixed by colour length. That reads as a flat cloud texture, not a volume.

**Fix:** Planet-shell raymarch (camera on a virtual planet, cloud slab between two radii). Six view steps × two sun-shadow samples at cinema quality (four × one on low/min). Ridged fBm + cheap Worley for cumulus blobs, Beer-Lambert transmittance, Henyey-Greenstein silver lining, horizon fade into stage haze. Stage palettes in `STAGE_CLOUD_PALETTES`. Title cover floor 0.44 so the attract sky is not empty.

| Change | Status |
|--------|--------|
| Planet-shell raymarch (`CLOUD_BUDGET`, max 8 view / 2 light) | **Done** |
| Beer-Lambert + self-shadow + HG phase | **Done** |
| Stage palettes (desert / forest / mountain / lakeside / title) | **Done** |
| `setSkyQuality` follows integrated GPU tier | **Done** |
| No handling/weather; fog/sun/IBL path unchanged | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=382`** · `sky.js?v=22`

**Proof:** `node tools/qa-sprint69-clouds.mjs` · `node tools/qa-static-audit.mjs`

**Budget:** Cinema 6×2 steps on sky fragments only (early-out below the horizon). Not a 128-step fullscreen volume. Low tier drops Worley and light samples. Title cover floor 0.44 so the attract pad is not empty.

**Still human-only:** Park on the SELECT MODE pad, then a 2-minute Desert / Forest look-up — clouds have thickness and a lit side, not a JPEG.

---

# Sprint 70 — POV rearview stays lit + in-car seat + smooth C (24 Aug 2026)

**Player moment:** Press C into the seat. The interior mirror shows the road behind — never a black rectangle — at a cheap 384×120. The cabin reads as a real LHD cockpit (dash cowl, door cards, seated FOV). Every C-key angle (POV / medium / far) eases with no hang.

**Cause:** The glass could sit on an empty or dead render target. Seating deferred capture for two frames even when the RT had never been drawn (clear = black). Nothing rebuilt the target after a WebGL context loss. A 640×200 every-frame pass made the first C hitch, so the old path skipped work instead of keeping a last-good image.

**Fix:** Fixed 384×120 linear RT. Recreate on missing/zero-size/context restore. Bind the map every POV frame. Capture immediately if the RT has no image; reuse the last road frame when seating. Cheap pass: no shadows, no post, no dust/tire marks. Pre-warm + compile still happens at load. Smootherstep pose blend on every mode. Cabin: FOV 76, instrument hood, boot-allocated fill light (intensity 0 until seated).

| Change | Status |
|--------|--------|
| `_ensureMirrorRT` + context lost/restored | **Done** |
| `_mirrorHasImage` — never skip an empty RT | **Done** |
| `GFX.mirrorW/H` 384×120 | **Done** |
| Cheap capture (shadows/dust/marks off) | **Done** |
| Smootherstep C-key blend; no dispose-on-switch | **Done** |
| LHD cabin FOV 76 + binnacle hood + boot `_cabinFill` | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=379`** · `config.js?v=132` · `celica.js?v=118`

**Proof:** `node tools/qa-sprint70-camera.mjs` · `node tools/qa-pov-mirror.mjs` · `node tools/qa-cam-blend.mjs` · `node tools/qa-sprint37-camera.mjs` · `node tools/qa-static-audit.mjs`

**Still human-only:** C into POV on Desert — glass shows the start grid / road, not black; cycle C through all three views while rolling — lens eases, no hitch.

---

# Sprint 71 — Authentic Group A garage + arcade power-slide (24 Aug 2026)

**Player moment:** SELECT CAR is Celica GT-Four, Delta HF, and Stratos HF — the real WRC cars. Jaguar E-Type, Focus ST, and Accord Sport are gone. Desert’s long right and Forest gravel are holdable power slides: Space snaps the tail, throttle carries the angle, opposite lock aims it. Chase cam looks down the slide so the car sits sideways in frame. Tarmac still stops you.

**Cause:** The six-car garage mixed road cars into a rally game. Slide dials from Sprint 33 were too planted (high bleed, modest pitch-in, camera locked to heading) so a power slide read as a scrub instead of a tool.

**Fix:** Garage cut to Celica / Delta / Stratos (rivals too). Surfaces: dirt/sand/gravel/mud looser, tarmac still planted. Handling: longer throttle carry, bigger HB snap, easier pitch-in. Vehicle: lower slideIntent bar, softer yaw-follow in a slide. Chase: look along velocity + offset outside the slide. Dust and tire beds punch earlier.

| Change | Status |
|--------|--------|
| Road cars removed from `CARS`, `GARAGE`, SELECT CAR, DCC, LODs | **Done** |
| Celica planted / Delta snappy / Stratos loose RWD | **Done** |
| Arcade slide dials + surface contrast | **Done** |
| Chase look-into-slide (`CAMERA.slideLook`) | **Done** |
| Dust + skid sell the slide | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=385`** · `config.js?v=134` · `vehicle.js?v=77` · `celica.js?v=119`

**Proof:** `node tools/qa-sprint71-garage.mjs` · `node tools/qa-garage-cars.mjs` · `node tools/qa-sprint33-drift.mjs` · `node tools/qa-car-scale.mjs` · `node tools/qa-static-audit.mjs`

**Headed:** PRESS START → CHAMPIONSHIP → SELECT CAR shows Celica / Delta / Stratos only (no E-Type, Focus ST, Accord). Garage status: `LOADED · Celica · Delta HF · Stratos`.

**Headless boot smoke:** title → SELECT MODE passes; garage-warm timeout in headless Chrome (25s) did not enable a car button this run. Headed path above is the player-visible proof.

**Still human-only:** 2-minute Desert drive — trail-brake or Space into the long right, hold with throttle, catch with opposite lock.

---

# Sprint 72 — Stay on the road (24 Aug 2026)

**Player moment:** Drive Desert. The car never falls through the ribbon, never warps to another part of the stage, never freezes. Wheels stay on the road except in a real jump.

**Cause:** Missing the crest→gap frame left the car grounded in the visual pit. A later nearest-spline query (30 m from the hint window) snapped `progress` to another loop of the stage. `bounceOffRoad` then teleported XZ to that wrong centre line and **did not set Y**, so the hull sat inside the terrain. NaN pose killed the frame loop (`_fatal` after 30 throws).

**Fix:** Force takeoff whenever grounded in a gap. Reject a progress snap bigger than one step. Restore last good pose on NaN/warp. Extreme runoff reset plants Y on the sampled ribbon and refuses a 40 m dist warp. Grounded cars clamp onto the deck; jumps still use the far pad.

| Change | Status |
|--------|--------|
| `_keepOnRibbon` + last-good pose | **Done** |
| Gap takeoff without `enteringGap` edge | **Done** |
| `bounceOffRoad` sets Y / refuses dist warp | **Done** |
| Grounded deck plant (wheels on road) | **Done** |
| `TIRE_PLANT` 0.014 unchanged | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=386`** · `vehicle.js?v=78` · `collide.js?v=35`

**Proof:** `node tools/qa-sprint72-road-lock.mjs` · `node tools/qa-sprint68-jump-land.mjs` · `node tools/qa-sprint63-plant.mjs`

**Still human-only:** full Desert lap — jumps fly, landings plant, no underground, no teleport.

---

# Sprint 73 — GTA IV weight, arcade recoverability (24 Aug 2026)

**Player moment:** The car has mass. Brake into a gravel hairpin and the rear unloads so the nose rotates. Stay in the throttle on tarmac and the front pushes. Lift mid-corner and the tail comes. At 200 km/h the steering is heavy; in a hairpin it is still easy. Body leans and dives. Opposite lock and the e-brake still catch like Sega Rally.

**Cause:** The chassis railed until a grip cap, then snapped into a slide. Full-lock keys teleported the rack. Accel/brake squat was zeroed. Roll max was 4°. Load transfer existed on paper but barely changed yaw.

**Fix:** Weight transfer scales axle µ and adds brake-oversteer / throttle-understeer. Lift-off dumps rear grip. Yaw uses a mushy limit plus speed-mass follow. The steering rack has inertia. Brake-dive and body roll come from filtered `_ax` / `_ay` (capped so the nose stays out of the deck). Camera leans and FOV punches with speed. Handbrake, countersteer, and surface contrast stay arcade.

| Change | Status |
|--------|--------|
| `weightTransferMul` + load-scaled axle µ | **Done** |
| Lift-off oversteer + high-speed understeer | **Done** |
| `softLimit` mushy breakaway (not a rail) | **Done** |
| Weighted steering rack (no digital snap) | **Done** |
| Brake-dive / accel-squat + body roll | **Done** |
| Chase roll-follow + speed FOV | **Done** |
| Celica planted / Delta snappy / Stratos loose | **Done** |
| `TIRE_PLANT` 0.014 unchanged | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=390`** · `config.js?v=135` · `vehicle.js?v=80`

**Proof:** `node tools/qa-sprint73-gta-phys.mjs` · `node tools/qa-sprint33-drift.mjs` · `node tools/qa-sprint31-drift.mjs` · `node tools/qa-sprint72-road-lock.mjs` · `node tools/qa-sprint38-physics.mjs` · `node tools/qa-static-audit.mjs`

**Boot smoke:** title → SELECT MODE → SELECT CAR → Desert countdown **PASS**. Race handoff timed out at 0 fps in headless Chrome (120s) — same class as prior garage-warm stalls, not a physics syntax break. Human drive is the feel proof.

**Still human-only:** 2-minute Desert drive — trail-brake the long right, lift to rotate, catch with opposite lock; then a Mountain tarmac sweeper at speed for the push.

---

# Sprint 74 — Rigid-body jumps (24 Aug 2026)

**Player moment:** Hit Desert's teaching hop, then the pair. Each leave is a throw from speed, lip, suspension, and line — not a canned hop. Flat-out hangs nose-high; lift-and-brake lands flatter. A messy arrival can bounce once. Wheels still never go through the road.

**Cause:** Air pitch was a keyframed technique score. Takeoff ignored chassis angular rate, roll, and lateral. Every run of the same jump looked the same.

**Fix:** RAGE-style vehicle air (GTA IV/V cars, not ped Euphoria). Launch inherits pitch/roll/yaw, compress, and a deterministic lip grain. Inertia + wheel-reaction torque + light aero. Hard landings get a short bounce above the pad. No `Math.random`. Road-lock from Sprint 72 stays.

| Change | Status |
|--------|--------|
| `JumpModel.launch(..., body)` inherits attitude | **Done** |
| `lipGrain(dist, lateral)` ±4.5% vy | **Done** |
| Air roll + aero pitch | **Done** |
| Landing bounce cap 2.15 m/s | **Done** |
| `launchHeightScale` 0.28 | **Done** |
| Clip-through guards kept | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=391`** · `vehicle.js?v=80` · `jump.js?v=12` · `config.js?v=135`

**Proof:** `node tools/qa-sprint74-jump-air.mjs` · `node tools/qa-sprint72-road-lock.mjs` · `node tools/qa-sprint68-jump-land.mjs` · `node tools/qa-sprint63-plant.mjs`

**Still human-only:** three Desert jumps — change speed or line each time; the arc should change; landings stay on the sand.

---

# Sprint 75 — Glitch Department: stay on the road (24 Aug 2026)

**Player moment:** Drive any championship stage. The car stays on the painted lane. It never warps to another part of the track. It never falls through the road. Phones start on a cheaper quality tier so the first corner is still 3D, not a hitch then a dump.

**Cause (remaining after Sprint 72):** `_nearestIndex` with a progress hint still picked Euclidean-nearest inside a ±22-post window. A hairpin opposite arm is close in XZ and 18–30 m along the spline — inside the old 32 m `maxStep` floor — so `progress` snapped and `bounceOffRoad` planted the hull on the wrong loop.

**Fix:** Score hinted queries by XZ **plus** along-track jump (reject > 22 m along). Tighten `_keepOnRibbon` to ~10 m per physics step, wrap-aware at the finish. `_guardDrive` restores last-good pose on teleport / NaN / bury. Live Chrome drive holds throttle on Desert, Forest, and Mountain and fails the sprint if any sample jumps. Phones open the quality scaler on `low` (PBR/ACES still on) instead of `high`.

**Not done (CEO cut):** a full-engine rewrite. The architecture is not the blocker. Teleport-on-road was.

| Change | Status |
|--------|--------|
| `Track._nearestIndex` continuity score | **Done** |
| Tighter wrap-aware `_keepOnRibbon` | **Done** |
| `_guardDrive` live watchdog | **Done** |
| Chrome glitch department (`qa-sprint75-glitch`) | **Done** |
| Phone starts on `low` quality tier | **Done** |
| `TIRE_PLANT` 0.014 unchanged | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=396`** · `vehicle.js?v=83` · `track.js?v=180` · `collide.js?v=37` · `perf-tier.js?v=6` · `input.js?v=39`

**Proof:** `node tools/qa-sprint75-glitch.mjs` live Chrome pump (24 Aug 23:54Z):

| Course | Dist | vmax | Hits | Teleport | Buried | NaN |
|--------|-----:|-----:|-----:|---------:|-------:|----:|
| Desert | 41.7 m | 23.7 | 0 | 0 | 0 | 0 |
| Forest | 50.4 m | 26.8 | 0 | 0 | 0 | 0 |
| Mountain | 63.4 m | 31.1 | 0 | 0 | 0 | 0 |

Also: `node tools/qa-sprint72-road-lock.mjs` · `node tools/qa-sprint76-perf.mjs`

**Still human-only:** one full Desert lap on a phone — no warp, no bury.

---

# Sprint 75b — Overlapping ribbon crash (24 Aug 2026)

**Player moment:** Hit the Desert mud after the tunnel, the Forest glade return, or a Mountain stacked hairpin. The car keeps driving. It does not reset, drop through the road, or freeze the game.

**Cause:** Championship stages **cross themselves**. Desert mud at ~1684 m sits **1.5 m** in XZ from the later sweeper at ~2395 m (711 m along-track). Forest and Mountain have the same diamond. `_nearestIndex` still **global-scanned** once you were 30–40 m off the hinted posts, so `progress` jumped 600–700 m. `bounceOffRoad` then planted XZ+Y on the **other** loop (Mountain: 8 m of Y). NaN pose hit `_fatal` after 30 throws. Sprint 75's hint score was not enough: the two roads occupy the same volume.

**Fix:** Hinted queries never fall back to a global nearest. A snapped re-query pins to last-good dist. Off-road reset plants on `progress` (not the snapped `q.dist`), refuses an 18 m along warp and a 2.6 m Y warp. `_guardDrive` restores a 3.2 m grounded Y spike. After the spline is built, a later ribbon that occupies the same XZ at nearly the same Y is lifted into a **7.4 m flyover** so the painted lanes are not two tarmacs in one hole.

| Change | Status |
|--------|--------|
| Hinted `_nearestIndex` never global-scans | **Done** |
| `_pinQuery` if restore still snaps | **Done** |
| `bounceOffRoad` uses progress / refuses Y-warp | **Done** |
| `_guardDrive` y-warp | **Done** |
| `_separateOverlappingRibbon` flyover | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=400`** · `vehicle.js?v=84` · `track.js?v=180` · `collide.js?v=37`

**Proof:** `node tools/qa-sprint75-glitch.mjs --static` · `node tools/qa-sprint72-road-lock.mjs`

**Still human-only:** Desert through the tunnel into the mud, then the long right — two roads must not occupy one hole; no reset, no crash.

---

# Sprint 75c — GTA IV rival: tire-moment yaw + IV principles (24 Aug 2026)

**Player moment:** High-speed tarmac **pushes** like a Comet that gained weight. Lift mid-corner and the tail comes. A hairpin is still catchable with opposite lock. The car has mass — you wait for the yaw — but it is still a rally tool, not a drunk bus. Celica stays planted (Sultan 4WD); Stratos lights the rear (Comet RWD).

**Cause:** `_integrate` drove yaw from a kinematic bicycle `rWant = (vx * st) / (L * (1 + kus * vx²))`. Pacejka `front.fy` / `rear.fy` only shoved `vy`. GTA IV / RAGE cars rotate from **tire yaw moments**. Sprint 73 load-transfer was not enough.

**GTA IV sources (principles, not a clone):**
- [GTAMods handling.dat](https://gtamods.com/wiki/Handling.dat) — `m_fTractionCurveMax/Min`, `m_fTractionBias`, `m_nDriveBias`, `m_fDriveInertia`
- [Grand Theft Wiki Handling.cfg/GTAIV](https://www.grandtheftwiki.com/Handling.cfg/GTAIV) — IV is multipliers + algorithms, not a full sim; CurveMax = peak, CurveMin = sliding floor
- [Traxion on IV vehicle physics](https://traxion.gg/how-grand-theft-auto-iv-broke-the-open-world-mould-for-vehicle-physics/) — exaggerated body roll, class personality, IV less forgiving than V
- The Drive / Clarity Potion — V added grip and muted weight; IV is looser, more roll, delayed yaw
- GTA Wiki Drifting — IV is the closest the series got to a holdable drift

**Fun formula encoded:** delayed steer→load→Mz chain; CurveMax/Min gap so a slide **stays**; speed changes the car; slide is a tool (`counterAuthority` 2.55); heavy rack + self-align; engine brake 0.34; roll/dive as mass UI; `brakeHold` per surface; 4WD vs 2WD personality; no RNG in `step`; **IV not V**.

**Fix:** Blend SAE bicycle `Mz = front.fy * cosS * lf - rear.fy * lr` into yaw after `rWant` is fully built. Heavier Celica `yawInertia` 2480, snappier load-transfer (`axFollow` 13), wider tarmac peak→slide gap (1.55 / 1.02). Road-lock (72) and rigid jumps (74) stay.

**Honesty:** GTA IV **rival** bar — weight, tire-moment yaw, lift-off, recoverability. Does **not** equal GTA IV. Arcade rally chassis with RAGE-weight.

| Change | Status |
|--------|--------|
| Tire-moment yaw blend (`rDotTire` / `tireYawBlend`) | **Done** |
| `tractionMinMul` + tarmac still slides | **Done** |
| `lowSpeedTractionLoss` (small) | **Done** |
| `driveInertia` on wheel I | **Done** |
| `tractionBiasFront` Celica 0.46 / Delta 0.50 / Stratos 0.56 | **Done** |
| Heavier rack, engine brake, roll/dive, camera lean | **Done** |
| `TIRE_PLANT` 0.014 / `FIXED_DT` 1/60 / no RNG | **Done** |
| Sprint 72 road-lock + 74 jumps | **Untouched** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=399`** · `config.js?v=137` · `vehicle.js?v=84` · `jump.js?v=13` · `surfaces.js?v=46`

**Proof:** `node tools/qa-sprint75-gta-rival.mjs` · `node tools/qa-sprint73-gta-phys.mjs` · `node tools/qa-sprint74-jump-air.mjs` · `node tools/qa-sprint72-road-lock.mjs`

**Still human-only:** 2-minute Desert + a tarmac hairpin + a power slide you catch with opposite lock.

---




# Sprint 76 — One quality scaler, no shader cliffs (24 Aug 2026)

**Player moment:** The stage no longer freezes for half a second when new scenery comes into view, and a machine that cannot hold the frame rate now loses pixel density, shadow resolution, bloom and cloud steps instead of dropping frames. Pressing **C** costs 12 ms, not a stall.

**Cause:** Three separate defects, all measured on an M1 Pro in headed Chrome.

1. **Shader links during the race.** `renderer.compile` only walks *visible* objects, and streaming keeps far slices hidden — so each slice linked its programs the first time it came into view. `renderer.info.programs` climbed **103 → 114** across one drive, and the offending frames cost **648 ms and 789 ms**. Worst frame in the baseline probe was **2606 ms**.
2. **The quality scaler was decorative.** `perf-tier.js` computed a `dprScale` and a shadow size that nothing applied (the shadow branch was an empty `if` with a comment). A second, independent post-quality ladder lived inline in `_loop` reading `GFX.adapt*`. So a slow device did not degrade — it just ran slow.
3. **The scaler was reading the wrong clock.** It was fed `_lastPresentCost`, the CPU time to *issue* the draws. `renderer.render()` returns before the GPU is done, so a GPU-bound machine reported a healthy **4–9 ms** while actually delivering **37 ms** frames, and the scaler never degraded.

**Fix:** One scaler owns every GPU knob. `perf-tier.js` picks one of four tiers from an EMA of the **interval between presented frames**, and `game.js` is the only applier (`_applyQualityTier`, called only on a tier transition). `_precompileStage()` reveals the whole stage for one time-boxed compile pass under the loading screen, so the links are paid where the player is already waiting.

| Change | Status |
|--------|--------|
| `QUALITY_CAPS` — DPR ≤ 1.5, shadow ≤ 4096, cloud ≤ 8×2, mirror ≤ 384×120 | **Done** |
| Four tiers carry dpr / shadow / post / sky / mirrorEvery | **Done** |
| Inline `GFX.adapt*` ladder removed from `_loop` (one system) | **Done** |
| Scaler fed the present interval, not CPU render cost | **Done** |
| Hysteresis both ways + 50 ms sample clamp (one stall ≠ degrade) | **Done** |
| Allocating knobs monotonic per stage (extends Sprint 60, does not revert) | **Done** |
| `_precompileStage()` — stage shaders linked under the loading screen | **Done** |
| Sprint 69 volume preserved: 6×2 cinema, 4×1 low, Worley off on low/min | **Done** |
| Sprint 58–61 LOD, 63 plant, 64 line, 65 fade, 66 bump, 67 VO, 68 land | **Untouched** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=394`** · `perf-tier.js?v=6` · `sky.js?v=22` unchanged. Several agents bumped the boot version concurrently during this sprint — Release should re-check that `index.html` and `js/main.js` still agree before pushing (`node tools/qa-sprint76-perf.mjs` asserts it).

**Proof:** `node tools/qa-sprint72-perf.mjs` — 46 checks, including six that **drive the live ladder** rather than grep for it: a locked 60 stays on high, one 1100 ms stall does not degrade the stage, sustained 40 ms drops to min inside 30 frames, steady 20 ms settles once and stops moving, a recovered machine climbs back one tier at a time. Regression: `qa-sprint60-smooth` · `qa-sprint69-clouds` · `qa-sprint39-perf` · `qa-sprint58-title-lod` · `qa-sprint59-lod` · `qa-sprint63-plant` · `qa-static-audit` all pass.

**Measured (headed, M1 Pro, Desert, 14 opponents):**

| | Baseline | After |
|---|---|---|
| mean frame time | 41.8 ms | 26.4 ms |
| p99 frame time | 508 ms | 53 ms |
| worst frame | 2606 ms | 134 ms |
| hitches > 33 ms | 25.9% | 36.4%* |
| present cost, steady | — | 3.6–9.8 ms |
| programs linked mid-race | 103 → 114, 0.6–0.8 s stalls | no cost spike |
| camera **C** switch | — | 11.7 ms, no compile |
| page errors | 0 | 0 |

\* The hitch *percentage* rose because the catastrophic stalls that used to eat whole seconds are gone — mean, p99 and worst all improved sharply. The remaining ~37 ms cadence is GPU-bound frame time, not a stall.

**Open — Release should NOT ship a 60 fps claim:**

1. **The main path does not hold 60.** At full quality on an M1 Pro the probe measures a steady ~28–37 ms frame interval (~35 fps), GPU-bound. The caps and the degradation ladder are in place, and the scaler will now correctly see this and step down — but the *default* tier is not yet 60-safe on this machine. Next sprint must cut fixed GPU cost (4096² PCFSoft shadow atlas re-rendered every frame at `shadowEvery: 1` is the first suspect) rather than add more scaling.
2. **Non-deterministic stage-build wedge.** Twice in six headed runs the Desert track failed to finish building within 120 s, with the main thread unresponsive to `Runtime.evaluate` for >180 s. This reproduced **before** any Sprint 76 change and occurs upstream of `_precompileStage` (the probe was still waiting for `window.game.track` to exist). Owner: whoever owns `track.js` construction. This is a hard ship blocker on its own.
3. ~~**HUD FPS readout is optimistic.**~~ **CLOSED in Sprint 96** — the readout now counts presented frames over wall-clock time. `_fpsT` summed `dt` only on frames that presented, so skipped frames' time was discarded and the number reported the rAF rate rather than the delivered one.

**Harness:** `clickResilient` now polls the hit-test for up to 15 s instead of failing on the first zero-size rect. A saturated boot main thread can answer `evaluate` before style/layout has flushed, which was failing `qa-frame-probe` at PRESS START with a spurious "element has zero size".

**Still human-only:** 2-minute Desert drive watching for scenery pop-in stalls; press **C** through all three views mid-corner.

---

# Sprint 77 — Fast boot, cheap title, black fades, trickle load bar (24 Aug 2026)

**Player moment:** The game opens on black and fades into the title. The emblem is there immediately. A low-res rotating LOD car fades in behind it. PRESS START fades to SELECT MODE through black. Picking a stage fades to a load bar that keeps ticking instead of freezing on one percent, then fades up into countdown.

**Cause:** Title used a full-res framebuffer, baked IBL in 480 ms, and pulled every hero GLB on boot — so splash hitchs. Screens swapped with `display` toggles (hard cuts). The load bar snapped to `floor(frac*100)` with a 60 ms width tween, then sat on one digit whenever the main thread was busy.

**Fix:** Boot curtain + screen-to-screen black fades. Title/menu render at 0.68 DPR / 0.72 Mpx with a 512 shadow map, no post RTs, delayed IBL. Attract car is still the rival LOD; hero garage waits for PRESS START. Load UI eases toward real progress and trickles during stalls so the percent never hangs.

| Change | Status |
|--------|--------|
| `#fx-curtain` boot reveal + menu/load/HUD fades | **Done** |
| Title showroom visible at cheap DPR, LOD car | **Done** |
| `prepareCelica` deferred to PRESS START | **Done** |
| Trickle `setLoadingProgress` (transform scaleX) | **Done** |
| No HTML prefetch of Desert music on splash | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=403`** · `hud.js?v=27` · `config.js?v=136` · `css/game.css?v=26`

**Proof:** `node tools/qa-sprint77-boot.mjs` · `node tools/qa-sprint58-title-lod.mjs` · `node tools/qa-static-audit.mjs`

**Still human-only:** cold load → watch the bar tick; PRESS START → SELECT MODE fade; start Desert and confirm countdown fades up from black.

---

# Sprint 78 — Calmer chase, slightly less body roll (25 Aug 2026)

**Player moment:** Drive a Desert hairpin. The car still has GTA IV weight. The horizon no longer banks hard, and the chase does not swing wide on a slide. Body lean is still there, just quieter.

**Cause:** Chase `rollFollow` 0.48 plus a 1.3 m slide offset and a 0.22 m kick made the lens swing. Chassis `bodyRollMax` 0.155 stacked on top of that.

**Fix:** Camera lean is a hint (`rollFollow` 0.22). Slide offset and lateral kick are about half. Medium chase stiffness back to 28. Body roll 0.118 / 1.82 — still heavier than the old 4° rail, not a cabinet tip. Handling physics unchanged.

| Change | Status |
|--------|--------|
| `CAMERA.rollFollow` 0.48 → 0.22 | **Done** |
| `slideCamOut` 0.95 → 0.42; kick 0.22 → 0.09 | **Done** |
| Medium chase stiffness 24 → 28 | **Done** |
| `bodyRollMax` 0.155 → 0.118 | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=405`** · `config.js?v=138`

**Proof:** `node tools/qa-sprint73-gta-phys.mjs` · `node tools/qa-sprint75-gta-rival.mjs` · `node tools/qa-static-audit.mjs`

**Still human-only:** 2-minute Desert drive — corner camera stays planted; car still leans a little.

---

# Sprint 79 — Jump 3 never clips through the roadway (25 Aug 2026)

**Player moment:** Stage 1 Desert, third jump (Safari throw — second of the close pair). A flat-out throw off jump 2 can hang long enough to meet jump 3's rising ramp. The car lands ON that ramp and keeps driving. It does not freeze inside or under the asphalt.

**Cause:** Air collision treated only the far pad as a floor. Ramp and crest were excluded from `overPad`, so a descending throw that arrived *under* the next lip was clamped to the deck with `onGround = false`. No tires, no throttle, unmovable. `_landLock` from jump 2 also blocked takeoff in a new pit. `_guardDrive` y-warp undid upward recoveries because it treated any 3.2 m Y change as illegal.

**Fix:** Solid decks (ramp / crest / land / road) plant the car and set `onGround`. A previous landing lock cannot glue the next hole. Buried restore fires at 22 cm under a solid deck. Y-warp only catches a drop, never a lift onto the next lip.

| Change | Status |
|--------|--------|
| Air under a solid deck plants onGround | **Done** |
| `holdThisPit` — lock is per-jump, not global | **Done** |
| Buried snap at 0.22 m under solid ribbon | **Done** |
| Y-warp is downward-only | **Done** |
| Headed probe: jump 2 @ 32 m/s must not tunnel jump 3 | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=405`** · `vehicle.js?v=85`

**Proof:** `node tools/qa-sprint68-jump-land.mjs` · `node tools/qa-sprint75-glitch.mjs --static`

**Still human-only:** take Desert jump 2 flat-out and confirm jump 3's ramp is a floor, then land the Safari throw on the sand.

---

# Sprint 80 — Wheels stay on the roadway after jumps (25 Aug 2026)

**Player moment:** After any jump, the car does not clip through the road, and the tires sit on the tarmac — no hover gap, no buried patch.

**Cause:** Grounded Y was only lifted if it went *under* the deck. After a throw, `_deckFilt` lagged a rising land ramp so the contact patch floated or sank. Ramp/crest skipped the grounded pin, and landing pitch copied leftover air slope instead of the axle plane.

**Fix:** Land-lock and ramp/crest/land pin Y to the axle deck. Ordinary road never goes under the deck or more than 5 cm above it. Landing snaps pitch onto the axle plane.

| Change | Status |
|--------|--------|
| Land-lock / jump approach plant Y = deck | **Done** |
| Grounded hover cap 5 cm (`GROUND_HOVER_MAX`) | **Done** |
| `_snapPitchToRoad(axles)` on land | **Done** |
| Headed probe: post-land ΔY in [-3 cm, +8 cm] | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=407`** · `vehicle.js?v=86`

**Proof:** `node tools/qa-sprint68-jump-land.mjs` · `node tools/qa-sprint63-plant.mjs` · `node tools/qa-sprint75-glitch.mjs --static` · `node tools/qa-sprint72-road-lock.mjs`

**Still human-only:** Desert jump 2 into jump 3 — tires on the ramp, then on the sand, no clip-through.

---

# Sprint 81 — Recorded 3-2-1-GO on the start lights (25 Aug 2026)

**Player moment:** The stage HUD counts **3**, **2**, **1**, **GO!** and the co-driver says those words on the same ticks — not a beep standing in for a voice, and not TTS.

**Cause:** `countBeep` / `countGo` pitched a checkpoint sample. The SentientMattress pack already had a countdown at 0:00 (5-4-3-2-1-GO) that Sprint 67 never sliced. The clock also ran during the HUD fade, so the first number could fire off-screen.

**Fix:** Slice `count-3/2/1/go.mp3` from Freesound 833028. Play them on the navigator bus when the HUD flashes each number. Hold the 3-second clock until `#screen-hud` is up, then fire **3** immediately.

| Change | Status |
|--------|--------|
| `assets/sfx/nav/count-{3,2,1,go}.mp3` | **Done** |
| `countBeep` / `countGo` play recorded VO | **Done** |
| HUD 3 at screen-up; 2 / 1 / GO on remaining-time ticks | **Done** |
| Countdown hold until HUD (`_countHold`) | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=407`** · `engine.js?v=51`

**Proof:** `node tools/qa-sprint81-countdown-vo.mjs`

**Still human-only:** start Desert and confirm the voice hits with the numbers. Navigator slider at 0 should still play GO on SFX.

---

# Sprint 82 — Jump landings never clip through the roadway (26 Aug 2026)

**Player moment:** After any jump — Desert's Safari throw (jump 3), Mountain's crest, Forest, Lakeside — the car lands ON the asphalt. Tires and body stay on the deck. The rear does not punch through the ribbon. The car does not fall under the stage and freeze.

**Cause:** Three stacked holes. (1) A plant on the next ramp disarmed the land pad, so the following hole had no floor and the chassis dropped through the roadway. (2) Origin is the contact patch; leftover air pitch (~0.42 rad) rotated the rear through the pad until a 24/s blend caught up. (3) Air collision used only the centre-line query. If that sample was still labelled `gap` while an axle was on ramp/land, the car tunneled the solid mesh.

**Fix:** Keep the pad armed across the landing strip and re-scan if a hole has no pad. Solid axles are a floor. After attitude, `_keepChassisOnRoad` clamps pitch to the axle plane and lifts any wheel that would sit through the deck. Buried restore is 6 cm, not 22 cm, and always sets `onGround` so the player can keep racing.

| Change | Status |
|--------|--------|
| Pad stays armed on `land`; hole without a pad re-scans | **Done** |
| `_roadFloorY` uses solid axles + far pad | **Done** |
| `_keepChassisOnRoad` pins pitch + axle Y after attitude | **Done** |
| Land bounce snaps pitch; no bury-through hop | **Done** |
| Buried snap at 6 cm under solid ribbon | **Done** |
| Void rescue `_plantOnRibbon` if the car drops under the mesh | **Done** |
| Chase camera never follows the car under the stage | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=409`** · `vehicle.js?v=88`

**Proof:** `node tools/qa-sprint68-jump-land.mjs` · `node tools/qa-sprint75-glitch.mjs --static`

**Still human-only:** Desert jump 2 into jump 3, then Mountain's crest — rear stays on the tarmac, no fall-through. If you were on github.io, that build does not include this fix until it is pushed.

---

# Sprint 83 — Stage 1 after jump 3: every car stays on the roadway (26 Aug 2026)

**Player moment:** Desert Safari throw (jump 3), then the checkpoint climb into the tunnel. Player and the whole AI pack stay ON the painted road. Wheels are not buried in the asphalt. Nobody falls under the stage or freezes at 0 speed in the hole.

**Cause:** Jump 3's pit mesh is ~30 m. Two systems then buried the whole pack: (1) `Track._nearestIndex` scored `xz² + along² × 2.4`, so a stale gap post beat the land under the car. (2) `_scanLandPad` kept walking 140 m of ordinary road, so axle probes hinted at the tunnel climb (~7 m higher) and `_keepChassisOnRoad` planted every car into — or above — the wrong deck. The 5 cm hover cap then pulled Y onto that sample: wheels gone, bumper in the tarmac, speed 0.

**Fix:** Pit posts are not a magnet. If a centre query is still the pit, take the solid ribbon under the car. Jump steps may advance ~40 m so land is not a "teleport." The land pad ends when `jumpKind` leaves `"land"`. Chassis floor ignores pit mesh. Grounded Y snaps to this frame's deck. Axles that disagree with the centre by > 2.2 m (another loop) are discarded.

| Change | Status |
|--------|--------|
| `_nearestIndex` pit window + gap XZ penalty | **Done** |
| `_preferSolidRoad` for player and AI | **Done** |
| `_ribbonStepMax` +42 m while jumping | **Done** |
| `_scanLandPad` stops at the land strip | **Done** |
| `_roadFloorY` ignores `jumpKind === "gap"` mesh | **Done** |
| Grounded plant = current deck every frame | **Done** |
| Axle probes take land `hintDist`; reject 7 m flyover snaps | **Done** |
| Headed probe: jump 3 → tunnel climb on deck | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=410`** · `vehicle.js?v=89` · `track.js?v=181` · `ai.js?v=113`

**Proof:** `node tools/qa-sprint68-jump-land.mjs` · `node tools/qa-sprint75-glitch.mjs --static`

**Still human-only:** Desert jump 3, then the climb into the tunnel — all cars on the road. github.io is stale until this is pushed.

---

## Sprint 84 — Title showroom (hero car, real pad, instant present) — 2026-08-26

**Player moment:** Title used the rival LOD, a beige disc, a 512 shadow map, a 1.6s WebGL wait, and a dark green overlay. The splash looked cheap and hitchy.

**Fix:** Hero `gt4.glb` from first present (HTML-preload + constructor fetch). Title DPR 1.5 / 2.4Mpx / 2048 shadows / canvas MSAA. Asphalt pad + kerbs + sand + dunes. Clearer sky/sun, vignette only behind the emblem. WebGL on the next frames, canvas visible immediately, IBL on the first idle frame. Garage still warms after PRESS START.

| Change | Status |
|--------|--------|
| `prepareTitleCar` / `createTitleCar` hero-first | **Done** |
| Title pad is tarmac + kerb + sand, not a beige disc | **Done** |
| Title lighting / fog / IBL | **Done** |
| Instant boot (no 1.6s / 1.8s delays) | **Done** |
| Overlay is a vignette, not a dark slab | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=415`** · `config.js?v=141` · `celica.js?v=121` · `css/game.css?v=29`

**Proof:** `node tools/qa-sprint84-title-showroom.mjs` · `node tools/qa-sprint58-title-lod.mjs` · `node tools/qa-sprint77-boot.mjs`

**Still human-only:** Title should show a sharp Celica on tarmac under a real sky, with no LOD pop and no black wait.

---

## Sprint 85 — Stage 1 never falls under the tunnel approach (26 Aug 2026)

**Player moment:** Desert Safari throw, then the climb into the tunnel. The car stays ON the painted road. It does not clip through and sit in the white void with the hill/road above it.

**Cause:** XZ integrates from velocity while spline `progress` can stay locked on jump 3's pit. `Track.query` then hinted at that hole (MAX_ALONG rejected the tunnel posts ~160 m ahead), so chassis Y was planted on the pit floor — under the climb and the tunnel hill. `_guardDrive` compared Y to the pit sample, which is already the underworld, so the void check never fired.

**Fix:** Re-acquire progress from the car's XZ when it has left the hinted ribbon. Pit queries that are >12 m away walk forward along the spline. Gap mesh is never a floor; if Y drops under the solid deck or the land pad, snap back. Holding a pit Y is skipped once XZ has left the hole.

| Change | Status |
|--------|--------|
| `_reacquireProgress` when XZ leaves the hinted pit | **Done** |
| `_neverFallThrough` snaps under-world Y onto solid deck / land pad | **Done** |
| `_nearestIndex` walks forward if hinted pit is far in XZ | **Done** |
| `_preferSolidRoad` takes land when the car is not over the hole | **Done** |
| Headed probe: pit progress + tunnel XZ cannot void | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=416`** · `vehicle.js?v=90` · `track.js?v=182` · `ai.js?v=114`

**Proof:** `node tools/qa-sprint68-jump-land.mjs` · `node tools/qa-sprint75-glitch.mjs --static`

**Still human-only:** Drive Desert jump 3, then the climb into the tunnel — stay on the tarmac. github.io is stale until this is pushed.

---

## Sprint 86 — Seamless volumetric sky, no grain (26 Aug 2026)

**Player moment:** Title and every stage sky. Clouds read as soft cumulus, not TV static. The dome has no azimuth seam.

**Cause:** The planet-shell march offset each frame with `hash13(rd * 131.7 + uTime)` (crawling grain). Weather used `atan(view.z, view.x)` (a ±π jump). Cheap 2×2×2 Worley mixed hard. Post `filmGrain: 0.026` sanded the whole sky. The dome was only 32×20.

**Fix:** Stable voxel centres. Seamless 3D weather. Larger, softer ridged cumulus. 12 cinema / 8 medium / 6 low view steps on a 64×40 sphere. Film grain off. Title sky exposure capped so the dome stays blue enough for cumulus to read.

| Change | Status |
|--------|--------|
| Temporal march dither removed | **Done** |
| Weather is 3D fBm (no atan seam) | **Done** |
| Soft 3×3×3 Worley, lower mix | **Done** |
| `CLOUD_BUDGET` 16/12/8/6 + `maxCloudViewSteps: 16` | **Done** |
| `filmGrain: 0` | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=422`** · `sky.js?v=23` · `perf-tier.js?v=7` · `config.js?v=142` · `postfx.js?v=13`

**Proof:** `node tools/qa-sprint69-clouds.mjs` · `node tools/qa-sprint76-perf.mjs` · `node tools/qa-sprint30-realism.mjs`

**Still human-only:** Title sky should be a smooth blue with soft white clouds, no sparkle.

---

## Sprint 87 — Instant menus, title music, real rocks (26 Aug 2026)

**Player moment:** PRESS START, car, and stage clicks swap immediately. Title music starts on the first tap. The showroom is a tarmac pad, sky, orbiting hero car, and Kenney rock GLBs — no sphere boulders. Chrome does not throw "Page Unresponsive" on launch.

**Cause:** First click decoded every stage MP3 (~60 MB) and sample-walked loop tails on the main thread. PRESS START then rebuilt title lighting, baked IBL, allocated a 2048 shadow atlas, cloned the hero GLB, and started Track.create. Hovering a stage button also started a track build.

**Fix:** Unlock audio = title bed only; SFX and other discs idle later. Menus `instant: true`. No showroom rebuild / car clone / track preload on option clicks. Sphere dunes replaced with `rock_largeA/B`, `rock_tallA`, `rock_smallA`. Shadows + IBL after first present.

| Change | Status |
|--------|--------|
| Title music on first gesture; no 6-disc decode | **Done** |
| Instant SELECT MODE / car / course | **Done** |
| Kenney rock GLBs on the title pad | **Done** |
| Deferred IBL + 1024 title shadows | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=423`** · `config.js?v=143` · `engine.js?v=52` · `soundtrack.js?v=133` · `prop-kit.js?v=19` · `hud.js?v=28`

**Proof:** `node tools/qa-sprint84-title-showroom.mjs --static` · `node tools/qa-sprint69-clouds.mjs`

**Still human-only:** Click Start — music + instant menu. Title rocks should read as stone, not balloons.

---

## Sprint 88 — Car pick never hangs the tab (26 Aug 2026)

**Player moment:** Championship → pick a car. The loading screen appears immediately and the percent moves. The tab does not freeze with only title music playing.

**Cause:** Car click called `_scheduleTrackPreload` and `_beginRace` together, then `yieldFrame()` resolved via `queueMicrotask`. Terrain/road work stayed on the click turn. Chrome never painted `#screen-loading`. Audio kept playing on its own thread.

**Fix:** Macrotask yields only (`requestAnimationFrame` + `setTimeout(0)`). Instant loading screen. Paint two frames, then garage / SFX / one `Track.create`. Championship pick no longer starts a parallel preload.

| Change | Status |
|--------|--------|
| `yieldFrame` has no `queueMicrotask` | **Done** |
| `showLoadingScreen` is `instant: true` | **Done** |
| `_beginRace` yields before SFX / `_startRace` | **Done** |
| Championship car pick is one `_beginRace` | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=425`** · `track.js?v=185` · `hud.js?v=29`

**Proof:** `node tools/qa-sprint88-car-pick.mjs` · `node tools/qa-sprint77-boot.mjs` · `node tools/qa-boot-smoke.mjs`

**Still human-only:** Championship → Celica. Loading bar must appear at once; countdown follows.

---

## Sprint 89 — No teleport after jump 3; cars stay on the road (26 Aug 2026)

**Player moment:** Desert Safari throw (jump 3). The car lands on the sand pad and drives the climb into the tunnel. It is not snapped inside the tunnel. Rivals stay spread on the road. The rock-bridge underpass is a hole a car can drive through. Dunes and rocks stay off the asphalt.

**Cause:** After the pit, `Track.query` walked ~110 m ahead and locked onto the tunnel. `_restoreGoodPose` / off-road reset then planted XZ there, so the pack clustered in the tube. A later hairpin flyover filled the rock-bridge portal.

**Fix (first pass):** Keep world XZ. Pin progress instead of teleporting. Pit recovery stopped at the land pad and refused tunnel samples. Off-road hauls toward the lane. Underpass is marked before flyover and skipped. Portal is 11.2 m tall with a wider drive tube. Y-only floor when a car is under the deck.

| Change | Status |
|--------|--------|
| No XZ teleport on spline snap / bury / off-road | **Done** |
| Jump 3 lands on the pad, not in the tunnel | **PARTIAL** — human playtest 26 Aug: still transported + clipping after jump 3 |
| AI pack is not reset onto one ribbon point | **Done** |
| Rock-bridge drive-through stays empty | **Done** |
| Y floor at the car, not at a warped progress | **PARTIAL** — floor stayed on pit-pad Y |

**Cache (this pass, stale):** `?v=426` · `vehicle.js?v=91` · `track.js?v=186`

**Still human-only:** Closed by sprint 90.

---

## Sprint 90 — Jump 3 floor is the road under the car (26 Aug 2026)

**Player moment:** After Desert jump 3 (Safari throw), the car lands on sand and stays on that road through the climb into the tunnel. It does not fall through the climbing mesh and it is not moved into the tunnel.

**Cause:** Sprint 89 capped pit recovery at ~50 m along and treated the climb as a teleport. Progress stayed in the hole. `_roadFloorY` / pad lift used land-pad Y (~3.7 m) while the visual climb sat at ~8–17 m, so the chassis clipped through. A later query that finally saw the tunnel then lifted Y onto the tube.

**Fix:** Floor is the ribbon under current XZ. A large along-jump is legal when XZ is on that ribbon. Pit query / reacquire walk ~180 m by Euclidean nearest; tunnel samples only count when the car is actually there. Safari throw land pad is 52 m with 72 m of flat after it. Stale pit is not a takeoff and not a pad floor.

| Change | Status |
|--------|--------|
| Climb after jump 3 is a road lock, not a teleport | **Done** |
| Pad Y cannot hold the chassis under the climb | **Done** |
| Tunnel magnet requires XZ in the tube | **Done** |
| Jump 3 land + flat is long enough for a fast throw | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=427`** · `vehicle.js?v=92` · `track.js?v=187` · `courses.js?v=62` · `ai.js` vehicle import 92

**Proof:** `node tools/qa-sprint89-no-teleport.mjs` · `node tools/qa-sprint68-jump-land.mjs` · `node tools/qa-sprint72-road-lock.mjs` · `node tools/qa-sprint75-glitch.mjs --static`

**Still human-only:** Drive Desert jump 3 at speed. Land on the sand, climb, enter the tunnel on the road. Hard-refresh `?v=428`. GitHub Pages is stale until this is pushed.

---

## Sprint 91 — Navigator says each turn/jump once (26 Aug 2026)

**Player moment:** Before each corner the co-driver says **easy / medium / hard left or right**. Before each jump it says **jump**. One line per corner and per crest. A long sweeper is not a loop of the same call.

**Cause:** Turn ids bucketed every 36 m so a sweeper re-fired. A 2.2 s cooldown skipped the next corner. Jump lock of 110 m ate the second jump of a pair. Hairpins used a different clip. Nav decode waited on the idle SFX graph.

**Fix:** Stable id = arc start. Spoken-id set for the race. Whole-arc grade (easy < 42°, medium < 95°, else hard). Hairpin-scale turns use hard left/right. Nav bus + clips boot on first gesture.

| Change | Status |
|--------|--------|
| Easy / medium / hard L/R + jump VO | **Done** |
| One call per turn and per jump | **Done** |
| Sweeper is silent after the first line | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=428`** · `engine.js?v=54` · `codriver.js?v=32` · `track.js?v=188` · `pace-call.mjs?v=2`

**Proof:** `node tools/qa-sprint67-pace-vo.mjs`

**Still human-only:** Desert teaching left then right, then Jump, with NAVIGATOR up. Each line once.

---

## Sprint 92 — Jump 3 never drops under the stage (27 Aug 2026)

**Player moment:** Desert (stage 1) Safari throw. Land on the sand, drive the climb, enter the tunnel on the road. The car is not pulled under the stage, does not clip through the ribbon, and is not teleported.

**Cause:** After a good landing the query could still say `gap` while XZ was already on the pad/climb (`_stalePit`). `pit` was forced false, so grounded plant / hover cap treated the **hole mesh Y** (~0–4 m) as the road. The chassis was slammed under the climbing asphalt. `_keepOnRibbon` then pinned that pit query, `_neverFallThrough` no-op'd, and unstick could haul toward a distant ribbon.

**Fix:** Never use gap-axle / stale-pit Y as a grounded deck. Floor is `_solidFloorY` (road under current XZ). A gap query the car has left is replaced with the solid ribbon, not pinned. Reacquire will not keep a pit hint when the car is already on the pad. Unstick will not haul more than 14 m. Desert land under jump 3 → tunnel stays a wash so dunes cannot eat the chassis.

| Change | Status |
|--------|--------|
| Stale pit / both-gap deck cannot plant the car under the climb | **Done** |
| Hover cap cannot pull down onto hole Y | **Done** |
| Left-the-hole query is not pinned back into the pit | **Done** |
| Unstick cannot teleport toward the tunnel | **Done** |
| Jump 3 climb corridor stays a land floor | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=429`** · `vehicle.js?v=93` · `track.js?v=189` · `ai.js` vehicle import 93

**Proof:** `node tools/qa-sprint89-no-teleport.mjs` · `node tools/qa-sprint68-jump-land.mjs` · `node tools/qa-sprint75-glitch.mjs --static`

**Still human-only:** Drive Desert jump 3 at speed. Land, climb, tunnel on the road. Hard-refresh `?v=429`. GitHub Pages is stale until this is pushed.

---

## Sprint 93 — Roadway clear of environment geometry (27 Aug 2026)

**Player moment:** Every championship stage. Drive the painted ribbon. Dunes, ridges, rocks, trees, and props do not sit on the asphalt or clip through the chassis on the racing line.

**Cause:** 10 m land cells interpolated banks onto the lane after the trench ended. Props could still instance onto paint if a centre-only keep-out missed a GLB footprint. Colliders tolerated 0.4 m of asphalt overlap.

**Fix:** Widen Desert wash/chase so dune tris cannot straddle the ribbon. Refuse any land vert that can own a triangle over paint. Strip every instanced pose whose footprint overlaps the lane (overhead tunnel ribs kept). Scrub colliders that touch asphalt. Headed QA samples land mesh verts and env instances, not only `_groundHeight`.

| Change | Status |
|--------|--------|
| Desert land wash 56 m; jump 3 corridor 64 m | **Done** |
| Land-vert refuse 2.05 cells; desert chase-flat 56 m | **Done** |
| `_stripLanePoses` / `_laneKeepout` on every instance batch | **Done** |
| Rock/cactus/canopy drive strip matches GLB radius | **Done** |
| Colliders that touch paint are dropped | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=430`** · `track.js?v=190`

**Proof:** `node tools/qa-env-clip.mjs` · `node tools/qa-desert-clip.mjs`

**Still human-only:** Hard-refresh `?v=430` and drive Desert, Forest, and Mountain on the racing line. GitHub Pages is stale until this is pushed.

---

## Sprint 94 — Realistic volumetric sky and lighting (27 Aug 2026)

**Player moment:** Title pad and every stage. Look up: distinct cumulus with lit tops, shadowed bases, and silver edges. The dome is a blue atmosphere with a sun disc, not a painted ramp. Ground lighting is a hard key with sky fill — cars and dunes have a lit side.

**Cause:** Weather islands were almost always on, so the march drew a thin white sheet. Atmosphere blend was 0.38 (the sand-tinted gradient won). Cloud colours were converted to sRGB then tone-mapped as linear. Fill + ambient outran the sun, flattening the stage. Cinema march was 12 coarse steps through a short shell.

**Fix:** Island weather + Worley billows, thicker planet shell, 16 cinema view steps, Beer-Lambert with dark bases and dual-lobe HG. Rayleigh/Mie atmosphere owns the dome. Linear cloud colours. Sun as key, fill/ambient dropped. Lower sun altitude for rims and longer shadows.

| Change | Status |
|--------|--------|
| Distinct volumetric cumulus (islands, Worley, self-shadow) | **Done** |
| Analytic atmosphere blend ~0.82; no sand in the sky ramp | **Done** |
| Cinema 16×2 raymarch; linear cloud lighting into ACES | **Done** |
| Stage lights: stronger key, weaker fill, lower sun | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=433`** · `sky.js?v=25` · `config.js?v=144`

**Proof:** `node tools/qa-sprint69-clouds.mjs` · `node tools/qa-sprint30-realism.mjs` · `node tools/qa-sprint76-perf.mjs`

**Still human-only:** Hard-refresh `?v=433`. Title sky and a Desert look-up should show puffy clouds and a directional sun.

---

## Sprint 95 — Fast first-race load (27 Aug 2026)

**Player moment:** PRESS START → car pick → Desert countdown. The loading overlay should clear in a handful of seconds, not sit on “Sculpting terrain / Grid 8 / 14” while the tab feels frozen.

**Cause:** `preparePropKit()` fetched every spectator, alpine house, and the forest tree pack before Desert planted a cactus. Terrain yielded one rAF per tile row. Championship spawned 14 rivals with a yield each. `_beginRace` kicked `prepareCelica()` (all 7 MB heroes) during the track build. GPU settle compiled the entire stage (`showAllChunks`) then compiled it again, and allocated a 4096² shadow atlas before the first present.

**Fix:** Scenery-scoped kit (Desert omits the forest pack). Idle PRESS START only HTTP-prefetches those GLBs so SELECT MODE stays clickable. Time-budgeted yields (~10 ms, no no-op awaits). Hero + rival LODs parse together after the course mesh. Grid spawns in one pass. Compile the prewarmed start-grid view only. First presents at 2048; desktop quality starts at medium.

| Change | Status |
|--------|--------|
| `preparePropKit(scenery)` — Desert skips forest pack + alpine | **Done** |
| Land / plants yield on a 10 ms budget, not per row | **Done** |
| `prepareRivalLods` overlaps the track build; no full garage on car pick | **Done** |
| Start-grid compile only; 2048 settle atlas; medium start tier | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=434`** · `track.js?v=191` · `prop-kit.js?v=20` · `celica.js?v=122` · `crowd.js?v=11`

**Proof:** `node tools/qa-sprint95-load.mjs` · `node tools/qa-sprint88-car-pick.mjs` · `node tools/qa-sprint77-boot.mjs` · `node tools/qa-boot-smoke.mjs`

**Still human-only:** Hard-refresh `?v=434`. Smash through PRESS START → Championship → Celica and confirm countdown in well under the old ~40 s wait. GitHub Pages is stale until this is pushed.

---

## Sprint 35 — Visible crash damage (27 Aug 2026)

**Player moment:** Clip a Desert berm or rub a rival. The shell dents on that side, sparks kick off the contact, paint scuffs, and the chase cluster BODY bar fills. A hard beating flashes **BODYWORK**.

**Cause:** Sprint 35 shipped paint darkening applied every frame. At rally speed it was invisible. Shared materials could tint the pack. No sparks, no HUD, no navigator sting.

**Fix:** Impact-normal dents (up to six, cloned geos/materials). Additive spark burst. BODY meter. CONTACT / BODYWORK HUD calls. DCC manifest lists every car GLB with mesh counts.

| Change | Status |
|--------|--------|
| Directional dents + paint tiers on hit (not per-frame) | **Done** |
| `ImpactSparks` on wall / rival hits | **Done** |
| BODY cluster bar + BODYWORK flash at tier 3 | **Done** |
| DCC pipeline catalogs all car folders + GLB stats | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=435`** · `damage.js?v=2` · `effects.js?v=55` · `collide.js?v=39` · `vehicle.js?v=94` · `hud.js?v=30` · `codriver.js?v=33` · `css/game.css?v=30` · unified `config.js?v=144`

**Proof:** `node tools/qa-sprint35-damage.mjs` · `node tools/qa-sprint35-40-matrix.mjs`

**Still human-only:** Drive Desert, bank a wall at speed, confirm the quarter-panel crumples and sparks read in chase cam. Author `damaged.glb` later for a mesh swap. Sprints 36–40 stay as the next AAA pass (pace, audio, Pacejka, iGPU, ghosts) — this sprint closed the damage gap only.

---

## Sprint 35a — SELECT CAR unlock regression (27 Aug 2026)

**Player moment:** Open SELECT CAR. Buttons light up as each chassis finishes parsing, instead of the whole garage waiting on the slowest model.

**Cause:** The Sprint 95 load fix pushed `_warmGarage()` to an 8 s idle timer, so entering SELECT CAR could show Delta / Stratos as `LOADING…`. Boot smoke caught it: **1/3 cars selectable**. `prepareCelica()` also only reported completion after `Promise.all`, so no button unlocked early.

**Fix:** `_showCars()` starts the garage warm immediately. `prepareCelica(onEach)` fires per chassis and re-syncs the buttons as each GLB lands.

| Change | Status |
|--------|--------|
| Car screen starts the garage warm on entry | **Done** |
| `prepareCelica` reports per-chassis readiness | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=436`** · `celica.js?v=124`

**Proof:** `node tools/qa-boot-smoke.mjs` — 16/16, 0 page errors, selectable cars 1/3 → **2/3** on a 1.3 fps software rasteriser; countdown wall-clock 42.0 s → 27.5 s.

**Still human-only:** Hard-refresh `?v=436` and confirm all three cars are pickable on hardware GPU without a `LOADING…` beat.

---

## Sprint 96 — Frame rate: is it 60 or 30? (27 Aug 2026)

**Question asked:** "Is it hitting 60 fps or 30 fps? Keep it consistent."

**Measured answer — it was neither.** Headed probe, Apple M1 Pro, Desert, 14 rivals:

| Metric | Before | Note |
|---|---|---|
| p50 present interval | 16.80 ms (59.5 fps) | median frame *did* hit vsync |
| p95 present interval | 34.00 ms (29 fps) | exactly two vsyncs — one missed deadline |
| frames over 16.6 ms | 65.2% | |
| delivered rate | ~46 fps average | **the judder case: half the frames at 60, half at 30** |

A frame that costs 17 ms cannot hit the 16.67 ms deadline, so it waits a whole
extra vsync and lands at 33.3 ms. Mixed with frames that make it, the result is
an uneven ~46 fps, which reads worse than a steady 30.

**Four defects found and fixed:**

| # | Defect | Fix |
|---|--------|-----|
| 1 | **Sprint 35 dent rebuild ran per physics substep.** `hitWall` is re-stamped every substep, so a wall scrape called `rebuildDents()` several times per frame, each re-uploading every body position buffer and recomputing vertex normals — measured 44 ms frames and climbing during a sustained rub. | Rate-limited to one geometry pass per 220 ms; the worst magnitude of the rub is remembered so the dent that lands still reflects the hardest contact. |
| 2 | **The cheapest quality tier was not cheap.** `minPixelRatio: 0.85` resolved to an effective 1.275 pixel ratio on a 2× Retina panel, so tier `min` still rendered 2.0 Mpix with nowhere left to go. | Floor lowered to 0.65 (~1.17 Mpix). |
| 3 | **The scaler classified cost but never chased the deadline.** At a steady 24 ms it settled on `low` and delivered a permanently juddering 41 fps, by design — the old QA test asserted exactly that ("settles on one tier and stops moving"). | Ladder now spends every quality tier while over the deadline, and never buys quality back while still missing it. |
| 4 | **HUD FPS readout lied.** Closed Sprint 76 open item 3 (see above). | Counts presented frames over wall time. |

**New mechanism — present-cadence lock.** When the scaler has spent every quality
tier and still cannot hold 60, it stops chasing it and presents every second
vsync for an even 30 instead. Downward-only within a stage (an oscillating
cadence is worse than either rate); a new stage re-grades from 60. `LOCK30_HOLD`
is 600 presented frames — ~10 s of evidence at the cheapest tier — so a dense
village section or a background app cannot spend it.

`shadowEvery` is now tier-driven (1 at high/medium, 2 at low/min). The sun atlas
re-render is a second full geometry pass of the visible world; sunlight barely
moves, so re-baking every other frame is imperceptible on a soft PCF shadow.

**After:** the cadence lock engages correctly and delivers 30.4 fps avg, tier
`min`, `locked30: true`. **But the present-interval EMA is 37 ms, so the machine
is missing even the 30 Hz deadline** — with the car nearly stationary (speed 6.9).

**Open — still not a 60 fps build:**

1. **Fixed GPU cost is still ~37 ms at the cheapest tier, with the car barely moving.** This is static scene rendering, not motion or streaming cost. Sprint 76 open item 1 remains open. Attribution showed pixel ratio is the dominant lever (−15.8 ms going to 0.6), i.e. the build is fragment/fill-rate bound. Cube reflections are already off (`reflectEvery: 0`) and the cabin mirror is POV-only, so neither is a suspect. Next: draw-call and overdraw reduction, not more scaling knobs.
2. **Sprint 76 open item 2 (stage-build wedge) reproduced twice more today** — 2 of ~6 headed runs, matching the documented rate. `Runtime.evaluate` unresponsive >180 s, and separately a >120 s track build. It is *not* caused by the Sprint 96 changes and not by the perf probe's subsystem toggles (both were initially suspected here and both were wrong). Still the hardest ship blocker.
3. **This machine cannot produce a trustworthy absolute number.** Three identical probe runs gave rAF p50 of 8.9 / 16.8 / 24.5 ms. The host Chrome had 30 live processes, several days old, competing for the same GPU. Any future perf claim needs a quiet machine.

**Note on the probe itself:** `qa-frame-probe` taps `requestAnimationFrame`, which
fires at *display* refresh. On this 120 Hz ProMotion panel it reported p50 8.9 ms
("112 fps") while the game presented 27. It now reports delivered fps, scaler
cadence and tier first, and its verdict grades consistency — a steady 30 passes,
an uneven 46 fails.

**Cache:** `index.html` / `main.js` / `game.js` **`?v=440`** · `perf-tier.js?v=9` · `celica.js?v=125` · `damage.js?v=3` · `config.js?v=144`

**Proof:** `node tools/qa-sprint76-perf.mjs` (20 checks, incl. 7 new cadence-lock checks) · `node tools/qa-boot-smoke.mjs` (16/16, 0 page errors) · `node tools/qa-frame-probe.mjs` · `node tools/qa-perf-attribute.mjs` (new)

**Still human-only:** Hard-refresh `?v=440`, drive Desert 2 minutes and confirm the cadence feels even rather than juddery. Scrape a wall at speed and confirm dents still land and the frame does not collapse.

---

## Sprint 97 — Stage 1 is not functional: the teleport after jump 3

**Reported:** "the car clips through the ground and gets teleported when landing
after the third jump, before entering the tunnel. Stop the glitch teleport, stop
resetting the car in this section. The entire course should be functional — right
now stage 1 glitches and bugs out before completing the first section."

**Both halves of that report were true, and they were two independent defects.**
Neither lived in the jump code, the guard, or the reset logic that previous
sprints kept patching.

### Why this shipped: the glitch test never reached a jump

`qa-sprint75-glitch.mjs` held full throttle with **`steer: 0`** for 240 fixed
steps. The car left the road in the first corner and the run ended after ~46 m of
a 3375 m stage — so it had never reached jump 1, let alone the Safari throw at
~990 m. It reported **PASS** on all three stages while Desert was unfinishable.
`docs/GLITCH-REPORT.md` recorded the tell in plain sight: `Dist (m) 45.8 / 53.6 /
65.5`. A pass over 1.4% of a stage is not a pass.

### Defect 1 — a tunnel wall flung the car 573 m (the teleport)

Trapped with an accessor on the live `position` Vector3, which named the call
site directly: `applyGlance` ← `glanceObstacles` (`js/physics/collide.js`).

The wall branch treated a tunnel/underpass face as an **infinite one-sided
half-space**. `along` bounded the wall's *length*, but `dist` — the signed
distance from the wall plane — was unbounded below:

```
const dist = dx * nx + dz * nz;
const overlap = ext - dist;       // dist = -571  ->  overlap = 573
applyGlance(v, nx, nz, overlap);  // pushes by overlap * 1.05
```

Desert's tunnel arm curves back over its own approach, so that infinite strip
crosses the jump-3 landing zone. Measured, dead centre on the road at 44 m/s:

| step | progress | world XZ | lateral | moved |
|---|---|---|---|---|
| n | 1110.5 | (425.2, 878.9) | 0.8 m | 0.73 m |
| n+1 | 1111.2 | (984.4, 750.3) | **573.6 m** | **573.75 m** |

Then `_unstick` hauled the car back at ~3 m/step while `_keepOnRibbon` refused
the 74.6 m query jump and pinned progress at 1111.2 **forever** — 840 samples
frozen, 43 `spline-snap` recoveries. So the same root cause produced both the
teleport *and* the "car reset / stuck" the player sees.

**Fix (two layers, `collide.js`):** a wall is a slab, not a half-space — reject
the hit when the chassis centre is more than `WALL_BACK` (2 m) behind the face;
and cap any single depenetration at `MAX_PUSH` (3 m), so **no** collider can
ever teleport a car again, whatever future geometry reports.

### Defect 2 — an 8.9 m cliff in the road at 2438 m

Found only after defect 1 let the car reach the rest of the stage. The car was
dead centre (lateral 1.2 → 0.5 m) at 48 m/s and **the road itself fell 8.9 m over
4 m of track**, logging `under-world` + three `y-warp` recoveries.

`_separateOverlappingRibbon` lifts a later ribbon into a flyover over ±24 posts,
but its apply loop did `if (pts[k].tunnel || pts[k].underpass) continue;` —
correct intent (a tunnel floor cannot move) with a broken consequence: the
neighbours were lifted and the protected post was not.

```
#934 dist=2437.41 y=24.732
#935 dist=2440.66 y=15.872  UNDERPASS   <- 8.86 m step, one 3.25 m span
```

**Fix (`track.js`):** the ramp now fades to zero *before* the first protected
post (`_liftRampEnd`), and a lift is **all-or-nothing** — if full clearance will
not fit inside `LIFT_GRADE_MAX` (18%, matching the steepest hand-authored ramp
in the game), it is refused. The intermediate version that merely *clamped* the
height was worse: a partial lift never reaches `CLEAR`, so all six passes
re-applied it and stacked a 12.5 m hump with a 154% wall — a cliff traded for a
ramp. Where the lift will not fit, the crossing is already grade-separated by
the tunnel or underpass that is limiting the run.

### Proof

| Stage | Before | After |
|---|---|---|
| Desert | frozen at 1111 m, 48 guard events | **3300 m driven, 0 severe** |
| Forest | (never tested past 54 m) | **1300 m driven, 0 severe** |
| Mountain | (never tested past 66 m) | **3050 m driven, 0 severe** |

- `node tools/qa-desert-jump3.mjs` (new) — centreline autopilot pumping
  `_fixed(1/60)`, zone-by-zone incident report, and a position-warp trap that
  prints a stack trace. No renderer, so it is immune to the GPU noise that makes
  the frame probes unreliable on this host.
- `node tools/qa-spline-continuity.mjs` (new) — walks every stage centreline and
  fails on horizontal breaks **or vertical cliffs** (>60% grade). All three
  stages now clean; this is the gate that would have caught defect 2 on day one.
  Its first version only measured horizontal gap and passed the 8.9 m cliff.
- `node tools/qa-sprint75-glitch.mjs` — now steers. Real coverage: **1477.8 m /
  1306.0 m / 910.4 m** (was 45.8 / 53.6 / 65.5). Verdict is severity-aware, and
  a lap wrap no longer reads as a teleport.

**Accepted, not hidden:** 1–2 `buried` events per stage remain, all 6–12 cm on
jump ramps where the deck climbs 0.19 m per step at 45 m/s. The guard corrects
them inside the same physics step, so nothing renders sunk. They are reported as
"minor ramp catch-up" rather than asserted to zero, because claiming zero would
have meant deleting the assertion.

### Two stale QA assertions repaired (pre-existing, unrelated to this work)

- `qa-sprint72-road-lock`: asserted the literal `onGround && !pit && ...y > floor`.
  A prior refactor replaced `!pit` with an `onSolid` term that *also* covers
  stale-pit and gap-deck — strictly stronger. Now asserts the contract.
- `qa-sprint66-player-bump`: labelled `ai.js?v=110` but matched `?v=109`; the
  tree is at 115. Now a `>=` comparison, like its neighbours.

### The stage-build wedge is still open, and still not this

Three `qa-desert-bridge-portal` runs failed with the main thread blocked, and one
run with the old lift code passed — which looked like a regression I had caused.
It is not, and guessing was not good enough, so it was measured:

| Stage | Build | `_separateOverlappingRibbon` | Share |
|---|---|---|---|
| Forest | 42448 ms | 6.8 ms | 0.016% |
| Desert | 34215 ms | 41.8 ms | 0.122% |
| Mountain | 11267 ms | 24.5 ms | 0.217% |

The separator is 0.016–0.217% of a build and calls `_liftRampEnd` 30–52 times
total. It cannot produce a 34 s build. Those builds were slow because the host
was at **load average 17.6** with 28 competing Chrome processes — the same
condition Sprint 96 flagged as making absolute numbers worthless. Sprint 76 open
item 2 stays open and still needs a quiet machine.

`node tools/qa-stage-build-time.mjs` and `node tools/qa-lift-cost.mjs` (both new)
exist so the next person gets many timed samples per minute instead of one
5-minute sample, and can separate "slow build" from "wedged main thread".

**Cache:** `index.html` / `main.js` / `game.js` **`?v=441`** · `collide.js?v=40` · `track.js?v=193`

**Still human-only:** hard-refresh `?v=441`, drive Desert and confirm the landing
after the third jump now runs straight into the tunnel with no warp, no freeze
and no reset, and that the run home past 2400 m is a road rather than a ledge.

---

## Sprint 98 — Dead steering, and the teleport class closed for good (27 Aug 2026)

Two things happened in this sprint. A player-blocking regression was reported
mid-verification and took priority; the jump-3 work from Sprint 97 was then
hardened from "this instance is fixed" to "this class cannot ship".

### Defect 1 — CRITICAL: steering completely dead

**Reported:** "cannot turn in this version: `http://127.0.0.1:52243/index.html`
turning not responding at all."

**Root cause — a QA-only override that could latch permanently.** Port 52243 was
never the dev server (that is `8765`); it was an ephemeral port from
`qa-harness.mjs` `startServer()`. A `qa-sprint75-glitch.mjs` run was killed
part-way through, which left its Chrome page alive with `game._qaDrive` and
`input._qaHold` still set to `{throttle: 1, steer: 0, ...}`.

`Input.poll()` applied that hold **last**, unconditionally:

```js
// Headless QA hold — applied last so a real key/pad still wins if present.
const qa = this._qaHold;
if (qa && typeof qa === "object") {
  if (qa.steer != null) this.steer = bounded(qa.steer, -1, 1);   // overwrites the player
```

The comment was simply false. A real key never won — `steer` was overwritten
with the QA value every poll, so the car could not turn at all, with nothing on
screen to explain why. `game.js` made it worse by re-arming `_qaHold` from
`_qaDrive` every frame *and* re-applying `_qaDrive` straight onto `this.input`
**after** `poll()`, so releasing it in `input.js` alone would not have worked.

**Fix (both sides of the loop):**

- `js/input.js` — a hand on the controls (`usingKeys || usingPad || touch`) now
  drops `_qaHold` and raises `qaReleased`, instead of being overwritten by it.
  The hold is honoured only while nobody is driving.
- `js/game.js` — honours `input.qaReleased` immediately after `poll()` and
  clears `_qaDrive`, so the re-apply block below cannot undo the release.
- `js/game.js` — clears `_qaDrive` / `_qaHold` at race start as a second guard.
  Every QA tool arms `_qaDrive` after the grid is live, so no run is affected.

**Why it was shippable: nothing in the suite asserted that the car turns.** The
most basic possible regression passed QA in silence. That is the real finding —
the override bug was one way to break steering, and the suite would not have
caught *any* of them.

`tools/qa-steering.mjs` (new) closes it. It dispatches real keyboard events over
CDP and asserts the chassis yaw actually changes, then deliberately latches a QA
hold and proves a key takes the car back:

```
LEFT   dYaw=1.702  input.steer=1  rack=0.47
RIGHT  dYaw=-1.693 input.steer=-1 rack=-0.46
LATCHED QA HOLD  ·  before key: qaDrive=true  ·  after LEFT: qaDrive=false qaHold=false
PASS — the car steers
```

One tooling note worth keeping: the first version of this test held a key for
1.2 s of wall clock and measured `dYaw=0.021`, which looks exactly like dead
steering. It was not — headless Chrome throttles `requestAnimationFrame` to a
few frames per second, so almost no physics ran. The test now steps physics
explicitly while still driving the real `input.poll()` path. A wall-clock-based
input test in headless is close to worthless.

### Defect 2 — the teleport class, not just the instance

Sprint 97 fixed the specific collider that flung the car 573 m. This sprint
makes the whole category non-shippable.

**`_guardXZ` invariant (`js/physics/vehicle.js`).** `_guardDrive` policed NaN,
Y-bury and along-track progress, but on a progress warp it deliberately *keeps
the body* and rewinds progress only — so world-space XZ had never been bounded
at all. Any subsystem writing a bad position moved the car unchallenged. Now a
step may move the chassis `speed * dt + XZ_STEP_SLACK` (12 m, covering two 3 m
depenetration passes plus a 5.6 m `_unstick` haul) and no further. Past that the
pose is held for one step and logged as `xz-warp`; 30 consecutive rejections
escalate to `_restoreGoodPose` so a bad collider cannot freeze the car instead.

**Wall faces are slabs with a real back (`track.js` + `collide.js`).** Sprint 97
capped how far a wall could shove the car; the face was still geometrically
infinite behind its plane, and the blanket 2 m cutoff meant a car more than 2 m
inside a **5.2 m** bridge pier was ignored entirely and could drive through solid
rock. `_wallFace` now takes the lining's real thickness (tunnel `2.4`, desert
bridge portal `5.2`) and the collision test bounds the slab at
`-(depth + ext)` — buried cars are still pushed out, distant ones ignored.

### Coverage: one sample of a 3-D approach space is not a test

Sprint 97's evidence was a single centreline pass over jump 3 at ~45 m/s. Players
arrive off-line, crooked and at any speed. `tools/qa-jump3-sweep.mjs` (new)
drives the same 410 m from **175 launch states** (5 speeds x 7 lateral offsets to
+-11 m x 5 yaw errors to +-0.6 rad), hooking every `Vehicle.step` — not every
frame — to catch WARP / SINK / PINNED / NaN / STUCK.

Two harness lessons are baked into the tool. Practice mode has a stage timer, so
without topping up `timeLeft` the race ended part-way through the sweep and every
later case looked "pinned" at its spawn — a fake failure. And a case that ends in
a state other than `race` is now reported as **skipped**, never as a pass.

### Status

| Item | State |
|---|---|
| Steering responds to real input | **Verified** — `qa-steering.mjs` |
| Throttle / brake / handbrake respond | **Verified** — same tool, measured deltas below |
| Latched QA override cannot kill input | **Verified** — latch armed deliberately, key takes it back |
| `_guardXZ` does not fire in clean driving | **Verified** — 0 `xz-warp` across 175 sweep states + 3 stage drives |
| `_guardXZ` actually catches a teleport | **Verified** — `qa-guard-xz.mjs`, injected 200 m warp |
| Jump 3 survives every approach | **Verified** — 175/175 launch states, through to 1376 m |
| Wall slabs have a modelled back | **Fixed**, covered by the sweep + glitch drive |

### The coverage gap was wider than steering

The first fix here was scoped to "the car turns". The report then escalated to
**"no steering or acceleration controls work"** — and nothing in the suite
asserted throttle either, so the headline complaint was still uncovered by the
test written to prevent it. `qa-steering.mjs` now exercises the whole control
set through the real `Input.poll()` path, with measured values rather than a
bare PASS:

```
THROTTLE   0 -> 10.3 m/s   (+10.3 in 2 s)    input.throttle=1
BRAKE      30 -> 20.9 m/s  (-9.1 in 1 s)     input.brake=1
HANDBRAKE  30 -> 19.7 m/s  (-10.3 in 1 s)    rearSlide=true
LEFT       dYaw=+1.693     RIGHT dYaw=-1.693  rack=+-0.46
```

The latch proof is now throttle-aware, because the killed run left
`{throttle: 1, steer: 0}` — a latched hold means **stuck full throttle** as much
as dead steering. After a real key retires the override the test asserts the
player can both apply throttle again (`0 -> 10.3 m/s`) and **lift off**
(`10.3 -> 8.4 m/s`, `input.throttle=0`). A car pinned at full throttle that
ignores the player is as broken as one that will not move.

### The guard is now tested positively, not just for false positives

`_guardXZ` was previously only shown *not* to misfire. `tools/qa-guard-xz.mjs`
wraps `track.query` on the live Track — called mid-step, after `_capturePrev()`
and before `_guardDrive` — to write a bogus offset into `player.position` from
inside the step, exactly as the unbounded wall face did. All patching is runtime
only; no diagnostic code ships in `js/`.

```
REJECT    injected 200 m -> moved 0 m (budget 12.42 m), 1 xz-warp, drove 23.8 m after
ALLOW     injected 5 m   -> moved 5.01 m, 0 xz-warp  (guard is not refusing everything)
ESCALATE  40 warps -> 40 rejected, counter reset at exactly 30, 1 checkpoint restore,
                     car back on the ribbon (lateral 0 m), drove 23.3 m after, pose finite
```

Two things this exposed. `spawn()` sets `_glitchIgnore = 8`, a grace window in
which `_guardDrive` skips **every** check — a test that injects inside it proves
nothing, which is why the first run reported a 200 m warp sailing through. And
the escalation now calls `_restoreCheckpoint` (a later, better recovery that
falls back to `_restoreGoodPose`), so the "never exercised" note from the last
pass is closed: it fires at exactly 30 and the car recovers rather than freezing.

### Verification run (27 Aug 2026, final state on disk)

```
node tools/qa-static-audit.mjs     PASS  10 checks, 0 failures
node tools/qa-steering.mjs         PASS  full control set, values above
node tools/qa-guard-xz.mjs         PASS  reject / allow / escalate
node tools/qa-boot-smoke.mjs       13/16 — see boot-smoke note below
node tools/qa-sprint75-glitch.mjs  PASS  desert 1497.9m forest 1309.0m mountain 914.5m
                                         severe=0 tele=0 buried=0 nan=0
node tools/qa-jump3-sweep.mjs      PASS  175/175 launch states, 0 xz-warp
```

The Desert glitch drive covers 1497.9 m, past both the jump-3 landing
(~1036–1103 m) and the tunnel mouth (~1284 m); the sweep runs to 1376 m, so the
tunnel wall faces that produced the original 573 m warp are actually driven.

**Boot-smoke note — not clean, and not claimed as clean.** Three runs on the
final tree: the first reached 16/16 earlier in the pass, the last two stopped at
13/16. Every run passes boot, title, menu, car select, course select, countdown,
`race produces animating frames and responds to input`, and HUD — so the build
boots and is drivable. The failure is the *second*, post-reload pass:
`#screen-cars after PRACTICE`, which has a **5 s** budget, on a machine at load
~8 rendering at **2.2 fps** through the software rasteriser (it was 5.5 fps when
the step passed). A third run failed instead at the 60 s track build. Two
different failure points across runs is the signature of the known stage-build
wedge under load, not a deterministic defect, and none of it is in code changed
here — but it is **unresolved**, needs a quiet machine, and if it persists once
the concurrent `vehicle.js` / `game.js` refactor settles it belongs to that work,
not to this one.

**Concurrent-edit note.** Another agent was refactoring `js/sky.js` and
`js/physics/vehicle.js` during this pass, and the tree was caught in a
non-booting state twice: a `SyntaxError` at `js/sky.js:184` (raw GLSL at module
top level, mid-edit) and `TypeError: this._guardBuried is not a function` thrown
every frame from `Vehicle.step`. **Neither was caused by this work** — both
cleared within a minute as that agent finished, and every result above was
re-run afterwards against a parsing tree. It is worth knowing that the build is
briefly unbootable while that refactor lands.

**Not verified / still open.** No human 10-minute drive yet. `_guardXZ` is proven
against a synthetic injected warp, not against a naturally occurring one — the
natural cause it was written for is fixed, so it cannot currently be provoked in
play. The fixed GPU cost at the minimum quality tier from Sprint 96 remains open
and needs a quiet machine.

---

# Sprint 99 — Three-layer fall-through lock (27 Aug 2026)

**Engine:** custom JS / Three.js arcade chassis (`js/physics/vehicle.js`), not Unity.
There is no Rigidbody CCD toggle. The analog is a thick solid-deck sweep plus a
query that is forbidden to use the visual jump pit as a floor.

**Player moment:** After Desert jump 3 (Safari throw) the car lands on the
asphalt and keeps racing. If a future query or hitch still puts the chassis
under the stage, it restores the last checkpoint instead of freezing in the void.

**Cause (the "second problem"):** the road collider is a spline height sample,
not a thick mesh. `_solidFloorY` treated nearby `jumpKind === "gap"` posts as a
legal floor, and used `_landPadY` even when the pad was **disarmed** (`0` is
finite). After the landing strip the car could plant on pit Y / world 0 while
the painted deck was metres above — same location every run.

**Three layers (Unity CCD / checkpoint advice, mapped to this engine):**

1. **Correct physics** — `_sweepSolidDeck` tests the segment
   `previousPosition → newPosition` (4–12 samples, 0.4 m apart), not a point
   overlap at the destination. Hitch time is capped at `FIXED_DT * MAX_SUBSTEPS`
   (3 × 1/60 s); each `step()` is always `FIXED_DT`. After runoff, walls, unstick,
   and car-car, `confirmOnRoad()` runs again so a later writer cannot leave the
   chassis under the deck.
2. **Track safety** — `_solidFloorAt` skips gap posts; only an *armed* land pad
   is a hole floor; `_preferSolidRoad` follows the deck the car is already on.
3. **Recovery** — NaN on position *or* velocity restores the last checkpoint.
   Geometric recovery is checkpoint-based, not a global Y (tunnels/jumps would
   false-trigger). Last-frame pose is not used once the car is already underground.

| Item | State |
|---|---|
| Jump 3 centreline through tunnel mouth | **Verified** — `qa-desert-jump3.mjs` 1400 m, **0 guard hits** |
| All Desert jumps stay on deck | **Verified** — `qa-sprint68-jump-land.mjs` max under 0 m |
| Static glitch gates (swept segment + NaN vel) | **Verified** — `qa-sprint75-glitch.mjs --static` |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=446`** · `vehicle.js?v=98`

**Proof:** `node tools/qa-desert-jump3.mjs` · `node tools/qa-sprint68-jump-land.mjs`

**Still human-only:** a full-throttle Desert run over jump 3, then the climb into
the tunnel. Hard refresh `?v=446`.

---

# Sprint 100 — Trace the fall-through pipeline (27 Aug 2026)

**Player moment:** After Desert jump 3 the car stays on the painted road. The
glitch log no longer screams "buried" on every rising ramp.

**Cause:** "Buried on every course" was a **false diagnostic**, not a void.
`_guardDrive` compared contact-patch Y to the **visual centreline**
(`line.y + ROAD_DECK`) minus 6 cm. On a rising ramp the axle plane sits ~8 cm
off that centreline, so jump 2/3 logged `buried` every run (`y=7.16` vs
`floor=7.24`). That is ramp catch-up, not `y=1.2 → -8.7` tunneling, not a
downward collision normal, and not a physics/mesh split (`playerMesh` is
`drawPose` of the same Vector3).

**What changed (trace, not another collider):**

1. Per-tick `_pipe` snapshot around every physics Y write: `prevY` → `afterXZ`
   → `afterAir` → `destFloor` / `hit` / `pen` / `normalY` (+1 lift only) →
   `resolvedY`. QA prints this on any remaining `buried` hit.
2. `buried` / `_neverFallThrough` run **after** sweep, against the **axle
   plant**, and only if residual penetration is **> 12 cm**. Deep bury
   (`> VOID_RECOVER_M`) restores the checkpoint instead of simulating
   underground. The leftover `under-world` at jump 3 (`y=7.24` `floor=7.33`)
   was the same 9 cm centreline-vs-axle catch-up under another name.
3. `qaSnapshot()` exposes `physY`, `meshY`, `velY`, `pipe` so a headed probe
   can split tunnel / bad resolve / transform desync in one look.

| Item | State |
|---|---|
| False ramp `buried` / `under-world` (8–9 cm centreline) | **Closed** — axle plant + 12 cm residual |
| Pipeline snapshot on every physics Y write | **Done** |
| Mesh vs physics transform | **Not the bug** — same `drawPose` Vector3 |
| Desert jump 3 → tunnel (1400 m) | **Verified** — 0 teleport, 0 clip, 0 NaN, **0 guard** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=446`** · `vehicle.js?v=98` · `ai.js?v=118`

**Proof:** `node tools/qa-desert-jump3.mjs` · `node tools/qa-sprint75-glitch.mjs --static`

**Still human-only:** Desert jump 3 at speed, then the climb into the tunnel.
Hard refresh `?v=446`.

---

# Sprint 101 — Shared tick invariant (not a Desert patch) (27 Aug 2026)

**Player moment:** After any jump — Desert Safari throw is the regression case —
the car lands on the road. A hitch, a crooked approach, or a Forest/Mountain
crest uses the same step.

**Invariant (every physics tick, every course):**

```
previous = pose at step start
stepPhysics(fixedDt)          // dt clamped to 1/60 inside Vehicle.step
sweep(previous → proposed)
if hit: resolveTrackContact   // Y = floor + 4 mm, kill velocity into the road
if !valid || buried: checkpoint   // safety net, not the collider
mesh = drawPose(physics)      // never writes Vehicle.position
```

Hitch: the loop caps accum at `FIXED_DT * MAX_SUBSTEPS` (3). `step()` also
rejects a 0.2 s dt so a future caller cannot integrate a tunnel in one tick.
Recovery clears linear and angular velocity, then plants on the last checkpoint.

| Item | State |
|---|---|
| Swept segment + contact resolve + inward-velocity kill | **Done** — shared, not Desert-only |
| Hitch cannot one-shot the integrator | **Done** — loop cap + `step()` clamp |
| Mesh cannot overwrite physics | **Done** — `drawPose` only |
| Checkpoint is the net, not the collider | **Done** — after sweep |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=448`** · `vehicle.js?v=99` · `ai.js?v=119`

**Proof:** `node tools/qa-desert-jump3.mjs` (0.2 s hitch at the jump-3 gap, 1400 m, 0 guard) ·
`node tools/qa-jump3-sweep.mjs --quick` (45/58 m/s, lat 0/6, hitch at gap, sink=0) ·
`node tools/qa-desert-jump3.mjs --course=forest --metres=800` ·
`node tools/qa-desert-jump3.mjs --course=mountain --metres=800` ·
`node tools/qa-sprint75-glitch.mjs --static`

**Still human-only:** Desert jump 3 at speed. Hard refresh `?v=448`.

---

# Sprint 102 — Recovery is invalid-state only (27 Aug 2026)

**Player moment:** Driving onto Desert jump 3 does not relocate the car. If the
chassis is ever genuinely buried or NaN, it returns to the last pose that
collision resolve had already accepted — not a checkpoint marker, not a
hard-coded map coordinate.

**Cause to close:** `_restoreCheckpoint` sampled `track.sample(_cpDist)` and
planted on the racing-line at that dist. After jump 3 that dist is the tunnel
climb. Reaching the throw then recovering looked like a teleport to a place
the car had never been.

**Invariant:**

```
// Reaching a track location must never teleport the car.
// There is no isDesertJump3(car) branch that writes position.

if (isBuried(car) || !isValidPhysicsState(car)) {
    restoreLastValidTransform(car);  // saved x,y,z,yaw after a successful resolve
    // velocity is zeroed only here
}
```

The saved transform updates only after `confirmOnRoad` succeeds. An underground
pose cannot become the recovery point. Velocity is not cleared by arriving at
the jump.

| Item | State |
|---|---|
| No `if (desertJump3) position = …` | **Done** — never existed in physics; spline restore removed |
| Last-valid stash after resolve | **Done** |
| Restore is saved transform, not `track.sample(checkpoint)` | **Done** |
| Velocity reset only on recovery | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=449`** · `vehicle.js?v=100` · `ai.js?v=120`

**Proof:** `node tools/qa-desert-jump3.mjs` · `node tools/qa-sprint75-glitch.mjs --static`

**Still human-only:** Desert jump 3 at speed. Hard refresh `?v=449`.

---

# Sprint 103 — No body damage model (27 Aug 2026)

**Player moment:** Rubbing a wall or a rival still throws sparks and plays the
bump. The car mesh stays pristine — no dents, paint wear, smashed lamps, or
BODYWORK HUD.

**Cache:** `index.html` / `main.js` / `game.js` **`?v=450`** · `hud.js?v=31`

**Proof:** `node tools/qa-sprint35-damage.mjs`

---

# Sprint 104 — POV mirror + gauges visible (27 Aug 2026)

**Player moment:** Press C into the seat. The tach/speedo show printed faces and
yellow needles. The interior rearview shows the road behind, not a black
rectangle.

**Cause:** Cluster and rearview glass were MeshBasic maps in the main ACES pass.
The opaque dash drew over them (HUD `depthTest: false` did not write depth, so
later cabin geometry won). ACES also crushed the unlit maps.

**Fix:** Put the discs, needles, and mirror glass on layer 1. After the graded
frame, `_renderPovHudOverlay` draws that layer with depth cleared, background
suppressed, and `NoToneMapping`. Cluster sits just in front of the dash box.

| Item | State |
|---|---|
| Layer-1 HUD overlay after post | **Done** |
| Mirror RT still linear, captured behind the bumper | **Done** |
| Gauges face the seat, MPH 0–140 / 9k tach | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=451`** · `celica.js?v=126` · `pbr.js?v=25`

**Proof:** `node tools/qa-pov-mirror.mjs` · `node tools/qa-pov-gauges.mjs`

**Still human-only:** C into POV on Desert — glass shows the grid/road; both
dials read.

---

# Sprint 105 — Brake glow on modeled tail covers (27 Aug 2026)

**Player moment:** Hit the brakes behind the Celica. The red sits in the
wraparound clusters (`x0_light_combi_glass_bl/br`), not as inner boxes or
floating pads. Delta uses the `Light Rear` bar; Stratos uses `TailLight_L/R`.

**Cause:** Glow was wired to inner `REARLIGHT3/4` glass behind the cover, and
`gameShade` caps `Lights_Glass` at 0.48 opacity, so the lamps never read. Mesh
pivots sit at the origin, so the point glow was at the chassis, not the tail.

**Fix:** Light the visible covers. Punch opacity when on. Place the point glow
on the lens AABB.

| Item | State |
|---|---|
| Pick `combi_glass` / `TailLight` / `Light Rear` | **Done** |
| Glass opacity 0.94 when braking | **Done** |
| Glow origin is lens AABB | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=453`** · `celica.js?v=128` · `ai.js?v=122`

**Proof:** `node tools/qa-brake-lamps.mjs`

**Still human-only:** Chase the Celica, brake, confirm the clusters light. Hard refresh `?v=453`.

---

# Sprint 106 — Stratos 1974 CAD GLB (27 Aug 2026)

**Player moment:** SELECT CAR → Stratos. The car is the 1974 wedge with PBR
maps, not the old untextured loft.

The drop is a 4-mesh CAD export (30 MB of 4K PNG, fused L+R axles, `alphaMode:
BLEND` on a black "wire" material, extra 0.001 mm-scale on the body). Boot
resizes textures to 2048, splits axles into `WHEEL_*` hubs, forces the paint
opaque, and clears the double millimetre scale so the body is car-sized.

| Item | State |
|---|---|
| Hero `assets/stratos/stratos.glb` from 1974 CAD | **Done** — 7.8 MB / 12.6k tris |
| Rival LOD | **Done** — 1.0 MB / 7.0k tris |
| Four spinning/steering hubs | **Done** |
| No dummy lamp boxes on painted CAD lights | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=458`** · `celica.js?v=133` · `ai.js?v=127`

**Proof:** `node tools/qa-stratos-starter.mjs`

**Still human-only:** Pick Stratos on the title/SELECT CAR pad. Hard refresh `?v=458`.

---

## Sprint — Desert cacti + live tumbleweeds (2026-08-27)

**Player moment:** Desert verge reads as a real arid stage — two-arm saguaros, sandstone, and scrub — not a stem with a round blob or a palm “circle” on top. Dry tumbleweed balls sit off the ribbon and occasionally roll past with the wind.

| Item | State |
|---|---|
| Dropped Kenney `cactus_short` (one-arm / blob silhouette) | **Done** |
| Dropped Desert palms / cone / default trees and acacia cards | **Done** |
| Roadside mix is `cactus_tall` + rocks + `rock_tallA` + desert bushes | **Done** |
| Horizon cactus rings use `cactus_tall` only | **Done** |
| Real twig-ball tumbleweeds, max two rolling at once | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=459`** · `track.js?v=195` · `prop-kit.js?v=22` · `crowd.js?v=12`

**Proof:** `node tools/qa-sprint-desert-tumble.mjs`

**Still human-only:** Drive Desert and confirm no lollipop cacti; watch a tumbleweed roll across the verge.

---

## Sprint — Clear the driving sightline (2026-08-27)

**Player moment:** The road is in the middle of the screen, not “EASY LEFT” / 3-2-1 captions.

| Item | State |
|---|---|
| On-screen pace notes hidden (co-driver audio kept) | **Done** |
| 3-2-1 / GO / checkpoint flash moved into the top HUD band | **Done** |

**Cache:** `css/game.css?v=31`

**Proof:** `node tools/qa-hud-sightline.mjs`

---

## Sprint — Jump physics variability (2026-08-27)

**Player moment:** The teaching hop skips. The Safari lip throws. A crawl dunks. Lift-and-brake lands flatter and shorter; flat-out lofts, hangs, and can bounce the tail. Brake in the air to drop the nose.

| Item | State |
|---|---|
| Leave is speed × sin(grade) — no 0.4 / 0.75 floors | **Done** |
| Spring pop scales with approach speed | **Done** |
| Nose-up hangs + drags; nose-down dives | **Done** |
| Tail-first bounce vs nose-plant scrub | **Done** |
| Fujimoto lift still cuts height vs flat-out | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=460`** · `vehicle.js?v=101` · `jump.js?v=15` · `config.js?v=145` · `ai.js?v=128`

**Proof:** `node tools/qa-jump-variability.mjs` · `node tools/qa-sprint74-jump-air.mjs`

**Still human-only:** Drive Desert hop vs jump 3 at different speeds; brake in the air on the big one.

---

## Sprint — Navigator says the grade and the side (2026-08-27)

**Player moment:** The co-driver says the corner you are about to take: **easy left / easy right**, **medium left / medium right**, **hard left / hard right**, or **hairpin left / hairpin right**. Desert’s teaching kinks are easy; the bowl and linked pins are hairpin, not a recycled hard call. Jump is still “jump”.

**Cause:** The Freesound pack is WRC **1–5 Left/Right**, so `easy-left.mp3` said “one left”. Hairpin clips were remapped to hard in `clipKey`, and `makeTurnNote` never emitted a hairpin grade.

**Fix:** New spoken grade clips that say those words, left and right distinct. Geometry above 135° plays `hairpin-*`. Cache-bust the nav MP3s.

| Item | State |
|---|---|
| VO says easy / medium / hard / hairpin + left or right | **Done** |
| Hairpin clips actually play | **Done** |
| Teaching 30° / −28° stay easy L then R | **Done** |
| Desert bowl −165° and linked ±148° are hairpin | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=461`** · `track.js?v=196` · `pace-call.mjs?v=3` · `engine.js?v=55` · `codriver.js?v=34` · nav clips `?v=3`

**Proof:** `node tools/qa-sprint67-pace-vo.mjs`

**Still human-only:** Hard refresh `?v=461`. Drive Desert — first two kinks should say easy left then easy right; the bowl should say hairpin right.

---

## Sprint — Cinema daylight (sun, landscape shadows, AO) (27 Aug 2026)

**Player moment:** At rest on Desert, the sun has a direction. Cacti and dunes cast shadows into the chase view, not only under the car. Shade is cooler than the lit face. The road and bodywork sit in the dirt instead of floating on a bright matte.

**Cause:** The race sun frustum was **17 m** half-width — chase cam sees ~120 m, so almost the whole stage was unshadowed. Sprint 61 then raised fill/hemi and dropped post contrast, so the remaining key could not sculpt. No contact AO.

**Fix:** Shadow ortho **54 m** / far **180 m**. Key up, fill/hemi down. Photographic grade (contrast 1.12). Fog starts in the mid-field. Half-res SSAO in the post stack. Not a brightness boost.

| Item | State |
|---|---|
| Landscape sun shadows in chase view | **Done** |
| Sun owns form; fill is fill | **Done** |
| Screen-space crevice AO | **Done** |
| Stage fog / aerial depth | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=468`** · `config.js?v=148` · `postfx.js?v=16` · `lighting-rig.js?v=7`

**Proof:** `node tools/qa-sprint61-lighting.mjs` · `node tools/qa-sprint25-ue5.mjs`

**Still human-only:** Hard refresh `?v=468`. Stand still on Desert — shadows on the sand past the car, paint has a lit side and a dark side.

---

## Sprint — Readable drift chase camera (27 Aug 2026)

**Player moment:** Handbrake into a Desert hairpin. The chase stays planted behind the direction of travel — a calm rear-quarter with the car angled — instead of whipping wide off the outside so the exit disappears. Straight-line medium chase and POV are unchanged.

**Cause:** Chase yaw tracked chassis attitude at full stiffness. During a slide the body points inside the turn, so the lens sat outside the racing line. `slideCamOut` 0.42 plus lateral kick stacked on that whip; look-ahead stayed short while the car was sideways.

**Fix:** Blend chase yaw toward velocity while sliding (`slideYawBlend`), soften yaw follow (`yawStiffnessSlide`), cut outside offset and kick, push look toward travel, and add slide look-ahead so the exit stays in frame.

| Tunable | Before → After |
|---------|----------------|
| `slideCamOut` | 0.42 → 0.16 |
| `slideLook` | 0.62 → 0.78 |
| outside factor cap | `min(0.55, drift×0.85)` → `min(0.28, drift×0.45)` |
| lateral kick cap | 0.09 → 0.045 (`slideKickMax`) |
| `slideYawBlend` | (new) 0.62 |
| `yawStiffnessSlide` | (new) 16 |
| `slideLookAhead` | (new) 4.2 m |
| drift FOV kick | max 3.6 → 2.4 |

| Item | State |
|------|-------|
| Slide chase stays on the racing line | **Done** |
| Straight chase / POV untouched | **Done** |
| Smooth blends (no snap) | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=463`** · `config.js?v=147`

**Proof:** `node tools/qa-sprint37-camera.mjs` · `node tools/qa-sprint70-camera.mjs` · `node tools/qa-cam-blend.mjs`

**Still human-only:** Hard refresh `?v=463`. Drift a Desert hairpin in medium chase — road exit stays readable; car still looks angled.

---

## Sprint — Mobile / Android / iOS ship pass (27 Aug 2026)

**Player moment:** On a phone or tablet, tap PUSH START, pick a mode and car, and drive with on-screen GAS / BRAKE / HB / STEER (or TILT). Title and SELECT MODE stay tappable above the home indicator; Safari and Chrome unlock audio on the first gesture.

| Item | State |
|---|---|
| Title START ≥48px + safe-area | **Done** |
| SELECT MODE / car / course scroll + wrap | **Done** |
| Touch overlay 44px+ targets, landscape HB | **Done** |
| iPadOS / Android tablet detection | **Done** |
| Viewport `interactive-widget` + web-app title | **Done** |
| Mobile QA gate extended | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=477`** · `css/game.css?v=34` · `input.js?v=41` · `touch-controls.js?v=3`

**Proof:** `node tools/qa-mobile-controls.mjs` · `node tools/qa-static-audit.mjs` · championship path of `node tools/qa-boot-smoke.mjs` (Desert countdown + race PASS; practice-reload flake under showroom)

**Still human-only:** Drive on a real iPhone Safari and an Android Chrome phone — portrait tip → landscape, GAS/STEER, co-driver VO after Start.

---

## Sprint — Desert tunnel grounded in the hillside (27 Aug 2026)

**Player moment:** Climb into the Stage 1 tunnel. The mouth is a cut through a
sandstone ridge / embankment — not a free-standing tube floating on flat sand.

**Cause:** `_tunnelHill` existed, but the Desert landmark wash (56–64 m) and
`_addLandTile` chase flatten planed every ridge vert back to bed. Portal boxes
sat on washed sand with no hillside attachment.

**Fix:** Apply `_tunnelCutHeight` / mouth-apron lift before wash; land tiles keep
the cut; portal gets buried shoulder footing, talus aprons, and approach ramps.
Ridge only rises when `minOver` clears the drive verge — folded Desert arms
must not get a hillside on their asphalt. Ribbon refuse stays floors.

| Item | State |
|---|---|
| Land ridge rises beside the bore / clear apron | **Done** |
| Portal footing buried + approach embankment | **Done** |
| Clearance guard so fold arms stay driveable | **Done** |
| In-lane / verge wash contracts still hold | **Done** (qa-desert-clip / qa-env-clip) |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=478`** · `track.js?v=206`

**Proof:** `node tools/qa-desert-clip.mjs` · `node tools/qa-env-clip.mjs` · `node tools/qa-boot-smoke.mjs`

**Still human-only:** Hard refresh `?v=478`. Drive Desert into the tunnel — embankment meets the portal on both sides.

---

## Sprint — Tunnel exit roadway clear (27 Aug 2026)

**Player moment:** Exit the Desert tunnel. The painted lane is empty sand/asphalt. Rock and land do not punch through the road or the car. Shoulder embankment stays on the verge.

**Cause:** (1) Mouth-cut invented lateral distance from along-track (`ridgeDist`), so a sample on the exit centreline got a full hillside. (2) Tunnel-cut land refuse was only **2.4 m**, so 10 m tris folded rock onto the apron. (3) Portal had a **centre approach mound** on the ribbon plus a grounding slab whose top sat above the deck.

**Fix:** Real lateral clearance only for mouth cut. Drive-verge refuse (`ROAD_VERGE+4.5`). Portal rock pushed past the verge; centre mound removed; drive-tube AABB scrub on portal children. Land tiles clamp under nearest ribbon deck in the drive corridor. Env-clip probe uses `roadY` (not cross-arm `overlapBed`) so grade-separated false positives do not mask real clips.

| Item | State |
|---|---|
| Mouth cut never raises on-asphalt verts | **Done** |
| Land refuse clears exit apron | **Done** |
| Portal mid-lane rock scrubbed | **Done** |
| Absolute land clamp under nearest deck | **Done** |
| Env-clip bed = nearest `roadY` | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=478`** · `track.js?v=206`

**Proof:** `node tools/qa-desert-clip.mjs` · `node tools/qa-env-clip.mjs`

**Still human-only:** Hard refresh `?v=478`. Exit the Desert tunnel — clear ribbon, car not buried in rock.

---

## Sprint — Variable jump air / land settle (27 Aug 2026)

**Player moment:** Hit Desert's hop, then the pair. Each jump pitches and rolls differently from speed, lip, line, and pedals. After landing the car rocks and squashes then settles — it does not snap upright like a keyframe.

**Cause:** Graded JumpModel air existed, but every pad touch called `_snapPitchToRoad` and `_landLock` forced `k=1` pitch blend + ±0.01 rad clamp. Residual air attitude was erased the frame you landed.

**Fix:** `_beginLandSettle` keeps residual pitch/roll + impact squash for 0.28–0.92 s. Land-lock no longer wipes settle. Air pitch/roll envelope widened. Glitch/plant paths still hard-snap.

| Item | State |
|---|---|
| Per-jump residual land attitude | **Done** |
| Impact squash + roll rock | **Done** |
| Wider air pitch/roll / lip grain | **Done** |
| Road plant / clip guards retained | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=479`** · `vehicle.js?v=103` · `jump.js?v=17` · `config.js?v=149`

**Proof:** `node tools/qa-jump-variability.mjs` · `node tools/qa-sprint74-jump-air.mjs` · `node tools/qa-sprint68-jump-land.mjs`

**Still human-only:** Hard refresh `?v=479`. Take Desert jump 1 flat-out, then jump 2 lift-brake, then jump 3 off-line — each leave and land should look different.

---

## Sprint — Roadway safety corridor (27 Aug 2026)

**Player moment:** Drive any stage. Rocks, trees, and berms stay out of the drive path. The car glances on its full footprint (not a centre point). Fast hits do not tunnel through a rock between physics frames.

**Cause:** Colliders were scrubbed only 0.15 m past paint; plant used 1.15 m. Env hits used a centre sphere (`CAR_RADIUS`). Discrete end-of-step tests missed thin solids at speed. Build silently dropped bad colliders with no assert.

**Fix:** Shared `ROAD_COLLIDER_CLEAR` (2.2 m = car half-width + safety). Scrub + `_bumpNearRoad` + lane keep-out share it. `_assertDriveCorridor` logs / throws when `strictCorridor` or `__RALLY_STRICT_CORRIDOR__`. Rocks use car OBB + swept prev→current XZ. Residual env∩car notes a glitch and re-resolves.

| Item | State |
|---|---|
| Roadway exclusion zone for solids | **Done** |
| Visual vs collision (scrub solids, keep visuals) | **Done** |
| Car footprint OBB env hits | **Done** |
| Swept movement test | **Done** |
| Fail-loud corridor assert (strict flag) | **Done** |
| Runtime env∩car invariant | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=480`** · `track.js?v=207` · `collide.js?v=42` · `vehicle.js?v=104`

**Proof:** `node tools/qa-env-clip.mjs` · `node tools/qa-desert-clip.mjs`

**Still human-only:** Hard refresh `?v=480`. Clip a Desert shoulder rock with the nose — glance before the body embeds.

---

## Sprint — Contact-only env collision (27 Aug 2026)

**Player moment:** Hit a berm or rock at speed. The car scrapes and keeps going. It does not freeze, teleport, or lose all forward speed. Physics still owns the pose; the mesh only follows.

**Cause:** `applyGlance` scrubbed whole velocity and blended toward a low "keep" heading (player blend 0.38). Stacked 2-pass resolves + a second `glanceObstacles` on residual overlap stopped the car. Large inside-OBB overlaps shoved metres and fought `_guardXZ`.

**Fix:** One authority path — swept contact → push capped (`PLAYER_ENV_PUSH` 0.45) + slop → strip **only** into-normal velocity. No isotropic scrub, no heading blend freeze. Diagnostic `_envIntersect` no longer re-resolves.

| Item | State |
|---|---|
| Normal-only velocity resolve | **Done** |
| Cap env push (no teleport shove) | **Done** |
| Remove stacked second glance | **Done** |
| Keep corridor scrub / OBB sweep | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=481`** · `collide.js?v=43` · `vehicle.js?v=105`

**Proof:** `node tools/qa-sprint26-solid.mjs` · `node tools/qa-env-clip.mjs` · `node tools/qa-jump-variability.mjs`

**Still human-only:** Hard refresh `?v=481`. Clip a Desert rock at race speed — you should keep rolling past, not stop dead.

---

## Sprint — Phys authority / TOI sweep (27 Aug 2026)

**Player moment:** Hitch the frame near Desert jump 3 or clip a berm at speed. The car stays finite, on the road, and moving. Mesh never invents its own pose.

**Cause:** Endpoint-only deepest-overlap sampling could leave the car past the first contact after a long Δx. Residual embed was flagged but not corrected. Competing writers were already mostly gone (`_syncPlayerMesh` ← `drawPose`).

**Fix:** TOI sweep rewinds to first contact along prev→proposed XZ, then contact resolve, then `correctEnvPenetration`. Deep embed restores **last-safe XZ** (not a map teleport). Fixed-dt accumulator unchanged. Corridor solids unchanged.

| Item | State |
|---|---|
| Physics-authoritative mesh sync | **Verified** |
| TOI path sweep (not endpoint-only) | **Done** |
| Penetration correction pass | **Done** |
| Deep-embed → last-safe XZ | **Done** |
| `tools/qa-phys-authority.mjs` | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=482`** · `collide.js?v=44` · `vehicle.js?v=106`

**Proof:** `node tools/qa-phys-authority.mjs` · `node tools/qa-sprint26-solid.mjs` · `node tools/qa-env-clip.mjs`

**Still human-only:** Hard refresh `?v=482`. Drive Desert jump 2→3 with a brief tab hitch — no bury, no freeze.

---

## Sprint — Tunnel headlight punch (27 Aug 2026)

**Player moment:** Enter the Desert tunnel. Player headlights light the roadway ahead — not a faint lens glow in a dark bore.

**Cause:** `TUNNEL.headBeam` was 520 with soft falloff; once the key sun was killed the beams read as emissive paint, not road light.

**Fix:** Beam 1280, wider/longer cone, lower decay, brighter lens emissive, +35% tunnel boost when shade is committed.

| Item | State |
|---|---|
| Stronger player head beams in tunnel | **Done** |
| Lens emissive readable | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=483`** · `config.js?v=150` · `celica.js?v=135`

**Proof:** code contract — `TUNNEL.headBeam >= 1000` · `setHeadlights(..., { tunnelBoost })`

**Still human-only:** Hard refresh `?v=483`. Drive into the Desert tunnel — asphalt ahead should read lit by the car.

---

## Sprint — Zero env solids on roadway (27 Aug 2026)

**Player moment:** Drive any stage on the painted lane. No rock, berm, tree, or post collider sits in the drive path. Glances only happen off the corridor.

**Cause:** Raw `_bump()` registered solids without a corridor test; only `_bumpNearRoad` + end scrub enforced keep-out. Clearance was 2.2 m — still tight for chassis footprint.

**Fix:** Every env sphere goes through `_bump`, which refuses `over - r < ROAD_COLLIDER_CLEAR` (**3.8 m**). Scrub + assert remain as belt. Walls stay `_wallFace` only.

| Item | State |
|---|---|
| `_bump` corridor gate | **Done** |
| `ROAD_COLLIDER_CLEAR` 3.8 m | **Done** |
| Scrub / assert retained | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=484`** · `track.js?v=208`

**Proof:** `node tools/qa-env-clip.mjs` · `node tools/qa-desert-clip.mjs`

**Still human-only:** Hard refresh `?v=484`. Full-throttle Desert centreline — no invisible hits on paint.

---

## Sprint — Roadway corridor closed + garage singleton fix (27 Aug 2026)

**Player moment:** Drive any stage on paint. No env solid in the 3.8 m roadway corridor. Championship / practice actually reaches the grid (rivals spawn).

**Cause:** Corridor gate was in place but headed proof was blocked — `ai.js` imported `celica.js?v=134` while `game.js` used `?v=136`, so ES modules created **two garage singletons**. LOD warm filled one; `createRivalCar` read the empty other and threw. Desert boot never finished → corridor probes timed out.

**Fix:** Align `ai.js` → `celica.js?v=136` / `config.js?v=150`. `_bump` still refuses corridor invasion (optional precomputed `knownOver`). `prepareCar` no longer nulls a warm template after a failed hero re-parse. Cache bump `track.js?v=209`.

| Item | State |
|---|---|
| `_bump` / scrub / `ROAD_COLLIDER_CLEAR` 3.8 m | **Done** |
| Garage singleton aligned (ai ↔ game) | **Done** |
| Desert headed: 334 colliders clear of corridor | **PASS** |
| All-course env-clip headed | **PASS** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=485`** · `track.js?v=209` · `celica.js?v=136` · `ai.js?v=130`

**Proof:** `node tools/qa-desert-clip.mjs` **PASS** · `node tools/qa-env-clip.mjs` **PASS** (desert/forest/mountain/lakeside; 0 corridor solids)

**Still human-only:** Hard refresh `?v=485`. Desert centreline — no invisible hits on paint.

---

## Sprint — Visual corridor scrub + env block (28 Aug 2026)

**Player moment:** Drive the painted lane. No sand banks, bush canopies, or berm meshes clip through the car hull. Off-shoulder props still block when touched.

**Cause:** Collider scrub removed physics solids but **kept visuals** on the corridor. `stripDrive` used ribbon verge (8 m+) not mesh footprint — canopies overhung paint with no solid. Land tiles and road skirts interpolated dunes above deck. Tree/berm colliders undersized mesh extent. Depenetration capped at 0.45 m with single pass.

**Fix:** `_scrubRoadwayVisuals()` tucks land verts and culls envProp meshes in corridor. `stripDrive` / `_stripLanePoses` use `_laneKeepout` with 0.55× mesh span. Hard land floor under `ROAD_COLLIDER_CLEAR`. Skirts force tuck in corridor. Larger tree/berm bumps; bushes/spires/tunnel masses get `_bumpPoses`. Player depenetration: 3 passes, 0.58 m push, 0.78 m inside cap.

| Item | State |
|---|---|
| Visual + collider corridor aligned | **Done** |
| Land/skirt tuck on paint | **Done** |
| Mesh-sized colliders near road | **Done** |
| Stronger embedded resolve | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=486`** · `track.js?v=210` · `collide.js?v=45`

**Proof:** `node tools/qa-desert-clip.mjs` **PASS** · `node tools/qa-env-clip.mjs` static **PASS**

**Still human-only:** Hard refresh `?v=486`. Full-throttle Desert/Mountain centreline — no hull clip through sand or props on paint.

---

# Sprint — Cinema title / SELECT MODE showroom (27 Aug 2026)

**Player moment:** Open the game. The attract pad and SELECT MODE feel like a cinema showroom — wet asphalt, sculpted key/rim, golden horizon clouds, lacquer and chrome answering the sky — not a flat blue disc behind a dark menu wash.

**Cause:** IBL waited **2400 ms** (flat paint on first look). Live cube reflections existed but were **never called**. Asphalt was dull Standard (rough 0.72). SELECT MODE used an 82% left dark slab. Post FX was hard-off on title. Sky exposure capped to a wash.

**Fix:** Early PMREM (`TITLE_SHOWROOM.iblDelayMs: 420`), title CubeCamera + `_updateTitleReflections` on the pad, wet `MeshPhysicalMaterial` asphalt + roughness map, denser rocks/apron, cinema `LIGHTING.title`, wet clearcoat showcase, soft showroom bloom (no AO), SELECT MODE gradient that leaves the car hero-visible.

| Item | State |
|---|---|
| Atmospheric title sky + golden horizon | **Done** |
| Wet reflective pad + contact blob | **Done** |
| Lacquer/chrome/glass IBL + live cubes | **Done** |
| Sculpted key/rim (not washed) | **Done** |
| SELECT MODE UI readable, car visible | **Done** |
| Race / tunnel / chase cam | **Untouched** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=470`** · `config.js?v=148` · `sky.js?v=28` · `pbr.js?v=27` · `postfx.js?v=16` · `game.css?v=34`

**Proof:** `node tools/qa-sprint84-title-showroom.mjs` **PASS** (wet pad, IBL, CubeCamera, showroom post, cloudCover 0.5). Boot smoke: title → SELECT MODE → championship → Desert race **PASS**; practice reload Enter timed out at 5s (cold-boot flake under heavier showroom — not a SELECT MODE wash).

**Still human-only:** Hard refresh `?v=470`. Judge lacquer on PRESS START and on SELECT MODE — pad reflections, rim light on the silhouette, sky depth behind the rocks.

---

## Sprint 489 — Desert tunnel mouth grounded at climb (28 Aug 2026)

**Player moment:** Desert ~1258 m — climb into the Stage 1 tunnel. The portal and hillside read as a sandstone cut through a ridge, not a floating tube on flat sand.

**Cause:** Jump-3 landmark wash (`gap3 + 340 m`) planed the climb back to bed while the ribbon rose with `dy`. Folded Desert arms owned lateral ground samples beside the mouth, so `_groundHeight` returned low sand under high portal geometry.

**Fix:** Stop landmark wash when `_tunnelAlong > 0.08`; cap jump-3 flat before tunnel start. `_tunnelTerrainY` / `_portalFootingY` force bore-neighbor height for props. Mouth embankment fill + deeper portal footings. PBR `MeshStandardMaterial` + bore striation on tunnel exterior.

| Item | State |
|---|---|
| Jump-3 flat ends before tunnel climb | **Done** |
| Tunnel approach keeps authored ridge | **Done** |
| Portal footing + embankment fill | **Done** |
| PBR tunnel exterior materials | **Done** |
| Static desert-clip contracts | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=489`** · `track.js?v=211`

**Proof:** `node tools/qa-desert-clip.mjs` static **PASS**

**Still human-only:** Hard refresh `?v=489`. Drive Desert jump 3 → climb (~1258 m) → tunnel mouth — embankment meets rock, no floating portal.

---

## Sprint 490 — Desert mud ribbon clear at 1747 m (28 Aug 2026)

**Player moment:** Post-tunnel mud hairpin (~1747 m) — the full road width is drivable. No sand berms / embankment boxes filling the lane that the car clips through.

**Cause:** Tall instanced props used centre-Y for keepout, so embankment fill read as "overhead" while the base sat on the ribbon. Coarse land tris in the mud band could still fold through the tight -62° corner. Instanced meshes were never corridor-scrubbed.

**Fix:** `_laneKeepout` tests prop base Y; `_scrubInstancedCorridor` compacts invading instances; post-tunnel mud landmark wash; wider desert land refuse pad.

| Item | State |
|---|---|
| Instanced env corridor scrub | **Done** |
| Tall prop keepout uses base Y | **Done** |
| Post-tunnel mud land wash | **Done** |
| Static + headed mud-band probe | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=490`** · `track.js?v=212`

**Proof:** `node tools/qa-desert-mud-1747.mjs` · `node tools/qa-env-clip.mjs` static

**Still human-only:** Hard refresh `?v=490`. Drive tunnel exit → mud corners — clear ribbon at ~1747 m.

---

## Sprint 491 — Desert rock-bridge approach clear at 2437 m (28 Aug 2026)

**Player moment:** Sand→gravel straight before the finale gravel hairpins (~2437 m) — car no longer clips through rock-bridge mouth blocks or drift berms on the painted lane.

**Cause:** `_scrubBridgePortalMeshes` only tested local portal AABB; mouth approach blocks whose corners sat outside the prism still spanned the drive corridor in world space. Drift berms called `_bump()` before `_stripLanePoses`, leaving orphan colliders on the ribbon. Bridge groups were excluded from `_scrubRoadwayVisuals`.

**Fix:** `_scrubBridgeDriveCorridor` world-space lane keepout; `_scrubBridgeGroups` at build end; mouth blocks pushed to `clearHalfW + 22` / `clearHalfD + 20`; drift berm bumps deferred until after lane strip.

| Item | State |
|---|---|
| World-space bridge corridor scrub | **Done** |
| Bridge groups in roadway visual scrub | **Done** |
| Mouth blocks pushed away from lane | **Done** |
| Drift berm colliders after lane strip | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=491`** · `track.js?v=213`

**Proof:** `node tools/qa-desert-bridge-2437.mjs` · `node tools/qa-desert-bridge-portal.mjs` static

**Still human-only:** Hard refresh `?v=491`. Drive sand→gravel approach through rock bridge — clear ribbon at ~2437 m.

---

## Sprint 492 — Desert mud hairpin clear at 1737 m (28 Aug 2026)

**Player moment:** Tight -62° post-tunnel mud hairpin (~1737 m) — no invisible wall colliders or land fold blocking the inner apex.

**Cause:** Point-based collider scrub missed props whose origin sat on a folded ribbon arm while the solid spanned the hairpin apex. Post-tunnel land wash lateral (64 m) was too narrow for the inner mud corner. Tunnel portal embankment used local AABB only.

**Fix:** `_scrubCollidersOnRibbonSamples` walks the ribbon through the mud band with car-OBB tests; widened post-tunnel + inner-apex landmark flats; `_scrubPortalEmbankmentCorridor`; collider scrub re-run after instance scrub.

| Item | State |
|---|---|
| Ribbon-sample collider scrub on mud band | **Done** |
| Inner-apex land wash 1720–1764 m | **Done** |
| Portal embankment world scrub | **Done** |
| Re-scrub colliders after instance pass | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=492`** · `track.js?v=214`

**Proof:** `node tools/qa-desert-mud-1737.mjs` · `node tools/qa-desert-mud-1747.mjs` static

**Still human-only:** Hard refresh `?v=492`. Drive tunnel exit → first mud hairpin — clear ribbon at ~1737 m.

---

## Sprint 494 — Road micro-terrain + suspension work (28 Aug 2026)

**Player moment:** Gravel and dirt stages feel like real rally roads — constant washboard, occasional rut patches, wheels pumping in the wells, chassis rocking over crowned bumps.

**Cause:** Ribbon height was a perfectly smooth spline; `roadChatterScale` 0.04 was too subtle to move suspension.

**Fix:** `road-micro.js` adds deterministic micro-height to `Track.query` and road mesh vertices; four corner probes drive wheel travel; road roll couples into chassis; bump hits compress springs.

| Item | State |
|---|---|
| Query + mesh micro-height | **Done** |
| Per-wheel suspension travel | **Done** |
| Occasional rut patches (~48 m cells) | **Done** |
| Surface-scaled amplitude | **Done** |

---

## Sprint 493 — Physics-based jump variability (28 Aug 2026)

**Player moment:** Each crest feels distinct — teaching hops vs Safari throws, flat-out vs lift-and-brake, sand compress vs gravel landings.

**Cause:** Jump leave used axle pitch only; all authored jumps shared one throw curve; surface and ramp climb energy did not feed launch or landing.

**Fix:** Per-jump `jumpThrow` / `jumpLip` on spline; `_lipGradeFromTrack` geometry sample; speed-scaled spring compress + `_rampClimb` energy; surface bump modulates spring pop and landing bounce; air roll couples to lateral speed.

| Item | State |
|---|---|
| Authored jump profiles on track spline | **Done** |
| Geometry-based lip grade at takeoff | **Done** |
| Surface-aware spring + landing | **Done** |
| Ramp climb → throw energy | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=494`** · `vehicle.js?v=108` · `track.js?v=216` · `config.js?v=152` · `road-micro.js?v=1`

**Proof:** `node tools/qa-sprint38-realism.mjs` **PASS**

---

## Sprint 38 — Visual realism pass (28 Aug 2026)

**Player moment:** Desert reads as a real Safari rally — golden sky, warm dust haze, acacia horizon, tape barriers, cheering gallery crowds in varied shirts, PBR safari animals.

**Cause:** Flat Lambert animals, sparse spectators with matrix-only clap, cool fog/sky mismatch, empty verge beyond cactus/rock scatter.

**Fix:** Sprint 38 visual realism — desert LIGHTING/sky retune, roadside gallery (tape + tire stacks), horizon acacia cards, denser verge/scatter, crowd tints + cheer cycles + shadows, HD safari herd.

| Item | State |
|---|---|
| Desert sky + warm dust haze | **Done** |
| Roadside gallery barriers | **Done** |
| Horizon acacia silhouettes | **Done** |
| Crowd realism overhaul | **Done** |
| Safari PBR animals | **Done** |

**Cache:** `index.html` / `main.js` **`?v=495`** · `track.js?v=217` · `crowd.js?v=14` · `sky.js?v=29` · `config.js?v=153`

---

## Sprint 39 — Load speed, rival smoothness, M1 high quality (28 Aug 2026)

**Player moment:** PRESS START → Desert race starts hot (stage already building in menu). Rivals glide instead of jittering over micro-terrain. On M1 Pro Safari/Chrome you get 16-step volumetric cumulus, full shadows, and cinema lighting — not the old medium default.

**Cause:** Track preload regressed after Sprint 34 (no `Track.create` queue after PRESS START). Rival `drawPose` snapped wheel travel; AI used instant cheap road probes. Mac desktops booted at `medium` perf tier. Headless QA at cinema clouds blocked the main thread for minutes per frame.

**Fix:** Restore idle + leave-title preload (`preparePropKit` + `_scheduleTrackPreload` cup queue + course `pointerenter` warm). Interpolate rival wheelY; smooth `_cheapFilt` deck + lowDetail wheel lerp; `aiSubsteps: 3`. `raceStartTier()` → `high` on Mac desktop (medium under automation). Medium tier clouds 12 steps; desert music prefetch in `index.html`. Preload pump pauses during countdown.

| Item | State |
|---|---|
| Background stage preload restored | **Done** |
| Rival mesh jitter fix | **Done** |
| M1 Pro high tier default | **Done** |
| 12-step medium / 16-step high cumulus | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=496`** · `vehicle.js?v=109` · `config.js?v=154` · `sky.js?v=30` · `game.js` imports bumped

**Proof:** `node tools/qa-sprint39-perf.mjs` **PASS** · `node tools/qa-sprint34-preload.mjs` **PASS** · `node tools/qa-boot-smoke.mjs` **intermittent** in headless (PRESS START hittability / countdown timing under SwiftShader load — sprint gates 39+34 pass; verify in headed Chrome on M1)

---

## Sprint 497 — Desert mud exit clear at 1737 m (28 Aug 2026)

**Player moment:** Exit the -62° post-tunnel mud hairpin (~1737 m). The full lane is open — no invisible wall that stops the car dead.

**Cause:** Ribbon collider scrub only sampled the **centerline** on a narrow band. Solids on the inner apex / far verge (and folded opposite-arm walls) still blocked the drive path. Land wash lateral (80 m) was also short for the hairpin exit apron.

**Fix:** Full mud-act scrub (`tunEnd−24` → `+280`) with **seven lateral samples** across the ribbon; drop wall faces that sit on/inside the mud paint; widen exit land wash to `tunEnd+120…+230` at lateral 96 m.

| Item | State |
|---|---|
| Full-width ribbon collider scrub | **Done** |
| Mud-act band covers 1737 m exit | **Done** |
| Wider land wash on hairpin exit | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=497`** · `track.js?v=218`

**Proof:** `node tools/qa-desert-mud-1737.mjs` **PASS** · `node tools/qa-desert-mud-1747.mjs` static **PASS**

**Still human-only:** Hard refresh `?v=497`. Drive tunnel → mud corners → ~1737 m exit — clear ribbon.

---

## Sprint 498 — Desert bridge deck NaN clip at 2441 m (28 Aug 2026)

**Player moment:** Drive under the finale rock arch (~2437–2441 m). The car stays on the sand ribbon — no clipping through skirts, kerbs, or arch mouth rock.

**Cause:** Road-micro changed `edge()` to return `yL`/`yR` only. Skirt and kerb builders still read `e.y` / `f.y` → **undefined → NaN vertices** on every road segment (worst at the underpass where an extra underside quad is authored). Bridge mouth blocks could also survive centre-only keepout while a corner spanned the lane.

**Fix:** Restore finite `edge().y = 0.5*(yL+yR)`; kerbs use `yL`/`yR`; bridge corridor scrub tests AABB corners; underpass land wash no longer pulls the painted ribbon to the trench floor.

| Item | State |
|---|---|
| Finite road skirt/kerb heights | **Done** |
| Bridge corner keepout scrub | **Done** |
| Underpass groundHeight on-paint guard | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=498`** · `track.js?v=219`

**Proof:** `node tools/qa-desert-bridge-2437.mjs` **PASS**

**Still human-only:** Hard refresh `?v=498`. Drive sand→gravel through the rock bridge at ~2441 m.

---

## Sprint 499 — Countdown→race lighting continuity (28 Aug 2026)

**Player moment:** After 3-2-1, GO does not snap graphics/lighting. The stage already looks like the race during countdown.

**Cause:** Sprint 39’s cinema stall fix made **every** countdown use a lighter present — skip postFX, skip mirror/reflections, shadow atlas every 6 frames. At GO the full race path snapped on (bloom/grade + shadow cadence), which read as a lighting pop.

**Fix:** `countdownLitePresent()` gates the light path on `navigator.webdriver` only (SwiftShader / CDP). Real GPUs use the same post / shadow-every / mirror path as race. Loading settle + warm frames still bake shadows; quality adapt stays frozen through countdown so the tier cannot hunt mid-3-2-1.

| Item | State |
|---|---|
| Player countdown matches race present | **Done** |
| Webdriver keeps lite countdown (no cinema stall) | **Done** |
| Post / shadow / mirror continuity at GO | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=499`**

**Proof:** `node tools/qa-countdown-present.mjs` **PASS**

**Still human-only:** Hard refresh `?v=499`. Championship → Desert — watch 3→2→1→GO; lighting/post must not change at GO.

---

## Sprint 500 — Heavier jump landings (28 Aug 2026)

**Player moment:** Hit Desert hop / pair / Safari throw. Touchdown squashes into an overdamped spring, residual air pitch/roll rocks out, wheels sink into the arches — then the chassis settles. No upright snap, no bouncy hop glitch.

**Cause:** Pad contact zeroed `velY` in one frame; `_beginLandSettle` hard-assigned pitch; squash decayed with a fast exponential; mismatched landings could re-air with up to 1.5 m/s bounce.

**Fix:** `_seedLandCompress` + overdamped spring (`landCompressWn` / `ζ>1`, clamp x≥0). Soft pitch blend from mesh+air pose. Pad absorb via `landVelAbsorb`. Re-air only above `landReairMin` with capped soft rebound. Wheel travel follows compress.

| Item | State |
|---|---|
| Progressive land spring / damper | **Done** |
| Soft attitude blend (no pitch snap) | **Done** |
| Soft vel absorb (no one-frame kill alone) | **Done** |
| Reduced re-air bounce glitch | **Done** |
| Variety by impact / surface / air time | **Done** |
| Road plant / no bury retained | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=502`** · `vehicle.js?v=110` · `jump.js?v=19` · `config.js?v=155`

**Proof:** `node tools/qa-jump-variability.mjs` · `node tools/qa-sprint74-jump-air.mjs` · `node tools/qa-sprint68-jump-land.mjs` (static PASS; headed flaky on boot wait)

**Still human-only:** Hard refresh `?v=502`. Flat-out Desert jump 1, lift-brake jump 2, Safari jump 3 — each land should feel heavy and settle, not snap or hop.

---

## Sprint 500 — Title/menu 60 Hz showroom budget (28 Aug 2026)

**Player moment:** Open the game. PRESS START and SELECT MODE orbit at a stable ~60 fps on M1 Pro — no laggy attract loop.

**Cause:** Cinema showroom ran race-grade costs on the pad: 16-step volumetric clouds, 1.5 DPR / 2.4 Mpix, 2048 shadows, CubeCamera every 6 frames, post/bloom path, plus pack/stream work with no stage.

**Fix:** Dedicated `TITLE_SHOWROOM` budget — medium clouds (12×2), DPR 1.15 / 1.6 Mpix, 1024 shadow atlas every 4 frames, cube every 18 (paused while track preload builds), single ACES present (no post RTs), skip pack/stream on pad. `_settleRacePresent` still restores `raceStartTier()` so Desert/race quality is unchanged after countdown.

| Item | State |
|---|---|
| Title medium sky / capped DPR / lean shadows | **Done** |
| Single-pass title present (no post RTs) | **Done** |
| Race tier restore on settle | **Done** |
| PRESS START stays on attract path | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=500`** · `config.js?v=155`

**Proof:** `node tools/qa-title-perf.mjs` · `node tools/qa-sprint84-title-showroom.mjs --static` · `node tools/qa-sprint77-boot.mjs`

**Still human-only:** Hard refresh `?v=500`. Watch title orbit FPS; PRESS START → menu; start Desert and confirm race still looks cinema after GO.

---


## Sprint 500b — Countdown grade + landings + Mountain deck (28 Aug 2026)

**Player moments:** (1) 3-2-1→GO with no lighting/post pop. (2) Jump landings rock/squash smoothly. (3) Mountain Stage 3 ribbon no longer floats with a visible underside canyon.

**Cause:** Countdown throttled shadow atlas then enabled full race present at GO. Mountain land bed sat **1.2 m** under FrontSide asphalt; skirts plunged into that trench. Land settle damp was snappy.

**Fix:** Player countdown matches race present (webdriver-only lite path). Shadow bake every frame through countdown + GO warm (`_raceWarmFrames` ≥ 16). Mountain bed tuck **0.28 m**, closed underside deck, longer/shallower skirts. JUMP settle damp from config + overdamped compress spring.

| Item | State |
|---|---|
| Countdown→race present continuity | **Done** |
| Soft jump land settle | **Done** |
| Mountain floating road closed | **Done** |
| Title attract budget (Sprint 500) | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=502`** · `config.js?v=155` · `track.js?v=220`

**Proof:** `node tools/qa-sprint500-feel.mjs` · `node tools/qa-countdown-present.mjs` · `node tools/qa-title-perf.mjs` · `node tools/qa-static-audit.mjs`

**Still human-only:** Hard refresh `?v=502`. Title orbit FPS; Desert GO grade continuity; Desert jumps; Mountain climb — ribbon should look grounded.

---

## Sprint 503 — POV rearview: real cabin mirror (28 Aug 2026)

**Player moment:** C into the seat. The interior glass shows a readable rear view — road, trees, sky, rivals behind you — not a warped fisheye blob or a clipped 80 m haze cut.

**Cause:** Mirror camera used **55° vertical FOV** on a 384×120 RT (~130° horizontal) and a **80 m** far/fog clamp. Capture only streamed against the forward POV cam, so rear scenery could drop. Aim sat at the roof lip looking too short aft.

**Fix:** Keep the cheap **384×120** RT. Cabin-mirror lens (`mirrorFov: 26` ≈ 70° H, `mirrorFar: 200`). Re-stream against player + rearview lens before each capture. Bumper cam slightly lower, look target further down the road.

| Item | State |
|---|---|
| Low-res RT retained (≤384×120) | **Done** |
| Cabin FOV + 200 m far | **Done** |
| Stream rear scenery into RT | **Done** |
| Linear capture / HUD glass path retained | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=504`** · `config.js?v=156` · `celica.js?v=138`

**Proof:** `node tools/qa-pov-mirror.mjs` · `node tools/qa-sprint70-camera.mjs` · `node tools/qa-sprint76-perf.mjs`

**Still human-only:** Hard refresh `?v=504`. C into POV on Desert grid — glass should show the road behind (and pack cars), left-right flipped like a real mirror.

---

## Sprint 505 — POV gauges behind the steering wheel (28 Aug 2026)

**Player moment:** C into the seat. The rim is closest to your eyes; tach/speedo sit further into the dash and read through the wheel opening — not floating in front of the spokes.

**Cause:** Cluster was at `eyeZ+0.30` with the procedural wheel at `+0.36`, and the HUD overlay cleared depth + drew gauges with `depthTest:false`, so discs always composited over the rim.

**Fix:** Cabin depth order eye → wheel → cluster (~+20 cm past the rim) → dash bulk. Gauge materials depth-test against the preserved main-pass buffer. Mirror glass stays `depthTest:false`.

| Item | State |
|---|---|
| Cluster behind rim | **Done** |
| Wheel occludes gauge edges | **Done** |
| Mirror HUD unaffected | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=505`** · `celica.js?v=139`

**Proof:** `node tools/qa-pov-gauges.mjs`

**Still human-only:** Hard refresh `?v=505`. C into POV — wheel in front, gauges deeper in the binnacle.

---

## Sprint 506 — Desert tunnel mouth overhaul + floating rock (28 Aug 2026)

**Player moment:** Climb into the Stage 1 tunnel. The mouth is a cut through sandstone — wings, aprons, and ramps bury into the dune. No floating gate, no see-under canyon. Rock-bridge outer masses and drift berms sit on the land.

**Cause:** Portal boxes used fixed roadY-local Y (apron at `0.2`, ramp at `2.4`) while land sat much lower. Embankment skipped gaps `< 2.8 m`, leaving canyon slots. Bridge outer hill masses were also roadY-local floaters.

**Fix:** `_addTunnelPortal` plants wings/aprons/ramps/talus/wedges onto `_tunnelTerrainY`. Steeper cut face. Dense embankment fill (`gap < 0.7`). Bridge outer blocks + mouth shoulders plant to `_groundHeight`. Drift berms bury deeper.

| Item | State |
|---|---|
| Terrain-planted tunnel portal | **Done** |
| Mouth embankment closes thin gaps | **Done** |
| Rock-bridge outer masses planted | **Done** |
| Drift berm plant | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=506`** · `track.js?v=221`

**Proof:** `node tools/qa-desert-clip.mjs` (static PASS)

**Still human-only:** Hard refresh `?v=506`. Desert climb into the tunnel — embankment must meet rock on both sides with no floating lip.

---

## Sprint 507 — Forest waterfall landmark (28 Aug 2026)

**Player moment:** Drive Stage 2 into the Glade Bowl hairpin. Outside the turn, a cliff cascade falls into a plunge pool — moving water, foam, mist — not a static blue plane.

**Fix:** `_addForestWaterfall` plants a rock cut + three scrolling cascade sheets + lake-material pool past the verge. `waterfall()` PBR map with vertical foam. Per-mesh `waterScroll` rates (fast −V on sheets). Course subtitle: WATERFALL CLEARING.

| Item | State |
|---|---|
| Cascading sheets + pool | **Done** |
| Cliff / talus / mist | **Done** |
| Clear of drive corridor | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=507`** · `track.js?v=222` · `pbr.js?v=29` · `courses.js?v=66`

**Proof:** `node tools/qa-forest-waterfall.mjs`

**Still human-only:** Hard refresh `?v=507`. Forest → Glade Bowl — waterfall visible outside the hairpin.

---

## Sprint 508 — Ground all floating geometry (28 Aug 2026)

**Player moment:** Every stage — rocks, berms, barriers, signs, pier, cliff toes, crowd feet, gantry posts, bridge mouth shoulders, waterfall wings — sit in the dirt. No floating boxes over washed land beds.

**Cause:** Many props used roadY-local centres (`p.y + 0.4` barriers, gantry `p.y + 2.7`) or `gy + halfH` without bury. After land wash / mountain bed tuck, verge terrain sits below the ribbon so road-relative boxes float. Lakeside boathouse bottom sat ~0.9 m above shore. Cliff toe row used jagged noise at r=0.

**Fix:** `_plantBoxY(gy, sy, bury)` helper. Barriers, desert/mountain/forest berms & banks, logs, pier posts/house, sign posts, waterfall cliff wings (per-footprint land), bridge mouth frames extend to land. Spectator toes bury `gy - 0.08`. Cliff bottom row pinned `gy - 0.45`. Village walls/houses dig slightly. Drive corridor keepouts unchanged.

| Item | State |
|---|---|
| Barrier / gantry / sign plant | **Done** |
| Berm / bank / pier / village bury | **Done** |
| Cliff toe + waterfall wing plant | **Done** |
| Crowd toes bury | **Done** |
| Bridge mouth frames to land | **Done** |
| Corridor clear retained | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=510`** · `track.js?v=223`

**Proof:** `node tools/qa-desert-clip.mjs` · `node tools/qa-env-clip.mjs`

**Still human-only:** Hard refresh `?v=510`. Spot-check Desert tunnel/bridge, Forest waterfall + banks, Mountain cliff/village, Lakeside pier — no floaters, asphalt clear.

---

## Sprint 504 — Countdown lighting continuity before "3" (28 Aug 2026)

**Player moment:** Loading settle finishes, then 3-2-1-GO. Exposure, bloom/grade, sky steps, shadow atlas, and DPR never snap at "1" or GO — the stage already looks like the race when the first number paints.

**Cause:** Title showroom budget (soft DPR, post off, medium sky, 1024 atlas) restored late or incompletely. A `_gridCamHold = 2.8` timer expired exactly when "1" painted (fade ate ~0.8 s of the hold). Championship also started next-stage `Track.create` at the "3" flash, hitching the main thread mid-count. Warm frames burned during countdown so the settle budget was gone before GO.

**Fix:** `_settleRacePresent` resets DPR, forces race shadow atlas + sky/post from `raceStartTier()`, `_onResize` for post RTs, four warm presents under the load overlay. Countdown always hard-snaps cam (no 2.8 s timer). Warm frames burn only in `race`. Preload pump blocked during countdown; no next-stage schedule at "3". Quality adapt refused while `state === "countdown"`.

| Item | State |
|---|---|
| Race present fully live before "3" | **Done** |
| No mid-countdown quality/present switch | **Done** |
| Cam snap through full 3-2-1 | **Done** |
| No Track.create during countdown | **Done** |
| Webdriver lite path retained | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=504`**

**Proof:** `node tools/qa-countdown-present.mjs`

**Still human-only:** Hard refresh `?v=504`. Championship → Desert — watch 3→2→1→GO; lighting/post/sky must not change at any digit.

---

## Sprint 39–49 closeout — Fixed GPU budget for 60 / hard 30 (28 Aug 2026)

**Charter:** Inventory showed sprints **39–49 feature rows Done** (no PARTIAL left in that band). The open realism/perf debt was Sprint **76/96**: steady ~28–37 ms on M1 at full quality (4096² PCFSoft @ every present + 1.5 DPR fill-rate). Close that fixed cost so high tier can chase 60; keep the 30 Hz cadence lock as the floor.

**Player moment:** Desert pack race on M1 / desktop Chrome holds a steadier cadence. Contact shadow under the car stays soft and readable; cinema post/sky remain on high. When the machine still cannot hold 60 at min, present locks to even 30 (unchanged).

**Fix (reuse scaler — no second ladder):**
| Knob | Before | After |
|---|---|---|
| `GFX.shadowMap` | 4096 | **2048** |
| `GFX.shadowEvery` / high+medium tier | 1 | **2** |
| `GFX.maxPixelRatio` / `maxPixels` | 1.5 / 2.8 M | **1.25 / 2.0 M** |
| `shadowExtentRace` / `shadowFar` | 54 / 180 | **42 / 160** |
| Rival castShadow LOD | 92 m | **70 m** |
| low/min `shadowEvery` | 2 | **3 / 4** |

Forest waterfall (`?v=507` landmark) untouched. Countdown→race present continuity and POV mirror/gauges path unchanged.

| Item | State |
|---|---|
| Sprints 39–49 feature inventory (Done) | **Confirmed** |
| Fixed shadow/fill budget cut | **Done** |
| 30 fps cadence lock retained | **Done** |
| Forest waterfall intact | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=516+`** (boot may advance with parallel title work — hard-refresh whatever `index.html` pins) · `config.js?v=159` · `perf-tier.js?v=11`

**Proof (automated, PASS):**
```bash
node tools/qa-sprint39-perf.mjs
node tools/qa-sprint76-perf.mjs
node tools/qa-sprint35-40-matrix.mjs   # SHIP
node tools/qa-static-audit.mjs
node tools/qa-countdown-present.mjs
node tools/qa-forest-waterfall.mjs
```

**Headed M1 Pro probe (8 s Desert pack, this session):** delivered **34.8 fps** avg (range 10–46), tier **min**, present-interval EMA **24.9 ms** (was ~37 ms at min pre-cut). Scaler still targeting 60 (LOCK30 needs ~10 s at floor — sample was 8 s). VERDICT: **INCONSISTENT** — not yet a held 60 or even locked 30. Car nearly stopped (speed 4.1) so this is still fixed GPU cost, not motion.

**Still human-only:** Quiet Chrome, hard refresh current `?v=`. Desert 2 minutes — expect either climb toward 60 after warm, or after ~10 s at min an even 30 lock. Shadow under car must not strobe. Forest waterfall + countdown continuity.

**Honest remaining / PARTIAL:** Absolute 60 fps claim still **open** (Sprint 76/96 continuity). Stage-build wedge (76 #2) untouched. Next levers if human GPU still <60 at min: draw-call/overdraw (instancing density, stream castShadow cull), not more scaler knobs.

---

## Sprint 510 — Title attract hitch cut (28 Aug 2026)

**Player moment:** Open the game. PRESS START / SELECT MODE orbit feels like a clean ~60 fps attract loop — no laggy showroom.

**Cause (remaining after Sprint 500):** Medium volumetric sky (12×2 + Worley) was still the pad GPU floor every present; CubeCamera every 18 added a six-face hitch cadence; garage GLB warm fired mid-attract (~4.2 s) and stole the main thread while the player watched.

**Fix:** Tighten `TITLE_SHOWROOM` — low sky (6×1, no Worley), cube off (PMREM IBL only), shadow every 6, DPR 1.0 / 1.4 Mpix, sky uniform tick every 8. Defer `_warmGarage` to `_idleWarmAfterTitle` (after PRESS START). `_settleRacePresent` still restores `raceStartTier()` (DPR / sky / post / shadows) so Desert countdown lighting is unchanged.

| Item | State |
|---|---|
| Low sky + no live cube on pad | **Done** |
| Garage warm after PRESS START | **Done** |
| Race settle tier restore intact | **Done** |
| PRESS START / SELECT MODE stay instant | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=509`** · `config.js?v=158`

**Proof:** `node tools/qa-title-perf.mjs` · `node tools/qa-sprint84-title-showroom.mjs --static`

**Still human-only:** Hard refresh `?v=509`. Watch title orbit FPS; PRESS START → menu snappy; start Desert and confirm race still looks cinema after GO.

---

## Sprint 511 — Jump landing SFX (28 Aug 2026)

**Player moment:** Leave a Desert hop / pair / Safari throw. On real touchdown hear a subtle, variable thump — soft hop vs hard pack vs grit — not the same canned hit, and not on every curb tick.

**Cause:** Visual land settle ran on three paths (floor clamp, pad hit, axle lift), but only the pad-hit path armed `lastImpact` for audio. Soft floor-clamp lands (common) were silent. `landThump` also lacked mute/sfxVol early-outs and was a bit loud.

**Fix:** `_noteLandImpact` at land *begin* (before clearing `_airTime`) on all three paths, gated by hang / jump-phase / impact so road chatter stays quiet. `RallyAudio.landThump` layers procedural soft/mid/hard/scrape noise with bank overrun/gravel/chirp; pitch/gain by severity + surface + air time; respects work-mute and SFX slider. Game plays once then clears telemetry.

| Item | State |
|---|---|
| SFX on authentic jump→ground | **Done** |
| No curb / false-land spam | **Done** |
| Variable pitch/gain (impact / surface / air / upset) | **Done** |
| Mute / SFX volume respected | **Done** |
| Attribution (no new binary) | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=513`** · `vehicle.js?v=111` · `engine.js?v=57`

**Proof:**
```bash
node tools/qa-land-sfx.mjs
node tools/qa-jump-variability.mjs
```

**Still human-only:** Hard refresh `?v=513`. Desert jump 1–3 with SFX up — each land a quiet distinct thump; flat road bumps silent; mute SFX slider → silence.

---

---

## Sprint 511b — Diverse densified crowd base (28 Aug 2026)

**Player moment:** Desert / Lakeside galleries read as a mixed human audience — men/women, adults, teens, elders, kids, stocky/tall builds — cheering clear of the asphalt, not a four-clone Kenney strip.

**Cause:** Desert only loaded `CROWD_FOUR` (4 of 12 kinds). Character GLBs were stretched to a flat 1.7 m. Arms were centroid-split from a merged mesh. Strong instance tints washed atlas skin.

**Fix:**
- Regenerated `character-*.glb` via `tools/build-crowd-humans.py` with age/body profiles + authored `crowd-body` / `crowd-arm-l` / `crowd-arm-r`.
- `prop-kit` loads full `CROWD_ALL` (12) for desert/forest/lakeside; mountain skips crowd GLBs; preserves authored heights; extracts named arm parts; batched load yield.
- Atlas refresh via `tools/gen-crowd-atlas.py`.
- Extended by Sprint 514 (per-person mix + grandstands + 5 cheer styles).

| Item | State |
|---|---|
| Full 12-kind pack on Desert/Lakeside | **Done** |
| Age/body profile meshes | **Done** |
| Authored cheer arms | **Done** |
| Plant clear of roadway | **Done** |
| Mountain skips crowd load | **Done** |

**Honest limit:** Still the in-repo densified low-poly biped pack (~4k body verts) — not photogrammetry / MetaHumans. Diversity is silhouette + atlas UV + tint + anim within that kit.

**Cache (current tree):** `index.html` / `main.js` / `game.js` **`?v=517`** · `track.js?v=228` · `crowd.js?v=16` · `prop-kit.js?v=27` · GLB `?v=16`

**Proof:** `node tools/qa-crowd-glb.mjs` **PASS** (12 kinds, 160 poses, 0 on-road, 5 cheer styles, grandstand elevated seats)

**Still human-only:** Hard refresh `?v=517`. Desert practice — gallery + start/finish bleachers show mixed heights/genders; asphalt clear of feet.

## Sprint 514 — Grandstands + unique cheering crowd (28 Aug 2026)

**Player moment:** Start line and finish line have filled bleachers; verge crowds are mixed humans (kind/tint/scale), each with a distinct cheer — clap, wave, overhead, jump, film-arm — not identical clones.

**Cause:** `_addSpectators` assigned **one kind per cluster** → readable clone strips. No grandstand geometry. Cheer styles were only 3 soft variants without per-person rate.

**Fix:**
- Per-person kind cycling across the full 12-pack; expanded tint palette; `animStyle` 0–4 + `animRate`.
- `_addGrandstandCrowds` — steel/wood bleachers both sides at start + finish, seats filled.
- Arm/body write paths honor style 3 jump-cheer and style 4 film-arm; rates desync motion.

| Item | State |
|---|---|
| Per-person kind/tint (no cluster clones) | **Done** |
| Start + finish grandstands filled | **Done** |
| 5 unique cheer animations + rates | **Done** |
| Roadway stay-clear | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=514`** · `track.js?v=226` · `crowd.js?v=16`

**Proof:** `node tools/qa-crowd-glb.mjs`

**Still human-only:** Hard refresh `?v=514`. Desert practice — walk the start grid; bleachers packed with mixed silhouettes; pass at speed for desynced cheers.

---

## Sprint 515 — Pre-GO lighting snap eliminated (28 Aug 2026)

**Player moment:** Championship → Desert. From the first painted "3" through 2 → 1 → GO VO, exposure, colour grade, sky steps, shadow atlas size, and shadow bake cadence stay identical to the race look.

**Cause:** Countdown still forced `shadowEvery = 1` while settling, then race used tier `shadowEvery = 2` (Sprint 508). That cadence flip at GO (when warm frames ended) read as a lighting/colour snap. Present knobs were not re-asserted after `_updateLights` wrote exposure each frame, or after the loading→HUD curtain.

**Fix:** Present freeze for exposure/post/sky/shadow cadence (Sprint 515). **Superseded by Sprint 521** for remaining light/fog/curtain snaps.

| Item | State |
|---|---|
| Settle complete before "3" | **Done** → extended in 521 |
| Present freeze through GO + warm | **Done** → extended in 521 |

**Cache (historic):** `?v=515`

---

## Sprint 521 — Pre-countdown lighting fully locked (29 Aug 2026)

**Player moment:** Graphics are finished under the load screen; when "3" appears, lighting/colors match the race look and do not change through 2 → 1 → GO.

**Cause (remaining after 515):** `_updateLights` still rewrote sun/hemi/fill/exposure every countdown frame; live cube reflections could swap paint IBL; loading→HUD curtain was a second grade path; sky time kept advancing (flare/cumulus morph).

**Fix:**
- Freeze snapshots stage lights, fog, background, post grade, sky time/cover/bloom/flare.
- `_updateLights` short-circuits intensity/exposure writes while frozen (follow-only + restore).
- Reflections baked once in settle; skipped while frozen.
- Instant HUD swap + 3 frozen presents before unlocking "3".
- Sky `uTime` held for the freeze window.

| Item | State |
|---|---|
| All lighting set before countdown | **Done** |
| No mid-count / pre-GO color snap | **Done** |
| No curtain grade into "3" | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=521`**

**Proof:** `node tools/qa-countdown-present.mjs` **PASS**

**Still human-only:** Hard refresh `?v=521`. Watch load → 3 → 2 → 1 → GO — no lighting/color change at any step.

---


## Sprint 516 — Forest stage full refresh (28 Aug 2026)

**Player moment:** Stage 2 feels longer and harder — linked dirt/gravel S, crest jump, Glade Bowl waterfall, gravel sweep, tight mud hairpins, autumn corridor, finale gravel commit. Trees and banks sell northern-European autumn; surface contrast (dirt → gravel → mud) drives the rhythm.

**Was:** Short ~1.35 km glade with one checkpoint, long rest straights, soft linked pins (r42), flat banks, sparse treeline — not fun, weak identity.

**Fix:**
- `courses.js` Forest rebuilt: **~1.77 km**, **35 pieces**, **2 checkpoints** (AM3), tighter radii, less rest, mud linked pins (r34), autumn corridor + finale gravel hairpin. Subtitle: `AUTUMN HAIRPINS · WATERFALL CLEARING`.
- `track.js` denser treeline (4 rings), more trackside trees/bushes/ferns/verge, stronger forest banks + autumn litter/clearing tint, taller drift banks. `_addForestWaterfall` retained on first landmark.
- `config.js` `stageTime.forest` **90** (clock 140 s with 2×25).

| Item | State |
|---|---|
| Longer / harder layout + 2 CPs | **Done** |
| Autumn look densify + banks | **Done** |
| Waterfall landmark retained | **Done** |
| Stage clock retune | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=516`** · `courses.js?v=67` · `track.js?v=227` · `config.js?v=159`

**Proof:** static forest layout gate (len≥1650, 2 CP, mud pins, autumn+waterfall subtitle) · `node tools/qa-forest-waterfall.mjs` **PASS** · boot smoke title visible (PRESS START hittable flake unrelated)

**Still human-only:** Hard refresh `?v=516`. Drive Forest end-to-end — confirm Glade Bowl waterfall, mud slide rhythm, no unfair teleport on linked pins, clock fair for a clean lap.

---

## Sprint 518 — Desert stage grounding overhaul (28 Aug 2026)

**Player moment:** Stage 1 Desert reads as a shippable rally stage — road sits in the dirt, tunnel mouth is a sandstone cut, rock bridge piers dig into land, drift/sweep berms give a lean wall, chase cam does not see under the ribbon.

**Cause:** Land wash sat ~1.15 m under FrontSide asphalt (see-under canyon). Portal posts/embankment used weak plant offsets (`gy + h*0.42`, target `p.y+3.2`). Rock-bridge outer masses floated. Act 6 sweeper had no outside embankment (Forest/Mountain did). Skirt 2.6 m too short for the bed.

**Fix:**
- Desert closed deck underside + skirt **3.8** m tuck (not the old 8.2 fold).
- Tunnel portal: terrain-planted posts, second fill row, embankment target **p.y+7.5** with `_plantBoxY`.
- Tunnel mountain masses + bridge outer/talus plant to land.
- `_addDriftSweepBerms("desert")` + taller landmark berms.
- Far rocks / props plant via `_plantBoxY`.

| Item | State |
|---|---|
| Road/land closed deck + skirt tuck | **Done** |
| Tunnel mouth / embankment plant | **Done** |
| Rock-bridge talus + outer plant | **Done** |
| Sweep + landmark berms | **Done** |
| Corridor keepouts retained | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=519`** · `track.js?v=230`

**Proof:**
```bash
node tools/qa-desert-clip.mjs            # PASS — static + headed
node tools/qa-env-clip.mjs               # PASS — static + headed (all 4 stages)
node tools/qa-desert-bridge-2437.mjs     # PASS
node tools/qa-desert-mud-1737.mjs        # PASS
```

**Still human-only:** Hard refresh `?v=519`. Drive Desert 10 minutes — tunnel climb (~1258 m), mud exit, Bowl berms, Act 6 sweeper lean wall, rock-bridge underpass (~2441 m). Confirm no floating lips, no sand on asphalt, no see-under canyon. Art sign-off that the stage is friend-shippable.

**CEO bar (honest):** Worst grounding blockers closed with headed corridor proof (land −1.15 m, 0 lane invaders, portal footing 10/16 buried, ridge lift 12.5 m). Still want human eyes on the tunnel mouth and bridge before calling it friend-shippable polish.

---

## Sprint 520 — Fluffy volumetric clouds + lens flare (29 Aug 2026)

**Player moment:** Looking up (or at a sunlit skyline) shows distinct fluffy cumulus with blue gaps, sun peeking through rims, and a soft anamorphic lens flare — not a grey smoke sheet welded to the dome.

**Cause:** Soft wide density windows + high absorb + weak Worley made the raymarch read as translucent smoke. Sun disc existed but gaps did not; no flare.

**Fix:**
- Dense Worley cauliflower cores, taller shell, clearer cover islands, multi-scatter white interiors, silver lining + sun-peek transmittance.
- Procedural lens flare (streak + chromatic ghosts) driven by camera forward.
- Richer Rayleigh blues / stage gradients; stronger sunBloom; `VISUAL.lensFlare`.

| Item | State |
|---|---|
| Fluffy cumulus (not smoke) | **Done** |
| Sun peek through gaps | **Done** |
| Lens flare | **Done** |
| Realistic sky colors | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=520`** · `sky.js?v=32` · `config.js?v=160`

**Proof:** `node tools/qa-sky-fluffy.mjs` **PASS**

**Still human-only:** Hard refresh `?v=520`. Title + Desert — confirm white fluffy billows with blue between, sun rim glow, flare when looking near the sun.

---

## Sprint 522 — Jump air keeps momentum (29 Aug 2026)

**Player moment:** Desert jumps 1–3 — leave the lip, hang, land still carrying speed. Crests no longer feel like a mid-air brake.

**Cause:** `airLongDrag` used `airNoseDrag: 0.58` with a `0.84` floor (~45% speed loss / s when lofted), plus lateral/yaw bleeds of `2.1/s` and `1.65/s`.

**Fix:** Soft coast — `airBaseDrag` 0.002, `airNoseDrag` 0.14, floor `0.985`; lateral/yaw bleed `0.28` / `0.35`. Attitude still trims; hang keeps ≥90% speed over 0.6 s.

| Item | State |
|---|---|
| Airborne momentum keep | **Done** |
| Soft attitude trim retained | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=522`** · `vehicle.js?v=112` · `jump.js?v=20` · `config.js?v=160`

**Proof:** `node tools/qa-jump-variability.mjs` **PASS**

**Still human-only:** Hard refresh `?v=522`. Desert jump 1–3 flat-out — speed stays through the hang; landings still scrub if attitude is wrong.

---

## Sprint 523 — Desert tunnel mouth grounded (29 Aug 2026)

**Player moment:** Climb into the Desert tunnel (~1258 m) — the entrance reads as a cut through a ridge, not a floating stone gate over sand. No daylight under wings / apron from chase cam.

**Cause:** Ridge peak was too far out; embankment skipped thin gaps (`gap < 0.7`); portal cap/wings could sit above washed verge after corridor scrub; a naive bury pass would also drag the overhead cap onto road-bed Y.

**Fix:** Steeper nearer cut face; denser mouth embankment (2.5 m / 2.8 m grid, `gap < 0.35`, target +11.5 m); deeper plant bury + shoulder berms; ridge-planted cap; `_buryPortalMeshesToLand` after scrub (corner-sampled, skips overhead bore rock).

| Item | State |
|---|---|
| Portal plant / berm fill | **Done** |
| Mouth embankment densify | **Done** |
| Post-scrub bury (no cap drop) | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=523`** · `track.js?v=231`

**Proof:** `node tools/qa-desert-clip.mjs` **PASS** (ridge lift 22.2 m; 13/19 portal meshes buried below deck)

**Still human-only:** Hard refresh `?v=523`. Desert tunnel climb — confirm no see-under / floating gate at the mouth.

---

## Sprint 524 — Cut floating Desert rock bridge (29 Aug 2026)

**Player moment:** Desert sand→gravel approach (~2440 m) — open road into the linked hairpins. No floating sandstone remnant, no empty underpass trench under a missing arch.

**Cause:** Corridor scrub left the finale rock bridge as floating debris while land still opened a drive-through hole for an arch that was gone.

**Fix:** Cut `_addDesertHeroLandmark` / `_addDesertRockBridge` from the player path; `_markDesertUnderpassCorridors` no longer tags underpass posts or landmark flats. Flyover separation owns the hairpin crossing.

| Item | State |
|---|---|
| Rock bridge mesh spawn | **Cut** |
| Underpass land trench | **Cut** |
| Approach still driveable | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=524`** · `track.js?v=232`

**Proof:** `node tools/qa-sprint32-desert-finale.mjs` **PASS** · `node tools/qa-desert-bridge-2437.mjs` **PASS** · `node tools/qa-desert-bridge-portal.mjs` **PASS** (0 bridge meshes / groups; approach driveable)

**Still human-only:** Hard refresh `?v=524`. Drive Desert finale approach — confirm no floating rock where the bridge was.

---

## Sprint 525 — AAA present budget (fill-rate cut, cinema kept) (29 Aug 2026)

**Player moment:** Desert pack at chase distance — cinema ACES / soft PCF / IBL still read as a modern rally game, while the present path can actually chase 60 Hz instead of living on the min tier.

**Cause:** Sprint 96 proved the pack is fragment-bound. `textureScale: 4` plus canvas MSAA with a post RT stack paid fill cost with no look win (MSAA never samples the compositor RT). Wide race shadow frustum (42 m) also stuffed the 2048 atlas with mid-ground casters.

**Fix:** Restore Sprint 24 texture budget (`textureScale: 2`, half normals); disable canvas MSAA when post is on; tighten race shadow ortho to 34 m for denser wheel contact + fewer casters; restore cloud `maxLightSteps: 2` (Sprint 76 cap). Keep tier 13 cinema grade, soft bloom, and the single `perf-tier` scaler.

| Item | State |
|---|---|
| `textureScale` 4 → 2 | **Done** |
| MSAA off with post RT | **Done** |
| Race shadow extent 42 → 34 | **Done** |
| Cloud light steps 3 → 2 | **Done** |
| Cinema tier 13 / ACES / postFx | **Kept** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=525`** · `config.js?v=161` · `track.js?v=233` · `pbr.js?v=30` · `postfx.js?v=18` · `sky.js?v=33` · lighting-rig → config 161

**Proof:** `node tools/qa-sprint24-perf.mjs` **PASS** · `node tools/qa-sprint76-perf.mjs` **PASS** · `node tools/qa-sprint39-perf.mjs` **PASS** · `node tools/qa-sky-fluffy.mjs` **PASS**

**Still human-only:** Hard refresh `?v=525`. Quiet Chrome, Desert pack — HUD delivered fps closer to 60 at high/medium; paint and road grain still readable. Optional: `node tools/qa-frame-probe.mjs --seconds=12`.

---

## Sprint 526 — Rival / Delta wheel spin axis (29 Aug 2026)

**Player moment:** Pack race or SELECT CAR → Delta — all four tires roll on the axle. No tumbling rear wheel. Same for every rival GLB on the grid.

**Cause:** Delta `Wheel_1` shipped a 1.6 m-wide rim scrap under `rim_F001`. `detectSpinAxis` used the full hub AABB and picked **Z**, so that corner tumbled instead of rolling. Sanitize only hid direct children, and hidden meshes still inflated `Box3.setFromObject`.

**Fix:** Detach oversized descendant meshes under every `Wheel_*` hub; detect spin axis from visible tire-sized meshes only. Shared `applyWheelPose` path for player + all rivals.

| Item | State |
|---|---|
| Axle scrap detach | **Done** |
| Spin axis from tire AABB | **Done** |
| Player + rival pose path | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=526`** · `celica.js?v=140` · `ai.js` → celica 140

**Proof:** `node tools/qa-wheel-spin.mjs` **PASS** (Delta Wheel_0–3 all spin axis `x` after scrap detach)

**Still human-only:** Hard refresh `?v=526`. Chase a Delta rival — rear tires roll forward with the car.

---

## Sprint 527 — AM3 Sega Rally handling (29 Aug 2026)

**Player moment:** Desert dirt / gravel / mud — brake+steer starts a power slide you can hold and catch. Tarmac still stops short. Auto downshifts into hairpins kick the same gear-drift as manual. Steering is quick and readable; opposite lock snaps the car straight.

**Research:** `docs/AM3-RESEARCH.md` + Sega-16 (Sakamoto: exaggerate for novices; slide is the tool; surface friction is the headline) + Saturn manual (brake tap / downshift before the curve).

**Fix:** Retuned `HANDLING` / `SURFACES` / chassis rack toward AM3 (higher countersteer, longer slide carry, mud `brakeYaw: 1`, lower speed understeer, snappier tire yaw). Shared `_applyGearDriftKick` for manual + auto. `brakeSteerYaw` scales brake-to-slide.

| Item | State |
|---|---|
| Surface brake/slide differentiation | **Done** |
| Gear-drift on auto + manual | **Done** |
| Catch = switch countersteer | **Done** |
| Novice-quick steer rack | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=527`** · `config.js?v=162` · `vehicle.js?v=113` · `surfaces.js?v=50`

**Proof:** `node tools/qa-am3-handling.mjs` **PASS** · `node tools/qa-sprint31-drift.mjs` **PASS** · `node tools/qa-sprint33-drift.mjs` **PASS**

**Still human-only:** Hard refresh `?v=527`. Desert long right + mud exit — brake into the slide, throttle balance, catch with opposite lock. Compare to memory of Saturn Rally.

---

# Sprint 528 — Title / menu always responsive (29 Aug 2026)

**Player moment:** Open the game. The orbiting showroom car never locks the tab. PRESS START, SELECT MODE, car, and course clicks stay instant — no freeze, hang, or multi-second lag.

**Cause:** Attract used the full hero GLB (7 MB + clearcoat), armed a sun shadow atlas mid-orbit, and started `Track.create` for every stage on PRESS START / course hover — main-thread work fought the rotating car present while the player tried to click menus.

**Fix:** Title car is rival LOD only (`prepareTitleCar` / `createTitleCar`). Pad keeps `sun.castShadow = false` (no atlas arm). No `Track.create` or hero garage warm during title/menu — HTTP + prop kit + rival LODs only; terrain builds on the loading screen. Menu present cadence 30 Hz; splash stays 60. Soften title pixel budget (1.2 M / DPR 1.0).

| Item | State |
|---|---|
| Rival LOD attract car | **Done** |
| No pad sun shadows | **Done** |
| No stage build on title/menu | **Done** |
| Menu clicks stay instant | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=528`** · `config.js?v=163` · `celica.js?v=141` · `ai.js?v=133`

**Proof:**
```bash
node tools/qa-title-perf.mjs
node tools/qa-sprint58-title-lod.mjs
node tools/qa-sprint84-title-showroom.mjs --static
node tools/qa-boot-smoke.mjs
```

**Still human-only:** Hard refresh `?v=528`. Click through title → SELECT MODE → car → Desert without any hang; orbit stays smooth behind the menus.

---

# Sprint 529 — Rival mesh thrash fix (29 Aug 2026)

**Player moment:** Race a pack. Rival bodyshells glide — no left/right stutter or “glitching back and forth” when cars rub.

**Cause:** `AI_PASS_LATERAL` / `PLAYER_RIVAL_SIDESTEP` re-fired every physics step while OBBs still overlapped. Soft separate could not clear the kiss in one tick, so each frame shoved the mesh another ~0.4–0.55 m sideways. Leftover `drawPose` alpha on rivals + road micro chatter on the cheap AI deck amplified the bob.

**Fix:** Gate pass/sidestep on `_aiPassT` (one impulse per rub). Pack meshes plant at alpha 1. AI skips `roadChatter`; `_cheapFilt` follow softened (0.32 → 0.14).

| Item | State |
|---|---|
| One-shot AI / player pass shove | **Done** |
| Rival sync alpha = 1 | **Done** |
| AI deck chatter off + softer cheap filt | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=529`** · `collide.js?v=46` · `vehicle.js?v=114` · `ai.js?v=134`

**Proof:**
```bash
node tools/qa-rival-jitter.mjs
node tools/qa-sprint66-player-bump.mjs
```

**Still human-only:** Hard refresh `?v=529`. Championship pack — rub a rival; body stays solid, no sideways flicker.

---

# Sprint 530 — Realistic per-car engine / exhaust (29 Aug 2026)

**Player moment:** Pick Celica, Delta, or Stratos. Idle, throttle, shifts, and lift-off sound like that chassis — turbo four vs Italian V6 — not one stretched loop.

**Cause:** Powertrain was a two-bed idle↔load crossfade with static EQ. Pitch-stretch alone went thin at redline; no gear event, weak turbo cue, little character split between cars.

**Fix:** Keep the licensed recorded beds. Add a high-RPM scream layer (load bed, separate rate centre), cylinder-rate pulse (4 vs 6), turbo whistle + BOV/crackle (Celica/Delta), gear-shift overrun blip, engine-brake mix from closed throttle / brake, dynamic presence/LP EQ, and a soft exhaust compressor.

| Item | State |
|---|---|
| Per-car idle/load/lift beds | **Kept** |
| High-load scream + pulse + whistle | **Done** |
| Gear / lift / engine-brake response | **Done** |
| Attribution (no new binary) | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=530`** · `engine.js?v=58` · `powertrain.js?v=26`

**Proof:** `node tools/qa-powertrain.mjs`

**Still human-only:** Hard refresh `?v=530`, SFX up. Celica — turbo spool + BOV on lift. Delta — thicker turbo bark. Stratos — higher V6 howl, no whistle. Shifts should chirp once.

---

# Sprint 531 — Natural title-pad rocks (29 Aug 2026)

**Player moment:** Open the game. The showroom apron is framed by sandstone boulders that look grounded in the sand — textured, tinted, slightly buried — not a ring of grey plastic Kenney toys.

**Cause:** Title rocks used raw Kenney GLB materials (flat plastic). They sat perfectly upright on the sand in an even orbit with uniform scale.

**Fix:** `styleTitleRock` dresses each mesh with `rock_diff.jpg`, warm sandstone tints, bump from albedo, higher roughness. Planting uses irregular clusters, non-uniform scale, slight tilt, and base bury into the apron.

| Item | State |
|---|---|
| HD rock albedo + sandstone tint | **Done** |
| Buried / tilted / clustered poses | **Done** |
| No sphere dunes | **Kept** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=531`** · `prop-kit.js?v=28`

**Proof:** `node tools/qa-sprint84-title-showroom.mjs --static`

**Still human-only:** Hard refresh `?v=531`. Title pad — rocks read as stone mass in the sand, not floating grey props.

---

# Sprint 532 — Ship: cache lockstep + QA gates (29 Aug 2026)

**Player moment:** Hard-refresh the live build and get one coherent module graph — no split `config`/`surfaces`/`pbr`/`prop-kit` instances that silently break rivals or handling.

**Fix:** Align every importer to `config.js?v=163`, `surfaces.js?v=50`, `pbr.js?v=30`, `prop-kit.js?v=28`. Update Sprint 39/77 QA gates to match intentional title/menu budget (no `Track.create` on attract; rival LOD warm). Boot chain **`?v=534`**.

| Item | State |
|---|---|
| Static audit version splits | **Done** (0 failures) |
| Title / rival / powertrain / AM3 gates | **Done** |
| Pages deploy from `main` | **This ship** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=534`**

**Proof:**
```bash
node tools/qa-static-audit.mjs
node tools/qa-title-perf.mjs
node tools/qa-rival-jitter.mjs
node tools/qa-powertrain.mjs
node tools/qa-sprint77-boot.mjs
node tools/qa-sprint39-perf.mjs
```

**Public:** https://jordanz00.github.io/rally-championship-2026/ · hard refresh `?v=534`

---

# Sprint 535 — POV windshield sightline (29 Aug 2026)

**Player moment:** Press C into the seat. The road ahead fills the windshield — dash and gauges sit lower; the eye is higher and looks further down the stage.

**Fix:** Raise seated eye (~1.30 m), clear the cowl by +18 cm, aim look toward the road/horizon (`lookZ` +4.2 m, milder down-angle), FOV 80, drop procedural dash/cluster ~12–16 cm relative to the eye. `POV_RIG_VER = 3`.

| Item | State |
|---|---|
| Higher eye / road look | **Done** |
| Lower cabin dash + gauges | **Done** |
| FOV 80 | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=535`** · `celica.js?v=143` · `config.js?v=164`

**Proof:** `node tools/qa-pov-gauges.mjs` (static) · `node tools/qa-static-audit.mjs`

**Still human-only:** Hard refresh `?v=535`, C into POV on Desert — confirm pavement and apexes stay readable above the dash.

---

# Sprint 536 — M1 Pro frame budget rescue (30 Aug 2026)

**Player moment:** Race Desert on an M1 Pro. The stage holds a clean cadence — 60 when possible, even 30 if not — instead of ~50 fps judder with the quality scaler already at `min`.

**Evidence (headed probe, v535):** delivered **49.8 fps** (23–56), tier **min**, EMA 19.1 ms — neither held 60 nor locked 30.

**Fix:**
- Race caps: `maxPixelRatio` 1.0, `maxPixels` 1.6 M, shadow atlas 1536 / every 3, cheaper mirror
- Mac desktop starts **medium** (`?perf=high` still unlocks cinema)
- Ladder: high uses balanced post + medium sky; **min disables sun shadows**; BasicShadowMap on low
- Clouds 10/8/5/3 steps; STREAM denser LOD cards sooner; faster 30 Hz lock (2 s)
- Skip pack see-through on min; sky tick every 2 on low/min

| Item | State |
|---|---|
| Cheaper race caps + min kills shadows | **Done** |
| Mac starts medium | **Done** |
| Cloud / stream cuts | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=541`** · `config.js?v=541` · `perf-tier.js?v=541` · `sky.js?v=541`

**Proof:**
```bash
node tools/qa-sprint39-perf.mjs
node tools/qa-sprint76-perf.mjs
node tools/qa-frame-probe.mjs --seconds=8
```

**Still human-only:** Hard refresh `?v=541`, championship Desert — confirm smooth feel. Optional cinema: `?perf=high`.

---

# Sprint 542 — Planted chassis pitch (30 Aug 2026)

**Player moment:** Drive on flat road. The car sits planted — no nose-up / tilted-back stance under throttle. Hills still follow the axle plane.

**Cause:** Visual accel squat mapped positive long-accel to negative Three.js Rx (nose-up). Config claimed drive squat was off; `HANDLING.accelSquat` / `brakeDive` were still non-zero and wired into `_updateAttitude`.

**Fix:** Zero drive squat/dive; attitude only uses road `_visPitch` + landing squash. Wider flat deadzone snaps residual pitch to 0.

| Item | State |
|---|---|
| No throttle nose-up | **Done** |
| Flat ribbon snaps pitch | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=542`** · `vehicle.js?v=117` · `config.js?v=167`

**Proof:** `node tools/qa-planted-pitch.mjs`

**Still human-only:** Hard refresh `?v=542`, Desert straight — car sits level; crest still follows the road.

---

# Sprint 543 — POV roof no longer letterboxes the view (30 Aug 2026)

**Player moment:** Press C into the seat. The windshield opens onto the stage — no dark roof slab cutting across the upper half of the frame.

**Cause:** Procedural loft roofs were `userData.interior = true` with no name. `tagPovShell` early-returned on interiors, so roofs never got `povShell`. `setCockpitView` only hid glass + `povShell`. Sprint 535 raised the eye to `roof − 0.12` with FOV 80, so the underside filled the lens.

**Fix:** Name loft/rival roofs `"roof"`. Tag roofs/headers (and high cabin slabs) as `povShell` even when marked interior. Versioned POV hide cache (`POV_HIDE_VER = 3`) rebuilds on live cars. Cap eye at `roof − 0.32` and keep look below the eye. `POV_RIG_VER = 4`.

| Item | State |
|---|---|
| Roof named + tagged povShell | **Done** |
| Hide-cache rebuild | **Done** |
| Eye under roof / look down | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=543`** · `celica.js?v=144`

**Proof:** `node tools/qa-pov-roof-clear.mjs`

**Still human-only:** Hard refresh `?v=543`, C into POV on Desert — upper view is open road/sky, not a black triangle over the dash.

---

# Sprint 544 — Level cars on flat ground (30 Aug 2026)

**Player moment:** On flat ribbon, player and rivals sit level — all four tires on the road, no nose-up float.

**Cause:** Landing squash was subtracted from mesh pitch (`−landSquash`). In Three.js that is nose-up, so every bump/land tipped the front end up and left the fronts hanging. Flat-grade slack also left residual pitch on micro-rut “flat”.

**Fix:** Land squash is wheel/Y only. Flat grades inside `VIS_PITCH_DEADZONE` (0.028 rad) hard-zero pitch / bodyPitch / visPitch for player and AI.

| Item | State |
|---|---|
| No land-squash nose-up | **Done** |
| Flat hard-level | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=544`** · `vehicle.js?v=118`

**Proof:** `node tools/qa-planted-pitch.mjs`

**Still human-only:** Hard refresh `?v=544`, Desert start / straight — fronts planted; crests still follow the road.

---

# Sprint 545 — Realistic jump throw + land weight (30 Aug 2026)

**Player moment:** Hit Desert’s lips. The car leaves following the ramp, hangs on a ballistic arc (not a trampoline hop), coasts with heavy air inertia, and lands with visible weight — chase cam pulls back in the air and kicks on touchdown.

**Cause:** Leave attitude was a canned hop (aggressive `noseUpRate`, high `springBurst`, snappy air pitch). Landings either snapped upright or tipped nose-up from squash. Chase stayed glued to the car so throws did not read.

**Fix:**
- Carry live mesh/road nose into `JumpModel.launch` (`leaveCarry`); soft rate at the lip
- Ballistic bias: lower spring burst, higher throw blend / ramp vy; less aero float; heavier air inertia / softer pedal trim
- Land: longer settle, deeper compress, brief nose-down (+Rx) weight — not nose-up
- Chase: air lift + pull-back; stronger land kick / FOV

| Item | State |
|---|---|
| Leave follows lip | **Done** |
| Soft air inertia | **Done** |
| Land weight + cam | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=545`** · `vehicle.js?v=119` · `jump.js?v=22` · `config.js?v=168`

**Proof:** `node tools/qa-jump-feel.mjs` · `node tools/qa-jump-variability.mjs` · `node tools/qa-planted-pitch.mjs`

**Still human-only:** Hard refresh `?v=545`, Desert teaching hop then Safari pair — throws change with speed; landings plant with weight.

---

# Sprint 546 — Lighting/graphics set before countdown (30 Aug 2026)

**Player moment:** Stage load → countdown 3-2-1 → GO. The world already looks race-ready under the load overlay; nothing snaps when GO is spoken.

**Cause:** Mac desktop started on `low` with shadows/post off. After GO the present freeze ended and the scaler climbed to `medium`, turning shadows + grade on — a visible pop with the VO. GO also re-snapped the chase cam.

**Fix:**
- Desktop (incl. Mac) starts at **`medium`** so shadows + post are live before "3"
- `_applyQualityTier`: post + shadows stay on for all tiers except `min` (only survival path kills them)
- Six present warms under load; re-sync grade/lights; arm freeze; four HUD-live frozen warms before unlocking "3"; re-arm freeze after those warms
- GO keeps **48** warm frames; no `_camSnap` on GO

| Item | State |
|---|---|
| Race look before stage shown | **Done** |
| No shadow/post flip at GO | **Done** |
| No GO chase cam snap | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=546`**

**Proof:** `node tools/qa-countdown-present.mjs` · `node tools/qa-sprint39-perf.mjs`

**Still human-only:** Hard refresh `?v=546`, load Desert — grade/shadows stable from first HUD frame through GO VO.

---

# Sprint 547 — Higher race resolution, 30 fps floor (30 Aug 2026)

**Player moment:** Stage looks sharper on desktop; when the GPU cannot hold 60, cadence locks to an even **30** instead of soft pixels or judder.

**Change:**
- Race `maxPixelRatio` **1.0 → 1.25**, `maxPixels` **1.2 M → 2.0 M** (title pad stays soft at 1.0 / 1.2 M)
- `preferLock30`: lock an even **30** before stripping to `min` (keep medium shadows/grade)
- Lock-to-30 after **~0.8 s** at the floor (`LOCK30_HOLD` 48); hard-drop at min also locks when over budget
- Target remains 60; 30 is the minimum acceptable presented cadence

| Item | State |
|---|---|
| Sharper race framebuffer | **Done** |
| 30 Hz lock as floor | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=547`** · `config.js?v=169` · `perf-tier.js?v=42`

**Proof:**
```bash
node tools/qa-sprint39-perf.mjs
node tools/qa-sprint76-perf.mjs
node tools/qa-frame-probe.mjs --seconds=8
```

**Headed probe (M1 Pro, Desert, 14 AI, v547):** delivered **27.1 fps** (22–28), cadence **LOCKED 30**, tier **medium**, EMA 35.6 ms — sharper pixels with a clean floor instead of ~50 fps judder at min.

**Still human-only:** Hard refresh `?v=547`, Desert championship — confirm sharpness + smooth 60-or-clean-30. Optional cinema chase: `?perf=high` (still prefers lock-30 when over budget).

---

# Sprint 548 — Realistic cumulus sky + sun lighting (30 Aug 2026)

**Player moment:** Look up on Desert/Forest. Cumulus reads as towering cauliflower stacks with lit sugar tops, cool shadowed bases, and clear blue gaps — not a grey smoke sheet. Sun disc + aureole feel photographic; stage key matches the sky.

**Cause:** Sprint 536 cut raymarch to 8–10×2 and high/medium both used the soft medium sky path. PreferLock30 left GPU headroom unused on clouds.

**Fix:**
- Cinema raymarch **16×3** (medium race uses cinema steps under `cinemaRealism`); low/min 7×1 / 4×1
- Multi-scale Worley billows, taller shell, stronger silver/powder/sugar lighting, deeper zenith blues
- Stage LIGHTING retune (sun Kelvin/intensity, Rayleigh/Mie, cover/scale)

| Item | State |
|---|---|
| Fluffy photographic cumulus | **Done** |
| Sun / atmosphere / stage key | **Done** |
| Budget bounded (≤16×3) | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=548`** · `sky.js?v=37` · `config.js?v=170` · `perf-tier.js?v=43`

**Proof:** `node tools/qa-sky-fluffy.mjs` · `node tools/qa-sprint69-clouds.mjs` · `node tools/qa-sprint39-perf.mjs` · `node tools/qa-sprint76-perf.mjs`

**Still human-only:** Hard refresh `?v=548`, park on Desert grid and look up — distinct puff islands, silver rims, hot sun disc.

---

# Sprint 549 — Equirect HDR skybox (replace volumetric clouds) (31 Aug 2026)

**Player moment:** Look up. The sky is a real photo environment — Poly Haven pure-sky HDR with realistic cumulus — not a grey procedural volume.

**Cause:** Volumetric Worley raymarch never read as photographic clouds despite step increases.

**Fix:**
- Remove planet-shell volumetric raymarch entirely
- Stage skyboxes: Kloofendal partly cloudy (desert/title), Kloppenheim 06 (mountain), Sunflowers (forest/lakeside) — CC0 2k HDR via `RGBELoader`
- `MeshBasicMaterial` BackSide sphere; IBL still PMREM-baked from the sky mesh

| Item | State |
|---|---|
| Volumetric clouds removed | **Done** |
| Realistic HDR skybox | **Done** |

**Cache:** `index.html` / `main.js` / `game.js` **`?v=549`** · `sky.js?v=38` · `perf-tier.js?v=44`

**Proof:** `node tools/qa-sky-skybox.mjs` · `node tools/qa-sprint39-perf.mjs` · `node tools/qa-sprint76-perf.mjs`

**Still human-only:** Hard refresh `?v=549`, Desert look-up — photo cumulus, no smoke sheets.

---

# Sprint 50–60 closeout — v568 (3 Sep 2026)

**Charter:** Re-execute Sprints 50–60 for graphics, loading, driving, physics, and performance. Keep Done items live; close drifts without M1 fill-rate cliffs.

| Sprint | Player moment | v568 action |
|--------|---------------|-------------|
| 50 | Instant POV + cheap mirror | Mirror **256×80**, far **110**, POV every **2** presents |
| 51 | Desert closed underpass | Marked **Cut (S524)** in report — tunnel bumps stay |

**Note (v569):** The v568 STREAM/texture/AO cuts read as a visible graphics downgrade. Restored photographic terrain, LOD, stream radii, AO on balanced+high, wider shadow frustum, and cabin mirror quality. Prefer lock-30 to protect quality instead of dumping the ladder to `min`. Hard-refresh `?v=572`.

---

# Tunnel enter/exit realism — v572 (3 Sep 2026)

**Player moment:** Approach the Desert tunnel. You see a rock-cut cliff with a dark horseshoe punched through it, wing walls funneling the road, and a deep throat. Drive in — the bore stays arched (no box-wall shape swap). Exit reads the same cut face with daylight returning over ~64 m.

| Item | State |
|---|---|
| Vertical cut-face cliff + horseshoe aperture | **Done** |
| Deep throat liner + approach wings | **Done** |
| Arched bore lining (replaces box walls/ceiling) | **Done** |
| Softer shade ramp enter 32 m / exit 64 m | **Done** |

**Proof:** `node tools/qa-desert-tunnel-mouth.mjs` · `node tools/qa-sprint30-tunnel.mjs`

**Cache:** `index.html` / `main.js` / `game.js` **`?v=572`** · `track.js?v=248`

---

# Desert road width + tunnel mountain carve — v573 (3 Sep 2026)

**Player moment:** Stage 1 roads read wider (+2 m across sand/gravel/mud; tunnel 13–13.5 m). Approaching the ridge tunnel you see a full mountain cut: backdrop mass behind the cliff, graded approach apron, sculpted retaining walls, quarry shoulder pylons, deeper throat, and arched bore lining scaled to corridor width.

| Item | State |
|---|---|
| Desert spline widths widened | **Done** (`courses.js` +2 m; tunnel explicit 13–13.5) |
| Dynamic portal openH from road width | **Done** (`_tunnelOpenHeight`) |
| Cut face + backdrop + apron + retaining walls + pylons | **Done** |
| Arched bore lining matches portal spec | **Done** |

**Proof:** `node tools/qa-desert-tunnel-mouth.mjs` · `node tools/qa-sprint30-tunnel.mjs` · `node tools/qa-static-audit.mjs`

**Cache:** `index.html` / `main.js` / `game.js` **`?v=573`** · `track.js?v=249` · `courses.js?v=69`

---
### Sprint v579 — Tunnel mouth full overhaul (rock-cut portal)

| Item | State |
|---|---|
| Single battered mountain mass with horseshoe hole | **Done** |
| Thick sealed bore tube + black far plug | **Done** |
| Removed stacked lintel/wing/cheek/bench boxes | **Done** |
| Fixed inverted hole arc (was filling the mouth solid) | **Done** |
| Shoulder berms only (apron no longer spans drive) | **Done** |
| Deep+wide mouth land prism (no sand cliff across opening) | **Done** |
| No camera-fade on portal meshes | **Done** |

**Proof:** `node tools/qa-desert-tunnel-mouth.mjs` · mountain-only probe shows open aperture to sky; full portal builds mass+throat+plug

**Cache:** `index.html` / `main.js` / `game.js` **`?v=579`** · `track.js?v=262`

---
### Sprint v580 — AM3 documentary audio + surface contrast

**Source:** PandaMonium *Sega Rally Championship* doc ([transcript](AM3-DOC-TRANSCRIPT.md); directives in [AM3-RESEARCH.md](AM3-RESEARCH.md) §2 / §6).

| Item | State |
|---|---|
| Full caption transcript archived | **Done** (`docs/AM3-DOC-TRANSCRIPT.md`) |
| Mizuguchi gravel→door stereo pan on yaw | **Done** (`js/audio/skid.js` StereoPanner from signed `driftAngle`) |
| Sharper mud / gravel / sand brake+slide contrast | **Done** (`SURFACES` in `config.js`) |
| Research brief points at transcript + impl note | **Done** |

**Player moment:** sliding left/right on gravel/mud, grit moves to the travel-side ear; mud brakes start the slide harder vs tarmac stop.

**Proof:** `node tools/qa-static-audit.mjs` · hard-refresh `?v=580` · drive Desert gravel hairpin with headphones

**Cache:** `index.html` / `main.js` / `game.js` **`?v=580`** · `config.js?v=182` · `engine.js?v=61` · `skid.js?v=7`

---
### Sprint v581 — AM3 Visual (Art Direction + Lighting)

**Source:** [AM3-RESEARCH.md](AM3-RESEARCH.md) §1 (earth not asphalt), §4 Mountain rock face, §5 silhouette/colour.

| Item | State |
|---|---|
| Stronger sand / gravel / mud dust + tire-mark read | **Done** (`effects.js` profiles + alpha; sand `SURFACES.color` restored) |
| Desert warm earth lighting (not bloom fake) | **Done** (`LIGHTING.desert` Kelvin/fill/hemi/fog; bloom slightly down) |
| Mountain hairpin rock-face silhouette | **Done** (`_relightCliff` contrast + modest crest height) |
| Pool size / shadow maps unchanged (perf-tier safe) | **Done** |

**Player moments:**
1. Desert sand slide — warm hanging plume behind the car, not grey mist.
2. Gravel hairpin — sharp grit spray vs mud’s dark sticky clods.
3. Desert start grid / open Safari — amber key + sand bounce, not cold blue fill.
4. Mountain first hairpin — rock cutting reads as a dark/lit faceted wall against sky.

**Proof:** hard-refresh `?v=581` · drive Desert sand→gravel→mud · Mountain first hairpin chase cam · `node tools/qa-static-audit.mjs`

**Perf risk:** Low — same dust pool (no count bump); emission caps unchanged; cliff is existing mesh with vertex-colour retune only.

**Cache:** `index.html` / `main.js` / `game.js` **`?v=581`** · `config.js?v=183` · `effects.js?v=60` · `track.js?v=263` · `sky.js?v=39` · `lighting-rig.js?v=10`

---
### Sprint v581 — AM3 Audio (co-driver maybe + course beds)

**Source:** [AM3-RESEARCH.md](AM3-RESEARCH.md) §6; Kenneth Ibrahim / gravel-to-door / GAME OVER YEAH themes in [AM3-DOC-TRANSCRIPT.md](AM3-DOC-TRANSCRIPT.md).

| Item | State |
|---|---|
| Co-driver "maybe" on long/uncertain easy–medium arcs | **Done** (`pace-call.mjs` flags; `codriver.js` + `engine.paceCall` chain `long`→grade→`maybe`) |
| Recorded `long.mp3` / `maybe.mp3` (Daniel VO, not Sega) | **Done** (`assets/sfx/nav/`, `build-nav-grade-vo.sh`) |
| Per-course music identity (EQ/trim, no Sega music) | **Done** (`soundtrack.js` `DISC_MIX`) |
| GAME OVER YEAH *role* sting (CC0 result bed + overrun/checkpoint) | **Done** (`engine.gameOverYeah` + `result.mp3`) |
| Gravel→door stereo pan still wired | **Verified** (`skid.js` → `engine.setState` → `game.js` `driftAngle`) |
| AM3-RESEARCH §6 marked Implemented | **Done** |

**How to hear "maybe":** hard-refresh `?v=581`, unmute NAVIGATOR, race Desert — hold for the long gravel sweep / linked medium arcs; HUD shows `LONG … MAYBE` and VO says "long … maybe" after the grade. Pause-menu NAVIGATOR slider preview also chains `easy-left` + `maybe`.

**Proof:** `node tools/qa-sprint67-pace-vo.mjs` · headphones on Desert long sweep · timeout for result sting

**Cache:** `index.html` / `main.js` / `game.js` **`?v=581`** · `engine.js?v=62` · `codriver.js?v=38` · `soundtrack.js?v=135` · `pace-call.mjs?v=4` · `track.js?v=263` · nav clips `?v=5` · `skid.js?v=7`

---
### Sprint v581 — AM3 Gameplay

**Charter:** Close AM3 research §2 into player-visible handling — surface STOP vs POWER-SLIDE, Fujimoto jump reward/punish, wall glance (no championship hard-fail), manual downshift drift.

| Item | State |
|---|---|
| Tarmac STOP vs mud POWER-SLIDE contrast | **Done** (`SURFACES`: tarmac `brakeYaw` 0.02 / `slideHold` 0.58 vs mud `brakeYaw` 1.28 / `slideHold` 2.48; mud `dust`/`sink`/`roll` high) |
| `brakeSteerYaw` amplifies surface brake→yaw | **Done** (`HANDLING.brakeSteerYaw` 1.58) |
| Fujimoto lift+brake technique | **Done** (`JUMP` scrub 0.998↔0.58; `jump.js` ground wants brake; `airPitchDown` 0.38) |
| Walls glance, keep forward speed | **Done** (`collide.js` `applyGlance` wall keep 0.62; only clock `_dnf`) |
| Manual downshift-while-turning drift | **Done** (`gearDriftKick` 0.66 / yaw 0.95; lower steer threshold) |
| Research **Implemented (clone)** notes | **Done** (`docs/AM3-RESEARCH.md` §2) |

**Player moments:**
1. Mountain tarmac — full brake stops short and mostly straight.
2. Desert mud — brake+steer starts a long holdable power slide with thick dust/sink.
3. Crest — lift+brake → flat fast land; flat-out → speed scrub + unsettled grip loss.
4. Barrier scrape — car glances and keeps along-nose speed; championship continues.
5. Manual — downshift mid-corner lights the rear without needing the e-brake.

**Proof:** `node tools/qa-am3-handling.mjs` · `node tools/qa-jump-feel.mjs` · hard-refresh `?v=581`

**Risks:** Flat-out crests punish harder (`worstScrub` 0.58) — may feel harsh on multi-jump sequences until human stopwatch. Wall keep 0.62 can preserve speed into a second scrape if the barrier is long.

**Cache:** `index.html` / `main.js` / `game.js` **`?v=581`** · `config.js?v=183` · `vehicle.js?v=125` · `jump.js?v=24` · `collide.js?v=47` · `surfaces.js?v=51` · `effects.js?v=61` · `track.js?v=264`

---
### Sprint v581 — AM3 Environment (course identity)

**Charter:** Environment Art + Course Design — close AM3 §4 player-visible stage identity gaps without new frameworks. Earth not asphalt; no Sega assets.

| Item | State |
|---|---|
| Desert Safari wildlife gallery denser / closer / larger | **Done** (`_addSafariHerd`; prop-kit zebra/elephant/gazelle scales) |
| Desert Act 6 long-easy-right embankment continuous + taller | **Done** (`_addDriftSweepBerms` desert path + shards) |
| Forest tight corridor + chicane→open contrast | **Done** (`courses.js` widths/radii; `_addForestCorridorWalls`) |
| Forest puddles (visual + micro dips) | **Done** (`_addForestPuddles`; `road-micro` `puddleDip`) |
| Mountain rock face across first hairpin | **Done** (landmark pin; taller cliff; authored landmark prefer) |
| Lakeside northern-Europe autumn colour | **Done** (land paint; autumn card/canopy tints; subtitle) |
| Deeper mud/sand wheel ruts | **Done** (`surface-deform` DEPTH_CAP) |
| AM3-RESEARCH §4 Implemented notes | **Done** |

**Player moments:**
1. Desert teaching straights + open finale — zebra/elephant herds readable off the verge.
2. Desert Act 6 long right — outside sand embankment to lean on through the slide.
3. Forest Act 1–2 — close trees/understory + chicane, then wide meadow into Glade Bowl.
4. Forest dirt/gravel/mud — dark puddle discs + soft chassis dips.
5. Mountain first hairpin — tall rock cutting across the inside apex.
6. Lakeside — rust/gold floor and canopy, not summer green.

**Cache:** `index.html` / `main.js` / `game.js` **`?v=582`** · `courses.js?v=70` · `track.js?v=266` · `prop-kit.js?v=29` · `trees.js?v=38` · `road-micro.js?v=4` · `surface-deform.js?v=2` · `crowd.js?v=18`

**Proof:** `node tools/qa-static-audit.mjs` · hard-refresh `?v=582` · drive Desert Act 6 + Safari gallery · Forest corridor→glade · Mountain first hairpin · Lakeside shore trees

**Still human-only / remaining gaps:** herd GLB silhouette fidelity at far chase; Forest canopy overhang vs corridor scrub at race speed; Mountain cliff only on first landmark hairpin (not every pin); Lakeside autumn still uses Kenney/pack greens on some GLB trunks; no original procedural wildlife meshes beyond scaled kit GLBs.

---
### Sprint v583 — CTO closeout (AM3 studio ship)

**Org:** Parallel departments → CTO merge → CEO ship to GitHub Pages.

| Dept | Lead | Deliverable |
|---|---|---|
| Gameplay / Physics | [Gameplay](cb1c9636-dd86-46bf-9c9d-7c7022adfda2) | Tarmac stop vs mud slide; Fujimoto crest; wall glance; gear-drift |
| Audio | [Audio](cd77de34-7401-4d64-a9e2-b2d9b3e6e491) | Long…maybe VO; course EQ beds; gravel→door pan verified |
| Environment | [Environment](3975f5ae-2107-4bca-9ec5-5d6bc56af923) | Desert herd/berm; Forest corridor/puddles; Mountain rock; Lakeside autumn |
| Visual | [Visual](603a1b3a-4459-49ee-a51d-dac37d9584b5) | Surface dust identity; warm Desert light; cliff silhouette |
| CTO | merge | Unified `?v=583`; `pbr.js` single version; static + handling + pace VO green |

**Proof:** `node tools/qa-static-audit.mjs` · `node tools/qa-am3-handling.mjs` · `node tools/qa-sprint67-pace-vo.mjs`

**Cache:** `index.html` / `main.js` / `game.js` **`?v=583`** · `config.js?v=183` · `engine.js?v=63` · `soundtrack.js?v=136` · `pbr.js?v=32` (celica+game)

**Public:** https://jordanz00.github.io/rally-championship-2026/ (deploys from `main`)

---
### Sprint v585 — Tunnel interior unblocked (mouth only)

**Player defect:** Driveable bore was filled with solid geometry — black far plug + ~57 m throat from each mouth, and lining arch hole winding that extruded solid horseshoes every segment.

| Fix | State |
|---|---|
| Remove solid `portalBorePlug` | **Done** |
| Short mouth throat (`throatLen` 7, `faceDepth` 16) | **Done** |
| Hollow lining arch hole (crown winding, no bevel) | **Done** |
| Lining clear = paint half + 0.45 m | **Done** |

**Proof:** `node tools/qa-desert-tunnel-mouth.mjs` · `node tools/qa-static-audit.mjs`

**Cache:** `?v=585` · `track.js?v=268`

---
| 56–57 | Settle / title hitch | Deferred `_warmCarMeshes` after PRESS START |
| 58–60 | Title LOD / mesh LOD / smooth C | QA contracts fixed; rival shadow via `STREAM.rivalShadowFar` |
| Driving | Snappier plant + catch | `groundPlantRate 54`, `counterAuthority 3.35`, `tireYawBlend 0.36`, `steerSpeed 126` |

**Proof:** `qa-sprint58-title-lod` · `qa-sprint59-lod` · `qa-sprint60-smooth` · `qa-pov-mirror` · `qa-sprint39-perf` · `qa-jump-feel`

**Cache:** `?v=568` · `config.js?v=179` · `vehicle.js?v=124`

---

---
### Sprint v590 — Realistic suspension + tires


**Date:** 2026-09-03 · **Player moment:** bumps plant hard, rebound floats; tires load-sensitize grip and camber from road roll.

| Item | Status | Proof |
|---|---|---|
| Asymmetric bump/rebound wheel travel + anti-roll | **Done** | `_wheelCornerProbe` uses `suspBumpRate`/`suspReboundRate`; CHASSIS spring/ARB retuned |
| Suspension compression → axle load | **Done** | `suspLoadGain` in `_integrate` |
| Load-sensitive Pacejka + camber thrust | **Done** | `combinedTire(..., camber)`; FZ0 load sens |
| Load-dependent rolling radius → kappa | **Done** | Rf/Rr from compress |
| AM3 slide tools preserved | **Done** | `node tools/qa-am3-handling.mjs` PASS |
| Cache / static | **Done** | boot `?v=590` · `config.js?v=186` · `vehicle.js?v=127` · static audit PASS |

---

---
### Sprint v591 — Realistic tire ruts (not yellow paint)

**Player defect:** Soft-surface trails read as bright yellow strips instead of compressed earth, and lacked clear 3D tire trenches.

| Fix | State |
|---|---|
| Mute sand/dirt/mud/gravel rut tints (earth browns) | **Done** |
| Cooler `dustColor` + no banana sand plume boost | **Done** |
| Deeper accumulating deform field + finer cells | **Done** |
| Sculpted trench cross-section mesh (berm/wall/floor) + real normals | **Done** |

**Proof:** `node tools/qa-static-audit.mjs`

**Cache:** `?v=591` · `config.js?v=187` · `effects.js?v=62` · `surface-deform.js?v=3` · `track.js?v=270`

---
### Sprint v592 — Perf: batch GPU uploads, kill deform GC (keep fidelity)

**Player defect:** Soft-surface races hitch/hang; dust + rut meshes re-uploaded full buffers every stamp; Map string keys GC'd; pack fade toggled `mat.needsUpdate`.

| Fix | State |
|---|---|
| WheelRutMesh `flush()` + `updateRange` (one upload/frame) | **Done** |
| Integer Map keys in WheelDeformField (no string GC) | **Done** |
| Empty-field sample early-out | **Done** |
| Dust skip uploads when wake empty; AI spawn cap 12 | **Done** |
| TireMarks zero-alloc emit; AI soft rear-only + half-rate roll | **Done** |
| Crowd cheer ~20 Hz | **Done** |
| Pack see-through: arm transparent once (no mid-race recompile) | **Done** |
| Graphics fidelity unchanged (tier 13 / DEPTH_CAP / wake pool) | **Kept** |

**Proof:** `node tools/qa-static-audit.mjs` · `node tools/qa-am3-handling.mjs`

**Cache:** `?v=592` · `surface-deform.js?v=4` · `effects.js?v=63` · `crowd.js?v=19` · `occlusion-fade.js?v=14` · `track.js?v=271`

---
### Sprint v593 — Title car glass + glossy showroom

**Player defect:** Title orbit car windows showed flipped / inverted polygons; paint lacked wet clearcoat reflections.

| Fix | State |
|---|---|
| Glass `FrontSide` (no DoubleSide two-pass) | **Done** |
| Never merge cabin glass into body panels (LOD) | **Done** |
| `dressTitleCarShowroom` — clearcoat lacquer + reflective glass | **Done** |
| Hide cabin clutter through windows | **Done** |
| Showcase always boosts glass env; stronger title IBL | **Done** |
| Still LOD-first (fast title load, no 7MB hero) | **Kept** |

**Proof:** `node tools/qa-static-audit.mjs`

**Cache:** `?v=593` · `celica.js?v=150` · `pbr.js?v=34` · `config.js?v=188`

---
### Sprint v594 — Tunnel bore continuity + clean mouth (no clip)

**Player defect:** Clip through geometry inside the Desert tunnel; env rocks/sand through the entrance; mouth looked unclean.

**Already fixed (v585, kept):** no solid `portalBorePlug`; short mouth throat; hollow lining arches (correct winding); no stacked wing/lintel/cheek boxes.

**Remaining causes this sprint closed:**

| Cause | Fix |
|---|---|
| ~17 m gap after throat before lining (`start+8`) → sky/ridge through rock | Lining starts at `start+2` / `end-2`; throat tube extended to meet it |
| Mouth prism `halfLat≈43 m` planted hillsides in a trench | Split `driveHalfLat` (floor) vs `halfLat` (refuse) |
| Stadium `clearHalfW = half+VERGE+2.2` then snap to tight lining | `clearHalfW = half+ROAD_COLLIDER_CLEAR+1.55` |
| Chase-cam `cameraFade` on lining read as clipping through rock | `bores.userData.cameraFade = false` |
| Rocks/dunes allowed inside horseshoe | `_ribbonClear` / `_laneKeepout` refuse mouth corridor |

**Proof:** `node tools/qa-desert-tunnel-mouth.mjs` · `node tools/qa-sprint30-tunnel.mjs` · `node tools/qa-static-audit.mjs`

**Cache:** `?v=594` · `track.js?v=272`


### Sprint v595–596 — Smooth screen fades + load bar

**Player moment:** Menus, stage loads, and race reveal fade through black instead of hard cuts. The load bar eases and trickles smoothly; the shell fades in; championship next-stage / retry uses the same soft path.

| Change | Status |
|---|---|
| Curtain swap order: fade out → swap → hold → fade in | **Done** |
| Menu / cars / courses / controls / result / pause soft fades | **Done** |
| Loading screen soft entry (`outMs`/`inMs`, not instant) | **Done** |
| `waitLoadingBarSettled` then soft HUD reveal after settle | **Done** |
| Softer progress lerp + stall trickle; % text updates on integer change | **Done** |
| Load shell opacity/translate entrance | **Done** |
| `prefers-reduced-motion` still instant | **Kept** |

**Proof:** `node tools/qa-sprint88-car-pick.mjs` · `node tools/qa-sprint84-title-showroom.mjs --static` · `node tools/qa-static-audit.mjs`

**Cache:** `?v=596` · `hud.js?v=33` · `css/game.css?v=37`

### Sprint v597 — Realistic stage backgrounds

**Player moment:** Far country reads as real landscape — misty lakeside sky, sand haze, alpine ridges, forest hills — not a flat HDR card behind props.

| Change | Status |
|---|---|
| Unique lakeside misty HDR (`kloofendal_28d_misty_2k`) | **Done** |
| Stage fog/haze tightened + horizon glow seam | **Done** |
| `COLORS.fog*` aligned with `LIGHTING` | **Done** |
| Stronger aerial dissolve + far land mass | **Done** |
| Extra backdrop rings (mountain/desert/forest/lakeside) | **Done** |
| Wider land pad under horizon props | **Done** |

**Proof:** `node tools/qa-sky-skybox.mjs` · `node tools/qa-static-audit.mjs`

**Cache:** `?v=598` · `sky.js?v=40` · `track.js?v=273` · `config.js?v=189`

### Sprint v599–600 — Phase 1: vehicle feel + camera springs + PerformanceMonitor

**Player moment:** Celica/Delta/Stratos feel distinct in 10 s; chase camera has weight (springs, road look-ahead, speed FOV); suspension dive/squat/roll reads; handbrake starts a slide; `?debug=1` shows perf overlay.

| Change | Status |
|---|---|
| `CameraSpring` (pos/look/FOV) + road look-ahead | **Done** |
| Car identity separation (Celica planted / Delta snappy / Stratos RWD) | **Done** |
| Handbrake initiation (lower yawKick/powerMul) | **Done** |
| Visible brake dive / accel squat + wheel travel visual | **Done** |
| `PerformanceMonitor` (`?debug=1` / `?perfmon=1`) | **Done** |

**Proof:** `node tools/qa-static-audit.mjs` · `node tools/qa-am3-handling.mjs` · `node tools/qa-sprint70-camera.mjs`

**Cache:** `?v=600` · `config.js?v=191` · `vehicle.js?v=128` · `camera-spring.js?v=1` · `performance-monitor.js?v=1`

**Phase 1 exit:** awaiting human 10-second car-identity drive + Desert hairpin/jump. Do not auto-start Phase 2.

### Sprint v605 — Phase R.1: renderer foundation (WebGPU-ready)

**Player moment:** Same driving path; present path is now a `RenderPipeline` with explicit API caps. Production stays WebGL r160 so Pages/CDP do not strand. `vendor/three.webgpu.js` (r170) is on disk for R.2 cutover.

| Change | Status |
|---|---|
| `renderer-factory` + `RENDER_CAPS` + async `_bootGfx` join | **Done** |
| `RenderPipeline` present/resize/compile facade | **Done** |
| `QualityManager` dynamic-scale helper | **Done** |
| GLSL post/FX/occlusion gated when `glslCustom=false` | **Done** |
| Vendored `three.webgpu.js` | **Done** |
| Default THREE cutover / native WebGPU | **Deferred R.2** (TSL post + particles) |

**Proof:** `node tools/qa-static-audit.mjs` PASS · `RALLY_QA_ALLOW_CHROME=1 node tools/qa-boot-smoke.mjs` → title→menu→cars→Desert countdown PASS (SwiftShader race handover still 0 fps / budget — pre-existing headless limit)

**Cache:** `?v=605` · `renderer-factory.js?v=2` · `postfx.js?v=23` · `effects.js?v=64` · `occlusion-fade.js?v=15` · `track.js?v=274` · `performance-monitor.js?v=2`

### Sprint v606 — Sega Rally feel dial (AM3 handling pass)

**Player moment:** Wider tire sweet spot (grip→slide→recover), progressive surface grip loss, countersteer still a switch, subtle yaw/recovery/landing assists without a drift button.

| Change | Status |
|---|---|
| `ARCADE_ASSIST` config dial (yaw / recovery / driftStability / landing / tire soft) | **Done** |
| Progressive Pacejka falloff + wider tarmac/dirt/gravel peaks | **Done** |
| Slower felt-µ when *losing* grip (surface transitions) | **Done** |
| `Vehicle.physSnapshot` + `?physdebug=1` overlay | **Done** |
| No drift button; initiation remains brake / lift / power / gear / handbrake | **Preserved** |

**Proof:** `node tools/qa-am3-handling.mjs` · `node tools/qa-static-audit.mjs`

**Cache:** `?v=607` · `config.js?v=191` · `vehicle.js?v=129` · `jump.js?v=25` · `physics-debug.js?v=1` · `input.js?v=42`

**Tune next (human drive):** If too slippery → raise `ARCADE_ASSIST.recoveryAssist` / lower `tireSlideSoft`. If too grippy → raise `tireSlideSoft` / `powerSlidePitch`. If twitchy → lower `yawAssist`.

### Sprint v613 — Sega Rally driving model + Physics Lab (Stage 4 start)

**Player moment:** Binding arcade-rally feel contract (not sim); live Physics Lab dials + torture track so tuning happens against hairpin/gravel/jump/mud rhythm instead of code-only edits.

| Change | Status |
|---|---|
| `docs/SEGA_RALLY_DRIVING_MODEL.md` binding contract | **Done** |
| Physics Lab UI (`?physlab=1` / F8) — telemetry + live `ARCADE_ASSIST`/`HANDLING` dials | **Done** |
| `COURSES.physlab` torture track + Practice menu entry | **Done** |
| Directive / roadmap Stage 4 status + studio anchors | **Done** |
| Hardcore sim rewrite | **Rejected** (by contract) |

**Proof:** `node tools/qa-validate.mjs` · `node tools/qa-am3-handling.mjs` · `node tools/qa-static-audit.mjs`

**Cache:** `main.js?v=613` · `config.js?v=192` · `vehicle.js?v=130` · `courses.js?v=74` · `physics-debug.js?v=2`

**How to use:** Practice → PHYS LAB with `?physlab=1` (or press F8 in-race). Scrub dials; drive the sequence; only then commit HANDLING defaults.

### Sprint v614 — Pass 1 complete (all stages TrackDefinition) + tunnel volume wire

**Player moment:** Every championship stage uses the same authoring path; tunnel mouths/props share TunnelVolume margins; `?worldvalidate=1` shows an on-screen GREEN/RED badge.

| Change | Status |
|---|---|
| Desert / Forest / Lakeside → TrackDefinition (geometry-faithful) | **Done** |
| Fail-fast mount in `courses.js` + qa-validate Pass 1 check | **Done** |
| TunnelVolume → mouth prisms, prop exclusion, trench sizing | **Done** |
| `?worldvalidate=1` in-game badge | **Done** |
| Title-car cabin clutter hide (glass flipped-poly debt) | **Done** |
| Visual Pass V1 start (boot ACES + sRGB) | **Started** |
| Phase R.2 WebGPU production cutover | **Not started** (correct — stay WebGL; see RENDERER_MIGRATION) |
| ARCADE_ASSIST modest forgiveness re-bake | **Done** (lab human drive still recommended) |
| Visual Passes V2–V10 / Passes 2–5 AAA polish | **Not started** (name a pass to continue) |

**Proof:** `node tools/qa-validate.mjs` · `node tools/qa-world-geometry.mjs` · `node tools/qa-am3-handling.mjs`

**Cache:** `main.js?v=615` · `courses.js?v=75` · `track.js?v=277` · `tunnel-volume.js?v=3` · `world-geometry-validator.js?v=3` · `celica.js?v=151` · `config.js?v=193` · `hud.js?v=34`

**Headed:** hard-refresh `?worldvalidate=1` on Desert / Forest / Mountain / Lakeside — expect GREEN badge bottom-left.

### Sprint v619 — Headed world-validation PASS (all stages GREEN)

**Player moment:** Road/terrain conform no longer false-fails climbs; Desert tunnel approach land follows the climb into the portal instead of burying the ribbon.

| Change | Status |
|---|---|
| `tools/qa-headed-worldvalidate.mjs` headed Pass-0 gate | **Done** |
| Remove `_groundHeight` early `overlapBed` snap (climb float root cause) | **Done** |
| Validator uses per-sample deck hint (not XZ-nearest fold arm) | **Done** |
| Skip jump-neighbour samples in validator | **Done** |
| Desert on-deck short-circuit before ridge/dune | **Done** |
| Tunnel mouth floor `min(portal, localDeck)` on climbing approach | **Done** |
| Headed GREEN: desert · forest · mountain · lakeside | **PASS** |

**Proof:** `RALLY_QA_ALLOW_CHROME=1 node tools/qa-headed-worldvalidate.mjs` → PASS  
**Cache:** `main.js?v=619` · `track.js?v=281` · `world-geometry-validator.js?v=5`

**Next (Director sequence):** Begin Visual Pass V1 · or Begin performance baseline.

### Sprint v622 — Headed world-validation (Desert + Mountain tunnels)

**Player moment:** Mountain tunnel mouth no longer has land tris folding through the aperture. Desert/Mountain share one TunnelVolume mouth-floor contract. Bore lining overlaps so curve rings do not open to sky as easily.

| Change | Status |
|---|---|
| Mouth apron land floor for **all** tunnel stages (was Desert-only) | **Done** |
| `_groundHeight` shared mouth-floor before biome ridge | **Done** |
| Mountain TunnelVolume lateral exclusion → land stays bed | **Done** |
| `_tunnelTerrainY` uses stage scenery (not hardcoded desert) | **Done** |
| Validator `TUNNEL_APERTURE` probes at entrance/exit | **Done** |
| Bore lining full-run + heavier Z overlap | **Done** |
| Headed `?worldvalidate=1`: desert · mountain · forest · lakeside | **GREEN** |

**Issues closed**
- Mountain: terrain folding up through tunnel mouth floor (root: Desert-only mouth corridor in `_addLandTile` / `_groundHeight`).

**Remaining (not blocking GREEN; not V1)**
- Desert portal ridge silhouette stays intentionally jagged (arcade quarry) — do not flatten the ridge.
- Title showroom floating rocks (menu, not stage tunnels).
- Perfect horseshoe/portal mesh seal is portal-geometry polish, not heightmap conformity.

**Proof:** headed Cursor browser `?worldvalidate=1` all four stages · `node tools/qa-validate.mjs` · `qa-static-audit` · `qa-am3-handling` · `qa-world-geometry`  
**Cache:** `main.js?v=622` · `game.js?v=622` · `track.js?v=284` · `world-geometry-validator.js?v=6`

**Next approval phrase:** Begin Visual Pass V1

### Sprint v623 — Visual Pass V1 COMPLETE (rendering foundation)

**Player moment:** Stages share one ACES + sRGB contract; tunnel entry no longer pumps exposure (~4% vs ~22%); shadows use one bias/frustum contract; post grade is quieter so the image reads cleaner, not punchier.

| Change | Status |
|---|---|
| ACESFilmic locked in `configurePBRRenderer` (no Reinhard fallback) | **Done** |
| Tunnel `exposureBoost` 1.22 → **1.04** (lamps dim lights, not ACES) | **Done** |
| Shared `applyShadowQualityContract` + tighter race frustum (40 m) | **Done** |
| Restrained post (bloom/AO/vignette/contrast) | **Done** |
| Championship exposure unified at **1.12** | **Done** |
| DPR ceiling documented (`GFX.maxPixelRatio` 1.15) | **Done** |
| Worldvalidate remains GREEN ×4 | **PASS** |

**Color-management contract:** albedo SRGB · HDR LinearSRGB · output SRGB · tone ACES · exposure authored per stage · AA = canvas MSAA when post off, else capped DPR (no FXAA stack).

**Proof:** headed Cursor browser · `qa-validate` · `qa-static-audit` · `qa-am3-handling` · `qa-world-geometry`  
**Cache:** `main.js?v=623` · `config.js?v=194` · `lighting-rig.js?v=11` · `postfx.js?v=24` · `game.js?v=623`

**Next approval phrase:** Begin Visual Pass V2



