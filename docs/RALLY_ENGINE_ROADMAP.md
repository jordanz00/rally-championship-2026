# RallyEngine roadmap — staged build order

**Date:** 2026-09-04  
**Status:** Binding sequence for Cursor. Do **not** skip ahead without explicit approval.  
**Constitution:** [`CURSOR_GAME_DIRECTIVE.md`](../CURSOR_GAME_DIRECTIVE.md)  
**Repo:** evolve `js/` — conceptual “RallyEngine” is a **framework of modules**, not a mandatory TypeScript rewrite.

---

## North star

```
              MODERN RALLY GAME
                     │
       ┌─────────────┴─────────────┐
       │                           │
  SEGA RALLY DNA              MODERN ENGINE
       │                           │
 instant handling            WebGPU (+ WebGL2)
 surface physics             TSL for new shaders
 drifting · weight           PBR · HDR
 jumps · track design        streaming · LOD
 arcade flow                 instancing · dyn res
       │                           │
       └─────────────┬─────────────┘
                     ↓
              "ONE MORE LAP."
```

---

## Stage sequence

| Stage | Name | Intent | Repo status (2026-09-04) |
|---:|---|---|---|
| **1** | Architecture audit | Map systems, deps, bottlenecks; no code churn | **Partial** — [`CURRENT_ENGINE_AUDIT.md`](CURRENT_ENGINE_AUDIT.md); refresh when starting Stage 1 |
| **2** | Renderer / WebGPU | WebGPU preferred, WebGL2 fallback, TSL for new work, modular pipeline | **R.1 done** — factory/pipeline/caps/quality + vendored `three.webgpu.js`. **R.2 not started** (production still r160 WebGL) |
| **3** | Performance profiler | Permanent overlay + honest frame/GPU signals | **Partial** — `PerformanceMonitor`, `perf-tier.js`; extend toward PerformanceDirector |
| **4** | Physics laboratory | Short handling lab track + live dials | **Started** — `?physlab=1` / F8 + `COURSES.physlab`; assist defaults re-baked 2026-09-04 (human drive still recommended) |
| **5** | Vehicle physics | Sega Rally feel: slip, surfaces, drift, weight, assist dial | **Strong** — `vehicle.js` + `ARCADE_ASSIST`; tune via Lab, don’t rewrite into sim |
| **6** | Camera | Springs, road look-ahead, physics-driven FOV/pitch | **Partial** — Phase 1 `camera-spring.js`; deepen prediction / importance |
| **7** | Road / surface system | Shared surface authority for phys + render + audio | **Pass 1 + headed GREEN** — TrackDefinition all stages; TunnelVolume wired; `qa-headed-worldvalidate` PASS 2026-09-04 |
| **8** | Hero car rendering | Physical paint/glass, dirt masks, LODs | **Partial** — GLB + PBR hooks; deepen dirt/damage pipeline |
| **9** | Terrain | Chunked LOD terrain | **Partial** — ribbon world; road→terrain conform priority over density |
| **10** | Vegetation | Instanced + LOD cells + shader wind | **Paused** asset spam — clearance first until Mountain geometry green in-game |
| **11** | LOD / culling / streaming | Screen-space importance + forward bias | **Partial** — stream along spine; importance scoring next |
| **12** | Dust / gravel / mud | Physics-driven FX (slip × load × surface) | **Partial** — `effects.js`; keep GLSL gated for WebGPU |
| **13** | Lighting / weather | Sun + env + selective locals; weather after dry look | **Partial** — lighting-rig + HDR sky; weather later |
| **14** | Reflections | Car / wet / water priority; PMREM | **Partial** — env/PMREM path exists |
| **15** | Post-processing | Modular, restrained, tiered | **Partial** — PhotoRealPost (GLSL); TSL port = R.2 dependency |
| **16** | AI | Same `Vehicle.step`; personalities; surface awareness | **Partial** — same physics; deepen surface skill / mistakes |
| **17** | Dynamic quality | PerformanceDirector (invisible steps) | **Partial** — `perf-tier.js` + QualityManager |
| **18** | Benchmarking | Forest / rally / worst-case 30s captures | **Not started** as formal harness |
| **19** | Final visual polish | After bottlenecks cleared | **Not started** |

---

## Conceptual engine layout (map to `js/`)

```
                         GAME (js/game.js)
                           │
          ┌────────────────┼────────────────┐
          │                │                │
       PHYSICS           WORLD           PLAYER
    js/physics/*      js/tracks/*       input/camera
          │                │                │
          └───────┬────────┘                │
                  │                         │
             WORLD STATE                    │
                  │                         │
       ┌──────────┼──────────┐              │
       │          │          │              │
   RENDERING    EFFECTS    AUDIO ◄──────────┘
   js/gfx/*    js/effects  js/audio/*
       │
  PERFORMANCE DIRECTOR
  (perf-tier + quality-manager → future PerformanceDirector)
```

