/**
 * vehicle-harness.mjs — deterministic headless maneuver rig for Vehicle.step().
 *
 * WHO THIS IS FOR: physics QA (qa-vehicle-dynamics.mjs, vehicle-dynamics-report.mjs).
 * WHAT IT DOES: builds synthetic wide "lab" ribbons on the REAL Track class
 *   (flat straight, constant grade, crest, verge) and drives the REAL Vehicle
 *   at FIXED_DT with scripted inputs, returning per-tick telemetry + metrics.
 * HOW IT CONNECTS: run node with
 *   --experimental-loader ./tools/qa-strip-query-loader.mjs
 */
import { Track } from "../../js/tracks/track.js";
import { Vehicle } from "../../js/physics/vehicle.js";
import { CARS, FIXED_DT } from "../../js/config.js";
import { resolveVehicleCollisions } from "../../js/physics/collide.js";

export const DT = FIXED_DT;
export const KMH = 3.6;

/** Build a lab course; pieces are raw Track pieces (no play-lane easing). */
export function labCourse(id, pieces, extra = {}) {
  return {
    id,
    name: id.toUpperCase(),
    difficulty: "lab",
    fog: 0xc8b898,
    sky: 0xc8b898,
    offroad: "dirt",
    scenery: "desert",
    startWidth: 40,
    startY: 0,
    seed: 11,
    barriers: false,
    pieces,
    ...extra,
  };
}

const cache = new Map();
/** Cached Track so repeated runs share spline builds. */
export function labTrack(key, pieces, extra) {
  if (cache.has(key)) return cache.get(key);
  // Off-road runoff uses the SAME surface as the ribbon so a slide that leaves
  // the paint still measures that surface (verge tests override `offroad`).
  const surf = pieces[0] && pieces[0].surface;
  const def = labCourse(key, pieces, { offroad: surf, startWidth: pieces[0] && pieces[0].width, ...extra });
  const t = new Track(def, { deferBuild: true });
  t._buildSpline(def.pieces, def);
  t.colliders = [];
  cache.set(key, t);
  return t;
}

/** Wide flat straight on one surface. */
export function flatTrack(surface, length = 3200, width = 52) {
  return labTrack(`flat-${surface}-${length}-${width}`, [{ type: "straight", length, surface, width }]);
}

/** Constant grade straight (dy metres over `length`). */
export function gradeTrack(surface, dy, length = 800, width = 60) {
  return labTrack(`grade-${surface}-${dy}-${length}`, [
    { type: "straight", length: 120, surface, width },
    { type: "straight", length, surface, width, dy },
    { type: "straight", length: 400, surface, width },
  ]);
}

export function makeCar(id = "celica", opts) {
  return new Vehicle(CARS[id], opts);
}

/** Spawn a car and optionally start with a given forward speed (m/s). */
export function spawnCar(track, id = "celica", dist = 8, lateral = 0, speedMs = 0, opts) {
  const v = makeCar(id, opts);
  v.spawn(track, dist, lateral);
  // Let the suspension settle on the grid.
  for (let i = 0; i < 90; i++) v.step(DT, { throttle: 0, brake: 0, steer: 0, handbrake: 0 }, track);
  if (speedMs > 0) {
    v.velocity.set(Math.sin(v.yaw) * speedMs, 0, Math.cos(v.yaw) * speedMs);
    v.speed = speedMs;
    // Gear + rpm consistent with ground speed (ground-rpm helper is private).
    // Pick the gear whose road-rpm sits in the powerband, then let rpm catch up.
    let g = 1;
    for (let k = 1; k <= v._topGear(); k++) if (v._groundRpm(k) < v.spec.redline * 0.88) { g = k; break; }
    v.gear = g;
    for (let i = 0; i < 24; i++) v.step(DT, { throttle: 0.55, brake: 0, steer: 0, handbrake: 0 }, track);
    v.velocity.set(Math.sin(v.yaw) * speedMs, 0, Math.cos(v.yaw) * speedMs);
  }
  return v;
}

