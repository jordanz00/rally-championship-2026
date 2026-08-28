#!/usr/bin/env node
/** qa-sprint39-perf.mjs — Sprint 39 load speed, rival smoothness, M1 high tier */
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

console.log("SPRINT 39 LOAD + RIVAL SMOOTH + HIGH QUALITY\n");

check("integrated floor ms", /integratedFloorMs/.test(config));
check("perf tier module", /createPerfTier/.test(perf));
check("game perf tier tick", /perfTier/.test(game) && /createPerfTier/.test(game));
check("adapt floor preserved", /adaptFloorMs/.test(config));

check("M1 desktop starts high tier", /function raceStartTier/.test(game) && /return "high"/.test(game));
check("headless QA stays medium tier", /navigator\.webdriver/.test(game) && /return "medium"/.test(game));
check("raceStartTier wired to createPerfTier", /createPerfTier\(GFX, \{ startTier: raceStartTier\(\) \}/.test(game));
check("leave title preloads desert + cup", /_leaveTitle[\s\S]*_scheduleTrackPreload\(this\.courseId \|\| "desert"/.test(game));
check("idle warm parses prop kit early", /preparePropKit\("desert"\)/.test(game));
check("idle warm queues track preload", /_scheduleTrackPreload\("desert", \{ priority: true \}\)/.test(game));
check("course hover priority preload", /pointerenter/.test(game) && /priority:\s*true/.test(game));

check("rival wheelY interpolated in drawPose", /_prevWheelTravel/.test(vehicle) && /wy\[0\] = this\._prevWheelTravel\[0\] \+/.test(vehicle));
check("AI cheap road probe smoothed", /_cheapFilt/.test(vehicle) && /_axleRoadCheap/.test(vehicle));
check("AI lowDetail wheel travel lerps", /lowDetail[\s\S]*travel\[i\] \+= \(targets\[i\] - travel\[i\]\)/.test(vehicle));
check("AI three substeps", /aiSubsteps:\s*3/.test(config));

check("medium cumulus 12 steps", /mediumViewSteps:\s*12/.test(sky));
check("cinema cumulus 16 steps", /cinemaViewSteps:\s*16/.test(sky));

const { gameV, ok: cacheOk } = readCacheVersions(main, index);
check("cache-bust v496", cacheOk && gameV === "496", `v=${gameV}`);

console.log(fail ? `\nFAIL ${fail}` : "\nPASS");
process.exit(fail ? 1 : 0);
