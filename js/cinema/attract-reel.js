/**
 * Attract reel — smooth cinematic tour of the real championship stages.
 *
 * WHO THIS IS FOR: title + SELECT MODE.
 * WHAT IT DOES: builds Desert → Forest → Mountain → Lakeside (actual Track
 *   worlds), rolls the pack continuously, and eases the camera between long
 *   holds — no MTV flash edits.
 * HOW IT CONNECTS: RallyGame starts this after title IBL; CSS overlays live
 *   in index.html (#attract-fx). Uses Track.create + Track.sample. Does not
 *   own race physics.
 */

import * as THREE from "../../vendor/three.module.js";
import {
  attractChassisY,
  attractChassisYCleared,
  attractDeckLift,
} from "./attract-plant.js?v=2";

/** @type {typeof import("../tracks/track.js").Track|null} */
let TrackCtor = null;
/** @type {Record<string, object>|null} */
let CoursesMap = null;

/** Lazy-load Track + COURSES so phone title never pulls the stage builder. */
async function loadStageApi() {
  if (TrackCtor && CoursesMap) return;
  const [trackMod, courseMod] = await Promise.all([
    import("../tracks/track.js?v=483"),
    import("../tracks/courses.js?v=104"),
  ]);
  TrackCtor = trackMod.Track;
  CoursesMap = courseMod.COURSES;
}

/** Cinematic holds — long enough to read the stage (no flash edits). */
const SHOT_HOLD = {
  bumper: 3.4,
  moto: 3.8,
  whip: 3.2,
  heli: 4.4,
  headon: 3.6,
  lowside: 3.0,
  jump: 4.2,
  dutch: 3.4,
  crane: 4.0,
  smash: 2.8,
  nose: 3.2,
  packfly: 4.0,
  rear: 3.6,
  bank: 3.5,
  land: 3.4,
};

const SHOT_LABEL = {
  bumper: "REAR TRACKING",
  moto: "CHASE",
  whip: "ROADSIDE",
  heli: "HELICOPTER",
  headon: "HEAD-ON",
  lowside: "WHEEL CAM",
  jump: "OVER JUMP",
  dutch: "SWEEPER",
  crane: "JIB",
  smash: "TRACKSIDE",
  nose: "NOSE",
  packfly: "PACK FLY-BY",
  rear: "PACK",
  bank: "APEX",
  land: "LANDING",
};

/** Calmer cycle — fewer lenses, less repeat thrash. */
const CYCLE = ["heli", "moto", "packfly", "headon", "bank", "crane", "rear", "jump"];

const STAGE_ORDER = ["desert", "forest", "mountain", "lakeside"];
const STAGE_ORDER_PHONE = ["desert", "forest", "lakeside"];

/** Seconds on one stage before a soft fade to the next course. */
const STAGE_DWELL = 22;

/** Soft crossfade durations (seconds). */
const FADE_OUT = 0.55;
const FADE_IN = 0.7;

const STAGE_TITLE = {
  desert: "DESERT",
  forest: "FOREST",
  mountain: "MOUNTAIN",
  lakeside: "LAKESIDE",
};

/**
 * Highlight beats along a built track — jumps first, then apexes.
 * @param {{points?:object[], length?:number, id?:string, name?:string}} track
 * @returns {{dist:number, kind:string, label:string, shot:string}[]}
 */