/** Longitudinal / lateral body-frame velocity. */
export function bodyVel(v) {
  const s = Math.sin(v.yaw);
  const c = Math.cos(v.yaw);
  return { vx: v.velocity.x * s + v.velocity.z * c, vy: v.velocity.x * c - v.velocity.z * s };
}

/**
 * Generic runner. `ctl(t, v, i)` returns an input for each tick; `probe(v,t,i)`
 * is called after each step. Stops when `stop(v,t)` is true or tMax is hit.
 */
export function run(v, track, tMax, ctl, probe, stop) {
  const n = Math.ceil(tMax / DT);
  for (let i = 0; i < n; i++) {
    const t = i * DT;
    const inp = ctl(t, v, i);
    v.step(DT, inp, track);
    if (probe) probe(v, t + DT, i);
    if (stop && stop(v, t + DT)) return t + DT;
  }
  return n * DT;
}

export function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export const IN = (throttle = 0, brake = 0, steer = 0, handbrake = 0) => ({ throttle, brake, steer, handbrake });

export function finite(v) {
  return (
    Number.isFinite(v.position.x) &&
    Number.isFinite(v.position.y) &&
    Number.isFinite(v.position.z) &&
    Number.isFinite(v.yaw) &&
    Number.isFinite(v.speed) &&
    Number.isFinite(v.pitch) &&
    Number.isFinite(v.roll)
  );
}

/** 0→target (km/h) times on a flat straight. */
export function accelCurve(surface, car, targets = [100, 160], tMax = 40) {
  const tr = flatTrack(surface);
  const v = spawnCar(tr, car, 8);
  const out = {};
  let top = 0;
  let nan = false;
  run(
    v,
    tr,
    tMax,
    () => IN(1, 0, 0),
    (veh, t) => {
      const kmh = Math.abs(veh.speed) * KMH;
      for (const g of targets) if (out[g] == null && kmh >= g) out[g] = t;
      if (kmh > top) top = kmh;
      if (!finite(veh)) nan = true;
    },
    () => v.progress > tr.length - 30
  );
  out.top = top;
  out.nan = nan;
  out.gearTop = v.gear;
  return out;
}

/** Brake from `fromKmh` to rest (or <3 km/h); returns distance, time, peak pitch, steady decel. */
export function brakeStop(surface, car, fromKmh = 100, brake = 1) {
  const tr = flatTrack(surface);
  const v = spawnCar(tr, car, 8, 0, fromKmh / KMH);
  // Hold speed to target quickly via throttle
  run(v, tr, 12, (t, veh) => IN(Math.abs(veh.speed) * KMH < fromKmh ? 1 : 0.15, 0, 0), null, (veh) => Math.abs(veh.speed) * KMH >= fromKmh);
  const x0 = v.position.x;
  const z0 = v.position.z;
  const p0 = v.progress;
  let pitchPeak = 0;
  let yawDrift = 0;
  const y0 = v.yaw;
  const sp0 = Math.abs(v.speed);
  let tHit10 = null;
  const t = run(
    v,
    tr,
    12,
    () => IN(0, brake, 0),
    (veh, tt) => {
      const pit = veh.pitch - (veh._roadPitch || 0);
      if (Math.abs(pit) > Math.abs(pitchPeak)) pitchPeak = pit;
      yawDrift = Math.max(yawDrift, Math.abs(veh.yaw - y0));
      if (tHit10 == null && Math.abs(veh.speed) < sp0 * 0.1) tHit10 = tt;
    },
    (veh) => Math.abs(veh.speed) < 1
  );
  const dist = Math.hypot(v.position.x - x0, v.position.z - z0);
  return { dist, t, pitchPeak, yawDrift, startKmh: sp0 * KMH, decelG: sp0 / Math.max(0.1, t) / 9.81 };
}

