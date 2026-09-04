# Rally Championship 2026 — Multi-Agent AAA Visual Production

**Status:** Binding org chart for Cursor multi-agent visual work.  
**Visual target:** [`AAA_VISUAL_TARGET.md`](AAA_VISUAL_TARGET.md)  
**Quality gates:** [`QUALITY_STANDARD.md`](QUALITY_STANDARD.md) · `node tools/qa-validate.mjs`  
**Parity:** [`ALL_STAGES_AAA_STANDARD.md`](ALL_STAGES_AAA_STANDARD.md)  
**Art:** [`ART_DIRECTION.md`](ART_DIRECTION.md) · **Ownership:** this file  

---

## Master principle

```
PERCEIVED VISUAL QUALITY / GPU MILLISECOND
```

not polygon count. Treat this as professional game production, not a Three.js demo.

**Double take:** *“This looks like a commercial rally game. Wait — you're telling me this is a webpage?”*

Agents work in parallel **only** when ownership does not conflict. No agent casually rewrites another’s systems. Coordinate via this doc + public APIs before touching shared files.

**All four stages** use the same pipeline. No “good-looking stage” vs older implementation.

---

## Org chart

```
                  ART DIRECTOR (Agent 12)
                       │
          ┌────────────┴────────────┐
          │                         │
   TECHNICAL / RENDER           VISUAL QA
   (Agent 1 + Integration)          │
          │                         │
   ┌──────┼──────────────┐          │
Render Materials Lighting           │
   │      │              │          │
   └──────┼──────────────┘          │
          │                         │
     World Systems                  │
   Terrain Vegetation Props Geo     │
          │                         │
     Vehicle / VFX / Camera         │
          │                         │
          └──────────┬──────────────┘
                     │
              PERFORMANCE (11)
                     │
                     ▼
            INTEGRATION (13)
                     │
                     ▼
              ALL 4 STAGES
```

**Art Director / Visual QA may REJECT** work that “works” but fails the double-take (repeated silhouettes, flat road, non-automotive paint, procedural-looking tunnel mouths, etc.).

---

## Specialist roster

| ID | Role | Owns (systems) | Primary files (evolve — do not fork) | Must NOT casually touch |
|---:|---|---|---|---|
| **1** | Rendering Architect | Renderer · WebGL/WebGPU eval · color · tone · exposure · RTs · AA · caps · dyn-res · render architecture | `js/gfx/renderer-factory.js`, `render-pipeline.js`, `render-caps.js`, `capabilities.js`, `quality-manager.js`, `postfx.js` (pipeline hooks), `game.js` present path (with Integration) | Track layouts · env assets · vehicle physics |
| **2** | Lighting / Atmosphere | Sun · env · shadows · fog/haze · sky · exposure · tunnel light transitions · **LightingSystem** + stage profiles | `js/gfx/lighting-rig.js`, `js/sky.js`, stage lighting profiles (future/config) | Track piece lists · vehicle phys · unrelated materials |
| **3** | Material / Shader | PBR · road/terrain/rock/veg/water/auto · MaterialLibrary · SurfaceMaterialSystem · detail maps | `js/gfx/pbr.js`, road/terrain material helpers, future `js/gfx/materials/*` | Physics · track topology · camera |
| **4** | Vehicle Visuals | Hero car only: geo/materials/anim/dirt/lights | `js/cars/celica.js`, cockpit anim, vehicle dirt hooks | `js/physics/vehicle.js` (unless Integration + Gameplay approve) · track |
| **5** | Terrain / Track Visuals | Terrain · road mesh · shoulders · conform · cliffs/banks · TerrainSystem/RoadSystem | `js/tracks/track.js` (mesh/terrain sections), `road-micro.js`, `surface-deform.js` | Vegetation placement · unrelated post |
| **6** | Vegetation | Trees/bushes/grass · placement · LOD · instancing · VegetationSystem | `js/tracks/trees.js`, scenery plant paths in `track.js`, prop foliage | Tunnel carve · car · renderer core |
| **7** | Rock / Env Props | Rocks · cliffs · logs · signs · barriers · buildings · landmarks | `js/tracks/prop-kit.js`, prop placement in `track.js` | Physics · post · car materials |
| **8** | World Gen / Geometry Integration | Clearance · tunnel/bridge/road integration · **WorldGeometryValidator** · fail-fast gen | `track-clearance.js`, `tunnel-volume.js`, `world-geometry-validator.js`, `world-config.js`, `stage-data-validate.js`, `track-definition.js`, courses/stages | Hero car paint · postFX fashion |
| **9** | VFX | Dust · gravel · mud · smoke · marks · impacts · pooled systems | `js/effects.js`, deform/marks hooks | Track topology · lighting profiles wholesale |
| **10** | Camera / Cinematic | Chase cam · look-ahead · FOV · jump/land · photo mode · presentation cams | `js/camera/camera-spring.js`, chase paths in `game.js`, future photo mode | Physics tire model · materials |
| **11** | Performance | Budgets · LOD/instancing/cull policy · dyn-res · profiling · reject wasteful cost | `js/gfx/perf-tier.js`, `quality-manager.js`, `js/debug/performance-monitor.js`, budget docs | Art direction veto (advise only) |
| **12** | Visual QA / Art Director | Scores · rejects · consistency · double-take · reference cams | `docs/ART_DIRECTION.md`, `AAA_VISUAL_TARGET.md`, `GAMER_WOW_CHECKLIST.md`, visual scores | Implementing features (review, don’t own code) |
| **13** | Integration / Build | Merge · conflicts · `qa-validate` · static audit · boot smoke · route failures | `tools/qa-*.mjs`, cache-bust `?v=`, CI-style gates | Unilateral art changes |

