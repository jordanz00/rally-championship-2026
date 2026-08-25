/**
 * Jump technique — Fujimoto setup + RAGE-style rigid-body air.
 *
 * WHO THIS IS FOR: anyone tuning how crests reward or punish the player.
 * WHAT IT DOES: lift-and-brake sets the leave. In the air the chassis is a
 *   rigid body with inertia (pitch + roll), aero from angle of attack, and a
 *   deterministic lip grain so the same jump is never a canned hop. Landing
 *   grades the belly vs the descent path — a mismatch bounces and upsets.
 * HOW IT CONNECTS: Vehicle calls ground / launch / air / land / settle.
 *
 * SIGN CONVENTION: +noseUp is aero nose-up. The renderer uses Three.js Rx
 * (nose down), so Vehicle negates noseUp for display.
 *
 * Determinism: two identical lips fly identical. Different speed, line, or
 * pedal at the lip fly different — GTA IV/V vehicle air.
 */

import { JUMP } from "../config.js?v=138";

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Tiny lip roughness from distance + lateral. Same line = same grain.
 * @param {number} dist
 * @param {number} lat
 */
function lipGrain(dist, lat) {
  const d = Number(dist) || 0;
  const l = Number(lat) || 0;
  return Math.sin(d * 0.37 + l * 0.9) * 0.62 + Math.sin(d * 1.17 + l * 2.4) * 0.38;
}

export class JumpModel {
  constructor() {
    this.reset();
  }

  reset() {
    const aiScale = this.aiHeightScale != null ? this.aiHeightScale : 1;
    this.technique = 0;
    this.noseUp = 0;
    this.noseUpRate = 0;
    /** Air roll (rad, + = right side down). Inherited from the line at takeoff. */
    this.roll = 0;
    this.rollRate = 0;
    this.unsettled = 0;
    this.launchGrade = 0;
    this.lastLanding = 0;
    this.aiHeightScale = aiScale;
  }

  /**
   * Sample driver technique while the tires are still on the ground.
   * @param {number} dt
   * @param {number} throttle
   * @param {number} brake
   */
  ground(dt, throttle, brake) {
    const lift = 1 - clamp(throttle, 0, 1);
    const stab = clamp(brake, 0, 1);
    const want = lift * (0.45 + 0.55 * stab);
    const k = 1 - Math.exp(-dt / Math.max(0.05, JUMP.techniqueWindow));
    this.technique += (want - this.technique) * k;
    this.noseUp = 0;
    this.noseUpRate = 0;
    this.roll *= Math.exp(-8 * dt);
    this.rollRate *= Math.exp(-8 * dt);
  }

  /**
   * Leave the ground. Returns vertical velocity (m/s).
   *
   * @param {number} rawVelY
   * @param {number} grade
   * @param {number} springBoost
   * @param {{pitchRate?:number, roll?:number, rollRate?:number, yawRate?:number, lateral?:number, speed?:number, throttle?:number, brake?:number, dist?:number}} [body]
   */
  launch(rawVelY, grade, springBoost = 0, body = {}) {
    const credit = clamp(this.technique, 0, 1);
    this.launchGrade = grade;
    const grain = lipGrain(body.dist, body.lateral) * (JUMP.lipGrain != null ? JUMP.lipGrain : 0.045);
    const flatBoost = JUMP.flatOutLaunchBoost != null ? JUMP.flatOutLaunchBoost : 1.12;
    let vy = Math.max(0, rawVelY + springBoost) * lerp(flatBoost, 1, credit);
    vy *= lerp(1, JUMP.liftLaunchCut, credit);
    vy *= 1 + grain;
    const heightScale =
      Math.max(0.05, JUMP.launchHeightScale ?? 1) *
      Math.max(0.05, this.aiHeightScale ?? 1);
    vy *= Math.sqrt(heightScale);
    const maxVy = (JUMP.maxLaunchVy || 12) * Math.sqrt(Math.max(0.05, this.aiHeightScale ?? 1));
    vy = clamp(Math.max(0, vy), JUMP.minLaunchVy || 0, maxVy);

    this.noseUp = grade * (1 - credit * 0.9) - JUMP.liftNoseDrop * credit;
    this.noseUp = clamp(this.noseUp, -JUMP.airPitchMax, JUMP.airPitchMax);
    const inherit = JUMP.inheritPitch != null ? JUMP.inheritPitch : 0.55;
    const fromBody = Number(body.pitchRate) || 0;
    const pedal =
      (clamp(body.throttle, 0, 1) - clamp(body.brake, 0, 1)) * 0.85;
    this.noseUpRate = fromBody * inherit + (grade - this.noseUp) * 2.15 + pedal + grain * 1.4;

    const lat = Number(body.lateral) || 0;
    const spd = Number(body.speed) || 0;
    this.roll = clamp((Number(body.roll) || 0) * 0.65 + lat * 0.035, -0.18, 0.18);
    this.rollRate = clamp(
      (Number(body.rollRate) || 0) * 0.5 + lat * spd * 0.011 + grain * 0.55,
      -1.6,
      1.6
    );
    return vy;
  }

