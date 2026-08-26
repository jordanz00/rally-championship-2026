/**
 * Opponent AI — rivals that read the stage instead of following a rail.
 *
 * WHO THIS IS FOR: championship pack behavior.
 * WHAT IT DOES: each rival owns a lane on the ribbon, reads curvature at two
 *   look-ahead horizons, works out the corner speed the SURFACE AHEAD will
 *   actually support, brakes for it (trail-braking on the way in), catches its
 *   own slides with a human reaction lag, makes occasional small mistakes, and
 *   yields to the player rather than through them.
 * HOW IT CONNECTS: game.js steps every Opponent with the full vehicle pack.
 *
 * DESIGN RULES (docs/AM3-RESEARCH.md §2, §3)
 *  - Beatable. Pace tops out below what a good player can do on a clean lap.
 *  - Invisible rubber band. A few percent of throttle, nothing you can see.
 *  - No crash-out. A rival must never be the reason a championship run ends,
 *    so they respect the player far more than they respect each other.
 *  - Deterministic. "Mistakes" come from a seeded per-rival wander, never
 *    Math.random, so the pack is reproducible from the same inputs.
 *
 * PERFORMANCE: rivals run on Vehicle's lowDetail path — half the tire substeps
 * and cheap racing-line road probes instead of full spatial queries. The player
 * is never simplified; the pack is what gets trimmed to hold the frame budget.
 */

import { Vehicle } from "./physics/vehicle.js?v=90";
import { getSurface } from "./physics/surfaces.js?v=46";
import { AI, CARS } from "./config.js?v=138";
import { aiTintForIndex, createRivalCar, applyWheelPose, setBrakeLights, rivalChassisForIndex } from "./cars/celica.js?v=121";

const G = 9.81;

/**
 * Lateral slots in metres (track +X / right). Tight enough that a slide still
 * lands on asphalt — ±2.8 m plus an apex used to pin rivals on the painted edge.
 */
const LANES = [-1.15, 0.2, 1.05, -0.55, 0.7, -1.28, 0.95, -0.25, 1.22, -0.88, 0.42, -1.02, 0.82, 0.08];
/** Chassis-to-edge keep-out (m). Car half-width ~1.0 plus a slide buffer. */
const LINE_EDGE = 2.2;
/** Peak apex offset as a fraction of the on-road half-width. */
const LINE_APEX_FRAC = 0.58;

/**
 * Deterministic per-rival noise. Same rival and same sample index always gives
 * the same number, which keeps the whole pack reproducible.
 * @param {number} seed
 * @param {number} n sample index
 * @returns {number} -1..1
 */
function hashNoise(seed, n) {
  let h = Math.imul(seed * 0x9e37 + n * 0x85eb, 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x165667b1);
  h ^= h >>> 13;
  return ((h >>> 0) / 2147483648) - 1;
}

/**
 * Smoothly wandering deterministic signal in roughly -1..1.
 *
 * Used for the things a real driver is inconsistent about: exactly when they
 * hit the brakes, and exactly where they place the car. Smoothstepped between
 * hash samples so it drifts instead of popping.
 */
class Wander {
  /** @param {number} seed */
  constructor(seed) {
    this.seed = seed | 0;
    this.phase = 0;
    this.n = 1;
    this.a = hashNoise(this.seed, 0);
    this.b = hashNoise(this.seed, 1);
  }

  /**
   * @param {number} dt
   * @param {number} rate new samples per second
   */
  step(dt, rate) {
    this.phase += dt * rate;
    let guard = 0;
    while (this.phase >= 1 && guard < 8) {
      this.phase -= 1;
      this.n += 1;
      this.a = this.b;
      this.b = hashNoise(this.seed, this.n);
      guard += 1;
    }
    const t = this.phase * this.phase * (3 - 2 * this.phase);
    return this.a + (this.b - this.a) * t;
  }
}

/**
 * On-road half-width the chassis origin may use. Shrinks with speed so a
 * committed slide still ends on tarmac.
 * @param {number} width ribbon width (m)
 * @param {number} spd m/s
 */
function safeHalfWidth(width, spd) {
  const w = Math.max(6, width || 10);
  const pad = LINE_EDGE + Math.min(1.55, Math.max(0, spd) * 0.034);
  return Math.max(0.5, w * 0.5 - pad);
}

