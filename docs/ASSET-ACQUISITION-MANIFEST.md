# Asset acquisition manifest — Forest first

**Why this file exists:** the bottleneck is **content**, not JavaScript. Full audit: [`ENVIRONMENT-AUDIT.md`](ENVIRONMENT-AUDIT.md).

Do **not** drop raw Poly Haven `pine_tree_01` (~1.3 GB / 17M tris) into `assets/props/`.

Runtime: **GLB**, Y-up, metres, ground origin, PBR (albedo + normal + roughness). License: **CC0** or **CC-BY** + `ATTRIBUTION.txt`.

---

## HIGH PRIORITY (no generator work until trees exist)

### FOREST_TREE_LARGE — MISSING

```
Required: 5 variants (distinct silhouettes — branching, crown, lean, real trunk diameter)
Quality: photoreal hero at 5–20 m (UE5-inspired perception, not Nanite)
Format: GLB
LOD: 3
  LOD0  ~15–40k tris, bark geometry, foliage volume
  LOD1  ~4–10k
  LOD2  impostor / atlas >60 m
Material: bark + foliage PBR
Runtime: ≲ 8 MB per LOD0, 1k–2k maps
Status: MISSING
Current: low_poly_forest_tree_pack.glb (3,747 tris) — FORBIDDEN as PASS
Blocked: Poly Haven pine_* as shipped (hundreds of MB, no game LOD)
How to supply: DCC LOD bake, then pack like tools/pack-forest-hero-glb.py
```

### FOREST_TREE_MEDIUM — MISSING

```
Required: 2–3 sapling / understory
Quality: hero at 10–20 m · LOD 2 · PBR
Status: MISSING
```

### FOREST_ROCK_HERO — PARTIAL (4 of 6)

```
Have: forest_hero_boulder_a/b, moss_set_a/b
Gap: 2+ additional distinct outcrops
Do not replace HAVE assets with Kenney densify
```

### FOREST_VEGETATION_CLUSTER — MISSING

```
Required: 5 volumetric clusters (bush / 3D fern / grass clump / litter)
Forbidden in 0–20 m: 4-plane billboards
Status: MISSING
Keep fern_02 as mid/far only
```

### FOREST_TUNNEL_ROCK — MISSING

```
Required: 4 sculpted portal / strata / debris pieces + bore PBR
Status: MISSING
```

### ROAD_MATERIAL_FOREST — PARTIAL

```
Required: photoreal rally dirt/gravel (albedo, normal, roughness) + shoulder
Current: Poly Haven 1k dirt_floor + gravel_road on the Forest ribbon (~2 m tiles).
         Geometry is still the spline ribbon. Not a scanned road mesh.
         Canvas paint remains on Desert / Mountain / Lakeside.
Status: PARTIAL — headed 5/10/20/30 m check still required. Not PASS.
```

---

## MEDIUM (Forest Phase 2)

### FOREST_BUSH — MISSING

Kenney `plant_bush*` stay until 2–4 PBR bushes exist.

### FOREST_GROUND_PBR — PARTIAL

Poly Haven 1k `forest_floor` on Forest land/skirt (albedo + normal + roughness + AO).
Vertex colour is a light multiply, not the albedo. Still a heightmap, still tiles.
Do not call this a scanned forest floor.

### FOREST_ROOTS — MISSING

1–2 exposed-root / bank meshes.

---

## Already acceptable (do not replace with worse)

| ID | File | Notes |
|---|---|---|
| FOREST_ROCK_BOULDER | `forest_hero_boulder_a.glb` | Poly Haven boulder_01 |
| FOREST_ROCK_STONE | `forest_hero_boulder_b.glb` | small stone |
| FOREST_ROCK_MOSS | `forest_hero_moss_set_a/b.glb` | plant sparsely |
| FOREST_LOG | `forest_hero_log.glb` | lying trunk |

---

## Later stages (do not start)

Desert / Mountain / Lakeside libraries wait until Forest Phase 1 trees pass the stop-and-look test.

## Done for Phase 1

`FOREST_TREE_LARGE` **PASS** in `env-asset-registry.json`, files on disk, `qa-asset-quality.mjs` exits 0, two different trees at 12 m do not read as faceted trunks.
