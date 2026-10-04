#!/usr/bin/env node
/**
 * qa-replay-rain.mjs — Stage 3 / Mountain rain stays on during broadcast replay.
 *
 * RUN: node tools/qa-replay-rain.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
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

console.log(`REPLAY RAIN  ·  ${new Date().toISOString()}\n`);

const game = read("js/game.js");
const rain = read("js/weather/rain.js");
const main = read("js/main.js");
const html = read("index.html");

const startFn = (game.match(/_startBroadcastReplay\(\) \{[\s\S]*?\n  \}/) || [])[0] || "";

check(
  "Mountain is the rain cup stage",
  /courseId === "mountain"/.test(rain) && /function courseWantsRain/.test(rain)
);

check(
  "replay keeps weather on for the rain stage",
  /courseWantsRain\(this\.courseId\)/.test(startFn) &&
    /weather\.setActive\(true/.test(startFn) &&
    /weather\.relocate\(this\.camera\)/.test(startFn)
);

check(
  "replay does not dry the car",
  !/dryCar/.test(startFn)
);

check(
  "result / broadcast present as chase rain",
  /broadcasting = !!\(this\.broadcast \|\| this\.state === "result"\)/.test(game) &&
    /broadcast: broadcasting/.test(game) &&
    /!broadcasting &&/.test(game)
);

check(
  "cuts relocate the shower to the new lens",
  /_onBroadcastCut\([\s\S]*?weather\.relocate\(this\.camera\)/.test(game)
);

check(
  "rain.relocate snaps streaks around the camera",
  /relocate\(camera\)/.test(rain) &&
    /_respawnLayer\(this\.near/.test(rain) &&
    /_respawnLayer\(this\.far/.test(rain)
);

check(
  "POV flag cannot hide world rain on a broadcast lens",
  /!!opts\.pov && !opts\.broadcast/.test(rain)
);

check(
  "camera jumps auto-relocate the volume",
  /distanceToSquared\(this\._lastCam\) > 1600/.test(rain)
);

const rainV = Number((game.match(/rain\.js\?v=(\d+)/) || [])[1]);
const gameV = Number((main.match(/game\.js\?v=(\d+)/) || [])[1]);
const mainV = Number((html.match(/main\.js\?v=(\d+)/) || [])[1]);
check(
  "cache bust rain + game + main",
  rainV >= 29 && gameV >= 1018 && mainV === gameV,
  `rain=${rainV} game=${gameV} main=${mainV}`
);

if (fail) {
  console.log(`\nFAIL  ${fail}`);
  process.exit(1);
}
console.log("\nPASS  ·  Stage 3 replay keeps the rain");
process.exit(0);
