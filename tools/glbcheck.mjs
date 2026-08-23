/**
 * glbcheck — read a GLB's own header the way a loader does.
 *
 * WHO THIS IS FOR: whoever is staring at "the model does not load" with no
 * error message. glTF-Transform will happily report stats for a file that
 * three.js refuses, because they disagree about what is required.
 *
 * WHAT IT DOES: parses the container (magic, version, chunk table) and the JSON
 * chunk, then prints the fields that actually stop a load: extensionsRequired,
 * extensionsUsed, buffer URIs that point outside the file, and image MIME types.
 *
 * USAGE: node tools/glbcheck.mjs assets/delta/integrale.glb [more.glb ...]
 */

import fs from "node:fs";

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"

/** Extensions three.js r160 GLTFLoader can honour. Anything else in
 *  extensionsRequired is a hard load failure. */
const THREE_SUPPORTED = new Set([
  "KHR_draco_mesh_compression",
  "KHR_lights_punctual",
  "KHR_materials_clearcoat",
  "KHR_materials_dispersion",
  "KHR_materials_emissive_strength",
  "KHR_materials_ior",
  "KHR_materials_iridescence",
  "KHR_materials_sheen",
  "KHR_materials_specular",
  "KHR_materials_transmission",
  "KHR_materials_unlit",
  "KHR_materials_volume",
  "KHR_mesh_quantization",
  "KHR_texture_basisu",
  "KHR_texture_transform",
  "EXT_meshopt_compression",
  "EXT_texture_webp",
]);

/**
 * @param {string} file
 */
function check(file) {
  console.log(`\n=== ${file} ===`);
  if (!fs.existsSync(file)) {
    console.log("  MISSING");
    return false;
  }
  const buf = fs.readFileSync(file);
  console.log(`  size            : ${(buf.length / 1048576).toFixed(2)} MB`);

  if (buf.length < 12) {
    console.log("  FAIL: shorter than a GLB header");
    return false;
  }
  const magic = buf.readUInt32LE(0);
  const version = buf.readUInt32LE(4);
  const declared = buf.readUInt32LE(8);
  console.log(`  magic           : ${magic === GLB_MAGIC ? "glTF ok" : `BAD (0x${magic.toString(16)})`}`);
  console.log(`  version         : ${version}${version === 2 ? "" : "  <-- three.js needs 2"}`);
  console.log(
    `  declared length : ${declared}${declared === buf.length ? " (matches file)" : `  <-- FILE IS ${buf.length}, MISMATCH`}`
  );
  if (magic !== GLB_MAGIC) return false;

  // Walk the chunk table.
  let off = 12;
  let json = null;
  let binBytes = 0;
  const chunks = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const start = off + 8;
    const end = start + len;
    if (end > buf.length) {
      console.log(`  FAIL: chunk at ${off} claims ${len} bytes, past end of file`);
      return false;
    }
    if (type === CHUNK_JSON) json = buf.subarray(start, end).toString("utf8");
    if (type === CHUNK_BIN) binBytes = len;
    chunks.push(`${type === CHUNK_JSON ? "JSON" : type === CHUNK_BIN ? "BIN" : `0x${type.toString(16)}`}:${len}`);
    off = end + ((4 - (len % 4)) % 4);
  }
  console.log(`  chunks          : ${chunks.join(", ")}`);

  if (!json) {
    console.log("  FAIL: no JSON chunk");
    return false;
  }
  let doc;
  try {
    doc = JSON.parse(json);
  } catch (err) {
    console.log(`  FAIL: JSON chunk will not parse — ${err.message}`);
    return false;
  }

  const required = doc.extensionsRequired || [];
  const used = doc.extensionsUsed || [];
  console.log(`  extensionsUsed  : ${used.length ? used.join(", ") : "none"}`);
  console.log(`  required        : ${required.length ? required.join(", ") : "none"}`);

  let ok = true;
  for (const ext of required) {
    if (!THREE_SUPPORTED.has(ext)) {
      console.log(`  FAIL: requires "${ext}", which GLTFLoader cannot provide — load throws`);
      ok = false;
    }
  }
  // An extension left in `required` but stripped from every material is the
  // classic post-optimisation break: nothing uses it, yet it still gates load.
  for (const ext of required) {
    if (!used.includes(ext)) {
      console.log(`  WARN: "${ext}" is required but not listed as used`);
    }
  }

  const external = (doc.buffers || []).filter((b) => b.uri && !/^data:/.test(b.uri));
  if (external.length) {
    console.log(`  FAIL: ${external.length} external buffer(s): ${external.map((b) => b.uri).join(", ")}`);
    ok = false;
  }
  console.log(
    `  contents        : ${(doc.meshes || []).length} meshes · ${(doc.materials || []).length} materials · ` +
      `${(doc.images || []).length} images · ${(doc.nodes || []).length} nodes · BIN ${(binBytes / 1048576).toFixed(2)} MB`
  );

  const wheels = (doc.nodes || []).filter((n) => /wheel/i.test(n.name || "")).length;
  console.log(`  wheel nodes     : ${wheels}${wheels >= 4 ? "" : "  <-- fewer than 4, wheels cannot spin"}`);
  console.log(`  RESULT          : ${ok ? "loadable" : "WILL FAIL IN THREE.JS"}`);
  return ok;
}

const files = process.argv.slice(2);
if (!files.length) {
  console.log("usage: node tools/glbcheck.mjs <file.glb> [...]");
  process.exit(2);
}
let allOk = true;
for (const f of files) if (!check(f)) allOk = false;
console.log(`\n${allOk ? "all files loadable" : "at least one file will fail"}\n`);
process.exit(allOk ? 0 : 1);
