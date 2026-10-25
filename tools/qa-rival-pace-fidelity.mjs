#!/usr/bin/env node
/**
 * Rivals: +50% accel / +50% top speed · near pack hero shells · lacquer fidelity.
 * RUN: node tools/qa-rival-pace-fidelity.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`RIVAL PACE + FIDELITY  ·  ${new Date().toISOString()}\n`);

const cfg = read("js/config.js");
const ai = read("js/ai.js");
const celica = read("js/cars/celica.js");
const livery = read("js/cars/rival-livery.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");

const peakMul = Number((cfg.match(/peakPowerMul:\s*([\d.]+)/) || [])[1] || 0);
const speedMul = Number((cfg.match(/maxSpeedMul:\s*([\d.]+)/) || [])[1] || 0);
const heroN = Number((cfg.match(/heroShellCount:\s*(\d+)/) || [])[1] || 0);

check("rival accel +50% (peakPowerMul ≥ 3.45)", peakMul >= 3.45, `mul=${peakMul}`);
check("rival top speed +50% (maxSpeedMul ≥ 1.5)", speedMul >= 1.5, `mul=${speedMul}`);
check("near pack hero shells", heroN >= 6, `count=${heroN}`);
check("ai applies maxSpeedMul to Vehicle spec", /maxSpeedKmh: Math\.max\(120, \(base\.maxSpeedKmh/.test(ai));
check("ai applies peakPowerMul", /peakPowerKw: Math\.max\(40, \(base\.peakPowerKw/.test(ai));
check("createRivalCar sharpens textures", /sharpenHeroTextures\(root\)/.test(celica) && /useHero/.test(celica));
check("rival lacquer hotter clearcoat", /clearcoatEnvMapIntensity: 2\.85/.test(livery));
check("load warms pack heroes", /GARAGE_CAR_IDS\.filter/.test(game) && /prepareHeroCar\(id\)/.test(game));
check("boot 1141+", Number((index.match(/main\.js\?v=(\d+)/) || [])[1]) >= 1141);
check("game/ai cache", /ai\.js\?v=262/.test(game) && /celica\.js\?v=269/.test(game));
check("main→game 1141", /game\.js\?v=1141/.test(main));

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "rival pace + fidelity armed"}`);
process.exit(fail ? 1 : 0);