/** Constant-radius ribbon (radius m) — 2 x 180 deg. */
export function circleTrack(surface, radius = 70, dir = 1) {
  return labTrack(`circ-${surface}-${radius}-${dir}`, [
    { type: "straight", length: 120, surface, width: 16 },
    { type: "curve", radius, angle: 170 * dir, surface, width: 16 },
    { type: "curve", radius, angle: 170 * dir, surface, width: 16 },
    { type: "straight", length: 200, surface, width: 16 },
  ]);
}

/**
 * Steady-state turn on a fixed-radius ribbon: a lateral/heading P-controller
 * rides the line, throttle P-holds speed. Report mean steer (understeer
 * gradient proxy), slip, lateral g, and max |lateral error|. If the car
 * cannot hold the line (plow) latErr grows and `held` is false.
 */
export function steadyTurn(surface, car, speedKmh, radius = 70) {
  const tr = circleTrack(surface, radius, 1);
  const v = spawnCar(tr, car, 100, 0, speedKmh / KMH);
  const want = speedKmh / KMH;
  const hist = [];
  let maxErr = 0;
  run(
    v,
    tr,
    6,
    (t, veh) => {
      const ahead = tr.sample(Math.min(tr.length - 1, veh.progress + 8 + want * 0.35));
      let dh = ahead.heading - veh.yaw;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      const here = tr.sample(veh.progress);
      const lat = (veh.position.x - here.x) * here.nx + (veh.position.z - here.z) * here.nz;
      const st = Math.max(-1, Math.min(1, dh * 2.4 - lat * 0.12));
      return IN(Math.max(0, Math.min(1, 0.4 + (want - Math.abs(veh.speed)) * 0.35)), 0, st);
    },
    (veh, t) => {
      const here = tr.sample(veh.progress);
      const lat = (veh.position.x - here.x) * here.nx + (veh.position.z - here.z) * here.nz;
      if (t > 2.5) maxErr = Math.max(maxErr, Math.abs(lat));
      if (t > 3.5) {
        const b = bodyVel(veh);
        hist.push({ yr: veh.yawRate, sp: Math.abs(veh.speed), st: veh.steer, slip: Math.atan2(b.vy, Math.max(1, Math.abs(b.vx))) });
      }
    }
  );
  const m = (k) => hist.reduce((a, h) => a + h[k], 0) / Math.max(1, hist.length);
  const sp = m("sp");
  return {
    steerMean: Math.abs(m("st")),
    speedKmh: sp * KMH,
    latG: (Math.abs(m("yr")) * sp) / 9.81,
    slipDeg: (Math.abs(m("slip")) * 180) / Math.PI,
    latErr: maxErr,
    held: maxErr < 5,
  };
}

/**
 * Turn-in / slide probe. Spawns on the far side of a 52 m ribbon, applies a
 * scripted pulse (`steer`, `throttle`, `brake`, `handbrake` for `hold` s) and
 * then releases to a neutral catch (steer 0, throttle `after`). Telemetry is
 * recorded only while the car is still on the paint so runoff/wall guidance
 * cannot contaminate the numbers.
 *
 * Returns: peak yaw rate, peak lat g, peak slip angle, slip at end of pulse,
 * yaw-rate settle time after release (|r|<0.15), and heading change.
 */
