# Environment audit — photorealism (UE5-inspired, browser WebGL)

**Date:** 2026-09-06  
**Target:** Photorealistic rally environment, UE5-inspired presentation, browser-constrained Three.js r160 WebGL.  
**Not the target:** Nanite/Lumen. Not “better arcade Three.js scenery.”  
**Judge:** medium gameplay camera, 5 / 10 / 20 / 30 / 50 m, then 30–70 m/s.  
**Architecture kept:** `Track.query()`, physics, Vehicle, AI, collision, tunnel volumes, no `src/`, no second renderer.

This audit is **required before generator edits**. Coding is blocked on the asset gap below.

---

## How the world is built today

```
Track (spline + query + clearance)     ← KEEP. Physics authority.
        ↓
_addLandTile / _biomeTint              ← procedural heightfield + vertex colour
_addTunnel*                            ← spline-extruded rock tubes
paintSurface / roadTextureFor          ← canvas albedo (~339×678), derived normals
_addScenery / _plantForestTree         ← scatter + InstancedMesh
prop-kit.js                            ← GLB load / merge / materials
trees.js                               ← cone/icosphere/cylinder fallbacks (FORBIDDEN as hero)
gfx/pbr.js + lighting-rig.js           ← MeshStandard + Kelvin sun (can reveal quality)
STREAM                                 ← chunk load ~fog, lodNear 148 m, natureShadowFar 48 m
```

Visual generation is still **one Track method farm**, not a biome world builder with geology / terrain-material / vegetation / roadside / hero / micro / atmosphere layers.

---

## Inventory (do not skip)

| Question | Answer |
|---|---|
| Mesh sources | Sketchfab `low_poly_forest_tree_pack.glb`; Kenney nature/trackside; Poly Haven CC0 heroes (`forest_hero_*`); Quaternius crowd; canvas road/skirt; procedural land/tunnel |
| Procedural geometry | Land tiles 256 m / 24 segs (~10.7 m cells); tunnel horseshoe lining; `trees.js` cones/icospheres; canvas cobbles; cliff/mass helpers |
| Materials | `worldRoadMaterial` / `worldTerrainMaterial` (Standard + vertex colours). Road roughness is a **scalar per surface id**, not a photographic roughness map. Nature Kenney: colormap / single JPEG, **no normals** |
| High-quality assets (keep) | `forest_hero_boulder_a/b`, moss sets, `forest_hero_log` (Poly Haven 1k PBR). Trackside barriers/fence/bench/crate (Poly Haven). Car GLBs |
| Instancing | `InstancedMesh` per streaming chunk; backdrop sectors 16; pack trees trunk+canopy pair |
| LOD | `STREAM.lodNear` **148 m** hi GLB vs lo cards. That is far too wide for hero budget: low-poly pack is shown as “hi” out to 148 m |
| Textures | Road: procedural canvas. Kenney hd: `bark_diff.jpg` 453 KB, `leaf_diff.jpg` 260 KB, `rock_diff.jpg` 254 KB — **diffuse only**. Poly Haven heroes: 1k albedo+normal+ARM |
| Culling | Fog-aligned STREAM load/unload; chunk spheres; far cards; `natureShadowFar` 48 m; `scrubShadowFar` 28 m |
| Draw cost (design, not a headed probe) | Forest plants hundreds of pack trees + 720 far trees + bushes. Hero photogrammetry is sparse. No headed 60 fps claim |

---

## ENVIRONMENT AUDIT

### FOREST (reference stage — Phase 1)

**Trees**  
Current: Poly Haven CC0 hero GLBs (`forest_hero_tree_a`–`h`, ~31k tris, 1k PBR) in the 0–20 m belt. Sketchfab pack atlas cards remain far LOD.  
Hero quality: **PASS** (close/medium). Far cards are still the pack.  
Action: keep heroes. Optional LOD1 bake later. **Do not generate cylinders.**

**Rocks**  
Current: Poly Haven photogrammetry in the close belt (`boulder_01`, `rock_07`, moss sets) **and** Kenney densify / pack rocks still in the kit.  
Hero quality: **PASS** for the four photogrammetry files; **FAIL** for Kenney/pack as hero.  
Action: keep heroes. Stop treating Kenney densify as geology. Need ~2 more distinct boulder silhouettes (target 6).

