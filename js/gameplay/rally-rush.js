/**
 * Rally Rush 2 — Paradise-scale boost on a Saturn rally chassis.
 *
 * WHO THIS IS FOR: RallyGame + Vehicle.step (player only).
 * WHAT IT DOES: Fills from slides, draft, air, landings, near-miss streaks.
 *   ON FIRE when the combo is hot. Dump is a long shove through the drivetrain.
 * HOW IT CONNECTS: docs/BURNOUT_RALLY_DIRECTION.md. One tank. No second meter.
 */

const EARN_SLIDE = 0.78;
const EARN_PACE = 0.22;
const EARN_AIR = 0.32;
const EARN_LAND = 0.38;
const EARN_PASS = 0.42;
const EARN_DRAFT = 0.46;
const EARN_GO = 0.95;
const SPEND = 0.16;
const ACCEL = 18.5;
const FIRE_ACCEL = 24;
const VMAX = 86;
const PASS_NEAR = 8.4;
const PASS_HIT = 1.85;
const PASS_COOL = 0.85;
const DRAFT_NEAR = 14;
const DRAFT_FAR = 3.4;

/**
 * Arcade rush tank — On Fire is a state, not a second resource.
 */
export class RallyRush {
  constructor() {
    this.meter = 0;
    this.heat = 0;
    this.nearMiss = 0;
    this.combo = 1;
    this.fire = 0;
    this.passStreak = 0;
    /** @type {Map<number, number>} */
    this._cool = new Map();
    this._wasAir = false;
    this._slideT = 0;
    this._wasDump = false;
    this._wasFire = false;
    this._streakT = 0;
  }

  reset() {
    this.meter = 0;
    this.heat = 0;
    this.nearMiss = 0;
    this.combo = 1;
    this.fire = 0;
    this.passStreak = 0;
    this._cool.clear();
    this._wasAir = false;
    this._slideT = 0;
    this._wasDump = false;
    this._wasFire = false;
    this._streakT = 0;
  }

