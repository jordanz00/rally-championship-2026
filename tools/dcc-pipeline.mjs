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

console.log("DCC ASSET PIPELINE  ·  Sprint 35\n");

const cars = ["celica", "delta", "stratos", "jaguar", "focus", "accord"];
for (const id of cars) {
  const dir = path.join(ASSETS, id);
  check(`${id} folder`, fs.existsSync(dir), dir);
  const hero = fs.readdirSync(dir).find((f) => f.endsWith(".glb") && !f.includes("rival"));
  check(`${id} hero GLB`, !!hero, hero || "missing");
  const rival = path.join(dir, "rival.glb");
  check(`${id} rival LOD`, fs.existsSync(rival), fs.existsSync(rival) ? `${(fs.statSync(rival).size / 1e6).toFixed(1)} MB` : "");
}

const damage = fs.readFileSync(path.join(ROOT, "js/assets/damage.js"), "utf8");
check("damage module", /applyDamageVisuals/.test(damage));
check("damage tiers", /DAMAGE_TIERS/.test(damage) && /accumulateDamage/.test(damage));

const manifest = {
  generated: new Date().toISOString(),
  cars: cars.map((id) => {
    const dir = path.join(ASSETS, id);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".glb")) : [];
    return { id, glbs: files };
  }),
  damageVariants: "runtime shader tiers 0-3 (author damaged.glb per car for mesh swap)",
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
