/**
 * Mountain rain — camera streaks, wet road, intermittent POV wipers.
 *
 * WHO THIS IS FOR: the race loop on Mountain (or ?rain=1).
 * WHAT IT DOES: world streaks that stop on the road and the car (Track.query
 *   height + car OBB), splash crowns at those hits, wet asphalt, windshield
 *   beads that climb under accel / ram-air, and rivulets on the door glass.
 * HOW IT CONNECTS: game.js constructs StageWeather once, enables it on
 *   Mountain, and steps after the chase camera. Reads Track.query — does not
 *   rewrite it.
 *
 * BUDGET: ~700 line segments + ≤96 quiet splashes + ≤420 windshield + ≤110/side.
 * Road crowns only fire when a streak actually crosses the deck this frame.
 */

import * as THREE from "../../vendor/three.module.js";
import { setWorldRoadWetness } from "../gfx/pbr.js?v=58";

const NEAR_COUNT = 300;
const FAR_COUNT = 400;
const SPLASH_COUNT = 96;
const SPLASH_BUDGET = 10;
const DROP_MAX = 420;
const SIDE_MAX = 110;
const FALL = new THREE.Vector3(-0.1, -1, 0.03).normalize();
/** Half-extents of the rain car OBB (metres, local +Z forward). */
const CAR_HALF_W = 0.9;
const CAR_HALF_L = 2.12;
const CAR_DECK = 0.06;
const CAR_ROOF = 1.4;
const WIPER_FAR = 1.26;
const WIPER_PARK = 0.08;
/** Angular half-width of the rubber (rad) — thick enough to clear a visible path. */
const BLADE_HALF_W = 0.085;
/** Thin header strip so beads never paint the rearview housing. */
const MIRROR_BAND_V = 0.03;

/**
 * URL override: ?rain=1 forces weather; ?rain=0 disables it.
 * @returns {boolean|null}
 */
