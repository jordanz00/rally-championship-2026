#!/usr/bin/env node
/**
 * qa-forest-3469.mjs — Stage 2 pin where the car nearly stopped.
 *
 * The long Forest no longer crosses its own bore here. 3469 m is flat dirt
 * on the tunnel floor. A climb back onto a 7.4 m deck would be a new wall.
 *
 * RUN: node --experimental-loader ./tools/qa-strip-query-loader.mjs tools/qa-forest-3469.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COURSES } from "../js/tracks/courses.js";
import { Track } from "../js/tracks/track.js";
import { forestBoreCeiling, FOREST_BORE_INSET } from "../js/tracks/forest-tunnel.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const trackSrc = fs.readFileSync(path.join(ROOT, "js/tracks/track.js"), "utf8");
const valSrc = fs.readFileSync(path.join(ROOT, "js/tracks/world-geometry-validator.js"), "utf8");

const PIN = 3469;
const BAND0 = 3440;
const BAND1 = 3520;
const GRADE_MAX = 0.05;

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`FOREST 3469 STOP  ·  ${new Date().toISOString()}\n`);

check("old 9.1% gate is rejected", GRADE_MAX < 0.091, `GRADE_MAX=${GRADE_MAX}`);
check("linear 4.5% apron, not 12% smoothstep", /const GRADE = 0\.045/.test(trackSrc) && !/const GRADE = 0\.12/.test(trackSrc));
check("3469 corridor is a flat deck", /_overpassFlatEnd/.test(trackSrc) && /3180/.test(trackSrc) && /flyover/.test(trackSrc));
check("validator 5% at 3180–3900", /b\.dist < 3180/.test(valSrc) && /g > 0\.05/.test(valSrc));
check("tunEnd stays function-scope", /let tunEnd = NaN/.test(trackSrc));

const track = new Track(COURSES.forest, { deferBuild: true });
track._buildSpline(COURSES.forest.pieces, COURSES.forest);
const pts = track.points;
const pin = pts.reduce((best, p) => (Math.abs(p.dist - PIN) < Math.abs(best.dist - PIN) ? p : best), pts[0]);
const deck = pts.reduce((best, p) => (Math.abs(p.dist - 3485) < Math.abs(best.dist - 3485) ? p : best), pts[0]);

check("Forest is the long stage", track.length > 4700 && track.length < 5200, `${track.length.toFixed(1)} m`);
check("3469 is dirt on-road", pin.surface === "dirt" && (pin.width || 0) >= 16, `w=${(pin.width || 0).toFixed(1)} ${pin.surface}`);
check("3469 stays level with 3485", Math.abs(pin.y - deck.y) <= 0.25, `y=${pin.y.toFixed(2)} deck=${deck.y.toFixed(2)}`);

let worst = 0;
let worstAt = 0;
let prev = null;
let qBad = 0;
for (const p of pts) {
  if (p.dist < BAND0 || p.dist > BAND1) continue;
  if (prev && p.dist - prev.dist > 0.05) {
    const g = (p.y - prev.y) / (p.dist - prev.dist);
    if (g > worst) {
      worst = g;
      worstAt = p.dist;
    }
  }
  const half = (p.width || 16) * 0.5;
  for (const lat of [0, half * 0.88, -half * 0.88]) {
    const q = track.query(p.x + p.nx * lat, p.z + p.nz * lat, {}, p.dist);
    if (!q.onRoad || Math.abs((q.height || 0) - p.y) > 0.55 || Math.abs((q.dist || 0) - p.dist) > 40) qBad += 1;
  }
  prev = p;
}
check("3440–3520 max grade ≤5%", worst <= GRADE_MAX, `worst ${(worst * 100).toFixed(1)}% at ${worstAt.toFixed(1)} m`);
check("no query jump / steal / off-road", qBad === 0, qBad ? `${qBad} bad` : "clear");

const tunPts = pts.filter((p) => p.tunnel && p.dist > 2200 && p.dist < 2300);
let blocked = 0;
for (const tp of tunPts) {
  const spec = {
    clearHalf: (tp.width || 31) * 0.5 + FOREST_BORE_INSET,
    openH: Math.max(6.8, (tp.width || 31) * 0.5 * 0.78 + 3.6),
    thick: 3.85,
  };
  const ceil = forestBoreCeiling({ x: tp.x, y: tp.y, z: tp.z, nx: tp.nx, nz: tp.nz }, pts, spec);
  const clearT = (tp.width || 31) * 0.5 + FOREST_BORE_INSET;
  const dummy = {
    kind: "wall",
    x: tp.x + tp.nx * clearT,
    z: tp.z + tp.nz * clearT,
    nx: -tp.nx,
    nz: -tp.nz,
    tx: Math.sin(tp.heading),
    tz: Math.cos(tp.heading),
    halfLen: 8,
    depth: 3.6,
    top: ceil,
    r: 0.01,
  };
  const half = (pin.width || 16) * 0.5;
  for (const lat of [0, half * 0.5, -half * 0.5, half * 0.88, -half * 0.88]) {
    if (track._colliderBlocksSample(dummy, pin.x + pin.nx * lat, pin.z + pin.nz * lat, pin.heading, pin.y)) {
      blocked += 1;
    }
  }
}
check("no bore-wall AABB in the 3469 ribbon", blocked === 0, blocked ? `${blocked} hits` : "clear");

let v = 26;
let x = pin.x;
let z = pin.z;
let heading = pin.heading;
let along = pin.dist;
let y = pin.y;
let advanced = 0;
let stalled = 0;
for (let s = 1; s <= 16; s++) {
  x += Math.sin(heading) * 2.4;
  z += Math.cos(heading) * 2.4;
  const q = track.query(x, z, {}, along);
  const ds = (q.dist || 0) - along;
  const jump = Math.abs((q.height || 0) - y);
  if (!q.onRoad || ds < 0.35 || jump > 0.7 || Math.abs((q.dist || 0) - along) > 40) {
    stalled += 1;
    v *= 0.15;
  } else {
    const g = (q.height - y) / Math.max(0.35, ds);
    const dt = 2.4 / Math.max(4, v);
    v = Math.max(0, v + (2.8 - 9.81 * Math.max(0, g) - 0.55) * dt);
    advanced += 1;
    along = q.dist;
    y = q.height;
    heading = q.heading;
  }
}
check("3469 XZ holds speed", stalled === 0 && v >= 22 && advanced >= 12, `v=${v.toFixed(1)} adv=${advanced} stall=${stalled}`);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "3469 is a fast deck"}`);
process.exit(fail ? 1 : 0);
