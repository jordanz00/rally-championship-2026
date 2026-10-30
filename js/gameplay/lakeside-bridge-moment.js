/**
 * Lakeside bridge moment — the cinematic layer for the long suspension span.
 *
 * WHO FOR: RallyGame (race frame), Stage 4 only.
 * WHAT: (1) pure weights from track distance — camera pull-back, golden-hour
 *   sun blend, expansion-joint / tower events; (2) bounded set dressing —
 *   a few additive light-shaft quads under the cables and two drifting mist
 *   sheets over the water; (3) cable / hanger / tower shadow casting so the
 *   low sun sweeps stripes across the deck.
 * HOW: game.js owns one instance per Track (`track._bridgeMoment`). Camera uses
 *   distance and height only — never FOV. "CALM CAMERA" cancels the camera part.
 *   No asset files: textures are drawn once on a canvas.
 */

import * as THREE from "../../vendor/three.module.js";

/** Tunables. Camera numbers stay small so the medium chase car never shrinks. */
export const BRIDGE_MOMENT = {
  cam: {
    /** Extra chase distance / height at full weight (m). Medium view only. */
    back: 0.8,
    height: 0.42,
    lookAhead: 1.6,
    /** Ramp starts this far before the deck and is full 0.6× that far in. */
    inM: 70,
    /** Ease back to the normal rig over this distance after the deck. */
    outM: 110,
    /** Extra push right at the entry portals, decays over entryM. */
    entryBoost: 0.3,
    entryM: 150,
  },
  sun: {
    /** Golden-hour elevation (deg) while on the span. */
    elevDeg: 27,
    /** Max azimuth push (deg) toward a cross-lit angle so cable shadows slant. */
    azimuthPushDeg: 32,
    color: 0xffb468,
    fog: 0xf2c694,
    fogMix: 0.34,
    inM: 240,
    outM: 280,
  },
  /** Expansion joint spacing on the deck (m). */
  jointM: 30,
  wheelBase: 2.55,
  /** Quality tier -> shaft quad count / mist layers. */
  tiers: {
    min: { shafts: 0, mist: 0 },
    low: { shafts: 14, mist: 1 },
    medium: { shafts: 30, mist: 2 },
    high: { shafts: 44, mist: 2 },
  },
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth01 = (v) => {
  const x = clamp01(v);
  return x * x * (3 - 2 * x);
};

/**
 * @param {number} seed
 * @returns {() => number}
 */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Camera pull-back weight (0..1+entry) along the track. Pure, stateless.
 * @param {number} dist player progress (m)
 * @param {{dist0:number,dist1:number}|null} br deck span
 * @returns {number}
 */
export function bridgeCamWeight(dist, br) {
  if (!br || !(br.dist1 > br.dist0)) return 0;
  const C = BRIDGE_MOMENT.cam;
  const rampIn = smooth01((dist - (br.dist0 - C.inM)) / (C.inM * 1.6));
  const rampOut = 1 - smooth01((dist - br.dist1) / C.outM);
  const entry = 1 - smooth01((dist - br.dist0) / C.entryM);
  const k = 0.7 + C.entryBoost * entry;
  return Math.min(1, rampIn * rampOut * k);
}

/**
 * Golden-hour sun weight (0..1) — wider than the camera window so the grade
 * rolls in on the approach instead of popping at the first tower.
 * @param {number} dist
 * @param {{dist0:number,dist1:number}|null} br
 * @returns {number}
 */
export function bridgeSunWeight(dist, br) {
  if (!br || !(br.dist1 > br.dist0)) return 0;
  const S = BRIDGE_MOMENT.sun;
  return smooth01((dist - (br.dist0 - S.inM)) / S.inM) * (1 - smooth01((dist - br.dist1) / S.outM));
}

/** Soft cloud noise drawn once — tileable via wrap repeat. */
function makeMistTexture(seed) {
  if (typeof document === "undefined") return null;
  const N = 128;
  const c = document.createElement("canvas");
  c.width = N;
  c.height = N;
  const g = c.getContext("2d");
  const img = g.createImageData(N, N);
  const r = rng(seed);
  const octs = [];
  for (let o = 0; o < 4; o++) {
    const n = 4 << o;
    const grid = new Float32Array(n * n);
    for (let i = 0; i < grid.length; i++) grid[i] = r();
    octs.push({ n, grid });
  }
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let v = 0;
      let amp = 0.5;
      let tot = 0;
      for (let o = 0; o < octs.length; o++) {
        const { n, grid } = octs[o];
        const fx = (x / N) * n;
        const fy = (y / N) * n;
        const x0 = Math.floor(fx) % n;
        const y0 = Math.floor(fy) % n;
        const x1 = (x0 + 1) % n;
        const y1 = (y0 + 1) % n;
        const tx = smooth01(fx - Math.floor(fx));
        const ty = smooth01(fy - Math.floor(fy));
        const a = grid[y0 * n + x0] * (1 - tx) + grid[y0 * n + x1] * tx;
        const b = grid[y1 * n + x0] * (1 - tx) + grid[y1 * n + x1] * tx;
        v += (a * (1 - ty) + b * ty) * amp;
        tot += amp;
        amp *= 0.5;
      }
      v = clamp01((v / tot - 0.3) * 2.1);
      const i = (y * N + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(v * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Per-track bridge cinema controller.
 */
export class LakesideBridgeMoment {
  /**
   * @param {object} track Track with `points`, `_lakesideBridge`, `group`
   * @param {{tier?:string, baseSunDir?:{x:number,y:number,z:number}}} [opts]
   */
  constructor(track, opts = {}) {
    this.track = track;
    this.br = track._lakesideBridge || null;
    this.tier = BRIDGE_MOMENT.tiers[opts.tier] ? opts.tier : "medium";
    this.ready = false;
    this.group = null;
    this.camK = 0;
    this._shaftMat = null;
    this._mistLayers = [];
    this._sunGold = new THREE.Vector3();
    this._sunOut = new THREE.Vector3();
    this._colB = new THREE.Color();
    this._joint = -1;
    this._lastDist = null;
    this._t = 0;
    this._baseSun = opts.baseSunDir
      ? new THREE.Vector3(opts.baseSunDir.x, opts.baseSunDir.y, opts.baseSunDir.z).normalize()
      : new THREE.Vector3(0.56, 0.68, 0.28).normalize();
    if (this.br) this._build();
  }

  /** Tower distances along the track (builder publishes them; fraction fallback). */
  get towerDists() {
    const br = this.br;
    if (!br) return [];
    if (Array.isArray(br.towerDists) && br.towerDists.length) return br.towerDists;
    const L = br.dist1 - br.dist0;
    return [br.dist0 + L * 0.14, br.dist0 + L * 0.86];
  }

  _heading(d) {
    const s = this.track.sample(d, this._smp || (this._smp = {}));
    const t = this.track.sample(d + 6, this._smp2 || (this._smp2 = {}));
    return Math.atan2(t.x - s.x, t.z - s.z);
  }

  _build() {
    const track = this.track;
    const br = this.br;
    const pts = track.points;
    if (!pts || !pts[br.i1]) return;
    const T = BRIDGE_MOMENT.tiers[this.tier];

    // Golden sun: lower elevation, azimuth nudged toward cross-lit so hanger
    // shadows slant over the deck instead of running down it.
    const mid = (br.dist0 + br.dist1) * 0.5;
    const hd = this._heading(mid);
    let az = Math.atan2(this._baseSun.x, this._baseSun.z);
    const rel = Math.atan2(Math.sin(az - hd), Math.cos(az - hd));
    const wantRel = (rel >= 0 ? 1 : -1) * (Math.PI / 2 - 0.38);
    const push = Math.max(
      -BRIDGE_MOMENT.sun.azimuthPushDeg,
      Math.min(BRIDGE_MOMENT.sun.azimuthPushDeg, ((wantRel - rel) * 180) / Math.PI)
    );
    az += (Math.abs(rel) < 1.18 ? push : 0) * (Math.PI / 180);
    const el = (BRIDGE_MOMENT.sun.elevDeg * Math.PI) / 180;
    this._sunGold.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();

    this.group = new THREE.Group();
    this.group.name = "lakeside-bridge-moment";
    this.group.frustumCulled = false;
    if (T.shafts > 0) this._buildShafts(T.shafts);
    if (T.mist > 0) this._buildMist(T.mist);
    track.group.add(this.group);
    this.group.visible = false;
    this.ready = true;
  }

  /** Cable / hanger / tower shadows — the low sun does the sweeping. */
  armShadows() {
    if (this._shadowsArmed) return;
    const root = this.track.group.children.find((c) => c.userData && c.userData.lakesideBridge);
    if (!root) return;
    root.traverse((o) => {
      if (!o.isMesh) return;
      if (/cable|hanger|tower|rail/.test(o.name || "")) {
        o.castShadow = true;
        if (o.material) o.material.shadowSide = THREE.DoubleSide;
      }
    });
    this._shadowsArmed = true;
  }

  _buildShafts(count) {
    const track = this.track;
    const br = this.br;
    const r = rng(0x5ba7e1);
    const towers = this.towerDists;
    const pos = [];
    const col = [];
    const idx = [];
    // Skip bays so shafts cluster and gap — no even picket-fence rhythm.
    const sMin = towers[0] - 70;
    const sMax = towers[towers.length - 1] + 70;
    const dir = this._sunGold;
    const sample = {};
    let placed = 0;
    let s = sMin;
    while (placed < count && s < sMax) {
      s += 5 + r() * 26 * (r() < 0.3 ? 2.2 : 1);
      const p = track.sample(s, sample);
      const half = Math.max(5.2, (p.width || 14) * 0.5);
      const lat = (r() * 2 - 1) * half * 0.95;
      const top = 13 + r() * 14;
      const len = 14 + r() * 20;
      const wid = 1.6 + r() * 4.8;
      const peak = 0.05 + r() * 0.1;
      const cx = p.x + p.nx * lat;
      const cz = p.z + p.nz * lat;
      const cy = p.y + top;
      // Ray runs from the top point down and away from the sun.
      const bx = cx - dir.x * len;
      const by = cy - dir.y * len;
      const bz = cz - dir.z * len;
      const mx = (cx + bx) * 0.5;
      const my = (cy + by) * 0.5;
      const mz = (cz + bz) * 0.5;
      const base = pos.length / 3;
      const rows = [
        [cx, cy, cz, 0],
        [mx, my, mz, peak],
        [bx, by, bz, 0],
      ];
      for (let rI = 0; rI < 3; rI++) {
        const [x, y, z, a] = rows[rI];
        for (let cI = -1; cI <= 1; cI++) {
          pos.push(x + p.nx * wid * 0.5 * cI, y, z + p.nz * wid * 0.5 * cI);
          const edge = cI === 0 ? 1 : 0;
          col.push(1, 0.84 - r() * 0.06, 0.56, a * edge);
        }
      }
      for (let rI = 0; rI < 2; rI++) {
        for (let cI = 0; cI < 2; cI++) {
          const a = base + rI * 3 + cI;
          idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
        }
      }
      placed++;
    }
    if (!placed) return;
    void br;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      opacity: 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = "bridge-light-shafts";
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    this.group.add(mesh);
    this._shaftMat = mat;
  }

  _buildMist(layers) {
    const track = this.track;
    const br = this.br;
    const pts = track.points;
    const waterY = Number.isFinite(br.waterY) ? br.waterY : (Number.isFinite(br.baseY) ? br.baseY : pts[br.i0].y) - 1.05;
    const d0 = br.dist0 - 40;
    const d1 = br.dist1 + 40;
    const step = 14;
    const n = Math.max(4, Math.round((d1 - d0) / step));
    const sample = {};
    for (let L = 0; L < layers; L++) {
      const tex = makeMistTexture(77 + L * 31);
      if (!tex) return;
      const half = L === 0 ? 70 : 96;
      const y = waterY + (L === 0 ? 0.7 : 2.6);
      const pos = [];
      const uv = [];
      const col = [];
      const idx = [];
      for (let i = 0; i <= n; i++) {
        const d = d0 + (i / n) * (d1 - d0);
        const p = track.sample(d, sample);
        const ends = smooth01(Math.min(i, n - i) / 3);
        for (let c = 0; c < 3; c++) {
          const side = c - 1;
          pos.push(p.x + p.nx * half * side, y, p.z + p.nz * half * side);
          uv.push((d - d0) / (L === 0 ? 55 : 80), c * 0.5);
          col.push(1, 0.9, 0.78, (c === 1 ? 0.8 : 0) * ends);
        }
        if (i < n) {
          const a = i * 3;
          idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
      geo.setIndex(idx);
      geo.computeBoundingSphere();
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        opacity: 0,
        fog: true,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `bridge-mist-${L}`;
      mesh.frustumCulled = false;
      mesh.renderOrder = 4 + L;
      this.group.add(mesh);
      this._mistLayers.push({ mesh, mat, tex, speed: L === 0 ? 0.012 : -0.008, peak: L === 0 ? 0.34 : 0.22 });
    }
  }

  /**
   * Per-frame update: dressing visibility + drift. Cheap — no allocation.
   * @param {number} dist player progress (m)
   * @param {number} dt seconds
   */
  update(dist, dt) {
    if (!this.ready) return;
    const step = dt > 0 && dt < 0.2 ? dt : 0;
    this._t += step;
    const wSun = bridgeSunWeight(dist, this.br);
    this.sunW = wSun;
    const show = wSun > 0.015;
    this.group.visible = show;
    if (!show) return;
    this.armShadows();
    const breathe = 0.88 + 0.12 * Math.sin(this._t * 0.8);
    if (this._shaftMat) this._shaftMat.opacity = wSun * breathe;
    for (let i = 0; i < this._mistLayers.length; i++) {
      const m = this._mistLayers[i];
      m.mat.opacity = m.peak * Math.min(1, wSun * 1.4);
      m.tex.offset.x += m.speed * step;
      m.tex.offset.y += m.speed * 0.6 * step;
    }
  }

  /**
   * Golden-hour sun vector (length 1..2.3 = light-camera standoff in sun-follow units).
   * @param {{x:number,y:number,z:number}} base authored sun direction
   * @returns {THREE.Vector3}
   */
  sunDir(base) {
    const w = this.sunW || 0;
    if (w <= 0.001) return null;
    // Longer vector = shadow camera sits further back, so 20–40 m cables and hangers
    // stay in front of the light's near plane (a low sun puts them behind it otherwise).
    this._sunOut.set(base.x, base.y, base.z).lerp(this._sunGold, w).normalize().multiplyScalar(1 + 1.3 * w);
    return this._sunOut;
  }

  /**
   * Warm the key light and horizon fog on the span (intensity unchanged — exposure gates stay).
   * @param {THREE.DirectionalLight} sun
   * @param {THREE.Color|null} fogColor
   * @param {number} baseHex authored key colour (LIGHTING.lakeside.sun)
   */
  grade(sun, fogColor, baseHex) {
    const w = this.sunW || 0;
    if (w <= 0.001) {
      if (this._graded && sun) sun.color.setHex(baseHex);
      this._graded = false;
      return;
    }
    this._graded = true;
    if (sun) {
      sun.color.setHex(baseHex).lerp(this._colB.setHex(BRIDGE_MOMENT.sun.color), w * 0.85);
    }
    if (fogColor) {
      fogColor.lerp(this._colB.setHex(BRIDGE_MOMENT.sun.fog), w * BRIDGE_MOMENT.sun.fogMix);
    }
  }

  /**
   * Audio / HUD events from distance crossings.
   * @param {number} dist
   * @param {number} speed m/s
   * @param {boolean} onGround
   * @param {{bridgeJoint?:Function, bridgeTower?:Function}} audio
   */
  events(dist, speed, onGround, audio) {
    const br = this.br;
    if (!br || !audio) return;
    const onDeck = dist >= br.dist0 && dist <= br.dist1;
    if (onDeck && onGround && speed > 8) {
      const k = Math.floor((dist - br.dist0) / BRIDGE_MOMENT.jointM);
      if (this._joint >= 0 && k > this._joint && k - this._joint < 3 && audio.bridgeJoint) {
        audio.bridgeJoint(speed);
      }
      this._joint = k;
    } else {
      this._joint = onDeck ? this._joint : -1;
    }
    const td = this.towerDists;
    const last = this._lastDist;
    if (last != null && dist > last && dist - last < 30 && audio.bridgeTower) {
      for (let i = 0; i < td.length; i++) {
        if (last < td[i] && dist >= td[i]) audio.bridgeTower(speed);
      }
    }
    this._lastDist = dist;
  }

  dispose() {
    if (!this.group) return;
    if (this.group.parent) this.group.parent.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
    this.group = null;
    this.ready = false;
  }
}

/**
 * Get / create the controller for a track (Lakeside only).
 * @param {object} track
 * @param {string} tier
 * @param {{x:number,y:number,z:number}} baseSunDir
 * @returns {LakesideBridgeMoment|null}
 */
export function bridgeMomentFor(track, tier, baseSunDir) {
  if (!track || !track._lakesideBridge) return null;
  if (!track._bridgeMoment || track._bridgeMomentTier !== tier) {
    if (track._bridgeMoment) track._bridgeMoment.dispose();
    track._bridgeMoment = new LakesideBridgeMoment(track, { tier, baseSunDir });
    track._bridgeMomentTier = tier;
  }
  return track._bridgeMoment;
}
