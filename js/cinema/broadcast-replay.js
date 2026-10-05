/**
 * Broadcast replay — TV coverage of the run just finished.
 *
 * WHO THIS IS FOR: the Stage Result screen.
 * WHAT IT DOES: records the live pack at 20 Hz (player + every rival), plays
 *   it back exactly, and cuts a player-centric director (bumper / chase /
 *   fly-by / heli / nose-on / three-quarter / crane / tunnel-crest hero).
 *   Every locked shot keeps the hero hull in the frustum and holds 2–3 s.
 *   Cuts snap the lens (no blend). Does not step Vehicle physics.
 * HOW IT CONNECTS: game.js records during race, ticks the director on result.
 */

const SAMPLE_HZ = 20;
const MAX_SAMPLES = 16000;
const FADE_IN = 0.16;
export const HOLD_MIN = 3.6;
export const HOLD_MAX = 6.2;
const DEFAULT_ASPECT = 16 / 9;

/** Hull aim point above the taped contact patch. */
export const HULL_Y = 0.62;

/** NDC margin — player must sit inside this after every pose. */
export const FRAME_NDC_X = 0.72;
export const FRAME_NDC_Y = 0.78;

/** Tighter box for centered / tracking / hero shots. */
export const HERO_NDC_X = 0.46;
export const HERO_NDC_Y = 0.52;

/** Look-at must stay on the hull, not an empty ribbon or the sky. */
export const LOOK_PLAYER_M = 7.5;

/**
 * Eight cinematic setups. Fly-by may lead; the rest are hero-centered.
 * @type {readonly string[]}
 */
export const BROADCAST_SHOTS = Object.freeze([
  "bumper",
  "chase",
  "flyby",
  "heli",
  "nose",
  "threeq",
  "crane",
  "hero",
]);

export const HERO_SHOTS = new Set(["bumper", "chase", "heli", "nose", "threeq", "crane", "hero"]);

export const SHOT_HOLD = {
  bumper: 4.2,
  chase: 5.1,
  flyby: 4.4,
  heli: 5.8,
  nose: 4.0,
  threeq: 5.2,
  crane: 5.6,
  hero: 4.8,
};

export const SHOT_LABEL = {
  bumper: "BUMPER CAM",
  chase: "CHASE CAM",
  flyby: "FLY-BY",
  heli: "HELICOPTER",
  nose: "NOSE-ON",
  threeq: "THREE-QUARTER",
  crane: "CRANE",
  hero: "HERO",
};

const SHOT_CYCLE = ["heli", "bumper", "threeq", "nose", "flyby", "crane", "chase", "hero"];

/**
 * @typedef {{x:number,y:number,z:number,yaw:number,pitch:number,roll:number,speed:number,progress:number,steer:number,brake:number,handbrake:number}} ReplayRivalSample
 */

/**
 * @typedef {{t:number,x:number,y:number,z:number,yaw:number,pitch:number,roll:number,speed:number,progress:number,gear:number,steer:number,brake:number,handbrake:number,rivals?:ReplayRivalSample[]}} ReplaySample
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
 * Compact body snapshot for the tape (player or rival).
 * @param {{position:{x:number,y:number,z:number},yaw?:number,pitch?:number,roll?:number,speed?:number,progress?:number,steer?:number,brake?:number,handbrake?:number}|null} vehicle
 * @returns {ReplayRivalSample|null}
 */
export function snapReplayBody(vehicle) {
  if (!vehicle || !vehicle.position) return null;
  return {
    x: vehicle.position.x,
    y: vehicle.position.y,
    z: vehicle.position.z,
    yaw: vehicle.yaw || 0,
    pitch: vehicle.pitch || 0,
    roll: vehicle.roll || 0,
    speed: vehicle.speed || 0,
    progress: vehicle.progress || 0,
    steer: vehicle.steer || 0,
    brake: vehicle.brake || 0,
    handbrake: vehicle.handbrake || 0,
  };
}

/**
 * Lerp one taped body into `out`. Heading unwraps so the pack does not spin.
 * @param {ReplayRivalSample} a
 * @param {ReplayRivalSample} b
 * @param {number} u
 * @param {ReplayRivalSample} [out]
 * @returns {ReplayRivalSample}
 */