/**
 * Out-in-out lateral on the ribbon. Positive = right of centre.
 * A left turn (positive heading delta) apexes left (negative lat).
 *
 * @param {number} lane preferred slot
 * @param {number} d1 heading change into the near horizon
 * @param {number} d2 heading change near→far
 * @param {number} curve |d1| + 0.7|d2|
 * @param {number} lineScale tarmac vs loose
 * @param {number} lineNoise wander (m)
 * @param {number} width ribbon width
 * @param {number} spd m/s
 * @param {boolean} onTarmac
 */
function racingLat(lane, d1, d2, curve, lineScale, lineNoise, width, spd, onTarmac) {
  const half = safeHalfWidth(width, spd);
  const laneCap = Math.min(half * 0.68, 1.28);
  let lat = clamp(lane, -laneCap, laneCap);
  const turn = Math.sign(d1 !== 0 ? d1 : d2);
  if (turn !== 0 && curve > 0.07) {
    const kIn = Math.abs(d1);
    const kOut = Math.abs(d2);
    const apex = Math.min(
      half * LINE_APEX_FRAC,
      (onTarmac ? 0.52 : 0.36) + curve * 1.05 * lineScale
    );
    const inMix = clamp((kIn - 0.06) / 0.5, 0, 1);
    const unwinding = kOut < kIn * 0.7 && kIn > 0.1;
    if (unwinding) lat += turn * apex * 0.3;
    else {
      lat += turn * (1 - inMix) * apex * 0.48;
      lat -= turn * inMix * apex;
    }
  }
  lat += lineNoise;
  return clamp(lat, -half, half);
}

/**
 * Speed a corner of this radius will hold on this surface.
 *
 * v = sqrt(mu * g * R) is the honest limit; `pace` is how close this particular
 * rival dares to run to it. Above 1 they lean past grip and have to slide the
 * rest out, which is what makes the fast ones look committed rather than exact.
 *
 * @param {number} dh heading change across the arc, radians
 * @param {number} arc length of the arc, metres
 * @param {number} mu peak friction of the surface at that point
 * @param {number} pace fraction of the theoretical limit this rival aims for
 */
function cornerSpeed(dh, arc, mu, pace) {
  const bend = Math.abs(dh);
  if (bend < 0.02) return 999;
  const radius = Math.max(6, arc / bend);
  return Math.sqrt(Math.max(0.15, mu) * G * radius) * pace;
}

export class Opponent {
  /**
   * @param {import('./tracks/track.js').Track} track
   * @param {number} index
   * @param {number} startDist
   */
  /**
   * @param {import('./tracks/track.js').Track} track
   * @param {number} index rival slot 0..n-1
   * @param {number} startDist metres along the ribbon
   * @param {{fieldSize?:number,courseId?:string,champPlace?:number,lane?:number}} [opts]
   */
  constructor(track, index, startDist, opts = {}) {
    this.track = track;
    this.index = index;
    this.lane = opts.lane != null ? opts.lane : LANES[index % LANES.length];
    const fieldSize = Math.max(1, opts.fieldSize ?? 14);
    const courseId = opts.courseId || "desert";
    this.champPlace = opts.champPlace ?? 15;
    const courseBoost = (AI.skillByCourse && AI.skillByCourse[courseId]) || 0;

    // Skill spread across the field. Index 0 is the designated front-runner so
    // there is always one rival worth chasing; the rest fan out below.
    const spread = AI.skillCeiling - AI.skillFloor;
    const rung = fieldSize > 1 ? index / (fieldSize - 1) : 0;
    this.skill =
      index === 0
        ? Math.min(1.12, AI.skillCeiling + courseBoost * 0.5)
        : Math.min(1.08, AI.skillFloor + spread * rung * 0.9 + courseBoost);
    /**
     * How close to the theoretical corner limit this rival aims. Sprint 26:
     * front of the field sits over 1.0 so a committed AI lap beats throttle-only.
     */
    this.pace = 0.92 + this.skill * 0.2;
    /** Reaction speed when the car steps out, 1/s. Slower rivals flail more. */
    this.reflex = 6.5 + this.skill * 7;
    /** How much opposite lock they feed in per radian of slide. */
    this.catchGain = 0.4 + this.skill * 0.55;
    /** Some drivers flick the handbrake into hairpins, some do not. */
    this.flicks = hashNoise(index + 91, 3) > -0.15;
    /** Personal trail-braking taste. */
    this.trail = AI.trailBrake * (0.7 + (hashNoise(index + 17, 5) + 1) * 0.35);

    this.chassisId = rivalChassisForIndex(index);
    this.vehicle = new Vehicle(CARS[this.chassisId] || CARS.celica, { lowDetail: true });
    this.vehicle.ai = true;
    this.vehicle.spawn(track, startDist, this.lane);
    this.mesh = createRivalCar(aiTintForIndex(index), index, this.chassisId);
    this.mesh.scale.setScalar(1);
    this._steer = 0;
    this._avoid = 0;
    this._driftSeen = 0;
    this._jamT = 0;
    this._passSide = 0;
    this._brakeWander = new Wander(index * 7 + 13);
    this._lineWander = new Wander(index * 31 + 5);
    this._q = {};
    this._qOther = {};
    this._here = {};
    this._near = {};
    this._far = {};
    this._target = {};
    this.syncMesh();
  }

