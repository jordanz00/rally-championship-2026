/**
 * Broadcast replay — TV coverage of the run just finished.
 *
 * WHO THIS IS FOR: the Stage Result screen.
 * WHAT IT DOES: records the live pose at 20 Hz, plays it back exactly, and
 *   cuts a director between trackside towers, chase, crane, and approach shots
 *   with fades. Does not step Vehicle physics.
 * HOW IT CONNECTS: game.js records during race, ticks the director on result.
 */

const SAMPLE_HZ = 20;
const MAX_SAMPLES = 16000;
const FADE_OUT = 0.22;
const FADE_IN = 0.34;
const BLEND_SEC = 0.92;

const SHOT_HOLD = {
  heli: 6.2,
  moto: 5.0,
  tower: 4.6,
  front: 3.9,
  lowside: 4.9,
  crane: 5.6,
  wall: 5.2,
};

const SHOT_LABEL = {
  heli: "HELICOPTER",
  moto: "CHASE CAM",
  tower: "TRACKSIDE",
  front: "HEAD-ON",
  lowside: "LOW SIDE",
  crane: "CRANE",
  wall: "TUNNEL CAM",
};

/**
 * @typedef {{t:number,x:number,y:number,z:number,yaw:number,pitch:number,roll:number,speed:number,progress:number,gear:number,steer:number,brake:number,handbrake:number}} ReplaySample
 */

/**
 * Unwrap a heading so lerp does not take the long way around.
 * @param {number} from
 * @param {number} to
 * @returns {number}
 */
export function unwrapAngle(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return from + d;
}

/**
 * In-memory last-run tape. Not written to localStorage.
 */
export class ReplayTape {
  constructor() {
    /** @type {ReplaySample[]} */
    this.samples = [];
    this.t = 0;
    this.active = false;
    this._acc = 0;
    this.courseId = "";
    this.carId = "";
  }

  /**
   * @param {string} courseId
   * @param {string} carId
   */
  start(courseId, carId) {
    this.samples = [];
    this.t = 0;
    this._acc = 0;
    this.active = true;
    this.courseId = courseId || "";
    this.carId = carId || "";
  }

  stop() {
    this.active = false;
  }

  /**
   * @param {number} dt
   * @param {{position:{x:number,y:number,z:number},yaw:number,pitch?:number,roll?:number,speed:number,progress:number,gear?:number,steer?:number,brake?:number,handbrake?:number}} vehicle
   */
  tick(dt, vehicle) {
    if (!this.active || !vehicle || !vehicle.position) return;
    this.t += dt;
    this._acc += dt;
    const step = 1 / SAMPLE_HZ;
    if (this._acc < step) return;
    this._acc -= step;
    if (this.samples.length >= MAX_SAMPLES) return;
    this.samples.push({
      t: this.t,
      x: vehicle.position.x,
      y: vehicle.position.y,
      z: vehicle.position.z,
      yaw: vehicle.yaw || 0,
      pitch: vehicle.pitch || 0,
      roll: vehicle.roll || 0,
      speed: vehicle.speed || 0,
      progress: vehicle.progress || 0,
      gear: vehicle.gear || 0,
      steer: vehicle.steer || 0,
      brake: vehicle.brake || 0,
      handbrake: vehicle.handbrake || 0,
    });
  }

  /** @returns {number} */
  duration() {
    const s = this.samples;
    return s.length ? s[s.length - 1].t : 0;
  }

  /**
   * @param {number} t
   * @param {ReplaySample} [out]
   * @returns {ReplaySample|null}
   */
  poseAt(t, out) {
    const s = this.samples;
    if (s.length < 2) return null;
    const lastT = s[s.length - 1].t;
    const loopT = lastT > 0.4 ? ((t % lastT) + lastT) % lastT : 0;
    let i = 0;
    while (i < s.length - 1 && s[i + 1].t < loopT) i++;
    const a = s[i];
    const b = s[Math.min(i + 1, s.length - 1)];
    const u = b.t > a.t ? (loopT - a.t) / (b.t - a.t) : 0;
    const dest = out || {};
    dest.t = loopT;
    dest.x = a.x + (b.x - a.x) * u;
    dest.y = a.y + (b.y - a.y) * u;
    dest.z = a.z + (b.z - a.z) * u;
    dest.yaw = unwrapAngle(a.yaw, b.yaw);
    dest.yaw = a.yaw + (dest.yaw - a.yaw) * u;
    dest.pitch = a.pitch + (b.pitch - a.pitch) * u;
    dest.roll = a.roll + (b.roll - a.roll) * u;
    dest.speed = a.speed + (b.speed - a.speed) * u;
    dest.progress = a.progress + (b.progress - a.progress) * u;
    dest.steer = (a.steer || 0) + ((b.steer || 0) - (a.steer || 0)) * u;
    dest.brake = (a.brake || 0) + ((b.brake || 0) - (a.brake || 0)) * u;
    dest.handbrake = (a.handbrake || 0) + ((b.handbrake || 0) - (a.handbrake || 0)) * u;
    dest.gear = u > 0.5 ? b.gear : a.gear;
    dest.yawRate = b.t > a.t ? (unwrapAngle(a.yaw, b.yaw) - a.yaw) / (b.t - a.t) : 0;
    return dest;
  }
}

