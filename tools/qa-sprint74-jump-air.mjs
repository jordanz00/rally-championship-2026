#!/usr/bin/env node
/**
 * Sprint 74 — rigid-body jump air (RAGE / GTA IV-V vehicle, not a canned hop).
 *
 * RUN: node tools/qa-sprint74-jump-air.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCacheVersions } from "./qa-cache-version.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`SPRINT 74 JUMP AIR  ·  ${new Date().toISOString()}\n`);

const jump = read("js/physics/jump.js");
const vehicle = read("js/physics/vehicle.js");
const config = read("js/config.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

check("no Math.random in jump model", !/Math\.random/.test(jump));
check("lipGrain is a function of dist + lateral", /function lipGrain\(dist, lat/.test(jump));
check("launch inherits chassis pitch/roll/line", /launch\(rawVelY, grade, springBoost = 0, body = \{\}\)/.test(jump));
check("air integrates roll inertia", /this\.roll \+= this\.rollRate \* dt/.test(jump));
check("land can bounce instead of glue", /bounce: Math\.min\(2\.8 \* dropMod, bounce\)/.test(jump));
check("vehicle passes takeoff body state", /pitchRate: -\(this\.pitchRate \|\| 0\)/.test(vehicle));
check("air roll is not sprung to zero", /wantRoll = clamp\(this\.jump\.roll/.test(vehicle));
check("graded landings settle residual attitude", /_beginLandSettle\(/.test(vehicle));
check("overdamped land compress spring", /_seedLandCompress\(/.test(vehicle) && /landCompressZeta/.test(config));
check("ribbon clamp still on", /_keepOnRibbon\(/.test(vehicle) && /_clampToRoadDeck\(/.test(vehicle));
check("JUMP.lipGrain exists", /lipGrain:\s*0\.\d+/.test(config));
check("JUMP.landSettleMin exists", /landSettleMin:\s*0\.\d+/.test(config));
check("game imports jump via vehicle.js?v>=110", /vehicle\.js\?v=(\d+)/.test(game) && Number((game.match(/vehicle\.js\?v=(\d+)/) || [])[1]) >= 110);
check("cache-bust chain", cacheOk && Number(gameV) >= 500, `main=${mainV} game=${gameV}`);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "jumps are rigid-body air"}`);
process.exit(fail ? 1 : 0);
