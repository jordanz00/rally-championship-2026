/**
 * Road deformation field — bounded, tiled, persistent wheel trails (pure numerics).
 *
 * WHO THIS IS FOR: surface-deform.js (mesh + Track.query sampler), TireMarks
 *   (stamps), qa-road-deform.mjs (node simulation test). No THREE import so it
 *   runs headless.
 * WHAT IT DOES: world-space 0.2 m cell grid grouped into 32x32 tiles (6.4 m).
 *   Each tile owns quantised Uint8 depth + berm + pass-id and an Int16 base-y
 *   (mm, tile-relative). Tiles live in a Map with an LRU cap (MAX_TILES) so
 *   memory is bounded (~5 KB/tile). Per-surface DEPOSIT table decides what
 *   deforms: soft = deep ruts + displaced berms, hardpack = shallow grooves,
 *   tarmac / cobble = ZERO geometry (marks only). First pass digs
 *   `soft * pressure` of the cap, every further DISTINCT pass (other car, or
 *   same car a lap later) deepens it, so rivals following a line wear it in.
 *   Sand / grass relax back slowly, gravel/dirt stay. Wet weather digs deeper.
 *   Landings stamp a crater + rim. Slides push a lateral berm.
 * HOW IT CONNECTS: Track owns one field; TireMarks.emit stamps it per wheel;
 *   Track.query reads sample() ONLY for DEFORM_PHYSICS surfaces on the ribbon
 *   and Vehicle strips it from the deck plane (_stableDeckY) — presentation
 *   state, never integrated by the solver. WheelRutMesh renders dirty cells.
 *
 * PERF: no per-frame allocation; Smi tile keys; tiles recycled through a free
 *   list; relaxation is round-robin time-sliced (RELAX_TILES_PER_STEP).
 */

/** Cell edge (m) — finer than a tire so left/right tracks stay distinct. */
export const CELL = 0.2;
/** Cells per tile edge (power of two). */
export const TILE_N = 32;
export const TILE_CELLS = TILE_N * TILE_N;
/** Tile edge in metres. */
export const TILE_M = CELL * TILE_N;
/** Metres per quantised depth/berm unit (u8 → 0.1785 m max). */
export const DEPTH_Q = 0.0007;
/** Hard LRU cap on live tiles (≈ 5 KB each → ~8 MB worst case). */
export const MAX_TILES = 1536;
/** Dirty-cell ring capacity handed to the mesh each frame. */
export const DIRTY_CAP = 16384;
/** Relaxation tiles processed per step() call. */
export const RELAX_TILES_PER_STEP = 4;
/** Minimum seconds between relax applications on one tile. */
export const RELAX_MIN_INTERVAL = 2.0;
/** Absolute visual depth ceiling (m) for any surface. */
export const DEPTH_HARD_CEILING = 0.175;
/** Int16 sentinel: base y not written yet. */
export const Y_UNSET = -32768;

/** Quality levels: 0 off, 1 low (no rival deform, short mesh radius), 2 full. */
export const Q_OFF = 0;
export const Q_LOW = 1;
export const Q_FULL = 2;

/**
 * Per-surface deposit table. Keys MUST cover every id in config SURFACES.
 * cap: max depth (m, dry). soft: first-pass fraction of cap at pressure 1.
 * deepen: extra fraction of cap per distinct later pass. berm / bermCap: lip
 * gain and cap (m). relaxMps: m/s the track flows back (0 = permanent).
 * wetCap: cap boost at wetness 1. wetDepth: first-pass boost at wetness 1.
 * idx is the stable numeric id stored per tile.
 */
export const DEPOSIT = {
  tarmac: { idx: 0, cap: 0, soft: 0, deepen: 0, berm: 0, bermCap: 0, relaxMps: 0, wetCap: 0, wetDepth: 0 },
  cobble: { idx: 1, cap: 0, soft: 0, deepen: 0, berm: 0, bermCap: 0, relaxMps: 0, wetCap: 0, wetDepth: 0 },
  sand: { idx: 2, cap: 0.12, soft: 0.52, deepen: 0.2, berm: 0.75, bermCap: 0.085, relaxMps: 0.0004, wetCap: 0.1, wetDepth: 0.15 },
  dirt: { idx: 3, cap: 0.1, soft: 0.55, deepen: 0.22, berm: 0.62, bermCap: 0.07, relaxMps: 0.00005, wetCap: 0.18, wetDepth: 0.45 },
  gravel: { idx: 4, cap: 0.07, soft: 0.5, deepen: 0.18, berm: 0.95, bermCap: 0.065, relaxMps: 0, wetCap: 0.12, wetDepth: 0.2 },
  mud: { idx: 5, cap: 0.15, soft: 0.65, deepen: 0.26, berm: 0.85, bermCap: 0.1, relaxMps: 0.00012, wetCap: 0.15, wetDepth: 0.2 },
  grass: { idx: 6, cap: 0.045, soft: 0.6, deepen: 0.2, berm: 0.4, bermCap: 0.03, relaxMps: 0.0006, wetCap: 0.2, wetDepth: 0.3 },
};