  /**
   * Rigid-body air: wheel reaction + inertia + light aero. Not a keyframe.
   * @param {number} dt
   * @param {number} throttle
   * @param {number} brake
   * @param {{yawRate?:number}} [extra]
   */
  air(dt, throttle, brake, extra = {}) {
    const cmd =
      clamp(throttle, 0, 1) * JUMP.airPitchUp - clamp(brake, 0, 1) * JUMP.airPitchDown;
    const torque = cmd * JUMP.airPitchRate;
    const I = Math.max(0.4, JUMP.airPitchInertia || 1.6);
    const damp = Math.max(0.5, JUMP.airPitchDamp || 2.2);
    const aoa = this.noseUp;
    const aero = -aoa * 1.15;
    this.noseUpRate += ((torque + aero) / I) * dt;
    this.noseUpRate *= Math.exp(-damp * dt);
    this.noseUp += this.noseUpRate * dt;
    this.noseUp = clamp(this.noseUp, -JUMP.airPitchMax, JUMP.airPitchMax);
    if (Math.abs(this.noseUp) >= JUMP.airPitchMax * 0.98) {
      this.noseUpRate *= 0.35;
    }

    const rollMax = JUMP.airRollMax != null ? JUMP.airRollMax : 0.2;
    const rollDamp = JUMP.airRollDamp != null ? JUMP.airRollDamp : 1.85;
    const yaw = Number(extra.yawRate) || 0;
    this.rollRate += yaw * 0.12 * dt;
    this.rollRate *= Math.exp(-rollDamp * dt);
    this.roll += this.rollRate * dt;
    this.roll = clamp(this.roll, -rollMax, rollMax);
    if (Math.abs(this.roll) >= rollMax * 0.96) this.rollRate *= 0.4;
  }

  /**
   * @param {number} speed m/s
   */
  gravityScale(speed) {
    const aoa = clamp(this.noseUp, 0, JUMP.airPitchMax) / JUMP.airPitchMax;
    const bank = clamp(Math.abs(this.roll) / 0.2, 0, 1);
    const fast = clamp(speed / 32, 0, 1);
    return 1 - aoa * fast * JUMP.aeroFloat * (1 - bank * 0.35);
  }

  /**
   * @param {number} fallSpeed
   * @param {number} speed
   * @returns {{scrub:number, upsetYaw:number, upset:number, bounce:number}}
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
    const bounceAmp = JUMP.landBounce != null ? JUMP.landBounce : 0.16;
    const need = JUMP.landBounceImpact != null ? JUMP.landBounceImpact : 6.2;
    const bounce =
      Math.max(0, -fallSpeed) > need ? Math.max(0, -fallSpeed) * bounceAmp * (0.35 + bad * 0.65) : 0;
    this.noseUpRate *= 0.25;
    this.rollRate *= 0.4;
    this.technique = 0;
    return {
      scrub: lerp(JUMP.flatScrub, JUMP.worstScrub, weight),
      upsetYaw: upset * JUMP.landUpsetYaw + this.roll * 0.8,
      upset,
      bounce: Math.min(2.15, bounce),
    };
  }

  /**
   * @param {number} dt
   */
  settle(dt) {
    if (this.unsettled <= 0) return;
    this.unsettled *= Math.exp(-dt / Math.max(0.2, JUMP.balanceDecay));
    if (this.unsettled < 0.01) this.unsettled = 0;
  }

  gripScale() {
    return 1 - this.unsettled * JUMP.balanceGripLoss;
  }
}
