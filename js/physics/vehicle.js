/**
 * Rally vehicle — arcade chassis with GTA IV rival weight.
 *
 * WHO THIS IS FOR: anyone tuning driving feel, slides, or drivetrain.
 * WHAT IT DOES: fixed-step body-frame sim. Drive and brake go through the
 *   gearbox and Pacejka. Turning is an arcade bicycle PLUS tire yaw moment
 *   (Mz from Pacejka Fy — RAGE cars rotate from tires, not kinematics) PLUS
 *   load transfer so the same corner is different at a different speed or
 *   pedal. Body roll and brake-dive are the UI of mass; wheels stay
 *   road-upright (AM3 / Model 2: cabinet tips, tires stay planted).
 *
 * GTA IV PRINCIPLES (rival, not a clone — handling.dat analog in HANDLING):
 *   1. Delayed chain: steer → weight → tires load → THEN yaw (Izz + Mz blend).
 *   2. CurveMax vs CurveMin: peak then a LOWER slide grip; the gap IS the drift.
 *   3. Speed changes the car: snappy hairpin, boat at 200, lift-off tail.
 *   4. Slide is a tool: handbrake / power / trail-brake / lift; catch = switch.
 *   5. Heavy rack + self-align at speed. 6. Engine brake on lift. 7. Roll/dive.
 *   8. brakeHold per surface (no ABS heroics on mud). 9. 4WD Sultan vs 2WD Comet.
 *   10. Fair: no RNG in step(). 11. IV not V — looser, longer slides.
 * HOW IT CONNECTS: GameLoop steps this; Track.query feeds the surface; the
 *   Celica mesh follows pose. AI uses the same step() with `lowDetail` on
 *   (cheaper road probes, fewer tire substeps) but the same planted hull.
 *
 * THE THREE THINGS THAT MAKE THIS SEGA RALLY (docs/AM3-RESEARCH.md §2):
 *
 *  1. SURFACE IS THE MECHANIC. Every surface owns its own stopping distance
 *     (brakeHold + muPeak/muSlide), its own breakaway point (slipPeak), and its
 *     own recovery character (slideHold + gripSnap). Braking on tarmac stops
 *     you; braking on mud rotates you, because brakeYaw turns the pedal into
 *     yaw instead of deceleration. When a texture change catches one axle
 *     before the other you get a staggered drift, not a uniform grip step.
 *  2. THE SLIDE IS A TOOL. Countersteer gets a large, predictable authority
 *     boost so opposite lock feels like a switch, and throttle widens the slide
 *     on loose ground while pulling it straight on hard ground. Nothing here
 *     spins the car for you and nothing catches it for you.
 *  3. BUMPS AND JUMPS COST YOU. Roughness is a function of distance AND lateral
 *     offset, so no single line is smooth. Jump technique lives in
 *     js/physics/jump.js: lift and brake into the lip to land flat, or go
 *     flat-out and pay for it.
 *
 * Determinism: step() is called on a fixed dt by the game loop. Nothing in here
 * reads a clock, RNG, or the frame rate. Opponents differ only by
 * running fewer tire substeps.
 */

import * as THREE from "../../vendor/three.module.js";
import { CELICA, ROAD_DECK, HANDLING, JUMP } from "../config.js?v=138";
import { blendSurfaces, gripGap } from "./surfaces.js?v=46";
import { bounceOffRoad, glanceObstacles } from "./collide.js?v=37";
import { JumpModel } from "./jump.js?v=13";

const TMP = {
  fwd: new THREE.Vector3(),
  right: new THREE.Vector3(),
};

const G = 9.81;
/** Hard integrator ceiling. Real yaw is capped per-speed inside _integrate. */
const MAX_YAW_RATE = 2.35;
const MAX_YAW_HANDBRAKE = 3.45;
/**
 * Wheel rotational inertia (kg·m²). Light wheels + Pacejka + launch torque
 * formed a longitudinal hop that the hull still showed after visual squat
 * was removed. Heavier hubs kill the oscillator without dulling burnout.
 */
const WHEEL_I = 6.4;
const RHO = 1.225;
const FRONTAL_A = 1.92;
const RELAX_LEN = 0.055;
/**
 * Longitudinal slip relaxation (m). Kappa used to be algebraic, so wheel
 * inertia + Pacejka + bang-bang TC formed a 240 Hz hop that shoved the hull
 * forward and back on throttle. This is the same first-order lag as slip
 * angle, a bit longer so the oscillator dies without dulling burnout.
 */
const RELAX_KAPPA = 0.22;
/**
 * Tiny embed through the visual tarmac (query.height already includes ROAD_DECK).
 * Origin is the contact patch after plantOnContactPatch — 9 cm used to bury
 * the sidewalls. A centimetre is enough to kill z-fight without a sink.
 */
const TIRE_PLANT = 0.014;
/**
 * Grounded contact may chatter a few centimetres but must never hover
 * above the painted deck after a jump (filter lag used to leave a gap).
 */
const GROUND_HOVER_MAX = 0.05;
/** Hard cap on road-follow pitch (~31°). Weight-transfer squat stays much smaller. */
const ROAD_PITCH_MAX = 0.55;
/**
 * Max axle-pitch change per second (~200°/s). Real ramps stay under this;
 * a noisy Track.query spike is a 10° twitch in one step and is what we cut.
 */
const SLOPE_SLEW = 3.5;
/**
 * Visual road-pitch follow (1/s) and deadzone (rad). Physics `_slope` stays
 * on SLOPE_SLEW so gravity still bites hills; the mesh ignores sub-degree
 * axle chatter that reads as a springy body on throttle.
 */
const VIS_PITCH_RATE = 16;
const VIS_PITCH_DEADZONE = 0.01;
/** Real grade change (rad) — snap the mesh onto the axle plane, not chatter. */
const VIS_PITCH_SNAP = 0.035;
/** Player chassis long-accel filter (1/s). Applied force, not load-transfer `_ax`. */
const AX_DRIVE_RATE = 11;
/**
 * Filter only sub-centimetre ribbon noise (1/s). Large deck errors use
 * HANDLING.deckFollowRate so hills do not leave a 30 cm float/sink lag.
 */
const DECK_FILT_RATE = 28;
const DECK_NOISE_BAND = 0.022;
/**
 * Baseline rate (1/s) at which lateral velocity bleeds away with no input.
 * Divided by the surface slideHold, so this sets the overall "how long does a
 * slide last" feel and the surface table sets the spread between mud and tarmac.
 */
/** Baseline lateral bleed (1/s). Slides use HANDLING.driftBleedMul / handbrakeBleedMul. */
const LAT_BLEED = 4.55;
/**
 * How much of a front-vs-rear surface mismatch shows up as a grip split, and
 * how much of it shows up as a direct yaw moment. Together these are the
 * "uniquely staggered drift" — one axle finds the new ribbon first and the car
 * pivots about it, which you can aim on purpose once you can feel it.
 */
const AXLE_SPLIT_MU = 0.14;
const AXLE_SPLIT_YAW = 0.28;
/**
 * Speed (m/s) under which the driveline stops being able to hold the car still.
 *
 * WHY THIS EXISTS: engine braking is modelled as a drag force and idle torque as
 * a push. Both survive to a standstill, and at walking pace they add up to
 * almost exactly the pull of a 10° hill — so the car used to park itself on a
 * hairpin instead of rolling back down it, which the research explicitly rules
 * out ("gravity/inertia strong enough that a car left on a slope rolls back").
 * Above this speed nothing is changed, so lift-off deceleration still feels the
 * same everywhere it matters.
 */
const DRIVELINE_FADE_SPEED = 3.5;
/**
 * Share of the "may hold the car" force budget given to idle drive torque, with
 * the rest going to engine braking plus rolling resistance. The budget itself is
 * the pull of a HANDLING.stictionSlope grade, so by construction flat ground
 * still comes to a clean stop and ANY hill steeper than that always wins.
 */
const IDLE_DRIVE_SHARE = 0.45;
/**
 * Bounds on the per-surface slide-angle ceiling multiplier, taken from the
 * surface's slideHold. Tarmac lands near the floor (a tidy, shallow angle you
 * have to be neat with) and mud near the ceiling (it will sit properly sideways
 * and wait for you). Keeping a floor above zero means no surface ever loses the
 * ability to slide at all.
 */
const SLIDE_CAP_MIN = 0.9;
const SLIDE_CAP_MAX = 1.78;

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Shortest-path lerp of two headings, radians. */
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Move `cur` toward `want` by at most `maxDelta`. */
function slew(cur, want, maxDelta) {
  const d = want - cur;
  if (d > maxDelta) return cur + maxDelta;
  if (d < -maxDelta) return cur - maxDelta;
  return want;
}

/**
 * Mushy grip cap — extra demand still arrives, but with diminishing yaw.
 * A hard clamp is a rail; this is GTA IV's "the tires are going" feel.
 * @param {number} v signed demand
 * @param {number} lim grip ceiling (>0)
 * @param {number} mush extra that still leaks through (0.3–0.5)
 */
function softLimit(v, lim, mush) {
  const a = Math.abs(v);
  if (!(lim > 1e-6) || a <= lim) return v;
  const extra = a - lim;
  const leak = mush > 0 ? mush : 0.4;
  return Math.sign(v) * (lim + extra / (1 + extra / (lim * leak)));
}

function sign(v) {
  return v < 0 ? -1 : v > 0 ? 1 : 0;
}

/**
 * Deterministic ribbon roughness at a point on the stage.
 *
 * The LATERAL term is the important one. It means the roughness pattern differs
 * a metre left or right, so there is no single perfect line — you can always
 * hunt for a smoother strip. That is the AM3 note that the surface undulates
 * enough that there is always another option to try.
 *
 * @param {number} dist metres along the racing line
 * @param {number} lateral metres from the centre of the ribbon
 */
function bumpField(dist, lateral) {
  return (
    Math.sin(dist * 0.73 + lateral * 0.41) * 0.58 +
    Math.sin(dist * 1.61 + lateral * 0.9 + 1.7) * 0.3 +
    Math.sin(dist * 3.7 - lateral * 1.7) * 0.12
  );
}

/** Which side the current bump lifts: +1 = right of centre, -1 = left. */
function bumpSideAt(dist, lateral) {
  return Math.sin(dist * 0.51 + lateral * 0.3) >= 0 ? 1 : -1;
}

/**
 * Subtle continuous ribbon chatter — ruts + washboard on top of bumpField.
 * Amplitude is the surface `bump` (centimetres), never a step, so the chassis
 * is never on rails and never hits a height wall.
 */
function roadChatter(dist, lateral, amp) {
  if (amp < 0.002) return 0;
  const a = amp * 0.85;
  return (
    bumpField(dist, lateral) * a +
    Math.sin(dist * 0.19 + lateral * 0.33) * a * 0.38 +
    Math.sin(dist * 4.8 + lateral * 0.7) * a * 0.14
  );
}

/**
 * Pacejka magic formula (simplified, no camber).
 * @param {number} slip normalized slip magnitude
 * @param {number} B stiffness
 * @param {number} C shape
 * @param {number} D peak
 * @param {number} E curvature
 */
function pacejka(slip, B, C, D, E) {
  const x = slip;
  const Bx = B * x;
  return D * Math.sin(C * Math.atan(Bx - E * (Bx - Math.atan(Bx))));
}

/**
 * Combined longitudinal + lateral tire force.
 *
 * HOW IT WORKS: compute Fx and Fy independently (stiff Pacejka), then scale
 * onto a friction ellipse. A shared-slip vector (old model) spent the whole
 * circle on throttle and left almost no lateral force — that is ice skating.
 *
 * Past the breakaway point the force falls to the surface's SLIDING friction.
 * muSlide is fTractionCurveMin; muPeak is CurveMax. A wide gap (IV, mud)
 * means the tire lets go and STAYS let go until you catch it. V glued the
 * gap; we keep IV. Floor at 50% of peak so tarmac is not ice.
 *
 * @returns {{fx:number, fy:number}}
 */
function combinedTire(alpha, kappa, Fz, muPeak, muSlide, slipPeak, surface) {
  const load = clamp(Fz, 700, 18000);
  const aPeak = Math.max(0.055, slipPeak || 0.09);
  const D = muPeak * load;
  const Ds = Math.max(muSlide, muPeak * 0.50) * load;
  const B = surface?.pacejkaB ?? 4.1;
  const C = surface?.pacejkaC ?? 1.32;
  const E = surface?.pacejkaE ?? 0.08;
  const fyPure = -pacejka(alpha / aPeak, B, C, D, E);
  const fxPure = pacejka(kappa / 0.1, B * 1.35, C, D, E * 0.85);
  let fx = fxPure;
  let fy = fyPure;
  const mag = Math.hypot(fx, fy);
  if (mag > D && mag > 1e-6) {
    // Share the circle but keep a lateral floor so WOT still turns (arcade).
    // 0.68 (was 0.72) — GTA IV throttle understeer: power spends more pie.
    const fyKeep = Math.min(Math.abs(fy), D * 0.68);
    const fxMax = Math.sqrt(Math.max(0, D * D - fyKeep * fyKeep));
    fy = Math.sign(fy) * fyKeep;
    fx = clamp(fx, -fxMax, fxMax);
  }
  const over = Math.max(Math.abs(alpha) / aPeak, Math.abs(kappa) / 0.16);
  if (over > 1.0) {
    const t = clamp((over - 1.0) / 1.35, 0, 1);
    const slide = Ds / Math.max(D, 1);
    fx = lerp(fx, fx * slide, t);
    fy = lerp(fy, fy * slide, t);
  }
  return { fx, fy };
}

