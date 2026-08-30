#!/usr/bin/env node
/**
 * qa-pov-roof-clear.mjs — POV must hide cabin roofs, not sit inside them.
 *
 * Cause (Sprint 543): procedural roofs were tagged interior=true only, so
 * tagPovShell skipped them and the raised eye (Sprint 535) clipped the roof
 * underside into the lens.
 *
 * RUN: node tools/qa-pov-roof-clear.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

console.log(`POV ROOF CLEAR  ·  ${new Date().toISOString()}\n`);

const car = read("js/cars/celica.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");

check(
  "loft roofs named 'roof'",
  /roof\.name\s*=\s*["']roof["']/.test(car) && (car.match(/roof\.name\s*=\s*["']roof["']/g) || []).length >= 2,
  "assembleLoftCar + rival shell both name the mesh"
);

check(
  "tagPovShell tags roofs before skipping interiors",
  /Roofs \/ headers block the lens/.test(car) &&
    /\/roof\|headliner/.test(car) &&
    /if \(obj\.userData\.interior\) return;/.test(car),
  "name/geo roof tagging must run before the interior early-out"
);

check(
  "POV hide cache is versioned (rebuild roofs)",
  /POV_HIDE_VER\s*=\s*3/.test(car) && /_povHideVer\s*!==\s*3/.test(car),
  "setCockpitView must invalidate stale hide lists"
);

check(
  "eye clearance under roof ≥ 0.32 m",
  /roof\s*-\s*0\.32/.test(car) && !/roof\s*-\s*0\.12/.test(car),
  "Sprint 535 roof−0.12 put the lens in the headliner"
);

check(
  "look aim stays below the eye",
  /lookY = THREE\.MathUtils\.clamp\([^)]*eyeY\s*-\s*0\.08/.test(car),
  "looking up into the roof recreates the letterbox"
);

check(
  "POV_RIG_VER ≥ 4",
  /POV_RIG_VER\s*=\s*[4-9]/.test(car),
  "seat cache must rebuild after eye/look change"
);

const celicaV = Number((game.match(/celica\.js\?v=(\d+)/) || [])[1]);
const bootV = Number((index.match(/main\.js\?v=(\d+)/) || [])[1]);
const mainGameV = Number((main.match(/game\.js\?v=(\d+)/) || [])[1]);
check("celica.js?v=144+", celicaV >= 144, `got ${celicaV}`);
check("boot ?v=543+", bootV >= 543 && mainGameV >= 543, `index=${bootV} main→game=${mainGameV}`);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "POV roof shell is hideable"}`);
process.exit(fail ? 1 : 0);
