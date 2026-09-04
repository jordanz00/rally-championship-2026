# Performance Rules — Rally Championship 2026

**Status:** Binding for rendering / world / VFX work.  
**Read before:** any change to present path, shadows, particles, vegetation, terrain, materials, or streaming.  
**Companion docs:** [`CURRENT_ENGINE_AUDIT.md`](CURRENT_ENGINE_AUDIT.md) · [`QUALITY_TARGET.md`](QUALITY_TARGET.md) · [`AM3-RESEARCH.md`](AM3-RESEARCH.md)

These rules apply to the **existing** engine (`THREE.WebGLRenderer`, Three r160, ES modules under `js/`). They are **not** a license to rewrite the game or migrate to WebGPU without an approved renderer sprint.

---

## Hard rules

1. **Never** create one `Object3D` / `Mesh` per vegetation or debris instance when an `InstancedMesh` (or equivalent batched path) exists or can be extended.
2. Use **GPU instancing** for repeated environment objects (trees, rocks, grass cards, crowd, backdrop rings).
3. **No per-frame allocations** in the hot loop (`_loop` / `_fixed` / `_render` / camera / particles) when a reusable vector, matrix, or pool will do.
4. Do **not** ship uncompressed 4K textures for every material. Prefer shared/procedural maps, atlases where practical, and resolution by distance/importance. (KTX2/Basis is a **future pipeline** goal — do not block gameplay sprints on inventing it mid-feature.)
5. Expensive environment assets need a **cheaper far representation** (LOD mesh, card, impostor, or cull). No new “always LOD0” forests.
6. World objects must participate in **frustum / stream / distance** culling already used by `Track` streaming — do not add always-visible course-long meshes that defeat sector bounds.
7. **Terrain is chunked/streamed** (`STREAM`, land tiles, road chunks). Do not reintroduce one giant always-drawn land plane.
8. Distant vegetation uses **cheap LOD** (cards / simplified / fog dissolve). Impostors are welcome when they fit existing prop-kit paths.
9. **Avoid unnecessary realtime lights.** Outdoor = sun + hemi/env. Local lights only where they matter (tunnel sconces already capped, headlights, special FX). Do not add a `PointLight` per prop.
10. **Avoid dynamic shadows on insignificant objects.** Prefer `castShadow` / rival shadow far cull / gallery limits already in the stack.
11. **Do not create new materials every frame.** Reuse saturn / PBR / kit materials; clone only when ownership requires it.
12. **Reuse geometries and materials** across instances and stages when tagged `userData.shared`.
13. Use **object pools** for particles (dust, sparks, marks). Scale particle budgets with perf tier.
14. **Measure draw calls / frame time before** adding a visual effect. FPS alone is not enough; use or extend the performance overlay when present.
15. Every expensive effect must have a **quality setting** (tier / `VISUAL` / `GFX` knob) including an off or minimal path.
16. **60 FPS is the aspirational baseline;** clean **30 Hz lock** (`preferLock30`) is the honest floor when the GPU cannot hold 60. Never claim 60 without headed evidence.
17. **No feature is finished** until its CPU/GPU cost is stated (tooling or honest estimate) and documented in the sprint/QA note.
18. **Road and player car outrank distant trees** in budget (see visual-importance hierarchy in `QUALITY_TARGET.md`).
19. Prefer **textures + shaders** for gravel, tire wear, wetness, micro-detail; use **geometry** for cars, near rocks, road edges, trunks, buildings, guardrails.
20. Prefer **fake volumetrics** (fog, depth haze, mist particles, light shafts) over true volumetric raymarch unless a dedicated, tiered, measured sprint reintroduces it.
21. **Dynamic resolution / DPR / present scale** may drop under load and recover when headroom returns. Do not force permanent native ultra on integrated GPUs.
22. **Do not brute-force UE5 polygon counts** in the browser. Reproduce AAA *cues* (lighting, materials, atmosphere, contact) under these constraints.
23. Preserve existing architecture: **evolve** `perf-tier`, `STREAM`, `InstancedMesh`, postfx — do not replace with a parallel renderer “because it would be cleaner.”
24. **WebGPU** is an approved migration target only as its own sprint (fallback WebGL required). Until then, all work ships on the current WebGL present path.

---

## Distance budget (what the GPU should actually draw)

```
CAMERA
  0–30 m     → MAXIMUM (car, road, near rocks/vegetation, effects)
  30–100 m   → HIGH
  100–300 m  → MEDIUM
  300 m+     → CHEAP LOD / cards / simplified terrain
  beyond     → impostors, fog, atmospheric perspective, baked silhouette
```

Rally stages are **spline-spined**, not open world. Stream **forward** harder at high speed; recycle behind the car.

---

## Visual importance (spend where players look)

| Importance | Examples |
|---|---|
| 10 | Player car |
| 9 | Road / ribbon / shoulders |
| 6–7 | Near rocks, near vegetation, dust at wheels |
| 4 | Mid trees / crowd |
| 2 | Distant buildings / backdrop rings |
| ≤0.2 | Tiny debris, far grit |

LOD / stream / shadow decisions should bias toward high importance × screen size, not distance alone when practical.

---

## Quality tiers (product language)

Map to existing `perf-tier` / `GFX` / `VISUAL` — names may differ in code (`high|medium|low|min`).

| Tier | Intent |
|---|---|
| Ultra / High | Near-native scale, richer shadows/post/vegetation/particles when GPU allows |
| Medium | Balanced browser default |
| Performance / Min | Lower scale, fewer shadows/particles/post; prefer stable cadence |

Dynamic resolution and lock-30 are **allowed weapons**, not failures.

---

## Measurement bar

Before calling a visual feature done, record at least:

- FPS / frame ms (headed when claiming ship)
- Draw-call or present-path note
- Whether shadows / particles / post were involved
- Quality tier tested

Target guidance (aspirational, hardware-dependent):

| Metric | Guidance |
|---|---|
| FPS | 60 when possible; honest 30 lock otherwise |
| Frame budget | ~16.7 ms @ 60 |
| Draw calls | Prefer staying in a few hundred, not thousands of unique meshes |
| Hero car | Budget disproportionally high vs any single bush |
| Vegetation | Instanced + LOD |
| Lighting | Mostly sun + environment |
| Renderer today | WebGL; WebGPU only after migration approval |

---

## Anti-patterns (reject in review)

- `scene.add(new Mesh(...))` in a loop for every tree/rock/blade of grass  
- One course-long `InstancedMesh` that cannot be culled (sector/chunk required)  
- Per-frame `new THREE.Vector3()` / `new Material()` in race loop  
- Adding SSAO/bloom/SSR/TAA without a tier off-ramp and a measurement  
- Reintroducing full volumetric cloud raymarch as default  
- “UE5 look” via unbounded shadow maps, 4K×N texture stacks, or dozens of point lights  
- Rewriting `track.js` / `game.js` / renderer from scratch to match a folder diagram  

---

## Cursor instruction (paste when starting rendering work)

> Before implementing any rendering or world feature, read `docs/PERFORMANCE_RULES.md` and `docs/QUALITY_TARGET.md`. Follow their constraints. Prefer evolving `js/gfx/perf-tier.js`, streaming in `js/tracks/track.js`, and existing instancing over new parallel systems. Do not start a WebGPU migration unless the user explicitly approved that sprint.
