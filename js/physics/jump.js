/**
 * Jump technique — the Fujimoto model.
 *
 * WHO THIS IS FOR: anyone tuning how crests reward or punish the player.
 * WHAT IT DOES: watches what the driver did in the last fraction of a second
 *   before the lip, decides how hard the car is thrown, controls the chassis
 *   attitude in the air, and grades the landing. A car whose belly is pitched
 *   to match its descent path lands on all four wheels and keeps its speed. A
 *   nose-high car floats further, lands tail-first, scrubs, and stays
 *   unsettled into the next crest.
 * HOW IT CONNECTS: one instance per Vehicle. Vehicle calls ground() while the
 *   tires are down, launch() at takeoff, air() every airborne step, land() on
 *   touchdown, and settle() every step to bleed the unsettled pool.
 *
 * Sourced intent (docs/AM3-RESEARCH.md §2): the Saturn version was advised by
 * real Safari rally driver Yoshio Fujimoto, specifically on jump technique —
 * lift off just before the crest, brake so the nose drops, land flat.
 * Flat-out jumping is dangerous. Jumps come in sequences that leave the car
 * progressively more off-balance.
 *
 * SIGN CONVENTION: everything here is in aero terms, + = NOSE UP. The renderer
 * wants Three.js Rx where + = nose down, so Vehicle negates noseUp for display.
 */

