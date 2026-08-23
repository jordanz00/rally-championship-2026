/**
 * glbedit — surgical edits to a .glb container that the gltf-transform CLI
 * does not expose as a command.
 *
 * WHO THIS IS FOR: whoever is preparing car assets in assets/<car>/.
 * WHAT IT DOES: rewrites the JSON chunk of a binary glTF in place-ish (read
 *   one file, write another), leaving the BIN chunk untouched. Two operations:
 *
 *     strip-ext   Remove glTF material extensions we deliberately do not want
 *                 to pay for. KHR_materials_clearcoat and friends promote a
 *                 material to MeshPhysicalMaterial in three.js, which adds
 *                 extra lighting lobes per pixel for a wet sheen that a 1995
 *                 rally game never had (docs/AM3-RESEARCH.md section 5).
 *
 *     anon-nodes  Clear the `name` of every node and mesh EXCEPT wheels. This
 *                 exists so `gltf-transform join --keepNamed` can merge a
 *                 car's body panels into a handful of draw calls while leaving
 *                 the four wheel nodes intact — cars/celica.js locates wheels
 *                 by name (findWheels), so a blind merge stops them spinning.
 *
 * HOW IT CONNECTS: used by the car LOD pipeline; not loaded by the game.
 *
 * Usage:
 *   node tools/glbedit.mjs strip-ext  <in.glb> <out.glb> <Ext,Ext,...>
 *   node tools/glbedit.mjs anon-nodes <in.glb> <out.glb>
 */

import fs from "node:fs";

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"

/** Node/mesh names that must survive `join` so wheels keep rotating. */
const WHEEL_NAME = /wheel|tire|tyre|rim/i;

/**
 * Split a .glb into its header values and chunk list.
 * @param {Buffer} buf
 * @returns {{version: number, chunks: {type: number, data: Buffer}[]}}
 */
function readGlb(buf) {
  if (buf.length < 12 || buf.readUInt32LE(0) !== GLB_MAGIC) {
    throw new Error("not a binary glTF (bad magic)");
  }
  const version = buf.readUInt32LE(4);
  const total = buf.readUInt32LE(8);
  const chunks = [];
  let at = 12;
  while (at + 8 <= Math.min(total, buf.length)) {
    const len = buf.readUInt32LE(at);
    const type = buf.readUInt32LE(at + 4);
    const start = at + 8;
    if (start + len > buf.length) throw new Error("truncated chunk");
    chunks.push({ type, data: buf.subarray(start, start + len) });
    at = start + len + ((4 - (len % 4)) % 4);
  }
  if (!chunks.some((c) => c.type === CHUNK_JSON)) throw new Error("no JSON chunk");
  return { version, chunks };
}

/**
 * Reassemble a .glb, padding each chunk to a 4-byte boundary as the spec
 * requires: JSON pads with spaces, BIN pads with zeroes.
 * @param {number} version
 * @param {{type: number, data: Buffer}[]} chunks
 * @returns {Buffer}
 */
function writeGlb(version, chunks) {
  const parts = [];
  let body = 0;
  for (const c of chunks) {
    const pad = (4 - (c.data.length % 4)) % 4;
    const header = Buffer.alloc(8);
    header.writeUInt32LE(c.data.length + pad, 0);
    header.writeUInt32LE(c.type, 4);
    const filler = Buffer.alloc(pad, c.type === CHUNK_JSON ? 0x20 : 0x00);
    parts.push(header, c.data, filler);
    body += 8 + c.data.length + pad;
  }
  const head = Buffer.alloc(12);
  head.writeUInt32LE(GLB_MAGIC, 0);
  head.writeUInt32LE(version, 4);
  head.writeUInt32LE(12 + body, 8);
  return Buffer.concat([head, ...parts]);
}

/**
 * @param {string} file
 * @returns {{version: number, chunks: {type: number, data: Buffer}[], json: any}}
 */
function open(file) {
  const { version, chunks } = readGlb(fs.readFileSync(file));
  const jsonChunk = chunks.find((c) => c.type === CHUNK_JSON);
  return { version, chunks, json: JSON.parse(jsonChunk.data.toString("utf8")) };
}

