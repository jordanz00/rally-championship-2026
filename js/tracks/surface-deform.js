/**
 * Wheel rut field — persistent terrain deformation from tire contact.
 *
 * WHO THIS IS FOR: Track.query (physics height) and the race visual layer.
 * WHAT IT DOES: stamps a sparse height grid where wheels roll on sand, dirt,
 *   mud, and gravel; bilinear samples feed query height so cars sink into
 *   their own tracks; a solid mesh sculpts a tire trench + berms.
 * HOW IT CONNECTS: track.js owns WheelDeformField; TireMarks stamps segments;
 *   vehicle axle probes read the lowered height through Track.query.
 *
 * PERF: integer Map keys (no string GC); GPU attribute uploads batched in
 *   flush() with updateRange so soft-surface driving does not re-upload ~MB
 *   of rut mesh every stamp.
 */

import * as THREE from "../../vendor/three.module.js";

/** Surfaces that accumulate wheel ruts. */
export const DEFORM_SURFACES = new Set(["sand", "dirt", "mud", "gravel"]);

/** Max rut depth per surface (metres) — readable Group A tire trenches. */
const DEPTH_CAP = {
  sand: 0.078,
  dirt: 0.062,
  mud: 0.095,
  gravel: 0.042,
};

/**
 * Compressed / damp tire-track earth — muted browns, not desert-yellow paint.
 */
const RUT_TINT = {
  sand: 0x7a6248,
  dirt: 0x4e3c2c,
  mud: 0x2e2820,
  gravel: 0x555048,
};

/** Pack ix,iz into one int key — avoids `"ix,iz"` string allocs on the hot path. */
const KEY_OFF = 1 << 19;
function cellKey(ix, iz) {
  return ((ix + KEY_OFF) << 20) | ((iz + KEY_OFF) & 0xfffff);
}

/**
 * Sparse world grid of accumulated wheel depression (metres, positive = deeper).
 */
