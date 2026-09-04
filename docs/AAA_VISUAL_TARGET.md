# Rally Championship 2026 — AAA Browser Visual Target

**Status:** Binding visual presentation target.  
**Goal:** Experienced gamers do a **double take** — *“Wait — this is running in a browser?”*  
**Prerequisites (do not skip):** [`QUALITY_STANDARD.md`](QUALITY_STANDARD.md) · [`ALL_STAGES_AAA_STANDARD.md`](ALL_STAGES_AAA_STANDARD.md) · [`WORLD_GEOMETRY_RULES.md`](WORLD_GEOMETRY_RULES.md) · [`AAA_BROWSER_PRODUCTION_STANDARD.md`](AAA_BROWSER_PRODUCTION_STANDARD.md) · [`AGENT_ARCHITECTURE.md`](AGENT_ARCHITECTURE.md) · [`ART_DIRECTION.md`](ART_DIRECTION.md)

**Multi-agent:** Specialist ownership only — see [`MULTI_AGENT_VISUAL_PRODUCTION.md`](MULTI_AGENT_VISUAL_PRODUCTION.md). Art Director may reject. Integration requires all four stages.

**Companions:** [`GAMER_WOW_CHECKLIST.md`](GAMER_WOW_CHECKLIST.md) · [`VISUAL_GAMEPLAY_NORTH_STAR.md`](VISUAL_GAMEPLAY_NORTH_STAR.md) · [`RENDERER_MIGRATION_ANALYSIS.md`](RENDERER_MIGRATION_ANALYSIS.md) · [`PERFORMANCE_RULES.md`](PERFORMANCE_RULES.md)

---

## Master directive

Build an **AAA Presentation Layer** over the game — car, road, terrain, lighting, atmosphere, particles, camera, materials, UI, transitions, and environmental density looking expensive **together**.

Do **not** pursue quality by polygon count alone. Maximize **perceived visual quality per millisecond of GPU time**.

```
Do not make Rally Championship 2026 look like a technically impressive Three.js project.
Make it look like a great racing game that happens to be running in a browser.
```

Target: **60 FPS**, stable frame pacing, on capable desktop hardware. All stages share the same presentation tech; only art/config differ.

Quality gates, deterministic generation, geometry validation, and performance budgets are **prerequisites** for visual upgrades — not things added afterward.

---

## The “double take” test

| Moment | Must feel like… |
|---|---|
| Start-line screenshot | Modern racing game |
| Forest drive | Believable veg depth/density |
| Gravel | Road physically different |
| Drift | Dust + marks + car + camera communicate slide |
| Jump | Suspension, wheels, air, dust exciting |
| Tunnel | Cinematic lighting transition |
| Tunnel exit | Dramatic bright reveal |
| Mountain vista | Atmospheric depth |
| High-speed | Looks fast |
| Car close-up | Expensive material response |

If any answer is **no**, improve that **system** — not random objects.

---

## Visual quality hierarchy (GPU budget)

**Highest:** player car · road · immediate terrain · nearby vegetation · lighting · shadows · particles  

**Medium:** midground env · rock formations · distant vegetation  

**Lower-cost:** distant terrain · distant veg · background  

Never spend equal GPU on every object. AAA corridor first.

---

## Double-take stack (priority)

| Tier | Systems |
|---:|---|
| **1 — essential** | Car · lighting · road materials · dense believable env · atmosphere · camera · suspension/vehicle anim · dust/gravel/tire FX |
| **2** | Shadows · water · reflections · terrain detail · car dirt · cinematic race presentation |
| **3** | Subtle bloom · color grade · extra particles · env animation |

### First 15 seconds sell the game

Orbit filthy car · sun on hood · dust drift · engine · countdown → launch · gravel spray · FOV pull · trees rush · crest · airborne · land compress · camera reacts → next corner sideways.

That sequence beats +200k polygons.

---

## Presentation systems (what “expensive” means)

### Hero car
High-quality geo · PBR · metallic + clearcoat · glass ≠ paint ≠ rubber · emissive lights without bloom spam · steering/spin/suspension/roll/pitch/squat/air/land · **dirt masks** (surface × slip × speed × off-road / mud) — obvious but cheap.

### Road
Never a flat plane: macro + medium + micro · ruts · grooves · gravel/dirt/mud · roughness/color variation · edge erosion · shoulders · puddles/wet where appropriate · surface type readable at speed.

### Terrain
Authored shapes around the road: valleys · ridges · cliffs · banks · drainage — not generic smooth hills.

### Environment density
Instancing · LOD · frustum/distance cull · reuse · hierarchical placement. Near = high; far = cheaper; transitions invisible. Multiple tree/rock silhouettes · ecological clusters · no grids · no primitive hero rocks.

### Landmarks (every stage)
Desert: canyon / rock / dust valley / jump · Forest: corridor / bridge / clearing / wall · Mountain: cliff / tunnel / vista / hairpin · Lakeside: shore / bridge / water vista / forest transition.

### Lighting & atmosphere
Shared pipeline: sun · env · exposure · tone map · soft shadows · contact · atmospheric perspective. **Per-stage profiles** (Desert warm hard · Forest filtered · Mountain clear · Lakeside warm atmospheric). Nearby sharp; distance fades into haze — not flat fog soup. Convincing sky integrated with terrain light.

### Water (Lakeside)
Reflections · roughness · subtle normals · shoreline blend · depth color — not a blue plane. Optimize hard.

### Shadows / reflections
Best near player/road/near env. Car · wet road · water get reflection priority — cheapest technique that sells the look.

