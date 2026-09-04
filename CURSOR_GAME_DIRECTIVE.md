# RALLY CHAMPIONSHIP 2026 — MASTER DEVELOPMENT DIRECTIVE

**Status:** Binding constitution for Cursor and human contributors.  
**Live build:** https://jordanz00.github.io/rally-championship-2026/  
**Companions:** [`docs/QUALITY_STANDARD.md`](docs/QUALITY_STANDARD.md) · [`docs/AAA_VISUAL_TARGET.md`](docs/AAA_VISUAL_TARGET.md) · [`docs/AGENT_ARCHITECTURE.md`](docs/AGENT_ARCHITECTURE.md) · [`docs/ART_DIRECTION.md`](docs/ART_DIRECTION.md) · [`docs/MULTI_AGENT_VISUAL_PRODUCTION.md`](docs/MULTI_AGENT_VISUAL_PRODUCTION.md) · [`docs/AAA_BROWSER_PRODUCTION_STANDARD.md`](docs/AAA_BROWSER_PRODUCTION_STANDARD.md) · [`docs/ALL_STAGES_AAA_STANDARD.md`](docs/ALL_STAGES_AAA_STANDARD.md) · [`docs/VISUAL_GAMEPLAY_NORTH_STAR.md`](docs/VISUAL_GAMEPLAY_NORTH_STAR.md) · [`docs/GAMER_WOW_CHECKLIST.md`](docs/GAMER_WOW_CHECKLIST.md) · [`docs/WORLD_GEOMETRY_RULES.md`](docs/WORLD_GEOMETRY_RULES.md) · [`docs/RENDERER_MIGRATION_ANALYSIS.md`](docs/RENDERER_MIGRATION_ANALYSIS.md) · [`docs/CURRENT_ENGINE_AUDIT.md`](docs/CURRENT_ENGINE_AUDIT.md) · [`docs/QUALITY_TARGET.md`](docs/QUALITY_TARGET.md) · [`docs/PERFORMANCE_RULES.md`](docs/PERFORMANCE_RULES.md) · [`docs/RALLY_ENGINE_ROADMAP.md`](docs/RALLY_ENGINE_ROADMAP.md) · [`docs/AM3-RESEARCH.md`](docs/AM3-RESEARCH.md) · [`.cursor/rules/virtual-racing-game-studio.mdc`](.cursor/rules/virtual-racing-game-studio.mdc)

**Repo reality:** Browser ES modules under `js/`, Three **r160 WebGL** production path, vendored `three.webgpu.js` (r170) for Phase R.2. Do **not** rewrite from scratch. Do **not** remove cars/tracks/modes. Do **not** create a parallel `src/**/*.ts` tree unless the user approved a TypeScript migration. Evolve existing modules. Measure before replacing. Judge visuals **at racing speed**, not screenshots.

**Quality contract (highest priority vs feature vibes):** [`docs/QUALITY_STANDARD.md`](docs/QUALITY_STANDARD.md) — gate `node tools/qa-validate.mjs`. Fail fast. Fix generators. Controlled engineering mode.

**Visual target (double take):** [`docs/AAA_VISUAL_TARGET.md`](docs/AAA_VISUAL_TARGET.md) — AAA **Presentation Layer**; Visual Passes **V1–V10**. Prerequisites: quality gates + shared stage tech.

**Multi-agent visual work:** [`docs/AGENT_ARCHITECTURE.md`](docs/AGENT_ARCHITECTURE.md) · [`docs/ART_DIRECTION.md`](docs/ART_DIRECTION.md) · [`docs/MULTI_AGENT_VISUAL_PRODUCTION.md`](docs/MULTI_AGENT_VISUAL_PRODUCTION.md). Specialist ownership; Art Director may reject; Integration requires all four stages. Never one prompt for all agents to “make graphics AAA.”

**Production / parity:** Shared engine; stage data/art differ ([`docs/ALL_STAGES_AAA_STANDARD.md`](docs/ALL_STAGES_AAA_STANDARD.md)).

**Stage design rule:** Authored racing lines · clearance · AAA corridor · validator on every stage.

**Production rule:** Shared engine; stage data/art differ. All stages AAA tech parity ([`docs/ALL_STAGES_AAA_STANDARD.md`](docs/ALL_STAGES_AAA_STANDARD.md)).

