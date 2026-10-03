#!/usr/bin/env node
/**
 * bake-forest-lod1 — true LOD1 for the Poly Haven Forest hero trees.
 *
 * WHO THIS IS FOR: whoever owns Forest frame time. Every hero tree copy inside
 * the fog (~260 m) was drawing the full ~31k-tri LOD0. Cards and coarse alpha
 * meshes were REJECTED because they pop to a different-looking tree. This
 * bakes a same-silhouette, same-UV, same-texture LOD1 at ~35–50 % of the tris
 * so copies past the shadow radius (~50 m) can draw it with no visible change.
 *
 * WHAT IT DOES, per `assets/props/forest_hero_tree_[a-h].glb`:
 *   • Classifies every primitive as woody (trunk / bark / branches) or foliage
 *     (leaves / twigs / needles) with the SAME name + alphaMode rule the
 *     runtime uses in `js/tracks/prop-kit.js` (`heroTreeMatRole`).
 *   • Foliage is NOT edge-collapsed — that shreds the alpha cards. Instead it
 *     drops a deterministic fraction of WHOLE cards (connected triangle
 *     components), never the cards that define the bounding box, never the
 *     large twig strands, and grows the kept cards a touch about their own
 *     centre so the crown keeps its coverage. UVs are untouched.
 *   • Woody primitives go through the meshoptimizer simplifier
 *     (`npx @gltf-transform/cli@4.4.2 simplify`, seam-aware, same tool that
 *     packed the LOD0s). If npx is unavailable (`--no-npx` or failure) the
 *     repo's `vendor/SimplifyModifier.js` is the offline fallback.
 *   • Writes `assets/props/forest_hero_tree_[a-h]_lod1.glb` with the same
 *     mesh/node layout and the same material NAMES + alphaMode, but no
 *     textures: the runtime draws LOD1 with the LOD0 materials, so shipping
 *     the 1k albedo/normal/ARM again would just double the Forest download.
 *
 * VERIFIES: per kind, source tris vs LOD1 tris, UV attribute present, and the
 * LOD1 bounding box within 2 % of the source extents. Exit 1 on any miss.
 *
 * RUN:  node tools/bake-forest-lod1.mjs
 *       node tools/bake-forest-lod1.mjs --only a,h --keep 0.45 --bark 0.4
 *       node tools/bake-forest-lod1.mjs --no-npx          # offline fallback
 *       node tools/bake-forest-lod1.mjs --check           # verify only, no write
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const KINDS = ["a", "b", "c", "d", "e", "f", "g", "h"];
const GLTF_CLI = ["--yes", "@gltf-transform/cli@4.4.2"];

/** Target band for the whole tree (fraction of source triangles). */
const TARGET_MIN = 0.35;
const TARGET_MAX = 0.5;
/** Bounding-box drift allowed, as a fraction of the largest source extent. */
const BBOX_TOL = 0.02;
/** Foliage components above this size are twig strands, not cards — keep whole. */
const STRAND_TRIS = 64;
/** Woody primitives under this size are not worth a simplify pass. */
const MIN_WOODY_TRIS = 300;

const argv = process.argv.slice(2);
/**
 * @param {string} flag
 * @param {string|null} dflt
 * @returns {string|null}
 */
function arg(flag, dflt) {
  const i = argv.indexOf(flag);
  if (i < 0) return dflt;
  const v = argv[i + 1];
  return v == null || v.startsWith("--") ? "1" : v;
}
const OPT = {
  keep: Number(arg("--keep", "0.45")),
  bark: Number(arg("--bark", "0.4")),
  barkError: Number(arg("--bark-error", "0.01")),
  cardScale: Number(arg("--card-scale", "1.18")),
  only: (arg("--only", "") || "").split(",").map((s) => s.trim()).filter(Boolean),
  noNpx: argv.includes("--no-npx"),
  checkOnly: argv.includes("--check"),
};

/* ------------------------------------------------------------------ GLB io */

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/**
 * @param {Buffer} buf
 * @returns {{json:any, bin:Buffer}}
 */
