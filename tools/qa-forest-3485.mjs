#!/usr/bin/env node
/**
 * qa-forest-3485.mjs — Stage 2 finish-left over the bore stays a FAST road.
 *
 * v987 left a 9–12% dirt climb into the 7.4 m deck. The car still nearly
 * stopped at 3469 m. This gate fails that "pass": 3440–3520 must stay ≤5%,
 * query must not jump/steal, bore walls must not occupy the later lane.
 *
 * RUN: node --experimental-loader ./tools/qa-strip-query-loader.mjs tools/qa-forest-3485.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COURSES } from "../js/tracks/courses.js";
import { Track } from "../js/tracks/track.js";
import { approxPieceLength } from "../js/tracks/stage-data-validate.js";
import { forestBoreCeiling, FOREST_BORE_INSET } from "../js/tracks/forest-tunnel.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const trackSrc = fs.readFileSync(path.join(ROOT, "js/tracks/track.js"), "utf8");
const tunSrc = fs.readFileSync(path.join(ROOT, "js/tracks/forest-tunnel.js"), "utf8");
const gameSrc = fs.readFileSync(path.join(ROOT, "js/game.js"), "utf8");
const mainSrc = fs.readFileSync(path.join(ROOT, "js/main.js"), "utf8");
const htmlSrc = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const valSrc = fs.readFileSync(path.join(ROOT, "js/tracks/world-geometry-validator.js"), "utf8");

const TARGET = 3485;
const PIN_3469 = 3469;
const BAND0 = 3440;
const BAND1 = 3520;
const GRADE_MAX = 0.05;
const CLEAR = 7.4;

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`FOREST 3485 / 3469 FINISH-LEFT  ·  ${new Date().toISOString()}\n`);
console.log("static");

check(
  "game imports track.js?v=420+",
  Number((gameSrc.match(/track\.js\?v=(\d+)/) || [])[1]) >= 420,
  "stale cache would keep the 12% approach"
);
check("boot cache is 1000+", Number((mainSrc.match(/game\.js\?v=(\d+)/) || [])[1]) >= 1000);
check("index boots main.js?v=1000+", Number((htmlSrc.match(/main\.js\?v=(\d+)/) || [])[1]) >= 1000);
check(
  "tunEnd stays function-scope",
  /let tunEnd = NaN/.test(trackSrc) && /Number\.isFinite\(tunEnd\)/.test(trackSrc)
);
check(
  "additive flyover skips tunnel-under pairs",
  /if \(a\.tunnel\) continue/.test(trackSrc) && /_separateTunnelOverpasses/.test(trackSrc)
);
check("over-tunnel lanes are scrubbed", /_overTunnelLanes/.test(trackSrc));
check("finish-left pad is flattened before 3469", /_overpassFlatEnd/.test(trackSrc) && /3380/.test(trackSrc));
check("overpass apron is linear 4.5%", /const GRADE = 0\.045/.test(trackSrc) && /Linear flyover apron/.test(trackSrc));
check(
  "collider sample honors wall top",
  /sampleY >= c\.top \+ 0\.45/.test(trackSrc)
);
check(
  "bore cap uses flyover XZ test",
  /Same XZ test as flyover/.test(tunSrc) && !/if \(Math\.abs\(along\) > 8\)/.test(tunSrc)
);
check("validator gates 3440–3520 at 5%", /b\.dist < 3440/.test(valSrc) && /g > 0\.05/.test(valSrc) && /FOREST_3485_WALL/.test(valSrc));

const course = COURSES.forest;
const pieces = course.pieces || [];
const compiledLen = approxPieceLength(pieces);
check("Forest compiles ~3903 m", compiledLen > 3800 && compiledLen < 4100, `${compiledLen.toFixed(1)} m`);

let dist = 0;
let at3485 = null;
let at3469 = null;
for (let i = 0; i < pieces.length; i++) {
  const p = pieces[i];
  let len = 0;
  if (p.type === "straight") len = p.length || 0;
  else if (p.type === "curve") len = (Math.abs(p.angle || 0) * Math.PI) / 180 * (p.radius || 0);
  const d0 = dist;
  dist += len;
  if (d0 <= TARGET && TARGET <= dist) at3485 = p;
  if (d0 <= PIN_3469 && PIN_3469 <= dist) at3469 = p;
}
check(
  "3485 m is medium-left-to-finish",
  !!(at3485 && /finish/i.test(at3485.purpose || "") && at3485.type === "curve" && (at3485.angle || 0) > 0),
  at3485 ? `${at3485.purpose} a=${at3485.angle}` : "missing"
);
check(
  "3469 m is the same finish-left",
  !!(at3469 && at3469 === at3485),
  at3469 ? `${at3469.purpose}` : "missing"
);
check("play-lane width at 3485 ≥ 16 m", (at3485 && at3485.width >= 16) || false, at3485 ? String(at3485.width) : "");

console.log("\nspline");
const track = new Track(course, { deferBuild: true });
track._buildSpline(course.pieces, course);
const pts = track.points;
check("spline length ~3903", track.length > 3800 && track.length < 4100, `${track.length.toFixed(1)} m`);

const tun = (track._tunnels || [])[0];
check("Forest bore posts exist", !!(tun && Number.isFinite(tun.endDist)), tun ? `${tun.startDist.toFixed(0)}–${tun.endDist.toFixed(0)}` : "none");

const pin = pts.reduce((best, p) => (Math.abs(p.dist - TARGET) < Math.abs(best.dist - TARGET) ? p : best), pts[0]);
const pin3469 = pts.reduce((best, p) => (Math.abs(p.dist - PIN_3469) < Math.abs(best.dist - PIN_3469) ? p : best), pts[0]);
check("pin is on-road width", (pin.width || 0) >= 16, `w=${(pin.width || 0).toFixed(1)}`);
check(
  "3485 is a flyover deck, not the tunnel floor",
  pin.y >= 6.8 && pin.y <= 10.2,
  `y=${pin.y.toFixed(2)}`
);
check("no stacked 11 m hump", pin.y <= 1.2 + CLEAR + 1.4, `y=${pin.y.toFixed(2)}`);
check(
  "3469 is already on the deck (not mid-ramp)",
  Math.abs(pin3469.y - pin.y) <= 0.25,
  `y3469=${pin3469.y.toFixed(2)} y3485=${pin.y.toFixed(2)}`
);

let worst = 0;
let worstAt = 0;
let prev = null;
let queryJumps = 0;
let stolen = 0;
for (const p of pts) {
  if (p.dist < BAND0 || p.dist > BAND1) continue;
  if (prev) {
    const ds = p.dist - prev.dist;
    if (ds > 0.05) {
      const g = (p.y - prev.y) / ds;
      if (g > worst) {
        worst = g;
        worstAt = p.dist;
      }
    }
  }
  const half = (p.width || 16) * 0.5;
  for (const lat of [0, half * 0.5, -half * 0.5, half * 0.88, -half * 0.88]) {
    const q = track.query(p.x + p.nx * lat, p.z + p.nz * lat, {}, p.dist);
    if (Number.isFinite(q.dist) && Math.abs(q.dist - p.dist) > 40) stolen += 1;
    if (Math.abs((q.height || 0) - p.y) > 0.55) queryJumps += 1;
    if (!q.onRoad) queryJumps += 1;
  }
  prev = p;
}
check(
  "3440–3520 grade under 5% (old 9.1% must fail)",
  worst <= GRADE_MAX && GRADE_MAX < 0.091,
  `worst ${(worst * 100).toFixed(1)}% at ${worstAt.toFixed(1)} m`
);
check("query height/on-road sane across the band", queryJumps === 0 && stolen === 0, `jumps=${queryJumps} stolen=${stolen}`);

let overTunnel = 0;
if (tun) {
  for (const p of pts) {
    if (p.dist < TARGET - 40 || p.dist > TARGET + 40 || p.tunnel) continue;
    for (const q of pts) {
      if (!q.tunnel) continue;
      if (Math.hypot(p.x - q.x, p.z - q.z) < (p.width + q.width) * 0.5 + 3) {
        overTunnel += 1;
        break;
      }
    }
  }
}
check("3485±40 still crosses the bore in XZ", overTunnel >= 1, `${overTunnel} posts`);
check(
  "over-tunnel lane covers 3469",
  Array.isArray(track._overTunnelLanes) && track._overTunnelLanes.some((ln) => ln.dist0 <= PIN_3469 && ln.dist1 >= PIN_3469),
  JSON.stringify(track._overTunnelLanes || [])
);

console.log("\nquery + walls + hold-speed");
const half = (pin.width || 16) * 0.5;
const lats = [0, half * 0.5, -half * 0.5, half * 0.88, -half * 0.88];
let queryBad = 0;
for (const lat of lats) {
  const x = pin.x + pin.nx * lat;
  const z = pin.z + pin.nz * lat;
  const q = track.query(x, z, {}, pin.dist);
  const stole = Number.isFinite(q.dist) && Math.abs(q.dist - pin.dist) > 40;
  const drop = Math.abs((q.height || 0) - pin.y) > 2.4;
  const off = !q.onRoad;
  if (stole || drop || off) queryBad += 1;
}
check("query on-road, height sane, not stolen", queryBad === 0, queryBad ? `${queryBad} bad laterals` : "5 laterals");

let blocked = 0;
let minClear = Infinity;
const tunPts = pts.filter((p) => p.tunnel && p.dist > 2200 && p.dist < 2300);
for (const tunPt of tunPts) {
  const spec = {
    clearHalf: (tunPt.width || 31) * 0.5 + FOREST_BORE_INSET,
    openH: Math.max(6.8, (tunPt.width || 31) * 0.5 * 0.78 + 3.6),
    thick: 3.85,
  };
  const ceil = forestBoreCeiling(
    { x: tunPt.x, y: tunPt.y, z: tunPt.z, nx: tunPt.nx, nz: tunPt.nz },
    pts,
    spec
  );
  const clearT = (tunPt.width || 31) * 0.5 + FOREST_BORE_INSET;
  const wx = Math.sin(tunPt.heading);
  const wz = Math.cos(tunPt.heading);
  for (const side of [-1, 1]) {
    const dummy = {
      kind: "wall",
      x: tunPt.x + tunPt.nx * side * clearT,
      z: tunPt.z + tunPt.nz * side * clearT,
      nx: -tunPt.nx * side,
      nz: -tunPt.nz * side,
      tx: wx,
      tz: wz,
      halfLen: 8,
      depth: 3.6,
      top: ceil,
      r: 0.01,
    };
    for (const sample of [pin, pin3469]) {
      const dy = sample.y - (Number.isFinite(ceil) ? ceil : 99);
      if (Number.isFinite(ceil) && Math.hypot(sample.x - tunPt.x, sample.z - tunPt.z) < (sample.width + tunPt.width) * 0.5 + 4) {
        if (dy < minClear) minClear = dy;
      }
      for (const lat of lats) {
        const x = sample.x + sample.nx * lat;
        const z = sample.z + sample.nz * lat;
        if (track._colliderBlocksSample(dummy, x, z, sample.heading, sample.y)) blocked += 1;
      }
    }
  }
}
check("capped wall does not block the 3469/3485 deck", blocked === 0, blocked ? `${blocked} hits` : "clear");
check(
  "overlapping bore top stays under the later deck",
  !Number.isFinite(minClear) || minClear >= 1.15,
  Number.isFinite(minClear) ? `clear=${minClear.toFixed(2)}` : "no XZ overlap on pins"
);

const start = pts.reduce((b, p) => (Math.abs(p.dist - BAND0) < Math.abs(b.dist - BAND0) ? p : b), pts[0]);
let v = 26;
let x = start.x;
let z = start.z;
let heading = start.heading;
let along = start.dist;
let y = start.y;
let advanced = 0;
let stalled = 0;
for (let s = 1; s <= 36; s++) {
  x += Math.sin(heading) * 2.4;
  z += Math.cos(heading) * 2.4;
  const q = track.query(x, z, {}, along);
  const jump = Math.abs((q.height || 0) - y);
  const stole = Number.isFinite(q.dist) && Math.abs(q.dist - along) > 40;
  const ds = Number.isFinite(q.dist) ? q.dist - along : 0;
  if (!q.onRoad || stole || ds < 0.35 || jump > 0.7) {
    stalled += 1;
    v *= 0.2;
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
check("car XZ can advance along the finish-left", advanced >= 28, `${advanced}/36 steps`);
check(
  "kinematic hold-speed through 3440–3520",
  stalled === 0 && v >= 20 && along >= BAND0 + 60,
  `v=${v.toFixed(1)} m/s along=${along.toFixed(0)} stall=${stalled}`
);

check(
  "Desert 1654 land skip untouched",
  /jumpKind === "land"/.test(trackSrc) && /_jumpArrivalNear/.test(trackSrc)
);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Forest 3469/3485 play-lane open"}`);
process.exit(fail ? 1 : 0);