function buildBeats(track) {
  const pts = track.points || [];
  const len = Math.max(40, track.length || 40);
  /** @type {{dist:number, kind:string, label:string, shot:string}[]} */
  const raw = [];
  const seen = new Set();

  /**
   * @param {number} dist
   * @param {string} kind
   * @param {string} label
   * @param {string} shot
   */
  function add(dist, kind, label, shot) {
    const d = Math.max(12, Math.min(len - 24, dist));
    const key = Math.round(d / 18);
    if (seen.has(key)) return;
    seen.add(key);
    raw.push({ dist: d, kind, label, shot });
  }

  const stage = STAGE_TITLE[track.id] || String(track.name || track.id || "STAGE").toUpperCase();
  add(28, "open", stage, "heli");
  add(70, "open", `${stage} · GRID`, "packfly");

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const jk = p.jumpKind;
    if (jk === "ramp" || jk === "crest") add(p.dist - 8, "jump", "OVER JUMP", "jump");
    else if (jk === "gap") add(p.dist - 3, "jump", "AIRTIME", "jump");
    else if (jk === "land") add(p.dist + 4, "land", "LANDING", "land");
    else if (p.sweep) add(p.dist - 14, "apex", "SWEEPER", "dutch");
  }

  for (let i = 10; i < pts.length - 10; i += 5) {
    const a = pts[i - 5];
    const b = pts[i];
    const c = pts[i + 5];
    let dy = c.heading - a.heading;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    if (Math.abs(dy) > 0.62) {
      add(b.dist - 12, "apex", Math.abs(dy) > 1.1 ? "HAIRPIN" : "APEX", "bank");
    }
  }

  raw.sort((a, b) => a.dist - b.dist);
  /** @type {typeof raw} */
  const spaced = [];
  for (let i = 0; i < raw.length; i++) {
    const b = raw[i];
    if (!spaced.length || b.dist - spaced[spaced.length - 1].dist > 38) spaced.push(b);
  }
  if (spaced.length < 3) {
    spaced.push({ dist: len * 0.35, kind: "open", label: stage, shot: "moto" });
    spaced.push({ dist: len * 0.62, kind: "apex", label: "MID STAGE", shot: "whip" });
  }
  return spaced;
}

/**
 * Cinematic director — long holds, ease between lenses, jump priority.
 */
export class AttractDirector {
  /**
   * @param {{reducedMotion?:boolean}} [opts]
   */
  constructor(opts) {
    this.reduced = !!(opts && opts.reducedMotion);
    this.kind = "packfly";
    this.shotT = 0;
    this.hold = SHOT_HOLD.packfly;
    this.fade = 0;
    this.flash = 0;
    this.phase = "in";
    this.phaseT = 0;
    this.dutch = 0;
    this.fov = 48;
    this.eye = new THREE.Vector3(0, 8, 12);
    this.look = new THREE.Vector3(0, 1, 0);
    this._te = new THREE.Vector3();
    this._tl = new THREE.Vector3();
    this._tfov = 48;
    this._tdutch = 0;
    this.justCut = false;
    this._forced = null;
    this._pendingKind = null;
    this._labelOverride = null;
  }

  /** @returns {string} */
  label() {
    return this._labelOverride || SHOT_LABEL[this.kind] || "WORLD FEED";
  }

  /**
   * @param {string} kind
   * @param {string} [label]
   */
  forceNext(kind, label) {
    this._forced = kind;
    this._labelOverride = label || null;
  }

  /**
   * @param {object} pose
   */
  snap(pose) {
    this._compose(this.kind, pose);
    this.eye.copy(this._te);
    this.look.copy(this._tl);
    this.fov = this._tfov;
    this.dutch = this._tdutch;
    this.fade = this.phase === "in" ? 1 : 0;
  }

  /**
   * @param {number} dt
   * @param {object} pose
   * @param {object} [pack]
   */
  update(dt, pose, pack) {
    if (!pose) return this._out();
    this.justCut = false;
    this.shotT += dt;
    this.flash = 0;
    this._compose(this.kind, pose, pack);
    if (this.phase === "hold" && (this.shotT >= this.hold || this._mustCut(pose))) {
      this._cut(pose);
    }
    this._phase(dt, pose);
    // Always ease — snap only on first boot via AttractReel.
    this._follow(dt);
    return this._out();
  }

  _out() {
    const hot = this.kind === "jump" || this.kind === "headon" || this.kind === "packfly";
    return {
      fade: Math.min(0.72, this.fade),
      flash: 0,
      kind: this.kind,
      label: this.label(),
      dutch: this.dutch,
      fov: this.fov,
      chroma: hot && !this.reduced ? 0.04 : 0,
      smear: 0,
      speedFx: this.kind === "jump" ? 0.06 : hot ? 0.08 : 0.03,
      ramp: this.kind === "jump" ? "slow" : "live",
      energy: "live",
      calm: true,
      justCut: this.justCut,
    };
  }

