#!/usr/bin/env node
/**
 * qa-sprint32-desert-finale.mjs — Desert finale underpass clearance gate.
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
const compact = track.replace(/\s+/g, " ");

check("underpass corridor helper", /_inUnderpassCorridor/.test(track), "world XZ corridor");
check("underpass marked pre-mesh", /_markDesertUnderpassCorridors/.test(track), "before land/road");
check("road skirt suppressed", /inUnderpass.*skirtReach/.test(compact), "tunnel-style tuck");
check("land tile underpass clamp", /desert && this\._inUnderpassCorridor/.test(track), "terrain flat");
check("desert rock bridge", /_addDesertRockBridge/.test(track), "finale arch");
check("world underpass prism", /_underpassPrisms/.test(track), "XZ prism under arch");
check("shared portal helper", /_desertBridgePortal/.test(track), "mesh + land use one hole");
check("underpass floor uses bridge Y", /_underpassFloorY/.test(track), "not nearest-road Y");
check("bridge portal refuse", /overlapsPortalX && overlapsPortalZ && overlapsPortalY/.test(compact), "no solid in hole");
check("bridge portal scrub", /_scrubBridgePortalMeshes/.test(track), "drop invading rubble");
check("drive clear corridors", /_markDriveClearCorridors/.test(track), "forest/mountain land wash");
check("bridge clearance headroom", /openH: 11\.2/.test(track), "driveable arch height");
check("bridge portal depth", /clearHalfD: 20/.test(track), "deep enough tunnel");
check("approach placement", /while \(j > 2 && this\.points\[j\]\.surface === "gravel"\) j -= 1/.test(track), "sand→gravel approach");
check("underpass wall faces", /_wallFace\(wx, wz/.test(track), "finale lining matches the mesh");
check("desert drift berms", /_addDesertDriftLandmarks/.test(track), "outside berms");
check("act 6 sweep flag", /radius: 145.*sweep: true/.test(courses.replace(/\s+/g, " ")), "sweeper marked");
check("cache bust track.js", Number((game.match(/track\.js\?v=(\d+)/) || [])[1]) >= 186, "game → track");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);
check("cache-bust chain", cacheOk && Number(gameV) >= 376, `main=${mainV} game=${gameV}`);

console.log(
  `\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Sprint 32 desert finale armed"}`
);
process.exit(fail ? 1 : 0);