function parseGlb(buf) {
  if (buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error("not a GLB");
  let off = 12;
  let json = null;
  let bin = Buffer.alloc(0);
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const start = off + 8;
    if (type === CHUNK_JSON) json = JSON.parse(buf.subarray(start, start + len).toString("utf8"));
    else if (type === CHUNK_BIN) bin = buf.subarray(start, start + len);
    off = start + len + ((4 - (len % 4)) % 4);
  }
  if (!json) throw new Error("GLB has no JSON chunk");
  return { json, bin };
}

/**
 * Read an accessor into a packed typed array (de-interleaves byteStride).
 * @param {any} json
 * @param {Buffer} bin
 * @param {number} idx
 */
function readAccessor(json, bin, idx) {
  const a = json.accessors[idx];
  const bv = json.bufferViews[a.bufferView];
  const Arr = COMP[a.componentType];
  const n = NCOMP[a.type];
  const base = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0);
  const elem = n * Arr.BYTES_PER_ELEMENT;
  const stride = bv.byteStride || elem;
  const out = new Arr(a.count * n);
  if (stride === elem) {
    out.set(new Arr(bin.buffer.slice(base, base + a.count * elem)));
    return out;
  }
  const dv = new DataView(bin.buffer);
  const get = {
    5126: (o) => dv.getFloat32(o, true),
    5123: (o) => dv.getUint16(o, true),
    5125: (o) => dv.getUint32(o, true),
    5121: (o) => dv.getUint8(o),
    5122: (o) => dv.getInt16(o, true),
    5120: (o) => dv.getInt8(o),
  }[a.componentType];
  for (let i = 0; i < a.count; i++) {
    for (let c = 0; c < n; c++) out[i * n + c] = get(base + i * stride + c * Arr.BYTES_PER_ELEMENT);
  }
  return out;
}

/**
 * @typedef {{pos:Float32Array, nrm:Float32Array|null, uv:Float32Array|null, idx:Uint32Array, material:number, role:"trunk"|"canopy"}} Prim
 * @typedef {{name:string, prims:Prim[]}} MeshRec
 */

/**
 * Serialize meshes back to a GLB. Nodes/scenes/materials are passed in
 * already-stripped; this only lays out the binary.
 * @param {{nodes:any[], scenes:any[], materials:any[], meshes:MeshRec[], generator:string}} doc
 * @returns {Buffer}
 */
function writeGlb(doc) {
  /** @type {Buffer[]} */
  const chunks = [];
  const bufferViews = [];
  const accessors = [];
  let byteLength = 0;
  const pushView = (typed, target) => {
    const b = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = (4 - (b.length % 4)) % 4;
    chunks.push(b);
    if (pad) chunks.push(Buffer.alloc(pad));
    const view = { buffer: 0, byteOffset: byteLength, byteLength: b.length, target };
    byteLength += b.length + pad;
    bufferViews.push(view);
    return bufferViews.length - 1;
  };
  const pushAccessor = (typed, type, componentType, target, withMinMax) => {
    const n = NCOMP[type];
    const acc = { bufferView: pushView(typed, target), componentType, count: typed.length / n, type };
    if (withMinMax) {
      const min = new Array(n).fill(Infinity);
      const max = new Array(n).fill(-Infinity);
      for (let i = 0; i < typed.length; i += n) {
        for (let c = 0; c < n; c++) {
          const v = typed[i + c];
          if (v < min[c]) min[c] = v;
          if (v > max[c]) max[c] = v;
        }
      }
      acc.min = min;
      acc.max = max;
    }
    accessors.push(acc);
    return accessors.length - 1;
  };
  const meshes = doc.meshes.map((m) => ({
    name: m.name,
    primitives: m.prims.map((p) => {
      const attributes = { POSITION: pushAccessor(p.pos, "VEC3", 5126, 34962, true) };
      if (p.nrm) attributes.NORMAL = pushAccessor(p.nrm, "VEC3", 5126, 34962, false);
      if (p.uv) attributes.TEXCOORD_0 = pushAccessor(p.uv, "VEC2", 5126, 34962, false);
      const vcount = p.pos.length / 3;
      const idx = vcount <= 65535 ? Uint16Array.from(p.idx) : p.idx;
      return {
        attributes,
        indices: pushAccessor(idx, "SCALAR", vcount <= 65535 ? 5123 : 5125, 34963, false),
        material: p.material,
        mode: 4,
      };
    }),
  }));
  const json = {
    asset: { version: "2.0", generator: doc.generator },
    scene: 0,
    scenes: doc.scenes,
    nodes: doc.nodes,
    meshes,
    materials: doc.materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
  };
  let jsonBuf = Buffer.from(JSON.stringify(json), "utf8");
  const jpad = (4 - (jsonBuf.length % 4)) % 4;
  if (jpad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jpad, 0x20)]);
  const bin = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonBuf.length, 0);
  jh.writeUInt32LE(CHUNK_JSON, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(CHUNK_BIN, 4);
  return Buffer.concat([header, jh, jsonBuf, bh, bin]);
}