export function turnPulse(surface, car, speedKmh = 90, opts = {}) {
  const { steer = 1, throttle = 1, brake = 0, handbrake = 0, hold = 0.6, after = 0.7, tMax = 3.2, catchGain = 0 } = opts;
  const tr = flatTrack(surface, 3200, 52);
  const v = spawnCar(tr, car, 30, -22 * Math.sign(steer || 1), speedKmh / KMH);
  const yaw0 = v.yaw;
  let yawPeak = 0;
  let gPeak = 0;
  let slipPeak = 0;
  let slipEnd = 0;
  let tSettle = null;
  let slipAfterMax = 0;
  let yawEnd = 0;
  let spd0 = Math.abs(v.speed) * KMH;
  let spdEnd = spd0;
  let lastT = 0;
  run(
    v,
    tr,
    tMax,
    (t, veh) => {
      if (t < hold) return IN(throttle, brake, steer, handbrake);
      const b = bodyVel(veh);
      const slip = Math.atan2(b.vy, Math.max(1, Math.abs(b.vx)));
      return IN(after, 0, Math.max(-1, Math.min(1, -slip * catchGain)));
    },
    (veh, t) => {
      const q = veh._q;
      if (Math.abs(q.lateral || 0) > (q.width || 50) * 0.5 - 1.5) return;
      lastT = t;
      const b = bodyVel(veh);
      const slip = Math.atan2(b.vy, Math.max(1, Math.abs(b.vx)));
      const sd = (Math.abs(slip) * 180) / Math.PI;
      yawPeak = Math.max(yawPeak, Math.abs(veh.yawRate));
      gPeak = Math.max(gPeak, (Math.abs(veh.yawRate) * Math.abs(veh.speed)) / 9.81);
      slipPeak = Math.max(slipPeak, sd);
      if (t <= hold) {
        slipEnd = sd;
        yawEnd = Math.abs(veh.yawRate);
        spdEnd = Math.abs(veh.speed) * KMH;
      } else {
        slipAfterMax = Math.max(slipAfterMax, sd);
        if (tSettle == null && Math.abs(veh.yawRate) < 0.15) tSettle = t - hold;
      }
    }
  );
  let dy = v.yaw - yaw0;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  return {
    yawPeak,
    latGPeak: gPeak,
    slipPeakDeg: slipPeak,
    slipEndDeg: slipEnd,
    yawAtEnd: yawEnd,
    settleS: tSettle,
    slipAfterMaxDeg: slipAfterMax,
    speedLossKmh: spd0 - spdEnd,
    onPaintS: lastT,
  };
}

/** High-speed straight with zero steer: yaw / lateral drift over `t` s. */
export function straightStability(surface, car, speedKmh = 160, t = 8) {
  const tr = flatTrack(surface);
  const v = spawnCar(tr, car, 8, 0, speedKmh / KMH);
  const y0 = v.yaw;
  let yawMax = 0;
  let yrMax = 0;
  run(v, tr, t, () => IN(1, 0, 0), (veh) => {
    yawMax = Math.max(yawMax, Math.abs(veh.yaw - y0));
    yrMax = Math.max(yrMax, Math.abs(veh.yawRate));
  });
  return { yawDeg: (yawMax * 180) / Math.PI, yawRateMax: yrMax, endKmh: Math.abs(v.speed) * KMH };
}

/** Second-difference jitter on a long straight drive (m, rad). */
export function jitter(surface, car, t = 12, steerAmp = 0) {
  const tr = flatTrack(surface);
  const v = spawnCar(tr, car, 8);
  const P = [];
  const A = [];
  run(
    v,
    tr,
    t,
    (tt) => IN(1, 0, steerAmp * Math.sin(tt * 2.0)),
    (veh) => {
      P.push([veh.position.x, veh.position.y, veh.position.z]);
      A.push([veh.pitch, veh.roll, veh.yaw]);
    }
  );
  let maxY2 = 0;
  let maxXZ2 = 0;
  let maxP2 = 0;
  let maxR2 = 0;
  let maxYaw2 = 0;
  for (let i = 4; i < P.length - 1; i++) {
    const d2y = P[i + 1][1] - 2 * P[i][1] + P[i - 1][1];
    maxY2 = Math.max(maxY2, Math.abs(d2y));
    const d2x = P[i + 1][0] - 2 * P[i][0] + P[i - 1][0];
    const d2z = P[i + 1][2] - 2 * P[i][2] + P[i - 1][2];
    maxXZ2 = Math.max(maxXZ2, Math.hypot(d2x, d2z));
    maxP2 = Math.max(maxP2, Math.abs(A[i + 1][0] - 2 * A[i][0] + A[i - 1][0]));
    maxR2 = Math.max(maxR2, Math.abs(A[i + 1][1] - 2 * A[i][1] + A[i - 1][1]));
    let dyw = A[i + 1][2] - 2 * A[i][2] + A[i - 1][2];
    while (dyw > Math.PI) dyw -= Math.PI * 2;
    while (dyw < -Math.PI) dyw += Math.PI * 2;
    maxYaw2 = Math.max(maxYaw2, Math.abs(dyw));
  }
  return { d2y: maxY2, d2xz: maxXZ2, d2pitch: maxP2, d2roll: maxR2, d2yaw: maxYaw2 };
}