/**
 * Slip angle; zero when nearly stopped so atan2 does not explode.
 */
function slipAngle(vLat, vLong) {
  if (vLat * vLat + vLong * vLong < 0.16) return 0;
  return Math.atan2(vLat, vLong);
}

/**
 * Turbo 3S-GTE homage (Nm vs RPM), scaled by chassis peakPowerKw.
 *
 * BASE_PEAK_KW matches the pre-Sprint-19 CHASSIS value so a car that still
 * ships 186 kW gets the original curve; raising peakPowerKw in config.js is
 * what actually delivers the punch (the knob was previously unused).
 */
const BASE_PEAK_KW = 186;

function engineTorque(rpm, throttle, peakPowerKw = BASE_PEAK_KW) {
  const r = clamp(rpm, 800, 7800);
  let tq = 220;
  // Sprint 28: fatter low-RPM meat so dead-stop launches do not wait on spool.
  if (r < 2500) tq = 205 + (r - 800) * 0.068;
  else if (r < 4500) tq = 280 + (r - 2500) * 0.028;
  else if (r < 6200) tq = 336 - (r - 4500) * 0.012;
  else tq = 316 - (r - 6200) * 0.048;
  const scale = Math.max(0.5, (peakPowerKw || BASE_PEAK_KW) / BASE_PEAK_KW);
  return tq * throttle * scale;
}

export class Vehicle {
  /**
   * @param {object} [spec]
   * @param {{lowDetail?:boolean}} [opts] opponents pass lowDetail to halve the
   *   tire substeps and probe the road with cheap racing-line samples. The
   *   player is never simplified.
   */
  constructor(spec = CELICA, opts) {
    this.spec = spec;
    this.position = new THREE.Vector3(0, 0.7, 0);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.yawRate = 0;
    this.pitchRate = 0;
    this.rollRate = 0;
    this._euler = new THREE.Euler();

    this.lowDetail = !!(opts && opts.lowDetail);
    this._substeps = this.lowDetail ? HANDLING.aiSubsteps : HANDLING.substeps;
    this.jump = new JumpModel();
    // Opponents only — cut apex to a fraction of the player arc (see JUMP.aiLaunchHeightScale).
    if (this.lowDetail) {
      this.jump.aiHeightScale = JUMP.aiLaunchHeightScale != null ? JUMP.aiLaunchHeightScale : 0.2;
    }

    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = 0;
    /** 0 = neutral, 1..topGear = forward. The Saturn box is neutral + 4. */
    this.gear = 1;
    this.rpm = spec.idleRpm;
    this.autoTrans = spec.autoTrans !== false;
    /** Seconds remaining before the automatic may shift again. */
    this._autoCool = 0;
    this.wheelSpin = [0, 0, 0, 0];
    this._prevX = 0;
    this._prevY = 0.7;
    this._prevZ = 0;
    this._prevYaw = 0;
    this._prevPitch = 0;
    this._prevRoll = 0;
    this._prevSteer = 0;
    this._prevSpin = [0, 0, 0, 0];
    this._draw = {
      x: 0,
      y: 0.7,
      z: 0,
      yaw: 0,
      pitch: 0,
      roll: 0,
      steer: 0,
      spin: [0, 0, 0, 0],
    };
    this.slip = 0;
    this.driftAngle = 0;
    this.surfaceId = "dirt";
    this.speed = 0;
    this.onGround = true;
    this.velY = 0;
    this._climbVel = 0;
    this._groundVy = 0;
    this._deckSmoothY = null;
    this._squatSmooth = 0;
    this._airTime = 0;
    this._jumpLock = 0;
    this._landLock = 0;
    this._rampThrow = 0;
    this._rampGrade = 0;
    this._suspCompress = 0;
    this._jumpPhase = "";
    this._landPadY = 0;
    /** Racing-line dist where the current pad was armed — later pits are a new jump. */
    this._landPadDist = 0;
    /** Dist where the visual pit ends (first land sample). Hold pad Y until then. */
    this._landPadEndDist = 0;
    /** True while a jump pad is live. Never use `_landPadY > 0` — pads can sit at/below 0. */
    this._landPadArmed = false;
    /** Last finite on-ribbon pose — recover here if query/NaN would warp the car. */
    this._goodX = 0;
    this._goodY = 0.7;
    this._goodZ = 0;
    this._goodYaw = 0;
    this._goodProgress = 0;
    this._goodVx = 0;
    this._goodVz = 0;
    /** Frames after spawn/reset where a pose jump is legal. */
    this._glitchIgnore = 0;
    /** Count of recovered warps / NaN / buried poses this race. */
    this._glitchHits = 0;
    /** @type {Array<Record<string, number|string>>} */
    this._glitchLog = [];
    this._glitchT = 0;
    /** Descent rate when the chassis first kissed the pad plane (for landing SFX). */
    this._padHitVy = null;
    this.lastImpact = 0;
    /** 0..1 landing mismatch from JumpModel — drives landing SFX variety. */
    this.lastLandUpset = 0;
    /** Air time at last touchdown (seconds) — soft hop vs long float. */
    this.lastAirTime = 0;
    this.hitWall = 0;
    this.hitCar = 0;
    /** Sprint 35 — visual wear 0..1 (shader tiers, no handling penalty). */
    this.damage = 0;
    this._shiftKick = 0;
    this._shiftKickDir = 0;
    this.finished = false;
    this.progress = 0;
    this.lapDist = 0;
    this._still = 0;
    this._rearSlide = false;
    this._frontSlide = false;
    this._ax = 0;
    this._axDrive = 0;
    this._ay = 0;
    this._slope = 0;
    this._roadPitch = 0;
    this._visPitch = 0;
    this._deckFilt = null;
    this._bodyPitch = 0;
    this._bodyPitchRate = 0;
    this._alphaF = 0;
    this._alphaR = 0;
    this._kappaF = 0;
    this._kappaR = 0;
    this.omegaF = 0;
    this.omegaR = 0;
    this.drifting = false;
    this._feltMu = 0.9;
    this._feltSlide = 0.64;
    this._feltBump = 0.03;
    this._feltEase = 1.2;
    this._feltHold = 1.2;
    this._feltSnap = 1;
    this._surfShock = 0;
    this._axleSplit = 0;
    this._slidePct = 0;
    this._gripUsed = 0;
    /** Reused Track.query / sample bags — Desert’s 14-car grid is GC-sensitive. */
    this._q = {};
    this._qFront = {};
    this._qRear = {};
    this._sFront = {};
    this._sRear = {};
    this._sample = {};
    this._ribbonF = {};
    this._ribbonR = {};
    this._felt = {};
    /** Normalised axle probes — both the full and cheap paths fill these. */
    this._axFront = { height: 0, surface: "dirt", from: "dirt", to: "dirt", mix: 0, gap: false };
    this._axRear = { height: 0, surface: "dirt", from: "dirt", to: "dirt", mix: 0, gap: false };
    this._axles = {
      L: 0,
      front: this._axFront,
      rear: this._axRear,
      overGap: false,
      bothGap: false,
      pitch: 0,
      midH: 0,
    };
    /** Per-substep context so _integrate does not allocate. */
    this._ictx = { dist: 0, lateral: 0, axleSplit: 0 };

    const s = spec;
    this.wheels = [
      { x: s.trackFront * 0.5, z: s.wheelbase * 0.5, front: true, side: 1 },
      { x: -s.trackFront * 0.5, z: s.wheelbase * 0.5, front: true, side: -1 },
      { x: s.trackRear * 0.5, z: -s.wheelbase * 0.5, front: false, side: 1 },
      { x: -s.trackRear * 0.5, z: -s.wheelbase * 0.5, front: false, side: -1 },
    ].map((w) => ({
      ...w,
      compression: 0.08,
      prevComp: 0.08,
      load: spec.mass * G * 0.25,
      omega: 0,
      slipAngle: 0,
      onGround: true,
      y: 0,
    }));
  }

  /** Gear ratio including the final drive. Zero in neutral. */
  _gearRatio() {
    const s = this.spec;
    const g = s.gears[this.gear];
    return g ? g * s.finalDrive : 0;
  }

  /** Highest forward gear this box has. */
  _topGear() {
    return this.spec.topGear || this.spec.gears.length - 1;
  }

  /**
   * Place the car on the track at distance `dist` meters along the racing line.
   */
  spawn(track, dist = 2, lateral = 0) {
    const p = track.sample(dist, this._sample);
    this.position.set(p.x + p.nx * lateral, p.y + ROAD_DECK - TIRE_PLANT, p.z + p.nz * lateral);
    this.velocity.set(0, 0, 0);
    this.yaw = p.heading;
    this.yawRate = 0;
    this.roll = 0;
    this.rollRate = 0;
    this.progress = dist;
    this.lapDist = dist;
    // Seed the cached road probe and centre query so the first step has a real
    // road under it instead of last stage's numbers.
    track.query(this.position.x, this.position.z, this._q, this.progress);
    const spawnRoad = this._axleRoad(track, this._q.height);
    const spawnGrade = clamp(spawnRoad.pitch, -ROAD_PITCH_MAX, ROAD_PITCH_MAX);
    this._slope = spawnGrade;
    this._roadPitch = -spawnGrade;
    this._visPitch = -spawnGrade;
    this._deckFilt = spawnRoad.midH - TIRE_PLANT;
    this._bodyPitch = 0;
    this._bodyPitchRate = 0;
    this.pitch = this._visPitch;
    this.pitchRate = 0;
    this.position.y = spawnRoad.midH - TIRE_PLANT;
    track.query(this.position.x, this.position.z, this._q, this.progress);
    this._stashGoodPose();
    this._glitchIgnore = 8;
    this._glitchHits = 0;
    this._glitchLog = [];
    this._glitchT = 0;
    this.gear = 1;
    this.rpm = this.spec.idleRpm;
    this._autoCool = 0;
    this._still = 0;
    this._rearSlide = false;
    this._frontSlide = false;
    this._ax = 0;
    this._axDrive = 0;
    this._ay = 0;
    this._alphaF = 0;
    this._alphaR = 0;
    this._kappaF = 0;
    this._kappaR = 0;
    this.omegaF = 0;
    this.omegaR = 0;
    this.driftAngle = 0;
    this.slip = 0;
    this.drifting = false;
    this.onGround = true;
    this.velY = 0;
    this._climbVel = 0;
    this._groundVy = 0;
    this._deckSmoothY = null;
    this._squatSmooth = 0;
    this._airTime = 0;
    this._jumpLock = 0;
    this._landLock = 0;
    this._rampThrow = 0;
    this._rampGrade = 0;
    this._suspCompress = 0;
    this._jumpPhase = "";
    this._landPadY = 0;
    this._landPadDist = 0;
    this._landPadEndDist = 0;
    this._landPadArmed = false;
    this._padHitVy = null;
    this.lastImpact = 0;
    this.lastLandUpset = 0;
    this.lastAirTime = 0;
    this.hitWall = 0;
    this.hitCar = 0;
    this.damage = 0;
    this._shiftKick = 0;
    this._shiftKickDir = 0;
    this._feltMu = 0.9;
    this._feltSlide = 0.64;
    this._feltBump = 0.03;
    this._feltEase = 1.2;
    this._feltHold = 1.2;
    this._feltSnap = 1;
    this._surfShock = 0;
    this._axleSplit = 0;
    this.jump.reset();
    this._capturePrev();
    this._stashGoodPose();
    this.drawPose(1);
  }

  /**
   * Snapshot the pose we will interpolate FROM on the next render.
   * Called at the start of every fixed step so leftover-frame rendering
   * can lerp previous → current (Gaffer "Fix Your Timestep").
   */
  _capturePrev() {
    this._prevX = this.position.x;
    this._prevY = this.position.y;
    this._prevZ = this.position.z;
    this._prevYaw = this.yaw;
    this._prevPitch = this.pitch;
    this._prevRoll = this.roll;
    this._prevSteer = this.steer;
    this._prevSpin[0] = this.wheelSpin[0];
    this._prevSpin[1] = this.wheelSpin[1];
    this._prevSpin[2] = this.wheelSpin[2];
    this._prevSpin[3] = this.wheelSpin[3];
  }

  /**
   * Gaffer-style pose between the last two physics states.
   *
   * @param {number} alpha leftover / FIXED_DT, clamped 0..1
   * @returns {typeof Vehicle.prototype._draw}
   */
  drawPose(alpha) {
    const t = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    const d = this._draw;
    d.x = this._prevX + (this.position.x - this._prevX) * t;
    d.y = this._prevY + (this.position.y - this._prevY) * t;
    d.z = this._prevZ + (this.position.z - this._prevZ) * t;
    d.yaw = lerpAngle(this._prevYaw, this.yaw, t);
    d.pitch = lerpAngle(this._prevPitch, this.pitch, t);
    d.roll = lerpAngle(this._prevRoll, this.roll, t);
    d.steer = this._prevSteer + (this.steer - this._prevSteer) * t;
    const spin = d.spin;
    spin[0] = this._prevSpin[0] + (this.wheelSpin[0] - this._prevSpin[0]) * t;
    spin[1] = this._prevSpin[1] + (this.wheelSpin[1] - this._prevSpin[1]) * t;
    spin[2] = this._prevSpin[2] + (this.wheelSpin[2] - this._prevSpin[2]) * t;
    spin[3] = this._prevSpin[3] + (this.wheelSpin[3] - this._prevSpin[3]) * t;
    return d;
  }