/* --------------------------------------------------------- classification */

/**
 * Mirror of `heroTreeMatRole` in js/tracks/prop-kit.js. Must stay in sync so
 * the LOD1 trunk pairs with the LOD0 trunk material at runtime.
 * @param {string} meshName
 * @param {any} mat glTF material
 * @returns {"trunk"|"canopy"}
 */
function heroTreeMatRole(meshName, mat) {
  const n = `${meshName || ""} ${mat && mat.name ? mat.name : ""}`.toLowerCase();
  if (/leaf|leaves|twig|needle|foliage|canopy/.test(n)) return "canopy";
  if (/trunk|bark/.test(n)) return "trunk";
  if (/branch/.test(n)) return "trunk";
  if (mat && mat.alphaMode && mat.alphaMode !== "OPAQUE") return "canopy";
  return "trunk";
}

/**
 * @param {any} json
 * @param {Buffer} bin
 * @returns {MeshRec[]}
 */
function readMeshes(json, bin) {
  return (json.meshes || []).map((m) => ({
    name: m.name || "",
    prims: (m.primitives || []).map((p) => {
      if (p.mode != null && p.mode !== 4) throw new Error(`non-triangle primitive in ${m.name}`);
      const pos = readAccessor(json, bin, p.attributes.POSITION);
      const idx = p.indices != null
        ? Uint32Array.from(readAccessor(json, bin, p.indices))
        : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
      return {
        pos,
        nrm: p.attributes.NORMAL != null ? readAccessor(json, bin, p.attributes.NORMAL) : null,
        uv: p.attributes.TEXCOORD_0 != null ? readAccessor(json, bin, p.attributes.TEXCOORD_0) : null,
        idx,
        material: p.material,
        role: heroTreeMatRole(m.name, json.materials[p.material]),
      };
    }),
  }));
}

/**
 * Drop unreferenced vertices and renumber the index.
 * @param {Prim} p
 * @returns {Prim}
 */
function compact(p) {
  const vcount = p.pos.length / 3;
  const remap = new Int32Array(vcount).fill(-1);
  let n = 0;
  for (let i = 0; i < p.idx.length; i++) if (remap[p.idx[i]] < 0) remap[p.idx[i]] = n++;
  const pos = new Float32Array(n * 3);
  const nrm = p.nrm ? new Float32Array(n * 3) : null;
  const uv = p.uv ? new Float32Array(n * 2) : null;
  for (let v = 0; v < vcount; v++) {
    const d = remap[v];
    if (d < 0) continue;
    pos[d * 3] = p.pos[v * 3];
    pos[d * 3 + 1] = p.pos[v * 3 + 1];
    pos[d * 3 + 2] = p.pos[v * 3 + 2];
    if (nrm) {
      nrm[d * 3] = p.nrm[v * 3];
      nrm[d * 3 + 1] = p.nrm[v * 3 + 1];
      nrm[d * 3 + 2] = p.nrm[v * 3 + 2];
    }
    if (uv) {
      uv[d * 2] = p.uv[v * 2];
      uv[d * 2 + 1] = p.uv[v * 2 + 1];
    }
  }
  const idx = new Uint32Array(p.idx.length);
  for (let i = 0; i < p.idx.length; i++) idx[i] = remap[p.idx[i]];
  return { pos, nrm, uv, idx, material: p.material, role: p.role };
}