/** Constant grade accel and brake: time 40→100 km/h up/down, brake distance from 80. */
export function gradeRun(surface, car, dy) {
  const tr = gradeTrack(surface, dy, 800);
  const v = spawnCar(tr, car, 8, 0, 40 / KMH);
  let t100 = null;
  let tStart = null;
  run(
    v,
    tr,
    25,
    () => IN(1, 0, 0),
    (veh, t) => {
      const k = Math.abs(veh.speed) * KMH;
      if (tStart == null && veh.progress > 130) tStart = t;
      if (t100 == null && k >= 100) t100 = t;
    },
    (veh) => veh.progress > 900
  );
  return { tTo100: t100, endKmh: Math.abs(v.speed) * KMH, progress: v.progress };
}

/** Jump lab: ramp + gap + landing pad (same piece shape as COURSES.physlab). */
export function jumpTrack(surface = "dirt", rise = 3.4) {
  return labTrack(`jump-${surface}-${rise}`, [
    { type: "straight", length: 200, surface, width: 13 },
    { type: "jump", ramp: 22, rise, lip: 6, gap: 16, drop: 2.4, land: 24, surface, width: 13 },
    { type: "straight", length: 260, surface, width: 13 },
  ]);
}

/**
 * Fly the jump lab. `air(t,v)` returns the input while airborne, `ground` is
 * the approach input. Metrics: airtime, apex above lip, touchdown speed ratio,
 * touchdown pitch, bounce count after first touch, settle time, max |yawRate|
 * after landing, whether the car ended on the road deck.
 */
export function jumpFlight(surface, car, kmh = 110, air = () => IN(1, 0, 0), rise = 3.4, approach = () => IN(1, 0, 0)) {
  const tr = jumpTrack(surface, rise);
  const v = spawnCar(tr, car, 40, 0, kmh / KMH);
  let wasAir = false;
  let tAir0 = null;
  let airtime = 0;
  let spdBefore = 0;
  let touchSpeed = null;
  let touchPitch = null;
  let touchT = null;
  let apex = -1e9;
  let y0 = null;
  let bounces = 0;
  let prevGround = true;
  let settleT = null;
  let yawAfter = 0;
  let lastUnsettled = 0;
  let nan = false;
  let spd05 = null;
  let spdMinAfter = 1e9;
  const ys = [];
  run(
    v,
    tr,
    9,
    (t, veh) => (veh.onGround ? approach(t, veh) : air(t, veh)),
    (veh, t) => {
      if (!finite(veh)) nan = true;
      if (!veh.onGround) {
        if (!wasAir) {
          wasAir = true;
          tAir0 = t;
          spdBefore = Math.abs(veh.speed) * KMH;
          y0 = veh.position.y;
        }
        apex = Math.max(apex, veh.position.y - y0);
      }
      if (wasAir && veh.onGround && !prevGround && touchT == null && t - tAir0 > 0.25) {
        touchT = t;
        airtime = t - tAir0;
        touchSpeed = Math.abs(veh.speed) * KMH;
        touchPitch = veh.pitch;
      } else if (touchT != null && veh.onGround && !prevGround) {
        bounces++;
      }
      if (touchT != null) {
        ys.push([t, veh.position.y, veh.pitch, veh.roll]);
        yawAfter = Math.max(yawAfter, Math.abs(veh.yawRate));
        spdMinAfter = Math.min(spdMinAfter, Math.abs(veh.speed) * KMH);
        if (spd05 == null && t - touchT >= 0.5) spd05 = Math.abs(veh.speed) * KMH;
      }
      prevGround = veh.onGround;
    }
  );
  // Settle: first time after touch where |pitch| and |roll| stay < 0.03 for 0.3 s.
  let ok = 0;
  for (let i = 1; i < ys.length; i++) {
    const calm = Math.abs(ys[i][2]) < 0.04 && Math.abs(ys[i][3]) < 0.03 && Math.abs(ys[i][1] - ys[i - 1][1]) < 0.01;
    ok = calm ? ok + 1 : 0;
    if (ok >= 18 && settleT == null) settleT = ys[i][0] - 0.3 - touchT;
  }
  void lastUnsettled;
  return {
    airtime,
    apex: Math.max(0, apex),
    keep: touchSpeed != null && spdBefore > 0 ? touchSpeed / spdBefore : null,
    spdBefore,
    touchSpeed,
    touchPitch,
    keep05: spd05 != null && spdBefore > 0 ? spd05 / spdBefore : null,
    minAfterKeep: spdMinAfter < 1e8 && spdBefore > 0 ? spdMinAfter / spdBefore : null,
    bounces,
    settleS: settleT,
    yawAfter,
    nan,
    ended: v.progress,
  };
}

