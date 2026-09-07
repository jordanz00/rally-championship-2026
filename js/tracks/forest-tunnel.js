/**
 * Forest tunnel — one swept tube + rock-face mouths.
 *
 * WHO THIS IS FOR: Track._addTunnelRun on Stage 2 only.
 * WHAT IT DOES: Builds a watertight inward-facing horseshoe tube along the
 *   authored spline, plus organic PBR rock collars and hero-boulder flanks
 *   at the entrance/exit. Does not own height, collision volumes, or query().
 * HOW IT CONNECTS: track.js Forest branch. Desert/Mountain keep _addTunnelPortal.
 *
 * Interior is one BufferGeometry (inner + outer + end rims). Mouth geology
 * stays outside the drive hole. Land floors stay in Track.
 */

import * as THREE from "../../vendor/three.module.js";

const ASSET_V = "1";
const TEX_BASE = "assets/env/forest";
/** Poly Haven boulder_01 tile size (metres) — unique UVs, not one stretch. */
const TILE_M = 2.0;

let prepared = false;
/** @type {{map:THREE.Texture, normalMap:THREE.Texture|null}|null} */
let rockSet = null;

/**
 * Load Forest tunnel rock maps (Poly Haven boulder_01 1k, CC0).
 * @returns {Promise<void>}
 */
export async function prepareForestTunnelPbr() {
  if (prepared) return;
  prepared = true;
  if (typeof document === "undefined" || typeof Image === "undefined") return;
  const loader = new THREE.TextureLoader();
  const map = await loadTex(loader, `${TEX_BASE}/tunnel_rock_diff_1k.jpg`, true);
  if (!map) return;
  const normalMap = await loadTex(loader, `${TEX_BASE}/tunnel_rock_nor_gl_1k.jpg`, false);
  rockSet = { map, normalMap };
}

/**
 * Shared PBR rock material with unique repeat (cloned per mesh).
 * @param {"bore"|"face"} kind
 * @returns {THREE.MeshStandardMaterial}
 */
export function createForestTunnelMaterial(kind) {
  const bore = kind === "bore";
  const map = rockSet && rockSet.map ? cloneMap(rockSet.map) : null;
  const normalMap = rockSet && rockSet.normalMap ? cloneMap(rockSet.normalMap) : null;
  return new THREE.MeshStandardMaterial({
    color: map ? 0xc8c2b6 : bore ? 0x6a6860 : 0x7a7468,
    map,
    normalMap,
    normalScale: normalMap ? new THREE.Vector2(bore ? 0.7 : 0.95, bore ? 0.7 : 0.95) : undefined,
    roughness: bore ? 0.88 : 0.92,
    metalness: 0.02,
    envMapIntensity: bore ? 0.22 : 0.18,
    side: THREE.FrontSide,
    flatShading: false,
    fog: true,
  });
}

/**
 * Swept horseshoe tube along tunnel spline samples.
 * Open floor (road is the deck). Inner faces look into the cabin.
 *
 * @param {Array<{x:number,y:number,z:number,heading:number,nx:number,nz:number,dist:number,width:number}>} pts
 * @param {number} start
 * @param {number} end
 * @param {{clearHalf:number,openH:number,thick?:number,tileMeters?:number}} spec
 * @returns {THREE.BufferGeometry}
 */
export function buildForestTunnelTubeGeometry(pts, start, end, spec) {
  const clearHalf = spec.clearHalf;
  const openH = spec.openH;
  const thick = spec.thick != null ? spec.thick : 2.45;
  const tile = spec.tileMeters != null ? spec.tileMeters : TILE_M;
  const frames = densifyFrames(pts, start, end);
  const inner = horseshoeProfile(clearHalf, openH, -1.65, 4, 18);
  const outer = offsetProfile(inner, thick);
  return sweepTube(frames, inner, outer, tile);
}

/**
 * Rock-face collar at a mouth — thickened horseshoe whose hole stays
 * outside the cabin, outer silhouette displaced (not a faceted wedge).
 *
 * @param {{clearHalf:number,openH:number}} spec
 * @param {number} depth
 * @returns {THREE.BufferGeometry}
 */