  /**
   * One fixed physics step.
   *
   * ROAD PROBE BUDGET: exactly three Track.query calls per step for the player
   * (front axle, rear axle, chassis centre) and one plus two cheap samples for
   * an opponent. The pre-integration slope and bump phase read the probe cached
   * at the END of the previous step, which is at most one step stale — a
   * centimetre of height on a ramp, and free.
   *
   * @param {number} dt
   * @param {{steer:number,throttle:number,brake:number,handbrake:number,shiftUp:boolean,shiftDown:boolean}} input
   * @param {import('../tracks/track.js').Track} track
   */
  step(dt, input, track) {
    this._capturePrev();
    const s = this.spec;
    this.throttle = clamp(Number(input.throttle) || 0, 0, 1);
    this.brake = clamp(Number(input.brake) || 0, 0, 1);
    this.handbrake = clamp(Number(input.handbrake) || 0, 0, 1);
    const steerIn = clamp(Number(input.steer) || 0, -1, 1);

    this._shiftGearbox(input, steerIn);

    // Road state cached at the end of the previous step.
    const road = this._axles;
    const frontProbe = road.front;
    const rearProbe = road.rear;
    const splitAxle = frontProbe.surface !== rearProbe.surface;
    const surface = this._feelSurface(frontProbe, rearProbe, dt, splitAxle);
    this.surfaceId = surface.id;

    const cached = this._q;
    let grade = road.pitch;
    if (!this.onGround || road.bothGap || cached.jumpKind === "gap") {
      grade = clamp(grade * 0.15, -0.04, 0.05);
    } else {
      grade = clamp(grade, -ROAD_PITCH_MAX, ROAD_PITCH_MAX);
    }
    this._slope = slew(this._slope, grade, SLOPE_SLEW * dt);
    this._roadPitch = -this._slope;

    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    TMP.fwd.set(sinY, 0, cosY);
    TMP.right.set(cosY, 0, -sinY);

    let vx = this.velocity.dot(TMP.fwd);
    let vy = this.velocity.dot(TMP.right);
    let r = this.yawRate;
    this.speed = Math.hypot(vx, vy);

    const falloff = s.steerFalloff != null ? s.steerFalloff : 0.011;
    const steerLimit = s.maxSteer / (1 + Math.abs(vx) * falloff);
    const steerTarget = steerIn * steerLimit;
    // Weighted rack — hairpins stay quick, speed adds mass (GTA IV). Never
    // teleport the lock on a digital key; that killed the inertia.
    const speed01 = clamp(Math.abs(vx) / 48, 0, 1);
    const selfAlign = (s.steerReturn || 88) + Math.abs(vx) * 0.62;
    const rack =
      Math.abs(steerTarget) > Math.abs(this.steer)
        ? (s.steerSpeed || 96) * lerp(1.38, 0.36, speed01 * speed01)
        : selfAlign;
    this.steer += (steerTarget - this.steer) * (1 - Math.exp(-rack * dt));
    if (Math.abs(steerIn) < 0.04 && Math.abs(this.steer) < 0.012) this.steer = 0;

    this.jump.settle(dt);

    if (this.onGround) {
      this.jump.ground(dt, this.throttle, this.brake);
      const ctx = this._ictx;
      ctx.dist = cached.dist || 0;
      ctx.lateral = cached.lateral || 0;
      ctx.axleSplit = this._axleSplit;
      const n = this._substeps;
      const h = dt / n;
      let axSum = 0;
      for (let i = 0; i < n; i++) {
        const next = this._integrate(h, vx, vy, r, surface, ctx);
        vx = next.vx;
        vy = next.vy;
        r = next.r;
        axSum += next.axTire;
      }
      // Load transfer uses last frame's _ax inside each substep. Blending once
      // here stops the 240 Hz axle-load ↔ tire-force loop that bounced the hull.
      // Same rate for the pack — a faster AI blend reopened the hop on rivals.
      const axFollow = 1 - Math.exp(-13 * dt);
      this._ax += (axSum / n - this._ax) * axFollow;
    } else {
      this._ax *= Math.exp(-6 * dt);
      this._axDrive *= Math.exp(-8 * dt);
      this._kappaF *= Math.exp(-8 * dt);
      this._kappaR *= Math.exp(-8 * dt);
      this.jump.air(dt, this.throttle, this.brake, { yawRate: this.yawRate });
      // Carry forward speed — heavy air drag killed the glide and made crests
      // feel like a stall at the apex. Lateral still bleeds so slides settle.
      vx *= 1 - 0.012 * dt;
      vy *= 1 - 2.4 * dt;
      r *= 1 - 1.8 * dt;
      r += this.steer * 0.55 * dt;
      this.omegaF *= 1 - 0.25 * dt;
      this.omegaR *= 1 - 0.25 * dt;
    }
    this._shiftKick *= Math.exp(-7.5 * dt);
    if (this._shiftKick < 0.03) this._shiftKick = 0;

    const omegaDrive = s.drivetrain === "2wd" ? this.omegaR : this.omegaR * 0.62 + this.omegaF * 0.38;
    this._updateEngine(dt, omegaDrive);

    this.yawRate = r;
    this.driftAngle = Math.atan2(vy, Math.abs(vx) + 0.4);
    this.drifting = Math.abs(this.driftAngle) > 0.12 && this._rearSlide;
    this.slip = clamp(
      Math.abs(this.driftAngle) / 0.5 +
        Math.min(1, Math.abs(this.omegaR * s.wheelRadius - vx) * 0.08) +
        this.handbrake * 0.35,
      0,
      1
    );
    const maxSlide = HANDLING.maxSlideVel != null ? HANDLING.maxSlideVel : 17.2;
    this._slidePct = clamp(Math.abs(vy) / maxSlide, 0, 1);
    this._gripUsed = clamp(this.slip * 0.72 + this._slidePct * 0.38, 0, 1);

    this.yaw += this.yawRate * dt;
    const sin2 = Math.sin(this.yaw);
    const cos2 = Math.cos(this.yaw);
    this.velocity.set(sin2 * vx + cos2 * vy, 0, cos2 * vx - sin2 * vy);
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.speed = this.velocity.length();
    this._glitchT += dt;
    const prevProgress = this.progress;
    const prevY = this.position.y;

    let q2 = track.query(this.position.x, this.position.z, this._q, this.progress);
    q2 = this._keepOnRibbon(track, q2, dt);
    const axles = this._axleRoad(track, q2.height);
    const pit = axles.bothGap || q2.jumpKind === "gap";
    const deck = this._roadDeckY(axles);

    const jk = q2.jumpKind || "";
    if (this.onGround && (jk === "ramp" || jk === "crest")) {
      const pitchIn = Math.max(0, axles.pitch);
      const wantCompress = clamp(
        this.throttle * (JUMP.springThrottle || 0.4) +
          this.brake * (JUMP.springBrake || 0.55) +
          pitchIn * (JUMP.springPitch || 2.5),
        0,
        1
      );
      const kC = 1 - Math.exp(-(JUMP.springCompressRate || 3) * dt);
      this._suspCompress += (wantCompress - this._suspCompress) * kC;
    } else if (this.onGround) {
      this._suspCompress *= Math.exp(-(JUMP.springReleaseRate || 10) * dt);
    }

    if (this.onGround && !pit) {
      const grade2 = clamp(axles.pitch, -ROAD_PITCH_MAX, ROAD_PITCH_MAX);
      this._slope = slew(this._slope, grade2, SLOPE_SLEW * dt);
      this._roadPitch = -this._slope;
    }
    this._updateVisPitch(dt, axles, pit);
    this._stepAir(dt, deck, q2, axles, pit, track);
    this._clampToRoadDeck(deck, pit, q2.jumpKind || "");
    // Felt blend (front/rear mix) already owns surfaceId. Overwriting it with
    // the centre-line ribbon made HUD / dust / tire beds lag or lie at every
    // surface change — the opposite of "audible + visual signature per surface".

    if (this.onGround) {
      bounceOffRoad(this, q2, track);
      glanceObstacles(this, track);
      this._unstick(dt, track, q2);
    }

    this._updateAttitude(dt);

    this.wheelSpin[0] += this.omegaF * dt;
    this.wheelSpin[1] += this.omegaF * dt;
    this.wheelSpin[2] += this.omegaR * dt;
    this.wheelSpin[3] += this.omegaR * dt;
    this.wheels[0].omega = this.omegaF;
    this.wheels[1].omega = this.omegaF;
    this.wheels[2].omega = this.omegaR;
    this.wheels[3].omega = this.omegaR;
    this.wheels[0].slipAngle = this._alphaF;
    this.wheels[1].slipAngle = this._alphaF;
    this.wheels[2].slipAngle = this._alphaR;
    this.wheels[3].slipAngle = this._alphaR;

    this.progress = q2.dist;
    this.lapDist = q2.dist;
    this._guardDrive(track, prevProgress, prevY, dt);
    this._stashGoodPose();
  }

  /**
   * Neutral + four forward gears, manual or automatic.
   *
   * A downshift while turning is a deliberate drift trigger (Sakamoto): the
   * driveline snatch unloads the rear. In a straight line the same lever is
   * just engine braking, so the move has to be aimed to work.
   *
   * @param {{shiftUp?:boolean, shiftDown?:boolean}} input
   * @param {number} steerIn validated steer command
   */
  _shiftGearbox(input, steerIn) {
    if (this.autoTrans) return;
    const s = this.spec;
    const top = this._topGear();
    if (input.shiftUp) this.gear = clamp(this.gear + 1, 0, top);
    if (!input.shiftDown || this.gear <= 0) return;
    this.gear -= 1;
    if (this.gear === 0) {
      // Into neutral: nothing to blip, the engine just drops to idle.
      return;
    }
    this.rpm = clamp(this.rpm + 1100, s.idleRpm, s.redline);
    const turning = Math.abs(this.steer) > 0.08 || Math.abs(steerIn) > 0.2;
    if (turning) {
      this._shiftKick = clamp(this._shiftKick + 0.38 + (top - this.gear) * 0.09, 0, 1.05);
      this._shiftKickDir =
        Math.abs(this.steer) > 0.04 ? Math.sign(this.steer) : Math.sign(steerIn) || 1;
      this.omegaR *= 0.78;
    } else {
      this.omegaR *= 0.9;
    }
  }