/**
 * @param {object} track
 * @returns {Array<{dist:number,x:number,y:number,z:number,tunnel:boolean}>}
 */
export function buildBroadcastTowers(track) {
  const towers = [];
  if (!track || !track.sample || !(track.length > 40)) return towers;
  const p = {};
  const q = {};
  const step = 148;
  for (let d = 28; d < track.length - 24; d += step) {
    track.sample(d, p);
    track.sample(Math.min(track.length - 1, d + 30), q);
    let dh = q.heading - p.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    // Left-hand bend (dh > 0): +n is inside, so park the tower on −n.
    const side = dh >= 0 ? -1 : 1;
    const lat = (p.width || 12) * 0.5 + (p.tunnel ? 1.15 : 9.2);
    towers.push({
      dist: d,
      x: p.x + p.nx * side * lat,
      y: p.y + (p.tunnel ? 2.35 : 3.4 + ((d / step) % 3) * 1.15),
      z: p.z + p.nz * side * lat,
      tunnel: !!p.tunnel,
    });
  }
  return towers;
}

/**
 * TV director: picks shots, fades, and returns a camera pose.
 */
export class BroadcastDirector {
  /**
   * @param {object} track
   * @param {ReplayTape} tape
   * @param {{reducedMotion?:boolean}} [opts]
   */
  constructor(track, tape, opts) {
    this.track = track;
    this.tape = tape;
    this.towers = buildBroadcastTowers(track);
    this.reduced = !!(opts && opts.reducedMotion);
    this.kind = "heli";
    this.shotT = 0;
    this.hold = SHOT_HOLD.heli;
    this.fade = 0;
    this.phase = "in";
    this.phaseT = 0;
    this._road = {};
    this._ahead = {};
    this.eyeX = 0;
    this.eyeY = 8;
    this.eyeZ = 0;
    this.lookX = 0;
    this.lookY = 1;
    this.lookZ = 0;
    this.fov = 44;
    this._tx = 0;
    this._ty = 8;
    this._tz = 0;
    this._lx = 0;
    this._ly = 1;
    this._lz = 0;
    this._tfov = 44;
    this._vx = 0;
    this._vy = 0;
    this._vz = 0;
    this._vlx = 0;
    this._vly = 0;
    this._vlz = 0;
    this._vfov = 0;
    this.ready = !!(tape && tape.samples && tape.samples.length >= 8);
  }

  /** @returns {string} */
  label() {
    return SHOT_LABEL[this.kind] || "WORLD FEED";
  }

  /**
   * @param {ReplaySample} pose
   */
  snapTo(pose) {
    this._compose(this.kind, pose);
    this.eyeX = this._tx;
    this.eyeY = this._ty;
    this.eyeZ = this._tz;
    this.lookX = this._lx;
    this.lookY = this._ly;
    this.lookZ = this._lz;
    this.fov = this._tfov;
    this._vx = this._vy = this._vz = 0;
    this._vlx = this._vly = this._vlz = 0;
    this._vfov = 0;
    this.fade = this.phase === "in" ? 1 : 0;
  }

  /**
   * @param {number} dt
   * @param {ReplaySample} pose
   * @returns {{fade:number,label:string,kind:string}}
   */
  update(dt, pose) {
    if (!pose) return { fade: 1, label: this.label(), kind: this.kind };
    this.shotT += dt;
    this._compose(this.kind, pose);
    const mustCut = this._mustCut(pose);
    if (this.phase === "hold" && (this.shotT >= this.hold || mustCut)) {
      this._beginCut(pose);
    }
    this._stepPhase(dt, pose);
    this._follow(dt);
    return { fade: this.fade, label: this.label(), kind: this.kind };
  }

