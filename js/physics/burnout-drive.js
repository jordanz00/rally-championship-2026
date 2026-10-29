/**
 * Burnout-rally drive overlay — controllable dirt, learnable slides.
 *
 * WHO THIS IS FOR: vehicle.js (player + AI share HANDLING).
 * WHAT IT DOES: v10 balances v9 road-holding with Saturn attack→slide→catch.
 *   Hard-steer still needs commit; power + throttle can light the rear again.
 * HOW IT CONNECTS: docs/SEGA_RALLY_DRIVING_MODEL.md · BURNOUT_RALLY_DIRECTION.md
 */

/**
 * @param {object} H HANDLING
 * @param {object} [A] ARCADE_ASSIST
 */
export function applyBurnoutDriveTuning(H, A) {
  if (!H || H._burnoutDriveV10) return;
  H._burnoutDrive = true;
  H._burnoutDriveV2 = true;
  H._burnoutDriveV3 = true;
  H._burnoutDriveV4 = true;
  H._burnoutDriveV5 = true;
  H._burnoutDriveV6 = true;
  H._burnoutDriveV7 = true;
  H._burnoutDriveV8 = true;
  H._burnoutDriveV9 = true;
  H._burnoutDriveV10 = true;
  H.easySlide = true;
  // Pendulum L↔R — hold attitude through center without whip.
  H.driftSwingSteerMul = 1.42;
  H.driftSwingVyKeep = 0.78;
  // Initiation: commit required, but not full lock (v9 0.42 was too gated).
  H.easySlideHardSteer = 0.26;
  H.easySlideHardSteerLoose = 0.18;
  H.easySlideHardSpeed = 12;
  H.easySlideTarmacSteer = 0.16;
  H.easySlideTarmacThrottle = 0.28;
  H.easySlideTarmacSpeed = 12;
  // Launch punch — keep the fun GO snap.
  if (H.launchBoost < 1.85) H.launchBoost = 1.9;
  if (H.launchBoost > 2.05) H.launchBoost = 1.95;
  if (H.launchFadeKmh < 118) H.launchFadeKmh = 118;
  if (H.launchFadeKmh > 140) H.launchFadeKmh = 128;
  // Clean catch still pays.
  H.slideExitBoost = 2.15;
  if (H.slideExitFadeKmh < 210) H.slideExitFadeKmh = 210;
  H.slideDriveKeep = 1.45;
  H.slideSpeedConvert = 1.35;
  if (H.slideAeroCut == null || H.slideAeroCut > 0.12) H.slideAeroCut = 0.12;
  // Power slides learnable again — below the old 4.85 chaos, above 1.85 mush.
  H.powerSlidePitch = 2.55;
  H.maxSlideVel = 20;
  H.maxSlideVelHandbrake = 26;
  H.driftBleedMul = 0.011;
  H.outrunHang = 0.62;
  H.counterAuthority = 3.15;
  // Mild high-speed push — stay on ribbon without understeering every sweeper.
  H.speedUndersteer = 0.0019;
  H.yawAssistBoost = 1.0;
  H.handbrakeYawKick = 2.55;
  H.handbrakePowerMul = 2.05;
  H.throttleSlide = 1.95;
  H.trailBrakeYaw = 1.05;
  if (A) {
    if (A.yawAssist == null || A.yawAssist > 0.55) A.yawAssist = 0.48;
    if (A.recoveryAssist == null || A.recoveryAssist < 1.4) A.recoveryAssist = 1.55;
    if (A.tireSlideSoft == null || A.tireSlideSoft > 3.8) A.tireSlideSoft = 3.45;
    if (A.driftStability == null || A.driftStability < 0.78) A.driftStability = 0.84;
    if (A.recoverableSlide == null || A.recoverableSlide < 13) A.recoverableSlide = 14;
  }
}

/** Rack into lock — quicker than v9, calmer than the old 1.92 whip. */
export const BURNOUT_STEER_SNAP = 1.28;

/** Extra rack when swinging lock→lock mid-slide. */
export const DRIFT_SWING_STEER = 1.38;

/**
 * @param {number} heat 0–1
 * @param {number} [fire] 0–1 On Fire
 * @returns {number}
 */
export function rushTorqueMul(heat, fire = 0) {
  const h = heat > 0 ? (heat < 1 ? heat : 1) : 0;
  const f = fire > 0 ? (fire < 1 ? fire : 1) : 0;
  return 1 + h * 0.42 + f * 0.2;
}
