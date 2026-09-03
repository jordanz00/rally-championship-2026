/**
 * Wheel rut field — persistent terrain deformation from tire contact.
 *
 * WHO THIS IS FOR: Track.query (physics height) and the race visual layer.
 * WHAT IT DOES: stamps a sparse height grid where wheels roll on sand, dirt,
 *   mud, and gravel; bilinear samples feed query height so cars sink into
 *   their own tracks; a solid mesh renders the depressed ribbon + berms.
 * HOW IT CONNECTS: track.js owns WheelDeformField; TireMarks stamps segments;
 *   vehicle axle probes read the lowered height through Track.query.
 */

import * as THREE from "../../vendor/three.module.js";

/** Surfaces that accumulate wheel ruts. */
export const DEFORM_SURFACES = new Set(["sand", "dirt", "mud", "gravel"]);

/** Max rut depth per surface (metres). */
const DEPTH_CAP = {
  sand: 0.052,
  dirt: 0.048,
  mud: 0.068,
  gravel: 0.032,
};

/**
 * Sparse world grid of accumulated wheel depression (metres, positive = deeper).
 */
export class WheelDeformField {
  constructor() {
    this.cell = 0.52;
    this.cells = new Map();
    this.berms = new Map();
  }

  reset() {
    this.cells.clear();
    this.berms.clear();
  }

  /**
   * @param {number} x
   * @param {number} z
   * @returns {number} negative Y offset (metres)
   */
  sample(x, z) {
    const s = this.cell;
    const fx = x / s - 0.5;
    const fz = z / s - 0.5;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const d00 = this._cell(ix, iz);
    const d10 = this._cell(ix + 1, iz);
    const d01 = this._cell(ix, iz + 1);
    const d11 = this._cell(ix + 1, iz + 1);
    const dep = d00 * (1 - tx) * (1 - tz) + d10 * tx * (1 - tz) + d01 * (1 - tx) * tz + d11 * tx * tz;
    const b00 = this._berm(ix, iz);
    const b10 = this._berm(ix + 1, iz);
    const b01 = this._berm(ix, iz + 1);
    const b11 = this._berm(ix + 1, iz + 1);
    const berm = b00 * (1 - tx) * (1 - tz) + b10 * tx * (1 - tz) + b01 * (1 - tx) * tz + b11 * tx * tz;
    return -(dep - berm);
  }

  /**
   * Stamp one wheel contact patch into the field.
   * @param {number} x world X
   * @param {number} z world Z
   * @param {number} dirX along-track unit X
   * @param {number} dirZ along-track unit Z
   * @param {number} halfW half tire width (metres)
   * @param {number} depth peak depression (metres)
   */
  stamp(x, z, dirX, dirZ, halfW, depth) {
    if (depth < 0.001) return;
    const latX = -dirZ;
    const latZ = dirX;
    const r = Math.ceil((halfW * 1.15) / this.cell) + 1;
    const ix0 = Math.floor(x / this.cell);
    const iz0 = Math.floor(z / this.cell);
    const cap = depth;
    for (let di = -r; di <= r; di++) {
      for (let dj = -r; dj <= r; dj++) {
        const cx = (ix0 + di + 0.5) * this.cell;
        const cz = (iz0 + dj + 0.5) * this.cell;
        const dx = cx - x;
        const dz = cz - z;
        const lat = Math.abs(dx * latX + dz * latZ);
        const along = Math.abs(dx * dirX + dz * dirZ);
        if (lat > halfW * 1.08 || along > halfW * 0.95) continue;
        const lt = lat / Math.max(0.08, halfW);
        const at = along / Math.max(0.08, halfW * 0.95);
        const bowl = (1 - lt * lt) * (1 - at * at);
        if (bowl < 0.02) continue;
        const dep = cap * bowl;
        const key = ix0 + di + "," + (iz0 + dj);
        const prev = this.cells.get(key) || 0;
        if (dep > prev) this.cells.set(key, dep);
        if (lt > 0.62 && lt < 1.02) {
          const berm = cap * 0.58 * (1 - Math.abs(lt - 0.82) / 0.2);
          const bp = this.berms.get(key) || 0;
          if (berm > bp) this.berms.set(key, berm);
        }
      }
    }
  }

  /**
   * Walk a wheel segment and accumulate rut depth.
   * @param {{x:number,y:number,z:number}} a
   * @param {{x:number,y:number,z:number}} b
   * @param {number} halfW
   * @param {string} surface
   * @param {number} slip
   * @param {number} drift
   * @param {number} speed
   */
  stampSegment(a, b, halfW, surface, slip, drift, speed) {
    if (!DEFORM_SURFACES.has(surface)) return;
    const cap = DEPTH_CAP[surface] || 0.032;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.04) return;
    const dirX = dx / len;
    const dirZ = dz / len;
    const pressure = Math.min(
      1,
      0.28 + slip * 0.55 + drift * 0.65 + Math.min(0.35, speed * 0.004)
    );
    const depth = cap * pressure;
    const steps = Math.max(1, Math.ceil(len / (this.cell * 0.45)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = a.x + dx * t;
      const z = a.z + dz * t;
      this.stamp(x, z, dirX, dirZ, halfW, depth);
    }
  }