/**
 * @param {string} file
 * @param {number} version
 * @param {{type: number, data: Buffer}[]} chunks
 * @param {any} json
 */
function save(file, version, chunks, json) {
  const next = chunks.map((c) =>
    c.type === CHUNK_JSON ? { type: c.type, data: Buffer.from(JSON.stringify(json), "utf8") } : c
  );
  fs.writeFileSync(file, writeGlb(version, next));
}

/**
 * @param {string} inFile
 * @param {string} outFile
 * @param {string[]} names extensions to remove
 */
function stripExt(inFile, outFile, names) {
  const { version, chunks, json } = open(inFile);
  const drop = new Set(names);
  let hits = 0;

  for (const mat of json.materials || []) {
    if (!mat.extensions) continue;
    for (const key of Object.keys(mat.extensions)) {
      if (!drop.has(key)) continue;
      delete mat.extensions[key];
      hits++;
    }
    if (!Object.keys(mat.extensions).length) delete mat.extensions;
  }
  for (const key of ["extensionsUsed", "extensionsRequired"]) {
    if (!Array.isArray(json[key])) continue;
    json[key] = json[key].filter((n) => !drop.has(n));
    if (!json[key].length) delete json[key];
  }

  save(outFile, version, chunks, json);
  console.log(
    `strip-ext  ${inFile} -> ${outFile}\n  removed ${hits} material extension entries: ${names.join(", ")}\n  remaining: ${JSON.stringify(json.extensionsUsed || [])}`
  );
}

/**
 * @param {string} inFile
 * @param {string} outFile
 */
function anonNodes(inFile, outFile) {
  const { version, chunks, json } = open(inFile);
  const nodes = json.nodes || [];
  const meshes = json.meshes || [];

  // Sketchfab exports hang the actual geometry on unnamed `Object_NNN`
  // grandchildren of a `WHEEL_*` hub, e.g.
  //   WHEEL_RR (no mesh) -> RIM_RR (no mesh) -> Object_336 (mesh)
  // so matching names one level deep is not enough: protect the whole subtree
  // of any wheel-named node, or `join` folds the tyres into the bodyshell and
  // findWheels() in cars/celica.js finds nothing to rotate.
  const keep = new Set();
  const markSubtree = (idx) => {
    if (keep.has(idx)) return;
    keep.add(idx);
    for (const c of nodes[idx]?.children || []) markSubtree(c);
  };
  nodes.forEach((n, i) => {
    if (WHEEL_NAME.test(n.name || "")) markSubtree(i);
  });

  let named = 0;
  let cleared = 0;
  const keptMeshes = new Set();
  nodes.forEach((n, i) => {
    if (keep.has(i)) {
      // `join --keepNamed` only spares nodes that HAVE a name, so give the
      // anonymous wheel parts one.
      if (!n.name) {
        n.name = `wheelpart_${i}`;
        named++;
      }
      if (n.mesh != null) keptMeshes.add(n.mesh);
      return;
    }
    if (n.name != null) {
      delete n.name;
      cleared++;
    }
  });

  meshes.forEach((m, i) => {
    if (keptMeshes.has(i)) {
      if (!m.name) m.name = `wheelmesh_${i}`;
      return;
    }
    if (m.name != null) delete m.name;
  });

  save(outFile, version, chunks, json);
  console.log(
    `anon-nodes ${inFile} -> ${outFile}\n  protected ${keep.size} wheel-subtree nodes (${named} newly named, ${keptMeshes.size} meshes), anonymised ${cleared} others`
  );
}

const [op, inFile, outFile, arg] = process.argv.slice(2);
if (!op || !inFile || !outFile) {
  console.error("usage: node tools/glbedit.mjs <strip-ext|anon-nodes> <in.glb> <out.glb> [Ext,Ext]");
  process.exit(2);
}
try {
  if (op === "strip-ext") {
    if (!arg) throw new Error("strip-ext needs a comma-separated extension list");
    stripExt(inFile, outFile, arg.split(",").map((s) => s.trim()).filter(Boolean));
  } else if (op === "anon-nodes") {
    anonNodes(inFile, outFile);
  } else {
    throw new Error(`unknown op "${op}"`);
  }
} catch (err) {
  console.error(`glbedit failed: ${err.message}`);
  process.exit(1);
}
