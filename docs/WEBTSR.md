# WebTSR — original browser temporal super-resolution

**Résumé line (accurate):** Designed and shipped WebTSR, a WebGL2 temporal super-resolution, depth-guided residual, and 3D-guided appearance stack for a live Three.js rally game, plus a drop-in MIT SDK.

**Do not write:** “Implemented NVIDIA DLSS 5.” DLSS 5 is Streamline/NGX on DirectX/Vulkan, RTX 50-class, Game Ready driver. This repo does not load it. That claim is false.

WebTSR is a legal browser clone of [Unreal Engine Temporal Super Resolution](https://dev.epicgames.com/documentation/unreal-engine/temporal-super-resolution-in-unreal-engine): render below display resolution, accumulate history, reproject with motion, reject / resurrect / spatially AA the leftovers. GLSL is ours. Not Epic's `.usf`, not NVIDIA DLSS, not Streamline.

## Live

- Game (desktop Quality on by default, LOOK off): `http://127.0.0.1:8766/index.html?v=981`
- Isolated SDK lab (no stage load, LOOK off): `http://127.0.0.1:8766/tools/webtsr-lab.html?v=981`
- Pause → **IMAGE** in-game: Off / DLAA / Quality / Balanced / Performance
- Pause → **REFINE**: depth + velocity residual. Pause → **LOOK**: appearance residual.
- Live UI never says “DLSS 5”. The control is IMAGE / TSR.
- `?tsr=off` forces native. `?recon=0` kills Refine. `?appear=0` kills Look.
- **Phones / `?perf=low|min`:** skip WebTSR compile. Lazy FXAA (`createMobilePresent`). No WebGPU. Title stays a single present.

## Pipeline

```
scene + Halton jitter  →  low-res colour + depth
        ↓
low-res view-space normals (MeshNormalMaterial override)
        (auto-off if the extra walk > 1.5 ms)
        ↓
car velocity (hero meshes only)
        ↓
reproject history (depth + velocity)
        ↓
YCoCg AABB clip  →  accumulate
        ↓
depth + velocity-guided 3×3 residual  (REFINE)
        (no spatial sharpen along moving cars)
        ↓
half-res appearance residual  (LOOK, opt-in)
        3×3 edge / contact / sheen / bounce
        compose residual onto full-res TSR (never blit-replace)
        luma clamp · first two frames passthrough
        ↓
full-resolution present  →  existing bloom / AO / grade
```

HUD stays native (DOM). `renderer.setPixelRatio` is not lowered; scale lives in the internal target. TSR present RCAS stays off while Refine or Look is on (no stacked sharpen).

## UE5 TSR → WebTSR (what we cloned)

Public Epic algorithms from the Temporal Super Resolution page. Our GLSL, not `TSRUpdateHistory.usf`.

| Epic component | In this repo | Notes |
|---|---|---|
| History (accumulate at display res) | `tsr-upscaler.js` ping-pong `_histRT` | Sample count in alpha |
| Nyquist-Shannon history at 200% | **Not shipped** | 4× resolve cost; Forest 33 ms gate |
| Parallax disocclusion | Depth + previous-depth compare | Camera + car velocity |
| Shading rejection | YCoCg AABB + luma-delta reject | Lighting / VFX drop history |
| Flickering temporal analysis | High-freq luma flip → relax reject | Forest fences / tree edges |
| History resurrection | `_resurrectRT` every 31 frames | Older match beats last frame |
| Spatial anti-aliaser | FXAA-style on `n < 2.4` | Cuts / disocclusion only |
| After-DOF translucency split | Not cloned | We have no AfterDOF pass |
| Async compute | Not cloned | WebGL2 has no async compute |

Debug: `?tsrdebug=noresurrect,noflicker,nospatial,noreject,nothin,novclamp`.

## Epic TSR FAQ → this build

From [Temporal Super Resolution FAQ](https://dev.epicgames.com/documentation/unreal-engine/temporal-super-resolution-frequently-asked-questions) and [Thin Geometry Detection](https://dev.epicgames.com/documentation/unreal-engine/thin-geometry-detection-with-temporal-super-resolution). Our GLSL. Not Epic `.usf`. No UnrealEngine.git cherry-picks.

| FAQ / page | WebTSR |
|---|---|
| Frame interpolation / generation | **Not cloned.** TSR is an upscaler. Adding FG would drop game Hz and starve history. |
| TSR has no sharpen pass | Present RCAS is the tonemapper-side sharpen (Fortnite uses `r.Tonemapper.Sharpen=0.5`). Off when REFINE / LOOK is on. |
| History sample count | Quality **16**, Balanced 12, Performance / DLAA 8. Does not grow memory. |
| Velocity weight clamp | **2.0** samples in motion (Fortnite competitive sharpness). |
| Screen percentage range | Modes 0.59–1.0. Nyquist 200% history **not shipped** (4× cost). |
| Dynamic resolution | Not on desktop (Epic FAQ: Windows APIs missing). Fixed Pause IMAGE scale. |
| ClampBlend + BlendFinal | AABB clip + BlendFinal=1 on real shading change. |
| Resurrection two conditions | Oldest persistent frame (interval 31) only if last frame mismatches **and** rez matches better. |
| Flicker off on movers | Disabled when car velocity is written or screen motion is high. |
| Thin geometry | Depth-edge + high-contrast line relaxes ClampBlend (Forest fences / tree edges). Large z-jump *walls* (tunnel mouth) drop history. Specular luma flips drop history (no wet-road swim). No Nanite / GBuffer shading-model ID. |
| After-DOF translucency | Not cloned — we have no AfterDOF pass. |
| Depth TAA after TSR | Not cloned. Present writes current low-res depth only. |
| Stat TSR feed / 1spp | `stats.feedMPs` and `stats.spp1Ms` (lab HUD + `qaSnapshot`). |

## How this differs from NVIDIA DLSS 5

| | NVIDIA DLSS 5 | WebTSR (this repo) |
|---|---|---|
| Host | Native DX / Vulkan + driver | Browser WebGL2 |
| Hardware | RTX 50-class (official) | Any WebGL2 GPU (M1 Pro included) |
| Super-resolution | Closed NVIDIA network | Halton + history + YCoCg clip |
| Appearance | One-step pixel-space diffusion | Hand-authored 3×3 residual, luma-clamped |
| Guidance | G-buffer + neural | Depth + override normals + motion |
| License | NVIDIA SDK | MIT |
| Install | Game Ready driver | Open the page |

## Measured (Forest ~600 m, Celica, IDE tab)

| Mode | p50 | Internal → present |
|---|---|---|
| Quality WebTSR (pre-Look) | **32.7 ms** | 1377×775 → 1788×1006 |
| Native off | **33.4 ms** | full buffer |

Look A/B never cleared the Forest 33 ms gate (G-buffer walk ~47 ms then abort; first LOOK frames ~20 ms compile). Appearance defaults **off** (`APPEAR_DEFAULT = false`). Pause LOOK or `?appear=1` is the opt-in. Isolated lab `tools/webtsr-lab.html?v=981` Quality p50 **16.7 ms** (845×751 → 1098×975, LOOK off, n 0.00 ms). G-buffer override is opt-in and aborts after frame 2 if it exceeds 1.5 ms. Proof: `node tools/qa-webtsr-sdk.mjs`.

## Device policy

| Surface | Present |
|---|---|
| Desktop (default) | Quality WebTSR + REFINE. LOOK opt-in. Lazy after first title frame. |
| Phone / iPhone / Android | Cheap FXAA `createMobilePresent`. No history, no LOOK compile, no WebGPU. |
| `?perf=low\|min` | Same as phone. |
| `?tsrforce=1` | Lab-only: force desktop WebTSR on a phone. |

Earlier Quality was 65.8 ms because velocity walked 214 car meshes. It now draws 7 hero body/wheel meshes. Shadows stayed 1536. Mid-throttle: no ghost body.

## SDK

```js
import { createWebTsr } from "./js/gfx/browser-reconstruct-sdk/index.js";

const tsr = createWebTsr(renderer, {
  mode: "quality",
  guided: true,
  appearance: true,
});
tsr.render(scene, camera, { dynamicRoots: [player, ...rivals] });
renderer.render(tsr.presentScene, camera);
```

`createBrowserReconstruct` is the same handle (older name). `presentScene` is unchanged so a host post stack still owns bloom / AO / grade.

Code: `js/gfx/browser-reconstruct-sdk/` · method notes in that README.