/** Surface ids that dig geometry (cap > 0). */
export const DEFORM_SURFACES = new Set(Object.keys(DEPOSIT).filter((k) => DEPOSIT[k].cap > 0));

/** Surfaces whose sampled depth Track.query may report (ribbon only; grass is visual-only). */
export const DEFORM_PHYSICS = new Set(["sand", "dirt", "mud", "gravel"]);

/** idx → deposit row (dense array for the hot path). */
export const DEPOSIT_BY_IDX = [];
for (const id of Object.keys(DEPOSIT)) DEPOSIT_BY_IDX[DEPOSIT[id].idx] = DEPOSIT[id];

/**
 * Lateral trench shape in normalised tire half-width space.
 * Negative = dig, positive = berm lip.
 * @param {number} u
 * @returns {number}
 */
export function trenchProfile(u) {
  const a = Math.abs(u);
  if (a < 0.48) return -(0.92 + (1 - a / 0.48) * 0.14);
  if (a < 0.9) return -0.92 * (1 - (a - 0.48) / 0.42);
  if (a < 1.28) {
    const t = 1 - Math.abs(a - 1.08) / 0.24;
    return 0.78 * Math.max(0, t);
  }
  return 0;
}

/** One 6.4 m tile of quantised deformation. */
class Tile {
  constructor() {
    this.depth = new Uint8Array(TILE_CELLS);
    this.berm = new Uint8Array(TILE_CELLS);
    this.pass = new Uint8Array(TILE_CELLS);
    this.y = new Int16Array(TILE_CELLS);
    this.key = 0;
    this.tx = 0;
    this.tz = 0;
    this.y0 = 0;
    this.hasY0 = false;
    this.surf = 3;
    this.lastTouch = 0;
    this.relaxT = 0;
    this.carry = 0;
    this.listIdx = -1;
    /** Mesh bookkeeping (owned by WheelRutMesh). */
    this.quadIdx = null;
    this.meshIdx = -1;
    this.quads = 0;
    this.stale = false;
    this.live = 0;
  }

  clear(key, tx, tz, clock) {
    this.depth.fill(0);
    this.berm.fill(0);
    this.pass.fill(0);
    this.y.fill(Y_UNSET);
    this.key = key;
    this.tx = tx;
    this.tz = tz;
    this.y0 = 0;
    this.hasY0 = false;
    this.surf = 3;
    this.lastTouch = clock;
    this.relaxT = clock;
    this.carry = 0;
    this.quadIdx = null;
    this.meshIdx = -1;
    this.quads = 0;
    this.stale = false;
    this.live = 0;
  }
}

/**
 * Bounded tiled deformation field.
 */
export class DeformField {
  /**
   * @param {number} [maxTiles]
   */
  constructor(maxTiles = MAX_TILES) {
    this.maxTiles = Math.max(8, maxTiles | 0);
    /** @type {Map<number, Tile>} */
    this.tiles = new Map();
    /** @type {Tile[]} */
    this.tileList = [];
    this._free = [];
    this._ck = -1;
    this._ct = null;
    this.clock = 0;
    this.wetness = 0;
    this.quality = Q_FULL;
    this.dirtyX = new Int32Array(DIRTY_CAP);
    this.dirtyZ = new Int32Array(DIRTY_CAP);
    this.dirtyN = 0;
    this.dirtyOverflow = false;
    this._relaxCursor = 0;
    this._passSerial = 0;
    /** Optional mesh hooks. */
    this.onEvict = null;
    this.stats = { stamps: 0, evictions: 0, created: 0, relaxed: 0, cellsTouched: 0 };
  }

