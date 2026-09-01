#!/usr/bin/env node
/**
 * qa-wheel-spin.mjs — GLB hubs must roll on the tire axle (not tumble on Z).
 *
 * Delta Integrale Wheel_1 had a 1.6 m rim scrap that made detectSpinAxis pick Z.
 *
 * RUN: node tools/qa-wheel-spin.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const celica = fs.readFileSync(path.join(ROOT, "js/cars/celica.js"), "utf8");
const game = fs.readFileSync(path.join(ROOT, "js/game.js"), "utf8");
const main = fs.readFileSync(path.join(ROOT, "js/main.js"), "utf8");
const index = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`WHEEL SPIN AXIS GATE  ·  ${new Date().toISOString()}\n`);

check(
  "sanitize detaches axle scrap descendants",
  /axleScrap/.test(celica) && /Math\.max\(size\.x, size\.y, size\.z\) > 1\.05/.test(celica),
  "must remove >1.05 m meshes under Wheel_* hubs"
);
check(
  "detectSpinAxis skips oversized / scrap meshes",
  /function detectSpinAxis/.test(celica) &&
    /userData\.axleScrap/.test(celica) &&
    /tire\|tyre/i.test(celica),
  "prefer tire mesh AABB"
);
check(
  "canonicalizeWheelKnuckle aligns GLB axle to +X",
  /function canonicalizeWheelKnuckle/.test(celica) &&
    /canonicalizeWheelKnuckle\(rigWheel/.test(celica) &&
    /data\.restQuat = new THREE\.Quaternion\(\)/.test(celica),
  "CAD/GLB hubs must not steer on camber"
);
check(
  "applyWheelPose uses spinAxis + optional spinSign",
  /spinAxis/.test(celica) && /spinSign/.test(celica) && /hub\.rotation\.x = axis === "x"/.test(celica)
);
check(
  "rivals + player share applyWheelPose",
  /applyWheelPose\(this\.mesh\.userData\.wheels/.test(fs.readFileSync(path.join(ROOT, "js/ai.js"), "utf8")) &&
    /applyWheelPose\(this\.playerMesh\.userData\.wheels/.test(game)
);
const celicaV = Number((game.match(/celica\.js\?v=(\d+)/) || [])[1] || 0);
check("celica.js cache-bust ≥146", celicaV >= 146, `v=${celicaV}`);
const gameV = Number((main.match(/game\.js\?v=(\d+)/) || [])[1] || 0);
const indexV = Number((index.match(/main\.js\?v=(\d+)/) || [])[1] || 0);
check("boot cache lockstep", gameV === indexV && gameV >= 559, `main=${indexV} game=${gameV}`);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "wheel spin axis armed"}`);
process.exit(fail ? 1 : 0);
