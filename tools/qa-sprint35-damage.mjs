#!/usr/bin/env node
/** qa-sprint35-damage.mjs — Sprint 35 DCC + damage gate */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fail = 0;
function check(l, ok, d) {
  if (ok) console.log(`  ok  ${l}`);
  else { console.log(`  FAIL  ${l} — ${d}`); fail++; }
}

const game = fs.readFileSync(path.join(ROOT, "js/game.js"), "utf8");
const vehicle = fs.readFileSync(path.join(ROOT, "js/physics/vehicle.js"), "utf8");
const damage = fs.readFileSync(path.join(ROOT, "js/assets/damage.js"), "utf8");

console.log("SPRINT 35 DCC + DAMAGE\n");
check("damage module", /applyDamageVisuals/.test(damage));
check("vehicle.damage field", /this\.damage = 0/.test(vehicle));
check("game wires damage", /accumulateDamage/.test(game) && /applyDamageVisuals/.test(game));
const dcc = spawnSync(process.execPath, [path.join(ROOT, "tools/dcc-pipeline.mjs")], { encoding: "utf8" });
check("dcc-pipeline", dcc.status === 0);
console.log(fail ? `\nFAIL ${fail}` : "\nPASS");
process.exit(fail ? 1 : 0);
