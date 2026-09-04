/**
 * GPU capability probe — Phase R.
 *
 * WHO THIS IS FOR: renderer-factory and PerformanceMonitor.
 * WHAT IT DOES: Detects WebGPU / WebGL2 / DPR without allocating a renderer.
 * HOW IT CONNECTS: createGameRenderer() chooses backend; QA may read window.__rallyRenderCaps.
 *
 * POWER BI MAPPING: none
 */

/**
 * @returns {{
 *   webgpu: boolean,
 *   webgl2: boolean,
 *   dpr: number,
 *   preferWebGPU: boolean,
 *   forceWebGL: boolean,
 *   legacyThree: boolean,
 *   automation: boolean,
 * }}
 */
export function probeCapabilities() {
  const q = typeof location !== "undefined" ? location.search : "";
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  const automation =
    (typeof navigator !== "undefined" && !!navigator.webdriver) ||
    /HeadlessChrome/i.test(ua);
  const legacyThree = /[?&]legacyThree=1(?:&|$)/.test(q);
  const forceWebGL =
    legacyThree ||
    /[?&]forceWebGL=1(?:&|$)/.test(q) ||
    /[?&]webgpu=0(?:&|$)/.test(q);
  const forceNative = /[?&]webgpu=native(?:&|$)/.test(q);
  const forceGpu = forceNative || /[?&]webgpu=1(?:&|$)/.test(q);
  const webgpu = !!(typeof navigator !== "undefined" && navigator.gpu);
  const webgl2 = (function () {
    try {
      const c = document.createElement("canvas");
      return !!(c.getContext("webgl2") || c.getContext("experimental-webgl2"));
    } catch {
      return false;
    }
  })();
  // Factory prefers WebGPURenderer only when the webgpu build is loaded
  // (importmap ?webgpu=1|native) or when THREE exposes WebGPURenderer alone.
  const preferWebGPU = !forceWebGL && forceGpu;
  return {
    webgpu,
    webgl2,
    dpr: (typeof window !== "undefined" && window.devicePixelRatio) || 1,
    preferWebGPU,
    forceWebGL,
    legacyThree,
    automation,
  };
}

/**
 * Publish caps for QA / debug overlays.
 * @param {object} info
 */
export function publishRenderCaps(info) {
  try {
    if (typeof window !== "undefined") window.__rallyRenderCaps = info;
  } catch {
    /* ignore */
  }
}
