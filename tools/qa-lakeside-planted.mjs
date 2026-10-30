#!/usr/bin/env node
/**
 * qa-lakeside-planted.mjs — Stage 4 (Lakeside) car-stays-planted contract.
 *
 * Proves, with measured numbers, that nothing along the stage can sink the
 * chassis, float it, or launch it off a lip, and that the suspension-bridge
 * deck / rails / shore basin agree with Track.query() (the single height
 * authority). Node-runnable: real Track spline + real Vehicle at FIXED_DT.
 *
 *   1 STATIC   spline grade + lip continuity per section, query == visual road
 *              mesh height, kerb step, verge never above the deck, bridge deck
 *              dead level, land/water under the ribbon, bridge rail colliders.
 *   2 DYNAMIC  the real Vehicle drives the WHOLE stage (centre line, throttle
 *              on) and the bridge climb / span / descent on lanes -6 / +6 /
 *              ±9 m. Chassis Y is compared to the road plane every tick.
 *   3 RAIL     the car is rammed at the bridge rail from both sides; it must
 *              stay on the deck and on the deck plane.
 *
 * Authored jump pieces (ramp / crest / gap / land + 25 m settle) are exempt —
 * they are the only intended air.
 *
 * Tolerances (metres unless stated):
 *   PLANE_TOL   0.06   |chassis Y - road plane| every grounded tick (plane =
 *                      query.baseHeight - roadMicro; chassis rides the plane,
 *                      wheel probes follow the micro)
 *   SURF_TOL    0.06   |chassis Y - query.height| beyond |roadMicro| (cobble)
 *   MESH_TOL    0.06   query.height vs lerped visual road mesh on tarmac (measured max 0.02)
 *   MESH_ROUGH  0.30   same on cobble / dirt / gravel / sand: analytic micro vs a mesh
 *                      lerped between 3.4 m vertices (bounded by 2x micro amp; measured
 *                      cobble p99 0.18, max 0.27). Wheel probes only — chassis rides the plane.
 *   SEAM_STEP   0.05   height step across the kerb / between 0.5 m samples
 *   MAX_GRADE   0.14   |dy/ds| off a jump (the bridge climb is ~5-6 %)
 *   LIP_DELTA   0.045  grade change between adjacent samples off a jump
 *   BASIN_BELOW 0.30   land / water under the ribbon below the deck
 *   MAX_VELY    3.0    |vertical speed| on a grounded, non-jump tick (m/s)
 *
 * RUN: node --experimental-loader ./tools/qa-strip-query-loader.mjs tools/qa-lakeside-planted.mjs
 *      QA_LAKESIDE_FAST=1 ...   (skip the whole-stage drive; bridge windows only)
 */
import { COURSES } from "../js/tracks/courses.js";
import { Track } from "../js/tracks/track.js";
import { Vehicle } from "../js/physics/vehicle.js";
import { CARS, FIXED_DT, ROAD_DECK } from "../js/config.js";
import { roadMicroHeight } from "../js/tracks/road-micro.js";

const PLANE_TOL = 0.06;
const MESH_TOL = 0.06;
const MESH_ROUGH = 0.3;
const SEAM_STEP = 0.05;
const MAX_GRADE = 0.14;
const LIP_DELTA = 0.045;
const BASIN_BELOW = 0.3;
const MAX_VELY = 3.0;
const FAST = process.env.QA_LAKESIDE_FAST === "1";

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
const f2 = (n, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : String(n));

console.log(`LAKESIDE PLANTED  ·  ${new Date().toISOString()}${FAST ? "  (fast)" : ""}\n`);

const def = COURSES.lakeside;
const track = new Track(def, { deferBuild: true });
track._buildSpline(def.pieces, def);
track.colliders = [];
const pts = track.points;
const br = track._lakesideBridge;
check("lakeside spline compiled", pts.length > 500 && track.length > 2200, `${pts.length} pts · ${track.length.toFixed(0)} m`);
check("bridge deck tagged", !!br && br.i1 > br.i0, br ? `deck ${br.dist0.toFixed(0)}–${br.dist1.toFixed(0)} m · shore y ${f2(br.baseY, 2)}` : "none");
if (!br) process.exit(1);

