#!/usr/bin/env node
/**
 * dcc-pipeline.mjs — DCC asset validation + manifest (Sprint 35).
 *
 * RUN: node tools/dcc-pipeline.mjs
 *      node tools/dcc-pipeline.mjs --pace-audit
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AUTHORED_PACE } from "../js/tracks/pace-notes.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ASSETS = path.join(ROOT, "assets");

let fail = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * Cheap GLB JSON peek — mesh counts without gltf-transform.
 * @param {string} filePath
 */
function glbStats(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    if (buf.length < 20 || buf.toString("ascii", 0, 4) !== "glTF") {
      return { bytes: buf.length, meshes: 0, primitives: 0 };
    }
    const jsonLen = buf.readUInt32LE(12);
    const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
    const meshes = json.meshes || [];
    let primitives = 0;
    for (const m of meshes) primitives += (m.primitives || []).length;
    return { bytes: buf.length, meshes: meshes.length, primitives };
  } catch {
    return { bytes: 0, meshes: 0, primitives: 0 };
  }
}

console.log("DCC ASSET PIPELINE  ·  Sprint 35\n");

const required = ["celica", "delta", "stratos"];
const carDirs = fs
  .readdirSync(ASSETS, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((id) => {
    const dir = path.join(ASSETS, id);
    return fs.readdirSync(dir).some((f) => f.endsWith(".glb"));
  });

for (const id of required) {
  const dir = path.join(ASSETS, id);
  check(`${id} folder`, fs.existsSync(dir), dir);
  if (!fs.existsSync(dir)) continue;
  const hero = fs.readdirSync(dir).find((f) => f.endsWith(".glb") && !f.includes("rival") && f !== "damaged.glb");
  check(`${id} hero GLB`, !!hero, hero || "missing");
  const rival = path.join(dir, "rival.glb");
  const rivalOk = fs.existsSync(rival);
  check(`${id} rival LOD`, rivalOk, rivalOk ? `${(fs.statSync(rival).size / 1e6).toFixed(1)} MB` : "");
  const damaged = path.join(dir, "damaged.glb");
  if (fs.existsSync(damaged)) {
    const st = glbStats(damaged);
    check(`${id} damaged.glb`, st.bytes > 64, `${(st.bytes / 1e6).toFixed(2)} MB`);
  } else {
    console.log(`  skip  ${id} damaged.glb — runtime dents until authored`);
  }
}

const damage = fs.readFileSync(path.join(ROOT, "js/assets/damage.js"), "utf8");
check("damage module", /applyDamageVisuals/.test(damage) && /applyImpactDamage/.test(damage));
check("damage tiers", /DAMAGE_TIERS/.test(damage) && /accumulateDamage/.test(damage));
check("directional dents", /rebuildDents/.test(damage) && /MAX_DENTS/.test(damage));

const manifest = {
  generated: new Date().toISOString(),
  cars: carDirs.map((id) => {
    const dir = path.join(ASSETS, id);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".glb"));
    return {
      id,
      glbs: files,
      stats: Object.fromEntries(files.map((f) => [f, glbStats(path.join(dir, f))])),
      damagedGlb: files.includes("damaged.glb"),
    };
  }),
  damageVariants: "runtime directional dents + paint tiers 0-3; optional damaged.glb swap at tier >= 2",
};
const out = path.join(ROOT, "assets/dcc-manifest.json");
fs.writeFileSync(out, JSON.stringify(manifest, null, 2));
check("manifest written", fs.existsSync(out), out);

if (process.argv.includes("--pace-audit")) {
  console.log("\n── Pace-note audit ──");
  for (const [course, notes] of Object.entries(AUTHORED_PACE)) {
    check(`${course} pace notes`, notes.length >= 6, `${notes.length} calls`);
  }
}

console.log(fail ? `\nFAIL  ·  ${fail}` : "\nPASS  ·  DCC pipeline ready");
process.exit(fail ? 1 : 0);
