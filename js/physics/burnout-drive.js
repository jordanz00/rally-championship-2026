/**
 * Burnout-rally drive overlay — easy, cool, fun.
 *
 * WHO THIS IS FOR: vehicle.js (player + AI share HANDLING).
 * WHAT IT DOES: Steer bites, slide starts on gas+steer, hang holds, exit pays.
 * HOW IT CONNECTS: docs/SEGA_RALLY_DRIVING_MODEL.md · BURNOUT_RALLY_DIRECTION.md
 */

/**
 * @param {object} H HANDLING
 * @param {object} [A] ARCADE_ASSIST
 */
export function applyBurnoutDriveTuning(H, A) {
  if (!H || H._burnoutDriveV5) return;
  H._burnoutDrive = true;
  H._burnoutDriveV2 = true;
  H._burnoutDriveV3 = true;
  H._burnoutDriveV4 = true;
  H._burnoutDriveV5 = true;
  H.easySlide = true;
  // AM3 lesson: tarmac still stops and needs more steer; mud slides first.
  if (H.easySlideTarmacSteer == null || H.easySlideTarmacSteer < 0.048) H.easySlideTarmacSteer = 0.048;
  if (H.easySlideTarmacThrottle == null || H.easySlideTarmacThrottle < 0.07) H.easySlideTarmacThrottle = 0.07;
  if (H.easySlideTarmacSpeed == null || H.easySlideTarmacSpeed < 4.8) H.easySlideTarmacSpeed = 4.8;
  if (H.launchBoost < 2.55) H.launchBoost = 2.55;
  if (H.launchFadeKmh < 155) H.launchFadeKmh = 155;
  if (H.slideExitBoost < 3.05) H.slideExitBoost = 3.05;
  if (H.slideExitFadeKmh < 255) H.slideExitFadeKmh = 255;
  if (H.slideDriveKeep < 2.15) H.slideDriveKeep = 2.15;
  if (H.slideSpeedConvert < 1.55) H.slideSpeedConvert = 1.55;
  if (H.slideAeroCut == null || H.slideAeroCut > 0.12) H.slideAeroCut = 0.12;
  if (H.powerSlidePitch < 4.15) H.powerSlidePitch = 4.15;
  if (H.maxSlideVel < 28) H.maxSlideVel = 28;
  if (H.driftBleedMul == null || H.driftBleedMul > 0.007) H.driftBleedMul = 0.007;
  if (H.outrunHang == null || H.outrunHang < 0.72) H.outrunHang = 0.72;
  if (H.counterAuthority < 4.05) H.counterAuthority = 4.05;
  if (H.speedUndersteer == null || H.speedUndersteer > 0.00115) H.speedUndersteer = 0.00115;
  if (A) {
    if (A.yawAssist < 0.58) A.yawAssist = 0.58;
    if (A.recoveryAssist < 1.58) A.recoveryAssist = 1.58;
    if (A.tireSlideSoft < 4.15) A.tireSlideSoft = 4.15;
    if (A.driftStability != null && A.driftStability < 0.42) A.driftStability = 0.42;
    if (A.recoverableSlide != null && A.recoverableSlide < 14) A.recoverableSlide = 14;
  }
}

export const BURNOUT_STEER_SNAP = 1.58;

/**
 * @param {number} heat 0–1
 * @param {number} [fire] 0–1 On Fire
 * @returns {number}
 */
export function rushTorqueMul(heat, fire = 0) {
  const h = heat > 0 ? (heat < 1 ? heat : 1) : 0;
  const f = fire > 0 ? (fire < 1 ? fire : 1) : 0;
  return 1 + h * 1.05 + f * 0.38;
}
