# WebTSR — original browser temporal super-resolution

**Résumé line (accurate):** Designed and shipped WebTSR, a WebGL2 temporal super-resolution and depth-guided residual stack for a live Three.js rally game, plus a drop-in MIT SDK.

**Do not write:** “Implemented NVIDIA DLSS 5.” DLSS 5 is Streamline/NGX on DirectX/Vulkan, RTX 50-class, Game Ready driver. This repo does not load it. That claim is false.

WebTSR is the *same problem class* (render below display resolution, reconstruct with history and 3D guides) implemented from published TAAU / UE5 TSR / FidelityFX ideas. GLSL and weights are ours.

## Live

- Game (desktop Quality on by default): `http://127.0.0.1:8766/index.html?v=923`
- Isolated SDK lab (no stage load): `http://127.0.0.1:8766/tools/webtsr-lab.html`
- Pause → **IMAGE** in-game: Off / DLAA / Quality / Balanced / Performance
- `?tsr=off` forces native. `?recon=0` kills the residual.

## Pipeline

```
scene + Halton jitter  →  low-res colour + depth
        ↓
car velocity (hero meshes only)
        ↓
reproject history (depth + velocity)
        ↓
YCoCg AABB clip  →  accumulate
        ↓
RCAS or depth + velocity-guided 3×3 residual
        (no spatial sharpen along moving cars)
        ↓
full-resolution present  →  existing bloom / AO / grade
```

HUD stays native (DOM). `renderer.setPixelRatio` is not lowered; scale lives in the internal target.

## How this differs from NVIDIA DLSS 5

| | NVIDIA DLSS 5 | WebTSR (this repo) |
|---|---|---|
| Host | Native DX / Vulkan + driver | Browser WebGL2 |
| Hardware | RTX 50-class (official) | Any WebGL2 GPU (M1 Pro included) |
| Weights | Closed NVIDIA network | Hand-authored 3×3 residual, in-repo |
| Guidance | G-buffer + neural | Depth + derived normals + motion |
| License | NVIDIA SDK | MIT |
| Install | Game Ready driver | Open the page |

## Measured (Forest ~600 m, Celica, IDE tab, 2026-10-03)

| Mode | p50 | Internal → present |
|---|---|---|
| Quality WebTSR | **32.7 ms** | 1377×775 → 1788×1006 |
| Native off | **33.4 ms** | full buffer |

Earlier Quality was 65.8 ms because velocity walked 214 car meshes. It now draws 7 hero body/wheel meshes. Shadows stayed 1536. Mid-throttle: no ghost body.

## SDK

```js
import { createBrowserReconstruct } from "./js/gfx/browser-reconstruct-sdk/index.js";

const recon = createBrowserReconstruct(renderer, { mode: "quality", guided: true });
recon.render(scene, camera, { dynamicRoots: [player, ...rivals] });
renderer.render(recon.presentScene, camera);
```

Code: `js/gfx/browser-reconstruct-sdk/` · method notes in that README.
