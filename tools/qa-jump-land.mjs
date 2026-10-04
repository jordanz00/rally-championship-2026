#!/usr/bin/env node
/**
 * qa-jump-land.mjs — takeoff → hang → landing is one continuous ribbon.
 *
 * Player moment: Safari jump. Climb the lip, fly the hole, kiss the pad,
 * and roll onto the next straight without a thud or a rising kink.
 *
 * RUN: node --experimental-loader ./tools/qa-strip-query-loader.mjs tools/qa-jump-land.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COURSES } from "../js/tracks/courses.js";
import { Track } from "../js/tracks/track.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const trackSrc = fs.readFileSync(path.join(ROOT, "js/tracks/track.js"), "utf8");
const vehSrc = fs.readFileSync(path.join(ROOT, "js/physics/vehicle.js"), "utf8");
const gameSrc = fs.readFileSync(path.join(ROOT, "js/game.js"), "utf8");
const mainSrc = fs.readFileSync(path.join(ROOT, "js/main.js"), "utf8");

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`JUMP LAND SEAM  ·  ${new Date().toISOString()}\n`);
console.log("static");

check(
  "game imports track.js?v=425+",
  Number((gameSrc.match(/track\.js\?v=(\d+)/) || [])[1]) >= 425,
  "stale cache would keep the landing kink"
);
check(
  "game imports vehicle.js?v=185+",
  Number((gameSrc.match(/vehicle\.js\?v=(\d+)/) || [])[1]) >= 185
);
check(
  "main imports game.js?v=1014+",
  Number((mainSrc.match(/game\.js\?v=(\d+)/) || [])[1]) >= 1014
);
check(
  "land pad ease-in-out",
  /easeInOutSine/.test(trackSrc) && /easeRampLip/.test(trackSrc),
  "ramp holds a constant lip; land exits flat"
);
check("land-exit blender", /_smoothJumpLandExits/.test(trackSrc));
check(
  "deck follow on landLock",
  /snapRate/.test(vehSrc) && /landing thud/.test(vehSrc),
  "hard plantDeck assign was the thud"
);
check(
  "overdamped land spring",
  /landCompressZeta = 0\.97/.test(vehSrc) && /springFraction = 0\.09/.test(vehSrc)
);

console.log("\nlive desert spline");

const def = COURSES.desert;
const track = new Track(def, { deferBuild: true });
track._buildSpline(def.pieces, def);
const pts = track.points;

const lands = pts.filter((p) => p.jumpKind === "land");
check("desert has land pads", lands.length > 8, `${lands.length} land samples`);

let worstExit = 0;
let worstAt = 0;
let pads = 0;
for (let i = 1; i < pts.length - 1; i++) {
  if (pts[i].jumpKind !== "land" || pts[i + 1].jumpKind === "land") continue;
  pads += 1;
  const window = [];
  for (let j = i; j >= 0 && pts[i].dist - pts[j].dist < 8; j--) {
    if (pts[j].jumpKind !== "land") break;
    window.push(pts[j]);
  }
  window.reverse();
  window.push(pts[i + 1]);
  for (let k = 1; k < window.length; k++) {
    const ds = Math.max(0.01, window[k].dist - window[k - 1].dist);
    const g = Math.abs((window[k].y - window[k - 1].y) / ds);
    if (g > worstExit) {
      worstExit = g;
      worstAt = window[k].dist;
    }
  }
}
check("found land exits", pads >= 3, `${pads} pads`);
check(
  "land exit grade under 4%",
  worstExit <= 0.04,
  `worst ${(worstExit * 100).toFixed(2)}% at ${worstAt.toFixed(1)} m`
);

let land0 = null;
let land1 = null;
for (const p of pts) {
  if (p.jumpKind === "land" && p.dist > 1500) {
    if (land0 == null) land0 = p.dist;
    land1 = p.dist;
  }
}
check(
  "second Safari land still covers 1654 m",
  land0 != null && land0 < 1654 && land1 > 1654,
  `${land0?.toFixed(1)}–${land1?.toFixed(1)}`
);
const y1654 = pts.reduce((best, p) =>
  Math.abs(p.dist - 1654.1) < Math.abs(best.dist - 1654.1) ? p : best
);
check(
  "1654 m stays on the authored deck",
  Math.abs(y1654.y - 2.25) < 0.6,
  `y=${y1654.y.toFixed(2)}`
);

if (fail) {
  console.log(`\nFAIL  ${fail}`);
  process.exit(1);
}
console.log("\nPASS");
