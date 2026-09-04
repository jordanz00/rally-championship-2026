/**
 * Live render capability flags — set once at renderer boot (Phase R).
 *
 * WHO THIS IS FOR: postfx, effects, occlusion-fade, PerformanceMonitor.
 * WHAT IT DOES: Tells GLSL-only systems whether custom ShaderMaterials are safe.
 * HOW IT CONNECTS: renderer-factory writes; consumers read before allocating GLSL.
 *
 * POWER BI MAPPING: none
 */

/** @type {{
 *   api: string,
 *   glslCustom: boolean,
 *   isWebGPURenderer: boolean,
 *   threeRevision: string,
 *   fallbackReason: string,
 * }} */
export const RENDER_CAPS = {
  api: "webgl",
  glslCustom: true,
  isWebGPURenderer: false,
  threeRevision: "",
  fallbackReason: "",
};

/**
 * @param {Partial<typeof RENDER_CAPS>} next
 */
export function setRenderCaps(next) {
  Object.assign(RENDER_CAPS, next);
}