export function lerpReplayBody(a, b, u, out) {
  const dest = out || {};
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
  return dest;
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
    this._cursor = 0;
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
   * @param {Array<{vehicle?:object,position?:{x:number,y:number,z:number}}>|null} [rivals]
   */
  tick(dt, vehicle, rivals) {
    if (!this.active || !vehicle || !vehicle.position) return;
    this.t += dt;
    this._acc += dt;
    const step = 1 / SAMPLE_HZ;
    if (this._acc < step) return;
    this._acc -= step;
    if (this.samples.length >= MAX_SAMPLES) return;
    const pack = [];
    if (Array.isArray(rivals)) {
      for (let i = 0; i < rivals.length; i++) {
        const src = rivals[i] && (rivals[i].vehicle || rivals[i]);
        const snap = snapReplayBody(src);
        if (snap) pack.push(snap);
      }
    }
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
      rivals: pack,
    });
  }

  /** Player + taped rivals on the first sample. */
  packCount() {
    const s = this.samples[0];
    if (!s) return 0;
    return 1 + ((s.rivals && s.rivals.length) || 0);
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
    let i = this._cursor | 0;
    if (i < 0 || i >= s.length || s[i].t > loopT) i = 0;
    while (i < s.length - 1 && s[i + 1].t < loopT) i++;
    this._cursor = i;
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
    const ra = a.rivals;
    const rb = b.rivals;
    const n = Math.max(ra ? ra.length : 0, rb ? rb.length : 0);
    const pack = dest.rivals || (dest.rivals = []);
    pack.length = n;
    for (let i = 0; i < n; i++) {
      const left = (ra && ra[i]) || (rb && rb[i]);
      const right = (rb && rb[i]) || left;
      if (!left || !right) {
        pack[i] = null;
        continue;
      }
      pack[i] = lerpReplayBody(left, right, u, pack[i] || {});
    }
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
 * Forward / lateral axes from taped yaw.
 * @param {number} yaw
 * @returns {{fx:number,fz:number,nx:number,nz:number}}
 */
export function headingAxes(yaw) {
  const fx = Math.sin(yaw || 0);
  const fz = Math.cos(yaw || 0);
  return { fx, fz, nx: -fz, nz: fx };
}

/**
 * @param {string} kind
 * @param {ReplaySample} pose
 * @returns {number}
 */
function shotSide(kind, pose) {
  const rate = pose && pose.yawRate;
  if (Number.isFinite(rate) && Math.abs(rate) > 0.12) return rate > 0 ? 1 : -1;
  const seed = ((kind && kind.charCodeAt(0)) || 0) + Math.floor((pose && pose.progress) || 0);
  return seed & 1 ? 1 : -1;
}

/**
 * Hold 2.0–3.0 s then cut. Never shorter than 2 s (tape end is the exception).
 * @param {string} kind
 * @returns {number}
 */
export function rollShotHold(kind) {
  const base = SHOT_HOLD[kind] || 2.4;
  return Math.min(HOLD_MAX, Math.max(HOLD_MIN, base * (0.9 + Math.random() * 0.2)));
}

/**
 * Compose one shot. Look-at is the player hull plus a short velocity lead
 * so the car sits in frame instead of behind the lens.
 * @param {string} kind
 * @param {ReplaySample} pose
 * @param {object|null} track
 * @param {{side?:number,flyEye?:{x:number,y:number,z:number},scratch?:object}} [opts]
 * @returns {{eyeX:number,eyeY:number,eyeZ:number,lookX:number,lookY:number,lookZ:number,fov:number,lead:number,kind:string}}
 */
export function composeBroadcastShot(kind, pose, track, opts) {
  const axes = headingAxes(pose.yaw);
  const scratch = (opts && opts.scratch) || {};
  const road = track && track.sample ? track.sample(pose.progress || 0, scratch) : null;
  const fx = axes.fx;
  const fz = axes.fz;
  const nx = road && Number.isFinite(road.nx) ? road.nx : axes.nx;
  const nz = road && Number.isFinite(road.nz) ? road.nz : axes.nz;
  const deck = road && Number.isFinite(road.y) ? Math.max(pose.y, road.y + 0.28) : pose.y;
  const tunnel = !!(road && road.tunnel);
  const side = Number.isFinite(opts && opts.side) ? opts.side : shotSide(kind, pose);
  const shot = BROADCAST_SHOTS.includes(kind) ? kind : "chase";

  let lead = 1.55;
  let back = 7.6;
  let ahead = 0;
  let lat = 1.05;
  let up = 1.72;
  let fov = 48;
  if (shot === "bumper") {
    lead = 1.45;
    back = 4.35;
    lat = 0.42;
    up = 0.88;
    fov = 50;
  } else if (shot === "chase") {
    lead = 2.0;
    back = 7.6;
    lat = 1.05;
    up = 1.72;
    fov = 48;
  } else if (shot === "heli") {
    lead = 1.7;
    back = 11.8;
    lat = 5.1;
    up = 6.55;
    fov = 40;
  } else if (shot === "threeq") {
    lead = 1.5;
    back = 6.1;
    lat = 4.7;
    up = 1.48;
    fov = 44;
  } else if (shot === "crane") {
    lead = 1.35;
    back = 3.2;
    lat = 11.2;
    up = 9.6;
    fov = 38;
  } else if (shot === "hero") {
    if (tunnel) {
      lead = 1.15;
      back = 5.4;
      lat = 1.45;
      up = 1.38;
      fov = 46;
    } else {
      lead = 1.85;
      back = 8.2;
      lat = 3.1;
      up = 3.5;
      fov = 42;
    }
  } else if (shot === "nose") {
    lead = 0.55;
    back = 0;
    ahead = 22;
    lat = 1.6;
    up = 1.55;
    fov = 38;
  } else if (shot === "flyby") {
    lead = 2.35;
    back = -6.4;
    lat = 10.1;
    up = 1.18;
    fov = 40;
  }

  const lookX = pose.x + fx * lead;
  const lookY = pose.y + HULL_Y;
  const lookZ = pose.z + fz * lead;

  if (shot === "flyby" && opts && opts.flyEye) {
    return {
      eyeX: opts.flyEye.x,
      eyeY: opts.flyEye.y,
      eyeZ: opts.flyEye.z,
      lookX,
      lookY,
      lookZ,
      fov,
      lead,
      kind: shot,
    };
  }

  let eyeX = pose.x + fx * (ahead - back) + nx * lat * side;
  let eyeY = deck + up;
  let eyeZ = pose.z + fz * (ahead - back) + nz * lat * side;
  const hx = pose.x;
  const hy = pose.y + HULL_Y;
  const hz = pose.z;
  const dx = eyeX - hx;
  const dy = eyeY - hy;
  const dz = eyeZ - hz;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 3.4) {
    const s = 3.4 / Math.max(dist, 0.2);
    eyeX = hx + dx * s;
    eyeY = hy + dy * s;
    eyeZ = hz + dz * s;
  }
  return { eyeX, eyeY, eyeZ, lookX, lookY, lookZ, fov, lead, kind: shot };
}