  /**
   * @param {ReplaySample} pose
   * @returns {boolean}
   */
  _mustCut(pose) {
    if (this.kind === "front") {
      const road = this.track && this.track.sample
        ? this.track.sample(pose.progress + 22, this._ahead)
        : null;
      if (road) {
        const dx = pose.x - road.x;
        const dz = pose.z - road.z;
        if (dx * dx + dz * dz < 64) return true;
      }
    }
    if (this.kind === "tower") {
      const tw = this._nearestTower(pose.progress, 0, 18);
      if (tw && pose.progress > tw.dist + 16) return true;
    }
    return false;
  }

  /**
   * @param {ReplaySample} pose
   */
  _beginCut(pose) {
    const next = this._pickKind(pose);
    const followish =
      (this.kind === "heli" || this.kind === "moto" || this.kind === "lowside") &&
      (next === "heli" || next === "moto" || next === "lowside");
    this.kind = next;
    this.shotT = 0;
    this.hold = (SHOT_HOLD[next] || 5) * (0.88 + Math.random() * 0.22);
    if (this.reduced || !followish) {
      this.phase = "out";
      this.phaseT = 0;
    } else {
      this.phase = "blend";
      this.phaseT = 0;
    }
  }

  /**
   * @param {number} dt
   * @param {ReplaySample} pose
   */
  _stepPhase(dt, pose) {
    this.phaseT += dt;
    if (this.phase === "out") {
      const u = Math.min(1, this.phaseT / FADE_OUT);
      this.fade = u * u * (3 - 2 * u);
      if (u >= 1) {
        this.snapTo(pose);
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
    } else if (this.phase === "blend") {
      if (this.phaseT >= BLEND_SEC) this.phase = "hold";
      this.fade = 0;
    } else {
      this.fade = 0;
    }
  }

  /**
   * @param {ReplaySample} pose
   * @returns {string}
   */
  _pickKind(pose) {
    const road = this.track && this.track.sample
      ? this.track.sample(pose.progress, this._road)
      : null;
    const tunnel = !!(road && road.tunnel);
    const jump = !!(road && road.jump);
    const prev = this.kind;
    let next;
    if (tunnel) next = prev === "wall" ? "moto" : "wall";
    else if (jump) next = "lowside";
    else if (Math.abs(pose.yawRate || 0) > 0.62) next = prev === "crane" ? "heli" : "crane";
    else {
      const cycle = ["heli", "tower", "moto", "front", "lowside", "crane"];
      const i = cycle.indexOf(prev);
      next = cycle[(i + 1 + (Math.random() < 0.25 ? 1 : 0)) % cycle.length];
    }
    if (next === "tower" && !this._nearestTower(pose.progress, 8, 70)) next = "heli";
    if (next === prev && !tunnel) next = prev === "heli" ? "moto" : "heli";
    return next;
  }

  /**
   * @param {number} progress
   * @param {number} behind
   * @param {number} ahead
   */
  _nearestTower(progress, behind, ahead) {
    let best = null;
    let bestD = 1e9;
    for (let i = 0; i < this.towers.length; i++) {
      const tw = this.towers[i];
      const d = tw.dist - progress;
      if (d < -behind || d > ahead) continue;
      const score = Math.abs(d - 32);
      if (score < bestD) {
        bestD = score;
        best = tw;
      }
    }
    return best;
  }

  /**
   * @param {string} kind
   * @param {ReplaySample} pose
   */
  _compose(kind, pose) {
    const fx = Math.sin(pose.yaw);
    const fz = Math.cos(pose.yaw);
    const road = this.track && this.track.sample
      ? this.track.sample(pose.progress, this._road)
      : null;
    const nx = road ? road.nx : -fz;
    const nz = road ? road.nz : fx;
    const deck = road ? Math.max(pose.y, road.y + 0.35) : pose.y;
    const lookY = deck + 0.85;
    if (kind === "heli") {
      this._tx = pose.x - fx * 11.5 + nx * 5.4;
      this._ty = deck + 7.6;
      this._tz = pose.z - fz * 11.5 + nz * 5.4;
      this._lx = pose.x + fx * 5;
      this._ly = lookY;
      this._lz = pose.z + fz * 5;
      this._tfov = 42;
    } else if (kind === "moto") {
      this._tx = pose.x - fx * 8.2 + nx * 1.15;
      this._ty = deck + 1.85;
      this._tz = pose.z - fz * 8.2 + nz * 1.15;
      this._lx = pose.x + fx * 8;
      this._ly = lookY;
      this._lz = pose.z + fz * 8;
      this._tfov = 48;
    } else if (kind === "lowside") {
      this._tx = pose.x - fx * 3.4 + nx * 7.2;
      this._ty = deck + 1.7;
      this._tz = pose.z - fz * 3.4 + nz * 7.2;
      this._lx = pose.x + fx * 3;
      this._ly = lookY;
      this._lz = pose.z + fz * 3;
      this._tfov = 44;
    } else if (kind === "crane") {
      this._tx = pose.x - fx * 4 + nx * 14;
      this._ty = deck + 11.5;
      this._tz = pose.z - fz * 4 + nz * 14;
      this._lx = pose.x + fx * 2;
      this._ly = lookY;
      this._lz = pose.z + fz * 2;
      this._tfov = 40;
    } else if (kind === "front") {
      const ahead = this.track && this.track.sample
        ? this.track.sample(pose.progress + 20, this._ahead)
        : null;
      if (ahead) {
        this._tx = ahead.x;
        this._ty = Math.max(ahead.y, deck) + 1.85;
        this._tz = ahead.z;
      } else {
        this._tx = pose.x + fx * 20;
        this._ty = deck + 1.85;
        this._tz = pose.z + fz * 20;
      }
      this._lx = pose.x;
      this._ly = lookY;
      this._lz = pose.z;
      this._tfov = 38;
    } else if (kind === "wall") {
      const lat = road && road.width ? road.width * 0.38 : 4;
      this._tx = pose.x + nx * lat;
      this._ty = deck + 2.05;
      this._tz = pose.z + nz * lat;
      this._lx = pose.x + fx * 6;
      this._ly = lookY;
      this._lz = pose.z + fz * 6;
      this._tfov = 50;
    } else {
      const tw = this._nearestTower(pose.progress, 12, 78) || this.towers[0];
      if (tw) {
        this._tx = tw.x;
        this._ty = Math.max(tw.y, deck + 3.2);
        this._tz = tw.z;
      } else {
        this._tx = pose.x + nx * 11;
        this._ty = deck + 4.4;
        this._tz = pose.z + nz * 11;
      }
      this._lx = pose.x + fx * 4;
      this._ly = lookY;
      this._lz = pose.z + fz * 4;
      this._tfov = 36;
    }
  }

  /**
   * Critically-ish damped follow so cuts do not snap the lens.
   * @param {number} dt
   */
  _follow(dt) {
    if (!(dt > 0) || this.phase === "out") return;
    const locked =
      this.phase !== "blend" &&
      (this.kind === "heli" ||
        this.kind === "moto" ||
        this.kind === "lowside" ||
        this.kind === "wall" ||
        this.kind === "crane");
    if (locked) {
      this.eyeX = this._tx;
      this.eyeY = this._ty;
      this.eyeZ = this._tz;
      this.lookX = this._lx;
      this.lookY = this._ly;
      this.lookZ = this._lz;
      this.fov = this._tfov;
      this._vx = this._vy = this._vz = 0;
      this._vlx = this._vly = this._vlz = 0;
      this._vfov = 0;
      return;
    }
    const stiff = this.phase === "blend" ? 9 : this.kind === "tower" || this.kind === "front" ? 22 : 14;
    const damp = 2 * Math.sqrt(stiff);
    const step = (x, v, t) => {
      const a = (t - x) * stiff - v * damp;
      v += a * dt;
      x += v * dt;
      return [x, v];
    };
    [this.eyeX, this._vx] = step(this.eyeX, this._vx, this._tx);
    [this.eyeY, this._vy] = step(this.eyeY, this._vy, this._ty);
    [this.eyeZ, this._vz] = step(this.eyeZ, this._vz, this._tz);
    [this.lookX, this._vlx] = step(this.lookX, this._vlx, this._lx);
    [this.lookY, this._vly] = step(this.lookY, this._vly, this._ly);
    [this.lookZ, this._vlz] = step(this.lookZ, this._vlz, this._lz);
    [this.fov, this._vfov] = step(this.fov, this._vfov, this._tfov);
  }
}
