#!/usr/bin/env node
/** qa-sprint39-perf.mjs — Sprint 39 load/rival/M1 + 39–49 realism frame budget */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCacheVersions } from "./qa-cache-version.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fail = 0;
function check(l, ok, d) {
  if (ok) console.log(`  ok  ${l}`);
  else {
    console.log(`  FAIL  ${l} — ${d}`);
    fail++;
  }
}

const config = fs.readFileSync(path.join(ROOT, "js/config.js"), "utf8");
const perf = fs.readFileSync(path.join(ROOT, "js/gfx/perf-tier.js"), "utf8");
const game = fs.readFileSync(path.join(ROOT, "js/game.js"), "utf8");
const vehicle = fs.readFileSync(path.join(ROOT, "js/physics/vehicle.js"), "utf8");
const sky = fs.readFileSync(path.join(ROOT, "js/sky.js"), "utf8");
const main = fs.readFileSync(path.join(ROOT, "js/main.js"), "utf8");
const index = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

console.log("SPRINT 39 LOAD + RIVAL SMOOTH + HIGH QUALITY + FRAME BUDGET\n");

check("integrated floor ms", /integratedFloorMs/.test(config));
check("perf tier module", /createPerfTier/.test(perf));
check("game perf tier tick", /perfTier/.test(game) && /createPerfTier/.test(game));
check("adapt floor preserved", /adaptFloorMs/.test(config));

check(
  "desktop Mac starts medium (shadows+post before countdown)",
  /function raceStartTier/.test(game) && /if \(macDesktop\) return "medium"/.test(game)
);
check("headless QA stays medium tier", /navigator\.webdriver/.test(game) && /return "medium"/.test(game));
check("raceStartTier wired to createPerfTier", /createPerfTier\(GFX, \{ startTier: raceStartTier\(\) \}/.test(game));
check(
  "leave title does not Track.create (keeps menus responsive)",
  /_leaveTitle/.test(game) && !/_leaveTitle[\s\S]{0,800}_scheduleTrackPreload/.test(game)
);
check("idle warm parses prop kit early", /preparePropKit\("desert"\)/.test(game));
check(
  "idle warm skips Track.create until race load",
  /_idleWarmAfterTitle/.test(game) && !/_idleWarmAfterTitle[\s\S]{0,1200}_scheduleTrackPreload/.test(game)
);
check(
  "priority Track preload still used for champ / switch",
  /_scheduleTrackPreload\([^)]*priority:\s*true/.test(game) ||
    /_scheduleTrackPreload\([\s\S]{0,80}priority:\s*true/.test(game)
);

check("rival wheelY interpolated in drawPose", /_prevWheelTravel/.test(vehicle) && /wy\[0\] = this\._prevWheelTravel\[0\] \+/.test(vehicle));
check("AI cheap road probe smoothed", /_cheapFilt/.test(vehicle) && /_axleRoadCheap/.test(vehicle));
check("AI lowDetail wheel travel lerps", /lowDetail[\s\S]*travel\[i\] \+= \(targets\[i\] - travel\[i\]\)/.test(vehicle));
check("AI three substeps", /aiSubsteps:\s*3/.test(config));

check("medium cumulus 12 steps", /mediumViewSteps:\s*12/.test(sky));
check("cinema cumulus 16 steps", /cinemaViewSteps:\s*16/.test(sky));
check(
  "medium race sky uses cinema steps when cinemaRealism",
  /perfTier === "medium"[\s\S]{0,280}?cinemaViewSteps/.test(sky)
);

// Sprint 39–49 realism+perf closeout — cut the Sprint 76/96 ~37 ms fixed floor.
// Sprint 536: further cut so M1 Pro can hold 60 at `min` instead of ~50 judder.
const gfxBlock = (config.match(/export const GFX = \{([\s\S]*?)\n\};/) || [])[1] || "";
const raceShadow = Number((gfxBlock.match(/^\s*shadowMap:\s*(\d+)/m) || [])[1]);
const raceShadowEvery = Number((gfxBlock.match(/^\s*shadowEvery:\s*(\d+)/m) || [])[1]);
const maxPr = Number((gfxBlock.match(/^\s*maxPixelRatio:\s*([\d.]+)/m) || [])[1]);
const maxPx = Number((gfxBlock.match(/^\s*maxPixels:\s*(\d+)/m) || [])[1]);
check("race shadow atlas ≤ 1536", raceShadow > 0 && raceShadow <= 1536, `shadowMap=${raceShadow}`);
check("race shadowEvery ≥ 3", raceShadowEvery >= 3, `shadowEvery=${raceShadowEvery}`);
check("race maxPixelRatio ≤ 1.25", maxPr > 0 && maxPr <= 1.25, `maxPixelRatio=${maxPr}`);
check("race maxPixels ≤ 2.0 M", maxPx > 0 && maxPx <= 2000000, `maxPixels=${maxPx}`);
check("high tier bakes sun every 3rd present", /id: "high"[\s\S]{0,280}?shadowEvery:\s*3/.test(perf));
check("30 fps cadence lock retained", /LOCK30_HOLD/.test(perf) && /lockedHz/.test(perf));
check("lock30 holds ~0.8s (48 presents)", /LOCK30_HOLD = 48/.test(perf));
check("preferLock30 enabled for sharper race budget", /preferLock30:\s*true/.test(config));
check(
  "settle arms forceLock30 when preferLock30",
  /preferLock30[\s\S]*?forceLock30\(/.test(game) || /forceLock30\(\)/.test(game)
);
check(
  "resetCadence keeps lock when preferLock30",
  /resetCadence\(\)[\s\S]*?if \(!gfx\.preferLock30\) lockedHz = 0/.test(perf)
);
check(
  "hard floor at min locks 30 when over budget",
  /index >= ladder\.length - 1[\s\S]*?lockedHz = 30/.test(perf)
);
check("present interval feeds scaler", /perfTier\.tick\(presentDelta\)/.test(game));

const { gameV, ok: cacheOk } = readCacheVersions(main, index);
check("cache-bust ≥548", cacheOk && Number(gameV) >= 548, `v=${gameV}`);

console.log(fail ? `\nFAIL ${fail}` : "\nPASS");
process.exit(fail ? 1 : 0);
