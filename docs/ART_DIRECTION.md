# Rally Championship 2026 — Art Direction

**Status:** Binding for all visual specialist agents.  
**Companions:** [`AGENT_ARCHITECTURE.md`](AGENT_ARCHITECTURE.md) · [`AAA_VISUAL_TARGET.md`](AAA_VISUAL_TARGET.md) · [`ALL_STAGES_AAA_STANDARD.md`](ALL_STAGES_AAA_STANDARD.md) · [`QUALITY_STANDARD.md`](QUALITY_STANDARD.md)

---

## Realism target

**Arcade-friendly physics** with **AAA-style presentation**. Believable, physical, readable — not a sim documentary, not a neon WebGL toy.

Reference feel: modern rally / GT / Forza **presentation principles** + Sega Rally **stage rhythm and surface drama**.

Unacceptable: “Three.js demo + imported models + unrelated procedural hills.”

---

## Color philosophy

- Linear / consistent color-space end-to-end (textures · env · RTs · post · tone).  
- Physically sensible exposure; materials readable in sunlight and shade.  
- Stage palettes differ; grading is subtle — not Instagram filters.  
- Avoid excessive saturation and gamey neon accents on natural terrain.

| Stage | Color / light mood |
|---|---|
| Desert | Warm hard sun · dry ochres · dust haze |
| Forest | Cooler filtered light · deep greens · damp darker soils |
| Mountain | Clear cool sun · rock greys · blue distance |
| Lakeside | Warm atmospheric · water reflections · lush near-shore |

---

## Material philosophy

Materials carry perceived quality more than poly count.

- Automotive paint: metallic + clearcoat + roughness variation + env response.  
- Glass ≠ metal ≠ rubber.  
- Road/terrain: macro + medium + micro (detail maps > gravel poly spam).  
- Wet / mud / gravel must **read differently** at speed.  
- Do **not** fix bad materials with excessive lights or bloom.

Library direction: DryDirt · WetDirt · Gravel · Mud · Asphalt · WetAsphalt · Grass · Rock · CliffRock · Sand · WetSand · Wood · PaintedMetal · Rubber · AutomotivePaint · Glass · Water.

---

## Lighting philosophy

Cinematic but controlled. Shared LightingSystem + per-stage profiles.

- Strong directional sun + env contribution + soft near shadows.  
- Tunnel: dark bore → bright exit reveal (double-take moment).  
- Atmospheric perspective: distance fades; near field stays sharp.  
- No flat fog soup · no bloom-as-lighting.

---

## Vegetation philosophy

Dense where it sells speed; cheap at distance.

- Multiple species and silhouettes; ecological clusters; no grids.  
- Scale / rotation / color variation; no identical silhouettes within ~100 m near the line.  
- Instanced + LOD + clearance — zero float, zero road intersect.  
- One repeated hero tree = Art Director reject.

---

## Environmental density

AAA **corridor** around the racing line. Midground believable. Distance atmospheric.

Landmarks required (memorable, not spam):

| Stage | Landmark examples |
|---|---|
| Desert | Canyon · rock formation · dust valley · dramatic jump |
| Forest | Tree corridor · bridge · clearing · rock wall |
| Mountain | Cliff · tunnel · valley vista · hairpin |
| Lakeside | Shoreline · bridge · water vista · forest transition |

---

## Camera philosophy

Premium rally camera = mass + look-ahead + subtle FOV. Communicates weight and speed.

- No exaggerated shake.  
- Road always readable.  
- Drift: heading vs velocity readable.  
- Jump/land: unload / compress readable.

---

## VFX philosophy

Physics-driven, pooled, bounded.

- Slip × surface × load → dust/gravel/mud/marks.  
- Landing burst short and powerful.  
- Marks accumulate but capped.  
- VFX support the car and road — they don’t replace materials/lighting.

---

## Vehicle presentation

Hero asset. Highest budget.

- Expensive paint/glass at start line and in motion.  
- Suspension and dirt sell the rally.  
- Start clean → end filthy (masks, not geo).  

---

## Acceptable vs unacceptable quality

| Acceptable | Unacceptable |
|---|---|
| Detail maps selling gravel | Flat road strip |
| Instanced varied forest | One tree on a grid |
| Soft near shadows + haze | Bloom covering weak materials |
| Authored tunnel carve | Mesh through solid terrain / clipping |
| PLACEHOLDER marked in prototype | Placeholder in production screenshots |
| Stage profiles on shared tech | Per-stage renderer forks |

---

## Reference imagery (use as aspiration, not assets)

- Modern WRC / rally photography: sun on clearcoat, dust plumes, crest jumps.  
- GT/Forza: car materials, exposure, readable road.  
- Classic Sega Rally: surface drama, rhythm, landmark stages — not layout copies.

Agents: when rejecting or proposing, cite which philosophy line failed.