export function buildForestMouthCollarGeometry(spec, depth) {
  const hole = spec.clearHalf + 0.22;
  const openH = spec.openH;
  const thick = Math.max(5.4, hole * 0.72);
  const inner = horseshoeProfile(hole, openH + 0.15, -2.1, 4, 20);
  const outer = offsetProfile(inner, thick);
  displaceProfile(outer, 1.15, 0.55);
  const frames = [
    { x: 0, y: 0, z: 0, heading: 0, nx: 1, nz: 0, dist: 0 },
    { x: 0, y: 0, z: depth, heading: 0, nx: 1, nz: 0, dist: depth },
  ];
  return sweepTube(frames, inner, outer, TILE_M);
}

/**
 * Place hero boulders as organic flanks — never inside the drive hole.
 *
 * @param {{
 *   p:{x:number,y:number,z:number,heading:number,nx:number,nz:number,width:number,dist:number},
 *   outward:number,
 *   clearHalf:number,
 *   openH:number,
 *   groundY:(x:number,z:number)=>number,
 *   inDrive:(x:number,z:number)=>boolean,
 *   chunkOfDist:(d:number)=>number,
 * }} ctx
 * @returns {{a:object[], b:object[]}}
 */
export function forestMouthBoulderPoses(ctx) {
  const { p, outward, clearHalf, groundY, inDrive, chunkOfDist } = ctx;
  const fx = Math.sin(p.heading);
  const fz = Math.cos(p.heading);
  const bags = { a: [], b: [] };
    const spots = [
    [1, 11.6, 2.2, 9.4, "a"],
    [-1, 11.8, 2.6, 8.8, "b"],
    [1, 14.4, 5.4, 11.8, "b"],
    [-1, 14.8, 5.8, 11.2, "a"],
    [1, 12.4, -1.8, 8.6, "a"],
    [-1, 12.6, -2.0, 8.2, "b"],
    [1, 17.2, 8.5, 13.8, "a"],
    [-1, 17.6, 9.0, 13.0, "b"],
  ];
  for (let i = 0; i < spots.length; i++) {
    const side = spots[i][0];
    const lat = spots[i][1];
    const along = spots[i][2];
    const tall = spots[i][3];
    const bag = spots[i][4];
    if (lat < clearHalf + 3.4) continue;
    const x = p.x + p.nx * side * lat + fx * outward * along;
    const z = p.z + p.nz * side * lat + fz * outward * along;
    if (inDrive && inDrive(x, z)) continue;
    const gy = groundY(x, z);
    bags[bag].push({
      c: chunkOfDist(p.dist),
      x,
      y: gy - 0.35,
      z,
      s: 1,
      sy: tall,
      sx: tall * (0.72 + (i % 3) * 0.08),
      sz: tall * (0.78 + (i % 2) * 0.1),
      ry: p.heading + side * 0.18 + i * 0.31,
      rx: side * 0.06,
      rz: -side * 0.05,
    });
  }
  return bags;
}

/**
 * Individual mouth boulders — not InstancedMesh, so lane-strip cannot
 * delete the rock face and giant radii never become road colliders.
 *
 * @param {THREE.Group} group
 * @param {{a:object[],b:object[]}} bags
 * @param {{a:THREE.BufferGeometry|null,b:THREE.BufferGeometry|null}} geos
 * @param {{a:THREE.Material,b:THREE.Material}} mats
 */
export function plantForestMouthBoulders(group, bags, geos, mats) {
  const keys = ["a", "b"];
  for (let k = 0; k < keys.length; k++) {
    const key = keys[k];
    const geo = geos[key];
    const poses = bags[key];
    if (!geo || !poses || !poses.length) continue;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const box = geo.boundingBox;
    const nativeH = Math.max(0.25, box.max.y - box.min.y);
    const mat = mats[key];
    for (let i = 0; i < poses.length; i++) {
      const p = poses[i];
      const mesh = new THREE.Mesh(geo, mat);
      const targetH = p.sy != null ? p.sy : 8;
      mesh.position.set(p.x, p.y, p.z);
      mesh.rotation.set(p.rx || 0, p.ry || 0, p.rz || 0);
      mesh.scale.set(
        (p.sx != null ? p.sx : targetH) / nativeH,
        targetH / nativeH,
        (p.sz != null ? p.sz : targetH) / nativeH
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.tunnelPortal = true;
      mesh.userData.cameraFade = false;
      mesh.userData.forestMouthBoulder = true;
      group.add(mesh);
    }
  }
}

/**
 * @param {THREE.TextureLoader} loader
 * @param {string} url
 * @param {boolean} srgb
 * @returns {Promise<THREE.Texture|null>}
 */
function loadTex(loader, url, srgb) {
  const href = `${url}?v=${ASSET_V}`;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (tex) => {
      if (settled) return;
      settled = true;
      resolve(tex);
    };
    const timer = setTimeout(() => finish(null), 14000);
    loader.load(
      href,
      (tex) => {
        clearTimeout(timer);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = 4;
        tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        tex.needsUpdate = true;
        finish(tex);
      },
      undefined,
      () => {
        clearTimeout(timer);
        finish(null);
      }
    );
  });
}