// ── Section map (adapts to whatever the bridge compiles to) ──────────────────
const AP0 = (pts.find((p) => p.visual === "bridge_approach") || { dist: br.dist0 }).dist;
let EX1 = br.dist1;
for (const p of pts) if (p.visual === "bridge_exit") EX1 = Math.max(EX1, p.dist);
const SECTIONS = ["shore", "approach", "span", "exit", "post-exit", "rest"];
function sectionAt(d) {
  if (d < AP0 - 30) return "shore";
  if (d < br.dist0) return "approach";
  if (d <= br.dist1) return "span";
  if (d <= EX1 + 6) return "exit";
  if (d < EX1 + 60) return "post-exit";
  return "rest";
}
console.log(`sections: shore <${(AP0 - 30).toFixed(0)} · approach ${AP0.toFixed(0)}–${br.dist0.toFixed(0)} · span –${br.dist1.toFixed(0)} · exit –${EX1.toFixed(0)} · post-exit +60 · rest\n`);

// ── Jump zones (authored air + 25 m settle) ──────────────────────────────────
const jumpZones = [];
{
  let a = null;
  let last = null;
  for (const p of pts) {
    const j = !!(p.jump || p.jumpKind);
    if (j && a == null) a = p.dist;
    if (j) last = p.dist;
    if (!j && a != null) {
      jumpZones.push([a - 12, last + 25]);
      a = null;
    }
  }
  if (a != null) jumpZones.push([a - 12, last + 25]);
}
const inJumpZone = (d) => jumpZones.some((z) => d >= z[0] && d <= z[1]);
check("jump zones found (authored air only)", jumpZones.length >= 2, jumpZones.map((z) => `${z[0].toFixed(0)}–${z[1].toFixed(0)}`).join(" · "));

const blank = () => ({ grade: 0, gradeAt: 0, lip: 0, lipAt: 0, mesh: 0, meshAt: 0, seam: 0, seamAt: 0 });
const S = Object.fromEntries(SECTIONS.map((s) => [s, blank()]));

// ── 1a. Spline grade / lip continuity ────────────────────────────────────────
for (let i = 1; i < pts.length - 1; i++) {
  const a = pts[i - 1];
  const b = pts[i];
  const c = pts[i + 1];
  if (inJumpZone(b.dist)) continue;
  const g0 = (b.y - a.y) / Math.max(0.01, b.dist - a.dist);
  const g1 = (c.y - b.y) / Math.max(0.01, c.dist - b.dist);
  const s = S[sectionAt(b.dist)];
  if (Math.abs(g0) > s.grade) (s.grade = Math.abs(g0)), (s.gradeAt = b.dist);
  if (Math.abs(g1 - g0) > s.lip) (s.lip = Math.abs(g1 - g0)), (s.lipAt = b.dist);
}

// ── 1b. Query vs visual road mesh across the whole ribbon ────────────────────
const q = {};
const sm = {};
let offRoad = 0;
let samples = 0;
let distDrift = 0;
const mic = (pt, l) => roadMicroHeight(pt.dist, l, pt.surface, pt.jumpKind || null, !!pt.tunnel);
for (let d = 0; d < track.length - 2; d += 1) {
  if (inJumpZone(d)) continue;
  const p = track.sample(d, sm);
  let lo = 0;
  let hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].dist < d) lo = mid + 1;
    else hi = mid;
  }
  const i1 = Math.max(1, lo);
  const pa = pts[i1 - 1];
  const pb = pts[i1];
  const t = Math.min(1, Math.max(0, (d - pa.dist) / (pb.dist - pa.dist || 1)));
  const s = S[sectionAt(d)];
  const h = p.width * 0.5;
  for (const frac of [-0.98, -0.75, -0.4, 0, 0.4, 0.75, 0.98]) {
    const lat = frac * h;
    const r = track.query(p.x + p.nx * lat, p.z + p.nz * lat, q, d);
    samples += 1;
    const yPt = (pt) => {
      const hh = pt.width * 0.5;
      const yl = pt.y + ROAD_DECK + mic(pt, hh);
      const yr = pt.y + ROAD_DECK + mic(pt, -hh);
      return yl + (yr - yl) * Math.min(1, Math.max(0, (hh - lat) / (2 * hh)));
    };
    const visual = yPt(pa) + (yPt(pb) - yPt(pa)) * t;
    const e = Math.abs(r.height - visual);
    const tol = pa.surface === "tarmac" && pb.surface === "tarmac" ? MESH_TOL : MESH_ROUGH;
    // Normalise so one tolerance per section works: report excess over its own tol.
    const norm = e * (MESH_TOL / tol);
    if (norm > s.mesh) (s.mesh = norm), (s.meshAt = d);
    if (!r.onRoad) offRoad += 1;
    distDrift = Math.max(distDrift, Math.abs(r.dist - d));
  }
}
check("every in-ribbon sample onRoad", offRoad === 0, `${samples} samples · ${offRoad} off`);
check("query.dist tracks the hinted progress", distDrift < 2.2, `max drift ${f2(distDrift, 2)} m`);