  /**
   * Ballistic jumps with Fujimoto technique: leave at the pit, fly under
   * gravity modified by chassis attitude, land as well as you set it up.
   * The pit floor is visual only — gluing to it was the post-jump bounce.
   *
   * @param {number} dt
   * @param {number} deck
   * @param {object} q2
   * @param {ReturnType<Vehicle['_axleRoad']>} axles
   * @param {boolean} pit
   * @param {import('../tracks/track.js').Track} track
   */
  _stepAir(dt, deck, q2, axles, pit, track) {
    if (this._landLock > 0) {
      this._landLock = Math.max(0, this._landLock - dt);
    }
    const kind = q2.jumpKind || "";
    const inAirZone = pit || kind === "crest" || kind === "ramp";
    if (kind === "gap") this._jumpPhase = "gap";
    else if (kind === "crest") this._jumpPhase = "crest";
    else if (kind === "ramp") this._jumpPhase = "ramp";
    else if (!inAirZone) this._jumpPhase = "";

    if (this.onGround && !inAirZone && this._landPadArmed) {
      this._landPadArmed = false;
      this._landPadY = 0;
      this._landPadDist = 0;
      this._landPadEndDist = 0;
    }
    // Same visual pit we just flew — ends at the scanned land, not a 36 m guess.
    const samePit =
      this._landPadArmed &&
      pit &&
      q2.dist + 4 >= this._landPadDist &&
      q2.dist < this._landPadEndDist + 2;

    const vx = this.speed;
    const roadPitch = clamp(axles.pitch, -0.04, 0.55);
    const roadVy = vx * Math.sin(roadPitch) * (JUMP.rampVyScale || 1);

    if (this.onGround && kind === "ramp") {
      const rampGrade = clamp(Math.max(this._slope, roadPitch), 0, 0.62);
      const throwY = Math.max(0, vx * Math.tan(rampGrade));
      this._rampThrow = Math.max(this._rampThrow * 0.88, throwY, roadVy * 1.15);
      this._rampGrade = Math.max(this._rampGrade * 0.9, rampGrade);
    } else if (this.onGround && kind === "crest") {
      this._rampThrow = Math.max(this._rampThrow * 0.97, roadVy * 1.1);
      this._rampGrade = Math.max(this._rampGrade * 0.95, roadPitch);
    } else if (this.onGround && kind !== "gap" && kind !== "land") {
      this._rampThrow *= Math.exp(-4.5 * dt);
      this._rampGrade *= Math.exp(-4.5 * dt);
    }

    if (this.onGround) {
      const prevY = this.position.y;

      // Hold only on THIS jump's pit. `_landLock` used to block the next lip
      // (Desert jump 2 → 3): the car stayed glued under the rising ramp.
      const holdThisPit =
        pit &&
        (samePit ||
          (this._landLock > 0 &&
            this._landPadArmed &&
            q2.dist < this._landPadEndDist + 4));
      if (holdThisPit) {
        this.velY = 0;
        this._climbVel *= Math.exp(-8 * dt);
        this._airTime = 0;
        const hold = this._landPadArmed ? this._landPadY : deck;
        this.position.y = Number.isFinite(hold) ? hold : prevY;
        this._snapPitchToRoad(axles);
        return;
      }

      // Any grounded frame in a NEW hole is a takeoff. Do not wait out a
      // previous landing's lock — that planted the car under jump 3's deck.
      const takeoff = (pit || kind === "gap") && !q2.tunnel;

      if (takeoff) {
        this.onGround = false;
        this._airTime = 0;
        const launchGrade = Math.max(this._rampGrade, roadPitch, this._slope, 0.02);
        const speedN = clamp(vx / 26, 0.4, 1.65);
        const springBoost =
          this._suspCompress * (JUMP.springBurst || 4.4) * (0.55 + speedN * 0.65);
        // Ballistic leave scales hard with speed × lip grade so small hops and
        // big Safari lips feel different — not one shared arc height.
        const ballistic =
          vx * Math.sin(launchGrade) * (JUMP.rampVyScale || 1.38) * (0.75 + speedN * 0.35);
        const throwBlend = Math.max(0, this._rampThrow) * (JUMP.throwBlend != null ? JUMP.throwBlend : 0.92);
        const raw = Math.max(0, ballistic + throwBlend);
        this.velY = this.jump.launch(raw, launchGrade, springBoost, {
          pitchRate: -(this.pitchRate || 0),
          roll: this.roll,
          rollRate: this.rollRate,
          yawRate: this.yawRate,
          lateral: q2.lateral || 0,
          speed: vx,
          throttle: this.throttle,
          brake: this.brake,
          dist: q2.dist,
        });
        this._climbVel = 0;
        this._groundVy = 0;
        this._rampThrow = 0;
        this._suspCompress = 0;
        this._padHitVy = null;
        const pad = this._scanLandPad(track, q2.dist, prevY);
        this._landPadY = pad.y;
        this._landPadDist = q2.dist;
        this._landPadEndDist = pad.end;
        this._landPadArmed = true;
        this.position.y = prevY + this.velY * dt;
        return;
      }

      let chatter = 0;
      const onJumpApproach = kind === "ramp" || kind === "crest" || kind === "land";
      if (!onJumpApproach) {
        const bumpScale = HANDLING.roadChatterScale != null ? HANDLING.roadChatterScale : 0.04;
        chatter =
          roadChatter(q2.dist || 0, q2.lateral || 0, this._feltBump || 0) * bumpScale;
      }
      if (this._deckFilt == null) this._deckFilt = deck;
      const err = deck - this._deckFilt;
      const followFast =
        HANDLING.deckFollowRate != null ? HANDLING.deckFollowRate : 55;
      const deckRate = onJumpApproach
        ? 48
        : Math.abs(err) > DECK_NOISE_BAND
          ? followFast
          : DECK_FILT_RATE;
      this._deckFilt += err * (1 - Math.exp(-deckRate * dt));
      const wantY = this._deckFilt + chatter;
      // Direct deck plant for player AND pack. The AI max-step slew tracked
      // raw ribbon noise and read as the same springy hop the player had.
      const plantRate =
        HANDLING.groundPlantRate != null
          ? HANDLING.groundPlantRate
          : onJumpApproach
            ? 58
            : 46;
      const follow = 1 - Math.exp(-plantRate * dt);
      const dy = wantY - prevY;
      if (Math.abs(dy) < 0.0025) {
        this.position.y = wantY;
        this._groundVy = 0;
      } else {
        this.position.y = prevY + dy * follow;
        this._groundVy = dy * follow / Math.max(dt, 1e-4);
      }
      this.velY = this._groundVy;
      this._climbVel = this._groundVy;
      this._deckSmoothY = wantY;
      this._airTime = 0;
      // Contact patch on the painted deck. The filter used to lag a rising
      // land ramp and leave the tires in the asphalt or hovering above it.
      if (this._landLock > 0 || onJumpApproach) {
        this.position.y = deck;
        this._deckFilt = deck;
        this._deckSmoothY = deck;
        if (this._landLock > 0) this._snapPitchToRoad(axles);
      } else if (this.position.y < deck) {
        this.position.y = deck;
      } else if (this.position.y > deck + GROUND_HOVER_MAX) {
        this.position.y = deck + GROUND_HOVER_MAX;
      }
      return;
    }

    this._airTime += dt;
    // Near-constant g so the arc is a parabola. Tiny aeroFloat only.
    this.velY -= G * this.jump.gravityScale(vx) * dt;
    this.velY = Math.max(this.velY, -36);
    this.position.y += this.velY * dt;

    // Far-pad height is the floor over the hole. Never the pit mesh (deck).
    const floorY = this._roadFloorY(deck, pit);
    const solidDeck = !pit && kind !== "gap";
    if (this.position.y < floorY) {
      this.position.y = floorY;
      if (this.velY < 0) {
        if (this._padHitVy == null) this._padHitVy = this.velY;
        this.velY = 0;
      }
      // Jump 2 hang time can arrive under jump 3's rising ramp. Hovering here
      // with onGround=false made the car unmovable inside the asphalt.
      if (solidDeck) {
        this.onGround = true;
        this._airTime = 0;
        this._climbVel = 0;
        this._groundVy = 0;
        this._deckSmoothY = floorY;
        this._deckFilt = floorY;
        this._landLock = 0.12;
        this._landPadArmed = false;
        this._landPadY = 0;
        this._snapPitchToRoad(axles);
        return;
      }
    }

    // Land on any solid deck once we have left this jump's lip. Excluding
    // ramp/crest used to let a long throw tunnel the next jump's roadway.
    const sameTakeoff = this._landPadArmed && q2.dist < this._landPadDist + 10;
    const overPad = solidDeck && !sameTakeoff;
    const atPad = this.position.y <= floorY + 0.08;
    const ready = this.velY <= 0.2;
    const hitting = overPad && atPad && ready && this._airTime > 0.08;
    if (hitting) {
      const fallSpeed = this._padHitVy != null ? this._padHitVy : this.velY;
      const impact = Math.max(0, -fallSpeed);
      this.lastAirTime = this._airTime;
      this.position.y = floorY;
      this._climbVel = 0;
      this._groundVy = 0;
      this._deckSmoothY = floorY;
      this._deckFilt = floorY;
      this._rampThrow = 0;
      this._rampGrade = 0;
      this._suspCompress = clamp(this._suspCompress * 0.35 + impact * 0.04, 0, 0.65);
      this.lastImpact = impact;
      this._padHitVy = null;
      this._touchDown(fallSpeed, impact, axles);
      const bounce = this._jumpBounce || 0;
      if (bounce > 0.85 && impact > 5.2 && this._landLock <= 0) {
        this.velY = bounce;
        this.onGround = false;
        this._airTime = 0.05;
        this._landLock = 0.07;
        this.position.y = floorY + 0.012;
      } else {
        this.velY = 0;
        this.onGround = true;
        this._airTime = 0;
        this._landLock = 0.18 + impact * 0.016;
        this._snapPitchToRoad(axles);
      }
    }
  }

  /**
   * Apply a graded landing.
   *
   * A flat arrival keeps almost all of its speed and leaves the car composed. A
   * nose-high one lands tail-first: it scrubs speed, throws a yaw kick you have
   * to catch, and tops up the unsettled pool so the NEXT crest is harder. The
   * scrub is a speed multiplier, never a stop — nothing glues the car down.
   *
   * @param {number} fallSpeed vertical velocity at contact
   * @param {number} impact absolute descent rate
   * @param {ReturnType<Vehicle['_axleRoad']>} axles
   */
  _touchDown(fallSpeed, impact, axles) {
    const res = this.jump.land(fallSpeed, this.speed);
    this._jumpBounce = res.bounce || 0;
    this.lastLandUpset = res.upset;
    this._surfShock = Math.max(this._surfShock, clamp(impact / 12, 0.2, 0.85) * (0.5 + res.upset));
    this.velocity.x *= res.scrub;
    this.velocity.z *= res.scrub;
    if (res.upsetYaw > 0.01) {
      // Which way the car snaps is the road, not a dice roll: the cambered side
      // of the landing pad and whatever lock you were holding decide it.
      const side =
        Math.abs(this.steer) > 0.03
          ? Math.sign(this.steer)
          : bumpSideAt(this.progress, (this._q && this._q.lateral) || 0);
      this.yawRate = clamp(
        this.yawRate + side * res.upsetYaw,
        -MAX_YAW_HANDBRAKE,
        MAX_YAW_HANDBRAKE
      );
    }
    void axles;
  }

  /**
   * Chassis Y that plants both axles on the road plane (wheels on deck).
   * Origin is the contact patch, so mid of front/rear deck IS the plane
   * through both patches. A lower-axle bias buried the high wheels.
   * @param {ReturnType<Vehicle['_fillAxles']>} axles
   */
  _roadDeckY(axles) {
    return axles.midH - TIRE_PLANT;
  }

  /**
   * Solid roadway Y. The visual pit mesh is not a floor.
   * @param {number} deck
   * @param {boolean} pit
   */
  _roadFloorY(deck, pit) {
    if (pit) return this._landPadArmed ? this._landPadY : this.position.y;
    return deck;
  }

  /**
   * Never let the contact patch tunnel the ribbon — player and AI.
   * On ordinary road the wheels stay on the deck. Jumps may leave the deck.
   * @param {number} deck
   * @param {boolean} pit
   * @param {string} [kind]
   */
  _clampToRoadDeck(deck, pit, kind = "") {
    const floor = this._roadFloorY(deck, pit);
    if (!Number.isFinite(this.position.y) && Number.isFinite(floor)) {
      this.position.y = floor;
      return;
    }
    if (!Number.isFinite(floor)) return;
    if (this.position.y < floor) this.position.y = floor;
    // Grounded on real tarmac/ramp/land: never hover more than chatter.
    // Ramp/crest used to skip the pin, so a post-jump plant sank or floated.
    void kind;
    if (this.onGround && !pit && this.position.y > floor + GROUND_HOVER_MAX) {
      this.position.y = floor + GROUND_HOVER_MAX;
    }
  }

  /**
   * True when the chassis pose is a real number (NaN is a silent freeze).
   */
  _isFinitePose() {
    return (
      Number.isFinite(this.position.x) &&
      Number.isFinite(this.position.y) &&
      Number.isFinite(this.position.z) &&
      Number.isFinite(this.yaw)
    );
  }

  /**
   * Remember a legal on-ribbon pose so a bad query cannot warp the car.
   */
  _stashGoodPose() {
    if (!this._isFinitePose() || !Number.isFinite(this.progress)) return;
    this._goodX = this.position.x;
    this._goodY = this.position.y;
    this._goodZ = this.position.z;
    this._goodYaw = this.yaw;
    this._goodProgress = this.progress;
    this._goodVx = this.velocity.x;
    this._goodVz = this.velocity.z;
  }

  /**
   * Put the car back on the last good ribbon pose.
   * @param {import('../tracks/track.js').Track} track
   */
  _restoreGoodPose(track) {
    if (!Number.isFinite(this._goodX) || !Number.isFinite(this._goodProgress)) {
      if (track) this.spawn(track, Math.max(4, this.progress || 8), 0);
      return;
    }
    this.position.x = this._goodX;
    this.position.y = this._goodY;
    this.position.z = this._goodZ;
    this.yaw = this._goodYaw;
    this.progress = this._goodProgress;
    this.lapDist = this._goodProgress;
    this.velocity.x = Number.isFinite(this._goodVx) ? this._goodVx : 0;
    this.velocity.z = Number.isFinite(this._goodVz) ? this._goodVz : 0;
    this.velY = 0;
    this.yawRate = 0;
    this.onGround = true;
  }

  /**
   * Reject a spline snap that would teleport the car to another loop of the
   * stage, and recover NaN poses before they kill the frame loop.
   * @param {import('../tracks/track.js').Track} track
   * @param {object} q
   * @param {number} dt
   */
  _keepOnRibbon(track, q, dt) {
    const prev = this.progress;
    const len = track && track.length ? track.length : 0;
    const along = this._alongDelta(prev, q && q.dist, len);
    // One physics step travels speed*dt. A 32 m floor let a hairpin opposite
    // arm steal the lock (~18–30 m along) and bounceOffRoad planted there.
    const maxStep = Math.max(10, (this.speed || 0) * dt * 3 + 6);
    const snapped =
      !q ||
      !Number.isFinite(q.dist) ||
      !this._isFinitePose() ||
      (Number.isFinite(prev) && along > maxStep);
    if (!snapped) return q;
    this._noteGlitch("spline-snap", { prev, dist: q && q.dist, along, maxStep });
    this._restoreGoodPose(track);
    const again = track.query(this.position.x, this.position.z, this._q, this.progress);
    const againAlong = this._alongDelta(this.progress, again && again.dist, len);
    if (againAlong <= maxStep) return again;
    return this._pinQuery(track, again);
  }

  /**
   * Force a road probe onto the last good dist when XZ sits on two loops.
   * @param {import('../tracks/track.js').Track} track
   * @param {object} q
   */
  _pinQuery(track, q) {
    const line = track.sample(this.progress, this._sample);
    const r = q || this._q || {};
    r.dist = this.progress;
    r.heading = line.heading;
    r.nx = line.nx;
    r.nz = line.nz;
    r.width = line.width;
    r.height = (line.y || 0) + ROAD_DECK;
    r.lateral =
      (this.position.x - line.x) * line.nx + (this.position.z - line.z) * line.nz;
    r.onRoad = Math.abs(r.lateral) <= r.width * 0.5;
    r.tunnel = !!line.tunnel;
    r.jump = !!line.jump;
    r.jumpKind = line.jumpKind || null;
    r.surface = line.surface;
    return r;
  }

  /**
   * Shortest along-track delta, wrapping at the finish line.
   * @param {number} a
   * @param {number} b
   * @param {number} len
   */
  _alongDelta(a, b, len) {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
    let d = Math.abs(b - a);
    if (len > 80 && d > len * 0.5) d = len - d;
    return d;
  }