/**
 * @param {THREE.Texture} tex
 * @returns {THREE.Texture}
 */
function cloneMap(tex) {
  const copy = tex.clone();
  copy.wrapS = THREE.RepeatWrapping;
  copy.wrapT = THREE.RepeatWrapping;
  copy.needsUpdate = true;
  return copy;
}

/**
 * Extra frames on heading kinks so the tube follows the 46 m Forest curve.
 * @param {Array<{x:number,y:number,z:number,heading:number,nx:number,nz:number,dist:number,width:number}>} pts
 * @param {number} start
 * @param {number} end
 */
function densifyFrames(pts, start, end) {
  const frames = [];
  for (let i = start; i <= end; i++) {
    frames.push(pts[i]);
    if (i >= end) continue;
    const p = pts[i];
    const q = pts[i + 1];
    let dh = q.heading - p.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    const steps = Math.abs(dh) > 0.07 ? 2 : Math.abs(dh) > 0.03 ? 1 : 0;
    for (let s = 1; s <= steps; s++) {
      const t = s / (steps + 1);
      let nx = p.nx + (q.nx - p.nx) * t;
      let nz = p.nz + (q.nz - p.nz) * t;
      const nLen = Math.hypot(nx, nz) || 1;
      frames.push({
        x: p.x + (q.x - p.x) * t,
        y: p.y + (q.y - p.y) * t,
        z: p.z + (q.z - p.z) * t,
        heading: p.heading + dh * t,
        nx: nx / nLen,
        nz: nz / nLen,
        dist: p.dist + (q.dist - p.dist) * t,
        width: p.width + (q.width - p.width) * t,
      });
    }
  }
  return frames;
}

/**
 * Open horseshoe in local (right, up). Floor stays open.
 * @param {number} half
 * @param {number} openH
 * @param {number} floorY
 * @param {number} wallSegs
 * @param {number} arcSegs
 * @returns {Array<{x:number,y:number}>}
 */
function horseshoeProfile(half, openH, floorY, wallSegs, arcSegs) {
  const spring = openH * 0.62;
  const out = [];
  for (let i = 0; i <= wallSegs; i++) {
    const t = i / wallSegs;
    out.push({ x: -half, y: floorY + (spring - floorY) * t });
  }
  for (let i = 1; i < arcSegs; i++) {
    const a = Math.PI - (Math.PI * i) / arcSegs;
    out.push({ x: Math.cos(a) * half, y: spring + Math.sin(a) * half });
  }
  for (let i = 0; i <= wallSegs; i++) {
    const t = i / wallSegs;
    out.push({ x: half, y: spring + (floorY - spring) * t });
  }
  return out;
}

/**
 * Offset a profile along its 2D outward normal.
 * @param {Array<{x:number,y:number}>} inner
 * @param {number} thick
 */
function offsetProfile(inner, thick) {
  const n = inner.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = inner[Math.max(0, i - 1)];
    const next = inner[Math.min(n - 1, i + 1)];
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    let nx = -ty / len;
    let ny = tx / len;
    const p = inner[i];
    if (p.x < -0.05 && nx > 0) {
      nx = -nx;
      ny = -ny;
    } else if (p.x > 0.05 && nx < 0) {
      nx = -nx;
      ny = -ny;
    } else if (Math.abs(p.x) <= 0.05 && ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    out.push({ x: p.x + nx * thick, y: p.y + ny * thick });
  }
  return out;
}

/**
 * Organic outer silhouette — never applied to the inner hole.
 * @param {Array<{x:number,y:number}>} prof
 * @param {number} amp
 * @param {number} seed
 */
