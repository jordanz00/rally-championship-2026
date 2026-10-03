/**
 * Browser reconstruct SDK — MIT temporal + spatial reconstruct for Three r160 WebGL2.
 *
 * WHO THIS IS FOR: this rally title and any other Three.js WebGL2 game.
 * WHAT IT DOES: wraps the existing TsrUpscaler + guided residual
 *   (createReconstruct). Does not rewrite those modules. Public factory:
 *   createBrowserReconstruct(renderer, { mode, guided }).
 * HOW IT CONNECTS: re-exports tsr-upscaler.js and neural-reconstruct.js.
 *   RallyGame may construct through this factory; other hosts import it
 *   the same way.
 *
 * This is our algorithm. It is not NVIDIA DLSS, not RTX-only, not NGX,
 * and not Streamline. No vendor weights or DLLs are loaded.
 *
 * POWER BI MAPPING: none
 */

import * as THREE from "../../../vendor/three.module.js";
import {
  TsrUpscaler,
  TSR_MODES,
  TSR_DEFAULT_MODE,
  TSR_STORAGE_KEY,
  TSR_USER_CHOICE_KEY,
  TSR_VELOCITY_LAYER,
  persistTsrMode,
  parseTsrParams,
} from "../tsr-upscaler.js?v=924";
import {
  createReconstruct,
  persistReconEnabled,
  parseReconParams,
  reconHalfFloatOk,
  RECON_WEIGHTS,
  RECON_BUDGET_MS,
  GUIDED_RECON_BUDGET_MS,
  RECON_FLAG,
  RECON_STORAGE_KEY,
} from "../neural-reconstruct.js?v=5";

export {
  TsrUpscaler,
  TSR_MODES,
  TSR_DEFAULT_MODE,
  TSR_STORAGE_KEY,
  TSR_USER_CHOICE_KEY,
  TSR_VELOCITY_LAYER,
  persistTsrMode,
  parseTsrParams,
  createReconstruct,
  persistReconEnabled,
  parseReconParams,
  reconHalfFloatOk,
  RECON_WEIGHTS,
  RECON_BUDGET_MS,
  GUIDED_RECON_BUDGET_MS,
  RECON_FLAG,
  RECON_STORAGE_KEY,
};

/** Modes the factory accepts. Same ids as TsrUpscaler / Pause IMAGE. */
export const BROWSER_RECONSTRUCT_MODES = TSR_MODES;

/**
 * Build a reconstruct handle around the existing upscaler + residual.
 * Default mode is whatever TsrUpscaler ships (currently "quality").
 * `guided` is opt-in for hosts;
 * when true the residual pass is created (enabled until the host flips it).
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {{
 *   mode?: 'off'|'dlaa'|'quality'|'balanced'|'performance',
 *   guided?: boolean,
 *   debug?: Iterable<string>,
 *   recon?: { gain?: number }
 * }} [opts]
 * @returns {BrowserReconstruct}
 */