---

## Approval phrases

| Phrase | Action |
|---|---|
| **Begin headed world-validation** | Drive all championship stages with `?worldvalidate=1`; fix generators (tunnel mouths, float/bury, ridge) |
| **Begin Visual Pass V1** | Complete rendering contract (exposure · ACES/sRGB · shadows · baseline lighting) |
| **Begin performance baseline** | Headed frame-time + per-stage budgets (draws/tris/textures/particles/shadows) — no assumption opts |
| **Begin Visual Pass Vn** | Launch only the owning specialist(s) per [`AGENT_ARCHITECTURE.md`](AGENT_ARCHITECTURE.md) |
| **Visual QA review** | Agent 12 — score/reject only |
| **Integrate visual work** | Agent 13 — `qa-validate` + all-stage gates |
| **Begin Pass 2…5** | Shared production layers — all stages |
| **Begin Stage 2 / Phase R.2** | WebGPU benchmark-gated |
| **STOP AND AUDIT** | Quality + parity + Art Director scores |

**Default:** Headed world-validation → V1 → perf baseline → V2…V10. Never “everyone make AAA.” Cursor prompts must be **repo-aware and surgical** (inspect / must-not-touch / validation / pass-fail).

---

## Friend-test priority (wow path)

**Visual target:** [`AAA_VISUAL_TARGET.md`](AAA_VISUAL_TARGET.md) (Presentation Layer · double-take · Visual Passes **V1–V10**).  
**Quality gates:** [`QUALITY_STANDARD.md`](QUALITY_STANDARD.md) · `node tools/qa-validate.mjs`.  
**Parity:** [`ALL_STAGES_AAA_STANDARD.md`](ALL_STAGES_AAA_STANDARD.md).

**Pass 1 (data) DONE** — all championship stages are TrackDefinition; TunnelVolume wired; Node `qa-validate` PASS.  
**Headed world-validation DONE (2026-09-04)** — `qa-headed-worldvalidate` GREEN on Desert / Forest / Mountain / Lakeside.  
**Active gate:** Visual Pass **V1** → performance baseline → V2+.

**AAA corridor + Tier-1 double-take stack:** car · lighting · road · env density · atmosphere · camera · suspension · dust/marks.

WebGPU: stay WebGL until headed proof.

## Post–Pass 1 sequence (Director — binding)

Do **in order**. Do not skip ahead without naming the step.

| # | Step | Intent | Pass / fail |
|---:|---|---|---|
| **0** | **Headed world-validation** | Every championship stage with `?worldvalidate=1`. Inspect Desert + Mountain tunnel mouths. Find floating roads/props, buried props, tunnel intersections, ridge artifacts. Fix **generators** (conform / clearance / tunnel), not one-off props. | Badge GREEN all stages; tunnel entrances/exits clean in headed play |
| **1** | **Visual Pass V1** | Stabilize exposure; verify ACES/sRGB; standardize shadows; baseline lighting/rendering contract | Consistent present path title → race; no exposure flicker; shadow behavior documented |
| **2** | **Performance baseline** | Headed frame-time; per-stage budgets (draw calls, tris, textures, particles, shadows) | Numbers on disk; no “optimize by assumption” |
| **3** | **V2 — Hero vehicle** | Celica / Delta / Stratos: paint, glass, wheels, suspension viz, reflections, dirt, camera relationship | Start-line / chase double-take on all three cars |
| **4** | **V3 — Rally surface** | Road geo + gravel/dirt/asphalt materials, ruts, shoulders, tire interaction, transitions | Road reads as primary screen real estate |
| **5** | **V4 — Terrain** | Authored land around route: embankments, cliffs, cuts, drainage — kill “floating ribbon” | Terrain feels designed for the stage |
| **6** | **V5 — Vegetation** | Asset library + instancing + LOD + natural clusters | No procedural-looking repetition |
| **7** | **V6 — Atmosphere & lighting** | Stage profiles, depth, tunnel→outdoor, distant terrain | Each stage identity reads at speed |
| **8** | **V7 — Rally VFX** | Dust, gravel, marks, mud, landings — surface-dependent | Physics + visuals + audio agree |
| **9** | **V8–V10** | Camera · cinematic UI/presentation · photo/finish · final opt + visual QA | Friend-test + budgets hold |

Reply with **Begin headed world-validation**, **Begin Visual Pass V1**, **Begin performance baseline**, or **Begin Visual Pass Vn**.