// ── 1c. Height step between 0.5 m samples minus authored grade ───────────────
for (const lat of [0, 0.7]) {
  let prevH = null;
  let prevY = null;
  for (let d = 0; d < track.length - 2; d += 0.5) {
    if (inJumpZone(d)) {
      prevH = null;
      continue;
    }
    const p = track.sample(d, sm);
    const r = track.query(p.x + p.nx * lat * p.width * 0.5, p.z + p.nz * lat * p.width * 0.5, q, d);
    if (prevH != null) {
      const s = S[sectionAt(d)];
      const step = Math.abs(r.height - prevH) - Math.abs(p.y - prevY);
      if (step > s.seam) (s.seam = step), (s.seamAt = d);
    }
    prevH = r.height;
    prevY = p.y;
  }
}

// ── 1d. Kerb crossing + verge never lifts above the paint ────────────────────
let worstEdge = 0;
let worstEdgeAt = 0;
let worstLift = 0;
let worstLiftAt = 0;
for (let d = 0; d < track.length - 2; d += 2) {
  if (inJumpZone(d)) continue;
  const p = track.sample(d, sm);
  const h = p.width * 0.5;
  for (const side of [-1, 1]) {
    const hAt = (off) => track.query(p.x + p.nx * side * (h + off), p.z + p.nz * side * (h + off), q, d).height;
    const inH = hAt(-0.05);
    const edgeH = hAt(0.05);
    if (Math.abs(inH - edgeH) > worstEdge) (worstEdge = Math.abs(inH - edgeH)), (worstEdgeAt = d);
    for (const off of [0.3, 0.6, 1, 1.5, 2, 3]) {
      const v = hAt(off);
      if (v - inH > worstLift) (worstLift = v - inH), (worstLiftAt = d);
    }
  }
}
check("kerb crossing step", worstEdge <= SEAM_STEP, `max ${f2(worstEdge)} m @ ${worstEdgeAt.toFixed(0)} m (tol ${SEAM_STEP})`);
check("verge never lifts above the paint", worstLift <= 0.02, `max +${f2(worstLift)} m @ ${worstLiftAt.toFixed(0)} m`);

console.log("\nSection       grade%  @dist   lipΔ/pt  mesh-err(norm)  seam/0.5m");
for (const s of SECTIONS) {
  const x = S[s];
  console.log(
    `  ${s.padEnd(10)} ${(x.grade * 100).toFixed(2).padStart(6)} ${x.gradeAt.toFixed(0).padStart(6)}   ${x.lip.toFixed(4)}   ${x.mesh.toFixed(4)}          ${x.seam.toFixed(4)}`
  );
}
console.log("");
for (const s of SECTIONS) {
  const x = S[s];
  check(`${s}: grade ≤ ${(MAX_GRADE * 100).toFixed(0)}%`, x.grade <= MAX_GRADE, `${(x.grade * 100).toFixed(2)}% @ ${x.gradeAt.toFixed(0)} m`);
  check(`${s}: no lip (Δgrade/pt ≤ ${LIP_DELTA})`, x.lip <= LIP_DELTA, `${f2(x.lip, 4)} @ ${x.lipAt.toFixed(0)} m`);
  check(`${s}: query = visual road mesh`, x.mesh <= MESH_TOL, `${f2(x.mesh, 4)} m @ ${x.meshAt.toFixed(0)} m`);
  check(`${s}: no height seam between 0.5 m samples`, x.seam <= SEAM_STEP, `${f2(x.seam, 4)} m @ ${x.seamAt.toFixed(0)} m`);
}