/* ------------------------------------------------------------- foliage LOD */

/**
 * Thin an alpha-card primitive by dropping whole cards.
 *
 * Cards = connected components of the triangle graph. Components are visited
 * in index order and kept on an even stride so the drop is deterministic and
 * spread through the crown, not clumped. Components holding a bounding-box
 * extreme are always kept (silhouette), and strands over STRAND_TRIS are kept
 * whole (dropping one would punch a hole). Kept cards are scaled about their
 * own centre by `cardScale` so the thinner crown keeps its coverage.
 *
 * @param {Prim} p
 * @param {number} keep fraction of droppable cards to keep
 * @param {number} cardScale
 * @returns {Prim}
 */
function thinCards(p, keep, cardScale) {
  const vcount = p.pos.length / 3;
  const parent = new Int32Array(vcount);
  for (let i = 0; i < vcount; i++) parent[i] = i;
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  const triCount = p.idx.length / 3;
  for (let t = 0; t < triCount; t++) {
    union(p.idx[t * 3], p.idx[t * 3 + 1]);
    union(p.idx[t * 3 + 1], p.idx[t * 3 + 2]);
  }
  // Component id per triangle, in first-seen order.
  const rootToComp = new Map();
  const triComp = new Int32Array(triCount);
  /** @type {number[]} tris per component */
  const compTris = [];
  for (let t = 0; t < triCount; t++) {
    const r = find(p.idx[t * 3]);
    let c = rootToComp.get(r);
    if (c == null) {
      c = compTris.length;
      rootToComp.set(r, c);
      compTris.push(0);
    }
    triComp[t] = c;
    compTris[c]++;
  }
  // Protect the six extreme vertices' components — the silhouette.
  const protectedComps = new Set();
  const ext = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  const extV = [-1, -1, -1, -1, -1, -1];
  for (let i = 0; i < p.idx.length; i++) {
    const v = p.idx[i];
    for (let c = 0; c < 3; c++) {
      const x = p.pos[v * 3 + c];
      if (x < ext[c]) {
        ext[c] = x;
        extV[c] = v;
      }
      if (x > ext[3 + c]) {
        ext[3 + c] = x;
        extV[3 + c] = v;
      }
    }
  }
  for (const v of extV) if (v >= 0) protectedComps.add(rootToComp.get(find(v)));

  const keepComp = new Uint8Array(compTris.length);
  let droppable = 0;
  for (let c = 0; c < compTris.length; c++) {
    if (compTris[c] > STRAND_TRIS || protectedComps.has(c)) {
      keepComp[c] = 1;
      continue;
    }
    // Even stride: keep when the running fraction crosses an integer.
    const k = Math.floor((droppable + 1) * keep) > Math.floor(droppable * keep) ? 1 : 0;
    keepComp[c] = k;
    droppable++;
  }

  // Scale kept small cards about their centroid (unique verts per component).
  const pos = Float32Array.from(p.pos);
  if (Math.abs(cardScale - 1) > 1e-4) {
    const sum = new Float64Array(compTris.length * 3);
    const cnt = new Uint32Array(compTris.length);
    const seen = new Uint8Array(vcount);
    for (let t = 0; t < triCount; t++) {
      const c = triComp[t];
      if (!keepComp[c] || compTris[c] > STRAND_TRIS) continue;
      for (let k = 0; k < 3; k++) {
        const v = p.idx[t * 3 + k];
        if (seen[v]) continue;
        seen[v] = 1;
        sum[c * 3] += p.pos[v * 3];
        sum[c * 3 + 1] += p.pos[v * 3 + 1];
        sum[c * 3 + 2] += p.pos[v * 3 + 2];
        cnt[c]++;
      }
    }
    seen.fill(0);
    for (let t = 0; t < triCount; t++) {
      const c = triComp[t];
      if (!keepComp[c] || compTris[c] > STRAND_TRIS || !cnt[c]) continue;
      const cx = sum[c * 3] / cnt[c];
      const cy = sum[c * 3 + 1] / cnt[c];
      const cz = sum[c * 3 + 2] / cnt[c];
      for (let k = 0; k < 3; k++) {
        const v = p.idx[t * 3 + k];
        if (seen[v]) continue;
        seen[v] = 1;
        pos[v * 3] = cx + (p.pos[v * 3] - cx) * cardScale;
        pos[v * 3 + 1] = cy + (p.pos[v * 3 + 1] - cy) * cardScale;
        pos[v * 3 + 2] = cz + (p.pos[v * 3 + 2] - cz) * cardScale;
      }
    }
  }

  let keptTris = 0;
  for (let t = 0; t < triCount; t++) if (keepComp[triComp[t]]) keptTris++;
  const idx = new Uint32Array(keptTris * 3);
  let w = 0;
  for (let t = 0; t < triCount; t++) {
    if (!keepComp[triComp[t]]) continue;
    idx[w++] = p.idx[t * 3];
    idx[w++] = p.idx[t * 3 + 1];
    idx[w++] = p.idx[t * 3 + 2];
  }
  return compact({ pos, nrm: p.nrm, uv: p.uv, idx, material: p.material, role: p.role });
}

