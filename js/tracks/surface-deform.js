/**
 * Wheel rut field + mesh — persistent road/terrain trail deformation.
 *
 * WHO THIS IS FOR: Track.query (visual-only height sample), TireMarks (stamps)
 *   and the race render layer.
 * WHAT IT DOES: DeformField (deform-field.js) is the bounded tiled heightfield
 *   (0.2 m cells, 6.4 m tiles, LRU cap, per-surface deposit table, relaxation,
 *   wet boost, landing craters). WheelRutMesh renders it as ONE draw call:
 *   a pooled quad mesh (36k quads, 28 B/vertex) whose quads exist only for
 *   cells that carry depth/berm AND sit within MESH_RADIUS of the camera.
 *   Corner heights are shared between neighbouring cells (watertight), normals
 *   come from the same corner heights so rims catch light, and vertex alpha
 *   feathers the rim so the trench melts into the road (damp dark floor,
 *   lighter displaced lip). Far tiles keep their DATA and are re-meshed when
 *   the camera returns, so a trail is persistent but GPU cost is bounded.
 * HOW IT CONNECTS: track.js owns WheelDeformField + WheelRutMesh; effects.js
 *   TireMarks stamps; game.js calls flush(camX, camZ) once per frame.
 *   Physics keeps its own deck (Vehicle._stableDeckY strips wheelDeform).
 *
 * PERF: GPU uploads use addUpdateRange over merged dirty 256-quad chunks;
 *   no per-frame allocation; tile mesh/unmesh is budgeted.
 */

import * as THREE from "../../vendor/three.module.js";
import { armSurfaceNoise } from "../gfx/surface-noise.js?v=7";
import {
  CELL,
  TILE_N,
  TILE_CELLS,
  TILE_M,
  DEPTH_Q,
  Y_UNSET,
  Q_OFF,
  Q_LOW,
  DEPOSIT_BY_IDX,
  DeformField,
  DEFORM_SURFACES,
  DEFORM_PHYSICS,
  trenchProfile,
} from "./deform-field.js?v=1";

export { DEFORM_SURFACES, DEFORM_PHYSICS, trenchProfile };

/** Quad pool for the single rut mesh (4 verts each). */
export const POOL_QUADS = 36000;
/** Camera radius (m) inside which tiles carry GPU quads. */
export const MESH_RADIUS = 110;
export const MESH_RADIUS_LOW = 45;
const MESH_HYST = 14;
const SCAN_TILES = 24;
const MESH_TILES_PER_FRAME = 8;
const MAX_MESHED = 384;
const CHUNK = 256;
const MAX_UPLOAD_RANGES = 8;
/** Lift above the exact road y so z-resolve never eats the rim. */
const LIFT = 0.003;
const NORMAL_GAIN = 1.25;

/** Field with the legacy export name — drop-in for track.js. */
export class WheelDeformField extends DeformField {}

/** mid (rim blend), floor (damp compressed soil), lip (displaced loose soil) per surface idx. */
const PALETTE = [];
function hexRgb(h) {
  return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
}
(function buildPalette() {
  const rows = {
    2: [0xc4a06a, 0x6f5233, 0xeedcb8], // sand
    3: [0x8a6a48, 0x2c1c12, 0xa88660], // dirt
    4: [0x8a847c, 0x3c3a38, 0xb3aba0], // gravel
    5: [0x4a3a2c, 0x16120e, 0x6a5440], // mud
    6: [0x4f6a35, 0x2a2a1c, 0x78884e], // grass
  };
  for (const k of Object.keys(rows)) {
    const r = rows[k];
    PALETTE[+k] = { mid: hexRgb(r[0]), floor: hexRgb(r[1]), lip: hexRgb(r[2]) };
  }
  PALETTE[0] = PALETTE[3];
  PALETTE[1] = PALETTE[3];
})();

/**
 * Pooled quad mesh that draws the deformation field near the camera.
 */