  _mustCut(pose) {
    // Only break early for a real jump — never thrash on whip/smash timers.
    if (this.shotT < 1.8) return false;
    if (pose && pose.jump && this.kind !== "jump" && this.shotT > 2.2) return true;
    return false;
  }

  _cut(pose) {
    let next = this._forced;
    this._forced = null;
    if (!next) {
      if (pose && pose.jump && this.kind !== "jump") next = "jump";
      else {
        const i = CYCLE.indexOf(this.kind);
        next = CYCLE[(i + 1) % CYCLE.length];
      }
    }
    this._pendingKind = next;
    this.shotT = 0;
    this.hold = (SHOT_HOLD[next] || 3.2) * (this.reduced ? 1.35 : 1);
    this.phase = "out";
    this.phaseT = 0;
    this.fade = 0;
    this.justCut = true;
    this.flash = 0;
  }

  _phase(dt, pose) {
    this.phaseT += dt;
    if (this.phase === "out") {
      const u = Math.min(1, this.phaseT / FADE_OUT);
      this.fade = u * u * (3 - 2 * u);
      if (u >= 1) {
        if (this._pendingKind) {
          this.kind = this._pendingKind;
          this._pendingKind = null;
        }
        this._compose(this.kind, pose);
        // Soft handoff — ease into the new lens, do not hard snap.
        this.phase = "in";
        this.phaseT = 0;
      }
    } else if (this.phase === "in") {
      const u = Math.min(1, this.phaseT / FADE_IN);
      this.fade = 1 - u * u * (3 - 2 * u);
      if (u >= 1) {
        this.phase = "hold";
        this.fade = 0;
      }
    } else {
      this.fade = 0;
    }
  }

  _follow(dt) {
    // Creamy tracking — slower during crossfade so the cut never pops.
    const rate = this.phase === "hold" ? 3.2 : 5.5;
    const k = 1 - Math.exp(-dt * rate);
    this.eye.lerp(this._te, k);
    this.look.lerp(this._tl, k);
    this.fov += (this._tfov - this.fov) * k;
    this.dutch += (this._tdutch - this.dutch) * k;
  }

  /**
   * @param {object} pose
   * @param {object} [pack]
   * @param {number} [bias]
   */
  _aim(pose, pack, bias) {
    const second = pack && pack.second;
    if (!second) return pose;
    const b = bias == null ? 0.38 : bias;
    return {
      x: pose.x * (1 - b) + second.x * b,
      y: pose.y * (1 - b) + second.y * b,
      z: pose.z * (1 - b) + second.z * b,
      yaw: pose.yaw,
      nx: pose.nx,
      nz: pose.nz,
    };
  }