function displaceProfile(prof, amp, seed) {
  for (let i = 0; i < prof.length; i++) {
    const p = prof[i];
    const w = 0.55 + 0.45 * Math.abs(Math.sin(i * 0.71 + seed * 4.2));
    const jag = Math.sin(p.x * 0.22 + p.y * 0.13 + seed) * amp * w;
    const nLen = Math.hypot(p.x, p.y - 2) || 1;
    p.x += (p.x / nLen) * jag;
    p.y += Math.max(0, (p.y / nLen) * jag * 0.65);
  }
}

/**
 * Sweep inner/outer profiles along frames. Inner winding faces the cabin.
 * @param {Array<{x:number,y:number,z:number,heading:number,nx:number,nz:number,dist:number}>} frames
 * @param {Array<{x:number,y:number}>} inner
 * @param {Array<{x:number,y:number}>} outer
 * @param {number} tile
 */
function sweepTube(frames, inner, outer, tile) {
  const F = frames.length;
  const P = inner.length;
  if (F < 2 || P < 4) return new THREE.BufferGeometry();

  const along = new Float32Array(F);
  along[0] = 0;
  for (let i = 1; i < F; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    along[i] =
      along[i - 1] +
      Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }

  const profLen = new Float32Array(P);
  profLen[0] = 0;
  for (let j = 1; j < P; j++) {
    profLen[j] =
      profLen[j - 1] +
      Math.hypot(inner[j].x - inner[j - 1].x, inner[j].y - inner[j - 1].y);
  }

  const innerCount = F * P;
  const outerCount = F * P;
  const vertCount = innerCount + outerCount;
  const pos = new Float32Array(vertCount * 3);
  const nrm = new Float32Array(vertCount * 3);
  const uv = new Float32Array(vertCount * 2);

  const write = (idx, x, y, z, nx, ny, nz, u, v) => {
    const o = idx * 3;
    pos[o] = x;
    pos[o + 1] = y;
    pos[o + 2] = z;
    nrm[o] = nx;
    nrm[o + 1] = ny;
    nrm[o + 2] = nz;
    uv[idx * 2] = u;
    uv[idx * 2 + 1] = v;
  };

  for (let i = 0; i < F; i++) {
    const f = frames[i];
    const rx = f.nx;
    const rz = f.nz;
    for (let j = 0; j < P; j++) {
      const ip = inner[j];
      const op = outer[j];
      const ix = f.x + rx * ip.x;
      const iy = f.y + ip.y;
      const iz = f.z + rz * ip.x;
      const ox = f.x + rx * op.x;
      const oy = f.y + op.y;
      const oz = f.z + rz * op.x;
      const onx = ox - ix;
      const ony = oy - iy;
      const onz = oz - iz;
      const oLen = Math.hypot(onx, ony, onz) || 1;
      const u = profLen[j] / tile;
      const v = along[i] / tile;
      write(i * P + j, ix, iy, iz, -onx / oLen, -ony / oLen, -onz / oLen, u, v);
      write(innerCount + i * P + j, ox, oy, oz, onx / oLen, ony / oLen, onz / oLen, u, v);
    }
  }

  const quads = (F - 1) * (P - 1) * 2 + (P - 1) * 2;
  const idx = new Uint32Array(quads * 6);
  let t = 0;
  const tri = (a, b, c) => {
    idx[t++] = a;
    idx[t++] = b;
    idx[t++] = c;
  };
  const quad = (a, b, c, d) => {
    tri(a, b, c);
    tri(a, c, d);
  };

  for (let i = 0; i < F - 1; i++) {
    for (let j = 0; j < P - 1; j++) {
      const a = i * P + j;
      const b = i * P + j + 1;
      const c = (i + 1) * P + j + 1;
      const d = (i + 1) * P + j;
      // Inner: winding so the cabin-facing normal stays inward.
      quad(a, d, c, b);
      const oa = innerCount + a;
      const ob = innerCount + b;
      const oc = innerCount + c;
      const od = innerCount + d;
      quad(oa, ob, oc, od);
    }
  }

  // Open-end rims (thickness) — start and finish only.
  for (let j = 0; j < P - 1; j++) {
    const i0 = j;
    const i1 = j + 1;
    const o0 = innerCount + j;
    const o1 = innerCount + j + 1;
    quad(i0, i1, o1, o0);
    const last = (F - 1) * P;
    const li0 = last + j;
    const li1 = last + j + 1;
    const lo0 = innerCount + last + j;
    const lo1 = innerCount + last + j + 1;
    quad(li0, lo0, lo1, li1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  return geo;
}