// ── 1e. Bridge deck level; query uses the deck (not shore / water) ───────────
{
  let ymin = Infinity;
  let ymax = -Infinity;
  for (let i = br.i0; i <= br.i1; i++) {
    ymin = Math.min(ymin, pts[i].y);
    ymax = Math.max(ymax, pts[i].y);
  }
  check("span deck dead level", ymax - ymin < 0.01, `${f2(ymax - ymin, 4)} m`);
  let worstSpan = 0;
  for (let i = br.i0; i <= br.i1; i += 2) {
    const p = pts[i];
    for (const f of [-0.9, 0, 0.9]) {
      const r = track.query(p.x + p.nx * f * p.width * 0.5, p.z + p.nz * f * p.width * 0.5, q, p.dist);
      worstSpan = Math.max(worstSpan, Math.abs(r.height - (p.y + ROAD_DECK)) - 0.03);
      if (r.height < br.baseY + 3) worstSpan = 99;
    }
  }
  check("query on span = deck (never shore / water)", worstSpan <= 0.03, `deck ${f2(pts[br.i0].y + ROAD_DECK, 2)} · shore ${f2(br.baseY, 2)}`);

  let worstLand = -Infinity;
  let worstLandAt = 0;
  for (let i = Math.max(0, br.i0 - 40); i <= Math.min(pts.length - 1, br.i1 + 40); i++) {
    const p = pts[i];
    if (inJumpZone(p.dist)) continue;
    for (const f of [-1.15, -0.5, 0, 0.5, 1.15]) {
      const g = track._groundHeight(p.x + p.nx * f * p.width * 0.5, p.z + p.nz * f * p.width * 0.5, "lakeside");
      const over = g - (p.y + ROAD_DECK - BASIN_BELOW);
      if (over > worstLand) (worstLand = over), (worstLandAt = p.dist);
    }
  }
  check(`land/water under bridge ribbon ≥ ${BASIN_BELOW} m below deck`, worstLand <= 0, `worst ${f2(worstLand)} m @ ${worstLandAt.toFixed(0)} m`);

  let worst = -Infinity;
  let at = 0;
  for (let i = 0; i < pts.length; i += 2) {
    const p = pts[i];
    if (inJumpZone(p.dist)) continue;
    for (const f of [-1, 0, 1]) {
      const lat = f * (p.width * 0.5 + 0.5);
      const g = track._groundHeight(p.x + p.nx * lat, p.z + p.nz * lat, "lakeside");
      if (g - (p.y + ROAD_DECK - 0.1) > worst) (worst = g - (p.y + ROAD_DECK - 0.1)), (at = p.dist);
    }
  }
  check("land never above the deck within ribbon + 0.5 m (whole stage)", worst <= 0, `worst ${f2(worst)} m @ ${at.toFixed(0)} m`);
}

// ── 1f. Bridge rails are physical, outside the paint, cover the span ─────────
let rails = [];
{
  track._addLakesideBridgeRails();
  rails = track.colliders.filter((c) => c.kind === "wall" && c.bridgeRail);
  check("bridge rail wall colliders exist", rails.length >= 2 * (br.i1 - br.i0) - 2, `${rails.length} faces over ${(br.dist1 - br.dist0).toFixed(0)} m`);
  let minClear = Infinity;
  let maxClear = -Infinity;
  let normalsOk = true;
  for (const c of rails) {
    const r = track.query(c.x, c.z, q, undefined);
    const clear = Math.abs(r.lateral) - r.width * 0.5;
    minClear = Math.min(minClear, clear);
    maxClear = Math.max(maxClear, clear);
    if (!(-(c.nx * r.nx + c.nz * r.nz) * Math.sign(r.lateral) > 0.95)) normalsOk = false;
  }
  check("rail faces at/just outside the paint edge", rails.length > 0 && minClear >= -0.001 && maxClear <= 0.6, `clear ${f2(minClear)}…${f2(maxClear)} m`);
  check("rail face normals point into the lane", rails.length > 0 && normalsOk);
  let gaps = 0;
  for (let d = br.dist0 + 1; d <= br.dist1 - 1; d += 3) {
    const p = track.sample(d, sm);
    for (const side of [-1, 1]) {
      const x = p.x + p.nx * side * (p.width * 0.5 + 0.25);
      const z = p.z + p.nz * side * (p.width * 0.5 + 0.25);
      const hit = rails.some((c) => {
        const along = (x - c.x) * c.tx + (z - c.z) * c.tz;
        const dist = (x - c.x) * c.nx + (z - c.z) * c.nz;
        return Math.abs(along) <= c.halfLen + 0.2 && Math.abs(dist) <= 0.6;
      });
      if (!hit) gaps += 1;
    }
  }
  check("rails cover the whole span, both sides", gaps === 0, `${gaps} uncovered 3 m bays`);
  // The lane-opening pass must not shove or drop rail faces (they sit outside the paint).
  const before = rails.map((c) => [c.x, c.z]);
  const n0 = track.colliders.length;
  track._openDriveLane();
  const moved = rails.filter((c, i) => Math.hypot(c.x - before[i][0], c.z - before[i][1]) > 1e-6).length;
  check("_openDriveLane leaves every rail in place", track.colliders.length === n0 && moved === 0, `${track.colliders.length}/${n0} kept · ${moved} moved`);
}