  /**
   * @param {string} kind
   * @param {object} pose
   * @param {object} [pack]
   */
  _compose(kind, pose, pack) {
    const aim = kind === "packfly" || kind === "heli" || kind === "rear" ? this._aim(pose, pack) : pose;
    const fx = Math.sin(aim.yaw);
    const fz = Math.cos(aim.yaw);
    const nx = aim.nx;
    const nz = aim.nz;
    const deck = aim.y;
    const lookY = deck + 0.82;
    this._tdutch = 0;
    if (kind === "bumper") {
      this._te.set(aim.x - fx * 5.1 + nx * 0.35, deck + 1.08, aim.z - fz * 5.1 + nz * 0.35);
      this._tl.set(aim.x + fx * 10, lookY + 0.15, aim.z + fz * 10);
      this._tfov = 48;
    } else if (kind === "moto") {
      this._te.set(aim.x - fx * 8.4 + nx * 1.1, deck + 1.7, aim.z - fz * 8.4 + nz * 1.1);
      this._tl.set(aim.x + fx * 9, lookY, aim.z + fz * 9);
      this._tfov = 52;
    } else if (kind === "whip") {
      const side = pose.t % 6 < 3 ? 1 : -1;
      this._te.set(aim.x + nx * 8.2 * side - fx * 1.2, deck + 0.72, aim.z + nz * 8.2 * side - fz * 1.2);
      this._tl.set(aim.x + fx * 5, lookY, aim.z + fz * 5);
      this._tfov = 42;
      this._tdutch = side * 0.08;
    } else if (kind === "heli") {
      this._te.set(aim.x - fx * 14 + nx * 6, deck + 11.5, aim.z - fz * 14 + nz * 6);
      this._tl.set(aim.x + fx * 8, deck + 0.4, aim.z + fz * 8);
      this._tfov = 40;
    } else if (kind === "headon") {
      this._te.set(aim.x + fx * 16 + nx * 1.2, deck + 1.35, aim.z + fz * 16 + nz * 1.2);
      this._tl.set(aim.x - fx * 2, lookY, aim.z - fz * 2);
      this._tfov = 44;
    } else if (kind === "lowside") {
      this._te.set(aim.x + nx * 3.4 - fx * 2.2, deck + 0.38, aim.z + nz * 3.4 - fz * 2.2);
      this._tl.set(aim.x + fx * 3, lookY - 0.1, aim.z + fz * 3);
      this._tfov = 55;
    } else if (kind === "jump" || kind === "land") {
      this._te.set(aim.x - fx * 9 + nx * 4.5, deck + 3.8, aim.z - fz * 9 + nz * 4.5);
      this._tl.set(aim.x + fx * 6, lookY + 1.2, aim.z + fz * 6);
      this._tfov = 46;
    } else if (kind === "dutch") {
      this._te.set(aim.x - fx * 7 + nx * 5.5, deck + 2.2, aim.z - fz * 7 + nz * 5.5);
      this._tl.set(aim.x + fx * 8, lookY, aim.z + fz * 8);
      this._tfov = 44;
      this._tdutch = 0.14;
    } else if (kind === "crane") {
      this._te.set(aim.x - fx * 6 + nx * 2, deck + 2.05 + Math.min(7, this.shotT * 4.2), aim.z - fz * 6 + nz * 2);
      this._tl.set(aim.x + fx * 10, lookY, aim.z + fz * 10);
      this._tfov = 42;
    } else if (kind === "smash") {
      const side = pose.t % 5 < 2.5 ? 1 : -1;
      this._te.set(aim.x + nx * 5.5 * side + fx * 1.5, deck + 0.95, aim.z + nz * 5.5 * side + fz * 1.5);
      this._tl.set(aim.x - fx * 1, lookY, aim.z - fz * 1);
      this._tfov = 50;
    } else if (kind === "nose") {
      this._te.set(aim.x + fx * 2.4 + nx * 0.4, deck + 0.95, aim.z + fz * 2.4 + nz * 0.4);
      this._tl.set(aim.x + fx * 14, lookY + 0.2, aim.z + fz * 14);
      this._tfov = 58;
    } else if (kind === "rear") {
      this._te.set(aim.x - fx * 11 + nx * 0.8, deck + 2.4, aim.z - fz * 11 + nz * 0.8);
      this._tl.set(aim.x + fx * 4, lookY, aim.z + fz * 4);
      this._tfov = 46;
    } else if (kind === "bank") {
      const side = pose.t % 7 < 3.5 ? 1 : -1;
      this._te.set(aim.x + nx * 6.5 * side - fx * 3, deck + 1.55, aim.z + nz * 6.5 * side - fz * 3);
      this._tl.set(aim.x + fx * 6, lookY, aim.z + fz * 6);
      this._tfov = 44;
      this._tdutch = side * 0.1;
    } else {
      // packfly
      this._te.set(aim.x - fx * 12 + nx * 7.5, deck + 3.2, aim.z - fz * 12 + nz * 7.5);
      this._tl.set(aim.x + fx * 5, lookY + 0.2, aim.z + fz * 5);
      this._tfov = 48;
    }
  }
}