/**
 * Project a world point into NDC for a lookAt + vertical-FOV camera.
 * @returns {{x:number,y:number,z:number,visible:boolean}}
 */
export function projectWorldToNdc(wx, wy, wz, eyeX, eyeY, eyeZ, lookX, lookY, lookZ, fovDeg, aspect) {
  const zax = eyeX - lookX;
  const zay = eyeY - lookY;
  const zaz = eyeZ - lookZ;
  const zl = Math.hypot(zax, zay, zaz) || 1;
  let zx = zax / zl;
  let zy = zay / zl;
  let zz = zaz / zl;
  let ux = 0;
  let uy = 1;
  let uz = 0;
  let xx = uy * zz - uz * zy;
  let xy = uz * zx - ux * zz;
  let xz = ux * zy - uy * zx;
  let xl = Math.hypot(xx, xy, xz);
  if (xl < 1e-6) {
    ux = 0;
    uy = 0;
    uz = 1;
    xx = uy * zz - uz * zy;
    xy = uz * zx - ux * zz;
    xz = ux * zy - uy * zx;
    xl = Math.hypot(xx, xy, xz);
  }
  xx /= xl || 1;
  xy /= xl || 1;
  xz /= xl || 1;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  const px = wx - eyeX;
  const py = wy - eyeY;
  const pz = wz - eyeZ;
  const vx = xx * px + xy * py + xz * pz;
  const vy = yx * px + yy * py + yz * pz;
  const vz = zx * px + zy * py + zz * pz;
  if (!(vz < -1e-4)) return { x: 99, y: 99, z: vz, visible: false };
  const fov = ((Number.isFinite(fovDeg) ? fovDeg : 42) * Math.PI) / 180;
  const sy = 1 / Math.tan(fov * 0.5);
  const sx = sy / (aspect > 0.2 ? aspect : DEFAULT_ASPECT);
  return { x: (vx * sx) / -vz, y: (vy * sy) / -vz, z: vz, visible: true };
}

