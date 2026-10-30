#!/usr/bin/env node
/**
 * qa-lakeside-bridge.mjs — Lakeside suspension bridge is a late-stage landmark
 * seen from far away, crossing open water, on drivable grades.
 *
 * Numeric gate on the COMPILED course (same pieces the Track spline reads):
 *  - span starts in the last ~40% of the stage
 *  - straight, crest-free sightline from >= 600 m before the span to the tower tops
 *  - approach / exit grade <= 9% (smoothstep peak = 1.5 x mean)
 *  - deck clearance over the water >= 10 m (authored climb + track.js water drop)
 *  - checkpoints stay on plain road, off the bridge ramps
 *  - water bay + shore abutment wiring exists in track.js
 *
 * RUN: node --experimental-loader ./tools/qa-strip-query-loader.mjs tools/qa-lakeside-bridge.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COURSES } from "../js/tracks/courses.js";
import { approxPieceLength } from "../js/tracks/stage-data-validate.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`LAKESIDE BRIDGE  ·  ${new Date().toISOString()}\n`);

const course = COURSES.lakeside;
const pieces = course.pieces;
const total = approxPieceLength(pieces);

/** Per-piece start distance, length and cumulative road Y at piece end. */
const rows = [];
let d = 0;
let y = 0;
for (const p of pieces) {
  const len = approxPieceLength([p]);
  const y0 = y;
  y += p.dy || 0;
  rows.push({ p, d0: d, d1: d + len, len, y0, y1: y });
  d += len;
}
const isBridge = (r) => r.p.bridge || /^bridge_/.test(r.p.visual || "");
const span = rows.filter((r) => r.p.bridge || r.p.visual === "bridge_span");
const apr = rows.filter((r) => r.p.visual === "bridge_approach");
const exi = rows.filter((r) => r.p.visual === "bridge_exit");
check("bridge pieces present", span.length > 0 && apr.length > 0 && exi.length > 0, `approach ${apr.length} · span ${span.length} · exit ${exi.length} chunks`);

const spanStart = span[0].d0;
const spanEnd = span[span.length - 1].d1;
const aprStart = apr[0].d0;
const exitEnd = exi[exi.length - 1].d1;
const frac = spanStart / total;
console.log(`  info  stage ${total.toFixed(0)} m · approach ${aprStart.toFixed(0)} · span ${spanStart.toFixed(0)}–${spanEnd.toFixed(0)} (${(spanEnd - spanStart).toFixed(0)} m) · exit end ${exitEnd.toFixed(0)}`);

check("span starts after 60% of the stage", frac >= 0.6, `${(frac * 100).toFixed(1)}%`);
check("exit leaves >= 400 m of stage after the bridge", total - exitEnd >= 400, `${(total - exitEnd).toFixed(0)} m`);
check("span is a long level deck", spanEnd - spanStart >= 400 && span.every((r) => (r.p.dy || 0) === 0));

// ── Sightline: straight run + no crest between the eye and the tower tops ──────────
let lastCurveEnd = 0;
for (const r of rows) {
  if (r.d1 > spanStart) break;
  if (r.p.type !== "straight") lastCurveEnd = r.d1;
}
const straightRun = spanStart - lastCurveEnd;
const towerAlong = spanStart + 0.14 * (spanEnd - spanStart);
check("straight run before the span >= 600 m", straightRun >= 600, `${straightRun.toFixed(0)} m`);
check("tower visible from >= 600 m out", towerAlong - lastCurveEnd >= 600, `${(towerAlong - lastCurveEnd).toFixed(0)} m`);

// Road Y profile, linear inside each piece (the Track smooths; this bounds it).
function roadY(s) {
  for (const r of rows) {
    if (s >= r.d0 && s <= r.d1) {
      const t = r.len > 0 ? (s - r.d0) / r.len : 0;
      const k = r.p.visual === "bridge_approach" || r.p.visual === "bridge_exit" ? t * t * (3 - 2 * t) : t;
      return r.y0 + (r.y1 - r.y0) * k;
    }
  }
  return y;
}
const towerH = 28; // min tower height above the deck in track.js (grows with span)
const deckY = roadY(spanStart + 1);
const topY = deckY + towerH;
let blocked = 0;
const eyeS = lastCurveEnd;
const eyeY = roadY(eyeS) + 1.5;
for (let s = eyeS; s < towerAlong - 5; s += 4) {
  const t = (s - eyeS) / (towerAlong - eyeS);
  const losY = eyeY + (topY - eyeY) * t;
  if (roadY(s) + 0.4 > losY) blocked += 1;
}
check("no crest blocks eye -> tower top", blocked === 0, `${blocked} blocked samples`);

// ── Grades ────────────────────────────────────────────────────────────────
function peakGrade(group) {
  const run = group[group.length - 1].d1 - group[0].d0;
  const rise = Math.abs(group[group.length - 1].y1 - group[0].y0);
  return { mean: rise / run, peak: (rise / run) * 1.5, run, rise };
}
const ga = peakGrade(apr);
const ge = peakGrade(exi);
check("approach grade <= 9% peak", ga.peak <= 0.09, `${(ga.mean * 100).toFixed(1)}% mean · ${(ga.peak * 100).toFixed(1)}% peak · +${ga.rise.toFixed(1)} m / ${ga.run.toFixed(0)} m`);
check("exit grade <= 9% peak", ge.peak <= 0.09, `${(ge.mean * 100).toFixed(1)}% mean · ${(ge.peak * 100).toFixed(1)}% peak · -${ge.rise.toFixed(1)} m / ${ge.run.toFixed(0)} m`);
check("approach and exit shores level (same water basin)", Math.abs(ga.rise - ge.rise) < 0.05, `${ga.rise.toFixed(2)} vs ${ge.rise.toFixed(2)} m`);