**Stage design rule:** Authored racing lines · clearance · AAA corridor · validator on every stage.

---

## Core philosophy

```
MODERN ARCADE RALLY · AAA PRESENTATION · SEGA RALLY DNA
```

### Friend-test target

Not “a good Three.js demo.”  
Double take: *“Wait — this is running in a browser?”*

Permanent bar: [`docs/AAA_VISUAL_TARGET.md`](docs/AAA_VISUAL_TARGET.md) · [`docs/QUALITY_STANDARD.md`](docs/QUALITY_STANDARD.md) · [`docs/ALL_STAGES_AAA_STANDARD.md`](docs/ALL_STAGES_AAA_STANDARD.md) · [`docs/GAMER_WOW_CHECKLIST.md`](docs/GAMER_WOW_CHECKLIST.md).

**Parity:** Desert · Forest · Mountain · Lakeside share one tech stack; differ in identity/config/assets only.

### Product hierarchy (strict)

```
Sega Rally fun → modern racing-game feel → AAA presentation → browser performance
```

### Primary goal

- highly realistic **visually** (perceived AAA) · highly fun · highly responsive  
- impressive to experienced gamers · browser-stable · believable, not obviously procedural  
- cinematic without losing gameplay clarity  

**Gameplay reference:** Sega Rally Championship philosophy — [`docs/AM3-RESEARCH.md`](docs/AM3-RESEARCH.md).

### Do / do not

| Do | Do not |
|---|---|
| Believable + responsive + physical + fun | Full racing simulator |
| Surface-driven handling | Floaty / weightless / spline-following cars |
| WebGL production; WebGPU only after headed benchmark | Sacrifice responsiveness for sim accuracy / prestige API migrate |
| Perceived realism (lighting, materials, atmosphere, interaction) | Realism = more polygons only |
| AAA corridor budget (car → road → near field) | Equal detail on every object / effect stacking |
| Separate physics / render / camera / world / assets / gameplay | Giant update-loop conditionals as architecture |

### Engineering priority (strict order)

1. **Gameplay feel**  
2. **Visual quality** (where the player looks — Hero Car + road first)  
3. **Performance**  
4. **Maintainability**  
5. **Simulation complexity**  

Never add complexity that does not noticeably improve the player’s experience.  
Never sacrifice responsiveness for visual effects. Prefer shaders/LOD/instancing/lighting over poly spam.

### Visual priority (budget)

Player car → road near player → camera → surface interaction → lighting → nearby terrain/veg → FX → mid/far environment.

**Hero Car Mode** and near-photoreal **road** are disproportionate investments. See north star for wow moments, dirt pipeline, ecological veg, and per-track lighting profiles.

### Do not degrade the feel

Never “improve” physical realism if it makes the car less fun, less responsive, or less controllable.

The vehicle must feel: **immediate · heavy · responsive · slippery · predictable · recoverable · exciting**.

Avoid: excessive steering delay · instant loss of control · knife-edge tire breakaway · chronic under/oversteer · floaty suspension · fake sideways acceleration · exaggerated drift assists.

**Tuning question:** *Does this make the player want to take another corner?* If not, reconsider.

---

## Rendering target

| | |
|---|---|
| **Production (now)** | **WebGLRenderer** / `three.module.js` **r160** — recommended by [`docs/RENDERER_MIGRATION_ANALYSIS.md`](docs/RENDERER_MIGRATION_ANALYSIS.md) |
| **Ceiling (gated)** | WebGPURenderer / `three.webgpu.js` r170 + WebGL2 fallback |
| **New custom shaders** | Prefer **TSL / NodeMaterial** where practical |
| **Legacy** | Do not build *new* systems around GLSL-only hacks; migrate existing GLSL (post, dust) only with a plan |

Do **not** migrate for novelty. Migrate only when headed benchmarks show material gains and FX ports exist (**Stage 2 / Phase R.2**).

HDR · modern tone mapping · PBR · modular pipeline · scalable post · dynamic resolution · GPU/CPU monitoring · reusable RTs · no useless passes.

**Folder evolution (not a forced TS fork):**

