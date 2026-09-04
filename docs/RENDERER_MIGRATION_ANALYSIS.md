# Renderer migration analysis — WebGL vs WebGPU

**Date:** 2026-09-04  
**Mandate:** Audit only. **Do NOT migrate** until explicit **Begin Stage 2** / **Begin Phase R.2**.  
**Constitution:** [`CURSOR_GAME_DIRECTIVE.md`](../CURSOR_GAME_DIRECTIVE.md) · [`VISUAL_GAMEPLAY_NORTH_STAR.md`](VISUAL_GAMEPLAY_NORTH_STAR.md)

---

## Verdict (2026-09-04)

| Question | Answer |
|---|---|
| Remain on WebGLRenderer for production? | **Yes** |
| Migrate to WebGPURenderer now? | **No** |
| Keep WebGPU path ready? | **Yes** (Phase R.1 foundation already shipped) |
| Prefer TSL for *new* custom shaders? | **Yes** (when writing new graphs) |

**Recommendation:** Stay on **Three r160 + `WebGLRenderer`** as the ship path. Treat **WebGPU / `three.webgpu.js` r170** as a gated ceiling raise after TSL ports and headed benchmarks prove material wins. Do **not** migrate because WebGPU is newer.

### Phase R.2 status (2026-09-04)

**Not started as production cutover** (correct). R.1 factory/caps remain. Opt-in diagnostics only: `?webgpu=native` when on a WebGPU THREE build. Production importmap stays `three.module.js` r160. Full R.2 requires: headed Forest/Desert 30s benchmarks, TSL ports for PhotoRealPost + particle GLSL, WebGL2 fallback proven, explicit **Begin Phase R.2** approval.

---

## Current stack (evidence)

| Item | Finding |
|---|---|
| Production THREE | `vendor/three.module.js` — **REVISION 160** |
| WebGPU vendor (idle) | `vendor/three.webgpu.js` — **REVISION 170** (~1.6 MB) |
| Production API | **WebGL** via `THREE.WebGLRenderer` |
| Factory | `js/gfx/renderer-factory.js` — WebGPURenderer-ready **if** export exists; today it does not on r160 module |
| Caps | `RENDER_CAPS` (`api`, `glslCustom`, …) gate GLSL post / dust / sparks / occlusion |
| Post | `PhotoRealPost` — custom **GLSL** `ShaderMaterial` multi-pass (scene+depth → SSAO → bloom → grade) |
| Particles / marks | `js/effects.js` — ShaderMaterial when `glslCustom` |
| Materials | Heavy `MeshStandardMaterial`; selective `MeshPhysicalMaterial` on hero paint (`pbr.js`, `celica.js`) |
| Lighting | Directional + ambient/env; ACES / color space via `lighting-rig.js`; HDR sky / PMREM path in `sky.js` |
| Shadows | Cascaded/cadenced map updates via perf tier (`autoUpdate = false`) |
| Assets | GLB + RGBE; **no** production KTX2Loader / Meshopt / Draco wired as default pipeline |
| Boot | ES modules, cache-bust `?v=`, **no bundler** |
| Host targets | GitHub Pages, desktop Chrome/Safari/Firefox, CDP headless QA, mobile |

**Hard lesson already learned (do not repeat):** Preferring `three.webgpu.js` via importmap when `navigator.gpu` exists broke headless Chrome (GPU reported, WebGPU init failed, no `WebGLRenderer` export) and menu flow. Reverted. Default cutover only after headed + Pages smoke.

---

## Compatibility matrix

| Surface | WebGLRenderer (r160) today | Native WebGPU via WebGPURenderer (r170) |
|---|---|---|
| Chrome desktop (headed) | Strong | Strong where GPU adapter works |
| Safari / iOS | WebGL2 path | WebGPU support uneven / evolving |
| Firefox | WebGL2 | WebGPU still limited vs Chrome |
| GitHub Pages users | Safe | Subset only — **fallback required** |
| CDP / SwiftShader QA | Known path | Previously failed factory / importmap |
| Mobile integrated GPUs | Known tiers + lock-30 | Unknown; must re-tier |

---

## What WebGPU could help (this game)

| Area | Potential benefit | Blocker today |
|---|---|---|
| Dense vegetation | Better compute / GPU-driven instance paths long-term | Need spatial cells + TSL/compute design first; instancing already helps on WebGL |
| Particles | Compute-friendly FX | Current FX are GLSL ShaderMaterials |
| Terrain | Future GPU clipmaps / deformation | Track is CPU/streaming ribbon today |
| Post-processing | MRT / node post pipeline | PhotoRealPost is hand-rolled GLSL RTs |
| Custom shaders | TSL → WGSL + GLSL | New work only; legacy GLSL must be ported |
| MRT / future compute | Real ceiling raise | No production consumers yet |
| Multiple cars / shadows | Indirect via better pipeline | Not the current bottleneck narrative |

**Not automatic wins:** swapping renderer alone does not fix stage-build hitch, tunnel/env-clip, or “looks procedural.” Hero car + road + lighting + camera still dominate friend-test on WebGL.

---

## Cost of migrating now

| Cost | Detail |
|---|---|
| **THREE version jump** | r160 → r170 webgpu build; loader/API drift risk |
| **PhotoRealPost** | Full rewrite or TSL node post equivalent |
| **effects.js / occlusion** | GLSL ports or soft-disable (`glslCustom=false`) |
| **Import / cache-bust** | Single THREE identity; no dual importmap traps |
| **QA** | Entire sprint matrix + headed frame probe + Pages |
| **Risk** | Strand Safari/Pages or CDP → “game broken” for friends |

---

## Decision criteria (when to revisit)

Recommend **Begin Phase R.2 / Stage 2** only when **all** are true:

1. Headed Chrome + at least one Safari/Firefox smoke pass with WebGL2 **fallback** proven.  
2. PhotoRealPost (or tiered subset) works on WebGPURenderer WebGL2 backend **and** native path, or post is gracefully tiered off.  
3. Dust/marks either TSL-ported or acceptable quality drop on native WebGPU.  
4. Benchmark scenes show **material** gain (frame time, particle budget, or visual ceiling) vs current WebGL — not “newer API.”  
5. Human signs off after reading this doc + before/after numbers.

Until then: **keep WebGL production**; use R.1 factory/caps; write **new** materials/FX toward TSL where practical without breaking r160.

---

## Incremental path (not a big-bang rewrite)

| Step | Action |
|---|---|
| Now | WebGL ship path; measure with PerformanceMonitor / frame probe |
| New shaders | Prefer TSL graphs that can later target both backends |
| Hero / road / lighting | Stay on Standard/Physical — biggest wow ROI without migration |
| R.2 | Cutover THREE identity carefully; WebGPURenderer with `forceWebGL` default; unlock `?webgpu=native` after FX ports |
| Later | KTX2 / Meshopt pipeline, compute vegetation, MRT post — only with benchmarks |

---

## Bottom line

For **Rally Championship 2026**, WebGLRenderer is currently the better **product** choice: compatibility, existing GLSL investment, and Pages/CDP reliability. WebGPU is a **real future ceiling** for MRT/compute/TSL post — pursue it as Stage 2 with proof, not as a prestige rewrite.

The friend-test (“holy shit, browser?”) is won first by **hero car + road + suspension + camera + dust + lighting coherence** on the renderer you already have.