  /** Drop every tile (stage restart / replay / dispose). */
  reset() {
    for (let i = 0; i < this.tileList.length; i++) {
      const t = this.tileList[i];
      if (this.onEvict) this.onEvict(t);
      t.listIdx = -1;
      this._free.push(t);
    }
    this.tileList.length = 0;
    this.tiles.clear();
    this._ck = -1;
    this._ct = null;
    this.dirtyN = 0;
    this.dirtyOverflow = false;
    this._relaxCursor = 0;
    this.clock = 0;
  }

  /** Release pooled tiles (GPU-free; just lets the arrays GC on stage teardown). */
  dispose() {
    this.reset();
    this._free.length = 0;
  }

  /** @param {number} level Q_OFF | Q_LOW | Q_FULL */
  setQuality(level) {
    this.quality = level | 0;
  }

  /** @param {string} tierId perf tier id from game quality manager */
  setQualityFromTier(tierId) {
    this.setQuality(tierId === "min" ? Q_OFF : tierId === "low" ? Q_LOW : Q_FULL);
  }

  get tileCount() {
    return this.tileList.length;
  }

  /** Approximate resident bytes (tile arrays). */
  get bytes() {
    return (this.tileList.length + this._free.length) * TILE_CELLS * 5;
  }

  /**
   * @param {number} tx
   * @param {number} tz
   * @param {boolean} create
   * @returns {Tile|null}
   */
  _tile(tx, tz, create) {
    const key = ((tx + 16384) << 15) | (tz + 16384);
    if (key === this._ck && this._ct) return this._ct;
    let t = this.tiles.get(key);
    if (!t) {
      if (!create) return null;
      t = this._newTile(key, tx, tz);
    }
    this._ck = key;
    this._ct = t;
    return t;
  }

  _newTile(key, tx, tz) {
    if (this.tileList.length >= this.maxTiles) this._evictLru();
    let t = this._free.pop();
    if (!t) {
      t = new Tile();
      this.stats.created++;
    }
    t.clear(key, tx, tz, this.clock);
    t.listIdx = this.tileList.length;
    this.tileList.push(t);
    this.tiles.set(key, t);
    return t;
  }

