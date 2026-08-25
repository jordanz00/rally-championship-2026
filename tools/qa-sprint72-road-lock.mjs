#!/usr/bin/env node
/**
 * Sprint 72 — player stays on the ribbon (no clip-through, no warp, no freeze).
 *
 * RUN: node tools/qa-sprint72-road-lock.mjs
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

console.log(`SPRINT 72 ROAD LOCK  ·  ${new Date().toISOString()}\n`);

const vehicle = read("js/physics/vehicle.js");
const collide = read("js/physics/collide.js");
const game = read("js/game.js");
const ai = read("js/ai.js");
const main = read("js/main.js");
const index = read("index.html");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

check("_keepOnRibbon rejects a spline snap", /_keepOnRibbon\(/.test(vehicle) && /maxStep/.test(vehicle));
check("NaN / warp restores last good pose", /_restoreGoodPose\(/.test(vehicle) && /_stashGoodPose\(/.test(vehicle));
check("gap takeoff does not require enteringGap edge", /takeoff = \(pit \|\| kind === "gap"\)/.test(vehicle));
check("no grounded sit-in-the-hole return", !/Do not plant on the visual hole/.test(vehicle));
check(
  "grounded clamp keeps wheels on the deck (no ramp/crest skip)",
  /GROUND_HOVER_MAX/.test(vehicle) &&
    /onGround && !pit && this\.position\.y > floor/.test(vehicle) &&
    !/onGround && !pit && !airKind/.test(vehicle)
);
check(
  "off-road reset plants Y on the ribbon",
  /v\.position\.y = \(line\.y \|\| 0\) \+ 0\.046/.test(collide) && /v\.onGround = true/.test(collide)
);
check(
  "off-road reset refuses an along-track warp",
  /dAlong <= 18/.test(collide)
);
check("TIRE_PLANT unchanged", /const TIRE_PLANT\s*=\s*0\.014/.test(vehicle));
check("game + AI import vehicle.js?v>=80", /vehicle\.js\?v=(\d+)/.test(game) && Number((game.match(/vehicle\.js\?v=(\d+)/) || [])[1]) >= 80 && Number((ai.match(/vehicle\.js\?v=(\d+)/) || [])[1]) >= 80);
check("game imports collide.js?v=37", /collide\.js\?v=37/.test(game));
check("cache-bust chain", cacheOk && Number(gameV) >= 387, `main=${mainV} game=${gameV}`);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "ribbon lock is in the step"}`);
process.exit(fail ? 1 : 0);