### Particles / tire marks
Surface-driven · pooled · bounded marks (slip/brake/accel × surface). Never alloc/dealloc every frame.

### Camera / speed
Premium rally cam: look-ahead · accel/brake/roll/jump/land · subtle FOV · mass without exaggerated shake. High speed: slight FOV · dust · peripheral rush — not motion-blur crutches.

### Post & color
AA · tone · grade · subtle bloom/atmosphere. Avoid heavy CA/vignette/grain/blur. **Audit color-space** end-to-end (textures · env · RTs · post · tone). Road always readable.

### UI / presentation / photo mode
Premium title · car showcase · stage select · countdown · finish · results · photo mode (orbit, FOV, exposure, HUD off). Not generic HTML over a demo.

### Performance preservation
If veg is expensive → fix veg. Never nuke whole-stage quality for a local hotspot. Dyn-res · LOD · instancing · KTX2/Meshopt measured · reuse · pool · no hot-path alloc.

### Visual regression (milestone)
Fixed cams per stage: start · first corner · jump · landmark · tunnel in/out · finish. Compare after major render changes.

### Final rule
Every visual feature: *What does this add to perception?* Realism · depth · speed · materials · physical feedback · richness · atmosphere · immersion → keep. Complexity without visible win → remove.

---

## Presentation passes (approval-gated — never “make everything prettier”)

Namespace: **V1–V10** (visual). Distinct from foundation **Pass 1** (track/world gates).

| Pass | Focus | Notes |
|---:|---|---|
| **V1** | Rendering foundation | Color management · tone · exposure · AA · env light · shadows | **COMPLETE** (v623) — ACES locked; DPR capped; shared shadow bias; tunnel exposure stable; restrained post |
| **V2** | Hero car | Materials · dirt · physics-driven anim | **COMPLETE** (v628) — player-only clearcoat (field-assign, Celica/Delta/Stratos); surface×slip×speed dirt; wheel travel visual 1.52; AI pack stays Standard |
| **V3** | Road | Macro/medium/micro · shoulders · surface read | **COMPLETE** (v630) — enriched paintSurface + edge erosion; skirt grain/normal; shoulder/ribbon contrast; soft micro amp; ROAD_ROUGH spread |
| **V4** | Terrain | Believable landforms · conformity | **COMPLETE** (v631) — far landform amp; desert lee bias; mountain mid-rise; lakeside shore lip; land UV scale; per-scenery normal; height tint; trench/mouth contracts unchanged |
| **V5** | Vegetation | Density · clusters · LOD · instancing | **COMPLETE** (v632) — pack atlas far LOD; forest/mountain micro-clusters; desert cactus clumps; VISUAL.veg density; anti-clone palette; lodNear 148 |
| **V6** | Lighting / atmosphere | Stage profiles · sky · haze | **PARTIAL** (v634) — surgical aerialByScenery depth haze only; shafts / tunnel-exit cinema deferred |
| **V7** | VFX | Dust · gravel · marks · impacts |
| **V8** | Camera | Mass · look-ahead · speed read |
| **V9** | UI / cinematic presentation | Title · countdown · finish · photo mode |
| **V10** | Optimization | Profile · remove wasted GPU/CPU |

**Do not** start V2–V10 until:

1. Headed world-validation GREEN on all championship stages (`?worldvalidate=1`), and  
2. Visual Pass **V1** rendering contract is complete, and  
3. A **performance baseline** (headed frame times + budgets) exists.

Canonical order: [`RALLY_ENGINE_ROADMAP.md`](RALLY_ENGINE_ROADMAP.md) § Post–Pass 1 sequence.  
Name the pass: e.g. **Begin headed world-validation** · **Begin Visual Pass V1** · **Begin Visual Pass V2**.

Cursor prompts for these passes must be **surgical**: files to inspect · must-not-touch · validation commands · pass/fail — never “make it look AAA.”

---

## Materials (highest leverage)

Prefer excellent materials over poly spam. Shared library (evolve `js/gfx/pbr.js` / material modules):

DryDirt · WetDirt · Gravel · Mud · Asphalt · WetAsphalt · Grass · Rock · CliffRock · Sand · WetSand · Wood · PaintedMetal · Rubber · AutomotivePaint · Glass · Water  

Each: base color · roughness · normal · ambient response · detail scale. Detail maps > 500k gravel tris.

---

## LOD / instancing / assets

```
LOD0 (very high) → LOD1 → LOD2 → impostor/billboard
```

No Minecraft pop. **Any repeated env object must justify why it isn’t instanced.**

Pipeline: high-quality asset → optimize → compress (GLB + Meshopt/Draco + KTX2 measured) → LOD → validate → instance → place → light → render. Cursor builds pipeline/placement/shaders — not final hero meshes from `BoxGeometry`.

---

## Beauty benchmark (milestone)

`/benchmarks/visual/` (or `tools/` cams) — fixed positions per stage: START · CORNER · JUMP · LANDING · LANDMARK · TUNNEL_ENTRY · TUNNEL_EXIT · FINISH. Score visually + perf + geometry + materials + lighting after changes.

WebGPU: benchmark vs WebGL on all four stages — migrate only with evidence ([`RENDERER_MIGRATION_ANALYSIS.md`](RENDERER_MIGRATION_ANALYSIS.md)).

---

## How to ask Cursor

**Bad:** “Make everything prettier.”  
**Good:** “Begin **Visual Pass V2** — hero car clearcoat/dirt on all stages; run `qa-validate`; headed start-line double-take.”  
**Good:** “Begin **Visual Pass V1** — audit color-space + tone mapping consistency.”
