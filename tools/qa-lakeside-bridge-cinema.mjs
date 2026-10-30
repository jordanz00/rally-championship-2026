#!/usr/bin/env node
/**
 * qa-lakeside-bridge-cinema.mjs — long, cinematic Lakeside suspension bridge gates.
 *
 * Numeric: span length, level deck, approach/exit grade, checkpoints off the
 * bridge, dressing scales with length, camera moment obeys the camera rules,
 * bridge broadcast shots frame the car, audio + attract hooks exist.
 * (Placement / sightline / water clearance live in qa-lakeside-bridge.mjs.)
 *
 * RUN: node --experimental-loader ./tools/qa-strip-query-loader.mjs tools/qa-lakeside-bridge-cinema.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COURSES } from "../js/tracks/courses.js";
import { bridgeCamWeight, bridgeSunWeight, BRIDGE_MOMENT } from "../js/gameplay/lakeside-bridge-moment.js";
import { BRIDGE_SHOTS, shotFramesPlayer, poseOnBridge } from "../js/cinema/broadcast-replay.js";

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

console.log(`LAKESIDE BRIDGE CINEMA  ·  ${new Date().toISOString()}\n`);

const SPAN_MIN = 560;
const SPAN_MAX = 720;
const GRADE_MAX = 0.09;

const pieces = COURSES.lakeside.pieces;
let d = 0;
const groups = { bridge_approach: [], bridge_span: [], bridge_exit: [] };
const cps = [];
const jumps = [];
for (const p of pieces) {
  const L = p.length || 0;
  if (groups[p.visual]) groups[p.visual].push({ d0: d, L, dy: p.dy || 0 });
  if (p.checkpoint) cps.push({ d0: d, d1: d + L });
  if (p.type === "jump") jumps.push(d);
  d += L;
}
const sum = (a, k) => a.reduce((s, x) => s + x[k], 0);
const spanLen = sum(groups.bridge_span, "L");
const apLen = sum(groups.bridge_approach, "L");
const exLen = sum(groups.bridge_exit, "L");
const apDy = sum(groups.bridge_approach, "dy");
const exDy = sum(groups.bridge_exit, "dy");
const spanDy = sum(groups.bridge_span, "dy");

check(`span ≥ ${SPAN_MIN} m and ≤ ${SPAN_MAX} m`, spanLen >= SPAN_MIN && spanLen <= SPAN_MAX, `${spanLen.toFixed(1)} m`);
check("approach + exit ≥ 120 m each", apLen >= 120 && exLen >= 120, `${apLen.toFixed(0)} / ${exLen.toFixed(0)} m`);
check("deck is level (span dy = 0)", Math.abs(spanDy) < 1e-6, `dy=${spanDy}`);
const apGrade = (Math.abs(apDy) / Math.max(1, apLen)) * 1.5;
const exGrade = (Math.abs(exDy) / Math.max(1, exLen)) * 1.5;
check(`approach peak grade ≤ ${GRADE_MAX * 100}%`, apGrade <= GRADE_MAX, `${(apGrade * 100).toFixed(1)}%`);
check(`exit peak grade ≤ ${GRADE_MAX * 100}%`, exGrade <= GRADE_MAX, `${(exGrade * 100).toFixed(1)}%`);
check("approach climbs what exit drops", Math.abs(apDy + exDy) < 0.6, `ap=${apDy.toFixed(1)} ex=${exDy.toFixed(1)}`);
const bLo = groups.bridge_approach[0].d0;
const lastEx = groups.bridge_exit[groups.bridge_exit.length - 1];
const bHi = lastEx.d0 + lastEx.L;
check("no jump / lip inside the bridge run", !jumps.some((j) => j >= bLo - 1 && j <= bHi + 1));
check("no checkpoint on approach / span / exit", cps.every((c) => c.d1 < bLo - 1 || c.d0 > bHi + 1), `run ${bLo.toFixed(0)}–${bHi.toFixed(0)} m, cps ${cps.map((c) => c.d0.toFixed(0)).join(",")}`);
check("every checkpoint ≥ 60 m clear of the ramps", cps.every((c) => c.d1 < bLo - 60 || c.d0 > bHi + 60));

// Dressing scales with span length (builder lives in track.js).
const track = read("js/tracks/track.js");
check("hanger spacing scales with span (≈9 m)", /spanM \/ 9/.test(track));
check("tower height scales with main span", /towerH\s*=[^;]*chordLen/.test(track));
check("cable sag capped under tower height", /mainSag[^;]*towerH/.test(track));
check("builder publishes tower distances", /towerDists = \[/.test(track));
const defSrc = read("js/tracks/track-definition.js");
check("bridge run exempt from 480 m straight cap", /BRIDGE_SPAN_MAX/.test(defSrc) && /out\.bridge && piece\.length/.test(defSrc));

// Camera moment obeys the rules.
const moment = read("js/gameplay/lakeside-bridge-moment.js");
const game = read("js/game.js");
const cfg = read("js/config.js");
check("camera moment never writes FOV", !/camera\.fov|\.fov\s*=/.test(moment));
check("medium speedFovScale stays 0", /speedFovScale:\s*0,/.test(cfg));
check("CALM CAMERA cancels the bridge pull-back", /_bridgeCamAmount\(mode, dt\) \{[\s\S]{0,320}!this\._calmCam/.test(game));
check("pull-back is medium-view only", /_bridgeCamAmount\(mode, dt\) \{[\s\S]{0,400}mode\.id === "medium"/.test(game));
check("camera pull-back small (back ≤ 1.0 m, height ≤ 0.5 m)", BRIDGE_MOMENT.cam.back <= 1.0 && BRIDGE_MOMENT.cam.height <= 0.5, `${BRIDGE_MOMENT.cam.back} / ${BRIDGE_MOMENT.cam.height}`);
const span0 = groups.bridge_span[0].d0;
const br = { dist0: span0, dist1: span0 + spanLen };
check("cam weight 0 well before entry", bridgeCamWeight(br.dist0 - 200, br) === 0);
check("cam weight rises into the span", bridgeCamWeight(br.dist0 + 30, br) > 0.8);
check("cam weight settled mid-span (0.6–0.8)", (() => {
  const w = bridgeCamWeight((br.dist0 + br.dist1) / 2, br);
  return w > 0.6 && w < 0.8;
})());
check("cam weight eases to 0 after the deck", bridgeCamWeight(br.dist1 + BRIDGE_MOMENT.cam.outM + 5, br) === 0);
check("sun weight 0 away from bridge, 1 mid-span", bridgeSunWeight(br.dist0 - 400, br) === 0 && bridgeSunWeight((br.dist0 + br.dist1) / 2, br) > 0.99);
check("golden-hour grade never writes exposure / light intensity", !/toneMappingExposure|\.intensity\s*=/.test(moment));
check("no bloom / post change in the bridge module", !/bloom|postfx|strength/i.test(moment));

// Cinema + audio hooks.
const engine = read("js/audio/engine.js");
check("audio: setBridge / bridgeJoint / bridgeTower", /setBridge\(w\)/.test(engine) && /bridgeJoint\(speed\)/.test(engine) && /bridgeTower\(speed\)/.test(engine));
const fakeTrack = {
  _lakesideBridge: br,
  sample: (dist, out) => Object.assign(out || {}, { x: 0, y: 10, z: dist, nx: 1, nz: 0, tunnel: false }),
};
const pose = { x: 0, y: 10, z: br.dist0 + 200, yaw: 0, pitch: 0, roll: 0, speed: 40, progress: br.dist0 + 200, steer: 0, brake: 0, handbrake: 0 };
check("poseOnBridge true on span, false off", poseOnBridge(fakeTrack, pose) && !poseOnBridge(fakeTrack, { ...pose, progress: br.dist0 - 300 }));
for (const kind of BRIDGE_SHOTS) {
  check(`broadcast ${kind} frames the car`, shotFramesPlayer(kind, pose, fakeTrack, { aspect: 16 / 9, side: 1, scratch: {} }));
}
const reel = read("js/cinema/attract-reel.js");
check("attract reel has bridge beats", /SUSPENSION BRIDGE/.test(reel) && /TOWER PORTAL/.test(reel));
check("light-shaft + mist counts are tier bounded", BRIDGE_MOMENT.tiers.min.shafts === 0 && BRIDGE_MOMENT.tiers.min.mist === 0 && BRIDGE_MOMENT.tiers.high.shafts <= 48 && BRIDGE_MOMENT.tiers.high.mist <= 2);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "bridge long + cinematic"}`);
process.exit(fail ? 1 : 0);
