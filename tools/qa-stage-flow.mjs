#!/usr/bin/env node
/**
 * qa-stage-flow.mjs — every stage drives as one smooth, fun ribbon.
 *
 * Width no longer pinches at piece joins. Surface grip eases instead of
 * slapping. The pack still races the longer roads. Desert 1654 stays a road.
 *
 * RUN: node --experimental-loader ./tools/qa-strip-query-loader.mjs tools/qa-stage-flow.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COURSES } from "../js/tracks/courses.js";
import { Track } from "../js/tracks/track.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const vehSrc = fs.readFileSync(path.join(ROOT, "js/physics/vehicle.js"), "utf8");
const trackSrc = fs.readFileSync(path.join(ROOT, "js/tracks/track.js"), "utf8");
const aiSrc = fs.readFileSync(path.join(ROOT, "js/ai.js"), "utf8");
const gameSrc = fs.readFileSync(path.join(ROOT, "js/game.js"), "utf8");
const mainSrc = fs.readFileSync(path.join(ROOT, "js/main.js"), "utf8");
const htmlSrc = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`STAGE FLOW  ·  ${new Date().toISOString()}\n`);

check("ribbon width blend lives in the spline", /_smoothPlayRibbon/.test(trackSrc));
check("jump posts keep authored width", /if \(p\.jump \|\| p\.jumpKind\) continue/.test(trackSrc));
check(
  "surface grip eases instead of slapping",
  /const tau = step < 0 \? 0\.34 : 0\.24/.test(vehSrc) && /Math\.exp\(-3\.4 \* dt\)/.test(vehSrc)
);
check("slides stay catchable", /Math\.max\(0\.92, surface\.driftEase/.test(vehSrc));
check("surface shock does not kick the hull", /shock \* 0\.4 \* dt/.test(vehSrc));
check("AI looks further down the longer roads", /look = 14 \+ Math\.min\(26/.test(aiSrc));
check("AI pack still races", /0\.96 \+ this\.skill \* 0\.14/.test(aiSrc));
check("game imports vehicle.js?v=180+", Number((gameSrc.match(/vehicle\.js\?v=(\d+)/) || [])[1]) >= 180);
check("game imports track.js?v=416+", Number((gameSrc.match(/track\.js\?v=(\d+)/) || [])[1]) >= 416);
check("game imports ai.js?v=212+", Number((gameSrc.match(/ai\.js\?v=(\d+)/) || [])[1]) >= 212);
check("boot cache is 974+", Number((mainSrc.match(/game\.js\?v=(\d+)/) || [])[1]) >= 974);
check("index boots main.js?v=974+", Number((htmlSrc.match(/main\.js\?v=(\d+)/) || [])[1]) >= 974);
check("width gate allows the Forest bore", /maxWidth:\s*32/.test(fs.readFileSync(path.join(ROOT, "js/tracks/world-config.js"), "utf8")));

const IDS = ["desert", "forest", "mountain", "lakeside", "physlab"];
for (const id of IDS) {
  const track = new Track(COURSES[id], { deferBuild: true });
  track._buildSpline(COURSES[id].pieces, COURSES[id]);
  const pts = track.points;
  let maxStep = 0;
  let at = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a.jump || a.jumpKind || b.jump || b.jumpKind) continue;
    const ds = b.dist - a.dist;
    if (ds < 0.2) continue;
    const dw = Math.abs((b.width || 12) - (a.width || 12));
    if (dw > maxStep) {
      maxStep = dw;
      at = b.dist;
    }
  }
  check(
    `${id} width steps stay under 1.6 m`,
    maxStep <= 1.6,
    `max Δw=${maxStep.toFixed(2)} m @ ${at.toFixed(0)} m`
  );
}

const desert = new Track(COURSES.desert, { deferBuild: true });
desert._buildSpline(COURSES.desert.pieces, COURSES.desert);
const land = desert.points.filter((p) => p.jumpKind === "land");
const land0 = land[0]?.dist;
const land1 = land[land.length - 1]?.dist;
check(
  "Desert Safari land still covers 1654 m",
  land0 != null && land1 != null && land0 < 1654 && land1 > 1654,
  `${land0?.toFixed(1)}–${land1?.toFixed(1)} m`
);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "stages flow"}`);
process.exit(fail ? 1 : 0);
