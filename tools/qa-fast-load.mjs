#!/usr/bin/env node
/**
 * qa-fast-load.mjs — prove the 80% load cut path is wired.
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
const hud = read("js/ui/hud.js");
const main = read("js/main.js");
const index = read("index.html");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

check(
  "PBR boots 1k then streams 2k",
  /Always boot 1k for stage load/.test(pbr) &&
    !/await loadTex\(loader, `\$\{base\}\/\$\{stem\}_diff_2k\.jpg`, true, HI_BOOT_MS\)/.test(pbr)
);
check(
  "Desert kit skips crowd on critical path",
  /return DESERT_NATURE\.concat\(FAST_TRACKSIDE\)/.test(kit) && /export function warmCrowdKit/.test(kit)
);
check("kit parses in wide parallel batches", /const BATCH = phonePropLite\(\) \? 5 : 10/.test(kit));
check(
  "Track.create overlaps kit with terrain",
  /const kitP = preparePropKit\(def\.scenery\)/.test(track) &&
    /await this\._addGroundAsync/.test(track) &&
    /await kitP/.test(track)
);
check("terrain/plant yield budget 48ms", /createWorkYielder\(48\)/.test(track));
check("desert plantStep 4", /plantStep = def\.scenery === "forest" \? 2 : 4/.test(track));
check(
  "settle drains are short",
  /waitLoadingBarSettled\(80\)/.test(game) &&
    /_drainStreamCompileUnderOverlay\(isPhonePlay\(\) \? 40 : 120\)/.test(game)
);
check("crowd warms after Ready", /warmCrowdKit\(\)/.test(game) && /warmFullTracksideKit\(\)/.test(game));
check(
  "championship warms Desert kit on car select",
  /preparePropKit\(scenery\)/.test(game) && !/_scheduleTrackPreload\(warmId/.test(game)
);
check("load bar snaps at Ready", /Math\.exp\(-18 \* dt\)/.test(hud) && /timeoutMs = 120/.test(hud));
check(
  "desktop fast terrain tiles",
  /terrainTileSegs = Math\.min\(STREAM\.terrainTileSegs \|\| 24, 8\)/.test(game) &&
    /terrainTileSize = Math\.max\(STREAM\.terrainTileSize \|\| 256, 384\)/.test(game)
);
check("land pad tightened", /scenery === "desert"\) return 380/.test(track));
check(
  "land tile uses nearest-road grid",
  /One nearest-road sample per tile/.test(track) && /_fastLandBuild/.test(track)
);
check("fast land segment window", /this\._fastLandBuild \? 12 : 28/.test(track));
check(
  "fast load skips heavy desert gallery",
  /Fast land: skip safari/.test(track) && /terrainTileSegs \|\| 24\) > 14/.test(track)
);
check("fast land caps segs at 6", /useSegs = this\._fastLandBuild \? Math\.min\(segs, 6\)/.test(track));
check("fast skirt skips groundHeight", /fastSkirt = \(STREAM\.terrainTileSegs \|\| 24\) <= 14/.test(track));
check("cache-bust chain", cacheOk && Number(gameV) >= 1120, `main=${mainV} game=${gameV}`);
check("index main.js?v=1120+", Number((index.match(/main\.js\?v=(\d+)/) || [])[1]) >= 1119);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "fast-load gates green"}`);
process.exit(fail ? 1 : 0);
