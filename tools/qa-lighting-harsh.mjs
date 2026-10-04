#!/usr/bin/env node
/**
 * qa-lighting-harsh.mjs — Soften white flash / desert glare / forest shafts.
 *
 * Player moment: all four cup stages. Sun still sculpts. Lacquer, tunnel
 * exit, and noon sand do not flash white. Forest canopy is not cave-black.
 *
 * RUN: node --experimental-loader ./tools/qa-strip-query-loader.mjs tools/qa-lighting-harsh.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LIGHTING } from "../js/config.js";
import {
  DAYLIGHT_FLOORS,
  HARSH_PEAKS,
  clampRaceExposure,
  harshEnvLook,
  horizonFogColor,
} from "../js/gfx/lighting-rig.js";
import * as THREE from "../vendor/three.module.js";

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

console.log(`LIGHTING HARSH  ·  ${new Date().toISOString()}\n`);

const rig = read("js/gfx/lighting-rig.js");
const game = read("js/game.js");
const main = read("js/main.js");
const html = read("index.html");
const cfg = read("js/config.js");

check(
  "authored sun seat line is untouched",
  /if \(this\.sun\) this\.sun\.intensity \*= 1 - 0\.22 \* open;/.test(game)
);
check("Forest tunnel headBeam stays 1295", /headBeam: 1295/.test(game));
check("config Forest beam is still the hot authored value", /headBeam: 1850/.test(cfg));
check("ACES filmic path stays", /ACESFilmicToneMapping/.test(rig));
check("Forest woodland fog hex stays", /0x8f937a/.test(rig));

check(
  "Forest shade floor present",
  DAYLIGHT_FLOORS.forest.ambient === 0.2 &&
    DAYLIGHT_FLOORS.forest.fill === 0.32 &&
    DAYLIGHT_FLOORS.forest.hemi === 0.62,
  `amb=${DAYLIGHT_FLOORS.forest.ambient} fill=${DAYLIGHT_FLOORS.forest.fill} hemi=${DAYLIGHT_FLOORS.forest.hemi}`
);
check(
  "Mountain shade floor present",
  DAYLIGHT_FLOORS.mountain.ambient === 0.2 &&
    DAYLIGHT_FLOORS.mountain.fill === 0.32 &&
    DAYLIGHT_FLOORS.mountain.hemi === 0.62
);

check("HARSH_PEAKS desert exposure cap", HARSH_PEAKS.desert.exposureMax <= 0.92 && HARSH_PEAKS.desert.exposureMax >= 0.84);
check("HARSH_PEAKS forest exposure cap", HARSH_PEAKS.forest.exposureMax <= 0.88 && HARSH_PEAKS.forest.exposureMax >= 0.8);
check("HARSH_PEAKS mountain exposure cap", HARSH_PEAKS.mountain.exposureMax <= 0.92 && HARSH_PEAKS.mountain.exposureMax >= 0.84);
check("HARSH_PEAKS lakeside exposure cap", HARSH_PEAKS.lakeside.exposureMax <= 0.92 && HARSH_PEAKS.lakeside.exposureMax >= 0.84);
check("desert fill peak is under the old 0.40 wash", HARSH_PEAKS.desert.fillMax <= 0.38 && HARSH_PEAKS.desert.fillMax >= 0.3);
check("forest hemi floor is not re-blacked", HARSH_PEAKS.forest.hemiMin >= 0.62);

check("clampRaceExposure exported", /export function clampRaceExposure/.test(rig));
check("harshEnvLook exported", /export function harshEnvLook/.test(rig));
check("applyHarshSpecClamp exported", /export function applyHarshSpecClamp/.test(rig));
check("game applies exposure clamp", /clampRaceExposure\(L, t, boost, this\.courseId\)/.test(game));
check("game applies spec clamp", /_applyHarshSpecClamp\(L, t\)/.test(game));
check("desert/mountain/lakeside exposureBoost is unity", /exposureBoost: 1\.0/.test(game));

const desertOpen = clampRaceExposure(LIGHTING.desert, 0, 1.02, "desert");
check(
  "desert noon exposure is under authored 0.97",
  desertOpen <= HARSH_PEAKS.desert.exposureMax + 1e-6 && desertOpen < LIGHTING.desert.exposure,
  `ev=${desertOpen.toFixed(3)} authored=${LIGHTING.desert.exposure}`
);
const desertExit = clampRaceExposure(LIGHTING.desert, 0.2, 1.02, "desert");
check(
  "desert tunnel-exit exposure cannot flash above ceil",
  desertExit <= HARSH_PEAKS.desert.exposureCeil + 1e-6,
  `ev=${desertExit.toFixed(3)}`
);
const forestOpen = clampRaceExposure(LIGHTING.forest, 0, 1, "forest");
check(
  "forest open exposure is under authored 0.90 (shaft pull)",
  forestOpen <= HARSH_PEAKS.forest.exposureMax + 1e-6 && forestOpen < LIGHTING.forest.exposure,
  `ev=${forestOpen.toFixed(3)}`
);
const mountainOpen = clampRaceExposure(LIGHTING.mountain, 0, 1, "mountain");
check(
  "mountain open exposure is under authored 0.96 (no rain strobe)",
  mountainOpen <= HARSH_PEAKS.mountain.exposureMax + 1e-6,
  `ev=${mountainOpen.toFixed(3)}`
);

const desertSpec = harshEnvLook(LIGHTING.desert, 0, "desert");
check(
  "desert open spec/env is pulled on high sun",
  desertSpec.carEnvMax < HARSH_PEAKS.desert.carEnvMax,
  `carEnvMax=${desertSpec.carEnvMax.toFixed(3)}`
);
const forestTunnelSpec = harshEnvLook(LIGHTING.forest, 1, "forest");
check(
  "forest bore does not extra-kill IBL",
  forestTunnelSpec.carEnvMax >= HARSH_PEAKS.forest.carEnvMax - 1e-6
);

const fog = horizonFogColor(LIGHTING.forest, new THREE.Color(), "forest");
check(
  "forest fog stays woodland, not blue",
  fog.b <= fog.g + 0.02 && fog.b <= fog.r + 0.08,
  `rgb=${fog.r.toFixed(2)},${fog.g.toFixed(2)},${fog.b.toFixed(2)}`
);

check("lighting-rig cache-bust v=31+", Number((game.match(/lighting-rig\.js\?v=(\d+)/) || [])[1]) >= 31);
check("boot cache is 991+", Number((main.match(/game\.js\?v=(\d+)/) || [])[1]) >= 991);
check("index boots main.js?v=991+", Number((html.match(/main\.js\?v=(\d+)/) || [])[1]) >= 991);
check("main/index cache match", (main.match(/game\.js\?v=(\d+)/) || [])[1] === (html.match(/main\.js\?v=(\d+)/) || [])[1]);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "harsh peaks clamped, sun line / floors / headBeam held"}`);
process.exit(fail ? 1 : 0);
