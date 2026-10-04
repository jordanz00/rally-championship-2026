#!/usr/bin/env node
/**
 * qa-lakeside-light.mjs — Lakeside sky / car are not blown out.
 *
 * RUN: node --experimental-loader ./tools/qa-strip-query-loader.mjs tools/qa-lakeside-light.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LIGHTING } from "../js/config.js";
import { HARSH_PEAKS, clampRaceExposure, DAYLIGHT_FLOORS } from "../js/gfx/lighting-rig.js";

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

console.log(`LAKESIDE LIGHT  ·  ${new Date().toISOString()}\n`);

const rig = read("js/gfx/lighting-rig.js");
const sky = read("js/sky.js");
const game = read("js/game.js");
const main = read("js/main.js");
const html = read("index.html");

check(
  "lakeside exposure peak is under 0.82",
  HARSH_PEAKS.lakeside.exposureMax <= 0.82 && HARSH_PEAKS.lakeside.exposureCeil <= 0.84
);
const ev = clampRaceExposure(LIGHTING.lakeside, 0, 1, "lakeside");
check(
  "open lakeside ACES is pulled vs authored 0.94",
  ev <= 0.78 + 1e-6 && ev < LIGHTING.lakeside.exposure,
  `ev=${ev.toFixed(3)}`
);
check(
  "lakeside fill / sun / IBL peaks are pulled",
  HARSH_PEAKS.lakeside.fillMax <= 0.22 &&
    HARSH_PEAKS.lakeside.sunMax <= 1.28 &&
    HARSH_PEAKS.lakeside.carEnvMax <= 0.88 &&
    HARSH_PEAKS.lakeside.worldEnvMax <= 0.56
);
check("lakeside skybox is dimmed", /id === "lakeside"\) tint\.multiplyScalar\(0\.72\)/.test(sky));
check("world env clamp on lakeside", /courseId === "lakeside"/.test(game) && /look\.worldEnvMax/.test(game));
check(
  "authored sun seat line is untouched",
  /if \(this\.sun\) this\.sun\.intensity \*= 1 - 0\.22 \* open;/.test(game)
);
check(
  "Forest / Mountain shade floors held",
  DAYLIGHT_FLOORS.forest.hemi === 0.62 && DAYLIGHT_FLOORS.mountain.fill === 0.32
);
check("lakeside does not re-floor fill to 0.22", !/Math\.max\(lights\.fill\.intensity, 0\.22\)/.test(rig));

const rigV = Number((game.match(/lighting-rig\.js\?v=(\d+)/) || [])[1]);
const skyV = Number((game.match(/sky\.js\?v=(\d+)/) || [])[1]);
const gameV = Number((main.match(/game\.js\?v=(\d+)/) || [])[1]);
const mainV = Number((html.match(/main\.js\?v=(\d+)/) || [])[1]);
check(
  "cache bust lighting + sky + game",
  rigV >= 32 && skyV >= 50 && gameV >= 1020 && mainV === gameV,
  `rig=${rigV} sky=${skyV} game=${gameV} main=${mainV}`
);

if (fail) {
  console.log(`\nFAIL  ${fail}`);
  process.exit(1);
}
console.log("\nPASS  ·  lakeside sky and lacquer stay readable");
process.exit(0);
