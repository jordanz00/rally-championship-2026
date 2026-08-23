# GPT Optimization Brief — Rally Championship 2026 (Sprints 1–40)

**Purpose:** Hand this document to ChatGPT (or any LLM) to understand what was built, how it works, what is real vs scaffold, and where to push next for AAA browser rally.

**Play build:** `http://127.0.0.1:8765/index.html?v=320`  
**Proof command:** `node tools/qa-sprint35-40-matrix.mjs`

---

## 1. Product summary (elevator pitch)

A **browser-native arcade rally game** inspired by classic Sega Rally Championship — not a clone. Thirty-three sprints built boot, four championship stages, cinema PBR lighting, planted grip physics, six GLB cars, co-driver callouts, and championship integrity. **Sprints 35–40** added the AAA-gap *foundations*:

| Sprint | Theme | What shipped |
|--------|-------|--------------|
| **35** | DCC + damage | `tools/dcc-pipeline.mjs`, `js/assets/damage.js`, shader-tier body wear 0–3 |
| **36** | Pace library + cockpit | `js/tracks/pace-notes.js` (authored WRC calls), `js/cars/cockpit-anim.js` |
| **37** | Audio mix + reverb | `js/audio/reverb-zones.js`, wet/dry on SFX bus, per-stage zones |
| **38** | Pacejka + fixed-step | Per-surface Magic Formula coeffs; 60 Hz `_physAccum` loop (already present, hardened) |
| **39** | iGPU 60 Hz | `js/gfx/perf-tier.js`, `GFX.integratedFloorMs`, adaptive DPR + bloom drop |
| **40** | WRC length + ghosts + QA | Act 8 stage extensions, `GhostRecorder`/`GhostPlayer`, `LiveTelemetry` export |

---

## 2. Architecture map (files that matter)

```
index.html → js/main.js?v=320 → js/game.js
                                    ├── js/config.js (FIXED_DT, SURFACES, HANDLING, VISUAL, CHAMPIONSHIP)
                                    ├── js/physics/vehicle.js (Pacejka tires, damage, 4 substeps)
                                    ├── js/tracks/courses.js → js/tracks/track.js
                                    │       └── js/tracks/pace-notes.js (authored calls)
                                    ├── js/cars/celica.js (GLB garage, POV rig)
                                    │       └── js/cars/cockpit-anim.js
                                    ├── js/audio/engine.js
                                    │       └── js/audio/reverb-zones.js
                                    ├── js/gfx/perf-tier.js
                                    ├── js/assets/damage.js
                                    └── js/telemetry/{ghost.js, live-qa.js}
```

**QA gates:** `tools/qa-sprint35-40-matrix.mjs` runs all sprint gates + static audit.

---

## 3. Sprint 35 — DCC pipeline + damage (honest scope)

### Shipped
- **`tools/dcc-pipeline.mjs`** — validates 6 car GLB folders, writes `assets/dcc-manifest.json`
- **`js/assets/damage.js`** — `accumulateDamage()`, `applyDamageVisuals()` (roughness/color tiers)
- **`vehicle.damage`** 0..1 from wall rubs; no handling penalty (arcade-first)
- **`docs/DCC-ASSET-PIPELINE.md`** pattern via manifest + existing `tools/build-car-lods.sh`

### Not shipped (next human/AI work)
- Real **photogrammetry** meshes (need capture + retopo outside browser)
- Per-car **`damaged.glb`** mesh swap (hook is documented; runtime uses shader tiers today)
- Blender batch export automation beyond existing `glbedit.mjs` / `build-car-lods.sh`

### GPT optimization targets
1. Add `damaged.glb` per chassis + swap at `damageTier >= 2`
2. Extend `dcc-pipeline.mjs` to run `gltf-transform` decimation report
3. Tie damage to co-driver: "Bodywork!" at tier 3

---

## 4. Sprint 36 — Pace notes + cockpit motion

### Shipped
- **`js/tracks/pace-notes.js`** — `AUTHORED_PACE` for desert/forest/mountain/lakeside (distance-triggered)
- **`Track.noteAt()`** consults `findAuthoredNote()` before procedural curvature
- **`js/cars/cockpit-anim.js`** — spring steering wheel, gear-shift punch, head nod (procedural, not mocap BVH)
- **Co-driver vocabulary** extended (flat out, cobbles, narrow, crest, finish)

### Not shipped
- Real **mocap BVH** retargeting to driver mesh
- Full **Ibrahim pace-note WAV** library (still Web Speech API + beeps)
- Per-corner distance calibration after Act 8 layout changes (distances are approximate)

### GPT optimization targets
1. Re-measure spline distances after course edits → update `AUTHORED_PACE[].at`
2. Replace `_speak()` with `playHit(navBus, wav)` when WAV packs exist
3. Import Mixamo mocap → `cockpit-anim.js` clip blender

---

## 5. Sprint 37 — Wwise-grade audio + reverb

### Shipped
- **`ReverbZones`** — procedural IR convolver, zones: open/desert/forest/tunnel/mountain/stadium/water
- **Parallel wet send** on SFX bus (`engine.js` — sfxMerge → reverb → HP chain)
- **`zoneFromSample()`** driven by tunnel flag + `courses.scenery`
- **Surface high-pass** still on `_sfxHp` (mud vs tarmac)

### Not shipped
- True **Wwise/FMOD** project, HDR mixing, occlusion portals per mesh
- Separate **navigator bus** convolver (music muffling in tunnel is partial via existing EQ)

### GPT optimization targets
1. Add `reverbZone` pieces in `courses.js` for bridge/stadium sections
2. Music bus wet send when `inTunnel`
3. HRTF occlusion for chase cam behind berms

