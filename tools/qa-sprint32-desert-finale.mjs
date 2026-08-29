#!/usr/bin/env node
/**
 * qa-sprint32-desert-finale.mjs — Desert finale gate (Sprint 524: rock bridge CUT).
 *
 * The floating arch remnant was worse than absence. Prove the player path no
 * longer spawns the bridge or opens an underpass land trench.
 *
 * RUN: node tools/qa-sprint32-desert-finale.mjs
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

console.log(`SPRINT 32 DESERT FINALE GATE  ·  ${new Date().toISOString()}\n`);

const track = read("js/tracks/track.js");
const courses = read("js/tracks/courses.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");

const heroStart = track.indexOf("_addDesertHeroLandmark() {");
const heroSlice = heroStart >= 0 ? track.slice(heroStart, heroStart + 280) : "";
const markStart = track.indexOf("_markDesertUnderpassCorridors() {");
const markSlice = markStart >= 0 ? track.slice(Math.max(0, markStart - 420), markStart + 220) : "";
const bridgeStart = track.indexOf("_addDesertRockBridge(p, rock, rockDark");
const bridgeSlice = bridgeStart >= 0 ? track.slice(bridgeStart, bridgeStart + 380) : "";

check(
  "desert hero landmark does not spawn bridge",
  /Intentionally empty/.test(heroSlice) && !/this\._addDesertRockBridge\(/.test(heroSlice),
  "hero must not call _addDesertRockBridge"
);
check(
  "desert rock bridge builder is a no-op stub",
  /Cut from player path/.test(bridgeSlice) && !/this\.group\.add\(g\)/.test(bridgeSlice),
  "stub must not add a desertBridge group"
);
check(
  "underpass corridors not marked for missing arch",
  /CUT \(Sprint 524\)/.test(markSlice) &&
    !/pt\.underpass = true/.test(markSlice) &&
    !/_underpassRuns\.push/.test(markSlice),
  "no underpass trench for a removed bridge"
);
check("underpass helpers still loadable", /_inUnderpassCorridor/.test(track) && /_underpassFloorY/.test(track), "keep scrub APIs");
check("desert drift berms", /_addDesertDriftLandmarks/.test(track), "outside berms");
check("act 6 sweep flag", /radius: 145.*sweep: true/.test(courses.replace(/\s+/g, " ")), "sweeper marked");
check("cache bust track.js", Number((game.match(/track\.js\?v=(\d+)/) || [])[1]) >= 232, "game → track");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);
check("cache-bust chain", cacheOk && Number(gameV) >= 524, `main=${mainV} game=${gameV}`);

console.log(
  `\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Desert finale rock bridge cut"}`
);
process.exit(fail ? 1 : 0);
