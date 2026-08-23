/**
 * glbstats — print the render cost of .glb car assets.
 *
 * WHO THIS IS FOR: anyone judging whether a model fits the frame budget.
 * WHAT IT DOES: reads each GLB's JSON chunk and reports triangles, primitives
 *   (a fair proxy for draw calls), materials, textures, wheel hub nodes, and
 *   which material extensions survive.
 * HOW IT CONNECTS: called by tools/build-car-lods.sh; not loaded by the game.
 *
 * Usage: node tools/glbstats.mjs assets/*&#47;*.glb
 */

import fs from "node:fs";

const WHEEL_HUB = /^wheel/i;

/**
 * @param {string} file
 * @returns {{tris: number, prims: number, mats: number, imgs: number, hubs: number, ext: string[], bytes: number}}
 */
function measure(file) {
  const buf = fs.readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString("utf8", 20, 20 + jsonLen));
  const acc = json.accessors || [];
  let tris = 0;
  let prims = 0;
  for (const mesh of json.meshes || []) {
    for (const p of mesh.primitives || []) {
      prims++;
      if (p.indices != null) tris += acc[p.indices].count / 3;
      else if (p.attributes?.POSITION != null) tris += acc[p.attributes.POSITION].count / 3;
    }
  }
  return {
    tris: Math.round(tris),
    prims,
    mats: (json.materials || []).length,
    imgs: (json.images || []).length,
    hubs: (json.nodes || []).filter((n) => WHEEL_HUB.test(n.name || "")).length,
    ext: json.extensionsUsed || [],
    bytes: buf.length,
  };
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: node tools/glbstats.mjs <file.glb> [...]");
  process.exit(2);
}

const PACK = 15; // player + 14 rivals, the full Sega Rally grid
console.log(
  `${"file".padEnd(30)}${"tris".padStart(8)}${"prims".padStart(7)}${"mats".padStart(6)}${"imgs".padStart(6)}${"hubs".padStart(6)}${"MB".padStart(7)}  extensions`
);
for (const f of files) {
  try {
    const m = measure(f);
    console.log(
      `${f.padEnd(30)}${String(m.tris).padStart(8)}${String(m.prims).padStart(7)}${String(m.mats).padStart(6)}${String(m.imgs).padStart(6)}${String(m.hubs).padStart(6)}${(m.bytes / 1048576).toFixed(2).padStart(7)}  ${m.ext.join(", ") || "none"}`
    );
    if (m.hubs < 4) console.log(`${"".padEnd(30)}  WARNING: ${m.hubs} wheel hub nodes — wheels may not rotate`);
  } catch (err) {
    console.log(`${f.padEnd(30)}  UNREADABLE: ${err.message}`);
  }
}
console.log(
  `\nA rival at ${files.length ? "" : ""}10k tris x 14 = ${(10304 * 14).toLocaleString()} tris for the pack; a full grid of ${PACK} heroes would be ${(44624 * PACK).toLocaleString()}.`
);