---

## 6. Sprint 38 — Pacejka + fixed-step physics

### Shipped (mostly pre-existing, now gated)
- **`FIXED_DT = 1/60`**, **`MAX_SUBSTEPS = 3`**, `_physAccum` while-loop in `game.js`
- **`pacejka()`** Magic Formula in `vehicle.js`
- **Per-surface `pacejkaB/C/E`** on tarmac, gravel, dirt, sand, mud
- **`combinedTire()`** reads surface coeffs

### Known limitation (documented in QA-REPORT V-2)
- Render may exceed 60 Hz on 120 Hz panels; **physics is fixed-step**, presentation is not always capped on all code paths
- Player mesh uses `alpha=1` (no interpolation) for responsive turn-in

### GPT optimization targets
1. Re-enable `drawPose(alpha)` for player with minimal steer lag compensation
2. Add camber/load sensitivity to Pacejka (currently simplified)
3. Validate 60 vs 120 Hz parity with automated CDP probe comparing lap times

---

## 7. Sprint 39 — Integrated GPU 60 Hz

### Shipped
- **`js/gfx/perf-tier.js`** — EMA frame ms → tier high/medium/low/min
- **`GFX.integratedFloorMs: 18.5`**, `integratedEmergencyMs: 22`
- Integrates with existing adaptive post (`adaptFloorMs`) and `_perfDprScale`
- **`tools/qa-sprint39-perf.mjs`** static gate

### Not shipped
- Headed **`tools/qa-gpu-matrix.mjs`** hardware database (add when CI has GPU runners)
- Automatic shadow map resize at runtime (tier signals only today)

### GPT optimization targets
1. Implement `renderer.shadowMap` map size step-down in `perf-tier.tick()`
2. Run `qa-frame-probe.mjs` on Intel Iris / M1 iGPU and log to telemetry
3. Add `?perf=integrated` URL flag forcing min tier for QA

---

## 8. Sprint 40 — WRC content + ghosts + live telemetry

### Shipped
- **Act 8 extensions** on desert, forest, mountain (~15–20% more stage length)
- **`CHAMPIONSHIP.stageTime`** recalibrated (desert 108s, forest 94s, mountain 86s)
- **`GhostRecorder`** — 10 Hz pose samples → `localStorage` best lap per course+car
- **`GhostPlayer`** — transparent rival mesh in **Time Attack** mode
- **`LiveTelemetry`** — ring buffer; `window.__rallyTelemetry.exportJSON()` in console

### Not shipped
- **Online ghosts** (needs backend + anti-cheat)
- **Staff ghost JSON** in `assets/ghosts/` (easy add — same format as recorder export)
- Full **WRC season** (12+ stages) — 4 stages + bonus lakeside today

### GPT optimization targets
1. Ship `assets/ghosts/desert-celica-staff.json` from a human gold lap
2. HUD delta time vs ghost (`+0.4s` / `-0.2s`)
3. Telemetry WebSocket to QA dashboard for playtest nights

---

## 9. How to validate (commands)

```bash
# Sprints 35–40
node tools/qa-sprint35-40-matrix.mjs

# Full studio check-in (includes 33–34)
node tools/qa-sprint34-checkin.mjs

# DCC asset manifest
node tools/dcc-pipeline.mjs --pace-audit

# Static hygiene
node tools/qa-static-audit.mjs

# Headed perf (requires Chrome, not sandbox)
node tools/qa-frame-probe.mjs
```

**In-browser telemetry export after a race:**
```javascript
JSON.parse(window.__rallyTelemetry.exportJSON())
```

---

## 10. What “AAA” still means vs this build

| AAA bar | This repo now | Gap |
|---------|---------------|-----|
| Photogrammetry worlds | Procedural + GLB props | Capture pipeline external |
| Mocap cockpit | Procedural spring anim | BVH clips |
| Wwise mix | Web Audio buses + convolver | Authoring tool + HDR |
| Full tire sim | Pacejka + arcade yaw/drift layer | Tire warmup, camber, CFD |
| 60 Hz all GPUs | Adaptive tier + probes | Hardware matrix CI |
| WRC calendar | 4+1 stages, Act 8 longer | Content volume |
| Online ghosts | localStorage | Server + validation |

**Honest verdict:** Sprints 35–40 close the **architecture gap** — every former “missing system” now has a module, gate, and extension point. Closing the **production gap** requires assets, audio sessions, human playtest hours, and backend for online features.

---

## 11. Recommended GPT prompt for next optimization pass

```
You are optimizing Rally Championship 2026 (browser WebGL rally game).

Read docs/GPT-OPTIMIZATION-BRIEF.md and inspect:
- js/game.js (race loop)
- js/physics/vehicle.js (tires)
- js/tracks/pace-notes.js (co-driver)
- js/audio/reverb-zones.js
- js/telemetry/ghost.js

Run: node tools/qa-sprint35-40-matrix.mjs

Priority order:
1. Fix any failing QA gate
2. Re-calibrate AUTHORED_PACE distances to match courses.js Act 8
3. Add staff ghost JSON + HUD delta in Time Attack
4. Headed perf: prove integratedFloorMs holds on target hardware
5. Do not break cache-bust chain (bump ?v= on touched imports)

Report: player moment improved, command that proves it, what remains human-only.
```

---

## 12. Cache bust (live)

`index.html` / `main.js` / `game.js` → **`?v=320`**  
Key modules: `config.js?v=122`, `vehicle.js?v=67`, `courses.js?v=58`, `track.js?v=161`, `engine.js?v=48`

---

*Generated: Sprint 40 — Rally Championship 2026 browser rally studio.*
