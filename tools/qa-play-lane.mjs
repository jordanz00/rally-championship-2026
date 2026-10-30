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
check("easePlayCourse lives in the compiler", /easePlayCourse/.test(defSrc) && (() => { const v = Number((defSrc.match(/PLAY_TIGHT_RADIUS = (\d+(?:\.\d+)?)/) || [])[1]); return v >= 1.4 && v <= 1.9; })());
check("speed lane opens after Desert Safari", /PLAY_SPEED_TIGHT/.test(defSrc) && /afterSafari/.test(defSrc));
check("steer holds lock at speed", /maxSteer \* 1\.\d+/.test(vehSrc) && /kus \*= 0\.\d+/.test(vehSrc));
check("rack still bites at speed", /lerp\(1\.\d+, 0\.\d+/.test(vehSrc));
check("game imports courses.js?v=94+", Number((gameSrc.match(/courses\.js\?v=(\d+)/) || [])[1]) >= 94);
check("attract ribbon is wider", Number((attractSrc.match(/courses\.js\?v=(\d+)/) || [])[1]) >= 100 || /ROAD_HALF\s*=\s*[7-9]/.test(attractSrc));

const raw = {
  desert: compileTrackDefinition({ ...DESERT_DEFINITION, segments: DESERT_DEFINITION.segments }),
  forest: COURSES.forest,
  mountain: COURSES.mountain,
  lakeside: COURSES.lakeside,
  physlab: COURSES.physlab,
};

check("desert start ≥ 24 m", (COURSES.desert.startWidth || 0) >= 24, String(COURSES.desert.startWidth));
check("forest start ≥ 16 m", (COURSES.forest.startWidth || 0) >= 16, String(COURSES.forest.startWidth));
check("mountain start ≥ 22 m", (COURSES.mountain.startWidth || 0) >= 22, String(COURSES.mountain.startWidth));
check("lakeside start ≥ 20 m", (COURSES.lakeside.startWidth || 0) >= 20, String(COURSES.lakeside.startWidth));
check("physlab start ≥ 16 m", (COURSES.physlab.startWidth || 0) >= 16, String(COURSES.physlab.startWidth));

function minCurveRadius(course) {
  let m = Infinity;
  for (const p of course.pieces || []) {
    if (p.type === "curve" && Number.isFinite(p.radius)) m = Math.min(m, p.radius);
  }
  return m;
}

check("no championship curve under 22 m", minCurveRadius(COURSES.desert) >= 22 && minCurveRadius(COURSES.forest) >= 22 && minCurveRadius(COURSES.mountain) >= 22 && minCurveRadius(COURSES.lakeside) >= 22);
// Compiler chunks long arcs into short pieces, so sum consecutive same-sign hairpin chunks.
function hairpinSweeps(pieces) {
  const out = [];
  let run = 0;
  let sign = 0;
  let minR = 999;
  const flush = () => { if (run) out.push({ deg: Math.abs(run), minR }); run = 0; sign = 0; minR = 999; };
  for (const p of pieces) {
    const tagged = /hairpin/i.test(p.purpose || p.visual || p.kind || "");
    if (p.type !== "curve" || !tagged) { flush(); continue; }
    const s = Math.sign(p.angle);
    if (sign && s !== sign) flush();
    sign = s;
    run += p.angle;
    minR = Math.min(minR, p.radius || 99);
  }
  flush();
  return out;
}
const forestPins = hairpinSweeps(COURSES.forest.pieces);
check(
  "forest hairpin still a hairpin",
  forestPins.filter((h) => h.deg >= 80 && h.minR < 100).length >= 2,
  forestPins.map((h) => `${h.deg.toFixed(0)}deg r${h.minR.toFixed(0)}`).join(", ")
);
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