  /**
   * Record a recovered glitch. QA reads `_glitchHits` / `_glitchLog`.
   * @param {string} kind
   * @param {Record<string, number|string>} extra
   */
  _noteGlitch(kind, extra) {
    if (this._glitchIgnore > 0) return;
    this._glitchHits = (this._glitchHits || 0) + 1;
    if (!this._glitchLog) this._glitchLog = [];
    if (this._glitchLog.length >= 48) return;
    this._glitchLog.push({
      kind,
      t: Math.round((this._glitchT || 0) * 1000) / 1000,
      x: this.position.x,
      y: this.position.y,
      z: this.position.z,
      progress: this.progress,
      ...extra,
    });
  }

  /**
   * Last line of defence: the car must not NaN, bury, or jump along the stage.
   * Lateral runoff reset onto the same progress is legal; a dist warp is not.
   * @param {import('../tracks/track.js').Track} track
   * @param {number} prevProgress
   * @param {number} prevY
   * @param {number} dt
   */
  _guardDrive(track, prevProgress, prevY, dt) {
    if (this._glitchIgnore > 0) {
      this._glitchIgnore -= 1;
      return;
    }
    if (!this._isFinitePose()) {
      this._noteGlitch("nan-pose", {});
      this._restoreGoodPose(track);
      return;
    }
    const len = track && track.length ? track.length : 0;
    const along = this._alongDelta(prevProgress, this.progress, len);
    const maxAlong = Math.max(10, (this.speed || 0) * dt * 3 + 6);
    if (along > maxAlong) {
      this._noteGlitch("teleport", { along, maxAlong, prev: prevProgress, dist: this.progress });
      this._restoreGoodPose(track);
      return;
    }
    const q = this._q;
    let floor = q && Number.isFinite(q.height) ? q.height : null;
    let pitKind = !!(q && q.jumpKind === "gap");
    if (track && typeof track.sample === "function" && Number.isFinite(this.progress)) {
      const line = track.sample(this.progress, this._sample);
      if (line && Number.isFinite(line.y)) {
        floor = line.y + ROAD_DECK;
        pitKind = line.jumpKind === "gap";
      }
    }
    // Contact patch under a solid deck is always a bury — 1.35 m used to leave
    // the car sitting inside jump 3's ramp after a jump-2 throw.
    if (floor != null && !pitKind && this.position.y < floor - 0.22) {
      this._noteGlitch("buried", { y: this.position.y, floor, prevY });
      this.position.y = floor - TIRE_PLANT;
      this.velY = 0;
      this.onGround = true;
    }
    // Only a sudden DROP is a warp. Lifting onto the next ramp is the recovery.
    if (this.onGround && Number.isFinite(prevY) && this.position.y < prevY - 3.2) {
      this._noteGlitch("y-warp", { y: this.position.y, prevY });
      this.position.y = prevY;
      this.velY = 0;
    }
  }

  /**
   * Origin is the contact patch, so leftover air pitch buries a bumper
   * or lifts the tires. Snap onto the axle plane the instant the pad is under us.
   * @param {ReturnType<Vehicle['_axleRoad']>} [axles]
   */
  _snapPitchToRoad(axles) {
    const grade =
      axles && Number.isFinite(axles.pitch)
        ? clamp(axles.pitch, -ROAD_PITCH_MAX, ROAD_PITCH_MAX)
        : this._slope;
    this._slope = grade;
    this._roadPitch = -grade;
    this._visPitch = -grade;
    this.pitch = this._visPitch;
    this.pitchRate = 0;
    this._bodyPitch = 0;
    this._bodyPitchRate = 0;
    this._squatSmooth = 0;
  }

  /**
   * Height of the far pad so flight never drops into the visual pit.
   * @param {import('../tracks/track.js').Track} track
   * @param {number} dist
   * @param {number} fallback
   * @returns {{y:number, dist:number, end:number}}
   */
  _scanLandPad(track, dist, fallback) {
    const miss = { y: fallback, dist: dist + 16, end: dist + 40 };
    if (!track) return miss;
    const scanEnd = Math.min(track.length - 1, dist + 120);
    let y = null;
    let foundAt = dist + 16;
    for (let d = dist + 3; d < scanEnd; d += 2) {
      const p = track.sample(d, this._sample);
      const kind = p.jumpKind || "";
      const air = kind === "gap" || kind === "crest" || kind === "ramp";
      if (air) {
        if (y != null) break;
        continue;
      }
      y = p.y + ROAD_DECK - TIRE_PLANT;
      foundAt = d;
      break;
    }
    if (y == null) return miss;
    return { y, dist: foundAt, end: foundAt };
  }

  /**
   * Road height and surface at the front and rear axles.
   *
   * HOW IT WORKS: probe the ribbon at ±half wheelbase along heading. The pitch
   * between those points is the plane the tires must sit on, and the two
   * SURFACES are what let a texture change catch one axle before the other.
   * Using only the chassis center (and a 5° pitch cap) left the rears in the
   * air on climbs and made every transition uniform.
   *
   * @param {import('../tracks/track.js').Track} track
   * @param {number} [groundY] optional centre-line height under the car (AI)
   */
  _axleRoad(track, groundY) {
    const L = Math.max(1.6, this.spec.wheelbase || 2.5);
    const half = L * 0.5;
    if (this.lowDetail) return this._axleRoadCheap(track, L, half, groundY);
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    const f = track.query(
      this.position.x + sinY * half,
      this.position.z + cosY * half,
      this._qFront,
      this.progress
    );
    const r = track.query(
      this.position.x - sinY * half,
      this.position.z - cosY * half,
      this._qRear,
      this.progress
    );
    copyProbe(this._axFront, f.height, f.surface, f.surfFrom, f.surfTo, f.surfMix, f.jumpKind);
    copyProbe(this._axRear, r.height, r.surface, r.surfFrom, r.surfTo, r.surfMix, r.jumpKind);
    return this._fillAxles(L);
  }

  /**
   * Opponent-grade road probe: two racing-line samples instead of two full
   * spatial queries. Rivals hold within a metre or two of the line, so the
   * height error is invisible, and a sample is a binary search where a query is
   * a neighbourhood scan plus a surface-blend walk. This is the "simplify
   * opponents, never the player" lever for the frame budget.
   *
   * Sprint 34: snap mid-height to the real ground under the car so lane offset
   * / crown cannot leave the pack floating above the ribbon.
   *
   * @param {import('../tracks/track.js').Track} track
   * @param {number} L wheelbase
   * @param {number} half half wheelbase
   * @param {number} [groundY]
   */
  _axleRoadCheap(track, L, half, groundY) {
    const len = track.length || 1;
    const df = clamp(this.progress + half, 0, len - 1);
    const dr = clamp(this.progress - half, 0, len - 1);
    const f = track.sample(df, this._sFront);
    const r = track.sample(dr, this._sRear);
    const sampleMid = 0.5 * (f.y + r.y) + ROAD_DECK;
    const target = groundY != null && Number.isFinite(groundY) ? groundY : sampleMid;
    const lift = target - sampleMid;
    copyProbe(this._axFront, f.y + ROAD_DECK + lift, f.surface, f.surface, f.surface, 0, f.jumpKind);
    copyProbe(this._axRear, r.y + ROAD_DECK + lift, r.surface, r.surface, r.surface, 0, r.jumpKind);
    return this._fillAxles(L);
  }

  /**
   * Turn the two normalised axle probes into a road plane.
   * @param {number} L wheelbase
   */
  _fillAxles(L) {
    const front = this._axFront;
    const rear = this._axRear;
    const frontGap = front.gap;
    const rearGap = rear.gap;
    let pitch;
    let midH;
    if (frontGap && rearGap) {
      pitch = 0;
      midH = Math.max(front.height, rear.height);
    } else if (frontGap) {
      pitch = 0;
      midH = rear.height;
    } else if (rearGap) {
      pitch = 0;
      midH = front.height;
    } else {
      pitch = Math.atan2(front.height - rear.height, L);
      midH = 0.5 * (front.height + rear.height);
    }
    const ax = this._axles;
    ax.L = L;
    ax.front = front;
    ax.rear = rear;
    ax.overGap = frontGap || rearGap;
    ax.bothGap = frontGap && rearGap;
    ax.pitch = pitch;
    ax.midH = midH;
    return ax;
  }

  /**
   * Visual pitch follows the axle plane. Small chatter stays deadzoned;
   * real grades snap on so both axles stay on the tarmac.
   *
   * @param {number} dt
   * @param {ReturnType<Vehicle['_fillAxles']>} axles
   * @param {boolean} pit
   */
  _updateVisPitch(dt, axles, pit) {
    if (!this.onGround || pit) {
      this._visPitch = this._roadPitch;
      return;
    }
    let visGrade = clamp(axles.pitch, -ROAD_PITCH_MAX, ROAD_PITCH_MAX);
    if (Math.abs(visGrade) < VIS_PITCH_DEADZONE) visGrade = 0;
    const wantPitch = -visGrade;
    const pitchRate =
      Math.abs(wantPitch - this._visPitch) > VIS_PITCH_SNAP ? 34 : VIS_PITCH_RATE;
    this._visPitch += (wantPitch - this._visPitch) * (1 - Math.exp(-pitchRate * dt));
  }

  /**
   * Chassis attitude from the road plane plus GTA IV weight.
   *
   * `_slope` is geometric uphill (front higher). `_visPitch` is the Three.js
   * Rx that plants the mesh (positive Rx is nose-down). Brake-dive / accel-squat
   * come from filtered `_ax` (applied force, not 240 Hz tire chatter). Roll
   * follows lateral g with a hint of rock. In the air the JumpModel owns attitude.
   */
  _updateAttitude(dt) {
    const s = this.spec;
    const trackW = 0.5 * ((s.trackFront || 1.5) + (s.trackRear || 1.5));
    const kSpringRoll = (trackW * trackW * 0.25) * (s.spring || 32000) * 2;
    const kArb = (s.antiRollFront || 0) + (s.antiRollRear || 0);
    const kRoll = Math.max(12000, kSpringRoll + kArb);
    const h = Math.max(0.12, (s.cgHeight || 0.34) - 0.12);
    const m = s.mass;
    const rollGain = (m * h) / kRoll;
    // Body lean is weight transfer, not extra wheel camber.
    // Wheels undo this in applyWheelPose about chassis Z, independent of steer.
    const rollMax = HANDLING.bodyRollMax != null ? HANDLING.bodyRollMax : 0.125;
    const rollMul = HANDLING.bodyRollMul != null ? HANDLING.bodyRollMul : 1.85;

    let rollTarget = 0;
    let squatTarget = 0;
    if (this.onGround) {
      const ay = Math.abs(this.speed) < 1.2 ? 0 : this._ay;
      rollTarget = clamp(ay * rollGain * rollMul, -rollMax, rollMax);
      const dive = HANDLING.brakeDive != null ? HANDLING.brakeDive : 0.0052;
      const squat = HANDLING.accelSquat != null ? HANDLING.accelSquat : 0.0034;
      const ax = this._ax;
      squatTarget = clamp(ax < 0 ? -ax * dive : -ax * squat, -0.032, 0.045);
    }

    if (this.onGround) {
      const squatRate = HANDLING.squatSmoothRate != null ? HANDLING.squatSmoothRate : 10;
      this._squatSmooth += (squatTarget - this._squatSmooth) * (1 - Math.exp(-squatRate * dt));
    } else {
      this._squatSmooth *= Math.exp(-8 * dt);
    }
    this._bodyPitch += (this._squatSmooth - this._bodyPitch) * (1 - Math.exp(-10 * dt));
    this._bodyPitchRate = 0;

    const iRoll = Math.max(280, s.rollInertia || 480);
    const wnRoll = Math.max(10, Math.sqrt(kRoll / iRoll));
    if (this.onGround) {
      this._springAxis("roll", rollTarget, dt, wnRoll, 1.08);
    } else {
      const wantRoll = clamp(this.jump.roll || 0, -0.22, 0.22);
      const k = 1 - Math.exp(-6 * dt);
      this.roll += (wantRoll - this.roll) * k;
      this.rollRate = this.jump.rollRate || 0;
    }

    if (this.onGround || this._padHitVy != null) {
      const want = this._visPitch + this._bodyPitch;
      const k = 1 - Math.exp(-24 * dt);
      this.pitch += (want - this.pitch) * k;
      this.pitchRate = (want - this.pitch) / Math.max(dt, 1e-4);
    } else {
      // Three.js Rx: + = nose down, JumpModel is + = nose up. Show the attitude
      // the driver actually commanded, so lifting and braking LOOKS like the
      // nose dropping.
      const flight = clamp(-this.jump.noseUp, -0.44, 0.44);
      const blend = 1 - Math.exp(-8 * dt);
      this.pitch += (flight - this.pitch) * blend;
      this.pitchRate = this.jump.noseUpRate * -1.05 + (flight - this.pitch) * 2.8;
    }
  }

  /**
   * Overdamped 2nd-order follow so the body settles instead of rocking.
   * @param {"roll"|"pitch"} axis
   * @param {number} target
   * @param {number} dt
   * @param {number} wn natural frequency (rad/s)
   * @param {number} zeta damping ratio (>1 = no bounce)
   */
  _springAxis(axis, target, dt, wn, zeta) {
    const x = this[axis];
    const v = this[axis + "Rate"];
    const acc = (target - x) * wn * wn - 2 * zeta * wn * v;
    const v2 = v + acc * dt;
    this[axis + "Rate"] = v2;
    this[axis] = x + v2 * dt;
  }

  /** After car-car bumps: keep yaw numerically sane. Tires do the rest. */
  stabilize() {
    this.yawRate = clamp(this.yawRate, -MAX_YAW_HANDBRAKE, MAX_YAW_HANDBRAKE);
  }