  /** @param {number} ix @param {number} iz */
  _cell(ix, iz) {
    return this.cells.get(ix + "," + iz) || 0;
  }

  /** @param {number} ix @param {number} iz */
  _berm(ix, iz) {
    return this.berms.get(ix + "," + iz) || 0;
  }
}

const RUT_TINT = {
  sand: 0xc4aa72,
  dirt: 0x8a7358,
  mud: 0x5a4a38,
  gravel: 0x7a7068,
};

/**
 * Solid 3D rut mesh — depressed quads welded to the road surface.
 */
export class WheelRutMesh {
  /**
   * @param {THREE.Scene|THREE.Group} parent
   * @param {WheelDeformField} field
   */
  constructor(parent, field) {
    this.field = field;
    this.count = 9600;
    this.pos = new Float32Array(this.count * 6 * 3);
    this.col = new Float32Array(this.count * 6 * 3);
    this.norm = new Float32Array(this.count * 6 * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute("normal", new THREE.BufferAttribute(this.norm, 3));
    this.mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.94,
      metalness: 0.01,
      flatShading: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.renderOrder = 1;
    parent.add(this.mesh);
    this.i = 0;
    this._color = new THREE.Color();
    for (let k = 1; k < this.pos.length; k += 3) this.pos[k] = -80;
  }

  reset() {
    this.i = 0;
    for (let k = 1; k < this.pos.length; k += 3) this.pos[k] = -80;
    this.geo.attributes.position.needsUpdate = true;
  }

  /**
   * @param {{x:number,y:number,z:number}} a
   * @param {{x:number,y:number,z:number}} b
   * @param {number} halfW
   * @param {string} surface
   * @param {number} slip
   * @param {number} drift
   */
  writeSegment(a, b, halfW, surface, slip, drift) {
    if (!DEFORM_SURFACES.has(surface)) return;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = dz / len;
    const nz = -dx / len;
    const dirX = dx / len;
    const dirZ = dz / len;
    const centerHalf = halfW * 0.58;
    const ridgeHalf = halfW * 0.16;
    const ridgeOff = halfW * 0.82;
    const tint = RUT_TINT[surface] || 0x8a7358;
    const shade = 0.88 + Math.min(0.12, slip * 0.08 + drift * 0.1);

    const yAt = (x, z, baseY) => baseY + this.field.sample(x, z);

    const ay0 = yAt(a.x, a.z, a.y);
    const by0 = yAt(b.x, b.z, b.y);
    this._quad(a.x, ay0, a.z, b.x, by0, b.z, nx, nz, centerHalf, tint, shade * 0.82, -0.35);
    this._quad(
      a.x + nx * ridgeOff,
      yAt(a.x + nx * ridgeOff, a.z + nz * ridgeOff, a.y) + 0.012,
      a.z + nz * ridgeOff,
      b.x + nx * ridgeOff,
      yAt(b.x + nx * ridgeOff, b.z + nz * ridgeOff, b.y) + 0.012,
      b.z + nz * ridgeOff,
      nx,
      nz,
      ridgeHalf,
      tint,
      shade * 1.04,
      0.55
    );
    this._quad(
      a.x - nx * ridgeOff,
      yAt(a.x - nx * ridgeOff, a.z - nz * ridgeOff, a.y) + 0.012,
      a.z - nz * ridgeOff,
      b.x - nx * ridgeOff,
      yAt(b.x - nx * ridgeOff, b.z - nz * ridgeOff, b.y) + 0.012,
      b.z - nz * ridgeOff,
      nx,
      nz,
      ridgeHalf,
      tint,
      shade * 1.04,
      0.55
    );
  }

  _quad(ax0, ay0, az0, bx0, by0, bz0, nx, nz, halfW, hex, shade, ny) {
    const i = this.i % this.count;
    this.i += 1;
    const base = i * 18;
    this._color.setHex(hex);
    const r = this._color.r * shade;
    const g = this._color.g * shade;
    const bl = this._color.b * shade;
    const ax = ax0 + nx * halfW;
    const az = az0 + nz * halfW;
    const bx = ax0 - nx * halfW;
    const bz = az0 - nz * halfW;
    const cx = bx0 + nx * halfW;
    const cz = bz0 + nz * halfW;
    const dx = bx0 - nx * halfW;
    const dz = bz0 - nz * halfW;
    const verts = [ax, ay0, az, bx, ay0, bz, cx, by0, cz, cx, by0, cz, bx, ay0, bz, dx, by0, dz];
    for (let v = 0; v < 18; v++) this.pos[base + v] = verts[v];
    const cBase = i * 18;
    const nBase = i * 18;
    for (let v = 0; v < 6; v++) {
      const ci = cBase + v * 3;
      this.col[ci] = r;
      this.col[ci + 1] = g;
      this.col[ci + 2] = bl;
      this.norm[nBase + v * 3] = 0;
      this.norm[nBase + v * 3 + 1] = ny;
      this.norm[nBase + v * 3 + 2] = 0;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.normal.needsUpdate = true;
  }
}
