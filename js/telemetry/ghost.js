/**
 * Ghost recorder / player — local best-lap ghosts (Sprint 40).
 *
 * WHO THIS IS FOR: Time Attack mode + future online ghost sync.
 * WHAT IT DOES: records pose samples at 10 Hz; stores in localStorage;
 *   plays back transparent rival mesh with interpolation.
 * HOW IT CONNECTS: game.js race loop; time attack loads best on grid.
 */

const GHOST_KEY = "rally-ghost-v1";
const SAMPLE_HZ = 10;

/**
 * @typedef {{t:number,x:number,y:number,z:number,yaw:number,speed:number,gear?:number}} GhostSample
 */

export class GhostRecorder {
  constructor() {
    /** @type {GhostSample[]} */
    this.samples = [];
    this.t = 0;
    this.active = false;
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
    this.active = true;
    this.courseId = courseId;
    this.carId = carId;
    this._acc = 0;
  }

  stop() {
    this.active = false;
  }

  /**
   * @param {number} dt
   * @param {{position:{x:number,y:number,z:number}, yaw:number, speed:number, gear?:number}} vehicle
   */
  tick(dt, vehicle) {
    if (!this.active || !vehicle) return;
    this.t += dt;
    this._acc = (this._acc || 0) + dt;
    const step = 1 / SAMPLE_HZ;
    if (this._acc < step) return;
    this._acc -= step;
    this.samples.push({
      t: this.t,
      x: vehicle.position.x,
      y: vehicle.position.y,
      z: vehicle.position.z,
      yaw: vehicle.yaw,
      speed: vehicle.speed,
      gear: vehicle.gear,
    });
  }

  /**
   * @returns {{courseId:string,carId:string,lapTime:number,samples:GhostSample[]}|null}
   */
  export() {
    if (this.samples.length < 4) return null;
    return {
      courseId: this.courseId,
      carId: this.carId,
      lapTime: this.t,
      samples: this.samples,
    };
  }

  /**
   * @param {{courseId:string,carId:string,lapTime:number,samples:GhostSample[]}} data
   */
  static saveBest(data) {
    if (!data || !data.samples?.length) return false;
    try {
      const all = GhostRecorder.loadAll();
      const key = `${data.courseId}:${data.carId}`;
      const prev = all[key];
      if (!prev || data.lapTime < prev.lapTime) {
        all[key] = data;
        localStorage.setItem(GHOST_KEY, JSON.stringify(all));
        return true;
      }
    } catch {
      /* quota / private mode */
    }
    return false;
  }

  /** @returns {Record<string, {courseId:string,carId:string,lapTime:number,samples:GhostSample[]}>} */
  static loadAll() {
    try {
      const raw = localStorage.getItem(GHOST_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  /**
   * @param {string} courseId
   * @param {string} carId
   */
  static loadBest(courseId, carId) {
    const all = GhostRecorder.loadAll();
    return all[`${courseId}:${carId}`] || null;
  }
}

export class GhostPlayer {
  /**
   * @param {{samples:GhostSample[]}} data
   */
  constructor(data) {
    this.samples = data?.samples || [];
    this.t = 0;
    this.done = this.samples.length < 2;
  }

  reset() {
    this.t = 0;
    this.done = this.samples.length < 2;
  }

  /**
   * @param {number} dt
   * @param {THREE.Object3D} mesh
   */
  tick(dt, mesh) {
    if (!mesh || this.done || !this.samples.length) return;
    this.t += dt;
    const s = this.samples;
    let i = 0;
    while (i < s.length - 1 && s[i + 1].t < this.t) i++;
    if (i >= s.length - 1) {
      const last = s[s.length - 1];
      mesh.position.set(last.x, last.y, last.z);
      mesh.rotation.y = last.yaw;
      this.done = true;
      return;
    }
    const a = s[i];
    const b = s[i + 1];
    const u = b.t > a.t ? (this.t - a.t) / (b.t - a.t) : 0;
    mesh.position.set(
      a.x + (b.x - a.x) * u,
      a.y + (b.y - a.y) * u,
      a.z + (b.z - a.z) * u
    );
    let dy = b.yaw - a.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    mesh.rotation.y = a.yaw + dy * u;
  }
}
