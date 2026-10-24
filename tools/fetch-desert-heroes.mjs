#!/usr/bin/env node
/**
 * Fetch Poly Haven Namaqualand (CC0) desert heroes → pack runtime GLBs.
 *
 * RUN: node tools/fetch-desert-heroes.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(ROOT, "assets/props/hd-src/polyhaven");
const CLI = ["--yes", "@gltf-transform/cli@4.4.2"];
const TARGET_TRIS = 28000;

/** Poly Haven id → runtime kind */
const JOBS = [
  ["namaqualand_boulder_02", "desert_hero_boulder_a"],
  ["namaqualand_boulder_03", "desert_hero_boulder_b"],
  ["namaqualand_boulder_04", "desert_hero_boulder_c"],
  ["namaqualand_boulder_05", "desert_hero_boulder_d"],
  ["namaqualand_boulder_06", "desert_hero_boulder_e"],
  ["namaqualand_rocks_01", "desert_hero_rocks"],
  ["namaqualand_stones_01", "desert_hero_stones"],
  ["sand_rocks_small_01", "desert_hero_sand_rocks"],
  ["quiver_tree_01", "desert_hero_quiver_a"],
  ["quiver_tree_02", "desert_hero_quiver_b"],
  ["wild_rooibos_bush", "desert_hero_scrub"],
  ["othonna_cerarioides", "desert_hero_othonna"],
];

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function download(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest) && fs.statSync(dest).size > 64) {
    console.log("  skip", path.relative(ROOT, dest));
    return;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log("  got", path.relative(ROOT, dest), `${(buf.length / 1024).toFixed(0)} KB`);
}

function run(args) {
  const r = spawnSync("npx", [...CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(`gltf-transform failed:\n${r.stderr || r.stdout}`);
  }
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
      }
    }
  }
  return tris;
}

async function fetchAsset(id) {
  const files = await fetchJson(`https://api.polyhaven.com/files/${id}`);
  const entry = files?.gltf?.["1k"]?.gltf;
  if (!entry?.url) throw new Error(`no 1k gltf for ${id}`);
  const dir = path.join(SRC, id);
  await download(entry.url, path.join(dir, `${id}_1k.gltf`));
  for (const [rel, meta] of Object.entries(entry.include || {})) {
    await download(meta.url, path.join(dir, rel));
  }
  return path.join(dir, `${id}_1k.gltf`);
}

function pack(src, dstRel) {
  const dst = path.join(ROOT, dstRel);
  const tmp = dst.replace(/\.glb$/, ".weld.glb");
  console.log("PACK", path.relative(ROOT, src), "→", dstRel);
  run(["weld", src, tmp]);
  const welded = inspectTris(tmp);
  const ratio = welded > TARGET_TRIS ? Math.max(0.02, TARGET_TRIS / welded) : 1;
  if (ratio < 0.999) {
    console.log(`  weld ${welded} tris → simplify ${ratio.toFixed(3)}`);
    run(["simplify", tmp, dst, "--ratio", String(ratio), "--error", "0.1"]);
    fs.unlinkSync(tmp);
  } else {
    fs.renameSync(tmp, dst);
  }
  console.log(`  → ${inspectTris(dst)} tris · ${(fs.statSync(dst).size / 1024).toFixed(0)} KB`);
}

for (const [id, kind] of JOBS) {
  try {
    console.log("FETCH", id);
    const src = await fetchAsset(id);
    pack(src, `assets/props/${kind}.glb`);
  } catch (err) {
    console.error("FAIL", id, err.message || err);
    process.exitCode = 1;
  }
}

console.log(process.exitCode ? "DONE with errors" : "DONE");
