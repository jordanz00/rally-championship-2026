#!/usr/bin/env node
/**
 * qa-fast-load.mjs — prove the stage-load cut path is wired.
 *
 * RUN: node tools/qa-fast-load.mjs
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

console.log(`FAST LOAD  ·  ${new Date().toISOString()}\n`);

const track = read("js/tracks/track.js");
const kit = read("js/tracks/prop-kit.js");
const pbr = read("js/tracks/pbr-stream.js");
const game = read("js/game.js");
const celica = read("js/cars/celica.js");
const hud = read("js/ui/hud.js");
const main = read("js/main.js");
const index = read("index.html");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

check(
  "PBR boots 1k then streams 2k",
  /Always boot 1k for stage load/.test(pbr) || /bootPbrSet/.test(pbr)
);
check(
  "Desert kit critical path is FAST set",
  /DESERT_NATURE_FAST/.test(kit) &&
    /return DESERT_NATURE_FAST\.concat\(FAST_TRACKSIDE\)/.test(kit) &&
    /warmDesertExtras/.test(kit) &&
    /DESERT_DEFERRED/.test(kit)
);
check(
  "Desert animals deferred",
  /DESERT_ANIMALS/.test(kit) &&
    !/animal-zebra/.test(kit.match(/const DESERT_NATURE_FAST = Object\.freeze\(\[[\s\S]*?\]\)/)?.[0] || "")
);
check("kit parses in parallel batches", /const BATCH = phonePropLite\(\) \? 5 : 8/.test(kit));
check(
  "Track.create overlaps kit with terrain",
  /const kitP = preparePropKit\(def\.scenery\)/.test(track) &&
    /await this\._addGroundAsync/.test(track) &&
    /await kitP/.test(track)
);
check(
  "car warm overlaps Track.create",
  /Overlap player car parse with Track\.create/.test(game) &&
    /prepareHeroCar\(this\.carId\)/.test(game) &&
    /await Track\.create/.test(game)
);
check(
  "rival pack does not call ensureRivalGarageReady on load bar",
  !/await ensureRivalGarageReady/.test(game)
);
check("desert plantStep 24", /desert" \? 24 : 10/.test(track));
check(
  "player subdiv one pass for load",
  /SUBDIV_PASSES = 1/.test(celica) && /SUBDIV_TRI_BUDGET = 28000/.test(celica)
);
check(
  "deferred dressing finishes under load overlay",
  /Dressing stage/.test(game) &&
    /await Promise\.all\(\[warmCrowdKit\(\), warmFullTracksideKit\(\), warmDesertExtras\(\)\]\)/.test(game) &&
    /finishDeferredDressing/.test(game) &&
    /_presentFrozenWarms\(4\)/.test(game)
);
check(
  "settle drains before countdown",
  /waitLoadingBarSettled\(20\)/.test(game) &&
    /_drainStreamCompileUnderOverlay\(phoneRace \? 40 : 90\)/.test(game)
);
check(
  "Desert FAST kit drops multi-MB barriers/quiver",
  /desert_hero_stones/.test(kit.match(/const DESERT_NATURE_FAST = Object\.freeze\(\[[\s\S]*?\]\)/)?.[0] || "") &&
    !/desert_hero_quiver_a/.test(kit.match(/const DESERT_NATURE_FAST = Object\.freeze\(\[[\s\S]*?\]\)/)?.[0] || "") &&
    !/barrier_red/.test(kit.match(/const FAST_TRACKSIDE = Object\.freeze\(\[[\s\S]*?\]\)/)?.[0] || "") &&
    !/road_side_barrier/.test(kit.match(/const FAST_TRACKSIDE = Object\.freeze\(\[[\s\S]*?\]\)/)?.[0] || "")
);
check(
  "player hero on load bar; pack heroes after GO",
  /prepareHeroCar\(this\.carId\)/.test(game) &&
    /_warmPackHeroesAfterGo/.test(game) &&
    !/Promise\.all\(\[\s*prepareHeroCar\(this\.carId\)/.test(game)
);
check(
  "deferred dressing includes Desert extras",
  /finishDeferredDressing/.test(track) &&
    /warmDesertExtras\(\)/.test(game) &&
    /warmCrowdKit\(\)/.test(game)
);
check(
  "rival LOD awaited before countdown (not mid 3-2-1)",
  /_rivalLodWarm/.test(game) && /await this\._rivalLodWarm/.test(game)
);
check(
  "pack heroes after GO only",
  /_warmPackHeroesAfterGo/.test(game) && /countGo\(\);\s*\n\s*this\._warmPackHeroesAfterGo\(\)/.test(game)
);
check(
  "championship warms Desert kit on car select",
  /preparePropKit\(scenery\)/.test(game) && !/_scheduleTrackPreload\(warmId/.test(game)
);
check("load bar snaps at Ready", /Math\.exp\(-18 \* dt\)/.test(hud));
check(
  "desktop fast terrain tiles 6@512",
  /terrainTileSegs = Math\.min\(STREAM\.terrainTileSegs \|\| 24, 6\)/.test(game) &&
    /terrainTileSize = Math\.max\(STREAM\.terrainTileSize \|\| 256, 512\)/.test(game)
);
check("load skips land-vert scrub", /_scrubRoadwayVisuals\(\{ skipLand: true \}\)/.test(track));
check("cache-bust chain", cacheOk && Number(gameV) >= 1137, `main=${mainV} game=${gameV}`);
check("index main.js?v=1137+", Number((index.match(/main\.js\?v=(\d+)/) || [])[1]) >= 1137);
check(
  "promote requires race cockpit mesh",
  /_isRaceCockpitMesh/.test(game) &&
    /titleShowroom = true/.test(read("js/cars/celica.js")) &&
    /Never keep the title\/showroom mesh for race/.test(game)
);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "fast-load gates green"}`);
process.exit(fail ? 1 : 0);
