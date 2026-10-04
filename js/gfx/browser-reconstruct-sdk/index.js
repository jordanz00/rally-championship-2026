/**
 * WebTSR SDK — MIT temporal SR + guided residual + appearance for Three r160 WebGL2.
 *
 * WHO THIS IS FOR: this rally title and any other Three.js WebGL2 game.
 * WHAT IT DOES: wraps TsrUpscaler + guided residual + optional appearance
 *   net. Does not rewrite those modules. Public factories:
 *   createWebTsr(renderer, { mode, guided, appearance })
 *   createBrowserReconstruct(...) — same handle, older name.
 * HOW IT CONNECTS: re-exports tsr-upscaler.js, neural-reconstruct.js,
 *   appearance-net.js. RallyGame constructs through createWebTsr.
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
  TSR_HISTORY_SAMPLES,
  TSR_VEL_CLAMP_SAMPLES,
  TSR_RESURRECT_INTERVAL,
  NORMAL_BUDGET_MS,
} from "../tsr-upscaler.js?v=981";
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
import {
  createAppearance,
  parseAppearParams,
  persistAppearEnabled,
  APPEAR_FLAG,
  APPEAR_STORAGE_KEY,
  APPEAR_BUDGET_MS,
  APPEAR_LUMA_HEADROOM,
  APPEAR_DEFAULT,
} from "../appearance-net.js?v=981";
import {
  createMobilePresent,
} from "../mobile-present.js?v=981";
import {
  wantsHeavyWebTsr,
  wantsMobilePresent,
  wantsAppearanceHandle,
  isPhonePresentBudget,
} from "../tsr-policy.js?v=981";

export {
  TsrUpscaler,
  TSR_MODES,
  TSR_DEFAULT_MODE,
  TSR_STORAGE_KEY,
  TSR_USER_CHOICE_KEY,
  TSR_VELOCITY_LAYER,
  persistTsrMode,
  parseTsrParams,
  TSR_HISTORY_SAMPLES,
  TSR_VEL_CLAMP_SAMPLES,
  TSR_RESURRECT_INTERVAL,
  NORMAL_BUDGET_MS,
  createReconstruct,
  persistReconEnabled,
  parseReconParams,
  reconHalfFloatOk,
  RECON_WEIGHTS,
  RECON_BUDGET_MS,
  GUIDED_RECON_BUDGET_MS,
  RECON_FLAG,
  RECON_STORAGE_KEY,
  createAppearance,
  parseAppearParams,
  persistAppearEnabled,
  APPEAR_FLAG,
  APPEAR_STORAGE_KEY,
  APPEAR_BUDGET_MS,
  APPEAR_LUMA_HEADROOM,
  APPEAR_DEFAULT,
  createMobilePresent,
  wantsHeavyWebTsr,
  wantsMobilePresent,
  wantsAppearanceHandle,
  isPhonePresentBudget,
};

/** Modes the factory accepts. Same ids as TsrUpscaler / Pause IMAGE. */
export const BROWSER_RECONSTRUCT_MODES = TSR_MODES;
export const WEBTSR_MODES = TSR_MODES;

/**
 * Suite contract for hosts and QA. No frame generation. presentScene stays
 * the present hook. Appearance is an opt-in residual, default off in-game.
 */
export const WEBTSR_SUITE = {
  name: "WebTSR",
  presentScene: true,
  appearance: true,
  guided: true,
  frameGeneration: false,
  vendor: "original-mit",
  appearDefault: APPEAR_DEFAULT,
  normalBudgetMs: NORMAL_BUDGET_MS,
  mobilePresent: true,
  webgpuRequired: false,
};

/**
 * Build a WebTSR handle around the existing upscaler + residual + appearance.
 * Default mode is whatever TsrUpscaler ships (currently "quality").
 * `guided` and `appearance` are opt-in for hosts.
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {{
 *   mode?: 'off'|'dlaa'|'quality'|'balanced'|'performance',
 *   guided?: boolean,
 *   appearance?: boolean,
 *   debug?: Iterable<string>,
 *   recon?: { gain?: number },
 *   appear?: { gain?: number },
 *   writeNormals?: boolean
 * }} [opts]
 * @returns {WebTsr}
 */
export function createWebTsr(renderer, opts = {}) {
  return createBrowserReconstruct(renderer, opts);
}

/**
 * Older factory name — same handle as createWebTsr.
 * @param {THREE.WebGLRenderer} renderer
 * @param {Parameters<typeof createWebTsr>[1]} [opts]
 * @returns {WebTsr}
 */