export class WheelRutMesh {
  /**
   * @param {THREE.Scene|THREE.Group} parent
   * @param {DeformField} field
   */
  constructor(parent, field) {
    this.field = field;
    this.parent = parent;
    const Q = POOL_QUADS;
    this.count = Q;
    this.pos = new Float32Array(Q * 12);
    this.nor = new Float32Array(Q * 12);
    this.col = new Uint8Array(Q * 16);
    const idx = new Uint32Array(Q * 6);
    for (let q = 0; q < Q; q++) {
      const v = q * 4;
      const o = q * 6;
      idx[o] = v;
      idx[o + 1] = v + 2;
      idx[o + 2] = v + 1;
      idx[o + 3] = v + 1;
      idx[o + 4] = v + 2;
      idx[o + 5] = v + 3;
    }
    for (let k = 1; k < this.pos.length; k += 3) this.pos[k] = -80;
    this.geo = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(this.pos, 3);
    const na = new THREE.BufferAttribute(this.nor, 3);
    const ca = new THREE.BufferAttribute(this.col, 4, true);
    pa.setUsage(THREE.DynamicDrawUsage);
    na.setUsage(THREE.DynamicDrawUsage);
    ca.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute("position", pa);
    this.geo.setAttribute("normal", na);
    this.geo.setAttribute("color", ca);
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      roughness: 0.96,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -8,
      polygonOffsetUnits: -8,
    });
    this.mat.userData.kind = "prop";
    armSurfaceNoise(this.mat, 0.28);
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = "wheel-ruts";
    parent.add(this.mesh);

    this._free = new Int32Array(Q);
    this._freeN = 0;
    this._hw = 0;
    this._qFrame = new Int32Array(Q);
    this._qTile = new Array(Q).fill(null);
    this._chunkDirty = new Uint8Array(Math.ceil(Q / CHUNK));
    this._anyDirty = false;
    this._frame = 1;
    /** @type {Array<import("./deform-field.js").DeformField["tileList"][number]>} */
    this._meshed = [];
    this._idxPool = [];
    this._scanCursor = 0;
    this._meshBudget = 0;
    this._cy = 0;
    this._cd = 0;
    this._cx = 0;
    this._cz = 0;
    /** Per-frame diagnostics for QA / perf probe. */
    this.stats = { quads: 0, meshedTiles: 0, uploadBytes: 0, lastFlushMs: 0, writes: 0 };
    field.onEvict = (t) => this._unmesh(t);
  }

  /** Free every quad (stage restart / replay). Field.reset handles the data. */
  reset() {
    for (let i = this._meshed.length - 1; i >= 0; i--) this._unmesh(this._meshed[i]);
    this._meshed.length = 0;
    this._freeN = 0;
    this._hw = 0;
    this._qFrame.fill(0);
    this._chunkDirty.fill(0);
    this._anyDirty = false;
    this.geo.setDrawRange(0, 0);
    for (let k = 1; k < this.pos.length; k += 3) this.pos[k] = -80;
    this.geo.attributes.position.addUpdateRange(0, this.pos.length);
    this.geo.attributes.position.needsUpdate = true;
    this.field.clearDirty();
  }

  /** Release GPU buffers + material (Track.dispose / stage teardown). */
  dispose() {
    this.field.onEvict = null;
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.geo.dispose();
    this.mat.dispose();
    this._meshed.length = 0;
    this._idxPool.length = 0;
  }

  _allocQuad() {
    if (this._freeN > 0) return this._free[--this._freeN];
    if (this._hw < this.count) return this._hw++;
    return -1;
  }

  _freeQuad(q) {
    const p = this.pos;
    const o = q * 12;
    for (let v = 0; v < 4; v++) {
      p[o + v * 3] = 0;
      p[o + v * 3 + 1] = -80;
      p[o + v * 3 + 2] = 0;
    }
    this._qTile[q] = null;
    this._free[this._freeN++] = q;
    this._touchChunk(q);
  }

  _touchChunk(q) {
    this._chunkDirty[(q / CHUNK) | 0] = 1;
    this._anyDirty = true;
  }

  /** Remove a tile's quads from the pool. */
  _unmesh(t) {
    if (!t || !t.quadIdx) return;
    const qi = t.quadIdx;
    for (let c = 0; c < TILE_CELLS; c++) {
      const q = qi[c];
      if (q >= 0) {
        this._freeQuad(q);
        qi[c] = -1;
      }
    }
    this._idxPool.push(qi);
    t.quadIdx = null;
    t.quads = 0;
    const m = this._meshed;
    const i = t.meshIdx;
    if (i >= 0 && m[i] === t) {
      const last = m[m.length - 1];
      m[i] = last;
      last.meshIdx = i;
      m.pop();
    }
    t.meshIdx = -1;
  }

  _distSq(t, cx, cz) {
    const dx = (t.tx + 0.5) * TILE_M - cx;
    const dz = (t.tz + 0.5) * TILE_M - cz;
    return dx * dx + dz * dz;
  }

  _evictFarthest(cx, cz, minDistSq) {
    let best = null;
    let bestD = minDistSq;
    const m = this._meshed;
    for (let i = 0; i < m.length; i++) {
      const d = this._distSq(m[i], cx, cz);
      if (d > bestD) {
        bestD = d;
        best = m[i];
      }
    }
    if (!best) return false;
    this._unmesh(best);
    return true;
  }

  /** Give a tile GPU quads for every populated cell. */
  _meshTile(t, cx, cz) {
    if (t.quadIdx || t.live === 0) return false;
    if (this._meshed.length >= MAX_MESHED) {
      if (!this._evictFarthest(cx, cz, this._distSq(t, cx, cz) + 1)) return false;
    }
    const freeQuads = this._freeN + (this.count - this._hw);
    const need = t.live + 16;
    if (freeQuads < need) {
      const d0 = this._distSq(t, cx, cz);
      let guard = 6;
      while (guard-- > 0 && this._freeN + (this.count - this._hw) < need) {
        if (!this._evictFarthest(cx, cz, d0 + MESH_HYST * MESH_HYST)) break;
      }
      if (this._freeN + (this.count - this._hw) < need) return false;
    }
    let qi = this._idxPool.pop();
    if (!qi) qi = new Int32Array(TILE_CELLS);
    qi.fill(-1);
    t.quadIdx = qi;
    t.meshIdx = this._meshed.length;
    this._meshed.push(t);
    t.stale = false;
    this._rebuildTile(t);
    return true;
  }

  /** Re-evaluate every cell of a meshed tile (mesh / relaxation). */
  _rebuildTile(t) {
    const qi = t.quadIdx;
    if (!qi) return;
    const bx = t.tx * TILE_N;
    const bz = t.tz * TILE_N;
    for (let c = 0; c < TILE_CELLS; c++) {
      const has = t.depth[c] !== 0 || t.berm[c] !== 0;
      const q = qi[c];
      if (has) {
        const ix = bx + (c & 31);
        const iz = bz + (c >> 5);
        this._ensureWrite(t, c, ix, iz);
      } else if (q >= 0) {
        this._freeQuad(q);
        qi[c] = -1;
        t.quads--;
      }
    }
    t.stale = false;
  }

  /** Allocate (if needed) and write the quad for cell c of tile t. */
  _ensureWrite(t, c, ix, iz) {
    const qi = t.quadIdx;
    let q = qi[c];
    if (q < 0) {
      q = this._allocQuad();
      if (q < 0) return;
      qi[c] = q;
      this._qTile[q] = t;
      t.quads++;
    }
    if (this._qFrame[q] === this._frame) return;
    this._qFrame[q] = this._frame;
    this._writeQuad(q, ix, iz, t, c);
  }

  /**
   * Shared corner (ci,cj): average base y of neighbouring cells + average net
   * deform. Neighbouring quads call this with the same inputs → watertight.
   */
  _corner(ci, cj, fallbackY) {
    const f = this.field;
    let sy = 0;
    let ny = 0;
    let sn = 0;
    for (let i = ci - 1; i <= ci; i++) {
      for (let j = cj - 1; j <= cj; j++) {
        const t = f._tile(i >> 5, j >> 5, false);
        if (!t) continue;
        const c = (i & 31) | ((j & 31) << 5);
        sn += t.berm[c] - t.depth[c];
        const yv = t.y[c];
        if (yv !== Y_UNSET) {
          sy += t.y0 + yv * 0.001;
          ny++;
        }
      }
    }
    this._cy = ny > 0 ? sy / ny : fallbackY;
    this._cd = sn * 0.25 * DEPTH_Q;
  }

  _colorAt(o, cd, pal, dep, wet) {
    const col = this.col;
    let r;
    let g;
    let b;
    let a;
    if (cd < 0) {
      const s = Math.min(1, -cd / (dep.cap * 0.5 + 1e-4));
      const fl = pal.floor;
      const wk = 1 - 0.28 * wet;
      r = pal.mid[0] + (fl[0] * wk - pal.mid[0]) * s;
      g = pal.mid[1] + (fl[1] * wk - pal.mid[1]) * s;
      b = pal.mid[2] + (fl[2] * wk - pal.mid[2]) * s;
      a = Math.min(0.96, s * 1.7);
    } else {
      const s = Math.min(1, cd / (dep.bermCap * 0.55 + 1e-4));
      const lp = pal.lip;
      const wk = 1 - 0.18 * wet;
      r = pal.mid[0] + (lp[0] * wk - pal.mid[0]) * s;
      g = pal.mid[1] + (lp[1] * wk - pal.mid[1]) * s;
      b = pal.mid[2] + (lp[2] * wk - pal.mid[2]) * s;
      a = Math.min(0.9, s * 1.6);
    }
    col[o] = (r * 255) | 0;
    col[o + 1] = (g * 255) | 0;
    col[o + 2] = (b * 255) | 0;
    col[o + 3] = (a * 255) | 0;
  }

  _writeQuad(q, ix, iz, t, c) {
    const fb = t.y0 + (t.y[c] === Y_UNSET ? 0 : t.y[c] * 0.001);
    const dep = DEPOSIT_BY_IDX[t.surf] || DEPOSIT_BY_IDX[3];
    const pal = PALETTE[t.surf] || PALETTE[3];
    const wet = this.field.wetness;
    const p = this.pos;
    const n = this.nor;
    const o = q * 12;
    const oc = q * 16;
    const x0 = ix * CELL;
    const z0 = iz * CELL;
    // corner order: 0=(ix,iz) 1=(ix+1,iz) 2=(ix,iz+1) 3=(ix+1,iz+1)
    this._corner(ix, iz, fb);
    const y0 = this._cy + this._cd + LIFT;
    this._colorAt(oc, this._cd, pal, dep, wet);
    this._corner(ix + 1, iz, fb);
    const y1 = this._cy + this._cd + LIFT;
    this._colorAt(oc + 4, this._cd, pal, dep, wet);
    this._corner(ix, iz + 1, fb);
    const y2 = this._cy + this._cd + LIFT;
    this._colorAt(oc + 8, this._cd, pal, dep, wet);
    this._corner(ix + 1, iz + 1, fb);
    const y3 = this._cy + this._cd + LIFT;
    this._colorAt(oc + 12, this._cd, pal, dep, wet);
    p[o] = x0;
    p[o + 1] = y0;
    p[o + 2] = z0;
    p[o + 3] = x0 + CELL;
    p[o + 4] = y1;
    p[o + 5] = z0;
    p[o + 6] = x0;
    p[o + 7] = y2;
    p[o + 8] = z0 + CELL + 0;
    p[o + 9] = x0 + CELL;
    p[o + 10] = y3;
    p[o + 11] = z0 + CELL;
    const gx = ((y1 + y3 - y0 - y2) / (2 * CELL)) * NORMAL_GAIN;
    const gz = ((y2 + y3 - y0 - y1) / (2 * CELL)) * NORMAL_GAIN;
    const inv = 1 / Math.sqrt(gx * gx + 1 + gz * gz);
    const nx = -gx * inv;
    const ny = inv;
    const nz = -gz * inv;
    for (let v = 0; v < 4; v++) {
      n[o + v * 3] = nx;
      n[o + v * 3 + 1] = ny;
      n[o + v * 3 + 2] = nz;
    }
    this._touchChunk(q);
    this.stats.writes++;
  }

  /**
   * Consume dirty cells, mesh/unmesh tiles near (cx,cz), push GPU ranges.
   * Call once per frame after all stamps.
   * @param {number} [cx] camera x
   * @param {number} [cz] camera z
   */
  flush(cx = 0, cz = 0) {
    const f = this.field;
    if (f.quality === Q_OFF) {
      this.mesh.visible = false;
      f.clearDirty();
      return;
    }
    this.mesh.visible = true;
    if (f.tileList.length === 0 && this._hw === 0) return;
    const t0 = typeof performance !== "undefined" ? performance.now() : 0;
    this._frame++;
    this.stats.writes = 0;
    const R = f.quality === Q_LOW ? MESH_RADIUS_LOW : MESH_RADIUS;
    const R2 = (R + TILE_M) * (R + TILE_M);
    this._meshBudget = MESH_TILES_PER_FRAME;

    if (f.dirtyOverflow) {
      for (let i = 0; i < this._meshed.length; i++) this._meshed[i].stale = true;
    }
    const n = f.dirtyN;
    const dx = f.dirtyX;
    const dz = f.dirtyZ;
    for (let k = 0; k < n; k++) {
      const ix = dx[k];
      const iz = dz[k];
      const t = f._tile(ix >> 5, iz >> 5, false);
      if (!t) continue;
      if (!t.quadIdx) {
        if (this._meshBudget > 0 && this._distSq(t, cx, cz) < R2) {
          this._meshBudget--;
          this._meshTile(t, cx, cz);
        }
        continue;
      }
      const c = (ix & 31) | ((iz & 31) << 5);
      if (t.depth[c] !== 0 || t.berm[c] !== 0) this._ensureWrite(t, c, ix, iz);
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          if (i === 0 && j === 0) continue;
          const jx = ix + i;
          const jz = iz + j;
          const nt = f._tile(jx >> 5, jz >> 5, false);
          if (!nt || !nt.quadIdx) continue;
          const nc = (jx & 31) | ((jz & 31) << 5);
          const q = nt.quadIdx[nc];
          if (q < 0 || this._qFrame[q] === this._frame) continue;
          this._qFrame[q] = this._frame;
          this._writeQuad(q, jx, jz, nt, nc);
        }
      }
    }
    f.clearDirty();

    // Budgeted scan: re-mesh returning tiles, drop far ones, rebuild relaxed.
    const list = f.tileList;
    const scan = Math.min(SCAN_TILES, list.length);
    for (let s = 0; s < scan; s++) {
      if (this._scanCursor >= list.length) this._scanCursor = 0;
      const t = list[this._scanCursor++];
      const d2 = this._distSq(t, cx, cz);
      if (t.quadIdx) {
        const lim = R + TILE_M + MESH_HYST;
        if (d2 > lim * lim) this._unmesh(t);
        else if (t.stale && this._meshBudget > 0) {
          this._meshBudget--;
          this._frame++;
          this._rebuildTile(t);
        }
      } else if (t.live > 0 && d2 < R2 && this._meshBudget > 0) {
        this._meshBudget--;
        this._meshTile(t, cx, cz);
      }
    }

    this._upload();
    this.stats.quads = this._hw - this._freeN;
    this.stats.meshedTiles = this._meshed.length;
    if (t0) this.stats.lastFlushMs = performance.now() - t0;
  }

  _upload() {
    const hwQuads = this._hw;
    this.geo.setDrawRange(0, hwQuads * 6);
    if (!this._anyDirty) {
      this.stats.uploadBytes = 0;
      return;
    }
    const pa = this.geo.attributes.position;
    const na = this.geo.attributes.normal;
    const ca = this.geo.attributes.color;
    const cd = this._chunkDirty;
    const nChunks = cd.length;
    // Merge consecutive dirty chunks into ranges; fall back to one span.
    let ranges = 0;
    let first = -1;
    let last = -1;
    for (let i = 0; i < nChunks; i++) {
      if (cd[i]) {
        if (first < 0) first = i;
        last = i;
        if (i === 0 || !cd[i - 1]) ranges++;
      }
    }
    let bytes = 0;
    if (first >= 0) {
      if (ranges > MAX_UPLOAD_RANGES) {
        const q0 = first * CHUNK;
        const q1 = Math.min(this.count, (last + 1) * CHUNK);
        this._addRange(pa, na, ca, q0, q1);
        bytes += (q1 - q0) * (48 + 48 + 16);
      } else {
        let i = 0;
        while (i < nChunks) {
          if (!cd[i]) {
            i++;
            continue;
          }
          let j = i;
          while (j + 1 < nChunks && cd[j + 1]) j++;
          const q0 = i * CHUNK;
          const q1 = Math.min(this.count, (j + 1) * CHUNK);
          this._addRange(pa, na, ca, q0, q1);
          bytes += (q1 - q0) * (48 + 48 + 16);
          i = j + 1;
        }
      }
      pa.needsUpdate = true;
      na.needsUpdate = true;
      ca.needsUpdate = true;
    }
    cd.fill(0);
    this._anyDirty = false;
    this.stats.uploadBytes = bytes;
  }

  _addRange(pa, na, ca, q0, q1) {
    pa.addUpdateRange(q0 * 12, (q1 - q0) * 12);
    na.addUpdateRange(q0 * 12, (q1 - q0) * 12);
    ca.addUpdateRange(q0 * 16, (q1 - q0) * 16);
  }

  /** Legacy hook — geometry now comes from the field. */
  writeSegment() {}
}
