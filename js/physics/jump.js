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

import { JUMP } from "../config.js?v=167";

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Tiny lip roughness from distance + lateral + speed. Same line = same grain.
 * @param {number} dist
 * @param {number} lat
 * @param {number} [speed]
 */
function lipGrain(dist, lat, speed = 0) {
  const d = Number(dist) || 0;
  const l = Number(lat) || 0;
  const spd = Math.max(0, Number(speed) || 0);
  const base =
    Math.sin(d * 0.37 + l * 0.9) * 0.62 + Math.sin(d * 1.17 + l * 2.4) * 0.38;
  const fast = clamp(spd / 28, 0, 1);
  return base * (0.82 + fast * 0.38);
}

/** Surface bump → spring pop and landing sink (passed from vehicle). */
function surfaceSpringMod(surfaceBump) {
  const b = Math.max(0, Number(surfaceBump) || 0);
  return 1 + b * (JUMP.surfaceSpringGain != null ? JUMP.surfaceSpringGain : 4.2);
}

function surfaceLandMod(surfaceBump) {
  const b = Math.max(0, Number(surfaceBump) || 0);
  return 1 + b * (JUMP.surfaceLandGain != null ? JUMP.surfaceLandGain : 3.6);
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
   * @param {{pitchRate?:number, roll?:number, rollRate?:number, yawRate?:number, lateral?:number, speed?:number, throttle?:number, brake?:number, dist?:number, jumpThrow?:number, jumpLip?:number, surfaceBump?:number, lipGrade?:number}} [body]
   */
  launch(rawVelY, grade, springBoost = 0, body = {}) {
    const credit = clamp(this.technique, 0, 1);
    const lipGrade = Number.isFinite(body.lipGrade) ? body.lipGrade : grade;
    this.launchGrade = lipGrade;
    const grain =
      lipGrain(body.dist, body.lateral, body.speed) *
      (JUMP.lipGrain != null ? JUMP.lipGrain : 0.07);
    const spd = Math.max(0, Number(body.speed) || 0);
    const jumpScale = clamp(Number(body.jumpThrow) || 1, 0.45, 2.4);
    const jumpLip = clamp(Number(body.jumpLip) || 1, 0.4, 2.6);
    const scaleIn = JUMP.jumpScaleInfluence != null ? JUMP.jumpScaleInfluence : 0.48;
    const lipIn = JUMP.lipGradeInfluence != null ? JUMP.lipGradeInfluence : 0.42;
    const surfMod = surfaceSpringMod(body.surfaceBump);
    const flatBoost = JUMP.flatOutLaunchBoost != null ? JUMP.flatOutLaunchBoost : 1.14;
    let vy = Math.max(0, rawVelY) + Math.max(0, springBoost) * surfMod;
    vy *= lerp(flatBoost, JUMP.liftLaunchCut, credit);
    vy *= 1 + grain * jumpLip;
    vy *= lerp(1, jumpScale, scaleIn);
    vy *= 1 + Math.max(0, lipGrade - grade) * lipIn * jumpLip;
    const heightScale =
      Math.max(0.05, JUMP.launchHeightScale ?? 1) *
      Math.max(0.05, this.aiHeightScale ?? 1);
    vy *= Math.sqrt(heightScale);
    const maxVy = (JUMP.maxLaunchVy || 10.8) * Math.sqrt(Math.max(0.05, this.aiHeightScale ?? 1));
    vy = clamp(Math.max(0, vy), JUMP.minLaunchVy || 0, maxVy);

    const fromGrade = lipGrade * (0.42 + 0.58 * (1 - credit)) * jumpLip;
    this.noseUp = fromGrade - JUMP.liftNoseDrop * credit;
    this.noseUp = clamp(this.noseUp, -JUMP.airPitchMax, JUMP.airPitchMax);
    const inherit = JUMP.inheritPitch != null ? JUMP.inheritPitch : 0.72;
    const fromBody = Number(body.pitchRate) || 0;
    const pedal = (clamp(body.throttle, 0, 1) - clamp(body.brake, 0, 1)) * 1.05;
    this.noseUpRate =
      fromBody * inherit +
      (lipGrade - this.noseUp) * (2.2 + jumpLip * 0.35) +
      pedal +
      grain * 1.6 * jumpLip;
    this.noseUpRate = clamp(this.noseUpRate, -2.8, 2.8);

    const lat = Number(body.lateral) || 0;
    const rollMax = JUMP.airRollMax != null ? JUMP.airRollMax : 0.28;
    this.roll = clamp(
      (Number(body.roll) || 0) * 0.72 + lat * (0.048 + spd * 0.00035),
      -rollMax,
      rollMax
    );
    this.rollRate = clamp(
      (Number(body.rollRate) || 0) * 0.58 +
        lat * spd * 0.014 * jumpLip +
        grain * 0.7 * jumpLip,
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
   * @param {{yawRate?:number, speed?:number, vLat?:number}} [extra]
   */
  air(dt, throttle, brake, extra = {}) {
    const cmd =
      clamp(throttle, 0, 1) * JUMP.airPitchUp - clamp(brake, 0, 1) * JUMP.airPitchDown;
    const torque = cmd * JUMP.airPitchRate;
    const I = Math.max(0.4, JUMP.airPitchInertia || 1.45);
    const damp = Math.max(0.4, JUMP.airPitchDamp || 1.85);
    const aoa = this.noseUp;
    const spd = Math.max(0, Number(extra.speed) || 0);
    const aero = -aoa * (1.35 + spd * 0.012);
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
    const vLat = Number(extra.vLat) || 0;
    const cross = JUMP.airCrossCouple != null ? JUMP.airCrossCouple : 0.18;
    this.rollRate += (yaw * 0.22 + vLat * cross * 0.04) * dt;
    this.rollRate *= Math.exp(-rollDamp * dt);
    this.roll += this.rollRate * dt;
    this.roll = clamp(this.roll, -rollMax, rollMax);
    if (Math.abs(this.roll) >= rollMax * 0.96) this.rollRate *= 0.4;
  }

  /**
   * Forward-speed keep while airborne. Near-ballistic coast — nose-up trims a
   * little, dive keeps almost all of it. Must NOT dump a fifth of speed mid-hang.
   * @param {number} dt
   * @returns {number} multiplier to apply to longitudinal speed
   */
  airLongDrag(dt) {
    const maxP = JUMP.airPitchMax || 0.46;
    const up = clamp(this.noseUp / maxP, 0, 1);
    const down = clamp(-this.noseUp / maxP, 0, 1);
    const base = JUMP.airBaseDrag != null ? JUMP.airBaseDrag : 0.002;
    const k = JUMP.airNoseDrag != null ? JUMP.airNoseDrag : 0.14;
    return Math.max(0.985, 1 - dt * (base + up * k - down * 0.08));
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
   * @param {{surfaceBump?:number, jumpDrop?:number}} [ctx]
   * @returns {{scrub:number, upsetYaw:number, upset:number, bounce:number}}
   */
  land(fallSpeed, speed, ctx = {}) {
    const path = Math.atan2(Math.max(0, -fallSpeed), Math.max(6, speed));
    const signed = this.noseUp - path;
    const full = Math.max(0.05, JUMP.mismatchFull);
    const tailFirst = clamp(signed / full, 0, 1);
    const noseFirst = clamp(-signed / full, 0, 1);
    const bad = Math.max(tailFirst, noseFirst);
    const impact = clamp(Math.max(0, -fallSpeed) / 14, 0, 1);
    this.lastLanding = bad;
    const landMod = surfaceLandMod(ctx.surfaceBump);
    const dropMod = clamp((Number(ctx.jumpDrop) || 2.6) / 2.6, 0.65, 1.55);
    const upset = (tailFirst * (0.48 + 0.52 * impact) + noseFirst * 0.28 * impact) * landMod;
    this.unsettled = clamp(this.unsettled + upset * 0.88, 0, 1);
    const bounceAmp = (JUMP.landBounce != null ? JUMP.landBounce : 0.18) * landMod * dropMod;
    const need = JUMP.landBounceImpact != null ? JUMP.landBounceImpact : 5.2;
    const bounce =
      Math.max(0, -fallSpeed) > need
        ? Math.max(0, -fallSpeed) * bounceAmp * (0.04 + tailFirst * 0.96)
        : 0;
    // Keep some tumble rate into the vehicle settle spring — hard rate kills
    // made every land look like an upright keyframe the frame after contact.
    this.noseUpRate *= 0.72;
    this.rollRate *= 0.78;
    this.technique = 0;
    const weight = tailFirst * (0.5 + 0.5 * impact) + noseFirst * (0.7 + 0.3 * impact);
    const scrubBase = lerp(JUMP.flatScrub, JUMP.worstScrub, weight);
    const scrub = lerp(scrubBase, scrubBase * 0.92, clamp(landMod - 1, 0, 0.35));
    return {
      scrub,
      upsetYaw: upset * JUMP.landUpsetYaw + this.roll * 0.9,
      upset,
      bounce: Math.min(2.8 * dropMod, bounce),
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
