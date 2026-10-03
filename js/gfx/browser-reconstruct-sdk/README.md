# Browser reconstruct SDK (WebTSR)

MIT. Our algorithm. A drop-in reconstruct path for **Three.js r160 + WebGL2**.

Portfolio write-up: [`docs/WEBTSR.md`](../../../docs/WEBTSR.md). Isolated lab: `tools/webtsr-lab.html`.

This is **not** NVIDIA DLSS. It is **not** RTX-only. It does **not** load NGX, Streamline, or any vendor DLL / leaked weights. The temporal resolve lives in `../tsr-upscaler.js` and the optional depth-guided residual lives in `../neural-reconstruct.js`. Both are original GLSL we ship.

## What you get

| Control | Meaning |
|---|---|
| `off` | Native internal resolution (no reconstruct) |
| `dlaa` | Full-resolution temporal anti-alias |
| `quality` | ~0.77 internal scale |
| `balanced` | ~0.67 internal scale |
| `performance` | ~0.59 internal scale |

Default mode follows `TSR_DEFAULT_MODE` in the upscaler (**currently `quality`** on this title after the velocity-pass cut). Other hosts should stay on `off` until they measure Quality p50 against native.

`guided: true` adds a 3×3 residual after the temporal resolve (silhouettes / contact). It is **opt-in**. Missing `EXT_color_buffer_float` / `half_float` falls back to a bicubic passthrough.

## Install in another Three r160 WebGL2 app

1. Copy this folder plus the siblings it wraps:
   - `js/gfx/browser-reconstruct-sdk/`
   - `js/gfx/tsr-upscaler.js`
   - `js/gfx/neural-reconstruct.js`
   - `js/gfx/recon-weights.js`
2. Point the `three.module.js` imports at **your** Three r160 build (import map or edit the relative `vendor/` path). Use one Three instance — a second copy of the module will black-screen the targets.
3. You need WebGL2 and a renderable half-float colour target.

```js
import { createBrowserReconstruct } from "./browser-reconstruct-sdk/index.js";

const recon = createBrowserReconstruct(renderer, {
  mode: "off",       // stay off until you prove Quality wins
  guided: false,     // set true to create the residual pass
});

function onResize(w, h, pixelRatio) {
  recon.setSize(Math.floor(w * pixelRatio), Math.floor(h * pixelRatio));
}

function onCameraCut() {
  recon.reset();
}

function renderFrame(scene, camera, cars) {
  if (!recon.active) {
    renderer.render(scene, camera);
    return;
  }
  recon.render(scene, camera, { dynamicRoots: cars });
  // Present the reconstructed quad through your post stack, or:
  renderer.render(recon.presentScene, camera);
  // Guided colour also sits on recon.outputTarget when guided is on.
}

function setImageMode(mode) {
  recon.setMode(mode); // 'off' | 'dlaa' | 'quality' | 'balanced' | 'performance'
}

function teardown() {
  recon.dispose();
}
```

`dynamicRoots` should be the moving hero meshes (player + rivals). The upscaler builds a cheap velocity list from those roots. Call `reset()` on spawn, lap restart, or any hard camera cut.

If the host already has a post stack (bloom / AO / grade), present `recon.presentScene` into that stack the same way you would present the world scene. Do not also `setPixelRatio` to fake an upscale — scale lives inside the low-res target.

## Public API

```js
createBrowserReconstruct(renderer, { mode, guided })
  .setMode('off'|'dlaa'|'quality'|'balanced'|'performance')
  .setSize(w, h)
  .render(scene, camera, { dynamicRoots })
  .presentScene          // Three.Scene quad for your present / post
  .outputTarget          // residual RT after render, or null
  .reset()               // camera cuts
  .dispose()
```

Re-exports (unchanged modules): `TsrUpscaler`, `parseTsrParams`, `persistTsrMode`, `createReconstruct`, `parseReconParams`, `persistReconEnabled`, and the mode / storage constants.

## License

MIT. Copyright the authors of this repository.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