/** Throttle-on 0→N km/h accel on a constant grade, then brake from speed. */
export function gradeDynamics(surface, car, dyTotal) {
  const len = 800;
  const tr = labTrack(`grade2-${surface}-${dyTotal}`, [
    { type: "straight", length: 100, surface, width: 20 },
    { type: "straight", length: len, surface, width: 20, dy: dyTotal },
    { type: "straight", length: 300, surface, width: 20 },
  ]);
  const v = spawnCar(tr, car, 20, 0, 50 / KMH);
  // accel from 50 km/h for 4 s, record speed gain
  const s0 = Math.abs(v.speed) * KMH;
  run(v, tr, 4, () => IN(1, 0, 0), null);
  const gain = Math.abs(v.speed) * KMH - s0;
  // brake from here to 40 km/h (distance)
  const p0 = v.progress;
  let tb = 0;
  tb = run(v, tr, 6, () => IN(0, 1, 0), null, (veh) => Math.abs(veh.speed) * KMH < 20);
  return { gain4s: gain, brakeDist: v.progress - p0, brakeT: tb, pitchRoad: v._roadPitch };
}

/** Course with a grippy road and a differing off-road apron. */
export function vergeTrack(roadSurf = "tarmac", offroad = "grass") {
  return labTrack(`verge-${roadSurf}-${offroad}`, [{ type: "straight", length: 1500, surface: roadSurf, width: 12 }], { offroad });
}

/** Drive on the verge at +3 m past the paint edge for `t` s, then steer back. */
export function vergeRun(roadSurf, offroad, car = "celica", speedKmh = 100) {
  const tr = vergeTrack(roadSurf, offroad);
  const v = spawnCar(tr, car, 30, 0, speedKmh / KMH);
  const road = spawnCar(tr, car, 30, 0, speedKmh / KMH);
  const target = 6 + 3;
  let latMax = 0;
  let tBack = null;
  const here = (veh) => {
    const s = tr.sample(veh.progress);
    return (veh.position.x - s.x) * s.nx + (veh.position.z - s.z) * s.nz;
  };
  run(
    v,
    tr,
    6,
    (t, veh) => IN(1, 0, Math.max(-1, Math.min(1, ((target - here(veh)) * 0.08 + angDiff(tr.sample(veh.progress).heading, veh.yaw) * 1.6)))),
    (veh) => {
      latMax = Math.max(latMax, Math.abs(here(veh)));
    }
  );
  run(road, tr, 6, () => IN(1, 0, 0), null);
  const spdVerge = Math.abs(v.speed) * KMH;
  const spdRoad = Math.abs(road.speed) * KMH;
  const latAt = here(v);
  // Recovery: steer to center
  tBack = run(
    v,
    tr,
    8,
    (t, veh) => IN(1, 0, Math.max(-1, Math.min(1, -here(veh) * 0.08 + angDiff(tr.sample(veh.progress).heading, veh.yaw) * 1.6))),
    null,
    (veh) => Math.abs(here(veh)) < 5
  );
  return { spdVerge, spdRoad, ratio: spdVerge / spdRoad, latAt, latMax, recoverS: tBack, recoverSpeedKmh: Math.abs(v.speed) * KMH, finite: finite(v) };
}