export class WheelDeformField {
  constructor() {
    this.cell = 0.36;
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
    if (this.cells.size === 0 && this.berms.size === 0) return 0;
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
   * @param {number} x
   * @param {number} z
   * @param {number} dirX
   * @param {number} dirZ
   * @param {number} halfW
   * @param {number} depth
   * @param {number} [cap]
   */
  stamp(x, z, dirX, dirZ, halfW, depth, cap = depth) {
    if (depth < 0.0008) return;
    const latX = -dirZ;
    const latZ = dirX;
    const r = Math.ceil((halfW * 1.35) / this.cell) + 1;
    const ix0 = Math.floor(x / this.cell);
    const iz0 = Math.floor(z / this.cell);
    const maxDep = Math.max(depth, cap);
    const cells = this.cells;
    const berms = this.berms;
    for (let di = -r; di <= r; di++) {
      for (let dj = -r; dj <= r; dj++) {
        const cx = (ix0 + di + 0.5) * this.cell;
        const cz = (iz0 + dj + 0.5) * this.cell;
        const dx = cx - x;
        const dz = cz - z;
        const lat = Math.abs(dx * latX + dz * latZ);
        const along = Math.abs(dx * dirX + dz * dirZ);
        if (lat > halfW * 1.22 || along > halfW * 1.05) continue;
        const lt = lat / Math.max(0.08, halfW);
        const at = along / Math.max(0.08, halfW * 1.05);
        let bowl;
        if (lt < 0.55) bowl = 0.92 + (1 - lt / 0.55) * 0.08;
        else if (lt < 1.0) bowl = 0.92 * (1 - (lt - 0.55) / 0.45);
        else bowl = 0;
        bowl *= 1 - at * at;
        if (bowl < 0.015) continue;
        const key = cellKey(ix0 + di, iz0 + dj);
        const prev = cells.get(key) || 0;
        const add = depth * bowl * 0.38;
        const next = Math.min(maxDep, Math.max(prev, depth * bowl * 0.55) + add * (prev > 0 ? 0.55 : 1));
        if (next > prev) cells.set(key, next);
        if (lt > 0.58 && lt < 1.18) {
          const berm = depth * 0.72 * Math.max(0, 1 - Math.abs(lt - 0.88) / 0.28);
          const bp = berms.get(key) || 0;
          const bermNext = Math.min(maxDep * 0.85, Math.max(bp, berm) + berm * 0.22);
          if (bermNext > bp) berms.set(key, bermNext);
        }
      }
    }
  }

  /**
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
    const cap = DEPTH_CAP[surface] || 0.042;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.035) return;
    const dirX = dx / len;
    const dirZ = dz / len;
    const pressure = Math.min(
      1,
      0.42 + slip * 0.48 + drift * 0.58 + Math.min(0.32, speed * 0.0038)
    );
    const depth = cap * pressure;
    // Slightly coarser steps than cell*0.4 — same depth, fewer stamp kernels.
    const steps = Math.max(1, Math.ceil(len / (this.cell * 0.55)));
    const hw = Math.max(0.09, halfW);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.stamp(a.x + dx * t, a.z + dz * t, dirX, dirZ, hw, depth, cap);
    }
  }

  /** @param {number} ix @param {number} iz */
  _cell(ix, iz) {
    return this.cells.get(cellKey(ix, iz)) || 0;
  }

  /** @param {number} ix @param {number} iz */
  _berm(ix, iz) {
    return this.berms.get(cellKey(ix, iz)) || 0;
  }
}

/** Lateral trench profile (berm → wall → floor → wall → berm). */
const RUT_RINGS = [
  { u: -1.18, shade: 0.92 },
  { u: -0.98, shade: 1.02 },
  { u: -0.78, shade: 0.78 },
  { u: -0.42, shade: 0.62 },
  { u: -0.12, shade: 0.55 },
  { u: 0.12, shade: 0.55 },
  { u: 0.42, shade: 0.62 },
  { u: 0.78, shade: 0.78 },
  { u: 0.98, shade: 1.02 },
  { u: 1.18, shade: 0.92 },
];

/**
 * Solid 3D rut mesh — tire trench cross-section welded to the road surface.
 */
export class WheelRutMesh {
  /**
   * @param {THREE.Scene|THREE.Group} parent
   * @param {WheelDeformField} field
   */
  constructor(parent, field) {
    this.field = field;
    this.count = 14000;
    this.pos = new Float32Array(this.count * 6 * 3);
    this.col = new Float32Array(this.count * 6 * 3);
    this.norm = new Float32Array(this.count * 6 * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute("normal", new THREE.BufferAttribute(this.norm, 3));
    this.mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.97,
      metalness: 0,
      flatShading: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = true;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.renderOrder = 1;
    parent.add(this.mesh);
    this.i = 0;
    this._gpuDirty = false;
    this._wrapDirty = false;
    this._dirtyMin = 0;
    this._dirtyMax = -1;
    this._color = new THREE.Color();
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._c = new THREE.Vector3();
    this._ab = new THREE.Vector3();
    this._ac = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._boundsDirty = 0;
    for (let k = 1; k < this.pos.length; k += 3) this.pos[k] = -80;
  }

  reset() {
    this.i = 0;
    this._gpuDirty = false;
    this._wrapDirty = false;
    this._dirtyMin = 0;
    this._dirtyMax = -1;
    for (let k = 1; k < this.pos.length; k += 3) this.pos[k] = -80;
    const pos = this.geo.attributes.position;
    pos.updateRange.offset = 0;
    pos.updateRange.count = -1;
    pos.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.normal.needsUpdate = true;
  }

  /**
   * Push pending attribute uploads once per frame (after all stamps).
   */
  flush() {
    if (!this._gpuDirty) return;
    const pos = this.geo.attributes.position;
    const col = this.geo.attributes.color;
    const nor = this.geo.attributes.normal;
    if (this._wrapDirty || this._dirtyMax < this._dirtyMin) {
      pos.updateRange.offset = 0;
      pos.updateRange.count = -1;
      col.updateRange.offset = 0;
      col.updateRange.count = -1;
      nor.updateRange.offset = 0;
      nor.updateRange.count = -1;
    } else {
      const off = this._dirtyMin * 18;
      const cnt = (this._dirtyMax - this._dirtyMin + 1) * 18;
      pos.updateRange.offset = off;
      pos.updateRange.count = cnt;
      col.updateRange.offset = off;
      col.updateRange.count = cnt;
      nor.updateRange.offset = off;
      nor.updateRange.count = cnt;
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    nor.needsUpdate = true;
    this._gpuDirty = false;
    this._wrapDirty = false;
    this._dirtyMin = 0;
    this._dirtyMax = -1;
    // Rare bounds refresh so frustum culling stays honest without per-stamp cost.
    this._boundsDirty += 1;
    if (this._boundsDirty >= 48) {
      this._boundsDirty = 0;
      this.geo.computeBoundingSphere();
    }
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
    const hw = Math.max(0.09, halfW);
    const tint = RUT_TINT[surface] || 0x4e3c2c;
    const dig = Math.min(0.18, slip * 0.1 + drift * 0.12);
    const field = this.field;
    const yAt = (x, z, baseY) => baseY + field.sample(x, z);
    const rings = RUT_RINGS;

    for (let r = 0; r < rings.length - 1; r++) {
      const u0 = rings[r].u * hw;
      const u1 = rings[r + 1].u * hw;
      const shade = (rings[r].shade + rings[r + 1].shade) * 0.5 * (0.94 - dig);
      const ax0 = a.x + nx * u0;
      const az0 = a.z + nz * u0;
      const ax1 = a.x + nx * u1;
      const az1 = a.z + nz * u1;
      const bx0 = b.x + nx * u0;
      const bz0 = b.z + nz * u0;
      const bx1 = b.x + nx * u1;
      const bz1 = b.z + nz * u1;
      this._triQuad(
        ax0,
        yAt(ax0, az0, a.y),
        az0,
        ax1,
        yAt(ax1, az1, a.y),
        az1,
        bx0,
        yAt(bx0, bz0, b.y),
        bz0,
        bx1,
        yAt(bx1, bz1, b.y),
        bz1,
        tint,
        shade
      );
    }
  }

  _markDirty(slot) {
    if (!this._gpuDirty) {
      this._dirtyMin = slot;
      this._dirtyMax = slot;
      this._gpuDirty = true;
    } else if (slot < this._dirtyMin || slot > this._dirtyMax) {
      // Ring wrap or out-of-order → full upload this flush.
      if (slot < this._dirtyMin && this._dirtyMax - slot > this.count * 0.5) this._wrapDirty = true;
      if (slot < this._dirtyMin) this._dirtyMin = slot;
      if (slot > this._dirtyMax) this._dirtyMax = slot;
    }
  }

  _triQuad(ax0, ay0, az0, ax1, ay1, az1, bx0, by0, bz0, bx1, by1, bz1, hex, shade) {
    const slot = this.i % this.count;
    const prevI = this.i;
    this.i += 1;
    if (this.i > this.count && slot < (prevI % this.count)) this._wrapDirty = true;
    this._markDirty(slot);
    const base = slot * 18;
    this._color.setHex(hex);
    const r = this._color.r * shade;
    const g = this._color.g * shade;
    const bl = this._color.b * shade;
    const verts = [ax0, ay0, az0, ax1, ay1, az1, bx0, by0, bz0, bx0, by0, bz0, ax1, ay1, az1, bx1, by1, bz1];
    for (let v = 0; v < 18; v++) this.pos[base + v] = verts[v];

    this._faceNormal(ax0, ay0, az0, ax1, ay1, az1, bx0, by0, bz0);
    const n0x = this._n.x;
    const n0y = this._n.y;
    const n0z = this._n.z;
    this._faceNormal(bx0, by0, bz0, ax1, ay1, az1, bx1, by1, bz1);
    const n1x = this._n.x;
    const n1y = this._n.y;
    const n1z = this._n.z;

    for (let v = 0; v < 6; v++) {
      const ci = base + v * 3;
      this.col[ci] = r;
      this.col[ci + 1] = g;
      this.col[ci + 2] = bl;
      const useB = v >= 3;
      this.norm[ci] = useB ? n1x : n0x;
      this.norm[ci + 1] = useB ? n1y : n0y;
      this.norm[ci + 2] = useB ? n1z : n0z;
    }
  }

  _faceNormal(ax, ay, az, bx, by, bz, cx, cy, cz) {
    this._a.set(ax, ay, az);
    this._b.set(bx, by, bz);
    this._c.set(cx, cy, cz);
    this._ab.subVectors(this._b, this._a);
    this._ac.subVectors(this._c, this._a);
    this._n.crossVectors(this._ab, this._ac);
    if (this._n.y < 0) this._n.negate();
    if (this._n.lengthSq() < 1e-10) this._n.set(0, 1, 0);
    else this._n.normalize();
  }
}
