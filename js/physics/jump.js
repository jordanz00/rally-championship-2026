/**
 * Jump technique — Fujimoto setup + RAGE-style rigid-body air.
 *
 * WHO THIS IS FOR: anyone tuning how crests reward or punish the player.
 * WHAT IT DOES: lift-and-brake sets the leave. In the air the chassis is a
 *   rigid body with inertia (pitch + roll), aero from angle of attack, and a
 *   Deterministic lip grain so the same jump is never a canned hop. Landing
 *   grades tail-first bounce vs a nose plant. Speed × lip grade owns the throw.
 * HOW IT CONNECTS: Vehicle calls ground / launch / air / land / settle.
 *
 * SIGN CONVENTION: +noseUp is aero nose-up. The renderer uses Three.js Rx
 * (nose down), so Vehicle negates noseUp for display.
 *
 * Determinism: two identical lips fly identical. Different speed, line, or
 * pedal at the lip fly different — GTA IV/V vehicle air.
 */

import { JUMP } from "../config.js?v=148";

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
   * Throw comes from speed × lip grade. Technique, compress, and line grain
   * change that throw — they do not replace it with a canned hop.
   *
   * @param {number} rawVelY
   * @param {number} grade
   * @param {number} springBoost
   * @param {{pitchRate?:number, roll?:number, rollRate?:number, yawRate?:number, lateral?:number, speed?:number, throttle?:number, brake?:number, dist?:number}} [body]
   */
  launch(rawVelY, grade, springBoost = 0, body = {}) {
    const credit = clamp(this.technique, 0, 1);
    this.launchGrade = grade;
    const grain = lipGrain(body.dist, body.lateral) * (JUMP.lipGrain != null ? JUMP.lipGrain : 0.07);
    const spd = Math.max(0, Number(body.speed) || 0);
    const flatBoost = JUMP.flatOutLaunchBoost != null ? JUMP.flatOutLaunchBoost : 1.14;
    let vy = Math.max(0, rawVelY) + Math.max(0, springBoost);
    vy *= lerp(flatBoost, JUMP.liftLaunchCut, credit);
    vy *= 1 + grain;
    const heightScale =
      Math.max(0.05, JUMP.launchHeightScale ?? 1) *
      Math.max(0.05, this.aiHeightScale ?? 1);
    vy *= Math.sqrt(heightScale);
    const maxVy = (JUMP.maxLaunchVy || 10.8) * Math.sqrt(Math.max(0.05, this.aiHeightScale ?? 1));
    vy = clamp(Math.max(0, vy), JUMP.minLaunchVy || 0, maxVy);

    const fromGrade = grade * (0.42 + 0.58 * (1 - credit));
    this.noseUp = fromGrade - JUMP.liftNoseDrop * credit;
    this.noseUp = clamp(this.noseUp, -JUMP.airPitchMax, JUMP.airPitchMax);
    const inherit = JUMP.inheritPitch != null ? JUMP.inheritPitch : 0.72;
    const fromBody = Number(body.pitchRate) || 0;
    const pedal = (clamp(body.throttle, 0, 1) - clamp(body.brake, 0, 1)) * 1.05;
    this.noseUpRate = fromBody * inherit + (grade - this.noseUp) * 2.4 + pedal + grain * 1.6;
    this.noseUpRate = clamp(this.noseUpRate, -2.8, 2.8);

    const lat = Number(body.lateral) || 0;
    const rollMax = JUMP.airRollMax != null ? JUMP.airRollMax : 0.28;
    this.roll = clamp((Number(body.roll) || 0) * 0.72 + lat * 0.048, -rollMax, rollMax);
    this.rollRate = clamp(
      (Number(body.rollRate) || 0) * 0.58 + lat * spd * 0.014 + grain * 0.7,
      -2.1,
      2.1
    );
    return vy;
  }

  /**
   * Rigid-body air: wheel reaction + inertia + aero. Not a keyframe.
   * @param {number} dt
   * @param {number} throttle
   * @param {number} brake
   * @param {{yawRate?:number, speed?:number}} [extra]
   */
  air(dt, throttle, brake, extra = {}) {
    const cmd =
      clamp(throttle, 0, 1) * JUMP.airPitchUp - clamp(brake, 0, 1) * JUMP.airPitchDown;
    const torque = cmd * JUMP.airPitchRate;
    const I = Math.max(0.4, JUMP.airPitchInertia || 1.45);
    const damp = Math.max(0.4, JUMP.airPitchDamp || 1.85);
    const aoa = this.noseUp;
    const aero = -aoa * 1.45;
    this.noseUpRate += ((torque + aero) / I) * dt;
    this.noseUpRate *= Math.exp(-damp * dt);
    this.noseUp += this.noseUpRate * dt;
    this.noseUp = clamp(this.noseUp, -JUMP.airPitchMax, JUMP.airPitchMax);
    if (Math.abs(this.noseUp) >= JUMP.airPitchMax * 0.98) {
      this.noseUpRate *= 0.32;
    }

    const rollMax = JUMP.airRollMax != null ? JUMP.airRollMax : 0.28;
    const rollDamp = JUMP.airRollDamp != null ? JUMP.airRollDamp : 1.55;
    const yaw = Number(extra.yawRate) || 0;
    this.rollRate += yaw * 0.22 * dt;
    this.rollRate *= Math.exp(-rollDamp * dt);
    this.roll += this.rollRate * dt;
    this.roll = clamp(this.roll, -rollMax, rollMax);
    if (Math.abs(this.roll) >= rollMax * 0.96) this.rollRate *= 0.4;
  }

  /**
   * Forward-speed keep while airborne. Nose-up presents more area and shortens
   * the jump; a dive keeps more speed and arrives sooner.
   * @param {number} dt
   * @returns {number} multiplier to apply to longitudinal speed
   */
  airLongDrag(dt) {
    const maxP = JUMP.airPitchMax || 0.46;
    const up = clamp(this.noseUp / maxP, 0, 1);
    const down = clamp(-this.noseUp / maxP, 0, 1);
    const k = JUMP.airNoseDrag != null ? JUMP.airNoseDrag : 0.58;
    return Math.max(0.84, 1 - dt * (0.01 + up * k - down * 0.1));
  }

  /**
   * @param {number} speed m/s
   */
  gravityScale(speed) {
    const maxP = JUMP.airPitchMax || 0.46;
    const up = clamp(this.noseUp / maxP, 0, 1);
    const down = clamp(-this.noseUp / maxP, 0, 1);
    const bank = clamp(Math.abs(this.roll) / (JUMP.airRollMax || 0.28), 0, 1);
    const fast = clamp(speed / 34, 0, 1);
    const hang = up * fast * (JUMP.aeroFloat ?? 0.22) * (1 - bank * 0.4);
    const dive = down * (JUMP.aeroDive ?? 0.2);
    return clamp(1 - hang + dive, 0.8, 1.24);
  }

  /**
   * @param {number} fallSpeed
   * @param {number} speed
   * @returns {{scrub:number, upsetYaw:number, upset:number, bounce:number}}
   */
  land(fallSpeed, speed) {
    const path = Math.atan2(Math.max(0, -fallSpeed), Math.max(6, speed));
    const signed = this.noseUp - path;
    const full = Math.max(0.05, JUMP.mismatchFull);
    const tailFirst = clamp(signed / full, 0, 1);
    const noseFirst = clamp(-signed / full, 0, 1);
    const bad = Math.max(tailFirst, noseFirst);
    const impact = clamp(Math.max(0, -fallSpeed) / 14, 0, 1);
    this.lastLanding = bad;
    const upset = tailFirst * (0.48 + 0.52 * impact) + noseFirst * 0.28 * impact;
    this.unsettled = clamp(this.unsettled + upset * 0.88, 0, 1);
    const bounceAmp = JUMP.landBounce != null ? JUMP.landBounce : 0.24;
    const need = JUMP.landBounceImpact != null ? JUMP.landBounceImpact : 4.4;
    const bounce =
      Math.max(0, -fallSpeed) > need
        ? Math.max(0, -fallSpeed) * bounceAmp * (0.04 + tailFirst * 0.96)
        : 0;
    this.noseUpRate *= 0.22;
    this.rollRate *= 0.38;
    this.technique = 0;
    const weight = tailFirst * (0.5 + 0.5 * impact) + noseFirst * (0.7 + 0.3 * impact);
    return {
      scrub: lerp(JUMP.flatScrub, JUMP.worstScrub, weight),
      upsetYaw: upset * JUMP.landUpsetYaw + this.roll * 0.9,
      upset,
      bounce: Math.min(2.4, bounce),
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
