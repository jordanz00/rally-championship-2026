#!/usr/bin/env node
/**
 * qa-forest-3485.mjs — Stage 2 finish-left over the bore stays a road.
 *
 * At ~3485 m the medium-left-to-finish occupies the same XZ as the late
 * tunnel (~2248 m). Stacked flyover lifts used to build an 18% hill and
 * tunnel wall tops reached the later deck — the car slowed as if stuck.
 *
 * RUN: node --experimental-loader ./tools/qa-strip-query-loader.mjs tools/qa-forest-3485.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COURSES } from "../js/tracks/courses.js";
import { Track } from "../js/tracks/track.js";
import { approxPieceLength } from "../js/tracks/stage-data-validate.js";
import { forestBoreCeiling } from "../js/tracks/forest-tunnel.js";
import { FOREST_BORE_INSET } from "../js/tracks/forest-tunnel.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const trackSrc = fs.readFileSync(path.join(ROOT, "js/tracks/track.js"), "utf8");
const tunSrc = fs.readFileSync(path.join(ROOT, "js/tracks/forest-tunnel.js"), "utf8");
const gameSrc = fs.readFileSync(path.join(ROOT, "js/game.js"), "utf8");
const mainSrc = fs.readFileSync(path.join(ROOT, "js/main.js"), "utf8");
const htmlSrc = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const valSrc = fs.readFileSync(path.join(ROOT, "js/tracks/world-geometry-validator.js"), "utf8");

const TARGET = 3485;
const BAND0 = 3455;
const BAND1 = 3515;
const GRADE_MAX = 0.12;
const CLEAR = 7.4;

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`FOREST 3485 FINISH-LEFT  ·  ${new Date().toISOString()}\n`);
console.log("static");

check(
  "game imports track.js?v=418+",
  Number((gameSrc.match(/track\.js\?v=(\d+)/) || [])[1]) >= 418,
  "stale cache would keep the 18% bore wall"
);
check("boot cache is 987+", Number((mainSrc.match(/game\.js\?v=(\d+)/) || [])[1]) >= 987);
check("index boots main.js?v=987+", Number((htmlSrc.match(/main\.js\?v=(\d+)/) || [])[1]) >= 987);
check(
  "tunEnd stays function-scope",
  /let tunEnd = NaN/.test(trackSrc) && /Number\.isFinite\(tunEnd\)/.test(trackSrc)
);
check(
  "additive flyover skips tunnel-under pairs",
  /if \(a\.tunnel\) continue/.test(trackSrc) && /_separateTunnelOverpasses/.test(trackSrc)
);
check("over-tunnel lanes are scrubbed", /_overTunnelLanes/.test(trackSrc));
check(
  "collider sample honors wall top",
  /sampleY >= c\.top \+ 0\.45/.test(trackSrc)
);
check(
  "bore cap uses flyover XZ test",
  /Same XZ test as flyover/.test(tunSrc) && !/if \(Math\.abs\(along\) > 8\)/.test(tunSrc)
);
check("validator gates late Forest grade", /FOREST_3485_WALL/.test(valSrc));

const course = COURSES.forest;
const pieces = course.pieces || [];
const compiledLen = approxPieceLength(pieces);
check("Forest compiles ~3903 m", compiledLen > 3800 && compiledLen < 4100, `${compiledLen.toFixed(1)} m`);

let dist = 0;
let at3485 = null;
for (let i = 0; i < pieces.length; i++) {
  const p = pieces[i];
  let len = 0;
  if (p.type === "straight") len = p.length || 0;
  else if (p.type === "curve") len = (Math.abs(p.angle || 0) * Math.PI) / 180 * (p.radius || 0);
  const d0 = dist;
  dist += len;
  if (d0 <= TARGET && TARGET <= dist) at3485 = p;
}
check(
  "3485 m is medium-left-to-finish",
  !!(at3485 && /finish/i.test(at3485.purpose || "") && at3485.type === "curve" && (at3485.angle || 0) > 0),
  at3485 ? `${at3485.purpose} a=${at3485.angle}` : "missing"
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
check("pin is on-road width", (pin.width || 0) >= 16, `w=${(pin.width || 0).toFixed(1)}`);
check(
  "3485 is a flyover deck, not the tunnel floor",
  pin.y >= 6.8 && pin.y <= 10.2,
  `y=${pin.y.toFixed(2)}`
);
check("no stacked 11 m hump", pin.y <= 1.2 + CLEAR + 1.4, `y=${pin.y.toFixed(2)}`);

let worst = 0;
let worstAt = 0;
let prev = null;
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
  prev = p;
}
check(
  "3455–3515 grade under 12%",
  worst <= GRADE_MAX,
  `worst ${(worst * 100).toFixed(1)}% at ${worstAt.toFixed(1)} m`
);

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
  "over-tunnel lane recorded",
  Array.isArray(track._overTunnelLanes) && track._overTunnelLanes.some((ln) => ln.dist0 <= TARGET && ln.dist1 >= TARGET),
  JSON.stringify(track._overTunnelLanes || [])
);

console.log("\nquery");
const half = (pin.width || 16) * 0.5;
const lats = [0, half * 0.5, -half * 0.5, half * 0.88, -half * 0.88];
let queryBad = 0;
for (const lat of lats) {
  const x = pin.x + pin.nx * lat;
  const z = pin.z + pin.nz * lat;
  const q = track.query(x, z, {}, pin.dist);
  const stolen = Number.isFinite(q.dist) && Math.abs(q.dist - pin.dist) > 40;
  const drop = Math.abs((q.height || 0) - pin.y) > 2.4;
  const off = !q.onRoad;
  if (stolen || drop || off) queryBad += 1;
}
check("query on-road, height sane, not stolen", queryBad === 0, queryBad ? `${queryBad} bad laterals` : "5 laterals");

const fx = Math.sin(pin.heading);
const fz = Math.cos(pin.heading);
let advanced = 0;
let lastDist = pin.dist;
for (let s = 1; s <= 8; s++) {
  const x = pin.x + fx * s * 2.4;
  const z = pin.z + fz * s * 2.4;
  const q = track.query(x, z, {}, lastDist);
  if (q.onRoad && Number.isFinite(q.dist) && q.dist > lastDist + 0.4 && Math.abs(q.height - pin.y) < 3.2) {
    advanced += 1;
    lastDist = q.dist;
  }
}
check("car XZ can advance along the finish-left", advanced >= 5, `${advanced}/8 steps`);

const tunPt = pts.find((p) => p.tunnel && p.dist > 2235 && p.dist < 2275);
if (tunPt) {
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
  check(
    "bore wall top stays under the later deck",
    Number.isFinite(ceil) && ceil <= pin.y - 1.2,
    `ceil=${Number.isFinite(ceil) ? ceil.toFixed(2) : "na"} laterY=${pin.y.toFixed(2)}`
  );
  const dummy = {
    kind: "wall",
    x: tunPt.x,
    z: tunPt.z,
    nx: tunPt.nx,
    nz: tunPt.nz,
    tx: Math.sin(tunPt.heading),
    tz: Math.cos(tunPt.heading),
    halfLen: 8,
    depth: 3.6,
    top: ceil,
    r: 0.01,
  };
  const blocked = track._colliderBlocksSample(dummy, pin.x, pin.z, pin.heading, pin.y);
  check("capped wall does not block the 3485 deck", blocked === false);
}

check(
  "Desert 1654 land skip untouched",
  /jumpKind === "land"/.test(trackSrc) && /_jumpArrivalNear/.test(trackSrc)
);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Forest 3485 play-lane open"}`);
process.exit(fail ? 1 : 0);