/**
 * Real-stage attract tour + pack + director.
 */
export class AttractReel {
  /**
   * @param {{
   *   phone?: boolean,
   *   reducedMotion?: boolean,
   *   onStage?: (id: string, track: object) => void,
   *   armVeg?: () => void,
   * }} [opts]
   */
  constructor(opts) {
    this.phone = !!(opts && opts.phone);
    this.reduced = !!(opts && opts.reducedMotion);
    this.onStage = opts && opts.onStage ? opts.onStage : null;
    this.armVeg = opts && opts.armVeg ? opts.armVeg : null;
    this.group = new THREE.Group();
    this.group.name = "attract-reel";
    /** Seconds between soft seeks to the next authored beat (continuous drive). */
    this._beatInterval = 9.5;
    this._beatClock = 0;
    this.tour = null;
    this.cars = [];
    this.director = new AttractDirector({ reducedMotion: this.reduced });
    this.t = 0;
    this.ready = false;
    this.loading = false;
    this.stageId = null;
    this._timeScale = 1;
    this.lead = {
      x: 0,
      y: 0.2,
      z: 0,
      yaw: 0,
      nx: 1,
      nz: 0,
      speed: 48,
      t: 0,
      jump: false,
    };
    this.second = null;
    this._spin = [];
    this._sample = {};
    this._beats = [];
    this._beatI = 0;
    this._stageT = 0;
    this._tourIdx = 0;
    this._building = null;
    this._gen = 0;
    this._pace = this.phone ? 38 : 52;
    this._anchorDist = 40;
  }

  /** @returns {string[]} */
  _tour() {
    return this.phone ? STAGE_ORDER_PHONE : STAGE_ORDER;
  }

  /**
   * @param {THREE.Scene} scene
   * @returns {Promise<void>}
   */
  async mount(scene) {
    if (this.ready || this.loading) return;
    this.loading = true;
    scene.add(this.group);
    try {
      await this._showStage(this._tour()[0], scene);
      this.ready = true;
      this.director.snap(this.lead);
    } finally {
      this.loading = false;
    }
  }

  /**
   * @param {string} courseId
   * @param {THREE.Scene} [scene]
   */
  async _showStage(courseId, scene) {
    await loadStageApi();
    const def = CoursesMap && CoursesMap[courseId];
    if (!def || !TrackCtor) throw new Error(`[attract] missing course ${courseId}`);
    const gen = ++this._gen;
    this._building = courseId;
    if (this.armVeg) this.armVeg();
    const track = await TrackCtor.create(def, () => {});
    if (gen !== this._gen) {
      try {
        track.dispose();
      } catch {
        /* cancelled */
      }
      return;
    }
    this._detachTrack();
    this.track = track;
    this.stageId = courseId;
    this.group.add(track.group);
    this._beats = buildBeats(track);
    this._beatI = 0;
    this._stageT = 0;
    this._beatClock = 0;
    this._anchorDist = this._beats[0] ? this._beats[0].dist : 40;
    this.t = this._anchorDist / Math.max(1, this._pace);
    const open = this._beats[0];
    if (open) {
      const shot = open.shot || "heli";
      this.director.kind = shot;
      this.director.hold = (SHOT_HOLD[shot] || 3.2) * (this.reduced ? 1.35 : 1);
      this.director.shotT = 0;
      this.director.phase = "hold";
      this.director.phaseT = 0;
      this.director.fade = 0;
      this.director._labelOverride = open.label || STAGE_TITLE[courseId] || "WORLD FEED";
      this.director._pendingKind = null;
    }
    this._plantAll(0, null);
    this.director.snap(this.lead);
    if (this.onStage) this.onStage(courseId, track);
    this._building = null;
    if (scene && !this.group.parent) scene.add(this.group);
    // Prefetch next stage while the pack runs.
    const order = this._tour();
    const next = order[(this._tourIdx + 1) % order.length];
    if (next && next !== courseId) void this._prefetch(next);
  }