**Ground**  
Current: heightfield + `_biomeTint` vertex colour (moss/soil/gravel as RGB). Optional tiling maps; no layered soil/litter/moss PBR stack. Cell size ~10.7 m.  
Hero quality: **FAIL**  
Action: layered Forest PBR (soil, litter, moss, gravel, grass) + hero-zone mesh breakup. Do not raise canvas resolution and call it photoreal.

**Road**  
Current: spline ribbon, `paintSurface` noise/aggregate/oil/ruts in a **~339×678 canvas**, vertex colours, procedural normal from the same paint, `ROAD_ROUGH.tarmac = 0.24` constant. Micro-height in `road-micro.js` is physics chatter, not visual aggregate.  
Hero quality: **FAIL**  
Action: photographic PBR road set (albedo, normal, roughness) with wear, cracks, edge contamination. Visual shoulder ≠ a second green plane.

**Road edge / shoulder**  
Current: skirt mesh + `_biomeTint` distance-to-road (gravel→soil). Colour transition only.  
Hero quality: **FAIL**  
Action: irregular visual shoulder: compacted edge → gravel → dirt → vegetation. No second `Track.query()`.

**Vegetation / understory**  
Current: Kenney bushes (colormap, no N); `forest_hero_fern` = **4 alpha planes** (forbidden in 0–20 m); scatter + grove field, not a canopy→litter stack.  
Hero quality: **FAIL**  
Action: ecological layers (large → medium → bush → 3D ground cover → litter). Fern cards only beyond ~25 m.

**Fallen wood / roots**  
Current: one photogrammetry log (`dead_tree_trunk`). No exposed-root / dirt-bank meshes.  
Hero quality: **PASS** (log only); roots **FAIL / MISSING**

**Tunnel**  
Current: spline-extruded horseshoe, **one canvas striation** reused as albedo **and** normal, flat rock colours. Continuous blend (`caveInt`) is lighting, not geology.  
Hero quality: **FAIL**  
Action: sculpted portal / strata GLBs + bore PBR. Lighting already exists to *reveal* that geometry.

**Lighting / atmosphere**  
Current: Kelvin sun, sky rim, IBL, SSAO, fog STREAM, tunnel blend.  
Hero quality: **infrastructure PASS**, **look FAIL** until assets exist. Do not add fog/bloom/exposure to hide low-poly trees.

**Scale**  
Pack trees scaled to ~11.5 m cards. Kenney rocks stretched. Photogrammetry `rock_07` authored ~17 cm, runtime 0.85 m (stone, not cliff). Trunk diameters of the pack fail a 12 m inspection.  
Hero quality: **FAIL** until hero trees have real trunk caliper.

**Repetition**  
Six pack mixes from two trunk/canopy families. Far: 720 instanced cards. Rotation+scale is the variety.  
Hero quality: **FAIL**

**Composition**  
Grove/glade field exists; still scatter-first, not geology/vegetation ecology.  
Hero quality: **FAIL**

---

### DESERT (Phase 3 — do not start)

| Layer | Current | Hero |
|---|---|---|
| Trees / scrub | Kenney cactus + procedural | FAIL |
| Rocks | Kenney densify | FAIL |
| Ground | sand vertex tint | FAIL |
| Road | same canvas library | FAIL |
| Formations | procedural masses | FAIL |

### MOUNTAIN (Phase 4 — do not start)

Pack trees + Kenney + procedural cuts. **FAIL** across vegetation and geology.

### LAKESIDE (Phase 5 — do not start)

Pack/Kenney veg + water PBR. Shoreline **FAIL**. Water shader is not an environment pass.

---

## ASSET GAP REPORT

Status **MISSING** means: stop that slice. Do not fill with primitives.  
Status **HAVE** means: do not replace with worse.

### HIGH PRIORITY (Forest Phase 1 — 0–20 m)