// ── 2/3. Dynamic: real Vehicle, real physics ─────────────────────────────────
const tmpS = {};
function ctrl(v, lane, vmax) {
  const prog = v.progress;
  const look = Math.max(10, Math.min(34, v.speed * 0.55));
  const s = track.sample(prog + look, tmpS);
  const dx = s.x + s.nx * lane - v.position.x;
  const dz = s.z + s.nz * lane - v.position.z;
  let e = Math.atan2(dx, dz) - v.yaw;
  while (e > Math.PI) e -= 2 * Math.PI;
  while (e < -Math.PI) e += 2 * Math.PI;
  let kmax = 0;
  const h0 = track.sample(prog + 4, tmpS).heading;
  for (let k = 12; k <= 70; k += 14) {
    let dh = track.sample(prog + k, tmpS).heading - h0;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    kmax = Math.max(kmax, Math.abs(dh) / (k - 4));
  }
  const vt = Math.min(vmax, kmax > 1e-4 ? Math.sqrt(7.5 / kmax) : vmax);
  const sp = v.speed || 0;
  return {
    steer: Math.max(-1, Math.min(1, e * 1.8)),
    throttle: sp < vt ? Math.min(1, (vt - sp) * 0.5 + 0.2) : 0,
    brake: sp > vt + 2 ? Math.min(1, (sp - vt) * 0.15) : 0,
    handbrake: 0,
    shiftUp: false,
    shiftDown: false,
  };
}

/** Per-section dynamic stats. */
function drive({ lane, startD, endD, vmax = 30, label }) {
  const v = new Vehicle(CARS.celica);
  v.spawn(track, startD, lane);
  const D = Object.fromEntries(
    SECTIONS.map((s) => [s, { n: 0, plane: 0, planeAt: 0, below: 0, above: 0, velY: 0, air: 0, surfExcess: 0 }])
  );
  const qq = {};
  let stuck = 0;
  let last = v.progress;
  let steps = 0;
  let maxLat = 0;
  const glitch0 = v._glitchHits || 0;
  for (; steps < 40000; steps++) {
    v.step(FIXED_DT, ctrl(v, lane, vmax), track);
    track.query(v.position.x, v.position.z, qq, v.progress);
    const d = v.progress;
    if (d >= endD) break;
    if (steps % 180 === 0) {
      if (v.progress - last < 0.5) stuck += 1;
      last = v.progress;
      if (stuck > 5) break;
    }
    if (inJumpZone(d) || qq.jumpKind) continue;
    const s = D[sectionAt(d)];
    s.n += 1;
    const plane = qq.baseHeight - qq.roadMicro;
    const gap = v.position.y - plane;
    if (Math.abs(gap) > s.plane) (s.plane = Math.abs(gap)), (s.planeAt = d);
    if (gap < s.below) s.below = gap;
    if (gap > s.above) s.above = gap;
    s.velY = Math.max(s.velY, Math.abs(v.velY || 0));
    if (!v.onGround) s.air += 1;
    const surf = Math.abs(v.position.y - qq.height) - Math.abs(qq.roadMicro);
    if (surf > s.surfExcess) s.surfExcess = surf;
    maxLat = Math.max(maxLat, Math.abs(qq.lateral));
  }
  return { label, lane, steps, end: v.progress, stuck, D, maxLat, glitch: (v._glitchHits || 0) - glitch0 };
}

function report(run, wantSections) {
  console.log(`\n${run.label}: lane ${run.lane} · ${run.steps} ticks · reached ${run.end.toFixed(0)} m · maxLat ${run.maxLat.toFixed(1)} · glitch events ${run.glitch}`);
  console.log("  section     n    planeΔmax  @dist  below   above   |velY|  air");
  for (const s of SECTIONS) {
    const x = run.D[s];
    if (!x.n) continue;
    console.log(
      `  ${s.padEnd(10)} ${String(x.n).padStart(5)}  ${x.plane.toFixed(3)}   ${x.planeAt.toFixed(0).padStart(6)}  ${x.below.toFixed(3)}  ${x.above.toFixed(3)}  ${x.velY.toFixed(2)}   ${x.air}`
    );
  }
  for (const s of wantSections) {
    const x = run.D[s];
    if (!x.n) continue;
    check(`${run.label} ${s}: chassis on road plane ±${PLANE_TOL}`, x.plane <= PLANE_TOL, `${f2(x.plane)} m @ ${x.planeAt.toFixed(0)} m`);
    check(`${run.label} ${s}: never above surface+micro`, x.surfExcess <= PLANE_TOL, `${f2(x.surfExcess)} m`);
    check(`${run.label} ${s}: grounded, |velY| ≤ ${MAX_VELY}`, x.air === 0 && x.velY <= MAX_VELY, `air ${x.air} · velY ${f2(x.velY, 2)}`);
  }
}