import { JUMP } from "../config.js?v=122";

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export class JumpModel {
  constructor() {
    this.reset();
  }

  reset() {
    const aiScale = this.aiHeightScale != null ? this.aiHeightScale : 1;
    /** 0..1 smoothed "did the driver lift and brake into the lip" score. */
    this.technique = 0;
    /** Chassis attitude, radians, + = nose up. */
    this.noseUp = 0;
    /** Angular rate of pitch in air (rad/s, + = nose up). */
    this.noseUpRate = 0;
    /**
     * 0..1 pool of accumulated bad landings. Bleeds grip and adds yaw noise
     * so a JUMP SEQUENCE compounds where one jump forgives.
     */
    this.unsettled = 0;
    /** Grade the car left the ground on, kept for the report/debug. */
    this.launchGrade = 0;
    /** Landing grade of the last arrival, 0 = flat, 1 = fully botched. */
    this.lastLanding = 0;
    /**
     * Extra apex multiplier for AI pack (1 = player). Applied inside launch()
     * with the shared JUMP.launchHeightScale (h ∝ vy² → sqrt).
     */
    this.aiHeightScale = aiScale;
  }

  /**
   * Sample driver technique while the tires are still on the ground.
   *
   * HOW IT WORKS: full marks need BOTH a lift and some brake — a lift alone is
   * worth less than half, which is why "lift AND brake" is the taught line and
   * not just "back off". The smoothing window is short on purpose: what you did
   * a whole second ago has already faded, so the technique has to land JUST
   * before the lip the way Fujimoto described it.
   *
   * @param {number} dt seconds
   * @param {number} throttle 0..1
   * @param {number} brake 0..1
   */
  ground(dt, throttle, brake) {
    const lift = 1 - clamp(throttle, 0, 1);
    const stab = clamp(brake, 0, 1);
    const want = lift * (0.45 + 0.55 * stab);
    const k = 1 - Math.exp(-dt / Math.max(0.05, JUMP.techniqueWindow));
    this.technique += (want - this.technique) * k;
    this.noseUp = 0;
    this.noseUpRate = 0;
  }

  /**
   * Leave the ground. Returns the vertical velocity the car actually takes.
   *
   * Launch speed comes from road geometry (speed × sin grade) plus suspension
   * release. Technique trims height slightly and sets nose attitude — flat-out
   * still flies; it just floats nose-high and lands badly.
   *
   * @param {number} rawVelY vertical velocity from road + springs (m/s)
   * @param {number} grade ramp grade in radians (+ = climbing)
   * @param {number} springBoost extra m/s from compressed suspension
   */
  launch(rawVelY, grade, springBoost = 0) {
    const credit = clamp(this.technique, 0, 1);
    this.launchGrade = grade;
    // Flat-out throws higher; lift-and-brake trims height and sets a flatter nose.
    const flatBoost = JUMP.flatOutLaunchBoost != null ? JUMP.flatOutLaunchBoost : 1.12;
    let vy = Math.max(0, rawVelY + springBoost) * lerp(flatBoost, 1, credit);
    vy *= lerp(1, JUMP.liftLaunchCut, credit);
    const heightScale =
      Math.max(0.05, JUMP.launchHeightScale ?? 1) *
      Math.max(0.05, this.aiHeightScale ?? 1);
    vy *= Math.sqrt(heightScale);
    const maxVy = (JUMP.maxLaunchVy || 12) * Math.sqrt(Math.max(0.05, this.aiHeightScale ?? 1));
    vy = clamp(Math.max(0, vy), JUMP.minLaunchVy || 0, maxVy);
    this.noseUp = grade * (1 - credit * 0.9) - JUMP.liftNoseDrop * credit;
    this.noseUp = clamp(this.noseUp, -JUMP.airPitchMax, JUMP.airPitchMax);
    this.noseUpRate = (grade - this.noseUp) * 2.6;
    return vy;
  }

  /**
   * Airborne attitude control — reaction torque from spinning/braking wheels,
   * integrated with inertia so each jump feels slightly different.
   *
   * @param {number} dt
   * @param {number} throttle 0..1
   * @param {number} brake 0..1
   */
  air(dt, throttle, brake) {
    const cmd =
      clamp(throttle, 0, 1) * JUMP.airPitchUp - clamp(brake, 0, 1) * JUMP.airPitchDown;
    const torque = cmd * JUMP.airPitchRate;
    const I = Math.max(0.4, JUMP.airPitchInertia || 1.6);
    const damp = Math.max(0.5, JUMP.airPitchDamp || 2.2);
    this.noseUpRate += (torque / I) * dt;
    this.noseUpRate *= Math.exp(-damp * dt);
    this.noseUp += this.noseUpRate * dt;
    this.noseUp = clamp(this.noseUp, -JUMP.airPitchMax, JUMP.airPitchMax);
    if (Math.abs(this.noseUp) >= JUMP.airPitchMax * 0.98) {
      this.noseUpRate *= 0.35;
    }
  }

  /**
   * Gravity multiplier while airborne. A nose-high wedge at speed makes lift,
   * which is why flat-out jumps hang in the air and then arrive badly.
   * @param {number} speed m/s
   */
  gravityScale(speed) {
    const aoa = clamp(this.noseUp, 0, JUMP.airPitchMax) / JUMP.airPitchMax;
    const fast = clamp(speed / 32, 0, 1);
    return 1 - aoa * fast * JUMP.aeroFloat;
  }

  /**
   * Grade a touchdown.
   *
   * @param {number} fallSpeed vertical velocity at contact (negative = falling)
   * @param {number} speed forward speed m/s
   * @returns {{scrub:number, upsetYaw:number, upset:number}}
   */
  land(fallSpeed, speed) {
    const path = Math.atan2(fallSpeed, Math.max(6, speed));
    const mismatch = Math.abs(this.noseUp - path);
    const bad = clamp(mismatch / Math.max(0.05, JUMP.mismatchFull), 0, 1);
    const impact = clamp(Math.max(0, -fallSpeed) / 14, 0, 1);
    const weight = bad * (0.55 + 0.45 * impact);
    this.lastLanding = bad;
    const upset = bad * (0.5 + 0.5 * impact);
    this.unsettled = clamp(this.unsettled + upset * 0.85, 0, 1);
    this.noseUp = 0;
    this.noseUpRate = 0;
    this.technique = 0;
    return {
      scrub: lerp(JUMP.flatScrub, JUMP.worstScrub, weight),
      upsetYaw: upset * JUMP.landUpsetYaw,
      upset,
    };
  }

  /**
   * Bleed the unsettled pool. Call every step, airborne or not.
   * @param {number} dt
   */
  settle(dt) {
    if (this.unsettled <= 0) return;
    this.unsettled *= Math.exp(-dt / Math.max(0.2, JUMP.balanceDecay));
    if (this.unsettled < 0.01) this.unsettled = 0;
  }

  /** Grip multiplier from the unsettled pool: 1 when composed, less when not. */
  gripScale() {
    return 1 - this.unsettled * JUMP.balanceGripLoss;
  }
}
