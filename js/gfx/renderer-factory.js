/**
 * Renderer factory — WebGPU-ready with WebGL production path (Phase R).
 *
 * WHO THIS IS FOR: RallyGame boot.
 * WHAT IT DOES: Creates WebGLRenderer from three.module.js (r160) by default.
 *   If a future THREE build exports WebGPURenderer (vendor/three.webgpu.js cutover),
 *   prefers it with WebGL2 backend unless ?webgpu=native. Patches shadowMap /
 *   capabilities so existing game code keeps working.
 * HOW IT CONNECTS: async createGameRenderer() from _initRenderer; sets RENDER_CAPS.
 *
 * POWER BI MAPPING: none
 */

import * as THREE from "../../vendor/three.module.js";
import { probeCapabilities, publishRenderCaps } from "./capabilities.js?v=1";
import { setRenderCaps } from "./render-caps.js?v=1";

/**
 * Patch WebGPURenderer so existing game code (shadowMap.needsUpdate, capabilities)
 * does not throw. Shadow cadence hints are best-effort on the new Renderer API.
 * @param {object} renderer
 */
function patchRendererCompat(renderer) {
  if (!renderer) return;
  const sm = renderer.shadowMap;
  if (sm) {
    if (sm.autoUpdate === undefined) sm.autoUpdate = false;
    if (sm.needsUpdate === undefined) {
      let needs = false;
      Object.defineProperty(sm, "needsUpdate", {
        get() {
          return needs;
        },
        set(v) {
          needs = !!v;
        },
        configurable: true,
      });
    }
  }
  if (!renderer.capabilities) {
    renderer.capabilities = {
      getMaxAnisotropy: () =>
        typeof renderer.getMaxAnisotropy === "function" ? renderer.getMaxAnisotropy() : 1,
    };
  }
  if (typeof renderer.compileAsync === "function") {
    const compileAsync = renderer.compileAsync.bind(renderer);
    renderer.compile = (scene, camera) => {
      const p = compileAsync(scene, camera);
      if (p && typeof p.then === "function") p.catch(() => {});
      return p;
    };
  }
}

/**
 * @param {object} renderer
 * @returns {boolean}
 */
function isNativeWebGPU(renderer) {
  return !!(renderer && renderer.backend && renderer.backend.isWebGPUBackend);
}

/**
 * @param {{
 *   antialias?: boolean,
 *   alpha?: boolean,
 *   powerPreference?: string,
 * }} [opts]
 * @returns {Promise<{
 *   renderer: object,
 *   api: string,
 *   glslCustom: boolean,
 *   isWebGPURenderer: boolean,
 *   fallbackReason: string,
 * }>}
 */
export async function createGameRenderer(opts = {}) {
  const caps = probeCapabilities();
  const antialias = opts.antialias !== false;
  const alpha = opts.alpha === true;
  const powerPreference = opts.powerPreference || "high-performance";
  const revision = String(THREE.REVISION || "");

  /** @type {object|null} */
  let renderer = null;
  let api = "webgl";
  let glslCustom = true;
  let isWebGPURenderer = false;
  let fallbackReason = "";

  const CanWebGPU = typeof THREE.WebGPURenderer === "function";

  const wantNative =
    !caps.forceWebGL &&
    typeof location !== "undefined" &&
    /[?&]webgpu=native(?:&|$)/.test(location.search);

  // Prefer WebGPURenderer when present on the THREE build AND caps allow it.
  // On three.module.js (r160) WebGPURenderer is absent → classic WebGLRenderer.
  if (CanWebGPU && (caps.preferWebGPU || !THREE.WebGLRenderer)) {
    try {
      // Prefer WebGPURenderer always on the webgpu build.
      // Default backend = WebGL2 until TSL ports unlock ?webgpu=native.
      const forceWebGL = !!caps.forceWebGL || !wantNative;
      renderer = new THREE.WebGPURenderer({
        antialias,
        alpha,
        powerPreference,
        forceWebGL,
      });
      await renderer.init();
      isWebGPURenderer = true;
      patchRendererCompat(renderer);

      if (isNativeWebGPU(renderer)) {
        api = "webgpu";
        glslCustom = false;
        fallbackReason = "";
      } else {
        api = "webgl2";
        glslCustom = true;
        fallbackReason = forceWebGL
          ? wantNative
            ? "forceWebGL"
            : "glsl-stacks"
          : "webgpu-unavailable";
      }
    } catch (err) {
      console.warn("WebGPURenderer init failed — WebGL fallback", err);
      fallbackReason = "webgpu-init-failed";
      try {
        if (renderer && typeof renderer.dispose === "function") renderer.dispose();
      } catch {
        /* ignore */
      }
      renderer = null;
    }
  }

  if (!renderer && CanWebGPU) {
    try {
      renderer = new THREE.WebGPURenderer({
        antialias,
        alpha,
        powerPreference,
        forceWebGL: true,
      });
      await renderer.init();
      isWebGPURenderer = true;
      api = "webgl2";
      glslCustom = true;
      if (!fallbackReason) fallbackReason = "webgl2-backend";
      patchRendererCompat(renderer);
    } catch (err) {
      console.warn("WebGPURenderer WebGL2 backend failed", err);
      try {
        if (renderer && typeof renderer.dispose === "function") renderer.dispose();
      } catch {
        /* ignore */
      }
      renderer = null;
      fallbackReason = "webgpu-webgl2-failed";
    }
  }

  if (!renderer && typeof THREE.WebGLRenderer === "function") {
    renderer = new THREE.WebGLRenderer({
      antialias,
      alpha,
      powerPreference,
    });
    api = "webgl";
    glslCustom = true;
    isWebGPURenderer = false;
    if (!fallbackReason) fallbackReason = CanWebGPU ? "webgl-renderer" : "legacy-three";
  }

  if (!renderer) {
    throw new Error("No usable Three.js renderer (WebGPU/WebGL)");
  }

  setRenderCaps({
    api,
    glslCustom,
    isWebGPURenderer,
    threeRevision: revision,
    fallbackReason,
  });

  const info = {
    api,
    glslCustom,
    isWebGPURenderer,
    threeRevision: revision,
    fallbackReason,
    preferWebGPU: caps.preferWebGPU,
    webgpu: caps.webgpu,
  };
  publishRenderCaps(info);
  try {
    console.info(
      `[Phase R] renderer=${api} three=r${revision} glsl=${glslCustom}` +
        (fallbackReason ? ` (${fallbackReason})` : "")
    );
  } catch {
    /* ignore */
  }

  return { renderer, api, glslCustom, isWebGPURenderer, fallbackReason };
}
