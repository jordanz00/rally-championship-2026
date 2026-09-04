/**
 * CameraSpring — critically-damped spring helpers for chase camera (Phase 1).
 *
 * WHO THIS IS FOR: game.js chase camera.
 * WHAT IT DOES: position / look / scalar springs without per-frame allocation.
 * HOW IT CONNECTS: RallyGame owns instances; _chaseCam steps them each present.
 *
 * POWER BI MAPPING: none
 */

import * as THREE from "../../vendor/three.module.js";

/**
 * 1D spring-damper. Prefer over raw exp lerp when velocity continuity matters
 * (FOV, pitch bias, roll lean).
 */
export class Spring1 {
  constructor(x = 0) {
    this.x = x;
    this.v = 0;
  }

  /**
   * @param {number} target
   * @param {number} dt
   * @param {number} stiffness  ω²-ish (higher = snappier)
   * @param {number} damping    2ζω-ish
   * @returns {number}
   */
  step(target, dt, stiffness, damping) {
    if (!(dt > 0)) return this.x;
    const a = (target - this.x) * stiffness - this.v * damping;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }

  /** @param {number} x */
  snap(x) {
    this.x = x;
    this.v = 0;
  }
}

/**
 * 3D spring-damper for camera position / look-at.
 */
export class Spring3 {
  constructor() {
    this.x = new THREE.Vector3();
    this.v = new THREE.Vector3();
    this._force = new THREE.Vector3();
  }

  /**
   * @param {THREE.Vector3} target
   * @param {number} dt
   * @param {number} stiffness
   * @param {number} damping
   * @returns {THREE.Vector3}
   */
  step(target, dt, stiffness, damping) {
    if (!(dt > 0)) return this.x;
    this._force.copy(target).sub(this.x).multiplyScalar(stiffness);
    this._force.addScaledVector(this.v, -damping);
    this.v.addScaledVector(this._force, dt);
    this.x.addScaledVector(this.v, dt);
    return this.x;
  }

  /**
   * Step with different stiffness on Y vs XZ (chase height softer than plan).
   * @param {THREE.Vector3} target
   * @param {number} dt
   * @param {number} stiffXZ
   * @param {number} dampXZ
   * @param {number} stiffY
   * @param {number} dampY
   */
  stepAniso(target, dt, stiffXZ, dampXZ, stiffY, dampY) {
    if (!(dt > 0)) return this.x;
    const fx = (target.x - this.x.x) * stiffXZ - this.v.x * dampXZ;
    const fz = (target.z - this.x.z) * stiffXZ - this.v.z * dampXZ;
    const fy = (target.y - this.x.y) * stiffY - this.v.y * dampY;
    this.v.x += fx * dt;
    this.v.y += fy * dt;
    this.v.z += fz * dt;
    this.x.x += this.v.x * dt;
    this.x.y += this.v.y * dt;
    this.x.z += this.v.z * dt;
    return this.x;
  }

  /** @param {THREE.Vector3} v */
  snap(v) {
    this.x.copy(v);
    this.v.set(0, 0, 0);
  }
}

/**
 * Critically-damped-ish damping from stiffness (ζ≈1).
 * @param {number} stiffness
 * @returns {number}
 */
export function criticalDamp(stiffness) {
  return 2 * Math.sqrt(Math.max(1e-6, stiffness));
}