export function rainQueryFlag() {
  try {
    const q = new URLSearchParams(globalThis.location?.search || "");
    const raw = (q.get("rain") || "").toLowerCase();
    if (raw === "1" || raw === "true" || raw === "on") return true;
    if (raw === "0" || raw === "false" || raw === "off") return false;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Championship rain stage — third cup race (Desert → Forest → Mountain).
 * @param {string} courseId
 * @returns {boolean}
 */
export function courseWantsRain(courseId) {
  // Lakeside is a dry showcase stage — never carry Mountain beads onto it.
  if (courseId === "lakeside") return false;
  const flag = rainQueryFlag();
  if (flag === false) return false;
  if (flag === true) return true;
  return courseId === "mountain";
}

export class StageWeather {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.scene = scene;
    this.active = false;
    this.intensity = 0;
    this._cycle = 0;
    this._wiperT = 0;
    this._wiperAng = 0.08;
    this._wipeOn = false;
    this._drops = [];
    this._dropsL = [];
    this._dropsR = [];
    this._spawnAcc = 0;
    this._spawnAccL = 0;
    this._spawnAccR = 0;
    this._prevSpeed = 0;
    this._cam = new THREE.Vector3();
    this._lastCam = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._a = new THREE.Vector3();
    this._screenPane = null;
    this._screenCam = null;
    this._dried = true;
    this._q = {};
    this._carPos = new THREE.Vector3();
    this._carFwd = new THREE.Vector3();
    this._carRight = new THREE.Vector3();
    this._groundHint = 0;
    this._qTick = 0;
    this._wetApplied = -1;
    this._splashLeft = 0;

    this.near = this._makeStreakLayer(NEAR_COUNT, {
      color: 0xeef6fc,
      depthTest: true,
      renderOrder: 6,
    });
    this.far = this._makeStreakLayer(FAR_COUNT, {
      color: 0xc8d8e6,
      depthTest: true,
      renderOrder: 4,
    });
    this.lines = this.near.lines;
    this.mat = this.near.mat;
    this.pos = this.near.pos;
    this.geo = this.near.geo;

    for (let i = 0; i < NEAR_COUNT; i++) this._respawnLayer(this.near, i, true, true);
    for (let i = 0; i < FAR_COUNT; i++) this._respawnLayer(this.far, i, true, false);
    this.splash = this._makeSplash(SPLASH_COUNT);
  }

  /**
   * @param {number} count
   * @param {{color:number, depthTest:boolean, renderOrder:number}} spec
   */
  _makeStreakLayer(count, spec) {
    const pos = new Float32Array(count * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicMaterial({
      color: spec.color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: spec.depthTest,
      fog: false,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;
    lines.renderOrder = spec.renderOrder;
    lines.visible = false;
    this.scene.add(lines);
    return { count, pos, geo, mat, lines };
  }

  /**
   * @param {boolean} on
   * @param {THREE.Object3D|null} [trackGroup]
   */
  setActive(on, trackGroup = null) {
    this.active = !!on;
    if (!this.active) {
      this.intensity = 0;
      this.near.lines.visible = false;
      this.far.lines.visible = false;
      this.near.mat.opacity = 0;
      this.far.mat.opacity = 0;
      this._drops.length = 0;
      this._dropsL.length = 0;
      this._dropsR.length = 0;
      this._dried = false;
      this._killScreenOverlay();
      if (this.splash) {
        this.splash.points.visible = false;
        this.splash.life.fill(0);
        this._parkSplashes();
      }
      this._wetApplied = -1;
      if (trackGroup) setWorldRoadWetness(trackGroup, 0);
    } else {
      this._dried = false;
      this.intensity = Math.max(this.intensity, 0.62);
      this.near.lines.visible = true;
      this.far.lines.visible = true;
      if (this.splash) this.splash.points.visible = true;
    }
  }

  /**
   * Snap every streak around a new lens. Broadcast cuts and the finish→replay
   * jump leave the shower at the old camera, so Stage 3 replay looked dry.
   * @param {THREE.Camera|null|undefined} camera
   */
  relocate(camera) {
    if (!this.active || !camera) return;
    camera.getWorldPosition(this._cam);
    camera.getWorldDirection(this._fwd);
    this._up.set(0, 1, 0);
    this._right.crossVectors(this._fwd, this._up).normalize();
    if (this._right.lengthSq() < 1e-6) this._right.set(1, 0, 0);
    this._up.crossVectors(this._right, this._fwd).normalize();
    this._lastCam.copy(this._cam);
    for (let i = 0; i < NEAR_COUNT; i++) this._respawnLayer(this.near, i, true, true);
    for (let i = 0; i < FAR_COUNT; i++) this._respawnLayer(this.far, i, true, false);
    this.near.geo.attributes.position.needsUpdate = true;
    this.far.geo.attributes.position.needsUpdate = true;
    this.near.lines.visible = true;
    this.far.lines.visible = true;
    this.near.mat.opacity = 0.5 + this.intensity * 0.46;
    this.far.mat.opacity = 0.26 + this.intensity * 0.4;
    if (this.splash) {
      this.splash.life.fill(0);
      this._parkSplashes();
      this.splash.points.visible = this.intensity > 0.04;
    }
  }

  /**
   * Wipe every rain canvas and hide wipers / side panes. Call when the
   * stage is dry so Mountain beads cannot sit on Lakeside glass.
   * @param {THREE.Object3D|null|undefined} car
   */
  dryCar(car) {
    this._drops.length = 0;
    this._dropsL.length = 0;
    this._dropsR.length = 0;
    if (!car || !car.userData) {
      this._dried = true;
      return;
    }
    this._parkWipers(car);
    this._setWeatherVisible(car, false, false);
    this._paintDrops(car, true);
    this._paintSideDrops(car, true);
    this._dried = true;
  }

  /**
   * @param {number} dt
   * @param {{
   *   camera: THREE.Camera,
   *   car?: THREE.Object3D|null,
   *   pov?: boolean,
   *   broadcast?: boolean,
   *   audio?: {setRain?: Function}|null,
   *   trackGroup?: THREE.Object3D|null,
   *   speed?: number,
   *   slide?: number,
   *   yawRate?: number,
   *   brake?: number,
   *   throttle?: number,
   *   pitch?: number,
   *   ax?: number,
   *   ay?: number,
   *   steer?: number,
   *   handbrake?: number,
   *   track?: {query?: Function}|null,
   *   progress?: number,
   * }} opts
   */
  step(dt, opts) {
    const t = Math.max(0.001, Math.min(0.05, dt || 1 / 60));
    if (!this.active) {
      if (opts.audio && opts.audio.setRain) opts.audio.setRain(0);
      if (opts.car && !this._dried) this.dryCar(opts.car);
      return;
    }

    this._cycle += t;
    // Slow shower, no sine flicker — wet asphalt must not strobe.
    const per = 22;
    const u = (this._cycle % per) / per;
    let target = 0.62;
    if (u < 0.22) target = 0.52 + (u / 0.22) * 0.2;
    else if (u < 0.55) target = 0.72;
    else if (u < 0.78) target = 0.68 - ((u - 0.55) / 0.23) * 0.1;
    else target = 0.56;
    this.intensity += (target - this.intensity) * Math.min(1, t * 1.05);

    const wet = 0.42 + this.intensity * 0.46;
    if (opts.trackGroup && Math.abs(wet - this._wetApplied) > 0.012) {
      this._wetApplied = wet;
      setWorldRoadWetness(opts.trackGroup, wet);
    }
    if (opts.audio && opts.audio.setRain) opts.audio.setRain(this.intensity);

    this._stepStreaks(t, opts);
    this._stepSplashes(t, opts);
    this._stepWipers(t, opts.car, !!opts.pov && !opts.broadcast, this.intensity, opts);
  }

  /**
   * @param {number} dt
   * @param {object} opts
   */
  _stepStreaks(dt, opts) {
    const camera = opts.camera;
    if (!camera) return;
    camera.getWorldPosition(this._cam);
    camera.getWorldDirection(this._fwd);
    this._up.set(0, 1, 0);
    this._right.crossVectors(this._fwd, this._up).normalize();
    this._up.crossVectors(this._right, this._fwd).normalize();
    if (this._lastCam.lengthSq() > 1 && this._cam.distanceToSquared(this._lastCam) > 1600) {
      this.relocate(camera);
    } else {
      this._lastCam.copy(this._cam);
    }
    this._cacheCarFrame(opts.car);
    if (opts.car && opts.car.position) this._groundHint = opts.car.position.y;
    this._qTick = (this._qTick + 1) & 1;
    this._splashLeft = SPLASH_BUDGET;

    const kmh = Math.max(0, opts.speed || 0) * 3.6;
    // Broadcast / result is always an external lens — never hide world rain
    // just because the race camera was still in POV.
    const pov = !!opts.pov && !opts.broadcast;
    const sx = FALL.x - this._fwd.x * (0.03 + kmh * 0.006);
    const sy = FALL.y - 0.18;
    const sz = FALL.z - this._fwd.z * (0.03 + kmh * 0.006);
    const sl = Math.hypot(sx, sy, sz) || 1;
    const dir = { x: sx / sl, y: sy / sl, z: sz / sl };
    const show = this.intensity > 0.04;
    const world = { track: opts.track, progress: opts.progress || 0, speed: opts.speed || 0 };
    this._advectLayer(this.near, dt, kmh, dir, true, 14 + this.intensity * 18 + kmh * 0.12, 0.95 + Math.min(2.6, kmh * 0.016), world);
    this._advectLayer(this.far, dt, kmh, dir, false, 18 + this.intensity * 24 + kmh * 0.08, 0.78 + Math.min(1.8, kmh * 0.01), world);
    // World streaks are chase-only. In POV they punch through the roof / hood;
    // the windshield canvas is the rain the driver should see.
    this.near.lines.visible = show && !pov;
    this.far.lines.visible = show && !pov;
    this.near.mat.opacity = show && !pov ? 0.5 + this.intensity * 0.46 : 0;
    this.far.mat.opacity = show && !pov ? 0.26 + this.intensity * 0.4 : 0;
  }

  /**
   * @param {{count:number, pos:Float32Array, geo:THREE.BufferGeometry}} layer
   * @param {number} dt
   * @param {number} kmh
   * @param {{x:number,y:number,z:number}} dir
   * @param {boolean} near
   * @param {number} speed
   * @param {number} len
   * @param {{track?:object, progress?:number, speed?:number}} world
   */
  _advectLayer(layer, dt, kmh, dir, near, speed, len, world) {
    const maxR2 = near ? 90 : 420;
    const minY = near ? -3.2 : -5;
    let live = 0;
    for (let i = 0; i < layer.count; i++) {
      const i6 = i * 6;
      layer.pos[i6] += dir.x * speed * dt;
      layer.pos[i6 + 1] += dir.y * speed * dt;
      layer.pos[i6 + 2] += dir.z * speed * dt;
      let tx = layer.pos[i6] + dir.x * len;
      let ty = layer.pos[i6 + 1] + dir.y * len;
      let tz = layer.pos[i6 + 2] + dir.z * len;
      const hit = this._collideStreak(layer.pos[i6], layer.pos[i6 + 1], layer.pos[i6 + 2], tx, ty, tz, near, i, world);
      if (hit) {
        tx = hit.x;
        ty = hit.y;
        tz = hit.z;
        layer.pos[i6 + 3] = tx;
        layer.pos[i6 + 4] = ty;
        layer.pos[i6 + 5] = tz;
        if (hit.kind !== "spent") {
          this._burstSplash(hit.x, hit.y, hit.z, hit.kind, world.speed || 0);
        }
        this._respawnLayer(layer, i, false, near);
        live++;
        continue;
      }
      layer.pos[i6 + 3] = tx;
      layer.pos[i6 + 4] = ty;
      layer.pos[i6 + 5] = tz;
      const dx = layer.pos[i6] - this._cam.x;
      const dy = layer.pos[i6 + 1] - this._cam.y;
      const dz = layer.pos[i6 + 2] - this._cam.z;
      if (dy < minY || dx * dx + dz * dz > maxR2) {
        this._respawnLayer(layer, i, false, near);
      } else {
        live++;
      }
    }
    layer.geo.attributes.position.needsUpdate = true;
    return live;
  }

  /**
   * Clip a falling streak against the car OBB, then the road / land.
   * @returns {{x:number,y:number,z:number,kind:string}|null}
   */
  _collideStreak(ax, ay, az, bx, by, bz, near, index, world) {
    const carHit = this._hitCar(ax, ay, az, bx, by, bz);
    if (carHit) return carHit;
    const low = Math.min(ay, by);
    if (low > this._groundHint + 3.4) return null;
    // Far layer can skip high air, but must test once a streak is near the deck
    // or it overshoots and pops a crown the next frame.
    if (!near && (index & 1) !== this._qTick && low > this._groundHint + 2.2) {
      return null;
    }
    const q = this._sampleGround(bx, bz, world);
    if (!q) return null;
    const deck = q.height + 0.02;
    const hint = this._groundHint;
    if (Number.isFinite(hint) && Math.abs(deck - hint) > 10) {
      if (by < hint - 1.4) return { x: bx, y: hint, z: bz, kind: "spent" };
      return null;
    }
    if (!rainCrossesDeck(ay, by, deck)) {
      if (ay <= deck) return { x: ax, y: deck, z: az, kind: "spent" };
      return null;
    }
    const t = clipSegmentToY(ay, by, deck);
    return {
      x: ax + (bx - ax) * t,
      y: deck,
      z: az + (bz - az) * t,
      kind: q.tunnel ? "tunnel" : q.onRoad ? "road" : "land",
    };
  }

  /**
   * @param {number} x
   * @param {number} z
   * @param {{track?:object, progress?:number}} world
   */
  _sampleGround(x, z, world) {
    const track = world && world.track;
    if (!track || typeof track.query !== "function") {
      return { height: this._groundHint, onRoad: true, tunnel: false };
    }
    const q = track.query(x, z, this._q, world.progress || 0);
    if (!q || !Number.isFinite(q.height)) {
      return { height: this._groundHint, onRoad: true, tunnel: false };
    }
    return q;
  }

  /**
   * @param {THREE.Object3D|null|undefined} car
   */
  _cacheCarFrame(car) {
    if (!car) {
      this._carPos.set(0, -1e6, 0);
      return;
    }
    car.getWorldPosition(this._carPos);
    const yaw = car.rotation ? car.rotation.y : 0;
    this._carFwd.set(Math.sin(yaw), 0, Math.cos(yaw));
    this._carRight.set(this._carFwd.z, 0, -this._carFwd.x);
  }

  /**
   * @returns {{x:number,y:number,z:number,kind:string}|null}
   */
  _hitCar(ax, ay, az, bx, by, bz) {
    const kind = rainHitsCarSegment(
      ax, ay, az, bx, by, bz,
      this._carPos.x, this._carPos.y, this._carPos.z,
      this._carFwd.x, this._carFwd.z, this._carRight.x, this._carRight.z
    );
    if (!kind) return null;
    const t = clipCarHitT(
      ax, ay, az, bx, by, bz,
      this._carPos.x, this._carPos.y, this._carPos.z,
      this._carFwd.x, this._carFwd.z, this._carRight.x, this._carRight.z
    );
    return {
      x: ax + (bx - ax) * t,
      y: ay + (by - ay) * t,
      z: az + (bz - az) * t,
      kind,
    };
  }

  /**
   * @param {{pos:Float32Array}} layer
   * @param {number} i
   * @param {boolean} scatter
   * @param {boolean} near
   */
  _respawnLayer(layer, i, scatter, near) {
    const along = near
      ? 0.9 + Math.random() * (scatter ? 8 : 6.5)
      : 5 + Math.random() * (scatter ? 18 : 14);
    const side = (Math.random() - 0.5) * (near ? 7.2 : 13);
    // Keep streaks in the chase look-at cone (around the car), not only in the sky.
    const lift = near
      ? 2.6 + Math.random() * 4.4
      : scatter
        ? 3.2 + Math.random() * 8
        : 3.0 + Math.random() * 6.8;
    this._a.copy(this._cam).addScaledVector(this._fwd, along).addScaledVector(this._right, side);
    this._a.y = this._cam.y + lift;
    const i6 = i * 6;
    layer.pos[i6] = this._a.x;
    layer.pos[i6 + 1] = this._a.y;
    layer.pos[i6 + 2] = this._a.z;
    const sl = near ? 0.72 : 0.5;
    layer.pos[i6 + 3] = this._a.x + FALL.x * sl;
    layer.pos[i6 + 4] = this._a.y + FALL.y * sl;
    layer.pos[i6 + 5] = this._a.z + FALL.z * sl;
  }

  /**
   * Soft crown / spray points for road and body hits.
   * @param {number} count
   */
  _makeSplash(count) {
    const pos = new Float32Array(count * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    for (let i = 0; i < count; i++) pos[i * 3 + 1] = -80;
    const mat = new THREE.PointsMaterial({
      map: makeSplashSprite(),
      color: 0xb8c4cc,
      size: 0.055,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      fog: false,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 7;
    points.visible = false;
    this.scene.add(points);
    return {
      count,
      pos,
      geo,
      mat,
      points,
      vel: new Float32Array(count * 3),
      life: new Float32Array(count),
      gnd: new Float32Array(count),
      head: 0,
    };
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {string} kind
   * @param {number} speedMs
   */
  _burstSplash(x, y, z, kind, speedMs) {
    if (kind === "tunnel" || kind === "spent") return;
    const pool = this.splash;
    if (!pool || this._splashLeft <= 0) return;
    const body = kind !== "road" && kind !== "land";
    // Most asphalt hits stay silent so the deck does not strobe.
    if (!body && Math.random() > 0.34) return;
    const n = body ? 2 : 1;
    const kmh = Math.max(0, speedMs) * 3.6;
    const aft = Math.min(5, kmh * 0.028);
    for (let k = 0; k < n; k++) {
      const i = pool.head;
      pool.head = (pool.head + 1) % pool.count;
      const i3 = i * 3;
      pool.pos[i3] = x + (Math.random() - 0.5) * 0.05;
      pool.pos[i3 + 1] = y + 0.012 + Math.random() * 0.018;
      pool.pos[i3 + 2] = z + (Math.random() - 0.5) * 0.05;
      const up = body ? 0.85 + Math.random() * 0.9 : 0.35 + Math.random() * 0.45;
      pool.vel[i3] = (Math.random() - 0.5) * 0.7;
      pool.vel[i3 + 1] = up;
      pool.vel[i3 + 2] = (Math.random() - 0.5) * 0.7 - this._fwd.z * aft * 0.12 - this._carFwd.z * aft;
      pool.life[i] = body ? 0.22 + Math.random() * 0.16 : 0.36 + Math.random() * 0.22;
      pool.gnd[i] = y;
    }
    this._splashLeft -= 1;
  }

  /**
   * @param {number} dt
   * @param {object} opts
   */
  _stepSplashes(dt, opts) {
    const pool = this.splash;
    if (!pool) return;
    const pov = !!opts.pov && !opts.broadcast;
    let live = 0;
    for (let i = 0; i < pool.count; i++) {
      const i3 = i * 3;
      if (pool.life[i] <= 0) {
        pool.pos[i3 + 1] = -80;
        continue;
      }
      pool.vel[i3 + 1] -= 14 * dt;
      pool.vel[i3] *= Math.exp(-3.2 * dt);
      pool.vel[i3 + 2] *= Math.exp(-3.2 * dt);
      pool.pos[i3] += pool.vel[i3] * dt;
      pool.pos[i3 + 1] += pool.vel[i3 + 1] * dt;
      pool.pos[i3 + 2] += pool.vel[i3 + 2] * dt;
      if (pool.pos[i3 + 1] < pool.gnd[i] + 0.008) {
        pool.pos[i3 + 1] = pool.gnd[i] + 0.008;
        pool.vel[i3 + 1] *= -0.08;
        pool.life[i] *= 0.72;
      }
      pool.life[i] -= dt;
      if (pool.life[i] > 0) live++;
      else pool.pos[i3 + 1] = -80;
    }
    pool.geo.attributes.position.needsUpdate = true;
    pool.points.visible = live > 0 && this.intensity > 0.04 && !pov;
    pool.mat.opacity = 0.32;
  }

  /** Hide recycled splash verts so the road does not keep a sparkle ring. */
  _parkSplashes() {
    const pool = this.splash;
    if (!pool) return;
    for (let i = 0; i < pool.count; i++) {
      pool.life[i] = 0;
      pool.pos[i * 3 + 1] = -80;
    }
    pool.geo.attributes.position.needsUpdate = true;
  }

  /**
   * @param {number} dt
   * @param {THREE.Object3D|null|undefined} car
   * @param {boolean|undefined} pov
   * @param {number} rain
   * @param {object} opts
   */
  _stepWipers(dt, car, pov, rain, opts) {
    if (!car || !car.userData) return;
    const speedMs = opts.speed || 0;
    const raining = rain > 0.1;
    if (!raining && !this._wipeOn) {
      this._parkWipers(car);
      this._setWeatherVisible(car, !!pov, false);
      if (pov) this._paintDrops(car, true);
      this._paintSideDrops(car, true);
      return;
    }

    this._wiperT += dt;
    // Heavier rain → shorter rest so the blades stay in the story.
    const rest = rain > 0.55 ? 1.05 : 2.05;
    const out = 0.42;
    const dwell = 0.08;
    const back = 0.4;
    const cycle = rest + out + dwell + back;
    if (this._wiperT > cycle) this._wiperT -= cycle;
    const t = this._wiperT;
    const park = WIPER_PARK;
    const far = car.userData.wiperFar != null ? car.userData.wiperFar : WIPER_FAR;
    let ang = park;
    this._wipeOn = false;
    if (t > rest && t <= rest + out) {
      const k = (t - rest) / out;
      ang = park + (far - park) * (0.5 - 0.5 * Math.cos(Math.min(1, k) * Math.PI));
      this._wipeOn = true;
    } else if (t > rest + out && t <= rest + out + dwell) {
      ang = far;
      this._wipeOn = true;
    } else if (t > rest + out + dwell) {
      const k = (t - rest - out - dwell) / back;
      ang = far + (park - far) * (0.5 - 0.5 * Math.cos(Math.min(1, k) * Math.PI));
      this._wipeOn = true;
    }
    this._wiperAng = ang;
    const left = car.userData.wiperL;
    const right = car.userData.wiperR;
    const parkL = left && left.userData.parkZ != null ? left.userData.parkZ : 0.08;
    const parkR = right && right.userData.parkZ != null ? right.userData.parkZ : Math.PI - 0.08;
    if (left) left.rotation.z = parkL + ang;
    if (right) right.rotation.z = parkR - ang;

    this._setWeatherVisible(car, !!pov, raining);
    this._killScreenOverlay();

    const measured = (speedMs - this._prevSpeed) / Math.max(dt, 0.001);
    this._prevSpeed = speedMs;
    const dyn = {
      speed: speedMs,
      slide: opts.slide || 0,
      yawRate: opts.yawRate || 0,
      brake: (opts.brake || 0) + (opts.handbrake || 0) * 0.7,
      throttle: opts.throttle || 0,
      pitch: opts.pitch || 0,
      ax: (opts.ax || 0) * 0.4 + measured * 0.6,
      ay: opts.ay || 0,
      steer: opts.steer || 0,
    };

    if (raining) {
      this._spawnSideDrops(dt, rain, dyn);
      this._slideSideDrops(dt, dyn);
    }
    this._paintSideDrops(car, !raining);

    if (!pov) {
      if (!raining) this._paintDrops(car, true);
      return;
    }

    if (raining) this._spawnDrops(dt, rain, dyn);
    this._slideDrops(dt, dyn);
    if (this._wipeOn) this._wipeDrops(car);
    this._paintDrops(car, false);
  }

  /**
   * Drop the old camera-locked HUD pane. Droplets live on the windshield mesh only.
   */
  _killScreenOverlay() {
    const pane = this._screenPane;
    if (!pane) return;
    if (pane.parent) pane.parent.remove(pane);
    if (pane.geometry) pane.geometry.dispose();
    if (pane.material) pane.material.dispose();
    this._screenPane = null;
    this._screenCam = null;
  }

  /**
   * @param {THREE.Object3D} car
   * @param {boolean} on
   */
  _setWeatherVisible(car, on, raining) {
    const glass = car.userData.povRainGlass;
    const weather = car.userData.povWeather;
    if (weather) weather.visible = on;
    if (glass) {
      glass.visible = on;
      if (glass.material) glass.material.visible = on;
    }
    if (car.userData.wiperL) car.userData.wiperL.visible = on;
    if (car.userData.wiperR) car.userData.wiperR.visible = on;
    const sides = [car.userData.povRainSideL, car.userData.povRainSideR];
    for (let i = 0; i < sides.length; i++) {
      const pane = sides[i];
      if (!pane) continue;
      pane.visible = !!raining;
      if (pane.material) pane.material.visible = !!raining;
    }
  }

  /**
   * @param {number} dt
   * @param {number} rain
   * @param {{speed:number}} dyn
   */
  _spawnDrops(dt, rain, dyn) {
    const kmh = Math.max(0, dyn.speed) * 3.6;
    const ax = dyn.ax || 0;
    const hit = 55 + rain * 90 + kmh * 0.22;
    this._spawnAcc += dt * hit;
    while (this._spawnAcc > 1 && this._drops.length < DROP_MAX) {
      this._spawnAcc -= 1;
      const sessile = Math.random() < 0.62;
      const runner = !sessile && (kmh > 8 || ax > 1.4 || Math.random() > 0.45);
      const u0 = 0.02 + Math.random() * 0.96;
      const v0 = MIRROR_BAND_V + 0.03 + Math.random() * (0.94 - MIRROR_BAND_V);
      this._drops.push({
        u: u0,
        v: v0,
        r: runner
          ? 0.0028 + Math.random() * 0.0034
          : 0.002 + Math.random() * 0.0028,
        vx: (Math.random() - 0.5) * 0.012,
        vy: 0,
        life: runner ? 0.9 + Math.random() * 0.7 : 2.2 + Math.random() * 1.4,
        trail: 0,
        runner,
      });
    }
    this._coalesceDrops(this._drops);
  }

  /**
   * Neighbouring beads merge into one heavier drop.
   * @param {Array<{u:number,v:number,r:number,vx:number,vy:number,life:number,runner:boolean}>} list
   */
  _coalesceDrops(list) {
    const drops = list || this._drops;
    const n = drops.length;
    if (n < 8) return;
    for (let i = n - 1; i >= 1; i--) {
      const a = drops[i];
      if (!a) continue;
      for (let j = i - 1; j >= 0; j--) {
        const b = drops[j];
        const du = a.u - b.u;
        const dv = a.v - b.v;
        const lim = (a.r + b.r) * 1.8;
        if (du * du + dv * dv > lim * lim) continue;
        const w = a.r + b.r;
        b.u = (a.u * a.r + b.u * b.r) / w;
        b.v = (a.v * a.r + b.v * b.r) / w;
        b.vx = (a.vx * a.r + b.vx * b.r) / w;
        b.vy = (a.vy * a.r + b.vy * b.r) / w;
        b.r = Math.min(0.0075, Math.hypot(a.r, b.r) * 1.05);
        b.runner = a.runner || b.runner || b.r > 0.004;
        b.life = Math.max(a.life, b.life);
        drops.splice(i, 1);
        break;
      }
    }
  }

  /**
   * Beads on the raked screen. v=0 is the roof header, v=1 is the cowl.
   * Accel / ram-air drives −v (up the slope toward the roof). Parked gravity
   * and braking send +v toward the cowl.
   * @param {number} dt
   * @param {{
   *   speed:number, slide:number, yawRate:number,
   *   brake:number, throttle:number, pitch:number, ax:number
   * }} dyn
   */
  _slideDrops(dt, dyn) {
    const kmh = Math.max(0, dyn.speed) * 3.6;
    const throttle = clamp01(dyn.throttle || 0);
    const brake = clamp01(dyn.brake || 0);
    const ax = dyn.ax || 0;
    const accel = Math.max(0, ax, throttle * 7.5);
    const decel = Math.max(0, -ax) + brake * 6;
    // Celica windshield rake ~32° from vertical. Gravity along the glass
    // toward the cowl; ram-air on the slope throws water at the header.
    const gCowl = 0.42 + Math.max(-0.08, Math.min(0.12, (dyn.pitch || 0) * 0.35));
    const ram =
      (kmh / 95) * (kmh / 95) * 2.15 +
      throttle * (0.95 + kmh * 0.012) +
      accel * 0.085 +
      (kmh > 6 ? 0.28 : 0);
    const along = gCowl * (kmh < 8 ? 1 : 0.12) + decel * 0.045 - ram;
    const out = 0.04 + (kmh / 140) * 0.28 + throttle * 0.04;
    const feelRight =
      (dyn.steer || 0) * 0.82 +
      (dyn.yawRate || 0) * 0.32 +
      (dyn.slide || 0) * 0.7 -
      (dyn.ay || 0) * 0.04;
    const yaw = feelRight;
    for (let i = this._drops.length - 1; i >= 0; i--) {
      const d = this._drops[i];
      const mass = 0.7 + d.r * 55;
      const pin = d.runner ? 1 : 0.22 + d.r * 18;
      d.vy += (along * pin) / mass * dt;
      d.vx += (((d.u - 0.5) * out + yaw * 1.45) * pin) / mass * dt;
      d.vx *= Math.exp(-1.6 * dt);
      d.vy *= Math.exp(-0.28 * dt);
      if (ram > gCowl && d.vy > -0.02 && pin > 0.4) d.vy -= ram * 0.35 * dt;
      const vmax = (d.runner ? 0.55 : 0.12) + (kmh / 160) * 0.55 + throttle * 0.22 + accel * 0.04;
      if (d.vy > vmax * 0.55) d.vy = vmax * 0.55;
      if (d.vy < -vmax) d.vy = -vmax;
      if (d.vx > 0.55) d.vx = 0.55;
      if (d.vx < -0.55) d.vx = -0.55;
      d.u += d.vx * dt;
      d.v += d.vy * dt;
      d.trail = Math.min(1, (d.trail || 0) * Math.exp(-1.8 * dt) + Math.hypot(d.vx, d.vy) * 2.2 * dt);
      if (d.r > 0.0042 && !d.runner && Math.abs(d.vy) > 0.08) d.runner = true;
      d.life -= dt * (0.028 + (kmh / 400) * 0.04);
      if (
        d.u < -0.02 ||
        d.u > 1.02 ||
        d.v < MIRROR_BAND_V - 0.04 ||
        d.v > 1.06 ||
        d.life <= 0
      ) {
        this._drops.splice(i, 1);
      }
    }
  }

  /**
   * Door-glass beads. v=0 roof, v=1 sill. u=1 is the A-pillar (forward).
   * Gravity drips to the sill. Ram-air streaks rearward. A left turn throws
   * water right — the driver pane (outer) runs aft, the passenger pane runs
   * toward the A-pillar.
   * @param {number} dt
   * @param {number} rain
   * @param {{speed:number,ax:number,throttle:number}} dyn
   */
  _spawnSideDrops(dt, rain, dyn) {
    const kmh = Math.max(0, dyn.speed) * 3.6;
    const hit = 18 + rain * 36 + kmh * 0.08;
    this._spawnAccL += dt * hit;
    this._spawnAccR += dt * hit;
    const spawn = (list, accKey) => {
      while (this[accKey] > 1 && list.length < SIDE_MAX) {
        this[accKey] -= 1;
        const header = Math.random() < 0.48;
        const runner = header || Math.random() < 0.4 || kmh > 18;
        list.push({
          u: 0.05 + Math.random() * 0.9,
          v: header ? 0.03 + Math.random() * 0.14 : 0.08 + Math.random() * 0.72,
          r: runner ? 0.003 + Math.random() * 0.0036 : 0.0018 + Math.random() * 0.0024,
          vx: 0,
          vy: runner ? 0.04 + Math.random() * 0.08 : 0,
          life: 1.6 + Math.random() * 1.8,
          trail: 0,
          runner,
        });
      }
    };
    spawn(this._dropsL, "_spawnAccL");
    spawn(this._dropsR, "_spawnAccR");
    this._coalesceDrops(this._dropsL);
    this._coalesceDrops(this._dropsR);
  }

  /**
   * @param {number} dt
   * @param {{
   *   speed:number, slide:number, yawRate:number, brake:number,
   *   throttle:number, pitch:number, ax:number, ay:number, steer:number
   * }} dyn
   */
  _slideSideDrops(dt, dyn) {
    const kmh = Math.max(0, dyn.speed) * 3.6;
    const throttle = clamp01(dyn.throttle || 0);
    const brake = clamp01(dyn.brake || 0);
    const ax = dyn.ax || 0;
    const accel = Math.max(0, ax, throttle * 7.5);
    const decel = Math.max(0, -ax) + brake * 6;
    const gDown = 1.05 + Math.max(0, -(dyn.pitch || 0)) * 0.25;
    const ramRear = (kmh / 80) * (kmh / 80) * 1.55 + throttle * 0.55 + accel * 0.04;
    const brakeFwd = decel * 0.09;
    const feelRight =
      (dyn.steer || 0) * 0.78 +
      (dyn.yawRate || 0) * 0.3 +
      (dyn.slide || 0) * 0.62 -
      (dyn.ay || 0) * 0.04;
    const stepPane = (list, side) => {
      for (let i = list.length - 1; i >= 0; i--) {
        const d = list[i];
        const mass = 0.65 + d.r * 50;
        const pin = d.runner ? 1 : 0.28 + d.r * 16;
        const turn = feelRight * side;
        d.vy += (gDown * pin) / mass * dt;
        d.vx += ((-ramRear + brakeFwd + turn * 0.7) * pin) / mass * dt;
        d.vx *= Math.exp(-1.35 * dt);
        d.vy *= Math.exp(-0.18 * dt);
        const vmax = (d.runner ? 0.62 : 0.16) + kmh * 0.002;
        if (d.vy > vmax) d.vy = vmax;
        if (d.vy < 0) d.vy = 0;
        if (d.vx > 0.5) d.vx = 0.5;
        if (d.vx < -0.5) d.vx = -0.5;
        d.u += d.vx * dt;
        d.v += d.vy * dt;
        d.trail = Math.min(1, (d.trail || 0) * Math.exp(-1.5 * dt) + Math.hypot(d.vx, d.vy) * 2.4 * dt);
        if (d.r > 0.0038 && !d.runner && d.vy > 0.05) d.runner = true;
        d.life -= dt * 0.035;
        if (d.u < -0.04 || d.u > 1.04 || d.v < -0.04 || d.v > 1.06 || d.life <= 0) {
          list.splice(i, 1);
        }
      }
    };
    stepPane(this._dropsL, -1);
    stepPane(this._dropsR, 1);
  }

  /**
   * @param {THREE.Object3D} car
   * @param {boolean} clear
   */
  _paintSideDrops(car, clear) {
    this._paintPaneDrops(car.userData.povRainSideL, this._dropsL, clear, "side");
    this._paintPaneDrops(car.userData.povRainSideR, this._dropsR, clear, "side");
  }

  /**
   * @param {THREE.Mesh|undefined} pane
   * @param {Array} drops
   * @param {boolean} clear
   * @param {'screen'|'side'} kind
   */
  _paintPaneDrops(pane, drops, clear, kind) {
    if (!pane || !pane.userData) return;
    const ctx = pane.userData.povRainCtx;
    const tex = pane.userData.povRainTex;
    if (!ctx || !tex) return;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (clear) {
      drops.length = 0;
      tex.needsUpdate = true;
      return;
    }
    const wet = 0.025 + this.intensity * (kind === "side" ? 0.045 : 0.05);
    ctx.fillStyle = `rgba(140,160,178,${wet.toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);
    this._strokeDrops(ctx, drops, w, h, kind);
    tex.needsUpdate = true;
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array} drops
   * @param {number} w
   * @param {number} h
   * @param {'screen'|'side'} kind
   */
  _strokeDrops(ctx, drops, w, h, kind) {
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      if (kind === "screen" && d.v < MIRROR_BAND_V) continue;
      const x = d.u * w;
      const y = d.v * h;
      const rx = Math.max(1.05, d.r * w * (kind === "side" ? 1.05 : 0.92));
      const spd = Math.hypot(d.vx || 0, d.vy || 0);
      const elong = 1 + Math.min(2.8, spd * 6.2 + (d.trail || 0) * 2.1);
      const ang = Math.atan2((d.vy || 0) * h, (d.vx || 0) * w);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      const along = rx * (d.runner ? 0.34 + elong * 1.05 : 0.7);
      const across = Math.max(0.5, rx * (d.runner ? 0.24 : 0.5));
      ctx.fillStyle = "rgba(88,108,124,0.42)";
      ctx.beginPath();
      ctx.ellipse(0.55, 0.65, along * 1.05, across * 1.08, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(186,206,220,0.62)";
      ctx.beginPath();
      ctx.ellipse(0, 0, along, across, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.beginPath();
      ctx.ellipse(-along * 0.24, -across * 0.3, along * 0.24, across * 0.17, 0, 0, Math.PI * 2);
      ctx.fill();
      if (spd > 0.04) {
        ctx.strokeStyle = "rgba(160,182,198,0.28)";
        ctx.lineWidth = Math.max(0.45, rx * 0.2);
        ctx.beginPath();
        ctx.moveTo(-along * 1.35, 0);
        ctx.lineTo(-along * 0.15, 0);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /**
   * Clear beads the live blade rubber covers — angular wedge along the arm.
   * @param {THREE.Object3D} car
   */
  _wipeDrops(car) {
    const gw = car.userData.povGlassW;
    const gh = car.userData.povGlassH;
    if (!(gw > 0) || !(gh > 0)) return;
    const left = car.userData.wiperL;
    const right = car.userData.wiperR;
    for (let i = this._drops.length - 1; i >= 0; i--) {
      const d = this._drops[i];
      const wx = (d.u - 0.5) * gw;
      const wy = (0.5 - d.v) * gh;
      if (bladeHits(left, wx, wy) || bladeHits(right, wx, wy)) {
        this._drops.splice(i, 1);
      }
    }
  }

  /**
   * @param {THREE.Object3D} car
   */
  _parkWipers(car) {
    const left = car.userData.wiperL;
    const right = car.userData.wiperR;
    if (left) left.rotation.z = left.userData.parkZ != null ? left.userData.parkZ : 0.08;
    if (right) right.rotation.z = right.userData.parkZ != null ? right.userData.parkZ : Math.PI - 0.08;
    this._wiperAng = WIPER_PARK;
    this._wipeOn = false;
  }

  /**
   * @param {THREE.Object3D} car
   * @param {boolean} clear
   */
  _paintDrops(car, clear) {
    const ctx = car.userData.povRainCtx;
    const tex = car.userData.povRainTex;
    if (!ctx || !tex) return;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (clear) {
      this._drops.length = 0;
      tex.needsUpdate = true;
      return;
    }

    // Soft wet film across the whole pane, faded at the header / A-pillars.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(w * 0.02, h * 0.08);
    ctx.lineTo(w * 0.98, h * 0.08);
    ctx.lineTo(w * 0.995, h * 0.98);
    ctx.lineTo(w * 0.005, h * 0.98);
    ctx.closePath();
    ctx.clip();
    const sheenTop = Math.floor(h * MIRROR_BAND_V);
    const wet = 0.03 + this.intensity * 0.05;
    ctx.fillStyle = `rgba(140,160,178,${wet.toFixed(3)})`;
    ctx.fillRect(0, sheenTop, w, h - sheenTop);

    // Cleared wedge under live blades (darker dry path).
    this._paintWipePaths(car, ctx, w, h);

    this._strokeDrops(ctx, this._drops, w, h, "screen");
    ctx.restore();
    tex.needsUpdate = true;
  }

  /**
   * Draw the dry arc the rubber just swept so the wipe reads on the glass.
   * @param {THREE.Object3D} car
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} w
   * @param {number} h
   */
  _paintWipePaths(car, ctx, w, h) {
    if (!this._wipeOn) return;
    const gw = car.userData.povGlassW;
    const gh = car.userData.povGlassH;
    if (!(gw > 0) || !(gh > 0)) return;
    const arms = [car.userData.wiperL, car.userData.wiperR];
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "#000";
    for (let a = 0; a < arms.length; a++) {
      const pivot = arms[a];
      if (!pivot) continue;
      const len = pivot.userData.bladeLen != null ? pivot.userData.bladeLen : 0.4;
      const half = pivot.userData.bladeHalfW != null ? pivot.userData.bladeHalfW : BLADE_HALF_W;
      const px = (pivot.position.x / gw + 0.5) * w;
      const py = (0.5 - pivot.position.y / gh) * h;
      const ang = pivot.rotation.z;
      const scaleX = w / gw;
      const scaleY = h / gh;
      ctx.translate(px, py);
      ctx.rotate(-ang);
      ctx.beginPath();
      // Rubber strip in canvas pixels along +X after rotate.
      const rw = len * scaleX;
      const rh = Math.max(4, half * 2.4 * scaleY);
      ctx.rect(len * 0.08 * scaleX, -rh * 0.5, rw * 0.92, rh);
      ctx.fill();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    ctx.restore();
  }
}

/**
 * Blade rubber vs a drop in pane metres.
 * @param {THREE.Object3D|null|undefined} pivot
 * @param {number} wx
 * @param {number} wy
 */
function bladeHits(pivot, wx, wy) {
  if (!pivot) return false;
  const dx = wx - pivot.position.x;
  const dy = wy - pivot.position.y;
  const dist = Math.hypot(dx, dy);
  const len = pivot.userData.bladeLen != null ? pivot.userData.bladeLen : 0.42;
  if (dist > len + 0.02 || dist < 0.03) return false;
  const dropA = Math.atan2(dy, dx);
  let da = dropA - pivot.rotation.z;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  const half =
    pivot.userData.bladeHalfW != null
      ? Math.atan2(pivot.userData.bladeHalfW, Math.max(0.05, dist))
      : BLADE_HALF_W;
  return Math.abs(da) < Math.max(half, BLADE_HALF_W * 0.65);
}

/** @param {number} v */
function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Segment vs car OBB. Returns a hit kind or "".
 * Local +Z is forward. Used by QA so the contact boxes stay honest.
 */
export function rainHitsCarSegment(ax, ay, az, bx, by, bz, cx, cy, cz, fx, fz, rx, rz) {
  const hitA = rainHitsCarLocal(ax - cx, ay - cy, az - cz, fx, fz, rx, rz);
  if (hitA) return hitA;
  const hitB = rainHitsCarLocal(bx - cx, by - cy, bz - cz, fx, fz, rx, rz);
  if (hitB) return hitB;
  const mx = (ax + bx) * 0.5 - cx;
  const my = (ay + by) * 0.5 - cy;
  const mz = (az + bz) * 0.5 - cz;
  return rainHitsCarLocal(mx, my, mz, fx, fz, rx, rz);
}

/**
 * @param {number} wx world-relative to car
 * @returns {string}
 */
export function rainHitsCarLocal(wx, wy, wz, fx, fz, rx, rz) {
  const lx = wx * rx + wz * rz;
  const lz = wx * fx + wz * fz;
  if (Math.abs(lx) > CAR_HALF_W || lz < -CAR_HALF_L || lz > CAR_HALF_L) return "";
  if (wy < CAR_DECK || wy > CAR_ROOF) return "";
  const glassY = 0.7 + (lz - 0.42) * 0.36;
  if (lz > 0.38 && lz < 1.62 && wy >= glassY - 0.1 && wy <= glassY + 0.24 && Math.abs(lx) < 0.8) {
    return "glass";
  }
  if (lz > 0.32 && wy < 0.96) return "hood";
  if (wy > 1.02) return "roof";
  if (Math.abs(lx) > 0.62) return "flank";
  return "car";
}

/**
 * First time the segment enters the car OBB, 0..1 along AB.
 */
export function clipCarHitT(ax, ay, az, bx, by, bz, cx, cy, cz, fx, fz, rx, rz) {
  let t = 1;
  for (let s = 0; s <= 8; s++) {
    const u = s / 8;
    const x = ax + (bx - ax) * u;
    const y = ay + (by - ay) * u;
    const z = az + (bz - az) * u;
    if (rainHitsCarLocal(x - cx, y - cy, z - cz, fx, fz, rx, rz)) {
      t = u;
      break;
    }
  }
  return t;
}

/** Fraction of AY→BY that first touches plane Y. */
export function clipSegmentToY(ay, by, y) {
  const dy = by - ay;
  if (Math.abs(dy) < 1e-6) return 1;
  return Math.max(0, Math.min(1, (y - ay) / dy));
}

/** True only when the streak crosses the deck this step (not already under). */
export function rainCrossesDeck(ay, by, deck) {
  return ay > deck && by <= deck;
}

function makeSplashSprite() {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 32;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(16, 16, 1, 16, 16, 15);
  grd.addColorStop(0, "rgba(186,198,208,0.42)");
  grd.addColorStop(0.4, "rgba(150,162,172,0.16)");
  grd.addColorStop(1, "rgba(130,140,148,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}