  /**
   * @param {string} courseId
   */
  async _prefetch(courseId) {
    /* Warm parse only — full Track.create for the live stage stays serial. */
    void courseId;
  }

  _detachTrack() {
    if (!this.track) return;
    const g = this.track.group;
    if (g && g.parent) g.parent.remove(g);
    try {
      this.track.dispose();
    } catch {
      /* already gone */
    }
    this.track = null;
  }

  /**
   * @param {THREE.Object3D[]} meshes
   */
  bindCars(meshes) {
    this.cars = [];
    this._spin = [];
    const list = (meshes || []).filter(Boolean);
    for (let i = 0; i < list.length; i++) {
      const mesh = list[i];
      mesh.visible = true;
      mesh.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = !this.phone;
        o.receiveShadow = false;
      });
      this.group.add(mesh);
      this.cars.push(mesh);
      this._spin.push([0, 0, 0, 0]);
    }
    if (this.ready) this._plantAll(0, null);
  }

  /**
   * @param {{dist:number, kind:string, label:string, shot:string}|null|undefined} beat
   */
  _applyBeatCam(beat) {
    if (!beat) return;
    const shot = beat.shot || (beat.kind === "jump" ? "jump" : "packfly");
    // Ease into the beat lens — never hard-snap mid-tour.
    this.director.forceNext(shot, beat.label || STAGE_TITLE[this.stageId] || "WORLD FEED");
    if (this.director.phase === "hold") {
      this.director._cut(this.lead);
    } else {
      this.director.kind = shot;
      this.director.hold = (SHOT_HOLD[shot] || 3.2) * (this.reduced ? 1.35 : 1);
      this.director.shotT = 0;
      this.director._labelOverride = beat.label || STAGE_TITLE[this.stageId] || "WORLD FEED";
    }
  }

  /**
   * Soft seek to the next authored highlight — keep rolling, swap lens gently.
   * Instant teleports were the flashy "repeating edit" feel.
   */
  _advanceBeat() {
    if (!this._beats.length) return;
    this._beatI = (this._beatI + 1) % this._beats.length;
    const beat = this._beats[this._beatI];
    // Nudge the pack toward the beat without teleporting if we are close.
    const gap = beat.dist - this._anchorDist;
    if (Math.abs(gap) > 120) {
      this._anchorDist = beat.dist - 28;
      this.t = this._anchorDist / Math.max(1, this._pace);
    }
    this._applyBeatCam(beat);
    this._beatClock = 0;
  }

  /**
   * @param {number} dist
   * @param {object} [out]
   */
  sample(dist, out) {
    const dest = out || {};
    if (!this.track || !this.track.sample) {
      dest.x = 0;
      dest.y = 0.2;
      dest.z = 0;
      dest.yaw = 0;
      dest.nx = 1;
      dest.nz = 0;
      dest.jump = false;
      dest.dist = 0;
      return dest;
    }
    const s = this.track.sample(dist, this._sample);
    dest.x = s.x;
    dest.y = s.y;
    dest.z = s.z;
    dest.yaw = s.heading;
    dest.nx = s.nx;
    dest.nz = s.nz;
    dest.jump = !!(s.jump || s.jumpKind === "gap" || s.jumpKind === "crest" || s.jumpKind === "ramp");
    dest.jumpKind = s.jumpKind || null;
    dest.dist = s.dist;
    return dest;
  }

  /**
   * @param {THREE.Object3D} mesh
   * @param {object} pose
   * @param {number} i
   * @param {number} dt
   * @param {object} hooks
   */
  _plantCar(mesh, pose, i, dt, hooks) {
    if (!mesh || !pose) return;
    const air = pose.jump || pose.jumpKind === "gap";
    const pitch = air ? -0.16 : pose.jumpKind === "ramp" ? -0.1 : 0;
    const roll = 0;
    const chassisY = attractChassisYCleared(pose.y, pitch, roll);
    mesh.position.set(pose.x, chassisY, pose.z);
    mesh.rotation.set(pitch, pose.yaw, roll);
    const yawRate = 0.4 + Math.sin(this.t * 0.9 + i) * 0.25;
    const steer = air ? 0 : Math.max(-0.55, Math.min(0.55, yawRate * (i % 2 ? -1 : 1) * 0.4));
    const spin = this._spin[i];
    const inc = (pose.speed / 0.33) * dt;
    if (spin && dt > 0) {
      for (let w = 0; w < 4; w++) spin[w] += inc;
    }
    const sink =
      mesh.userData && Number.isFinite(mesh.userData.tirePlantSink)
        ? mesh.userData.tirePlantSink
        : 0.012;
    const deckLift =
      hooks && hooks.chassisDeckEmbed
        ? hooks.chassisDeckEmbed(null, attractChassisY(pose.y), mesh)
        : attractDeckLift(sink);
    if (hooks && hooks.applyWheelPose && mesh.userData && mesh.userData.wheels) {
      hooks.applyWheelPose(mesh.userData.wheels, spin, steer, roll, null, deckLift);
    }
    if (hooks && hooks.setBrakeLights) {
      hooks.setBrakeLights(mesh, air ? 0 : Math.abs(steer) > 0.3 ? 0.75 : 0);
    }
    if (hooks && hooks.setHeadlights) hooks.setHeadlights(mesh, false);
    mesh.updateMatrixWorld(true);
  }

  /**
   * @param {number} dt
   * @param {object|null} hooks
   */
  _plantAll(dt, hooks) {
    const n = Math.max(1, this.cars.length);
    let second = null;
    for (let i = 0; i < n; i++) {
      const gap = i * (this.phone ? 9 : 7.5);
      const dist = this._anchorDist + this._drift(i) - gap;
      const pose = this.sample(dist, i === 0 ? this.lead : {});
      pose.speed = this._pace - i * 1.8;
      pose.t = this.t;
      if (i === 1) second = pose;
      this._plantCar(this.cars[i], pose, i, dt, hooks);
    }
    this.second = second;
  }

  /**
   * Slight lane stagger so the pack reads as a field.
   * @param {number} i
   */
  _drift(i) {
    return Math.sin(this.t * 0.35 + i * 1.7) * (i === 0 ? 0 : 1.2);
  }

  /**
   * @param {number} dt
   * @param {THREE.Camera} camera
   * @param {object} hooks
   */
  update(dt, camera, hooks) {
    if (!this.ready || !this.track) {
      return {
        fade: 0.35,
        flash: 0,
        kind: "heli",
        label: this._building ? `LOADING ${STAGE_TITLE[this._building] || ""}` : "WORLD FEED",
        dutch: 0,
        fov: 46,
        chroma: 0,
        smear: 0,
        speedFx: 0,
        ramp: "live",
        energy: "live",
        calm: true,
        justCut: false,
        clock: "00:00:00",
        stage: this.stageId,
      };
    }

    const jumpSlow = this.lead.jump && this.director.kind === "jump";
    this._timeScale = jumpSlow ? 0.72 : 1;
    const step = dt * this._timeScale;
    this.t += step;
    this._stageT += step;
    this._beatClock += step;
    this._anchorDist += this._pace * step;

    this._plantAll(step, hooks);

    const shot = this.director.update(step, this.lead, { second: this.second });
    if (shot.justCut && this.lead.jump && shot.kind === "jump") {
      this.director._labelOverride = "OVER JUMP";
      shot.label = this.director.label();
    }
    // Continuous drive — seek a new highlight on a long clock, not every lens change.
    if (this._beatClock >= this._beatInterval * (this.reduced ? 1.25 : 1)) {
      this._advanceBeat();
    }

    if (this.track.update && camera) {
      try {
        if (!this._anchorPos) this._anchorPos = new THREE.Vector3();
        this._anchorPos.set(this.lead.x, this.lead.y, this.lead.z);
        this.track.update(this._anchorPos, camera.position, {
          progress: this.lead.dist,
          speed: this.lead.speed,
          yaw: this.lead.yaw,
          settle: !!shot.justCut,
        });
      } catch {
        /* streaming optional on title */
      }
    }

    if (this._stageT >= STAGE_DWELL * (this.reduced ? 1.35 : 1)) {
      void this._cycleStage();
    }

    shot.timeScale = this._timeScale;
    shot.clock = this._clock();
    shot.stage = this.stageId;
    if (camera) {
      camera.position.copy(this.director.eye);
      camera.up.set(Math.sin(shot.dutch), Math.cos(shot.dutch), 0);
      camera.lookAt(this.director.look);
      if (Math.abs(camera.fov - shot.fov) > 0.08) {
        camera.fov = shot.fov;
        camera.near = 0.18;
        camera.far = 900;
        camera.updateProjectionMatrix();
      }
    }
    return shot;
  }

  async _cycleStage() {
    if (this._building) return;
    const order = this._tour();
    this._tourIdx = (this._tourIdx + 1) % order.length;
    const next = order[this._tourIdx];
    this._stageT = 0;
    this.director.phase = "out";
    this.director.phaseT = 0;
    this.director.fade = 0.4;
    try {
      await this._showStage(next);
      this.director.phase = "in";
      this.director.phaseT = 0;
    } catch (err) {
      console.warn("[attract] stage swap failed", err);
    }
  }

  _clock() {
    const t = this.t;
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    const f = Math.floor((t % 1) * 24);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
  }

  /**
   * @param {THREE.Scene} scene
   */
  dispose(scene) {
    this._gen += 1;
    for (let i = 0; i < this.cars.length; i++) {
      const mesh = this.cars[i];
      if (mesh && mesh.parent === this.group) this.group.remove(mesh);
    }
    this.cars = [];
    this._detachTrack();
    if (this.group && this.group.parent) this.group.parent.remove(this.group);
    else if (scene && this.group) scene.remove(this.group);
    this.ready = false;
    this.loading = false;
    this.stageId = null;
  }
}

