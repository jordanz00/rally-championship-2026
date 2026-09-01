#!/usr/bin/env node
/**
 * Sprint 89/90 — no teleport after jumps; cars land on the road they are over.
 *
 * Desert jump 3 used to snap progress into the tunnel and plant every car
 * there. A later pass then trapped progress in the pit, so the chassis fell
 * through the climb (pad Y) and popped into the tunnel. Off-road reset also
 * clustered the pack. The rock-bridge flyover filled the underpass.
 *
 * RUN: node tools/qa-sprint89-no-teleport.mjs
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

console.log(`SPRINT 89 NO TELEPORT  ·  ${new Date().toISOString()}\n`);

const vehicle = read("js/physics/vehicle.js");
const collide = read("js/physics/collide.js");
const track = read("js/tracks/track.js");
const courses = read("js/tracks/courses.js");
const game = read("js/game.js");
const ai = read("js/ai.js");
const main = read("js/main.js");
const index = read("index.html");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

const keepFn = vehicle.slice(
  vehicle.indexOf("  _keepOnRibbon(track, q, dt)"),
  vehicle.indexOf("  _ribbonStepMax(dt) {")
);
check(
  "spline snap pins progress instead of restoring XZ",
  /Keep the car where it is/.test(keepFn) &&
    /return this\._pinQuery\(track, q\)/.test(keepFn) &&
    !/_restoreGoodPose/.test(keepFn)
);
check(
  "spline snap allows a climb when XZ is on that ribbon",
  /ridingNew/.test(keepFn) && /q\.jumpKind !== "gap"/.test(keepFn)
);
const guardFn = vehicle.slice(
  vehicle.indexOf("  _guardDrive(track, prevProgress"),
  vehicle.indexOf("  _snapPitchToRoad(axles) {")
);
check(
  "along-track warp rewinds progress only when XZ is not on the new ribbon",
  /Keep the body in world space/.test(guardFn) &&
    /const riding = this\._xzOnRibbon/.test(guardFn) &&
    /this\.progress = prevProgress/.test(guardFn)
);
check(
  "buried / long-air lift Y, they do not plant XZ",
  /_neverFallThrough\(track\)/.test(guardFn) && !/_plantOnRibbon\(track/.test(guardFn),
  "guard lifts Y via axle floor, not ribbon teleport"
);
check(
  "pit query may take the climb, not a distant tunnel",
  /alt\.tunnel && !this\._xzOnRibbon/.test(vehicle) && /padAlong > 180/.test(vehicle)
);
check(
  "stale pit is not a floor or a takeoff",
  /this\._stalePit/.test(vehicle) &&
    /!this\._stalePit && \(pit \|\| kind === "gap"\)/.test(vehicle) &&
    /_solidFloorY/.test(vehicle) &&
    /this\._stalePit \|\| axles\.bothGap/.test(vehicle)
);
check(
  "left-the-hole query is not pinned back onto the pit",
  /Left the visual pit/.test(vehicle) && /_querySolidAtCar/.test(vehicle)
);
check(
  "unstick will not haul toward a distant ribbon",
  /Hauling toward a distant ribbon/.test(vehicle)
);
check(
  "reacquire walks to the road under the car",
  /hint \+ 180/.test(vehicle) && /p\.tunnel && dist > 12/.test(vehicle)
);
check("off-road never assigns line.x", !/v\.position\.x = line\.x/.test(collide));
check(
  "underpass is marked before the flyover pass",
  track.indexOf("_markDesertUnderpassCorridors") < track.indexOf("_separateOverlappingRibbon()")
);
check("flyover does not lift the underpass ribbon", /b\.tunnel \|\| b\.underpass/.test(track));
check("rock-bridge portal is tall enough for a car", /openH:\s*11\.2/.test(track) && /clearHalfW:\s*half \+ 5\.6/.test(track));
check(
  "stale pit query scores by XZ; tunnel only if the car is there",
  /p\.tunnel && d > 12 \* 12/.test(track) && /hintedPit \? 180/.test(track) && /best \+ 80/.test(track)
);
check(
  "Safari throw has a long land pad before the climb",
  /rise: 5\.2, lip: 8, gap: 26, drop: 3\.6, land: 52/.test(courses)
);
check("game + AI import vehicle.js?v=93+", Number((game.match(/vehicle\.js\?v=(\d+)/) || [])[1]) >= 93);
check("AI imports vehicle.js?v=93+", Number((ai.match(/vehicle\.js\?v=(\d+)/) || [])[1]) >= 93);
check("game imports collide.js?v=38+", Number((game.match(/collide\.js\?v=(\d+)/) || [])[1]) >= 38);
check("game imports track.js?v=189+", Number((game.match(/track\.js\?v=(\d+)/) || [])[1]) >= 189);
check("game imports courses.js?v=62+", Number((game.match(/courses\.js\?v=(\d+)/) || [])[1]) >= 62);
check("cache-bust chain", cacheOk && Number(gameV) >= 429, `main=${mainV} game=${gameV}`);

console.log(
  `\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "cars land on the road — no tunnel teleport"}`
);
process.exit(fail ? 1 : 0);
