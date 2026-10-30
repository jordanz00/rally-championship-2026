/**
 * vehicle-metrics.mjs — the maneuver matrix (one place, shared by the report
 * and the gate). Every number comes from Vehicle.step() on a real Track.
 *
 * WHO THIS IS FOR: physics QA. WHAT IT DOES: runs the matrix and returns a
 * flat object of metrics. HOW IT CONNECTS: qa-vehicle-dynamics.mjs asserts
 * bands on it; vehicle-dynamics-report.mjs prints it (BEFORE/AFTER table).
 */
import * as H from "./vehicle-harness.mjs";

const SURFS = ["tarmac", "cobble", "grass", "dirt", "gravel", "sand", "mud"];
const CARS_ = ["celica", "delta", "stratos"];

/** Yaw rate (rad/s) one second after a held stick, throttle on, 52 m ribbon. */
export function steerSweep(surface, kmh, throttle = 1, sticks = [0.05, 0.08, 0.12, 0.16, 0.2, 0.25, 0.3, 0.4, 0.55, 0.7, 1.0]) {
  const out = [];
  for (const stIn of sticks) {
    const tr = H.flatTrack(surface, 3200, 52);
    const v = H.spawnCar(tr, "celica", 30, -22, kmh / H.KMH);
    let yr = 0;
    H.run(v, tr, 1.1, () => H.IN(throttle, 0, stIn), (veh, t) => {
      if (t > 0.9) yr = veh.yawRate;
    });
    out.push(yr);
  }
  let maxStep = 0;
  let peak = 0;
  for (let i = 0; i < out.length; i++) {
    peak = Math.max(peak, out[i]);
    if (i > 0) maxStep = Math.max(maxStep, (out[i] - out[i - 1]) / ((sticks[i] - sticks[i - 1]) / 0.04));
  }
  return { yaw: out, sticks, maxStepPer004: maxStep, peak, full: out[out.length - 1], fullOverPeak: out[out.length - 1] / peak };
}

/** Fixed-gear (3rd) 1.5 s throttle gain from 80 km/h on a constant grade. */
export function gradeGain(surface, dy) {
  const tr = H.labTrack(`g3-${surface}-${dy}`, [
    { type: "straight", length: 80, surface, width: 20 },
    { type: "straight", length: 900, surface, width: 20, dy },
    { type: "straight", length: 300, surface, width: 20 },
  ]);
  const v = H.spawnCar(tr, "celica", 90, 0, 80 / H.KMH);
  v.autoTrans = false;
  v.gear = 3;
  // Let the slope slew in, then measure.
  H.run(v, tr, 0.6, () => H.IN(1, 0, 0));
  const s0 = Math.abs(v.speed) * H.KMH;
  H.run(v, tr, 1.5, () => H.IN(1, 0, 0));
  return { gain: Math.abs(v.speed) * H.KMH - s0, slope: v._slope };
}

/** Verge hold at `pastEdge` m beyond the paint (road is 12 m wide). */
export function verge(roadSurf, off, pastEdge) {
  const tr = H.vergeTrack(roadSurf, off);
  const ref = H.spawnCar(tr, "celica", 30, 0, 100 / H.KMH);
  const here = (veh) => {
    const s = tr.sample(veh.progress);
    return (veh.position.x - s.x) * s.nx + (veh.position.z - s.z) * s.nz;
  };
  const target = 6 + pastEdge;
  const v2 = H.spawnCar(tr, "celica", 30, 0, 100 / H.KMH);
  H.run(v2, tr, 6, (t, veh) => H.IN(1, 0, Math.max(-1, Math.min(1, (target - here(veh)) * 0.08 + H.angDiff(tr.sample(veh.progress).heading, veh.yaw) * 1.6))));
  H.run(ref, tr, 6, () => H.IN(1, 0, 0));
  const spdV = Math.abs(v2.speed) * H.KMH;
  const spdR = Math.abs(ref.speed) * H.KMH;
  const tBack = H.run(
    v2,
    tr,
    8,
    (t, veh) => H.IN(1, 0, Math.max(-1, Math.min(1, -here(veh) * 0.08 + H.angDiff(tr.sample(veh.progress).heading, veh.yaw) * 1.6))),
    null,
    (veh) => Math.abs(here(veh)) < 5
  );
  return { ratio: spdV / spdR, spdV, spdR, recoverS: tBack, lat: here(v2) };
}