| Conceptual | Evolve under |
|---|---|
| Renderer / pipeline / quality | `js/gfx/renderer-factory.js`, `render-pipeline.js`, `quality-manager.js`, `render-caps.js`, `perf-tier.js` |
| Lighting / post / PBR | `js/gfx/lighting-rig.js`, `postfx.js`, `pbr.js` |
| Shadows / reflections | extend lighting-rig + env bake in `game.js` / `sky.js` — extract when a sprint owns them |

---

## Performance target

- **60 FPS** aspirational · **~16.67 ms** budget  
- Design for high-end desktop, gaming laptop, modern iGPU  
- Graceful degradation via dynamic quality (PerformanceDirector / existing `perf-tier.js`)  
- Never assume a powerful GPU  
- Honest 60 claims require headed probes  

### Never (hot path)

allocate objects/arrays/materials/geometries/textures every frame · unnecessary individual vegetation meshes · unnecessary realtime lights · max quality at distance · expensive effects without tiers · duplicate large textures · reload same assets · needless raycasts · visual work at physics rate · physics work at render rate

### Always

reuse · pool · instance · stream · compress geometry/textures when measured · LOD · frustum cull · spatial partition · dynamic quality · profile GPU **and** CPU · separate sim from render

Full list: [`docs/PERFORMANCE_RULES.md`](docs/PERFORMANCE_RULES.md).

---

## Visual principle — perceived realism

Comes from: correct lighting · plausible materials/roughness · reflections · contact shadows · atmospheric perspective · terrain variation · environmental density · camera motion · suspension · vehicle↔world interaction · dust/gravel/mud · weather · **subtle** post.

**Resource priority (budget order):**

1. Player car  
2. Road immediately around car  
3. Terrain immediately around car  
4. Nearby vegetation / rocks / props  
5. Shadows near player  
6. Dust / mud / gravel  
7. Mid-distance environment  
8. Distant environment / background  

Use LOD, instancing, impostors, streaming, and atmospheric perspective for distance. Prefer **screen-space visual importance** (size × facing × gameplay × distance), not distance alone.

---

## Surface data owns the experience

One **track surface** authority feeds:

```
Track surface sample
        │
   ┌────┴────┐
   ↓         ↓
Physics    Renderer ──→ road wear / marks / dust
   ↓
Audio (tire beds)
```

Do not let “visual road” and “physics road” drift apart.

Surfaces affect: long/lat grip · braking · accel · rolling resistance · slip · drift initiation/recovery · suspension · steering · dust · gravel · sound.

---

## Vehicle / handling (AM3)

Authority: [`docs/SEGA_RALLY_DRIVING_MODEL.md`](docs/SEGA_RALLY_DRIVING_MODEL.md) + `js/physics/vehicle.js` + `HANDLING` / `ARCADE_ASSIST` / `SURFACES` in `config.js`.

**Target:** believable + responsive + driftable + forgiving + physical + fast + fun.  
Sega Rally **feel** (attack → slide → recover → accelerate) — **not** hardcore sim, **not** floaty arcade.  
Philosophy: ~70% physical behavior + ~30% invisible design assistance.

- Velocity-based chassis (not rotate-on-steer)  
- Slip angle · nonlinear tire curve · wide controllable peak  
- Drift **emerges** from inputs (no drift button)  
- Brake / lift / power / gear / handbrake initiation  
- Countersteer recovery · weight transfer · visible suspension  
- Fixed timestep · interpolated draw pose  
- AI must drive the **same** `Vehicle.step`  

Central dials: `HANDLING`, `ARCADE_ASSIST` (future: `SEGA_RALLY_FEEL` presets Arcade / Classic / Expert / Simcade).

**Physics Lab (Stage 4):** `?physlab=1` or **F8** — live telemetry + dials. Torture track: Practice → **PHYS LAB** (`COURSES.physlab`).  
Read-only overlay: `?physdebug=1`. Performance: `?debug=1` / `?perfmon=1`.  
**Do not tune handling by reading code alone** — drive the lab track.

---

## Camera

Springs / dampers · road look-ahead · speed FOV · brake pitch · accel bias · drift lag · landing compression · horizon stability. Camera is a **physics readout**, not a pile of unrelated lerps. Forward streaming / LOD should favor where the camera looks (ahead at speed).

---

## Materials (deliberate cost)