const windowStart = Math.max(6, AP0 - 150);
const windowEnd = Math.min(track.length - 40, EX1 + 150);
if (!FAST) {
  const full = drive({ lane: 0, startD: 6, endD: track.length - 25, label: "whole stage" });
  check("whole stage drive completed", full.end >= track.length - 40 && full.stuck <= 5, `${full.end.toFixed(0)} / ${track.length.toFixed(0)} m`);
  report(full, SECTIONS);
}
for (const lane of [-6, 6, -9, 9]) {
  const w = drive({ lane, startD: windowStart, endD: windowEnd, label: `bridge window` });
  report(w, ["approach", "span", "exit", "post-exit"]);
  const mid = w.D.span.n > 0;
  check(`bridge window lane ${lane}: reached the span`, mid);
}

// ── 3. Ram the rails ─────────────────────────────────────────────────────────
for (const side of [-1, 1]) {
  for (const deg of [12, 30, 55]) {
    const v = new Vehicle(CARS.celica);
    const d0 = (br.dist0 + br.dist1) * 0.5 - 60;
    v.spawn(track, d0, side * 6);
    const p0 = track.sample(d0, tmpS);
    // Warm to ~26 m/s along the road, then yaw toward the rail.
    for (let i = 0; i < 70; i++) v.step(FIXED_DT, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, track);
    const sp = 26;
    const yaw = p0.heading + side * (deg * Math.PI) / 180;
    v.yaw = yaw;
    v.velocity.set(Math.sin(yaw) * sp, 0, Math.cos(yaw) * sp);
    v.speed = sp;
    const qq = {};
    let maxLat = 0;
    let maxGap = 0;
    let minY = Infinity;
    for (let i = 0; i < 150; i++) {
      v.step(FIXED_DT, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, track);
      track.query(v.position.x, v.position.z, qq, v.progress);
      maxLat = Math.max(maxLat, Math.abs(qq.lateral) - qq.width * 0.5);
      maxGap = Math.max(maxGap, Math.abs(v.position.y - (qq.baseHeight - qq.roadMicro)));
      minY = Math.min(minY, v.position.y - qq.height);
    }
    check(
      `ram rail side ${side > 0 ? "+" : "-"} ${deg}°: centre stays on the deck`,
      maxLat <= 0.12 && maxGap <= PLANE_TOL,
      `max overhang ${f2(maxLat)} m · plane gap ${f2(maxGap)} m`
    );
  }
}

// Negative control: without the rail faces the same ram must leave the deck,
// proving the ram test has teeth.
{
  const keep = track.colliders;
  track.colliders = keep.filter((c) => !c.bridgeRail);
  track._colGrid = null;
  const v = new Vehicle(CARS.celica);
  const d0 = (br.dist0 + br.dist1) * 0.5 - 60;
  v.spawn(track, d0, 6);
  const p0 = track.sample(d0, tmpS);
  for (let i = 0; i < 70; i++) v.step(FIXED_DT, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, track);
  const yaw = p0.heading + (55 * Math.PI) / 180;
  v.yaw = yaw;
  v.velocity.set(Math.sin(yaw) * 26, 0, Math.cos(yaw) * 26);
  v.speed = 26;
  const qq = {};
  let over = 0;
  for (let i = 0; i < 150; i++) {
    v.step(FIXED_DT, { throttle: 1, brake: 0, steer: 0, handbrake: 0 }, track);
    track.query(v.position.x, v.position.z, qq, v.progress);
    over = Math.max(over, Math.abs(qq.lateral) - qq.width * 0.5);
  }
  track.colliders = keep;
  track._colGrid = null;
  check("control: same ram WITHOUT rails leaves the deck", over > 0.5, `overhang ${f2(over)} m`);
}

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Lakeside plants the car end to end"}`);
process.exit(fail ? 1 : 0);