```
FOREST_TREE_LARGE
  Required: 5 variants, distinct silhouettes (branching, crown, lean, trunk caliper)
  Quality: photoreal hero at 5–20 m
  LOD: 3 (LOD0 ~15–40k, LOD1 ~4–10k, LOD2 cards >60 m)
  Textures: bark + foliage PBR (albedo, normal, roughness; AO if useful)
  Memory: ≲ 8 MB per LOD0 GLB, 1k–2k maps
  Status: HAVE / PASS
  Runtime: forest_hero_tree_a…e (Poly Haven island_tree_01/02/03, fir_sapling_medium, tree_small_02)

FOREST_TREE_MEDIUM
  Required: 2–3 sapling / understory trees
  Quality: hero at 10–20 m · LOD 2 · PBR
  Status: HAVE / PASS
  Runtime: forest_hero_tree_f/g/h

FOREST_ROCK_HERO
  Required: 6 distinct geological silhouettes
  Have: boulder_a, boulder_b (stone), moss_set_a, moss_set_b (4)
  Gap: 2+ additional boulders/outcrops
  Status: PARTIAL

FOREST_VEGETATION_CLUSTER
  Required: 5 volumetric clusters (bush / fern / grass clump / litter pile)
  Quality: not 4-plane billboards in 0–20 m
  Status: MISSING
  Keep fern_02 as mid/far only

FOREST_TUNNEL_ROCK
  Required: 4 sculpted portal / strata / debris pieces + bore PBR
  Status: MISSING

ROAD_MATERIAL_FOREST
  Required: 1 photoreal tarmac/gravel rally set (albedo, normal, roughness, optional AO)
            + visual shoulder gravel/dirt
  Variants later: Desert, Mountain (3 biome sets total)
  Status: MISSING
  Current: canvas ~339×678 — FAIL
```

### MEDIUM PRIORITY (Forest Phase 2)

```
FOREST_GROUND_PBR        soil / litter / moss / gravel / grass — MISSING
FOREST_ROOTS             1–2 exposed-root / bank meshes — MISSING
FOREST_LOG_VARIANT       second fallen log — optional
FOREST_BUSH              2–4 PBR bushes — MISSING (Kenney stay until then)
```

### LATER (do not source yet)

Desert formations × n, Mountain cliff/talus, Lakeside reeds/shore — after Forest Phases 1–2 actually pass the stop-and-look test.

---

## Already acceptable (do not downgrade)

| Asset | Why |
|---|---|
| `forest_hero_boulder_a.glb` | scanned boulder, 66k, N+R |
| `forest_hero_boulder_b.glb` | scanned stone, 15k, N+R |
| `forest_hero_moss_set_a/b.glb` | scanned clusters |
| `forest_hero_log.glb` | scanned trunk, 102k, N+R |
| Poly Haven barriers / fence / bench / crate | trackside, not Forest nature |
| `lighting-rig.js` / `_tunnelBlend` | reveal quality; do not use to hide FAIL meshes |

---

## Forbidden as 0–20 m hero (unchanged)

Cylinder/cone/sphere trees, icosphere rocks, extruded cliffs, hero billboards, Kenney densify without normals as geology, marking the Sketchfab pack PASS, fog/bloom/exposure/AO-as-cover, more copies of a FAIL mesh.

---

## Pipeline we need (not implemented this pass)

```
TRACK GEOMETRY (existing query/clearance)
       ↓
BIOME WORLD BUILDER (Forest first)
  geological layer
  terrain material layer
  vegetation ecology layer
  roadside / road-material layer
  hero props (curated GLB)
  micro-detail (instance / decal / detail normal)
  atmosphere / background
       ↓
VISIBLE WORLD
```

Placement may stay in `track.js` helpers. Hero **meshes** must not.

---

## Definition of done (Forest hero zone)

A player stops the Celica, medium camera, and believes it is a real woodland rally — trees, bark, rocks, soil, gravel, road, edge, tunnel — then drives 30–70 m/s without the world collapsing into cards, tiles, and clones.

`qa-static-audit` passing is **not** that test.  
`qa-asset-quality.mjs` exits **0** once `FOREST_TREE_LARGE` is PASS. Tunnel / ferns / extra rocks remain open.
