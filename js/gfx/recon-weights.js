/**
 * Hand-authored 3×3 residual kernels — legal spatial reconstruct.
 *
 * WHO THIS IS FOR: js/gfx/neural-reconstruct.js (and the tools/neural harness).
 * WHAT IT DOES: tiny float tables for an RCAS + EASU-style 3×3 pass. No
 *   training, no download, no NVIDIA / NGX / Streamline / leaked weights.
 * HOW IT CONNECTS: imported by createReconstruct; uploaded as 9-float uniforms.
 *
 * MIT, in-repo. Keep this file under 20 KB.
 *
 * POWER BI MAPPING: none
 */

/**
 * Row-major 3×3. Residual is `sum(k[i] * sample[i])` then added to the
 * reconstructed centre. Each kernel is a directional Laplacian (sums to 0)
 * so flat regions stay put and only contrast along that axis is restored.
 *
 *   H  — edge runs left/right, restore vertical contrast
 *   V  — edge runs up/down, restore horizontal contrast
 *   D1 — edge runs top-left → bottom-right
 *   D2 — edge runs top-right → bottom-left
 *
 * Corners stay 0 on the axis kernels so a 3×3 fetch never smears a
 * diagonal neighbour across a hard axis edge (the halo case).
 */
const DIR_H = new Float32Array([
  0.00, -0.50,  0.00,
  0.00,  1.00,  0.00,
  0.00, -0.50,  0.00,
]);

const DIR_V = new Float32Array([
  0.00,  0.00,  0.00,
 -0.50,  1.00, -0.50,
  0.00,  0.00,  0.00,
]);

const DIR_D1 = new Float32Array([
 -0.50,  0.00,  0.00,
  0.00,  1.00,  0.00,
  0.00,  0.00, -0.50,
]);

const DIR_D2 = new Float32Array([
  0.00,  0.00, -0.50,
  0.00,  1.00,  0.00,
 -0.50,  0.00,  0.00,
]);

/**
 * Isotropic 3×3 high-pass used only as a tiny mix-in on weak edges
 * (where the directional pick is unstable). Same halo rule: sums to 0.
 */
const ISO = new Float32Array([
 -0.05, -0.10, -0.05,
 -0.10,  0.60, -0.10,
 -0.05, -0.10, -0.05,
]);

export const RECON_WEIGHTS = Object.freeze({
  version: 3,
  license: "MIT",
  origin: "hand-authored 2026-10-04 — not NVIDIA, not FidelityFX source dump",
  /** Residual gain after the edge gate. v3 reads at chase distance. */
  gain: 0.26,
  /** Luma contrast below this (soft knee) kills the residual. */
  edgeKnee: 0.024,
  /** RCAS-style lobe scale 0..1 (0.25 ≈ a light present sharpen). */
  rcasSharp: 0.30,
  /** Extra min/max slack. 0 = hard neighbourhood clamp (no ringing). */
  clampSlack: 0.0,
  /** Bilateral luma sigma — neighbours across a hard edge get ~0 weight. */
  rangeSigma: 0.11,
  /**
   * Depth bilateral sigma in metres. Neighbours farther than ~3σ are a
   * different surface (car vs tree) and must not feed the residual.
   */
  depthSigmaM: 0.72,
  /** Device depth at/above this is treated as sky / cleared far plane. */
  skyCut: 0.99915,
  /** Linear-Z (m) where residual starts fading so the horizon cannot ring. */
  horizonStartM: 160,
  horizonEndM: 480,
  /** Extra residual on contact-scale depth edges (wheel on road, trunk on dirt). */
  contactBoost: 0.58,
  /** Strength of the depth gate (1 = full). */
  haloGate: 1.0,
  /** Min n·n to accept a neighbour. Depth-derived normals, not a G-buffer. */
  normalGate: 0.42,
  dirH: DIR_H,
  dirV: DIR_V,
  dirD1: DIR_D1,
  dirD2: DIR_D2,
  iso: ISO,
});

/** Hard budget the colour-only harness enforces. */
export const RECON_BUDGET_MS = 0.6;

/** Guided (depth) pass cut — over this p50, leave the pass off. */
export const GUIDED_RECON_BUDGET_MS = 1.0;

/** URL flag. `?recon=0` off; default on for desktop + TSR. */
export const RECON_FLAG = "recon";

/** Pause-menu / session persistence. URL still wins. */
export const RECON_STORAGE_KEY = "rally-recon";