/* --------------------------------------------------------------- woody LOD */

/**
 * Simplify woody primitives with gltf-transform (meshoptimizer). All woody
 * prims of one tree go out as one temp GLB, one mesh per prim, and come back
 * matched by mesh name.
 * @param {Prim[]} prims
 * @param {string} tag
 * @returns {Prim[]|null} null when npx is unavailable or fails
 */
function simplifyWoodyNpx(prims, tag) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forest-lod1-"));
  const inFile = path.join(tmpDir, `${tag}-woody.glb`);
  const outFile = path.join(tmpDir, `${tag}-woody-simplified.glb`);
  try {
    fs.writeFileSync(
      inFile,
      writeGlb({
        generator: "bake-forest-lod1 temp",
        scenes: [{ nodes: prims.map((_, i) => i) }],
        nodes: prims.map((_, i) => ({ name: `w${i}`, mesh: i })),
        meshes: prims.map((p, i) => ({ name: `w${i}`, prims: [{ ...p, material: 0 }] })),
        materials: [{ name: "woody" }],
      })
    );
    const r = spawnSync(
      "npx",
      [
        ...GLTF_CLI,
        "simplify",
        inFile,
        outFile,
        "--ratio",
        String(OPT.bark),
        "--error",
        String(OPT.barkError),
        "--vertex-layout",
        "separate",
      ],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
    );
    if (r.status !== 0 || !fs.existsSync(outFile)) {
      console.warn(`  npx gltf-transform failed (${r.status}): ${(r.stderr || r.stdout || "").trim().slice(0, 300)}`);
      return null;
    }
    const { json, bin } = parseGlb(fs.readFileSync(outFile));
    const back = readMeshes(json, bin);
    const byName = new Map(back.map((m) => [m.name, m]));
    return prims.map((p, i) => {
      const m = byName.get(`w${i}`);
      if (!m || !m.prims.length) throw new Error(`simplified mesh w${i} missing from gltf-transform output`);
      const q = m.prims[0];
      return { ...q, material: p.material, role: p.role };
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** @type {Promise<{THREE:any, SimplifyModifier:any}>|null} */
let threeLoad = null;
function loadThree() {
  if (!threeLoad) {
    threeLoad = Promise.all([
      import(pathToFileURL(path.join(ROOT, "vendor/three.module.js")).href),
      import(pathToFileURL(path.join(ROOT, "vendor/SimplifyModifier.js")).href),
    ]).then(([THREE, mod]) => ({ THREE, SimplifyModifier: mod.SimplifyModifier }));
  }
  return threeLoad;
}

/**
 * Offline fallback: three's SimplifyModifier (keeps uv + normal, not seam-aware).
 * @param {Prim} p
 * @returns {Promise<Prim>}
 */
async function simplifyWoodyThree(p) {
  const { THREE, SimplifyModifier } = await loadThree();
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(p.pos), 3));
  if (p.nrm) g.setAttribute("normal", new THREE.BufferAttribute(Float32Array.from(p.nrm), 3));
  if (p.uv) g.setAttribute("uv", new THREE.BufferAttribute(Float32Array.from(p.uv), 2));
  g.setIndex(new THREE.BufferAttribute(Uint32Array.from(p.idx), 1));
  const vcount = p.pos.length / 3;
  // SimplifyModifier takes the number of vertices to REMOVE; it over-delivers
  // on triangles, so remove a gentler share than (1 - ratio).
  const remove = Math.floor(vcount * (1 - OPT.bark) * 0.7);
  const out = new SimplifyModifier().modify(g, remove);
  const pos = out.getAttribute("position");
  const nrm = out.getAttribute("normal");
  const uv = out.getAttribute("uv");
  return {
    pos: Float32Array.from(pos.array),
    nrm: nrm ? Float32Array.from(nrm.array) : null,
    uv: uv ? Float32Array.from(uv.array) : null,
    idx: Uint32Array.from(out.getIndex().array),
    material: p.material,
    role: p.role,
  };
}

/* ------------------------------------------------------------------ driver */

/**
 * @param {MeshRec[]} meshes
 * @returns {{tris:number, canopyTris:number, woodyTris:number, min:number[], max:number[], uv:boolean}}
 */
function stats(meshes) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let tris = 0;
  let canopyTris = 0;
  let woodyTris = 0;
  let uv = true;
  for (const m of meshes) {
    for (const p of m.prims) {
      const t = p.idx.length / 3;
      tris += t;
      if (p.role === "canopy") canopyTris += t;
      else woodyTris += t;
      if (!p.uv) uv = false;
      for (let i = 0; i < p.pos.length; i += 3) {
        for (let c = 0; c < 3; c++) {
          const v = p.pos[i + c];
          if (v < min[c]) min[c] = v;
          if (v > max[c]) max[c] = v;
        }
      }
    }
  }
  return { tris, canopyTris, woodyTris, min, max, uv };
}