// ── Water clearance ────────────────────────────────────────────────────────
const trackSrc = read("js/tracks/track.js");
const drop = Number((trackSrc.match(/const LAKE_BRIDGE_WATER_DROP = ([\d.]+)/) || [])[1]);
const bed = Number((trackSrc.match(/const LAKE_BRIDGE_BED_DROP = ([\d.]+)/) || [])[1]);
const bay = Number((trackSrc.match(/const LAKE_BRIDGE_BAY_HALF = ([\d.]+)/) || [])[1]);
const clearance = ga.rise + drop;
check("deck clears the water by >= 10 m", clearance >= 10, `${clearance.toFixed(1)} m (deck +${ga.rise.toFixed(1)} over shore, water −${drop} below it)`);
check("lake floor is below the water surface", bed > drop, `bed −${bed} · water −${drop}`);
check("bay is open water on both sides (>= 100 m half-width)", bay >= 100, `${bay} m each side`);
check("water bay runs both sides + abutment ramps wired", /bay: true/.test(trackSrc) && /_lakesideBridgeLand/.test(trackSrc) && /Pier footing/.test(trackSrc));
check("old shore-height hold under the span is gone", !/return br\.baseY - drop;/.test(trackSrc));

// ── Checkpoints on plain road, off the ramps ───────────────────────────────
const cps = rows.filter((r) => r.p.checkpoint);
check("lakeside has checkpoints", cps.length >= 2, `${cps.length}`);
for (const r of cps) {
  const onBridge = r.d1 > aprStart - 60 && r.d0 < exitEnd + 60;
  const grade = Math.abs((r.p.dy || 0) / Math.max(1, r.len));
  check(`checkpoint @${r.d1.toFixed(0)} m off the bridge zone, plain road`, !onBridge && !isBridge(r) && grade < 0.05, `grade ${(grade * 100).toFixed(1)}%`);
}
const legs = [0, ...cps.map((r) => r.d1), total].map((v, i, a) => (i ? v - a[i - 1] : 0)).slice(1);
check("no checkpoint leg longer than 2200 m", Math.max(...legs) <= 2200, legs.map((v) => v.toFixed(0)).join(" / "));

// ── Built spline: land vs water vs deck (visual surfaces; query authority untouched) ──
{
  const { Track } = await import("../js/tracks/track.js");
  const track = new Track(course, { deferBuild: true });
  track._buildSpline(course.pieces, course);
  const br = track._lakesideBridge;
  check("built: bridge tagged late in the stage", !!br && br.dist0 / track.length >= 0.6, br ? `${(br.dist0 / track.length * 100).toFixed(1)}% · ${br.dist0.toFixed(0)}–${br.dist1.toFixed(0)} m of ${track.length.toFixed(0)}` : "none");
  if (br) {
    const pts = track.points;
    let wetWorst = -1e9; // highest land under the water core (must be < water)
    let rimWorst = 1e9; // lowest land at the shore rim (must be > water)
    let deckMin = 1e9; // smallest deck - water clearance
    let n = 0;
    for (let i = br.i0 + 20; i <= br.i1 - 20; i += 4) {
      const p = pts[i];
      deckMin = Math.min(deckMin, p.y - br.waterY);
      for (const lat of [0, 20, 60, 100, 140, -20, -60, -100, -140]) {
        const h = track._groundHeight(p.x + p.nx * lat, p.z + p.nz * lat, "lakeside");
        wetWorst = Math.max(wetWorst, h - br.waterY);
        n += 1;
      }
      for (const lat of [260, 320, -260, -320]) {
        const h = track._groundHeight(p.x + p.nx * lat, p.z + p.nz * lat, "lakeside");
        rimWorst = Math.min(rimWorst, h - br.waterY);
      }
    }
    check("land under the span + bay is below the water surface", wetWorst < -0.5, `${n} samples, highest land ${wetWorst.toFixed(2)} m vs water`);
    check("shore rim stands above the water (no flooded plain)", rimWorst > 0.5, `lowest rim ${rimWorst.toFixed(2)} m above water`);
    check("measured deck clearance over the water >= 10 m", deckMin >= 10, `${deckMin.toFixed(2)} m min along the span`);
    // Ramp pads must not poke above the paint.
    let poke = -1e9;
    for (let i = br.a0; i < br.i0 - 2; i += 3) {
      const p = pts[i];
      for (const lat of [0, 6, 12, 25, -6, -12, -25]) {
        poke = Math.max(poke, track._groundHeight(p.x + p.nx * lat, p.z + p.nz * lat, "lakeside") - p.y);
      }
    }
    check("approach ramp land never above the paint", poke < -0.2, `worst ${poke.toFixed(2)} m`);
  }
}

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "late bridge, long sightline, open water"}`);
process.exit(fail ? 1 : 0);
