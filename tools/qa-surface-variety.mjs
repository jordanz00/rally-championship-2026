#!/usr/bin/env node
/**
 * qa-surface-variety.mjs — every stage swaps road surface along the course.
 *
 * WHO THIS IS FOR: anyone editing stage layout (the surfacePlan in
 *   js/tracks/stages/*-definition.js snaps to the layout, so a layout change
 *   can leave a patch too short or a boundary on a checkpoint / jump).
 * WHAT IT DOES: builds each stage spline (no WebGL) and asserts surface
 *   variety, patch lengths, the Desert sand->tarmac->dirt->tarmac->sand->dirt->
 *   gravel order, smooth (non-zero-width, continuous) blends, and that no
 *   boundary lands on a checkpoint, jump, bridge, tunnel interior or corner apex.
 *
 * GATES (per stage): distinct surfaces >= N, switches >= M, patch >= MIN_PATCH m
 *   and <= MAX_PATCH m, blend width 6..40 m, checkpoints / jumps clear by KEEP m.
 *
 * RUN: node --experimental-loader ./tools/qa-strip-query-loader.mjs tools/qa-surface-variety.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COURSES } from "../js/tracks/courses.js";
import { Track } from "../js/tracks/track.js";
import { SURFACES } from "../js/config.js";
import { getSurface } from "../js/physics/surfaces.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const trackSrc = read("js/tracks/track.js");
const forestSrc = read("js/tracks/forest-pbr.js");

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Per-stage targets. n = distinct ids, m = switches, desert order is exact. */
const SPEC = {
  desert: { n: 4, m: 6, order: ["sand", "tarmac", "dirt", "tarmac", "sand", "dirt", "gravel"] },
  forest: { n: 4, m: 8 },
  mountain: { n: 4, m: 7 },
  lakeside: { n: 5, m: 7 },
};
const MIN_PATCH = 120;
/** Forest bore (~1.4 km of tunnel) is one atomic floor surface, hence the headroom. */
const MAX_PATCH = 1700;
const KEEP = 15;
const APEX_KEEP = 10;

console.log(`SURFACE VARIETY  ·  ${new Date().toISOString()}\n`);

// ── every surface id has a physics entry and a road material path ─────────
const roadUv = (trackSrc.match(/const ROAD_UV_SCALE = \{([\s\S]*?)\};/) || [])[1] || "";
check("forest ribbon maps tarmac + mud", /tarmac/.test(forestSrc) && /mud/.test(forestSrc));
check("blend is centred + short (no 220 m ease)", /SURFACE_BLEND_M = \d+/.test(trackSrc) && !/const BLEND = 220/.test(trackSrc));