/** Road → other surface transition at speed; yaw/lateral shock + speed. */
export function transitionRun(fromS, toS, car = "celica", kmh = 120) {
  const tr = labTrack(`trans-${fromS}-${toS}`, [
    { type: "straight", length: 260, surface: fromS, width: 14 },
    { type: "straight", length: 600, surface: toS, width: 14 },
  ]);
  const v = spawnCar(tr, car, 60, 0, kmh / KMH);
  let yrMax = 0;
  let vyMax = 0;
  let steerNeed = 0;
  let spd0 = Math.abs(v.speed) * KMH;
  let spdMin = 1e9;
  let latMax = 0;
  let prevSpd = spd0;
  let decelMaxG = 0;
  const P = [];
  run(
    v,
    tr,
    6,
    (t, veh) => {
      const s = tr.sample(veh.progress);
      const lat = (veh.position.x - s.x) * s.nx + (veh.position.z - s.z) * s.nz;
      return IN(1, 0, Math.max(-1, Math.min(1, -lat * 0.08 + angDiff(s.heading, veh.yaw) * 1.6)));
    },
    (veh, t) => {
      const b = bodyVel(veh);
      if (veh.progress > 230 && veh.progress < 400) {
        yrMax = Math.max(yrMax, Math.abs(veh.yawRate));
        vyMax = Math.max(vyMax, Math.abs(b.vy));
        const sp = Math.abs(veh.speed) * KMH;
        decelMaxG = Math.max(decelMaxG, (prevSpd - sp) / 3.6 / DT / 9.81);
        spdMin = Math.min(spdMin, sp);
      }
      prevSpd = Math.abs(veh.speed) * KMH;
      P.push(veh.pitch);
    }
  );
  return { yawRateMax: yrMax, vyMax, spdMinKmh: spdMin, decelMaxG, finite: finite(v), speedEnd: Math.abs(v.speed) * KMH };
}

/** Run an identical script on two fresh vehicles and report max divergence. */
export function determinism(car = "celica", lowDetail = false) {
  const tr = flatTrack("dirt");
  const a = spawnCar(tr, car, 8, 0, 0, { lowDetail });
  const b = spawnCar(tr, car, 8, 0, 0, { lowDetail });
  let div = 0;
  const script = (t) => IN(1, t > 5 && t < 6 ? 0.8 : 0, Math.sin(t * 1.3) * (t > 3 ? 0.6 : 0), t > 8 && t < 8.3 ? 1 : 0);
  for (let i = 0; i < 600; i++) {
    const inp = script(i * DT);
    a.step(DT, { ...inp }, tr);
    b.step(DT, { ...inp }, tr);
    div = Math.max(div, Math.abs(a.position.x - b.position.x) + Math.abs(a.position.z - b.position.z) + Math.abs(a.yaw - b.yaw));
  }
  return { divergence: div, nan: !finite(a) || !finite(b) };
}

/**
 * Drive past / into a circular rock. `carLat` = car lateral (m, + right),
 * `rockLat` = rock lateral. Road is 14 m wide (half 7). A rock with the car
 * centre still on paint is a ghost for head-on hits (open-lane rule), so the
 * head-on case lives on the verge (|lat| > 7).
 */