  /**
   * @param {number} dt
   * @param {number} playerProgress
   * @param {Array<import('./physics/vehicle.js').Vehicle>} pack
   */
  step(dt, playerProgress, pack) {
    // Failure isolation: one bad rival must not take down the rest of the pack,
    // the player's physics, or the render loop.
    try {
      this._drive(dt, playerProgress, pack);
    } catch (err) {
      console.warn("Opponent", this.index, "step failed", err);
      try {
        this.vehicle.step(dt, ZERO_INPUT, this.track);
      } catch {
        /* the rival is beyond help this frame; the race carries on */
      }
    }
  }

  /**
   * @param {number} dt
   * @param {number} playerProgress
   * @param {Array<import('./physics/vehicle.js').Vehicle>} pack
   */
  _drive(dt, playerProgress, pack) {
    const v = this.vehicle;
    const track = this.track;
    const end = Math.max(1, track.length - 1);
    const q = track.query(v.position.x, v.position.z, this._q, v.progress);
    const spd = v.speed;

    // Read the stage at two horizons — pro drivers look further ahead at speed.
    const lookNear = (14 + (AI.proLookNear || 0)) + spd * 0.48;
    const lookFar = (32 + (AI.proLookFar || 0)) + spd * 1.15;
    const here = track.sample(Math.min(end, v.progress), this._here);
    const near = track.sample(Math.min(end, v.progress + lookNear), this._near);
    const far = track.sample(Math.min(end, v.progress + lookFar), this._far);
    const d1 = wrapHeading(near.heading - here.heading);
    const d2 = wrapHeading(far.heading - near.heading);
    const curve = Math.abs(d1) + Math.abs(d2) * 0.7;

    const surfId = near.surface || q.surface || "gravel";
    const onTarmac = surfId === "tarmac" || surfId === "cobble";
    const lineScale = onTarmac ? AI.proLineTarmac || 1.12 : AI.proLineLoose || 0.88;

    const brakeErr = this._brakeWander.step(dt, 1 / Math.max(1, AI.mistakeInterval));
    const lineErr = this._lineWander.step(dt, 0.24);
    const mistakeScale = this.index === 0 ? 0.62 : 1 - this.skill * 0.22;

    // Racing line: out-in-out inside a speed-aware envelope so a slide still
    // lands on asphalt. Old math pinned ±2.8 m lanes plus a 1.4 m apex to the
    // painted edge, then traffic shoved them the rest of the way off.
    const half = safeHalfWidth(q.width, spd);
    const lineLat = racingLat(
      this.lane,
      d1,
      d2,
      curve,
      lineScale,
      lineErr * (AI.mistakeSize || 0.22) * 0.85 * mistakeScale,
      q.width,
      spd,
      onTarmac
    );

    // Grip where they will be BRAKING, not where they are now.
    const surfNear = getSurface(near.surface || q.surface);
    const surfFar = getSurface(far.surface || near.surface || q.surface);

    const traffic = this._readTraffic(pack, v, track, q, dt);
    // Collision resolver may have tagged a pass lane — hold it briefly.
    if (v._aiPassT > 0) {
      this._passSide = v._aiPassSide || this._passSide || 1;
      this._avoid = this._passSide * 1.15;
      v._aiPassT -= dt;
    }
    const dodge = clamp(this._avoid * 1.05 + this._passSide * 0.55, -half * 0.48, half * 0.48);
    const lat = clamp(lineLat + dodge, -half, half);
    v._aiLat = q.lateral;

    // Steering: aim at a point on the chosen line, blended with the local
    // heading so hairpins are followed rather than cut.
    const look = 12 + Math.min(22, spd * 0.4) + curve * 8;
    const target = track.sample(Math.min(end, v.progress + look), this._target);
    const tx = target.x + target.nx * lat;
    const tz = target.z + target.nz * lat;
    let err = wrapHeading(Math.atan2(tx - v.position.x, tz - v.position.z) - v.yaw);
    const off = Math.abs(q.lateral) - q.width * 0.5;
    const headingWeight = off > 0 ? 0.58 : onTarmac ? 0.36 : 0.28;
    err = err * (1 - headingWeight) + wrapHeading(here.heading - v.yaw) * headingWeight;
    // Pull to centre before the edge, then hard once a wheel is in the dirt.
    if (off > -0.55) {
      err += (q.lateral > 0 ? -1 : 1) * Math.min(1.35, 0.14 + Math.max(0, off + 0.55) * 0.95);
    }

    // Pace: how fast the surface ahead says this corner can be taken.
    const topSpd = (v.spec.maxSpeedKmh / 3.6) * Math.max(0.7, surfNear.speedScale);
    const vNear = cornerSpeed(d1, lookNear, surfNear.muPeak, this.pace);
    const vFar = cornerSpeed(d2, Math.max(6, lookFar - lookNear), surfFar.muPeak, this.pace);
    // A late-braking mistake shows up as believing the corner is faster than it
    // is; they then have to slide the difference out at the exit.
    const optimism = 1 + brakeErr * AI.mistakeSize * 0.5;
    const tightMul = clamp(1.06 - Math.abs(d1) * 0.48 - Math.abs(d2) * 0.2, 0.7, 1);
    const vLimit = Math.min(
      vNear * optimism * (AI.cornerMargin || 0.98),
      vFar * 1.12 * optimism,
      topSpd
    ) * tightMul;

    let throttle;
    let brake = 0;
    let hb = 0;
    const overspeed = spd - vLimit;
    if (spd < 3.5) {
      throttle = 0.95;
    } else if (overspeed > 1.2) {
      // Softer surfaces need a longer run-up, so grip scales the urgency.
      brake = clamp(overspeed / (5 + surfNear.muPeak * 9), 0.12, 0.95);
      throttle = 0;
    } else if (overspeed > -1.5) {
      // Sitting on the limit. A flat 0.42 could not even hold speed against
      // drag at pace, so rivals sagged below every corner limit instead of
      // riding it — they looked like they were being careful everywhere.
      throttle = 0.72;
    } else {
      // Below the limit, get on with it. This was scaled by `skill`, which is a
      // permanent straight-line handicap: the slower rivals were slow even
      // where there was nothing to be careful about, which reads as a slow car
      // rather than a slower driver. Skill belongs in `pace`, reflex, mistakes
      // and slide recovery — full throttle down a straight is free for everyone.
      throttle = clamp(0.72 + -overspeed * 0.12, 0, 1);
    }

    // Trail-braking: carry a little brake past the turn-in so the nose bites.
    // On loose surfaces that same pedal rotates the car, which is why rivals
    // slide on gravel and simply stop on tarmac — same input, surface decides.
    if (brake < 0.5 && curve > 0.35 && spd > 10 && Math.abs(this._steer) > 0.1) {
      brake = Math.max(brake, this.trail * Math.min(1, curve) * 0.55);
      throttle *= 0.7;
    }

    // Hairpin flick, for the rivals whose style it is.
    const tight = Math.abs(d1) > 0.9 && lookNear < 30;
    if (this.flicks && tight && spd > 8 && spd < 20 && off < -0.7) hb = 0.22;

    throttle *= traffic.lift;
    brake = Math.max(brake, traffic.brake);

    // AI-AI traffic: never crawl. Dodge and keep rolling; only the player gets
    // a hard yield. That is what stopped mid-road pack pile-ups.
    if (!traffic.playerBlock) {
      throttle = Math.max(throttle, traffic.minThrottle);
      brake = Math.min(brake, traffic.maxBrake);
    }

    // Unstick: slow + someone close ahead → force a pass and dig in throttle.
    if (spd < 7 && traffic.aheadClose) {
      this._jamT += dt;
      if (this._jamT > 0.35) {
        this._passSide = this._passSide || (this.index % 2 === 0 ? 1 : -1);
        this._avoid = this._passSide * 1.25;
        throttle = Math.max(throttle, 0.92);
        brake = Math.min(brake, 0.08);
      }
    } else {
      this._jamT = Math.max(0, this._jamT - dt * 1.5);
      if (this._jamT < 0.05) this._passSide *= 0.92;
      if (Math.abs(this._passSide) < 0.08) this._passSide = 0;
    }

    // Rubber band: a whisper, and only while they are on the throttle. Anything
    // visible would read as a cheat.
    if (brake < 0.1) {
      const gap = clamp((playerProgress - v.progress) / Math.max(1, AI.rubberBandRange), -1, 1);
      const standing = this.champPlace || 15;
      const catchMul = standing > 8 ? 1.18 : standing > 4 ? 1.0 : 0.82;
      throttle = clamp(throttle * (1 + gap * AI.rubberBand * catchMul), 0, 1);
    }

    // Slide recovery with a human lag. Rivals do not know they are sideways
    // instantly, which is what makes the save look like driving.
    const drift = v.driftAngle || 0;
    this._driftSeen += (drift - this._driftSeen) * (1 - Math.exp(-this.reflex * dt));
    // Steering authority. This used to be so low (0.4 falling to 0.15 at speed)
    // that a heading error of a few degrees produced almost no steering at all,
    // and the countersteer term below simply erased it — a rival that slid wide
    // could never get back on the line. It still tapers with speed so they are
    // smooth on fast sections rather than darting.
    const gain = 2.45 / (1 + spd * 0.011);
    let steerCmd = clamp(err * gain, -0.9, 0.9);
    if (Math.abs(this._driftSeen) > 0.08) {
      steerCmd = clamp(steerCmd - this._driftSeen * this.catchGain, -0.85, 0.85);
    }
    this._steer += (steerCmd - this._steer) * (1 - Math.exp(-8 * dt));

    // Lift when the angle has got away from them. A rival that stays flat while
    // sideways sustains its own slide, scrubs its speed off and never recovers,
    // which is what made the pack lap at a fraction of a player's pace. Using
    // the LAGGED drift means they react a beat late, so the save still looks
    // like a driver catching it rather than a script.
    const slideOver = Math.abs(this._driftSeen) - AI.driftTarget;
    if (slideOver > 0) {
      const ease = clamp(1 - slideOver / Math.max(0.05, AI.driftPanic), AI.driftMinThrottle, 1);
      throttle *= ease;
    }

    // Off the ribbon: lift and gather. Flooring it in the dirt is how they
    // stayed in the trees after a wide exit.
    if (off > 0.05) {
      throttle = Math.min(throttle, 0.2);
      brake = Math.max(brake, Math.min(0.4, 0.1 + off * 0.16));
      hb = 0;
    }

    v.step(
      dt,
      {
        steer: this._steer,
        throttle: clamp(throttle, 0, 1),
        brake: clamp(brake, 0, 1),
        handbrake: hb,
        shiftUp: false,
        shiftDown: false,
      },
      track
    );
  }

