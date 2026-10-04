#!/usr/bin/env node
/**
 * qa-replay-trails.mjs — tire marks sit on the road, under the cars.
 *
 * RUN: node tools/qa-replay-trails.mjs
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

console.log(`REPLAY TRAILS  ·  ${new Date().toISOString()}\n`);

const fx = read("js/effects.js");
const game = read("js/game.js");
const main = read("js/main.js");
const html = read("index.html");

check(
  "marks draw after the road, before the cars",
  /this\.mesh\.renderOrder = 1/.test(fx) && !/this\.mesh\.renderOrder = 8/.test(fx)
);

check(
  "marks depth-test and do not write depth",
  /depthWrite: false/.test(fx) && /depthTest: true/.test(fx)
);

check(
  "polygon offset is a road nudge, not a hull punch",
  /polygonOffsetFactor: -3/.test(fx) && !/polygonOffsetFactor: -12/.test(fx)
);

check(
  "vertex z pull is under the car, not in front of it",
  /0\.00035/.test(fx) && !/0\.0015 \* gl_Position\.w/.test(fx)
);

check(
  "replay body sits at renderOrder 3 over the marks",
  /o\.renderOrder = 3/.test(game) && /TireMarks \(renderOrder 1\)/.test(game)
);

check(
  "replay still emits live TireMarks",
  /_emitReplayTrails/.test(game) && /this\.tireMarks\.emit\(this\.player/.test(game)
);

const fxV = Number((game.match(/effects\.js\?v=(\d+)/) || [])[1]);
const gameV = Number((main.match(/game\.js\?v=(\d+)/) || [])[1]);
const mainV = Number((html.match(/main\.js\?v=(\d+)/) || [])[1]);
check(
  "cache bust effects + game + main",
  fxV >= 99 && gameV >= 1019 && mainV === gameV,
  `effects=${fxV} game=${gameV} main=${mainV}`
);

if (fail) {
  console.log(`\nFAIL  ${fail}`);
  process.exit(1);
}
console.log("\nPASS  ·  cars draw over roadway trails");
process.exit(0);
