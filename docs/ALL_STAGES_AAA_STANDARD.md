# Rally Championship 2026 — All Stages AAA Standard

**Status:** Binding. Supersedes any “one showcase stage, others stay prototype” interpretation.  
**Companions:** [`AAA_BROWSER_PRODUCTION_STANDARD.md`](AAA_BROWSER_PRODUCTION_STANDARD.md) · [`WORLD_GEOMETRY_RULES.md`](WORLD_GEOMETRY_RULES.md) · [`RALLY_ENGINE_ROADMAP.md`](RALLY_ENGINE_ROADMAP.md) · [`CURSOR_GAME_DIRECTIVE.md`](../CURSOR_GAME_DIRECTIVE.md)

---

## Critical requirement

**EVERY stage** must use the **same AAA-quality technology stack**.

Do **not** create one stage with superior technology while leaving the others behind.

```
EVERY STAGE =
  AAA visual quality
+ AAA environment integration
+ AAA track design
+ AAA presentation
+ high performance
```

Stages differ in **art direction, layout, lighting, scenery, gameplay identity**.  
They must **not** differ in **technical quality**.

Player path Desert → Forest → Mountain → Lakeside must never feel like:

> “Oh, this one is the cheap level.”

It must feel like:

> “Every track is a different AAA rally environment from the **same** game.”

---

## Shared technology ≠ identical looks

```
                 RALLY ENGINE
                      │
     ┌────────────────┼────────────────┐
     │                │                │
  Rendering        Physics           VFX
     │                │                │
     └────────────────┼────────────────┘
                      │
               SHARED WORLD TECH
                      │
   ┌──────────┬───────┼───────┬──────────┐
   │          │       │       │          │
DESERT     FOREST  MOUNTAIN LAKESIDE
   │          │       │       │
 config     config  config   config
 assets     assets  assets   assets
```

| Shared (engine) | Per-stage (data / art) |
|---|---|
| Road / terrain / clearance / tunnel / bridge systems | Track layout, elevation, rhythm |
| Vegetation / rock / prop engines | Species, density, palette, clusters |
| Materials, lighting, atmosphere, LOD, streaming | Profiles and parameters |
| Particles, tire marks, vehicle VFX, camera, post, audio surfaces | Intensity / biome tint |
| PerformanceManager, quality, dynamic resolution | StagePerformanceProfile caps |
| WorldGeometryValidator | Must **pass on every stage** |

Do not create stage-specific forks of core tech unless absolutely necessary.  
If Forest is slow → fix **VegetationSystem**. If Mountain rocks hurt → fix **instancing/LOD**. If Lakeside reflections hurt → fix **reflection strategy**. Improvements flow into the shared engine.

---

## Shared systems (evolve under `js/` — conceptual names)

| System | Current / target home |
|---|---|
| TrackSystem / RoadSystem | `track.js` + `track-definition.js` |
| TerrainSystem | `track.js` heightmap / conform |
| SurfaceMaterialSystem | `config.js` SURFACES + `pbr.js` / road materials |
| EnvironmentSystem / VegetationSystem / RockSystem / PropSystem | `track.js` scenery + `prop-kit.js` + `trees.js` |
| TunnelSystem | `tunnel-volume.js` + `track.js` `_addTunnel*` |
| BridgeSystem | Elevated open sections (no floating bridge hacks) |
| ClearanceSystem | `track-clearance.js` |
| WorldGeometryValidator | `world-geometry-validator.js` — **all stages** |
| LOD / Streaming / Performance / Quality | `perf-tier.js`, `quality-manager.js`, stream in `track.js` |
| Particle / Dust / TireMark / VehicleVFX | `effects.js` + deform |
| Lighting / Atmosphere | `lighting-rig.js`, `sky.js`, per-stage profiles |
| Camera | `camera-spring.js` + game chase |
| PostProcessing | `postfx.js` |
| AudioSurface | `js/audio/*` |

New work extends these modules. Do **not** invent parallel per-stage renderers.

---

## StageDefinition (data)

Each stage primarily defines **configuration**, not a custom engine:

- environment / scenery type  
- terrain + road parameters  
- track layout (authored `TrackDefinition` segments → pieces)  
- elevation / surface bands  
- vegetation / rock / prop palettes  
- lighting + atmosphere profiles  
- weather, landmarks, tunnel/bridge locations  
- difficulty, racing-line character  
- **StagePerformanceProfile** (after measured budgets)

Mountain already compiles from `js/tracks/stages/mountain-definition.js`. Desert, Forest, Lakeside migrate to the same authoring path over production phases — they must not remain forever on a weaker architecture.

---

## Four identities (art / design only)

| Stage | Identity | Distinctive content |
|---|---|---|
| **Desert** | Fast · open · dramatic · dusty · high-speed | Canyons, large rocks, sparse veg, dust, jumps, sweepers |
| **Forest** | Technical · dense · claustrophobic · slippery | Varied trees, mud, narrow, S-bends, no grid/float/intersect veg |
| **Mountain** | Elevation · danger · drama · verticality | Cliffs, tunnels, vistas, hairpins, climbs/descents |
| **Lakeside** | Fast · flowing · scenic · varied | Shore, water (same quality bar), bridges, transitions |

Same PBR / terrain / road / lighting / shadow / atmosphere / LOD / instancing / particles / marks / camera / post / dyn-res / monitoring on **all**.

---

## Surfaces (shared behavior)

ASPHALT · GRAVEL · DIRT · MUD · GRASS · ROCK (and existing aliases) influence grip, accel, brake, slip, dust, gravel, marks, tire sound, suspension — on every stage.

---

## Performance parity

| Target | All stages |
|---|---|
| FPS | **60** with stable pacing |
| Rule | No stage may become disproportionately expensive |

**StagePerformanceProfile** (document after measuring — do not invent hard caps):

```
maxDrawCalls, maxVisibleTriangles, maxTextureMemory,
maxParticles, maxShadowCasters, maxDynamicLights, maxVegetationInstances
```

Central PerformanceManager adapts Desert → Forest → Mountain → Lakeside without dropping an entire stage to “cheap mode.”

### No stage-specific cheating

- Do not make one stage visually cheap to “fix” FPS  
- Do not disable env detail as a permanent stage hack  
- Do not delete scenery to hide clips — fix clearance / systems  
- Do not reduce whole-stage quality instead of optimizing shared tech  

---

## Stage quality checklist (every stage)

**Track:** interesting layout · memorable rhythm · varied corners · elevation · brake/accel zones · technical + high-speed · jumps · surface changes · meaningful lines  

**World:** no float/clip · no primitive hero props · believable veg/terrain · shoulders · variation · landmarks  

**Visuals:** materials · lighting · shadows · atmosphere · car · surface detail · particles  

**Gameplay:** fun · responsive · challenging · readable · replayable  

**Perf:** 60 target · pacing · draw calls · memory · particles · LOD · instancing · dyn-res  

**Validator:** WorldGeometryValidator **PASS** (no RED) before “complete”

---

## Production order (parity-first)

Do **not** finish one stage with unique tech while others stay architecturally different.

| Phase | Work |
|---:|---|
| **1** | Build / harden **shared** systems |
| **2** | Migrate **all** stages onto shared systems (TrackDefinition, clearance, tunnel volumes, validator) |
| **3** | Geometry correctness on **all** stages |
| **4** | Improve layouts on **all** stages (authored rhythm) |
| **5** | Upgrade assets on **all** stages (near-field first, shared LOD) |
| **6** | Materials on **all** stages |
| **7** | Lighting / atmosphere profiles on **all** stages |
| **8** | VFX on **all** stages |
| **9** | Optimize shared systems (benefits every stage) |
| **10** | Final **parity** pass — no “cheap level” |

**How to use Mountain:** first consumer / stress test of shared systems is fine. Shipping Mountain-only AAA while Desert/Forest/Lakeside lag on old tech is **not** allowed.

---

## Final rule

If a visual technology is good enough for Mountain, it is available to Desert, Forest, and Lakeside.  
If an optimization is required for Forest, it improves the shared vegetation (or related) system.

**Build ENGINE SYSTEMS once. Build STAGE CONTENT independently. Maintain technological parity across all stages.**
