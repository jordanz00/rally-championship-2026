#!/usr/bin/env node
/**
 * qa-play-lane.mjs — championship roads are wider; tight turns open.
 *
 * Player moment: more paint under the car, hairpins and tight hooks sweep
 * instead of snapping. Desert jump metres stay put.
 *
 * RUN: node --experimental-loader ./tools/qa-strip-query-loader.mjs tools/qa-play-lane.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COURSES } from "../js/tracks/courses.js";
import { compileTrackDefinition } from "../js/tracks/track-definition.js";
import { DESERT_DEFINITION } from "../js/tracks/stages/desert-definition.js";
import { FOREST_DEFINITION } from "../js/tracks/stages/forest-definition.js";
import { MOUNTAIN_DEFINITION } from "../js/tracks/stages/mountain-definition.js";
import { LAKESIDE_DEFINITION } from "../js/tracks/stages/lakeside-definition.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const defSrc = fs.readFileSync(path.join(ROOT, "js/tracks/track-definition.js"), "utf8");
const gameSrc = fs.readFileSync(path.join(ROOT, "js/game.js"), "utf8");
const attractSrc = fs.readFileSync(path.join(ROOT, "js/cinema/attract-reel.js"), "utf8");

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`PLAY LANE  ·  ${new Date().toISOString()}\n`);

const vehSrc = fs.readFileSync(path.join(ROOT, "js/physics/vehicle.js"), "utf8");
check("easePlayCourse lives in the compiler", /easePlayCourse/.test(defSrc) && /PLAY_TIGHT_RADIUS = 1\.4/.test(defSrc));
check("steer holds lock at speed", /maxSteer \* 1\.28/.test(vehSrc) && /kus \*= 0\.55/.test(vehSrc));
check("rack still bites at speed", /lerp\(1\.62, 0\.82/.test(vehSrc) && /lerp\(1\.12, 0\.72/.test(vehSrc));
check("game imports courses.js?v=94+", Number((gameSrc.match(/courses\.js\?v=(\d+)/) || [])[1]) >= 94);
check("attract ribbon is wider", /ROAD_HALF = 7\.4/.test(attractSrc));

const raw = {
  desert: compileTrackDefinition({ ...DESERT_DEFINITION, segments: DESERT_DEFINITION.segments }),
  forest: COURSES.forest,
  mountain: COURSES.mountain,
  lakeside: COURSES.lakeside,
  physlab: COURSES.physlab,
};

check("desert start ≥ 20 m", (COURSES.desert.startWidth || 0) >= 20, String(COURSES.desert.startWidth));
check("forest start ≥ 16 m", (COURSES.forest.startWidth || 0) >= 16, String(COURSES.forest.startWidth));
check("mountain start ≥ 18 m", (COURSES.mountain.startWidth || 0) >= 18, String(COURSES.mountain.startWidth));
check("lakeside start ≥ 12 m", (COURSES.lakeside.startWidth || 0) >= 12, String(COURSES.lakeside.startWidth));
check("physlab start ≥ 16 m", (COURSES.physlab.startWidth || 0) >= 16, String(COURSES.physlab.startWidth));

function minCurveRadius(course) {
  let m = Infinity;
  for (const p of course.pieces || []) {
    if (p.type === "curve" && Number.isFinite(p.radius)) m = Math.min(m, p.radius);
  }
  return m;
}

check("no championship curve under 22 m", minCurveRadius(COURSES.desert) >= 22 && minCurveRadius(COURSES.forest) >= 22 && minCurveRadius(COURSES.mountain) >= 22 && minCurveRadius(COURSES.lakeside) >= 22);
check("forest hairpin still a hairpin", COURSES.forest.pieces.some((p) => p.type === "curve" && Math.abs(p.angle) > 150));
check("every piece has a playable width", ["desert", "forest", "mountain", "lakeside", "physlab"].every((id) => (COURSES[id].pieces || []).every((p) => (p.width || 0) >= 10)));

const desertWide = COURSES.desert;
const desertAuth = DESERT_DEFINITION.startWidth || 17.5;
check(
  "desert is wider than authored",
  desertWide.startWidth > desertAuth + 2,
  `${desertAuth} → ${desertWide.startWidth}`
);

void raw;
console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "wider lanes, opened tight turns"}`);
process.exit(fail ? 1 : 0);
