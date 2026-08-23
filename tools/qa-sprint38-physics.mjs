#!/usr/bin/env node
/** qa-sprint38-physics.mjs — Sprint 38 Pacejka surface coeffs + fixed-step */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fail = 0;
function check(l, ok, d) {
  if (ok) console.log(`  ok  ${l}`);
  else { console.log(`  FAIL  ${l} — ${d}`); fail++; }
}

const config = fs.readFileSync(path.join(ROOT, "js/config.js"), "utf8");
const vehicle = fs.readFileSync(path.join(ROOT, "js/physics/vehicle.js"), "utf8");
const game = fs.readFileSync(path.join(ROOT, "js/game.js"), "utf8");

console.log("SPRINT 38 PACEJKA + FIXED-STEP\n");
check("FIXED_DT 60Hz", /FIXED_DT = 1 \/ 60/.test(config));
check("MAX_SUBSTEPS", /MAX_SUBSTEPS = 3/.test(config));
check("phys accumulator", /_physAccum/.test(game) && /while \(this\._physAccum >= FIXED_DT\)/.test(game));
check("pacejka function", /function pacejka/.test(vehicle));
check("surface pacejkaB", /pacejkaB:/.test(config));
check("combinedTire uses surface", /surface\?\.pacejkaB/.test(vehicle));
console.log(fail ? `\nFAIL ${fail}` : "\nPASS");
process.exit(fail ? 1 : 0);