  _evictLru() {
    let best = null;
    let bestT = Infinity;
    const list = this.tileList;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (t === this._ct) continue;
      if (t.lastTouch < bestT) {
        bestT = t.lastTouch;
        best = t;
      }
    }
    if (!best) return;
    this._removeTile(best);
    this.stats.evictions++;
  }

  _removeTile(t) {
    if (this.onEvict) this.onEvict(t);
    const list = this.tileList;
    const last = list[list.length - 1];
    list[t.listIdx] = last;
    last.listIdx = t.listIdx;
    list.pop();
    t.listIdx = -1;
    this.tiles.delete(t.key);
    if (this._ct === t) {
      this._ct = null;
      this._ck = -1;
    }
    this._free.push(t);
  }

  _markDirty(ix, iz) {
    const n = this.dirtyN;
    if (n >= DIRTY_CAP) {
      this.dirtyOverflow = true;
      return;
    }
    this.dirtyX[n] = ix;
    this.dirtyZ[n] = iz;
    this.dirtyN = n + 1;
  }

  /** Mesh calls this after consuming dirty cells. */
  clearDirty() {
    this.dirtyN = 0;
    this.dirtyOverflow = false;
  }

  /** Quantised depth units at a global cell (0 if no tile). */
  depthAt(ix, iz) {
    const t = this._tile(ix >> 5, iz >> 5, false);
    return t ? t.depth[(ix & 31) | ((iz & 31) << 5)] : 0;
  }

  bermAt(ix, iz) {
    const t = this._tile(ix >> 5, iz >> 5, false);
    return t ? t.berm[(ix & 31) | ((iz & 31) << 5)] : 0;
  }

  /**
   * Net height offset at a world point (metres, negative = below road).
   * @param {number} x
   * @param {number} z
   * @returns {number}
   */
  sample(x, z) {
    if (this.tileList.length === 0) return 0;
    const fx = x / CELL - 0.5;
    const fz = z / CELL - 0.5;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const n00 = this._net(ix, iz);
    const n10 = this._net(ix + 1, iz);
    const n01 = this._net(ix, iz + 1);
    const n11 = this._net(ix + 1, iz + 1);
    return (n00 * (1 - tx) * (1 - tz) + n10 * tx * (1 - tz) + n01 * (1 - tx) * tz + n11 * tx * tz) * DEPTH_Q;
  }

  /** berm − depth in units at a cell. */
  _net(ix, iz) {
    const t = this._tile(ix >> 5, iz >> 5, false);
    if (!t) return 0;
    const ci = (ix & 31) | ((iz & 31) << 5);
    return t.berm[ci] - t.depth[ci];
  }

  /**
   * Stable pass id: changes per source (car/wheel) and every ~3 s so a lap
   * later by the same car counts as a new, deepening pass.
   * @param {number} src
   * @returns {number} 1..255
   */
  passId(src) {
    return (((src | 0) * 37 + ((this.clock / 3) | 0) * 11) & 255) || 1;
  }

  /**
   * Stamp one wheel footprint.
   * @param {number} x @param {number} y base road y @param {number} z
   * @param {number} dirX @param {number} dirZ unit travel dir
   * @param {number} hw tire half width (m)
   * @param {number} targetM first-pass depth at this stamp (m)
   * @param {number} incM extra depth for a repeated pass (m)
   * @param {object} dep DEPOSIT row
   * @param {number} capM effective cap (m)
   * @param {number} pass pass id
   * @param {number} side -1/0/1 slide berm bias
   * @param {number} slide 0..1 slide strength
   */
  _footprint(x, y, z, dirX, dirZ, hw, targetM, incM, dep, capM, pass, side, slide) {
    const latX = -dirZ;
    const latZ = dirX;
    const r = Math.ceil((hw * 1.8) / CELL) + 1;
    const ix0 = Math.floor(x / CELL);
    const iz0 = Math.floor(z / CELL);
    const capU = Math.min(255, Math.floor(capM / DEPTH_Q + 1e-6));
    const bermCapU = Math.min(255, Math.floor(dep.bermCap / DEPTH_Q + 1e-6));
    const bermGain = dep.berm * (0.55 + 0.6 * slide);
    const sd = dep.idx;
    const along2 = hw * 1.12;
    for (let di = -r; di <= r; di++) {
      for (let dj = -r; dj <= r; dj++) {
        const ix = ix0 + di;
        const iz = iz0 + dj;
        const dx = (ix + 0.5) * CELL - x;
        const dz = (iz + 0.5) * CELL - z;
        const latS = dx * latX + dz * latZ;
        const lat = latS < 0 ? -latS : latS;
        const along = Math.abs(dx * dirX + dz * dirZ);
        if (lat > hw * 1.75 || along > along2) continue;
        const lt = lat / hw;
        const at = along / along2;
        const profile = trenchProfile(lt > 1 ? lt * 1.05 : lt);
        const edge = 1 - at * at;
        const bowl = profile < 0 ? -profile * edge : 0;
        // Wider than the trench-profile lip: 0.2 m cells need a ~0.3 m ridge to read.
        const lipT = 1 - Math.abs(lt - 1.22) / 0.5;
        const lip = lipT > 0 ? 0.8 * lipT * edge : 0;
        if (bowl < 0.012 && lip < 0.04) continue;
        const t = this._tile(ix >> 5, iz >> 5, true);
        const ci = (ix & 31) | ((iz & 31) << 5);
        t.lastTouch = this.clock;
        t.surf = sd;
        if (t.y[ci] === Y_UNSET) {
          if (!t.hasY0) {
            t.hasY0 = true;
            t.y0 = y;
          }
          let dy = Math.round((y - t.y0) * 1000);
          if (dy > 32000) dy = 32000;
          else if (dy < -32000) dy = -32000;
          t.y[ci] = dy;
        }
        const samePass = t.pass[ci] === pass;
        if (bowl >= 0.012) {
          const prev = t.depth[ci];
          let want = Math.round((targetM * bowl) / DEPTH_Q);
          if (!samePass) {
            const bump = Math.round((incM * bowl) / DEPTH_Q);
            if (prev + bump > want) want = prev + bump;
          } else if (prev > want) want = prev;
          if (want > capU) want = capU;
          if (want > prev) {
            if (prev === 0 && t.berm[ci] === 0) t.live++;
            t.depth[ci] = want;
          }
        }
        if (lip >= 0.04) {
          // Berm lip pushed out of the groove; slides pile it on the leading side.
          const bias = 1 + 0.6 * slide * side * (latS < 0 ? -1 : 1);
          const wantB0 = (targetM * 1.05 * bermGain * lip * (bias < 0.4 ? 0.4 : bias)) / DEPTH_Q;
          let wantB = Math.round(wantB0);
          const bp = t.berm[ci];
          if (!samePass && wantB > 0) wantB = Math.max(bp, wantB) + Math.round(wantB * 0.3);
          else if (wantB < bp) wantB = bp;
          if (wantB > bermCapU) wantB = bermCapU;
          if (wantB > bp) {
            if (bp === 0 && t.depth[ci] === 0) t.live++;
            t.berm[ci] = wantB;
          }
        }
        t.pass[ci] = pass;
        this._markDirty(ix, iz);
      }
    }
    this.stats.cellsTouched++;
  }

  /**
   * Stamp a wheel segment a→b (both carry road y). Hot path: no allocation.
   * @param {{x:number,y:number,z:number}} a
   * @param {{x:number,y:number,z:number}} b
   * @param {number} halfW
   * @param {string} surface
   * @param {number} slip
   * @param {number} drift
   * @param {number} speed
   * @param {{throttle?:number, brake?:number, dig?:number, hb?:number, side?:number}|null} [load]
   * @param {number} [lod] 0 near, 1 mid, 2 far (coarser step)
   * @param {number} [src] stable per wheel/car id
   */
  stampSegment(a, b, halfW, surface, slip, drift, speed, load = null, lod = 0, src = 0) {
    if (this.quality === Q_OFF) return;
    const dep = DEPOSIT[surface];
    if (!dep || dep.cap <= 0) return;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.03) return;
    const dirX = dx / len;
    const dirZ = dz / len;
    const throt = load && load.throttle != null ? load.throttle : 0;
    const brake = load && load.brake != null ? load.brake : 0;
    const dig = load && load.dig != null ? load.dig : 0;
    const hb = load && load.hb != null ? load.hb : 0;
    const side = load && load.side != null ? load.side : 0;
    const wet = this.wetness;
    let pressure =
      0.55 + slip * 0.7 + drift * 0.78 + Math.min(0.42, speed * 0.005) + throt * 0.28 + brake * 0.32 + dig * 0.4 + hb * 0.25;
    if (pressure > 1.45) pressure = 1.45;
    let capM = dep.cap * (1 + dep.wetCap * wet);
    if (capM > DEPTH_HARD_CEILING) capM = DEPTH_HARD_CEILING;
    let targetM = capM * dep.soft * (1 + dep.wetDepth * wet) * pressure;
    if (targetM > capM) targetM = capM;
    const incM = capM * dep.deepen * pressure;
    let slide = slip * 2.2 + drift * 1.6 + hb * 0.5;
    if (slide > 1) slide = 1;
    const pass = this.passId(src);
    const hw = halfW < 0.11 ? 0.11 : halfW;
    const stepLen = CELL * (lod > 0 ? 0.9 : 0.48);
    const steps = Math.max(1, Math.ceil(len / stepLen));
    const dy = b.y - a.y;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this._footprint(a.x + dx * t, a.y + dy * t, a.z + dz * t, dirX, dirZ, hw, targetM, incM, dep, capM, pass, side, slide);
    }
    this.stats.stamps++;
  }

  /**
   * Landing crater: radial bowl + rim.
   * @param {number} x @param {number} y @param {number} z
   * @param {number} radius metres
   * @param {number} strength 0..1 (impact normalised)
   * @param {string} surface
   */
  stampImpact(x, y, z, radius, strength, surface) {
    if (this.quality === Q_OFF) return;
    const dep = DEPOSIT[surface];
    if (!dep || dep.cap <= 0 || strength <= 0) return;
    const s = strength > 1 ? 1 : strength;
    let capM = dep.cap * (1 + dep.wetCap * this.wetness);
    if (capM > DEPTH_HARD_CEILING) capM = DEPTH_HARD_CEILING;
    const capU = Math.min(255, Math.floor(capM / DEPTH_Q + 1e-6));
    const bermCapU = Math.min(255, Math.floor(dep.bermCap / DEPTH_Q + 1e-6));
    const pass = ((this._passSerial++ & 127) | 128) >>> 0;
    const rad = Math.max(0.25, radius);
    const r = Math.ceil((rad * 1.4) / CELL) + 1;
    const ix0 = Math.floor(x / CELL);
    const iz0 = Math.floor(z / CELL);
    for (let di = -r; di <= r; di++) {
      for (let dj = -r; dj <= r; dj++) {
        const ix = ix0 + di;
        const iz = iz0 + dj;
        const dx = (ix + 0.5) * CELL - x;
        const dz = (iz + 0.5) * CELL - z;
        const rr = Math.sqrt(dx * dx + dz * dz) / rad;
        if (rr > 1.4) continue;
        let bowl = 0;
        let lip = 0;
        if (rr < 1) bowl = 1 - rr * rr;
        if (rr > 0.78 && rr < 1.4) lip = 1 - Math.abs(rr - 1.05) / 0.35;
        if (bowl < 0.02 && lip < 0.05) continue;
        const t = this._tile(ix >> 5, iz >> 5, true);
        const ci = (ix & 31) | ((iz & 31) << 5);
        t.lastTouch = this.clock;
        t.surf = dep.idx;
        if (t.y[ci] === Y_UNSET) {
          if (!t.hasY0) {
            t.hasY0 = true;
            t.y0 = y;
          }
          let dy = Math.round((y - t.y0) * 1000);
          if (dy > 32000) dy = 32000;
          else if (dy < -32000) dy = -32000;
          t.y[ci] = dy;
        }
        if (bowl >= 0.02) {
          const prev = t.depth[ci];
          let want = Math.round((capM * (0.35 + 0.65 * s) * bowl) / DEPTH_Q);
          if (prev + 1 > want) want = prev;
          if (want > capU) want = capU;
          if (want > prev) {
            if (prev === 0 && t.berm[ci] === 0) t.live++;
            t.depth[ci] = want;
          }
        }
        if (lip >= 0.05) {
          const bp = t.berm[ci];
          let wantB = Math.round((dep.bermCap * (0.4 + 0.6 * s) * lip) / DEPTH_Q);
          if (wantB < bp) wantB = bp;
          if (wantB > bermCapU) wantB = bermCapU;
          if (wantB > bp) {
            if (bp === 0 && t.depth[ci] === 0) t.live++;
            t.berm[ci] = wantB;
          }
        }
        t.pass[ci] = pass;
        this._markDirty(ix, iz);
      }
    }
    this.stats.stamps++;
  }

  /**
   * Advance time: relax a few tiles round-robin (sand/grass/mud flow back).
   * @param {number} dt
   */
  step(dt) {
    if (!(dt > 0)) return;
    this.clock += dt;
    const list = this.tileList;
    const n = list.length;
    if (n === 0) return;
    let budget = Math.min(RELAX_TILES_PER_STEP, n);
    while (budget-- > 0) {
      if (this._relaxCursor >= n) this._relaxCursor = 0;
      const t = list[this._relaxCursor++];
      const elapsed = this.clock - t.relaxT;
      if (elapsed < RELAX_MIN_INTERVAL) continue;
      t.relaxT = this.clock;
      const dep = DEPOSIT_BY_IDX[t.surf];
      if (!dep || dep.relaxMps <= 0 || t.live === 0) continue;
      const units = (dep.relaxMps * elapsed) / DEPTH_Q + t.carry;
      const k = Math.floor(units);
      t.carry = units - k;
      if (k <= 0) continue;
      const kb = Math.ceil(k * 1.5);
      const d = t.depth;
      const bm = t.berm;
      let live = 0;
      for (let i = 0; i < TILE_CELLS; i++) {
        const dv = d[i];
        const bv = bm[i];
        if (dv === 0 && bv === 0) continue;
        d[i] = dv > k ? dv - k : 0;
        bm[i] = bv > kb ? bv - kb : 0;
        if (d[i] !== 0 || bm[i] !== 0) live++;
      }
      t.live = live;
      t.stale = true;
      this.stats.relaxed++;
    }
  }

  /**
   * Max |depth| across every tile (metres) — QA helper.
   * @returns {number}
   */
  maxDepthM() {
    let m = 0;
    const list = this.tileList;
    for (let i = 0; i < list.length; i++) {
      const d = list[i].depth;
      for (let c = 0; c < TILE_CELLS; c++) if (d[c] > m) m = d[c];
    }
    return m * DEPTH_Q;
  }

  /** Sum of depth units — conservation / relaxation QA helper. */
  totalDepthUnits() {
    let s = 0;
    const list = this.tileList;
    for (let i = 0; i < list.length; i++) {
      const d = list[i].depth;
      for (let c = 0; c < TILE_CELLS; c++) s += d[c];
    }
    return s;
  }
}