  /**
   * Turn two axle probes into the grip the driver actually feels.
   *
   * Grip eases over a few tenths of a second — a texture change still
   * unloads the car, it just does not teleport onto new rubber.
   *
   * `_axleSplit` is the front-vs-rear grip gap: positive means the front axle
   * found the better surface, so the tail is the one that steps out.
   *
   * @param {object} frontProbe normalised front axle probe
   * @param {object} rearProbe normalised rear axle probe
   * @param {number} dt
   * @param {boolean} splitAxle the two axles are on different named surfaces
   */
  _feelSurface(frontProbe, rearProbe, dt, splitAxle) {
    void splitAxle;
    const rf = blendSurfaces(frontProbe.from, frontProbe.to, frontProbe.mix, this._ribbonF);
    const rr = blendSurfaces(rearProbe.from, rearProbe.to, rearProbe.mix, this._ribbonR);
    this._axleSplit = gripGap(rr, rf);

    const target = (rf.muPeak + rr.muPeak) * 0.5;
    const step = target - this._feltMu;
    // Fast grip settle — slow felt-µ made every surface feel like ice for a beat.
    const tau = step < 0 ? 0.12 : 0.18;
    this._feltMu += step * (1 - Math.exp(-dt / tau));
    if (Math.abs(step) > 0.05) {
      this._surfShock = clamp(this._surfShock + Math.abs(step) * 0.4, 0, 0.4);
    }

    // Average the two axles for everything the whole chassis shares. Explicit
    // rather than a for-in so this stays a monomorphic hot path and so `color`
    // (a packed hex, meaningless when averaged) is never blended.
    const mix = this._felt;
    mix.id = rf.id;
    mix.label = rf.label;
    mix.muSlide = (rf.muSlide + rr.muSlide) * 0.5;
    mix.slipPeak = (rf.slipPeak + rr.slipPeak) * 0.5;
    mix.brakeHold = (rf.brakeHold + rr.brakeHold) * 0.5;
    mix.brakeYaw = (rf.brakeYaw + rr.brakeYaw) * 0.5;
    mix.slideHold = (rf.slideHold + rr.slideHold) * 0.5;
    mix.gripSnap = (rf.gripSnap + rr.gripSnap) * 0.5;
    mix.bumpSteer = (rf.bumpSteer + rr.bumpSteer) * 0.5;
    mix.roll = (rf.roll + rr.roll) * 0.5;
    mix.sink = (rf.sink + rr.sink) * 0.5;
    mix.bump = (rf.bump + rr.bump) * 0.5;
    mix.dust = (rf.dust + rr.dust) * 0.5;
    mix.speedScale = (rf.speedScale + rr.speedScale) * 0.5;
    mix.driftEase = (rf.driftEase + rr.driftEase) * 0.5;
    this._feltSlide += (mix.muSlide - this._feltSlide) * (1 - Math.exp(-dt / 0.16));
    this._feltBump += (mix.bump - this._feltBump) * (1 - Math.exp(-dt / 0.14));
    this._feltEase += (mix.driftEase - this._feltEase) * (1 - Math.exp(-dt / 0.16));
    this._feltHold += (mix.slideHold - this._feltHold) * (1 - Math.exp(-dt / 0.16));
    this._feltSnap += (mix.gripSnap - this._feltSnap) * (1 - Math.exp(-dt / 0.14));
    // Front-vs-rear mismatch is the staggered drift, not a slap every frame.
    const splitShock = Math.abs(this._axleSplit);
    if (splitShock > 0.08) {
      this._surfShock = Math.max(this._surfShock, clamp(splitShock * 0.32, 0, 0.4));
    }
    this._surfShock *= Math.exp(-2.4 * dt);
    if (this._surfShock < 0.02) this._surfShock = 0;

    mix.muPeak = this._feltMu;
    mix.muSlide = this._feltSlide;
    mix.bump = this._feltBump;
    mix.driftEase = this._feltEase;
    mix.slideHold = this._feltHold;
    mix.gripSnap = this._feltSnap;
    return mix;
  }