/**
 * @param {any} m glTF material
 */
function stripMaterial(m) {
  const out = { name: m.name || "" };
  if (m.alphaMode) out.alphaMode = m.alphaMode;
  if (m.alphaCutoff != null) out.alphaCutoff = m.alphaCutoff;
  if (m.doubleSided) out.doubleSided = true;
  const pbr = m.pbrMetallicRoughness || {};
  out.pbrMetallicRoughness = {};
  if (pbr.baseColorFactor) out.pbrMetallicRoughness.baseColorFactor = pbr.baseColorFactor;
  if (pbr.metallicFactor != null) out.pbrMetallicRoughness.metallicFactor = pbr.metallicFactor;
  if (pbr.roughnessFactor != null) out.pbrMetallicRoughness.roughnessFactor = pbr.roughnessFactor;
  return out;
}

/**
 * @param {any} n glTF node
 */
function stripNode(n) {
  const out = {};
  if (n.name) out.name = n.name;
  if (n.mesh != null) out.mesh = n.mesh;
  if (n.children) out.children = n.children;
  if (n.matrix) out.matrix = n.matrix;
  if (n.translation) out.translation = n.translation;
  if (n.rotation) out.rotation = n.rotation;
  if (n.scale) out.scale = n.scale;
  return out;
}

/**
 * @param {string} kind
 * @returns {Promise<{ok:boolean, line:string}>}
 */