| Use | When |
|---|---|
| `MeshPhysicalMaterial` | Hero paint clearcoat, glass, selective metal — **player car** |
| `MeshStandardMaterial` | Most environment |
| TSL / NodeMaterial | **New** custom shader graphs (WebGPU-ready) |

Shared materials · variants via maps/uniforms/instancing · document cost. Prefer roughness / normals / env response / microvariation over poly spam.

---

## Assets / vegetation / terrain

- Prefer glTF/GLB; plan KTX2 / Meshopt / Draco **measured** (not “compress everything”)  
- AssetManager goals: cache, no duplicate fetch, memory, priority streaming along the **road spine** (front > sides > behind; stretch front with speed)  
- Vegetation: `InstancedMesh` + LOD cells — never one mega-instance spanning the stage  
- Terrain: chunked LOD, not one giant mesh  
- Road: special system (centerline, bank, surface, ruts, tracks) shared with physics  

---

## Architecture rule

Physics, rendering, camera, world, assets, and gameplay stay **separate**.

Never solve an architecture problem by adding another conditional to a giant update loop.

Cursor development loop:

1. Inspect existing code  
2. Identify dependencies and bottlenecks  
3. Explain the proposed change  
4. Smallest coherent change  
5. Test · profile  
6. Only then continue  

No duplicate systems · no temporary hacks that become permanent architecture · no unjustified rewrites.

---

## Staged roadmap (approval-gated)

Canonical stage list + current mapping: [`docs/RALLY_ENGINE_ROADMAP.md`](docs/RALLY_ENGINE_ROADMAP.md).

**Default until you name a step:** document / audit only — do not implement.  
**Post–Pass 1 order (binding):** headed world-validation → Visual Pass V1 → performance baseline → V2…V10.  
Surgical Cursor prompts only (inspect / must-not-touch / validate / pass-fail) — never “make it look AAA.”

| Say | Starts |
|---|---|
| **Begin headed world-validation** | All stages `?worldvalidate=1`; fix generators (tunnel / float / bury / ridge) |
| **Begin Visual Pass V1** | Exposure · ACES/sRGB · shadows · lighting contract |
| **Begin performance baseline** | Headed frame times + per-stage budgets |
| **Begin Visual Pass Vn** | Named presentation pass only (after V1 + baseline) |
| **Begin Stage 2** / **Begin Phase R.2** | WebGPU/TSL migration (WebGL2 fallback required) |
| **Begin Stage 4** / physics lab | Handling lab (already started — dials + physlab track) |
| **STOP AND AUDIT** | Mandatory post-feature review (below) |

Product feel track (Phase 1–3) and rendering systems track remain valid; **do not reverse “feel before giant world”**.

---

## STOP AND AUDIT (after every major feature)

Do not add another feature yet. Review against this directive:

**Gameplay:** immediate? responsive? controllable drift? surfaces different? recoverable? heavy? suspension reads terrain?  
**Graphics:** materials believable? reflections/shadows appropriate? macro/medium/micro? hero car? FX tied to physics? camera cinematic?  
**Performance:** CPU/GPU frame time · draw calls · tris · texture/geo memory · particles · shadows · post · resolution  

Identify the **three** biggest bottlenecks (CRITICAL / HIGH / MEDIUM / LOW). Recommend the three changes with the best **visual improvement / performance cost** ratio. Then wait.

---

## Development loop (mandatory)

```
BUILD → PROFILE → IDENTIFY BOTTLENECK → CHANGE ONE SYSTEM → PROFILE AGAIN → COMPARE
```

Never: BUILD → ADD 20 “optimizations” → HOPE.

---

## Approval gate

| User says | Allowed |
|---|---|
| *(docs only)* | This directive + audits / roadmaps |
| **Begin Phase 1** | Vehicle + camera + PerformanceMonitor (done) |
| **Begin Phase 2 / 3** | Per quality target exit criteria |
| **Begin Phase R** / **R.1** | Renderer foundation (done) |
| **Begin Phase R.2** / **Begin Stage 2** | WebGPU + TSL migration |
| **Begin Stage N** | Per [`RALLY_ENGINE_ROADMAP.md`](docs/RALLY_ENGINE_ROADMAP.md) |
| “Make it look realistic” alone | **Insufficient** — follow this directive; ask which stage |

Until an implementation stage is named: **inspect and document, or wait.**
