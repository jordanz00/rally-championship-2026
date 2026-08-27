#!/usr/bin/env node
/**
 * Sprint 95 — first-race load must not pull the whole kit, compile the whole
 * stage, or spawn the grid one rAF per rival.
 *
 * RUN: node tools/qa-sprint95-load.mjs
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

console.log(`SPRINT 95 FAST LOAD  ·  ${new Date().toISOString()}\n`);

const kit = read("js/tracks/prop-kit.js");
const track = read("js/tracks/track.js");
const game = read("js/game.js");
const celica = read("js/cars/celica.js");
const main = read("js/main.js");
const index = read("index.html");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

check("kindsForScenery is exported", /export function kindsForScenery/.test(kit));
check(
  "Desert kit excludes the forest pack",
  /function loadSceneryKit/.test(kit) &&
    /key === "forest" \|\| key === "mountain"/.test(kit) &&
    !/PROP_KINDS\.map/.test(kit)
);
check("idle prefetch caches Desert GLBs without parsing", /prefetchPropKit\(\)/.test(game));
check("idle preparePropKit loads Desert only", /return loadSceneryKit\(scenery \|\| "desert"\)/.test(kit));
check("Track.create awaits the stage scenery kit", /await preparePropKit\(def\.scenery\)/.test(track));
check(
  "terrain / plants yield on a time budget",
  /function createWorkYielder/.test(track) && /createWorkYielder\(10\)/.test(track)
);
check("yield budget does not await a no-op", /const wait = yieldWork\(\);\s*if \(wait\) await wait/.test(track));
check("prepareRivalLods skips 7 MB heroes", /export async function prepareRivalLods/.test(celica));
check(
  "race load parses hero + rival LODs together",
  /prepareHeroCar\(this\.carId\), prepareRivalLods\(\)/.test(game)
);

const begin = game.match(/async _beginRace\(courseId\) \{[\s\S]*?\n  async _startRace/);
check(
  "car pick does not start the full garage",
  !!(begin && !/_warmGarage\(\)/.test(begin[0]))
);
check("championship grid is not one yield per rival", !/Grid \$\{aiIndex\} \/ \$\{n\}/.test(game));
check(
  "settle compiles the start grid, not showAllChunks",
  /PRECOMPILE_BUDGET_MS = 400/.test(game) && !/_precompileStage\(\) \{[\s\S]{0,900}showAllChunks/.test(game)
);
check("first race shadow atlas is 2048", /this\._setShadowMapSize\(2048\)/.test(game));
check(
  "desktop opens on medium quality",
  /startTier: isPhonePlay\(\) \? "low" : "medium"/.test(game)
);
check("game imports track.js?v=191+", Number((game.match(/track\.js\?v=(\d+)/) || [])[1]) >= 191);
check("game imports prop-kit.js?v=20+", Number((game.match(/prop-kit\.js\?v=(\d+)/) || [])[1]) >= 20);
check("game imports celica.js?v=122+", Number((game.match(/celica\.js\?v=(\d+)/) || [])[1]) >= 122);
check("cache-bust chain", cacheOk && Number(gameV) >= 434, `main=${mainV} game=${gameV}`);
check("index loads main.js?v=434+", Number((index.match(/main\.js\?v=(\d+)/) || [])[1]) >= 434);

console.log(
  `\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "first-race load is scenery-scoped and time-budgeted"}`
);
process.exit(fail ? 1 : 0);
