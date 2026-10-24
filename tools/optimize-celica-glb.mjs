#!/usr/bin/env node
/**
 * Weld + dedup the player Toyota GT4 GLB (topology cleanup, fewer unique verts).
 * Runtime retopo (normals / selective subdiv / UV pin) still lives in celica.js.
 *
 * RUN: node tools/optimize-celica-glb.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(ROOT, "assets/celica/gt4.glb");
const CLI = ["--yes", "@gltf-transform/cli@4.4.2"];

function tris(abs) {
  const buf = fs.readFileSync(abs);
  const jsonLen = buf.readUInt32LE(12);
  const js = JSON.parse(buf.slice(20, 20 + jsonLen).toString("utf8"));
  let t = 0;
  for (const mesh of js.meshes || []) {
    for (const prim of mesh.primitives || []) {
      if (prim.indices != null) t += Math.floor((js.accessors[prim.indices]?.count || 0) / 3);
      else t += Math.floor((js.accessors[prim.attributes.POSITION]?.count || 0) / 3);
    }
  }
  return t;
}

function run(args) {
  const r = spawnSync("npx", [...CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || "gltf-transform failed");
}

if (!fs.existsSync(SRC)) {
  console.error("missing", SRC);
  process.exit(1);
}

const before = tris(SRC);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "celica-opt-"));
const welded = path.join(tmp, "weld.glb");
const out = path.join(tmp, "out.glb");
console.log("weld", path.relative(ROOT, SRC), `· ${before} tris`);
run(["weld", SRC, welded]);
run(["dedup", welded, out]);
fs.copyFileSync(out, SRC);
const after = tris(SRC);
console.log(`done · ${before} → ${after} tris · ${(fs.statSync(SRC).size / 1024 / 1024).toFixed(2)} MB`);
