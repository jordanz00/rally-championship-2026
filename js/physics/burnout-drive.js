/**
 * Burnout-rally drive overlay — fun accel, controllable dirt.
 *
 * WHO THIS IS FOR: vehicle.js (player + AI share HANDLING).
 * WHAT IT DOES: Launch/exit punch stays arcade; slide initiation and rack
 *   snap are dialed for road-holding (player feedback 2026-10-29).
 * HOW IT CONNECTS: docs/SEGA_RALLY_DRIVING_MODEL.md · BURNOUT_RALLY_DIRECTION.md
 */

/**
 * @param {object} H HANDLING
 * @param {object} [A] ARCADE_ASSIST
 */
export function applyBurnoutDriveTuning(H, A) {
  if (!H || H._burnoutDriveV9) return;
  H._burnoutDrive = true;
  H._burnoutDriveV2 = true;
  H._burnoutDriveV3 = true;
  H._burnoutDriveV4 = true;
  H._burnoutDriveV5 = true;
  H._burnoutDriveV6 = true;
  H._burnoutDriveV7 = true;
  H._burnoutDriveV8 = true;
  H._burnoutDriveV9 = true;
  H.easySlide = true;
  // Pendulum L↔R — keep attitude, but do not whip through center.
  H.driftSwingSteerMul = 1.28;
  H.driftSwingVyKeep = 0.72;
  // Hard-steer slide needs real commit — was lighting at parking-lot speeds.
  H.easySlideHardSteer = 0.42;
  H.easySlideHardSteerLoose = 0.28;
  H.easySlideHardSpeed = 16;
  H.easySlideTarmacSteer = 0.22;
  H.easySlideTarmacThrottle = 0.35;
  H.easySlideTarmacSpeed = 14;
  // Launch punch — keep the fun GO snap.
  if (H.launchBoost < 1.85) H.launchBoost = 1.9;
  if (H.launchBoost > 2.05) H.launchBoost = 1.95;
  if (H.launchFadeKmh < 118) H.launchFadeKmh = 118;
  if (H.launchFadeKmh > 140) H.launchFadeKmh = 128;
  // Exit boost still pays a clean catch — slightly softer so runoff stays rare.
  H.slideExitBoost = 2.05;
  if (H.slideExitFadeKmh < 210) H.slideExitFadeKmh = 210;
  H.slideDriveKeep = 1.35;
  H.slideSpeedConvert = 1.28;
  if (H.slideAeroCut == null || H.slideAeroCut > 0.12) H.slideAeroCut = 0.12;
  // Power + steer pitch-in — was 4.85 and threw the car sideways on every corner.
  H.powerSlidePitch = 1.85;
  H.maxSlideVel = 16;
  H.maxSlideVelHandbrake = 22;
  // Bleed lateral slip faster so the car settles on the ribbon.
  H.driftBleedMul = 0.014;
  H.outrunHang = 0.48;
  H.counterAuthority = 2.85;
  // Mild bicycle push at speed — was near-zero and felt like a hovercraft.
  H.speedUndersteer = 0.0024;
  H.yawAssistBoost = 0.92;
  H.handbrakeYawKick = 2.15;
  H.handbrakePowerMul = 1.85;
  H.throttleSlide = 1.65;
  if (A) {
    // Do not force hyper turn-in; play-options Easy may still raise these.
    if (A.yawAssist == null || A.yawAssist > 0.55) A.yawAssist = 0.4;
    if (A.recoveryAssist == null || A.recoveryAssist < 1.35) A.recoveryAssist = 1.45;
    if (A.tireSlideSoft == null || A.tireSlideSoft > 3.6) A.tireSlideSoft = 3.2;
    if (A.driftStability == null || A.driftStability < 0.82) A.driftStability = 0.88;
    if (A.recoverableSlide == null || A.recoverableSlide < 12) A.recoverableSlide = 12;
  }
}

/** Rack into lock — was 1.92 (hairpin whip); slower for road control. */
export const BURNOUT_STEER_SNAP = 1.12;

/** Extra rack when swinging lock→lock mid-slide. */
export const DRIFT_SWING_STEER = 1.22;

/**
 * @param {number} heat 0–1
 * @param {number} [fire] 0–1 On Fire
 * @returns {number}
 */
export function rushTorqueMul(heat, fire = 0) {
  const h = heat > 0 ? (heat < 1 ? heat : 1) : 0;
  const f = fire > 0 ? (fire < 1 ? fire : 1) : 0;
  return 1 + h * 0.48 + f * 0.22;
}
