# Environment reconstruction — asset quality gate

**Status:** Binding. Removes the “swap a cheap mesh for a slightly cheaper mesh” escape hatch.  
**Registry:** [`env-asset-registry.json`](env-asset-registry.json)  
**Manifest:** [`ASSET-ACQUISITION-MANIFEST.md`](ASSET-ACQUISITION-MANIFEST.md)  
**Tool:** `node tools/qa-asset-quality.mjs` — **exit 1 while Forest trees are REJECT.**

This is **not** a request to make the current procedural Forest a little nicer.

The target is a **photorealistic rally location**, UE5-inspired at the player's focal distance, running in Three.js r160 WebGL. Not Nanite/Lumen. Not “better arcade Three.js scenery.”

Canonical audit (read before any generator edit): [`ENVIRONMENT-AUDIT.md`](ENVIRONMENT-AUDIT.md)

---

## Absolute rule

Do **not** replace a poor hero asset with a slightly better low-poly asset.

Do **not** generate primitive substitutes (cylinder / cone / sphere foliage / icosphere rock / extruded cliff) as the final close/medium visual.

If an asset is visibly worse than the target at normal camera distance, it is **REJECT**. Not “good enough.” Not “better than before.” Not “performance friendly.”

**Sourcing (only three legal outcomes):**

| | Outcome |
|---|---|
| **A** | High-quality asset exists in `assets/` → use it. |
| **B** | Missing → acquire/create a genuinely high-quality, licensed GLB. |
| **C** | Cannot obtain → **leave the existing asset**. Do not fill the slot with an inferior one. |

It is better to ship **20 excellent** trees/rocks/plants than **2,000** cheap ones.

---

## What “AAA” means here

Late-2000s / early-2010s premium rally **perception** in a modern browser:

- believable silhouettes
- PBR that responds to the existing lighting
- natural scale and ground contact
- ecological consistency
- controlled repetition
- LOD (quality where the player looks)

A 100k-tri tree with a bad silhouette still fails. A 50k-tri rock with a pasted photo still fails.

---

## Forbidden as Forest/Desert/Mountain/Lakeside **hero** visuals (0–50 m)

- cylinder / cone trees
- sphere or blob foliage
- capsule bushes
- cube / icosphere / random-vertex “rocks”
- primitive-generated cliffs and organic terrain
- hero-zone billboard vegetation
- single-color organic materials
- obviously stretched or repeating tiles
- Kenney densify **without** normal maps presented as geology
- `low_poly_forest_tree_pack.glb` marked PASS
- `js/tracks/trees.js` cone/icosphere foliage as close LOD

Primitives may exist as **invisible** helpers, colliders, generation guides, or **far** impostors.

---

## Five layers (rebuild independently)

1. **Macro** — cliffs, forest mass, tunnel geology, distant terrain  
2. **Mid** — trees, boulders, bushes, logs, roadside structures  
3. **Micro** — gravel, litter, grass clumps, erosion, debris (instanced / clustered, not 1,000 draw calls)  
4. **Materials** — albedo, normal, roughness, AO where useful  
5. **Composition** — clustering and biome rules, not uniform scatter  

Procedural code places. It does not author hero organic geometry.

---

## Pass order (do not skim all four stages)

| Pass | Scope | Status now |
|---|---|---|
| 1 | Forest inventory + hero trees/rocks | **PASS** — Poly Haven hero trees + rocks/logs |
| 2 | Forest ground / road visual shoulder | not started |
| 3 | Forest tunnel geology | not started |
| 4 | Forest mid/far LOD + repetition | not started |
| 5 | Desert (proven kit only) | not started |
| 6 | Mountain | not started |
| 7 | Lakeside | not started |

Do not rewrite `track.js`, `vehicle.js`, physics, collision, `Track.query()`, or invent a second height system.

---

## Honesty

`qa-static-audit` passing is **not** an environment pass.

Fog, bloom, exposure, more copies of the same reject mesh, or renaming a file “hero” do **not** count.

Human stop-and-look at 5 / 10 / 20 / 30 / 50 m is mandatory.