  /**
   * @param {number} dt
   * @param {{
   *   player: {position:{x:number,z:number}, yaw:number, speed:number, throttle:number, driftAngle?:number, onGround?:boolean, velY?:number, lastImpact?:number, lastAirTime?:number, hitWall?:number, handbrake?:number},
   *   opponents?: Array<{vehicle?:{position:{x:number,z:number},speed?:number}, position?:{x:number,z:number}}>,
   *   go?: boolean
   * }} ctx
   * @returns {{accel:number,heat:number,justPass:boolean,justDump:boolean,justFire:boolean,meter:number,combo:number,fire:number}}
   */
  step(dt, ctx) {
    const p = ctx && ctx.player;
    if (!p || !(dt > 0)) {
      this.heat *= 0.9;
      this.fire *= 0.9;
      return {
        accel: 0,
        heat: this.heat,
        justPass: false,
        justDump: false,
        justFire: false,
        meter: this.meter,
        combo: this.combo,
        fire: this.fire,
        passStreak: this.passStreak,
      };
    }
    const t = Math.min(0.05, dt);
    if (ctx.go) this.meter = Math.min(1, this.meter + EARN_GO);

    const speed = p.speed || 0;
    const drift = Math.abs(p.driftAngle || 0);
    const throttle = p.throttle || 0;
    const fx = Math.sin(p.yaw || 0);
    const fz = Math.cos(p.yaw || 0);
    const sliding = drift > 0.08 && speed > 9;
    if (speed > 22 && throttle > 0.45 && !sliding) {
      this.meter += EARN_PACE * t * (0.55 + Math.min(1, (speed - 22) / 28));
    }
    if (sliding) {
      this._slideT += t;
      this.combo = Math.min(2.1, 1 + this._slideT * 0.38 + this.passStreak * 0.12);
      this.meter += EARN_SLIDE * t * Math.min(1.7, drift * 4.1) * this.combo;
      if ((p.handbrake || 0) > 0.3) this.meter += 0.16 * t * this.combo;
    } else {
      this._slideT = Math.max(0, this._slideT - t * 0.7);
      this.combo += (1 - this.combo) * (1 - Math.exp(-1.4 * t));
    }

    if (!p.onGround && speed > 10) this.meter += EARN_AIR * t * this.combo;

    const landed = this._wasAir && !!p.onGround;
    this._wasAir = !p.onGround;
    if (landed && speed > 7) {
      const impact = Math.max(Math.abs(p.velY || 0), p.lastImpact || 0, (p.lastAirTime || 0) * 5);
      this.meter += Math.min(0.48, EARN_LAND * (0.55 + impact * 0.16) * this.combo);
    }

    let justPass = false;
    const pack = ctx.opponents || [];
    for (let i = 0; i < pack.length; i++) {
      const o = pack[i];
      const rp = o && (o.vehicle && o.vehicle.position ? o.vehicle.position : o.position);
      if (!rp) continue;
      const dx = rp.x - p.position.x;
      const dz = rp.z - p.position.z;
      const d = Math.hypot(dx, dz);
      const along = dx * fx + dz * fz;
      if (d > DRAFT_FAR && d < DRAFT_NEAR && along > 1.2 && speed > 14 && throttle > 0.25) {
        this.meter += EARN_DRAFT * t * this.combo;
      }
      if (d < PASS_HIT || d > PASS_NEAR) continue;
      if (speed < 12) continue;
      const last = this._cool.get(i) || 0;
      if (last > 0) continue;
      this._cool.set(i, PASS_COOL);
      this.passStreak = Math.min(6, this.passStreak + 1);
      this._streakT = 2.8;
      this.meter += EARN_PASS * this.combo * (1 + this.passStreak * 0.18);
      this.nearMiss = 1;
      justPass = true;
    }
    for (const [k, v] of this._cool) {
      const n = v - t;
      if (n <= 0) this._cool.delete(k);
      else this._cool.set(k, n);
    }
    this._streakT = Math.max(0, this._streakT - t);
    if (this._streakT <= 0) this.passStreak = 0;

    if ((p.hitWall || 0) > 0.78) {
      this.meter *= 0.28;
      this.combo = 1;
      this.fire = 0;
      this._slideT = 0;
      this.passStreak = 0;
    }
    this.meter = Math.max(0, Math.min(1, this.meter));

    const wantFire = this.combo > 1.18 && this.meter > 0.28;
    let justFire = false;
    if (wantFire) {
      if (!this._wasFire) justFire = true;
      this.fire += (1 - this.fire) * (1 - Math.exp(-8 * t));
    } else {
      this.fire *= Math.exp(-2.4 * t);
    }
    this._wasFire = wantFire;
    if (this.fire < 0.04) this.fire = 0;

    let accel = 0;
    const dumping = this.meter > 0.04 && throttle > 0.32 && speed < VMAX;
    let justDump = false;
    if (dumping) {
      if (!this._wasDump) justDump = true;
      const spend = Math.min(this.meter, SPEND * t * (this.fire > 0.45 ? 0.72 : 1));
      this.meter -= spend;
      const fade = speed > 70 ? Math.max(0.28, 1 - (speed - 70) / 18) : 1;
      const peak = this.fire > 0.45 ? FIRE_ACCEL : ACCEL;
      accel = peak * fade * Math.min(1, this.meter + spend + 0.35 + this.fire * 0.25);
      this.heat += (1 - this.heat) * (1 - Math.exp(-14 * t));
    } else {
      this.heat *= Math.exp(-2.6 * t);
    }
    this._wasDump = dumping;
    if (this.heat < 0.02) this.heat = 0;
    this.nearMiss = Math.max(0, this.nearMiss - t * 1.6);
    return {
      accel,
      heat: this.heat,
      justPass,
      justDump,
      justFire,
      meter: this.meter,
      combo: this.combo,
      fire: this.fire,
      passStreak: this.passStreak,
    };
  }
}