  /**
   * One tire / wheel-inertia substep in the body frame.
   * @param {number} dt substep length
   * @param {number} vx forward velocity
   * @param {number} vy lateral velocity (+ = toward the body right vector)
   * @param {number} r yaw rate
   * @param {object} surface felt surface
   * @param {{dist:number, lateral:number, axleSplit:number}} ctx
   * @returns {{vx:number, vy:number, r:number}}
   */
  _integrate(dt, vx, vy, r, surface, ctx) {
    const s = this.spec;
    const m = s.mass;
    const L = Math.max(1.6, s.wheelbase);
    const lf = L * 0.46;
    const lr = L * 0.54;
    const R = s.wheelRadius;
    const twoWd = s.drivetrain === "2wd";
    const hb = this.handbrake;
    const st = this.steer;

    const down = 1 + s.downforce * vx * vx * 0.0004;
    const staticF = m * G * (lr / L) * down;
    const staticR = m * G * (lf / L) * down;
    const wtMul = HANDLING.weightTransferMul != null ? HANDLING.weightTransferMul : 1.92;
    const dLong = ((m * this._ax * s.cgHeight) / L) * wtMul;
    const loadF = clamp(staticF - dLong, m * G * 0.12, m * G * 0.84);
    const loadR = clamp(staticR + dLong, m * G * 0.14, m * G * 0.88);
    const loadFRatio = loadF / Math.max(400, staticF);
    const loadRRatio = loadR / Math.max(400, staticR);
    const frontLight = clamp(1 - loadFRatio, 0, 0.65);
    const rearLight = clamp(1 - loadRRatio, 0, 0.65);

    const alphaFRaw = slipAngle(vy + r * lf, vx) - st;
    const alphaRRaw = slipAngle(vy - r * lr, vx);
    const rel = 1 - Math.exp((-Math.max(8, Math.abs(vx)) * dt) / RELAX_LEN);
    this._alphaF += (alphaFRaw - this._alphaF) * rel;
    this._alphaR += (alphaRRaw - this._alphaR) * rel;

    const kappaDenom = Math.max(2.8, Math.abs(vx));
    const kappaFRaw = (this.omegaF * R - vx) / kappaDenom;
    const kappaRRaw = (this.omegaR * R - vx) / kappaDenom;
    const relK = 1 - Math.exp((-Math.max(8, Math.abs(vx)) * dt) / RELAX_KAPPA);
    this._kappaF += (kappaFRaw - this._kappaF) * relK;
    this._kappaR += (kappaRRaw - this._kappaR) * relK;
    const kappaF = this._kappaF;
    const kappaR = this._kappaR;

    const peakA = surface.slipPeak || 0.14;
    const ease = Math.max(0.85, surface.driftEase || 1);
    const snap = Math.max(0.5, surface.gripSnap || 1);
    const shock = this._surfShock || 0;
    const unsettled = this.jump.unsettled;
    const jumpGrip = this.jump.gripScale();
    const split = ctx.axleSplit;
    const hbEnter = HANDLING.handbrakeEnter != null ? HANDLING.handbrakeEnter : 0.12;
    const loose = ease >= 0.84;
    // Throttle + steer on loose = power-slide intent (arcade initiation without e-brake).
    const slideIntent =
      loose &&
      hb < hbEnter + 0.04 &&
      this.throttle > 0.045 &&
      Math.abs(st) > 0.028 &&
      Math.abs(vx) > 3.4;

    // AM3 headline: brake on tarmac and you stop; brake on mud and you begin a
    // power slide. brakeYaw decides which of those two the pedal does here.
    const brakeRot = clamp(this.brake * (surface.brakeYaw || 0), 0, 1);

    // 4WD is still the planted car, but not glued — a little extra rear
    // lets the tail walk when the ribbon or a bump unloads it.
    let muF = surface.muPeak * 0.98 * jumpGrip;
    let muR = surface.muPeak * (twoWd ? 0.88 : 0.94) * jumpGrip;
    // GTA analog m_fTractionBias (Wh): 0.5 equal. Lower = Sultan planted
    // (more rear grip). Higher = Comet oversteer (more front grip).
    const tBias = clamp(s.tractionBiasFront != null ? s.tractionBiasFront : twoWd ? 0.56 : 0.46, 0.35, 0.65);
    muF *= 1 + (tBias - 0.5) * 0.8;
    muR *= 1 - (tBias - 0.5) * 0.8;
    // GTA analog fLowSpeedTractionLossMult — small wheelspin at crawl.
    // Fades out by ~32 km/h so hairpins stay snappy.
    const lowLoss = HANDLING.lowSpeedTractionLoss != null ? HANDLING.lowSpeedTractionLoss : 0.18;
    const lowSpd = clamp(1 - Math.abs(vx) / 9, 0, 1);
    muF *= 1 - lowSpd * lowLoss * 0.35;
    muR *= 1 - lowSpd * lowLoss * (twoWd ? 0.85 : 0.55);
    // GTA IV load: light axle loses µ. Brake → rear walks; throttle → nose pushes.
    muF *= clamp(0.62 + loadFRatio * 0.42, 0.58, 1.14);
    muR *= clamp(0.62 + loadRRatio * 0.42, 0.55, 1.14);
    // Staggered drift: whichever axle found the slicker ribbon loses grip
    // first. Positive split = front on the better surface, so the tail goes.
    muF *= 1 + split * AXLE_SPLIT_MU;
    muR *= 1 - split * AXLE_SPLIT_MU;
    const hbRearMu = HANDLING.handbrakeRearMu != null ? HANDLING.handbrakeRearMu : 0.08;
    if (hb > hbEnter) {
      // Lock the rears — this is the e-brake snap that starts a rally drift.
      muR *= lerp(1, hbRearMu, (hb - hbEnter) / Math.max(0.01, 1 - hbEnter));
      if (hb > 0.14) muF *= lerp(1, 0.82, hb);
    } else muR /= Math.max(0.94, Math.min(1.12, s.driftMul || 1));
    if (slideIntent) {
      // Power oversteer: throttle dumps rear grip so the tail walks out.
      muR *= lerp(1, 0.28, clamp(Math.abs(st) * this.throttle * 2.05, 0, 1));
    }
    if (this._shiftKick > 0.08) muR *= lerp(1, 0.68, Math.min(1, this._shiftKick));
    if (shock > 0.05) {
      muF *= lerp(1, 0.82, shock);
      muR *= lerp(1, 0.7, shock);
    }
    if (brakeRot > 0.02) muR *= lerp(1, 0.58, brakeRot);
    // Lift-off oversteer: closing throttle mid-corner unloads the rear.
    const liftOff =
      Math.abs(st) > 0.05 &&
      Math.abs(vx) > 6 &&
      this.throttle < 0.28 &&
      this.brake < 0.12 &&
      hb < hbEnter;
    const liftAmt = liftOff ? (0.28 - this.throttle) / 0.28 : 0;
    if (liftAmt > 0.08) muR *= lerp(1, 0.74, liftAmt);
    // CurveMin/CurveMax gap — IV once you break away you stay sliding.
    const minMul = HANDLING.tractionMinMul != null ? HANDLING.tractionMinMul : 0.86;
    const muSlideF = surface.muSlide * minMul;
    const muSlideR = surface.muSlide * minMul * (hb > hbEnter ? lerp(0.9, 0.42, hb) : 0.96);

    const front = combinedTire(this._alphaF, clamp(kappaF, -1.4, 1.6), loadF, muF, muSlideF, peakA, surface);
    const rear = combinedTire(this._alphaR, clamp(kappaR, -1.4, 1.6), loadR, muR, muSlideR, peakA, surface);

    const ratio = this._gearRatio();
    const inGear = ratio > 1e-6;
    const tqEng = engineTorque(this.rpm, this.throttle, s.peakPowerKw);
    let tqDrive = inGear ? tqEng * ratio * 0.88 : 0;
    const omegaLim = inGear ? (s.redline * 2 * Math.PI) / (60 * ratio) : 1e6;
    if (this.omegaR > omegaLim && tqDrive > 0) tqDrive *= 0.12;
    const top = (s.maxSpeedKmh / 3.6) * Math.max(0.7, surface.speedScale);
    const spdN = clamp(Math.abs(vx) / Math.max(10, top), 0, 1);
    // Sprint 19: was lerp(..., 0.48) — killed top-end punch before maxSpeed.
    // Sprint 28: stronger low-speed drive asymptote; aero + soft clamp still own Vmax.
    tqDrive *= lerp(1.34, 0.68, spdN * spdN);

    // Sprint 28 — dead-stop launch: extra drive that fades out by launchFadeKmh
    // so planted mid-corner grip from Sprint 26 stays intact.
    if (this.throttle > 0.08 && HANDLING.launchBoost > 1) {
      const fadeKmh = Math.max(20, HANDLING.launchFadeKmh || 78);
      const launchN = clamp((Math.abs(vx) * 3.6) / fadeKmh, 0, 1);
      tqDrive *= lerp(HANDLING.launchBoost, 1, launchN * launchN);
    }

    // Force budget that the powertrain is allowed to hold the car still with:
    // the pull of a stictionSlope grade, no more. Anything steeper has to win.
    const holdBudget = m * G * Math.sin(HANDLING.stictionSlope);
    const crawling = Math.abs(vx) < DRIVELINE_FADE_SPEED && this.throttle < 0.05;
    if (inGear && this.throttle < 0.05) {
      // SHUT THROTTLE MUST NOT PUSH. The engine map still makes idle torque at
      // zero throttle, and multiplied by a low gear that was enough to fight the
      // brakes — the car could measurably speed up under a full-brake downshift.
      // Allow only an idle creep, fading to nothing by DRIVELINE_FADE_SPEED, so
      // above walking pace a shut throttle means engine braking (coastN) alone.
      // At rest the creep is capped below the pull of a stictionSlope grade, so
      // the car inches forward on the level but sags back out of an uphill
      // hairpin instead of parking itself there.
      const fade = clamp(1 - Math.abs(vx) / DRIVELINE_FADE_SPEED, 0, 1);
      const creepCap = holdBudget * IDLE_DRIVE_SHARE * R * fade;
      if (tqDrive > creepCap) tqDrive = creepCap;
    }

    let splitF = twoWd ? 0 : s.torqueSplitFront;
    if (!twoWd && Math.abs(kappaR) > Math.abs(kappaF) + 0.02) {
      splitF = clamp(splitF + 0.32, 0, 0.7);
    }
    let tqF = tqDrive * splitF;
    let tqR = tqDrive * (1 - splitF);

    // Traction: keep slip sticky when planted; dump TC in a drift so throttle
    // can spin the rears. Smooth quadratic cut — a linear gain of 8 was a
    // bang-bang oscillator with Pacejka and shoved the hull fore-aft.
    const kSoft = twoWd ? 0.12 : 0.085;
    const tcMul = slideIntent || hb > hbEnter ? 0.12 : 1;
    if (hb < 0.08) {
      if (tqR > 0) {
        const over = Math.max(0, kappaR - kSoft);
        tqR *= clamp(1 / (1 + over * over * 48 * tcMul), 0.18, 1);
      }
      if (tqF > 0) {
        const over = Math.max(0, kappaF - kSoft);
        tqF *= clamp(1 / (1 + over * over * 48 * tcMul), 0.18, 1);
      }
    }

    // Braking character per surface. brakeHold is a threshold-braking assist
    // the SURFACE grants: tarmac holds the tire at peak slip so the stop is
    // short and dead straight, mud grants almost nothing so the wheels lock and
    // you brake on muSlide instead. That single number is most of the
    // difference between "you stop" and "you start a power slide".
    let tqBrakeF = this.brake * HANDLING.brakeTorqueFront;
    let tqBrakeR = this.brake * HANDLING.brakeTorqueRear;
    const brakeHold = clamp(surface.brakeHold != null ? surface.brakeHold : 0.45, 0, 1);
    if (brakeHold > 0.01 && this.brake > 0.02) {
      const kLock = -HANDLING.peakKappa;
      if (kappaF < kLock) {
        const over = kLock - kappaF;
        tqBrakeF *= clamp(1 / (1 + over * over * 36 * brakeHold), 0.06, 1);
      }
      if (kappaR < kLock) {
        const over = kLock - kappaR;
        tqBrakeR *= clamp(1 / (1 + over * over * 36 * brakeHold), 0.06, 1);
      }
    }
    tqBrakeF *= sign(this.omegaF || vx);
    tqBrakeR =
      tqBrakeR * sign(this.omegaR || vx) + hb * HANDLING.handbrakeTorque * sign(this.omegaR || vx);

    const driveI =
      s.driveInertia != null ? s.driveInertia : HANDLING.driveInertia != null ? HANDLING.driveInertia : 1;
    const wheelI = WHEEL_I * Math.max(0.7, driveI);
    this.omegaF += ((tqF - tqBrakeF - front.fx * R) / wheelI) * dt;
    this.omegaR += ((tqR - tqBrakeR - rear.fx * R) / wheelI) * dt;
    const coast = Math.max(inGear ? omegaLim * 1.15 : 0, 280);
    this.omegaF = clamp(this.omegaF, -coast * 0.25, coast);
    this.omegaR = clamp(this.omegaR, -coast * 0.25, coast);

    const cosS = Math.cos(st);
    const sinS = Math.sin(st);
    const Fx = front.fx * cosS - front.fy * sinS + rear.fx;

    const aero = 0.5 * RHO * s.aeroDrag * FRONTAL_A * vx * Math.abs(vx);
    let rollRes = (surface.roll + (surface.sink || 0) * 0.4) * m * G * sign(vx);
    let coastN =
      inGear && this.throttle < 0.05
        ? ((s.engineBrake * 220 + this.rpm * 0.01) * ratio) / R
        : 0;
    if (crawling) {
      // Same budget from the other side: drag forces may bring the car to rest on
      // the level, but they may not out-pull a real gradient. Scale the pair down
      // together so the ratio between engine braking and rolling drag survives.
      const dragRoom = Math.max(0, holdBudget * (1 - IDLE_DRIVE_SHARE));
      const drag = coastN + Math.abs(rollRes);
      if (drag > dragRoom) {
        const k = dragRoom / drag;
        coastN *= k;
        rollRes *= k;
      }
    }
    let axTire = (Fx - aero - rollRes - coastN * sign(vx)) / m - G * Math.sin(this._slope);
    this._axDrive += (axTire - this._axDrive) * (1 - Math.exp(-AX_DRIVE_RATE * dt));
    vx += this._axDrive * dt;

    const speed01 = clamp(Math.abs(vx) / Math.max(8, top), 0, 1);
    const hbSlide = hb > hbEnter || this._shiftKick > 0.12;
    // Planted when straight; once sliding, grip falls so attitude can build.
    let latG = surface.muPeak * G * lerp(1.02, 0.88, speed01 * speed01) * jumpGrip;
    if (twoWd) latG *= 0.9;
    if (hb > hbEnter) latG *= lerp(1, 0.26, (hb - hbEnter) / Math.max(0.01, 1 - hbEnter));
    if (this._shiftKick > 0.08) latG *= lerp(1, 0.65, Math.min(1, this._shiftKick));
    if (shock > 0.05) latG *= lerp(1, 0.88, shock);
    // Braking on loose ground spends lateral grip on rotation instead.
    if (brakeRot > 0.02) latG *= lerp(1, 0.72, brakeRot);
    latG /= Math.max(0.96, Math.min(1.08, s.driftMul || 1));
    // driftEase near 1.0 = planted; >1 softens mud for easier power slides.
    latG /= Math.max(0.92, Math.min(1.28, ease));
    if (slideIntent) {
      latG *= lerp(1, 0.4, clamp(Math.abs(st) * 2.8, 0, 1) * this.throttle);
    }
    const rearSliding = Math.abs(this._alphaR) > peakA * 1.0;
    const frontSliding = Math.abs(this._alphaF) > peakA * 1.05;
    if (rearSliding || frontSliding || slideIntent) {
      latG *= 0.78;
    }
    const slideAmt = clamp(Math.abs(vy) / 7.5, 0, 1);
    if (slideAmt > 0.08) {
      const gripMul = HANDLING.slideGripMul != null ? HANDLING.slideGripMul : 0.26;
      latG *= lerp(1, gripMul, slideAmt * slideAmt);
    }
    latG *= lerp(1, 0.78, rearLight);
    latG *= lerp(1, 0.88, frontLight);

    const rGrip = latG / Math.max(4.2, Math.abs(vx));
    let kus = hbSlide ? 0.00035 : HANDLING.speedUndersteer != null ? HANDLING.speedUndersteer : 0.00215;
    kus *= 1 + frontLight * 1.35;
    kus *= Math.max(0.35, 1 - rearLight * 0.7);
    let rWant = (vx * st) / (L * (1 + kus * vx * vx));
    const mush = HANDLING.limitMush != null ? HANDLING.limitMush : 0.42;
    rWant = softLimit(rWant, rGrip * 1.55, mush);
    // Weight-transfer yaw: light rear rotates in the steer direction (brake).
    if (Math.abs(st) > 0.03 && Math.abs(vx) > 5) {
      rWant += Math.sign(st) * rearLight * wtMul * 0.48 * (0.38 + Math.abs(vx) * 0.011);
      rWant *= 1 - clamp(frontLight, 0, 0.55) * 0.26;
    }

    const hbKick = HANDLING.handbrakeYawKick != null ? HANDLING.handbrakeYawKick : 3.15;
    if (hb > hbEnter && Math.abs(vx) > 3.2) {
      const steerDir = Math.abs(st) > 0.025 ? Math.sign(st) : sign(r) || sign(vy) || 0;
      if (steerDir !== 0) {
        // Initiation snap — e-brake + steer rotates the car into the slide.
        rWant += steerDir * hb * hbKick * (0.95 + Math.abs(vx) * 0.032);
      }
    }
    if (hb > 0.2 && Math.abs(st) > 0.04) {
      rWant += Math.sign(st) * hb * (0.55 + Math.abs(vx) * 0.018);
    }
    if (this._shiftKick > 0.08 && Math.abs(st) > 0.05) {
      rWant += this._shiftKickDir * this._shiftKick * 0.55;
    }
    // The brake pedal as a drift button. Needs a steering input to aim it, so
    // braking in a straight line on mud is long and messy but not a spin.
    if (brakeRot > 0.02 && Math.abs(st) > 0.03 && Math.abs(vx) > 5) {
      const bite = Math.min(1, (Math.abs(st) - 0.02) / 0.18);
      rWant += Math.sign(st) * brakeRot * bite * (0.52 + Math.abs(vx) * 0.016);
    }
    // Sprint 31 trail-brake: weight forward rotates the nose on corner entry.
    if (
      this.brake > 0.22 &&
      this.throttle < 0.08 &&
      Math.abs(st) > 0.05 &&
      Math.abs(vx) > 8 &&
      ease >= 0.88
    ) {
      const tb = HANDLING.trailBrakeYaw != null ? HANDLING.trailBrakeYaw : 0.44;
      const bite = Math.min(1, (Math.abs(st) - 0.04) / 0.22);
      rWant += Math.sign(st) * this.brake * tb * bite * (0.34 + Math.abs(vx) * 0.011);
    }
    // Throttle balance: on loose ground more throttle widens the slide, on hard
    // ground it pulls the nose through. driftEase is that loose/hard axis, so
    // one dial covers all seven surfaces.
    if (Math.abs(st) > 0.04 && Math.abs(vx) > 4.5) {
      const bias = (ease - 1) * HANDLING.throttleSlide * this.throttle;
      rWant *= 1 + clamp(bias, -0.22, 0.85);
    }
    if (hbSlide && this.throttle > 0.1 && Math.abs(vx) > 4) {
      // Power oversteer while e-brake is held — the fun part of a rally drift.
      const pMul = HANDLING.handbrakePowerMul != null ? HANDLING.handbrakePowerMul : 2.05;
      const steerDir = Math.abs(st) > 0.025 ? Math.sign(st) : sign(r) || sign(vy) || 1;
      rWant += steerDir * this.throttle * Math.max(hb, 0.35) * pMul * (0.72 + Math.abs(vx) * 0.022);
    }
    if (!hbSlide && this.throttle > 0.12 && Math.abs(st) > 0.06 && Math.abs(vx) > 4.5) {
      const pitch = HANDLING.powerSlidePitch != null ? HANDLING.powerSlidePitch : 1.35;
      rWant += Math.sign(st) * this.throttle * pitch * (0.42 + Math.abs(vx) * 0.016);
    }
    // Lift-off: close throttle mid-corner and the tail comes (GTA IV).
    if (liftAmt > 0.08) {
      const liftGain = HANDLING.liftOffYaw != null ? HANDLING.liftOffYaw : 0.44;
      rWant *= 1 + liftAmt * liftGain;
    }
    // Staggered drift as a yaw moment you can aim: put the grippier axle on the
    // new ribbon first and the car pivots about it for free.
    if (Math.abs(split) > 0.05 && Math.abs(vx) > 6) {
      const dir = Math.abs(st) > 0.03 ? Math.sign(st) : sign(r) || sign(vy) || 1;
      rWant += dir * split * AXLE_SPLIT_YAW * clamp(Math.abs(vx) / 22, 0, 1);
    }

    // Ribbon roughness. Two wheels up on a bump while you steer AWAY from it is
    // the classic way to lose a rally car, so that case is amplified, not hidden.
    const dist = ctx.dist;
    const lat = ctx.lateral;
    const rough = (surface.bump || 0) * (surface.bumpSteer != null ? surface.bumpSteer : 1.2);
    const kick =
      bumpField(dist, lat) *
      rough *
      Math.abs(vx) *
      HANDLING.bumpYawGain *
      (1 + shock + unsettled * 0.6);
    const bumpSide = bumpSideAt(dist, lat);
    const away = st !== 0 && Math.sign(st) === -bumpSide ? Math.min(1, Math.abs(st) / 0.22) : 0;
    rWant += kick * (1 + away * HANDLING.bumpSteerAmplify);
    if (shock > 0.08) {
      const side = Math.abs(st) > 0.04 ? Math.sign(st) : sign(r) || sign(vy) || 1;
      rWant += side * shock * 0.42;
    }

    // Countersteer is the tool. Opposite lock — steering INTO the slide, which
    // is the same sign as lateral velocity — gets a large, predictable
    // authority boost scaled by the surface's gripSnap. That is why an expert
    // can hold a big angle on gravel and why a novice can still catch the car
    // with a flick on tarmac.
    const slideDir = Math.abs(vy) > 0.6 ? sign(vy) : 0;
    const counter =
      slideDir !== 0 && Math.sign(st) === slideDir ? Math.min(1, Math.abs(st) / 0.26) : 0;
    const slipAmt = clamp(Math.abs(vy) / Math.max(2.2, latG * 0.22), 0, 1);
    // Mass at speed, snappy in hairpins. Countersteer still catches like a switch.
    const speedMass = clamp(Math.abs(vx) / 46, 0, 1);
    let yawFollow = hbSlide ? lerp(30, 14, slipAmt) : lerp(34, 16, slipAmt) / Math.max(0.95, ease);
    yawFollow *= lerp(1.05, 0.4, speedMass * speedMass);
    yawFollow *= 1 + counter * HANDLING.counterAuthority * snap;
    if (counter > 0.35) {
      const eMul = HANDLING.expertCounterMul != null ? HANDLING.expertCounterMul : 1.18;
      yawFollow *= 1 + (counter - 0.35) * (eMul - 1) * 2.4;
    }
    yawFollow *= s.yawGain != null ? s.yawGain : 1;
    // Tire yaw moment (SAE bicycle). fyPure = -pacejka so +steer → +front.fy;
    // rWant = vx*st/L is + with +steer. RAGE cars rotate from Mz, not kinematics.
    // Hairpins stay on rWant; speed blends in tire mass (IV delayed yaw).
    const Izz = Math.max(900, s.yawInertia != null ? s.yawInertia : 2140);
    const rDotTire = (front.fy * cosS * lf - rear.fy * lr) / Izz;
    const tireBlend = HANDLING.tireYawBlend != null ? HANDLING.tireYawBlend : 0.62;
    const speedBlend = lerp(0.22, tireBlend, speedMass);
    const follow = 1 - Math.exp(-yawFollow * dt);
    r += (rWant - r) * follow * (1 - speedBlend);
    r += rDotTire * dt * (0.55 + speedBlend);

    const rMax = hbSlide
      ? Math.min(MAX_YAW_HANDBRAKE, rGrip * 3.2 + 1.15)
      : Math.min(MAX_YAW_RATE, rGrip * 1.85 + 0.5);
    r = clamp(r, -rMax, rMax);

    vy += -vx * r * dt;

    const FyNet = (front.fy * cosS + rear.fy) / m;
    if (Math.abs(FyNet) > 0.12) {
      const fyGain = hbSlide ? 2.45 : slideIntent ? 2.15 : 1.18;
      vy += FyNet * dt * fyGain;
    }

    const powerSlide =
      hbSlide ||
      slideIntent ||
      (Math.abs(vy) > 0.28 && this.throttle > 0.05 && Math.abs(st) > 0.035) ||
      (brakeRot > 0.08 && Math.abs(st) > 0.04 && Math.abs(vx) > 4);
    if (hb > hbEnter && Math.abs(vx) > 3) {
      const steerDir = Math.abs(st) > 0.025 ? Math.sign(st) : sign(r) || sign(vy) || 0;
      if (steerDir !== 0) {
        // Lateral shove from locked rears — builds the visible slide angle fast.
        const push = hb * steerDir * (0.85 + Math.abs(vx) * 0.055) * dt;
        vy += push;
        if (this.throttle > 0.08) vy += push * this.throttle * 1.55;
      }
    }
    // Arcade pitch-in: throttle + steer builds attitude so a powerslide reads
    // exaggerated without needing the handbrake every corner.
    const pitch = HANDLING.powerSlidePitch != null ? HANDLING.powerSlidePitch : 1.35;
    if (slideIntent && Math.abs(vy) < 8.5) {
      vy += Math.sign(st) * this.throttle * pitch * (0.72 + Math.abs(vx) * 0.036) * dt;
    }
    if (!hbSlide && powerSlide && Math.abs(vx) > 4) {
      const steerDir = Math.sign(st) || sign(vy) || 0;
      if (steerDir !== 0) {
        vy += steerDir * this.throttle * pitch * (0.48 + Math.abs(vx) * 0.03) * dt;
      }
    }
    vy += bumpField(dist * 1.6, lat) * rough * Math.abs(vx) * 0.06 * dt;
    if (shock > 0.08) vy += (Math.sign(st) || sign(vy) || 1) * shock * 1.1 * dt;
    const maxDvy = latG * dt;
    // Recovery character. slideHold is how long a slide carries itself with no
    // input; gripSnap is how fast an ACTIVE correction gets it back. Tarmac
    // self-centres and answers instantly; mud carries and makes you wait.
    const holdRate =
      (LAT_BLEED / (ease * Math.max(0.45, surface.slideHold || 1))) * (1 + counter * snap * 1.15);
    let bleedMul = 1;
    if (powerSlide) {
      bleedMul = hbSlide
        ? HANDLING.handbrakeBleedMul != null
          ? HANDLING.handbrakeBleedMul
          : 0.032
        : HANDLING.driftBleedMul != null
          ? HANDLING.driftBleedMul
          : 0.048;
      // Throttle sustains the slide — classic arcade power-slide hold.
      if (this.throttle > 0.1) bleedMul *= 0.1;
      else if (this.throttle > 0.02) bleedMul *= 0.32;
    }
    const hold = Math.exp(-holdRate * bleedMul * dt);
    let dvyCap = maxDvy;
    if (powerSlide) dvyCap *= 5.8;
    if (Math.abs(vy) <= dvyCap) vy *= hold;
    else vy -= Math.sign(vy) * dvyCap;
    vx += vy * r * dt;

    this._rearSlide =
      hbSlide || slideIntent || Math.abs(vy) > 0.65 || Math.abs(kappaR) > 0.14 || shock > 0.28;
    this._frontSlide = Math.abs(this._alphaF) > peakA * 1.2 || Math.abs(kappaF) > 0.28;

    // Ceiling on slide angle, scaled by how much the surface wants to carry a
    // slide. A single global cap made every loose surface saturate at the same
    // angle, so mud and gravel felt identical at the limit and the top half of
    // the lock range did nothing. Tying it to slideHold gives each surface its
    // own maximum attitude — tarmac keeps a tidy angle, mud will sit sideways —
    // and leaves the whole steering range doing something. The yaw rate is still
    // clamped separately (rWant vs rGrip), so a wider angle is not a spin.
    const capScale = clamp(surface.slideHold || 1, SLIDE_CAP_MIN, SLIDE_CAP_MAX);
    const vyCap = (hbSlide ? HANDLING.maxSlideVelHandbrake : HANDLING.maxSlideVel) * capScale;
    vy = clamp(vy, -vyCap, vyCap);

    // Gravity and inertia are strong: a car left on a slope rolls back down.
    // Only genuinely flat ground gets a stiction stop, so a hill is a hazard
    // you have to hold the car on rather than a place to park.
    const flat = Math.abs(this._slope) < HANDLING.stictionSlope;
    if (
      this.throttle < 0.02 &&
      this.brake < 0.04 &&
      flat &&
      Math.abs(vx) < 0.35 &&
      Math.abs(vy) < 0.35
    ) {
      vx = 0;
      vy = 0;
      r *= 0.45;
      this._axDrive = 0;
      if (hb > 0.5) {
        this.omegaF *= 0.7;
        this.omegaR *= 0.12;
      }
    }

    if (vx > top) vx = lerp(vx, top, 0.08);
    if (vx < -top * 0.28) vx = -top * 0.28;
    if (vx === 0 && this.throttle < 0.02) {
      axTire = 0;
      this._axDrive = 0;
    }

    // Lateral felt-g for body roll. Longitudinal _ax is blended once per
    // frame after all substeps so load transfer cannot chatter at 240 Hz.
    const ayKinematic = vx * r;
    const aySmooth = this.lowDetail ? 0.48 : 0.3;
    this._ay += (ayKinematic - this._ay) * aySmooth;
    return { vx, vy, r, axTire: this._axDrive };
  }