export function rockHit(car = "celica", kmh = 100, carLat = 6.3, rockLat = 8.0) {
  const tr = labTrack("rock-dirt", [{ type: "straight", length: 1500, surface: "dirt", width: 14 }]);
  const v = spawnCar(tr, car, 40, 0, kmh / KMH);
  // Move onto the target lateral without disturbing speed.
  const s0 = tr.sample(v.progress);
  v.position.x = s0.x + s0.nx * carLat;
  v.position.z = s0.z + s0.nz * carLat;
  for (let i = 0; i < 30; i++) v.step(DT, IN(0.6, 0, 0), tr);
  const s = tr.sample(v.progress + 60);
  tr.colliders = [{ x: s.x + s.nx * rockLat, z: s.z + s.nz * rockLat, r: 0.9 }];
  const pRock = v.progress + 60;
  const spd0 = Math.abs(v.speed) * KMH;
  let yawMax = 0;
  let yMax = -1e9;
  let yMin = 1e9;
  let spdMin = 1e9;
  let tStuck = 0;
  let contacts = 0;
  run(
    v,
    tr,
    6,
    (t, veh) => IN(1, 0, 0),
    (veh, t) => {
      yawMax = Math.max(yawMax, Math.abs(veh.yawRate));
      yMax = Math.max(yMax, veh.position.y);
      yMin = Math.min(yMin, veh.position.y);
      if (veh.progress > pRock - 6) spdMin = Math.min(spdMin, Math.abs(veh.speed) * KMH);
      if (veh.progress > pRock - 2 && Math.abs(veh.speed) < 3) tStuck += DT;
      if (veh._envIntersect) contacts++;
    }
  );
  tr.colliders = [];
  return { speedLoss: spd0 - spdMin, spd0, yawMax, ySpan: yMax - yMin, endKmh: Math.abs(v.speed) * KMH, passed: v.progress > pRock + 6, stuckS: tStuck, contacts, finite: finite(v) };
}

/**
 * Car-car: `rear` (AI, fast) runs into `front` (player, slower) on a straight.
 * Same pass the game runs after every physics step. Reports energy gain,
 * yaw disturbance handed to the player, penetration at end, NaN, tunnelling.
 */
export function carCar(rearKmh = 130, frontKmh = 80, lateralOffset = 0.0) {
  const tr = flatTrack("dirt", 3200, 20);
  const mk = () => {
    const front = spawnCar(tr, "celica", 60, 0, frontKmh / KMH);
    const rear = spawnCar(tr, "celica", 52, lateralOffset, rearKmh / KMH, { lowDetail: true });
    rear.ai = true;
    return [front, rear];
  };
  const ke = (v) => 0.5 * v.spec.mass * (v.velocity.x ** 2 + v.velocity.z ** 2);
  const [cf, cr] = mk(); // control: same inputs, no contact resolve
  const [front, rear] = mk();
  let keVsControlMax = 0;
  let yawFront = 0;
  let tunnel = false;
  let frontDvMax = 0;
  const fv0 = Math.abs(front.speed);
  for (let i = 0; i < 240; i++) {
    cf.step(DT, IN(0.6, 0, 0), tr);
    cr.step(DT, IN(1, 0, 0), tr);
    front.step(DT, IN(0.6, 0, 0), tr);
    rear.step(DT, IN(1, 0, 0), tr);
    resolveVehicleCollisions([front, rear]);
    if (rear.progress - front.progress > 2.2) tunnel = true;
    yawFront = Math.max(yawFront, Math.abs(front.yawRate));
    frontDvMax = Math.max(frontDvMax, Math.abs(Math.abs(front.speed) - fv0));
    keVsControlMax = Math.max(keVsControlMax, (ke(front) + ke(rear)) / (ke(cf) + ke(cr)));
  }
  return {
    keVsControlMax,
    yawFrontMax: yawFront,
    frontDvMax: frontDvMax * KMH,
    tunnelled: tunnel,
    finite: finite(front) && finite(rear),
    endGap: front.progress - rear.progress,
    rearEndKmh: Math.abs(rear.speed) * KMH,
    frontEndKmh: Math.abs(front.speed) * KMH,
  };
}