/**
 * Drive the HTML overlays from a director tick.
 * @param {HTMLElement|null} root
 * @param {{fade:number,flash:number,label:string,kind:string,chroma?:number,smear?:number,speedFx?:number,clock?:string,calm?:boolean,ramp?:string,energy?:string,stage?:string}|null} shot
 * @param {boolean} on
 */
export function paintAttractFx(root, shot, on) {
  if (!root) return;
  root.hidden = !on;
  root.setAttribute("aria-hidden", on ? "false" : "true");
  if (!on || !shot) return;
  const fade = root.querySelector(".attract-fade");
  const flash = root.querySelector(".attract-flash");
  const slug = root.querySelector(".attract-shot");
  const chroma = root.querySelector(".attract-chroma");
  const smear = root.querySelector(".attract-smear");
  const speed = root.querySelector(".attract-speed");
  const clock = root.querySelector(".attract-clock");
  const network = root.querySelector(".attract-network");
  if (fade) fade.style.opacity = String(Math.max(0, Math.min(1, shot.fade)));
  if (flash) flash.style.opacity = "0";
  if (chroma) chroma.style.opacity = String(Math.max(0, Math.min(1, shot.chroma || 0)));
  if (smear) smear.style.opacity = String(Math.max(0, Math.min(1, shot.smear || 0)));
  if (speed) speed.style.opacity = String(Math.max(0, Math.min(1, shot.speedFx || 0)));
  if (slug && slug.textContent !== shot.label) slug.textContent = shot.label;
  if (clock && shot.clock && clock.textContent !== shot.clock) clock.textContent = shot.clock;
  if (network && shot.stage) {
    const title = STAGE_TITLE[shot.stage] || shot.stage.toUpperCase();
    const line = `WORLD RALLY · ${title}`;
    if (network.textContent !== line) network.textContent = line;
  }
  root.dataset.kind = shot.kind || "";
  root.dataset.ramp = shot.ramp || "live";
  root.dataset.energy = shot.energy || "live";
  if (shot.calm) root.classList.add("is-calm");
  else root.classList.remove("is-calm");
}