async function bakeKind(kind) {
  const srcRel = `assets/props/forest_hero_tree_${kind}.glb`;
  const dstRel = `assets/props/forest_hero_tree_${kind}_lod1.glb`;
  const src = path.join(ROOT, srcRel);
  const dst = path.join(ROOT, dstRel);
  if (!fs.existsSync(src)) return { ok: false, line: `${kind}: MISSING ${srcRel}` };
  const { json, bin } = parseGlb(fs.readFileSync(src));
  const meshes = readMeshes(json, bin);
  const before = stats(meshes);

  let lodMeshes;
  if (OPT.checkOnly) {
    if (!fs.existsSync(dst)) return { ok: false, line: `${kind}: MISSING ${dstRel}` };
    const l = parseGlb(fs.readFileSync(dst));
    lodMeshes = readMeshes(l.json, l.bin);
  } else {
    /** @type {{mesh:number, prim:number, p:Prim}[]} */
    const woodyJobs = [];
    lodMeshes = meshes.map((m, mi) => ({
      name: m.name,
      prims: m.prims.map((p, pi) => {
        if (p.role === "canopy") return thinCards(p, OPT.keep, OPT.cardScale);
        if (p.idx.length / 3 >= MIN_WOODY_TRIS) woodyJobs.push({ mesh: mi, prim: pi, p });
        return compact(p);
      }),
    }));
    if (woodyJobs.length) {
      let simplified = null;
      if (!OPT.noNpx) simplified = simplifyWoodyNpx(woodyJobs.map((j) => j.p), kind);
      if (!simplified) {
        console.log(`  ${kind}: woody via vendor/SimplifyModifier fallback`);
        simplified = [];
        for (const j of woodyJobs) simplified.push(await simplifyWoodyThree(j.p));
      }
      for (let i = 0; i < woodyJobs.length; i++) {
        lodMeshes[woodyJobs[i].mesh].prims[woodyJobs[i].prim] = compact(simplified[i]);
      }
    }
    const glb = writeGlb({
      generator: "bake-forest-lod1 (Sega_Rally_Clone) — same silhouette / UVs as LOD0, textures live in LOD0 GLB",
      scenes: json.scenes || [{ nodes: [0] }],
      nodes: (json.nodes || []).map(stripNode),
      meshes: lodMeshes,
      materials: (json.materials || []).map(stripMaterial),
    });
    fs.writeFileSync(dst, glb);
  }

  const after = stats(lodMeshes);
  const ratio = after.tris / Math.max(1, before.tris);
  const extent = Math.max(before.max[0] - before.min[0], before.max[1] - before.min[1], before.max[2] - before.min[2]);
  let bboxDrift = 0;
  for (let c = 0; c < 3; c++) {
    bboxDrift = Math.max(bboxDrift, Math.abs(after.min[c] - before.min[c]) / extent, Math.abs(after.max[c] - before.max[c]) / extent);
  }
  const inBand = ratio >= TARGET_MIN && ratio <= TARGET_MAX;
  const ok = inBand && after.uv && bboxDrift <= BBOX_TOL;
  const mb = fs.existsSync(dst) ? (fs.statSync(dst).size / 1e6).toFixed(2) : "?";
  const line =
    `${kind}: ${before.tris} → ${after.tris} tris (${(ratio * 100).toFixed(1)} %)` +
    `  canopy ${before.canopyTris}→${after.canopyTris}  woody ${before.woodyTris}→${after.woodyTris}` +
    `  uv=${after.uv ? "yes" : "NO"}  bbox drift ${(bboxDrift * 100).toFixed(2)} %  ${mb} MB` +
    (ok ? "" : `  <-- FAIL${inBand ? "" : " (ratio band)"}${after.uv ? "" : " (uv)"}${bboxDrift <= BBOX_TOL ? "" : " (bbox)"}`);
  return { ok, line };
}

const kinds = OPT.only.length ? KINDS.filter((k) => OPT.only.includes(k)) : KINDS;
let allOk = true;
console.log(
  `bake-forest-lod1  keep=${OPT.keep} bark=${OPT.bark} barkError=${OPT.barkError} cardScale=${OPT.cardScale}` +
    `${OPT.noNpx ? " (no npx)" : ""}${OPT.checkOnly ? " (check only)" : ""}`
);
for (const k of kinds) {
  const r = await bakeKind(k);
  console.log(r.line);
  if (!r.ok) allOk = false;
}
console.log(allOk ? "LOD1 OK" : "LOD1 FAIL");
process.exit(allOk ? 0 : 1);