export function createBrowserReconstruct(renderer, opts = {}) {
  const mode = opts.mode != null ? opts.mode : TSR_DEFAULT_MODE;
  const guided = !!opts.guided;
  const wantAppear = !!opts.appearance;
  const tsrOpts = { mode, debug: opts.debug, writeNormals: opts.writeNormals === true };
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

  let appear = null;
  if (wantAppear && typeof createAppearance === "function") {
    try {
      appear = createAppearance(renderer, opts.appear || {});
    } catch {
      appear = null;
    }
  }

  let reconRT = null;
  let appearRT = null;
  const drawSize = new THREE.Vector2();
  let pendingW = 0;
  let pendingH = 0;
  let measureNext = false;

  /**
   * @param {number} w
   * @param {number} h
   * @param {boolean} half
   * @returns {THREE.WebGLRenderTarget}
   */
  function makeRT(w, h, half) {
    return new THREE.WebGLRenderTarget(Math.max(1, Math.floor(w)), Math.max(1, Math.floor(h)), {
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
   * @param {THREE.WebGLRenderTarget|null} rt
   * @param {number} w
   * @param {number} h
   * @param {boolean} half
   * @returns {THREE.WebGLRenderTarget}
   */
  function ensureRT(rt, w, h, half) {
    const rw = Math.max(1, Math.floor(w));
    const rh = Math.max(1, Math.floor(h));
    if (rt && rt.width === rw && rt.height === rh) return rt;
    if (rt) rt.dispose();
    return makeRT(rw, rh, half);
  }

  /**
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
    reconRT = ensureRT(reconRT, w, h, !!(recon && recon.supported));
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
   * Appearance residual after TSR (+ guided). Writes back onto the present quad.
   * @param {THREE.Camera} [camera]
   */
  function applyAppearance(camera) {
    if (!appear || !appear.enabled || !tsr || !tsr.presentMaterial) return;
    const u = tsr.presentMaterial.uniforms;
    const srcTex = u && u.tResolved ? u.tResolved.value : null;
    if (!srcTex || !renderer) return;
    renderer.getDrawingBufferSize(drawSize);
    const w = pendingW || drawSize.x;
    const h = pendingH || drawSize.y;
    appear.setSize(w, h);
    appearRT = ensureRT(appearRT, w, h, true);
    if (!appearRT) return;
    const guide = {
      depth: u.tDepth ? u.tDepth.value : undefined,
      normal: tsr.normalTexture || undefined,
      velocity: tsr.velocityTexture || undefined,
      depthWidth: tsr.stats ? tsr.stats.lowW : 0,
      depthHeight: tsr.stats ? tsr.stats.lowH : 0,
      near: camera && camera.near != null ? camera.near : 0.18,
      far: camera && camera.far != null ? camera.far : 1400,
    };
    appear.render(srcTex, appearRT, guide);
    u.tResolved.value = appearRT.texture;
  }

  /**
   * Keep TSR present RCAS off while residual / appearance already sharpened.
   */
  function syncPresentSharp() {
    if (tsr && "skipPresentSharp" in tsr) {
      tsr.skipPresentSharp = !!(
        (recon && recon.enabled) ||
        (appear && appear.enabled)
      );
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
    /** Inner appearance net, or null when appearance was false. */
    appear,
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
    get writeNormals() {
      return !!(tsr && tsr.writeNormals);
    },
    get normalsAborted() {
      return !!(tsr && tsr._normalsAborted);
    },
    /** Last residual / appearance target after render, or null. */
    get outputTarget() {
      return appearRT || reconRT;
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
      if (appear && typeof appear.setSize === "function") appear.setSize(pendingW, pendingH);
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
     * Render the scene through TSR, then guided + appearance when enabled.
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
      if (tsr && !tsr._normalsAborted) {
        tsr.writeNormals = !!(appear && appear.enabled);
      }
      tsr.render(scene, camera);
      if (recon && recon.enabled && tsr.active) applyGuided(camera);
      if (appear && appear.enabled && tsr.active) applyAppearance(camera);
    },
    /**
     * Run the residual only (already resolved TSR). Used by RallyGame._applyReconToTsr.
     * @param {{ camera?: THREE.Camera, measure?: boolean }} [opts]
     */
    applyGuided(opts) {
      if (opts && opts.measure) measureNext = true;
      applyGuided(opts && opts.camera);
    },
    /**
     * Run appearance only (already resolved TSR / residual).
     * @param {{ camera?: THREE.Camera }} [opts]
     */
    applyAppearance(opts) {
      applyAppearance(opts && opts.camera);
    },
    /** Drop temporal history — call on spawn / reset / lap / camera cuts. */
    reset() {
      if (tsr && typeof tsr.reset === "function") tsr.reset();
      if (appear && typeof appear.reset === "function") appear.reset();
    },
    dispose() {
      if (tsr && typeof tsr.dispose === "function") tsr.dispose();
      if (recon && typeof recon.dispose === "function") recon.dispose();
      if (appear && typeof appear.dispose === "function") appear.dispose();
      if (reconRT) {
        reconRT.dispose();
        reconRT = null;
      }
      if (appearRT) {
        appearRT.dispose();
        appearRT = null;
      }
    },
  };

  return api;
}

/**
 * @typedef {ReturnType<typeof createBrowserReconstruct>} WebTsr
 * @typedef {WebTsr} BrowserReconstruct
 */