/** The whole matrix. `quick` skips the slow per-car/per-surface fan-outs. */
export function collect({ quick = false, log = () => {} } = {}) {
  const M = {};
  const t0 = Date.now();
  const step = (name, fn) => {
    M[name] = fn();
    log(`${name} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  };

  // 1) accel per car (tarmac + dirt) and per surface (celica)
  for (const c of quick ? ["celica", "delta", "stratos"] : CARS_) {
    step(`accel.${c}.tarmac`, () => H.accelCurve("tarmac", c, [100, 160], 45));
    step(`brake.${c}.tarmac`, () => H.brakeStop("tarmac", c, 100));
  }
  for (const s of SURFS) {
    step(`accel.celica.${s}`, () => H.accelCurve(s, "celica", [100], 30));
    step(`brake.celica.${s}`, () => H.brakeStop(s, "celica", 100));
    step(`turn.celica.${s}`, () => H.turnPulse(s, "celica", 90, { steer: 1, throttle: 1, hold: 0.6 }));
  }
  step("brake.celica.tarmac.60", () => H.brakeStop("tarmac", "celica", 60));

  // 2) steering response curve (cliff / inversion)
  step("sweep.tarmac90", () => steerSweep("tarmac", 90));
  step("sweep.tarmac130", () => steerSweep("tarmac", 130));
  step("sweep.dirt90", () => steerSweep("dirt", 90));
  step("sweep.sand60", () => steerSweep("sand", 60));

  // 3) steady-state circle R=70
  for (const s of ["tarmac", "dirt", "sand"]) {
    for (const k of [60, 100]) step(`circle.${s}.${k}`, () => H.steadyTurn(s, "celica", k, 70));
  }

  // 4) slides: handbrake flick, brake-in, lift-off, with/without countersteer
  for (const s of ["tarmac", "dirt", "sand", "mud"]) {
    step(`hb.${s}`, () => H.turnPulse(s, "celica", 90, { handbrake: 1, hold: 0.5 }));
    step(`brk.${s}`, () => H.turnPulse(s, "celica", 90, { throttle: 0, brake: 1, hold: 0.6 }));
    step(`lift.${s}`, () => H.turnPulse(s, "celica", 90, { throttle: 0, hold: 0.6, after: 0 }));
  }
  step("hb.dirt.catch", () => H.turnPulse("dirt", "celica", 90, { handbrake: 1, hold: 0.5, catchGain: 3, after: 0.7 }));

  // 5) landing
  step("jump.flat", () => H.jumpFlight("dirt", "celica", 110, () => H.IN(1, 0, 0)));
  step("jump.tap", () => H.jumpFlight("dirt", "celica", 110, () => H.IN(0, 0.4, 0)));
  step("jump.sand", () => H.jumpFlight("sand", "celica", 110, () => H.IN(1, 0, 0)));

  // 6) hills (gear locked) + brake on grade
  for (const s of ["tarmac", "dirt"]) {
    for (const dy of [-48, 0, 48]) step(`grade.${s}.${dy}`, () => gradeGain(s, dy));
  }
  for (const dy of [-48, 0, 48]) step(`gradeBrake.tarmac.${dy}`, () => H.gradeDynamics("tarmac", "celica", dy));

  // 7) verge + transitions
  step("verge.grass.3", () => verge("tarmac", "grass", 3));
  step("verge.dirt.3", () => verge("dirt", "dirt", 3));
  step("verge.sand.3", () => verge("tarmac", "sand", 3));
  step("verge.grass.10", () => verge("tarmac", "grass", 10));
  step("verge.sand.10", () => verge("tarmac", "sand", 10));
  step("trans.tarmac>sand", () => H.transitionRun("tarmac", "sand"));
  step("trans.tarmac>mud", () => H.transitionRun("tarmac", "mud"));
  step("trans.dirt>tarmac", () => H.transitionRun("dirt", "tarmac"));

  // 8) stability + jitter
  step("stab.tarmac150", () => H.straightStability("tarmac", "celica", 150, 8));
  step("stab.dirt150", () => H.straightStability("dirt", "celica", 150, 8));
  step("jit.tarmac.straight", () => H.jitter("tarmac", "celica", 10, 0));
  step("jit.dirt.slalom", () => H.jitter("dirt", "celica", 10, 0.5));

  // 9) collisions + determinism
  step("rock.side", () => H.rockHit("celica", 100, 6.3, 8.0));
  step("rock.head", () => H.rockHit("celica", 100, 9, 9));
  step("carcar.rear", () => H.carCar(130, 80, 0));
  step("carcar.offset", () => H.carCar(130, 80, 1.2));
  step("det.player", () => H.determinism("celica", false));
  step("det.ai", () => H.determinism("celica", true));
  return M;
}