  /**
   * Last-resort recovery so nothing can hard-fail a championship run.
   *
   * The brief is explicit that there is no crash-out and no off-course
   * elimination, so a car wedged against scenery has to get going again. This
   * waits long enough that it never interrupts a legitimate slow moment, and it
   * hands the car back pointing down the road at walking pace rather than
   * teleporting it up to speed.
   */
  _unstick(dt, track, q) {
    const slow = this.speed < 2.4;
    const off = Math.abs(q.lateral) > q.width * 0.5 + 0.4;
    if (slow && (this.throttle > 0.12 || off)) this._still += dt;
    else this._still = Math.max(0, this._still - dt * 2);

    if (this._still < 0.9) return;
    const line = track.sample(q.dist, this._sample);
    this.position.x += (line.x - this.position.x) * 0.4;
    this.position.z += (line.z - this.position.z) * 0.4;
    let dh = line.heading - this.yaw;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    this.yaw += dh * 0.35;
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    this.velocity.x = fx * 5;
    this.velocity.z = fz * 5;
    this.yawRate = 0;
    this.omegaF = 5 / this.spec.wheelRadius;
    this.omegaR = 5 / this.spec.wheelRadius;
    this._rearSlide = false;
    this._still = 0;
  }

  /**
   * Engine speed and automatic shifting.
   * Neutral is a real state: the engine free-revs and the wheels coast.
   */
  _updateEngine(dt, omegaDrive) {
    const s = this.spec;
    const ratio = this._gearRatio();
    if (ratio <= 1e-6) {
      const target = s.idleRpm + this.throttle * (s.redline - s.idleRpm) * 0.92;
      this.rpm += (target - this.rpm) * Math.min(1, 9 * dt);
    } else {
      const drivenRpm = (Math.abs(omegaDrive) * ratio * 60) / (Math.PI * 2);
      if (this.throttle > 0.06) {
        const flare = s.idleRpm + this.throttle * (s.redline - s.idleRpm) * 0.22;
        const target = Math.max(drivenRpm, flare);
        this.rpm += (clamp(target, s.idleRpm, s.redline) - this.rpm) * Math.min(1, 11 * dt);
      } else {
        this.rpm += (Math.max(s.idleRpm, drivenRpm) - this.rpm) * Math.min(1, 7 * dt);
      }
    }
    this.rpm = clamp(this.rpm, s.idleRpm, s.redline);

    if (this.autoTrans) {
      this._autoShift(dt);
    } else {
      this.gear = clamp(this.gear, 0, this._topGear());
    }
  }

  /**
   * Race-fun automatic: hold gears on throttle, dump them fast under brake,
   * and kick-down when the turbo goes quiet. The old logic only downshifted
   * below 2700 with light throttle only — that left the car stuck in a tall gear
   * into every hairpin.
   *
   * @param {number} dt
   */
  _autoShift(dt) {
    const s = this.spec;
    const top = this._topGear();
    const red = s.redline || 7500;
    const A = (HANDLING && HANDLING.auto) || {};
    if (this.gear < 1) this.gear = 1;

    this._autoCool = Math.max(0, (this._autoCool || 0) - dt);
    if (this._autoCool > 0) return;

    const th = this.throttle;
    const br = Math.max(this.brake, this.handbrake * 0.9);
    const rpm = this.rpm;

    // Upshift RPM rises with throttle — WOT holds near redline for punch.
    const upRpm = lerp(
      red * (A.upCoast != null ? A.upCoast : 0.68),
      red * (A.upWot != null ? A.upWot : 0.955),
      clamp(th * th, 0, 1)
    );
    if (this.gear < top && br < 0.14 && rpm >= upRpm) {
      this.gear += 1;
      this._autoCool = A.coolUp != null ? A.coolUp : 0.09;
      return;
    }

    if (this.gear <= 1) return;

    const kickRpm = A.kickDownRpm != null ? A.kickDownRpm : 4800;
    const brakeFloor = lerp(
      A.brakeDownMin != null ? A.brakeDownMin : 5000,
      A.brakeDownMax != null ? A.brakeDownMax : 6400,
      clamp(br, 0, 1)
    );
    const coastRpm = A.coastDownRpm != null ? A.coastDownRpm : 3400;

    let drops = 0;
    if (br > 0.1 && rpm < brakeFloor) {
      // Hard brake into a hairpin: skip gears so the next throttle pull bites.
      if (br > 0.75 && rpm < 4800) drops = Math.min(3, this.gear - 1);
      else if (br > 0.4) drops = Math.min(2, this.gear - 1);
      else drops = 1;
    } else if (th > 0.55 && rpm < kickRpm) {
      // Kick-down — keep the engine in the meat under throttle.
      drops = rpm < kickRpm * 0.72 && this.gear > 2 ? 2 : 1;
    } else if (th < 0.22 && br < 0.08 && rpm < coastRpm) {
      drops = 1;
    }

    if (drops <= 0) return;
    const next = Math.max(1, this.gear - drops);
    if (next >= this.gear) return;
    const steps = this.gear - next;
    this.gear = next;
    // Blip so the next gear feels loaded, not soggy.
    this.rpm = clamp(this.rpm + 850 * steps, s.idleRpm, red);
    this._autoCool =
      br > 0.15
        ? A.coolBrake != null
          ? A.coolBrake
          : 0.04
        : A.coolDown != null
          ? A.coolDown
          : 0.055;
  }

  speedKmh() {
    return this.speed * 3.6;
  }

  /** 0..1 lateral slide intensity for expert HUD / camera. */
  slidePct() {
    return this._slidePct || 0;
  }

  /** 0..1 grip demand — rises when sliding or wheelspinning. */
  gripUsed() {
    return this._gripUsed || this.slip || 0;
  }

  poseMatrix(out) {
    this._euler.set(this.pitch, this.yaw, this.roll, "YXZ");
    out.makeRotationFromEuler(this._euler);
    out.setPosition(this.position);
    return out;
  }
}

/**
 * Normalise one road probe into the shared axle shape.
 * Track.query reports `height`; Track.sample reports `y` — the callers convert
 * before they get here so everything downstream reads one set of keys.
 *
 * @param {object} out persistent probe bag
 * @param {number} height road surface height (already includes ROAD_DECK)
 * @param {string} surface resolved surface id
 * @param {string} from surface being blended out of
 * @param {string} to surface being blended into
 * @param {number} mix 0..1 blend position
 * @param {string|null} jumpKind "ramp" | "crest" | "gap" | "land" | null
 */
function copyProbe(out, height, surface, from, to, mix, jumpKind) {
  out.height = height;
  out.surface = surface || "dirt";
  out.from = from || out.surface;
  out.to = to || out.surface;
  out.mix = mix || 0;
  out.gap = jumpKind === "gap";
}