export function createBrowserReconstruct(renderer, opts = {}) {
  const mode = opts.mode != null ? opts.mode : TSR_DEFAULT_MODE;
  const guided = !!opts.guided;
  const tsrOpts = { mode, debug: opts.debug };
  const tsr = typeof TsrUpscaler === "function"
    ? new TsrUpscaler(renderer, tsrOpts)
    : null;

  let recon = null;
  if (guided && typeof createReconstruct === "function") {
    try {
      recon = createReconstruct(renderer, opts.recon || {});
    } catch {
      recon = null;
    }
  }

  let reconRT = null;
  const drawSize = new THREE.Vector2();
  let pendingW = 0;
  let pendingH = 0;
  let measureNext = false;

  /**
   * @param {number} w
   * @param {number} h
   */
  function ensureOutput(w, h) {
    const rw = Math.max(1, Math.floor(w));
    const rh = Math.max(1, Math.floor(h));
    if (reconRT && reconRT.width === rw && reconRT.height === rh) return;
    if (reconRT) {
      reconRT.dispose();
      reconRT = null;
    }
    const half = !!(recon && recon.supported);
    reconRT = new THREE.WebGLRenderTarget(rw, rh, {
      type: half ? THREE.HalfFloatType : THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.LinearSRGBColorSpace,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
  }

  /**
   * Tap TSR's resolved colour, run the residual, hand the texel back to
   * the present quad so the host's post stack still owns bloom / AO / grade.
   * @param {THREE.Camera} [camera]
   */
  function applyGuided(camera) {
    if (!recon || !recon.enabled || !tsr || !tsr.presentMaterial) return;
    const u = tsr.presentMaterial.uniforms;
    const srcTex = u && u.tResolved ? u.tResolved.value : null;
    if (!srcTex || !renderer) return;
    renderer.getDrawingBufferSize(drawSize);
    const w = pendingW || drawSize.x;
    const h = pendingH || drawSize.y;
    recon.setSize(w, h);
    ensureOutput(w, h);
    if (!reconRT) return;
    const guide = {
      depth: u.tDepth ? u.tDepth.value : undefined,
      velocity: tsr.velocityTexture || undefined,
      depthWidth: tsr.stats ? tsr.stats.lowW : 0,
      depthHeight: tsr.stats ? tsr.stats.lowH : 0,
      jitter: u.uJitter ? u.uJitter.value : null,
      near: camera && camera.near != null ? camera.near : 0.18,
      far: camera && camera.far != null ? camera.far : 1400,
    };
    if (measureNext && typeof recon.measure === "function") {
      recon.measure(srcTex, reconRT, guide);
      measureNext = false;
    } else {
      recon.render(srcTex, reconRT, guide);
    }
    u.tResolved.value = reconRT.texture;
  }

  /**
   * Keep TSR present RCAS off while the residual already sharpened.
   */
  function syncPresentSharp() {
    if (tsr && "skipPresentSharp" in tsr) {
      tsr.skipPresentSharp = !!(recon && recon.enabled);
    }
  }

  syncPresentSharp();

  const api = {
    /** Inner TsrUpscaler — do not rewrite; hosts may read stats / debug. */
    tsr,
    /** Inner createReconstruct handle, or null when guided was false. */
    recon,
    /** Alias used by RallyGame (`this.recon = sdk.guided`). */
    guided: recon,
    renderer,
    supported: !!(tsr && tsr.supported),
    get mode() {
      return tsr ? tsr.mode : "off";
    },
    get active() {
      return !!(tsr && tsr.active);
    },
    get presentScene() {
      return tsr ? tsr.presentScene : null;
    },
    get presentMaterial() {
      return tsr ? tsr.presentMaterial : null;
    },
    get stats() {
      return tsr ? tsr.stats : null;
    },
    get debug() {
      return tsr ? tsr.debug : null;
    },
    get skipPresentSharp() {
      return !!(tsr && tsr.skipPresentSharp);
    },
    set skipPresentSharp(v) {
      if (tsr) tsr.skipPresentSharp = !!v;
    },
    /** Guided residual target after render, or null. */
    get outputTarget() {
      return reconRT;
    },
    /**
     * @param {'off'|'dlaa'|'quality'|'balanced'|'performance'} next
     */
    setMode(next) {
      if (!tsr) return;
      if (typeof tsr.setMode === "function") tsr.setMode(next);
    },
    /**
     * Hint output size. TSR still sizes from the drawing buffer on render
     * unless a sibling added TsrUpscaler.setSize — we call that if present.
     * @param {number} w
     * @param {number} h
     */
    setSize(w, h) {
      pendingW = Math.max(1, Math.floor(w));
      pendingH = Math.max(1, Math.floor(h));
      if (recon && typeof recon.setSize === "function") recon.setSize(pendingW, pendingH);
      if (tsr && typeof tsr.setSize === "function") tsr.setSize(pendingW, pendingH);
    },
    /**
     * Optional explicit dynamic-root list (player + rivals).
     * @param {Array<any>} roots
     */
    setDynamicRoots(roots) {
      if (tsr && typeof tsr.setDynamicRoots === "function") tsr.setDynamicRoots(roots);
    },
    /**
     * Render the scene through TSR, then the guided residual when enabled.
     * Afterwards present `presentScene` (or read `outputTarget`).
     * @param {THREE.Scene} scene
     * @param {THREE.Camera} camera
     * @param {{ dynamicRoots?: Array<any>, measure?: boolean, measureGuided?: boolean }} [frameOpts]
     */
    render(scene, camera, frameOpts) {
      if (!tsr || !scene || !camera) return;
      const roots = frameOpts && frameOpts.dynamicRoots;
      if (roots && typeof tsr.setDynamicRoots === "function") tsr.setDynamicRoots(roots);
      if (frameOpts && (frameOpts.measure || frameOpts.measureGuided)) measureNext = true;
      syncPresentSharp();
      tsr.render(scene, camera);
      if (recon && recon.enabled && tsr.active) applyGuided(camera);
    },
    /**
     * Run the residual only (already resolved TSR). Used by RallyGame._applyReconToTsr.
     * @param {{ camera?: THREE.Camera, measure?: boolean }} [opts]
     */
    applyGuided(opts) {
      if (opts && opts.measure) measureNext = true;
      applyGuided(opts && opts.camera);
    },
    /** Drop temporal history — call on spawn / reset / lap / camera cuts. */
    reset() {
      if (tsr && typeof tsr.reset === "function") tsr.reset();
    },
    dispose() {
      if (tsr && typeof tsr.dispose === "function") tsr.dispose();
      if (recon && typeof recon.dispose === "function") recon.dispose();
      if (reconRT) {
        reconRT.dispose();
        reconRT = null;
      }
    },
  };

  return api;
}

/**
 * @typedef {ReturnType<typeof createBrowserReconstruct>} BrowserReconstruct
 */