/**
 * @param {{eyeX:number,eyeY:number,eyeZ:number,lookX:number,lookY:number,lookZ:number,fov:number}} layout
 * @param {ReplaySample} pose
 * @param {number} [aspect]
 */
export function playerNdc(layout, pose, aspect) {
  return projectWorldToNdc(
    pose.x,
    pose.y + HULL_Y,
    pose.z,
    layout.eyeX,
    layout.eyeY,
    layout.eyeZ,
    layout.lookX,
    layout.lookY,
    layout.lookZ,
    layout.fov,
    aspect || DEFAULT_ASPECT
  );
}

/**
 * Hard rule: hero hull must project inside the view with a margin.
 * Centered / tracking shots use the tighter hero box.
 * @param {{eyeX:number,eyeY:number,eyeZ:number,lookX:number,lookY:number,lookZ:number,fov:number}} layout
 * @param {ReplaySample} pose
 * @param {{kind?:string,aspect?:number}} [opts]
 * @returns {boolean}
 */
export function playerInBroadcastFrame(layout, pose, opts) {
  if (!layout || !pose || !Number.isFinite(layout.eyeX) || !Number.isFinite(layout.lookX)) return false;
  const ndc = playerNdc(layout, pose, opts && opts.aspect);
  if (!ndc.visible) return false;
  const kind = (opts && opts.kind) || layout.kind || "";
  const hero = HERO_SHOTS.has(kind);
  const mx = hero ? HERO_NDC_X : FRAME_NDC_X;
  const my = hero ? HERO_NDC_Y : FRAME_NDC_Y;
  return Math.abs(ndc.x) < mx && Math.abs(ndc.y) < my;
}

/**
 * Reject empty-road / sky look-at — the aim point must sit on the hull.
 * @param {{lookX:number,lookY:number,lookZ:number}} layout
 * @param {ReplaySample} pose
 * @param {number} [maxM]
 * @returns {boolean}
 */
export function lookTargetsPlayer(layout, pose, maxM) {
  if (!layout || !pose || !Number.isFinite(layout.lookX)) return false;
  const dx = layout.lookX - pose.x;
  const dy = layout.lookY - (pose.y + HULL_Y);
  const dz = layout.lookZ - pose.z;
  return Math.hypot(dx, dy, dz) <= (maxM || LOOK_PLAYER_M);
}

/**
 * @param {string} kind
 * @param {ReplaySample} pose
 * @param {object|null} track
 * @param {{aspect?:number,side?:number,flyEye?:{x:number,y:number,z:number},scratch?:object}} [opts]
 */
export function shotFramesPlayer(kind, pose, track, opts) {
  const layout = composeBroadcastShot(kind, pose, track, opts);
  return (
    lookTargetsPlayer(layout, pose) &&
    playerInBroadcastFrame(layout, pose, { kind, aspect: opts && opts.aspect })
  );
}

/**
 * TV director: picks shots, fades, and returns a camera pose.
 * Rejects any layout that would lose the player car.
 */