Gameplay / handling agents (existing studio) own `js/physics/*` and `HANDLING` — Visual agents do not “improve” feel by changing tire curves without Gameplay sign-off.

---

## Parallel work rules

**Allowed together (typical):** Agent 1 + 3 + 4 + 9 · or 6 + 7 (different asset domains) · or 2 + 10  

**STOP and coordinate if** two agents need the same core file (`game.js` present, `track.js` monolith sections, `postfx.js`, `pbr.js` public API).

Before editing a shared system: read this file · list API impact · update the “Public APIs / assumptions” section below if you change contracts.

---

## Public APIs / assumptions (living)

| System | Consumer contract | Notes |
|---|---|---|
| `createGameRenderer` / `RENDER_CAPS` | Present path · post · effects GLSL gate | WebGL production; WebGPU gated |
| `PhotoRealPost` | Race present | GLSL; tiered quality |
| `configurePBRRenderer` / lighting-rig | Exposure · shadows · tone | Stage profiles via params |
| `Track.create(def)` | `pieces` + meta | Authored via TrackDefinition where migrated |
| `Track.query` / surfaces | Physics · audio · VFX | Shared surface authority |
| Clearance / TunnelVolume / Validator | Gen + QA | Tolerances in `world-config.js` |
| `Vehicle` visual hooks | Wheel/suspension/dirt from phys state | Phys owns numbers; visuals read |

Agents must document new public exports here when adding shared systems.

---

## AAA quality gate (per feature)

```
FUNCTIONAL + VISUAL + GEOMETRY + PERFORMANCE + INTEGRATION
```

Not complete because it renders. No PLACEHOLDER in production shots. All four stages through the same pipeline.

**Integration process after parallel work:**

1. Integration merges  
2. `node tools/qa-validate.mjs` (+ static audit)  
3. Geometry validate all stages (`?worldvalidate=1` / headed)  
4. Performance profile all stages  
5. Visual QA scores all stages  
6. Failures → responsible specialist  
7. Repeat until **all four** pass  

Do not declare success because one stage looks amazing.

---

## Visual scores (Art Director)

Per stage, score 1–10:

CAR · ROAD · TERRAIN · VEGETATION · LIGHTING · ATMOSPHERE · VFX · CAMERA · PERFORMANCE  

Agreed AAA threshold (default): **≥ 8** on Tier-1 categories (car, road, lighting, atmosphere, camera, performance); **≥ 7** on others — or reject.

Reject examples:

- Forest works but tree silhouettes repeat within 50 m  
- Tunnel functional but mouth looks procedural / clips  
- Car is “PBR” but paint doesn’t read automotive  
- Desert dense but road visually flat  

---

## Asset vs technology

Agents specialize in **tech that makes high-quality assets look incredible in-game** — not inventing final hero meshes from primitives.

```
HIGH-QUALITY ASSETS → Validate → LOD/Compress → Materials → Lighting
  → World Integration → VFX/Atmosphere → Camera → Post → PERFORMANCE → VISUAL QA → GAME
```

Primitives = PLACEHOLDER only.

---

## How to launch agents in Cursor

| User says | Agents |
|---|---|
| **Begin Visual Pass V1** | Agent 1 (+ 2 for exposure/shadows coordination) |
| **Begin Visual Pass V2** | Agent 4 (+ 3 for paint) |
| **Begin Visual Pass V3** | Agent 5 (+ 3) |
| **Continue Pass 1** (foundation) | Agent 8 primary |
| **Visual QA review** | Agent 12 only (read/score/reject) |
| **Integrate visual branch** | Agent 13 |

Never: “All agents make graphics AAA” in one prompt.
