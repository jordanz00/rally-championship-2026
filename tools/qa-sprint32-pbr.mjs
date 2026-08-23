#!/usr/bin/env node
/**
 * qa-sprint32-pbr.mjs — Sprint 32 physically based lighting gate.
 *
 * RUN: node tools/qa-sprint32-pbr.mjs
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
function check(label, ok, detail) {
  if (ok) console.log(`  ok  ${label}`);
  else {
    console.log(`  FAIL  ${label}  —  ${detail}`);
    fail += 1;
  }
}

console.log(`SPRINT 32 PBR LIGHTING GATE  ·  ${new Date().toISOString()}\n`);

const config = read("js/config.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");
const rig = read("js/gfx/lighting-rig.js");
const post = read("js/gfx/postfx.js");
const pbr = read("js/gfx/pbr.js");

check("lighting-rig module", /export function kelvinToColor/.test(rig), "Kelvin sun colour");
check("sky rim follow", /updateRaceLightFollow/.test(rig), "race light follow");
check("tight shadow frustum", /shadowExtentRace/.test(config), "GFX.shadowExtentRace");
check("PMREM far plane", /pmremFar/.test(config), "GFX.pmremFar");
check("stage sunKelvin", /sunKelvin: 5780/.test(config), "desert Kelvin");
check("stage rimInt", /rimInt: 0\.26/.test(config), "desert sky rim");
check("highlight rolloff", /highlightRolloff/.test(config), "VISUAL.highlightRolloff");
check("post composite rolloff", /highlightRolloff/.test(post), "shader uniform");
check("per-kind env tint", /kind === "road"/.test(pbr), "applyEnvMap kinds");
check("game wires rig", /lighting-rig\.js\?v=\d+/.test(game), "import lighting-rig");
check("game sky rim light", /this\._skyRim/.test(game), "_skyRim DirectionalLight");
check("PMREM capture helper", /skyPmremCapture/.test(game), "_bakeSkyEnv uses helper");
const { gameV, ok: cacheOk } = readCacheVersions(main, index);
check("cache bust chain", cacheOk, `v=${gameV}`);
check("config import", /config\.js\?v=\d+/.test(game), "game → config");

console.log(
  `\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Sprint 32 PBR lighting armed"}`
);
process.exit(fail ? 1 : 0);