  /**
   * Look at everyone else and decide how much to lift, brake, and move over.
   *
   * The player gets a much wider berth than another rival does: AM3 championship
   * cannot be lost to a shunt, so a rival's job around the player is to be an
   * obstacle you can lean on, never one that puts you in the scenery.
   *
   * Rival-vs-rival: DO NOT stack brake. Prefer a lane change and keep rolling —
   * hard brakes behind other AI caused the mid-road log-jam.
   *
   * @returns {{lift:number, brake:number, playerBlock:boolean, aheadClose:boolean, minThrottle:number, maxBrake:number}}
   */
  _readTraffic(pack, v, track, q, dt) {
    let lift = 1;
    let brakeFor = 0;
    let avoid = 0;
    let playerBlock = false;
    let aheadClose = false;
    let minThrottle = 0.55;
    let maxBrake = 0.22;
    const others = pack || [];
    for (let i = 0; i < others.length; i++) {
      const o = others[i];
      if (o === v) continue;
      const isPlayer = !o.ai;
      const respect = isPlayer ? AI.playerRespect : 1;
      const dx = o.position.x - v.position.x;
      const dz = o.position.z - v.position.z;
      const dist = Math.hypot(dx, dz);
      const dProg = (o.progress || 0) - v.progress;

      if (dProg > 0.4 && dProg < 18) {
        const oLat =
          o._aiLat != null
            ? o._aiLat
            : track.query(o.position.x, o.position.z, this._qOther, o.progress).lateral;
        const sameGroove = Math.abs(oLat - q.lateral) < (isPlayer ? 2.9 : 2.2);
        if (sameGroove) {
          const close = 1 - dProg / 18;
          if (isPlayer) {
            playerBlock = true;
            lift = Math.min(lift, 0.14 + dProg / 22);
            if (dProg < 9) brakeFor = Math.max(brakeFor, 0.2 + close * 0.48);
            if (dProg < 5.5) brakeFor = Math.max(brakeFor, 0.55);
            avoid += (q.lateral >= oLat ? 1 : -1) * close * 0.7 * respect;
          } else {
            // Rival ahead in our groove: move over hard, barely lift.
            aheadClose = aheadClose || dProg < 10;
            avoid += (q.lateral >= oLat ? 1 : -1) * (0.75 + close * 0.9);
            lift = Math.min(lift, 0.72 + dProg / 40);
            if (dProg < 3.2) {
              brakeFor = Math.max(brakeFor, 0.12 + close * 0.18);
              maxBrake = Math.max(maxBrake, 0.28);
            }
            minThrottle = Math.min(minThrottle, 0.48);
          }
        } else if (!isPlayer && dProg < 8 && dist < 9) {
          // Nearby rival, different lane — slight ease only.
          lift = Math.min(lift, 0.88);
        }
      }

      const near = isPlayer ? 6.8 * respect : 5.4;
      if (dist < near && dist > 0.04) {
        const fx = Math.sin(v.yaw);
        const fz = Math.cos(v.yaw);
        const rx = Math.cos(v.yaw);
        const rz = -Math.sin(v.yaw);
        const along = dx * fx + dz * fz;
        const right = dx * rx + dz * rz;
        if (along > -1.2 && along < (isPlayer ? 5.8 * respect : 4.2)) {
          avoid += (right > 0 ? -1 : 1) * (1 - dist / near) * (isPlayer ? 0.95 * respect : 1.15);
          if (along > 0.2 && dist < (isPlayer ? 4.8 * respect : 3.6)) {
            if (isPlayer) {
              playerBlock = true;
              lift = Math.min(lift, 0.18);
              brakeFor = Math.max(brakeFor, 0.34);
            } else {
              aheadClose = true;
              lift = Math.min(lift, 0.78);
              brakeFor = Math.max(brakeFor, 0.1);
              avoid += (right > 0 ? -1 : 1) * 0.55;
              minThrottle = Math.min(minThrottle, 0.5);
            }
          }
        }
      }
    }

    this._avoid += (clamp(avoid, -1.55, 1.55) - this._avoid) * (1 - Math.exp(-7.5 * dt));
    return { lift, brake: brakeFor, playerBlock, aheadClose, minThrottle, maxBrake };
  }

  syncMesh(alpha = 1) {
    const d = this.vehicle.drawPose(alpha);
    this.mesh.position.set(d.x, d.y, d.z);
    this.mesh.rotation.set(d.pitch, d.yaw, d.roll, "YXZ");
    applyWheelPose(this.mesh.userData.wheels || [], d.spin, d.steer, d.roll);
    const braking = this.vehicle.brake > 0.08 || this.vehicle.handbrake > 0.28;
    if (this.mesh.userData.brakeOn !== braking) {
      this.mesh.userData.brakeOn = braking;
      setBrakeLights(this.mesh, braking);
    }
  }
}

/** Coasting input, used only when a rival's brain throws. */
const ZERO_INPUT = {
  steer: 0,
  throttle: 0,
  brake: 0,
  handbrake: 0,
  shiftUp: false,
  shiftDown: false,
};

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function wrapHeading(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
