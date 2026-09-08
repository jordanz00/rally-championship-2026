#!/usr/bin/env node
/**
 * Pack Poly Haven 1k tree glTFs into browser GLBs (weld + simplify).
 * No Draco/meshopt — GLTFLoader in this repo has no extra decoders.
 *
 * RUN: node tools/pack-forest-hero-trees.mjs
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = ["--yes", "@gltf-transform/cli@4.4.2"];
const TARGET_TRIS = 32000;

const JOBS = [
  ["assets/props/hd-src/polyhaven/island_tree_01/island_tree_01_1k.gltf", "assets/props/forest_hero_tree_a.glb"],
  ["assets/props/hd-src/polyhaven/island_tree_02/island_tree_02_1k.gltf", "assets/props/forest_hero_tree_b.glb"],
  ["assets/props/hd-src/polyhaven/island_tree_03/island_tree_03_1k.gltf", "assets/props/forest_hero_tree_c.glb"],
  ["assets/props/hd-src/polyhaven/fir_sapling_medium/fir_sapling_medium_1k.gltf", "assets/props/forest_hero_tree_d.glb"],
  ["assets/props/hd-src/polyhaven/tree_small_02/tree_small_02_1k.gltf", "assets/props/forest_hero_tree_e.glb"],
  ["assets/props/hd-src/polyhaven/fir_sapling/fir_sapling_1k.gltf", "assets/props/forest_hero_tree_f.glb"],
  ["assets/props/hd-src/polyhaven/pine_sapling_small/pine_sapling_small_1k.gltf", "assets/props/forest_hero_tree_g.glb"],
  ["assets/props/hd-src/polyhaven/searsia_lucida/searsia_lucida_1k.gltf", "assets/props/forest_hero_tree_h.glb"],
];

function run(args, cwd = ROOT) {
  const r = spawnSync("npx", [...CLI, ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(`gltf-transform ${args[0]} failed:\n${r.stderr || r.stdout}`);
  }
  return r.stdout || "";
}

function inspectTris(abs) {
  const buf = fs.readFileSync(abs);
  if (buf.slice(0, 4).toString() !== "glTF") return 0;
  const jsonLen = buf.readUInt32LE(12);
  const js = JSON.parse(buf.slice(20, 20 + jsonLen).toString("utf8"));
  let tris = 0;
  for (const mesh of js.meshes || []) {
    for (const prim of mesh.primitives || []) {
      if (prim.indices != null) {
        tris += Math.floor((js.accessors[prim.indices]?.count || 0) / 3);
      } else {
        const pos = prim.attributes?.POSITION;
        if (pos != null) tris += Math.floor((js.accessors[pos]?.count || 0) / 3);
      }
    }
  }
  return tris;
}

for (const [srcRel, dstRel] of JOBS) {
  const src = path.join(ROOT, srcRel);
  const dst = path.join(ROOT, dstRel);
  const tmp = dst.replace(/\.glb$/, ".weld.glb");
  if (!fs.existsSync(src)) {
    console.error("MISSING", srcRel);
    process.exitCode = 1;
    continue;
  }
  console.log("PACK", srcRel, "→", dstRel);
  run(["weld", src, tmp]);
  const welded = inspectTris(tmp);
  const ratio = welded > TARGET_TRIS ? Math.max(0.012, TARGET_TRIS / welded) : 1;
  if (ratio < 0.999) {
    console.log(`  weld ${welded} tris → simplify ratio=${ratio.toFixed(4)}`);
    run(["simplify", tmp, dst, "--ratio", String(ratio), "--error", "0.08"]);
    fs.unlinkSync(tmp);
  } else {
    fs.renameSync(tmp, dst);
  }
  const tris = inspectTris(dst);
  const mb = fs.statSync(dst).size / 1e6;
  console.log(`  wrote ${dstRel}  ${tris} tris  ${mb.toFixed(2)} MB`);
  if (mb > 12) console.warn(`  WARN ${dstRel} over 8–12 MB budget`);
}

console.log("DONE");
