#!/usr/bin/env node
/**
 * qa-forest-3241.mjs — Stage 2 finish is one road. No auto-restart. No float.
 *
 * Player moment: Drive Forest through 3241 m and 3680 m to the finish.
 * The car stays on the paint. It is not teleported. The pack sits on the deck.
 *
 * RUN: node --experimental-loader ./tools/qa-strip-query-loader.mjs tools/qa-forest-3241.mjs
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
const valSrc = fs.readFileSync(path.join(ROOT, "js/tracks/world-geometry-validator.js"), "utf8");

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`FOREST 3241 / 3680 FINISH  ·  ${new Date().toISOString()}\n`);
console.log("static");

check(
  "game imports track.js?v=426+",
  Number((gameSrc.match(/track\.js\?v=(\d+)/) || [])[1]) >= 426
);
check(
  "game imports vehicle.js?v=186+",
  Number((gameSrc.match(/vehicle\.js\?v=(\d+)/) || [])[1]) >= 186
);
check("finish-left starts at 3180", /3180/.test(trackSrc) && /flyover/.test(trackSrc));
check("flyover banks exist", /_flyoverBankTargetY/.test(trackSrc) && /_xzOverTunnelRibbon/.test(trackSrc));
check(
  "on-road is a lift, not a replace",
  /_liftOntoPaintedDeck/.test(vehSrc) && /_pinToRibbonIfFloating/.test(vehSrc)
);
check("query-solid uses live progress", /this\.progress \|\| 0;/.test(vehSrc));
check("validator covers 3180–3900", /b\.dist < 3180/.test(valSrc) && /b\.dist > 3900/.test(valSrc));

console.log("\nlive forest spline");

const track = new Track(COURSES.forest, { deferBuild: true });
track._buildSpline(COURSES.forest.pieces, COURSES.forest);
if (typeof track._separateTunnelOverpasses === "function") track._separateTunnelOverpasses();
const pts = track.points;
const at = (d) => pts.reduce((b, p) => (Math.abs(p.dist - d) < Math.abs(b.dist - d) ? p : b), pts[0]);

check("Forest length ~3903", track.length > 3800 && track.length < 4100, `${track.length.toFixed(1)} m`);

const p3241 = at(3241);
const p3680 = at(3680);
const deck = at(3469);
check(
  "3241 is on the 7.4 m deck",
  p3241.y >= 7.8 && p3241.y <= 10.2 && Math.abs(p3241.y - deck.y) <= 0.25,
  `y=${p3241.y.toFixed(2)} deck=${deck.y.toFixed(2)}`
);
check(
  "3680 is on the same deck",
  p3680.y >= 7.8 && p3680.y <= 10.2 && Math.abs(p3680.y - deck.y) <= 0.25,
  `y=${p3680.y.toFixed(2)}`
);

let worst = 0;
let worstAt = 0;
let prev = null;
let qBad = 0;
for (const p of pts) {
  if (p.dist < 3180 || p.dist > 3900) continue;
  if (prev && p.dist - prev.dist > 0.05) {
    const g = Math.abs((p.y - prev.y) / (p.dist - prev.dist));
    if (g > worst) {
      worst = g;
      worstAt = p.dist;
    }
  }
  const q = track.query(p.x, p.z, {}, p.dist);
  if (!q.onRoad || Math.abs((q.height || 0) - p.y) > 0.55 || Math.abs((q.dist || 0) - p.dist) > 40) {
    qBad += 1;
  }
  const q80 = track.query(p.x, p.z, {}, p.dist + 80);
  if (Math.abs((q80.height || 0) - p.y) > 1.2 && Math.abs((q80.dist || 0) - p.dist) > 40) qBad += 1;
  prev = p;
}
check("3180–finish max |grade| ≤5%", worst <= 0.05, `worst ${(worst * 100).toFixed(1)}% at ${worstAt.toFixed(1)} m`);
check("no query jump / steal / off-road", qBad === 0, qBad ? `${qBad} bad` : "clear");

const land3680 = track._landSurfaceY(p3680.x, p3680.z, "forest");
check(
  "3680 land sits with the deck",
  Number.isFinite(land3680) && p3680.y - land3680 < 1.1,
  `road=${p3680.y.toFixed(2)} land=${Number(land3680).toFixed(2)}`
);
const land3241 = track._landSurfaceY(p3241.x, p3241.z, "forest");
check(
  "3241 land sits with the deck",
  Number.isFinite(land3241) && p3241.y - land3241 < 1.1,
  `road=${p3241.y.toFixed(2)} land=${Number(land3241).toFixed(2)}`
);

const lanes = track._overTunnelLanes || [];
const covers = (d) => lanes.some((ln) => ln.dist0 <= d && ln.dist1 >= d);
check("collider scrub covers 3241", covers(3241), JSON.stringify(lanes.map((l) => [l.dist0.toFixed(0), l.dist1.toFixed(0)])));
check("collider scrub covers 3680", covers(3680));

if (fail) {
  console.log(`\nFAIL  ${fail}`);
  process.exit(1);
}
console.log("\nPASS");