for (const id of ["desert", "forest", "mountain", "lakeside"]) {
  const spec = SPEC[id];
  console.log(`\n${id.toUpperCase()}`);
  const track = new Track(COURSES[id], { deferBuild: true });
  track._buildSpline(COURSES[id].pieces, COURSES[id]);
  const pts = track.points;
  const length = track.length || pts[pts.length - 1].dist;

  // Patches from the spline itself — what the car actually drives on.
  const cuts = [];
  for (let k = 1; k < pts.length; k++) {
    if (pts[k].surface !== pts[k - 1].surface) {
      cuts.push({ d: (pts[k - 1].dist + pts[k].dist) / 2, from: pts[k - 1].surface, to: pts[k].surface });
    }
  }
  const patches = [];
  let a = 0;
  let cur = pts[0].surface;
  for (const c of cuts) {
    patches.push({ s: cur, a, b: c.d });
    a = c.d;
    cur = c.to;
  }
  patches.push({ s: cur, a, b: length });
  console.log("  " + patches.map((p) => `${p.s}[${Math.round(p.a)}-${Math.round(p.b)}]`).join(" "));

  const ids = new Set(patches.map((p) => p.s));
  check(`>= ${spec.n} distinct surfaces`, ids.size >= spec.n, `${ids.size}: ${[...ids].join(",")}`);
  check(`>= ${spec.m} surface switches`, cuts.length >= spec.m, `${cuts.length}`);
  const shortest = patches.reduce((m, p) => Math.min(m, p.b - p.a), 1e9);
  const longest = patches.reduce((m, p) => Math.max(m, p.b - p.a), 0);
  check(`no patch shorter than ${MIN_PATCH} m`, shortest >= MIN_PATCH, `shortest ${shortest.toFixed(0)} m`);
  check(`no patch longer than ${MAX_PATCH} m`, longest <= MAX_PATCH, `longest ${longest.toFixed(0)} m`);
  check(
    "every surface id exists in SURFACES (+ road UV scale)",
    [...ids].every((s) => SURFACES[s] && getSurface(s).id === s && new RegExp(`\\b${s}:`).test(roadUv))
  );
  if (spec.order) {
    check("starts on sand", pts[0].surface === "sand" && patches[0].b - patches[0].a >= MIN_PATCH);
    check(
      `sequence ${spec.order.join(" > ")}`,
      patches.map((p) => p.s).join(">") === spec.order.join(">"),
      patches.map((p) => p.s).join(">")
    );
  }
  check("start grid + first 40 m share one surface", pts.filter((p) => p.dist < 40).every((p) => p.surface === pts[0].surface));

  // ── transitions blended ─────────────────────────────────────────────────
  /** Weight toward the new surface: settled (from === to) counts as 0 / 1. */
  const weight = (b, c) => (b.from === b.to ? (b.to === c.to ? 1 : 0) : b.mix);
  let blendOk = true;
  let widthMin = 1e9;
  let widthMax = 0;
  let stepMax = 0;
  for (const c of cuts) {
    let lo = null;
    let hi = null;
    let prev = 0;
    for (let d = c.d - 40; d <= c.d + 40; d += 0.5) {
      const here = d < c.d ? c.from : c.to;
      const b = track._surfaceBlend(d, here);
      const w = weight(b, c);
      if (w > 0.001 && lo === null) lo = d;
      if (w > 0.999 && hi === null) hi = d;
      stepMax = Math.max(stepMax, Math.abs(w - prev) / 0.5);
      prev = w;
    }
    const w = hi !== null && lo !== null ? hi - lo : 0;
    widthMin = Math.min(widthMin, w);
    widthMax = Math.max(widthMax, w);
    const before = weight(track._surfaceBlend(c.d - 20, c.from), c);
    const after = weight(track._surfaceBlend(c.d + 20, c.to), c);
    if (before !== 0 || after !== 1 || w < 6 || w > 40) blendOk = false;
  }
  check("every transition blends (6..40 m, mix 0->1)", blendOk, `width ${widthMin.toFixed(0)}..${widthMax.toFixed(0)} m, max slope ${stepMax.toFixed(2)}/m`);
  check("blend continuous (no mix cliff)", stepMax <= 0.2, `${stepMax.toFixed(3)}/m`);

  // ── boundaries vs checkpoints / jumps / bridges / tunnels / apexes ───────
  const cps = track.checkpoints || [];
  const badCp = cuts.filter((c) => cps.some((cp) => Math.abs(cp - c.d) < KEEP));
  check(`no boundary within ${KEEP} m of a checkpoint`, badCp.length === 0, badCp.map((c) => c.d.toFixed(0)).join(","));

  const jumps = [];
  let j0 = null;
  for (const p of pts) {
    const on = !!(p.jump || p.jumpKind);
    if (on && j0 === null) j0 = p.dist;
    if (!on && j0 !== null) {
      jumps.push([j0, p.dist]);
      j0 = null;
    }
  }
  const badJump = cuts.filter((c) => jumps.some(([x, y]) => c.d > x - KEEP && c.d < y + KEEP));
  check(`no boundary within ${KEEP} m of a jump / landing pad`, badJump.length === 0, `${jumps.length} jumps; ${badJump.map((c) => c.d.toFixed(0)).join(",")}`);

  const bridges = [];
  let b0 = null;
  for (const p of pts) {
    if (p.bridge && b0 === null) b0 = p.dist;
    if (!p.bridge && b0 !== null) {
      bridges.push([b0, p.dist]);
      b0 = null;
    }
  }
  const badBridge = cuts.filter((c) => bridges.some(([x, y]) => c.d > x - 24 && c.d < y + 24));
  check("no boundary on / within 24 m of a bridge deck", badBridge.length === 0, `${bridges.length} deck(s)`);
  const deckSurf = pts.filter((p) => p.bridge).every((p) => p.surface === "tarmac");
  check("bridge decks are tarmac", deckSurf);

  const badTun = cuts.filter((c) => {
    const before = pts.find((p) => p.dist >= c.d - 6);
    const after = pts.find((p) => p.dist >= c.d + 6);
    return before && after && before.tunnel && after.tunnel;
  });
  check("no boundary inside a tunnel", badTun.length === 0, badTun.map((c) => c.d.toFixed(0)).join(","));

  // Corner apexes: the piece list gives arc spans; apex = mid arc.
  const pieces = COURSES[id].pieces;
  let d = 0;
  const apexes = [];
  for (const p of pieces) {
    const len =
      p.type === "curve"
        ? (Math.abs(p.angle * Math.PI) / 180) * p.radius
        : p.type === "straight"
          ? p.length
          : 0;
    if (p.type === "curve" && Math.abs(p.angle) >= 40) apexes.push(d + len / 2);
    if (p.type === "jump") d += 0; // jump run measured from spline below
    d += len;
  }
  // Re-anchor apexes on the spline (jump runs differ): nearest spline apex by heading change.
  const apexByHeading = [];
  let acc = 0;
  let aStart = null;
  for (let i = 1; i < pts.length; i++) {
    let dh = pts[i].heading - pts[i - 1].heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    const turning = Math.abs(dh) > 0.004;
    if (turning) {
      if (aStart === null) {
        aStart = pts[i - 1].dist;
        acc = 0;
      }
      acc += Math.abs(dh);
    } else if (aStart !== null) {
      if (acc > 0.7) apexByHeading.push((aStart + pts[i - 1].dist) / 2);
      aStart = null;
    }
  }
  const badApex = cuts.filter((c) => apexByHeading.some((x) => Math.abs(x - c.d) < APEX_KEEP));
  check(`no boundary within ${APEX_KEEP} m of a corner apex`, badApex.length === 0, `${apexByHeading.length} corners; ${badApex.map((c) => c.d.toFixed(0)).join(",")}`);
  void apexes;
}

// ── physics hand-off: grip ramps through the blend, not a cliff ───────────
{
  const track = new Track(COURSES.desert, { deferBuild: true });
  track._buildSpline(COURSES.desert.pieces, COURSES.desert);
  const c = track._surfaceCuts()[0];
  const mus = [];
  for (let d = c.d - 12; d <= c.d + 12; d += 1) {
    const b = track._surfaceBlend(d, d < c.d ? c.from : c.to);
    const sa = getSurface(b.from);
    const sb = getSurface(b.to);
    mus.push(sa.muPeak + (sb.muPeak - sa.muPeak) * b.mix);
  }
  let maxStep = 0;
  for (let i = 1; i < mus.length; i++) maxStep = Math.max(maxStep, Math.abs(mus[i] - mus[i - 1]));
  const gap = Math.abs(getSurface(c.to).muPeak - getSurface(c.from).muPeak);
  check("grip ramp: biggest per-metre mu step < 40% of the gap", maxStep < gap * 0.4, `step ${maxStep.toFixed(3)} / gap ${gap.toFixed(2)}`);
}

console.log(fail ? `\n${fail} FAIL` : "\nPASS");
process.exit(fail ? 1 : 0);