export class BroadcastDirector {
  /**
   * @param {object} track
   * @param {ReplayTape} tape
   * @param {{reducedMotion?:boolean,aspect?:number}} [opts]
   */
  constructor(track, tape, opts) {
    this.track = track;
    this.tape = tape;
    this.towers = buildBroadcastTowers(track);
    this.reduced = !!(opts && opts.reducedMotion);
    this.aspect = opts && opts.aspect > 0.2 ? opts.aspect : DEFAULT_ASPECT;
    this.kind = "heli";
    this.shotT = 0;
    this.hold = SHOT_HOLD.heli;
    this.fade = 0;
    this.phase = "in";
    this.phaseT = 0;
    this.didCut = false;
    this._cutLock = HOLD_MIN;
    this._rescued = false;
    this._road = {};
    this._side = 1;
    this._flyEye = null;
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
   * Live eye/look as a layout for the frustum test.
   * @returns {{eyeX:number,eyeY:number,eyeZ:number,lookX:number,lookY:number,lookZ:number,fov:number,kind:string}}
   */
  layout() {
    return {
      eyeX: this.eyeX,
      eyeY: this.eyeY,
      eyeZ: this.eyeZ,
      lookX: this.lookX,
      lookY: this.lookY,
      lookZ: this.lookZ,
      fov: this.fov,
      kind: this.kind,
    };
  }

  /**
   * @param {ReplaySample} pose
   */
  snapTo(pose) {
    if (!this._shotOk(this.kind, pose)) {
      this.kind = this._pickKind(pose);
    }
    this._compose(this.kind, pose);
    this._snapEye();
    this._cutLock = HOLD_MIN;
    this._rescued = false;
    this.fade = this.phase === "in" ? 1 : 0;
  }

  /**
   * @param {number} dt
   * @param {ReplaySample} pose
   * @returns {{fade:number,label:string,kind:string,didCut:boolean}}
   */
  update(dt, pose) {
    this.didCut = false;
    if (!pose) return { fade: 1, label: this.label(), kind: this.kind, didCut: false };
    this.shotT += dt;
    if (this._cutLock > 0) this._cutLock = Math.max(0, this._cutLock - dt);
    this._compose(this.kind, pose);
    const mustCut = this._mustCut(pose);
    const holdDone = this.shotT >= this.hold && this._cutLock <= 0;
    const rescue = mustCut && (this._cutLock <= 0 || !this._rescued);
    if (holdDone || rescue) {
      this.hardCut(pose);
      this._rescued = true;
    }
    this._stepPhase(dt, pose);
    this._follow(dt, pose);
    return { fade: this.fade, label: this.label(), kind: this.kind, didCut: this.didCut };
  }

  /**
   * Instant lens change. Camera snaps this frame — no blend, no fade-out lerp.
   * Caller must reset TSR history and re-pose the pack on the same tick.
   * @param {ReplaySample} pose
   * @param {string} [preferred]
   */
  hardCut(pose, preferred) {
    if (!pose) return;
    const prev = this.kind;
    this._flyEye = null;
    let next = preferred && preferred !== prev && this._shotOk(preferred, pose, true)
      ? preferred
      : this._pickKind(pose);
    if (next === prev) {
      const fallback = this._pickKind(pose);
      if (fallback !== prev) next = fallback;
    }
    this._side = shotSide(next, pose);
    this.kind = next;
    this.shotT = 0;
    this.hold = rollShotHold(next);
    this._cutLock = HOLD_MIN;
    this._rescued = true;
    this._compose(next, pose);
    this._snapEye();
    this.phase = "in";
    this.phaseT = 0;
    this.fade = 1;
    this.didCut = true;
  }

  /**
   * @param {ReplaySample} pose
   * @returns {boolean}
   */
  _mustCut(pose) {
    const next = {
      eyeX: this._tx,
      eyeY: this._ty,
      eyeZ: this._tz,
      lookX: this._lx,
      lookY: this._ly,
      lookZ: this._lz,
      fov: this._tfov,
      kind: this.kind,
    };
    if (!lookTargetsPlayer(next, pose) || !playerInBroadcastFrame(next, pose, { kind: this.kind, aspect: this.aspect })) {
      return true;
    }
    if (this.kind === "nose") {
      const dx = pose.x - this._tx;
      const dy = pose.y + HULL_Y - this._ty;
      const dz = pose.z - this._tz;
      if (dx * dx + dy * dy + dz * dz < 7.2 * 7.2) return true;
    }
    return false;
  }

  /**
   * @param {number} dt
   * @param {ReplaySample} pose
   */
  _stepPhase(dt, pose) {
    this.phaseT += dt;
    if (this.phase === "in") {
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

  /**
   * First candidate that keeps the player in frame wins.
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
    const prefs = [];
    if (tunnel) prefs.push("hero", "bumper", "chase");
    else if (jump) prefs.push("hero", "crane", "threeq");
    else if (Math.abs(pose.yawRate || 0) > 0.62) prefs.push("crane", "flyby", "threeq");
    else {
      const i = SHOT_CYCLE.indexOf(prev);
      const start = i >= 0 ? (i + 1) % SHOT_CYCLE.length : 0;
      const skip = Math.random() < 0.22 ? 1 : 0;
      for (let k = 0; k < SHOT_CYCLE.length; k++) {
        prefs.push(SHOT_CYCLE[(start + skip + k) % SHOT_CYCLE.length]);
      }
    }
    for (let i = 0; i < SHOT_CYCLE.length; i++) {
      const k = SHOT_CYCLE[i];
      if (!prefs.includes(k)) prefs.push(k);
    }
    for (let i = 0; i < prefs.length; i++) {
      const next = prefs[i];
      if (next === prev && prefs.length > 1) continue;
      if (this._shotOk(next, pose, true)) return next;
    }
    return "chase";
  }

  /**
   * @param {string} kind
   * @param {ReplaySample} pose
   * @param {boolean} [fresh]
   * @returns {boolean}
   */
  _shotOk(kind, pose, fresh) {
    return shotFramesPlayer(kind, pose, this.track, {
      aspect: this.aspect,
      side: this._side,
      flyEye: !fresh && kind === "flyby" ? this._flyEye : null,
      scratch: this._road,
    });
  }

  /**
   * @param {ReplaySample} pose
   * @returns {boolean}
   */
  _eyeFramesPlayer(pose) {
    return (
      lookTargetsPlayer(this.layout(), pose) &&
      playerInBroadcastFrame(this.layout(), pose, { kind: this.kind, aspect: this.aspect })
    );
  }

  /**
   * @param {string} kind
   * @param {ReplaySample} pose
   */
  _compose(kind, pose) {
    if (kind !== "flyby") this._flyEye = null;
    const layout = composeBroadcastShot(kind, pose, this.track, {
      side: this._side,
      flyEye: kind === "flyby" ? this._flyEye : null,
      scratch: this._road,
    });
    if (kind === "flyby" && !this._flyEye) {
      this._flyEye = { x: layout.eyeX, y: layout.eyeY, z: layout.eyeZ };
    }
    this._tx = layout.eyeX;
    this._ty = layout.eyeY;
    this._tz = layout.eyeZ;
    this._lx = layout.lookX;
    this._ly = layout.lookY;
    this._lz = layout.lookZ;
    this._tfov = layout.fov;
  }

  _snapEye() {
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
  }

  /**
   * Ease onto the locked shot. A cut still snaps. If the hull leaves the
   * frame, snap back so the car cannot drift out of the broadcast.
   * @param {number} dt
   * @param {ReplaySample} pose
   */
  _follow(dt, pose) {
    if (!(dt > 0)) return;
    const k = 1 - Math.exp(-dt * 14);
    this.eyeX += (this._tx - this.eyeX) * k;
    this.eyeY += (this._ty - this.eyeY) * k;
    this.eyeZ += (this._tz - this.eyeZ) * k;
    this.lookX += (this._lx - this.lookX) * k;
    this.lookY += (this._ly - this.lookY) * k;
    this.lookZ += (this._lz - this.lookZ) * k;
    this.fov += (this._tfov - this.fov) * k;
    if (pose && !this._eyeFramesPlayer(pose)) this._snapEye();
  }
}
