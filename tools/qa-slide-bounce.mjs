#!/usr/bin/env node
/**
 * QA — slide / drift / e-brake / throttle plant uses the ribbon plane.
 *
 * Static contracts plus a Vehicle pin probe: noisy query heights must not
 * hop world Y. Yaw is untouched. Jumps stay off the pin.
 *
 * RUN: node --experimental-loader ./tools/qa-strip-query-loader.mjs tools/qa-slide-bounce.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Vehicle } from "../js/physics/vehicle.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "js/physics/vehicle.js"), "utf8");
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`PASS  ${name}${detail ? `  —  ${detail}` : ""}`);
  else {
    console.error(`FAIL  ${name}${detail ? `  —  ${detail}` : ""}`);
    failed += 1;
  }
}

check("stable deck helper exists", /_stableDeckY\(q, fallback\)/.test(src));
check("pin uses ribbon minus micro", /baseHeight - \(q\.roadMicro/.test(src));
check("maneuver pin is the glue", /_pinManeuverDeck\(\)/.test(src));
check("accel and slide share the Y plant", /_wantPlantedDeck\(\)/.test(src));
check(
  "no raw query hop in last-word plant",
  !/this\.position\.y = this\._q\.height - TIRE_PLANT/.test(src)
);
check(
  "roll damp while planted",
  /_keepDeckPlanted\(\) \{\n[\s\S]*?_suspRollRate \*= Math\.exp/.test(src) ||
    /ground && this\._keepDeckPlanted\(\)/.test(src)
);
check("ay smoothed in a slide", /_keepDeckPlanted\(\) \? 0\.12/.test(src));
check(
  "step does not wipe maneuver Y",
  !/this\._capturePrev\(\);\s*this\._maneuverY = null/.test(src)
);
check("throttle plants world Y", /this\.throttle > 0\.16/.test(src));
check("one pin follow per tick", /this\._maneuverPinned/.test(src));
check("query chatter is deadzoned", /Math\.abs\(err\) <= 0\.035/.test(src));
check("per-tick Y follow is capped", /dy > 0\.006/.test(src));
check("play-turn lock still lives", /maxSteer \* 1\.28/.test(src) && /kus \*= 0\.55/.test(src));
check("GO rush window is 1.18 s", /const GO_RUSH_S = 1\.18/.test(src));
check("GO rush drive is 1.22×", /const GO_RUSH_DRIVE = 1\.22/.test(src));

/**
 * Drive the pin the way step() does: clear the once-per-tick flag, leave
 * `_maneuverY` alone, feed a noisy query, measure world Y.
 * @param {{handbrake:number,steer:number,throttle:number,brake?:number}} input
 * @param {(i:number)=>object} queryAt
 * @param {number} [n=180]
 */
function probePin(input, queryAt, n = 180) {
  const v = new Vehicle();
  v.onGround = true;
  v.handbrake = input.handbrake;
  v.steer = input.steer;
  v.throttle = input.throttle;
  v.brake = input.brake || 0;
  v.position.y = 10;
  v._maneuverY = null;
  v._maneuverPinned = false;
  v._maneuverFollow = 0;
  const ys = [];
  const yaws = [];
  const yaw0 = 0.42;
  v.yawRate = yaw0;
  for (let i = 0; i < n; i++) {
    v._maneuverPinned = false;
    v._q = queryAt(i);
    v._pinManeuverDeck();
    ys.push(v.position.y);
    yaws.push(v.yawRate);
  }
  let maxStep = 0;
  let absSum = 0;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (let i = 1; i < ys.length; i++) {
    const d = Math.abs(ys[i] - ys[i - 1]);
    if (d > maxStep) maxStep = d;
    absSum += d;
    if (ys[i] < yMin) yMin = ys[i];
    if (ys[i] > yMax) yMax = ys[i];
  }
  const body = ys.slice(8);
  let bMin = Infinity;
  let bMax = -Infinity;
  for (let i = 0; i < body.length; i++) {
    if (body[i] < bMin) bMin = body[i];
    if (body[i] > bMax) bMax = body[i];
  }
  return {
    maxStep,
    meanStep: absSum / Math.max(1, ys.length - 1),
    span: yMax - yMin,
    settledSpan: bMax - bMin,
    lastY: ys[ys.length - 1],
    yawHeld: yaws.every((r) => Math.abs(r - yaw0) < 1e-9),
    pinned: v._pinManeuverDeck() || v._maneuverPinned,
  };
}

function chatterQuery(i) {
  const micro = 0.05 * Math.sin(i * 0.9);
  return {
    onRoad: true,
    tunnel: false,
    baseHeight: 10.014 + 0.08 * Math.sin(i * 1.7) + micro,
    roadMicro: micro,
    height: 10.014 + 0.12 * Math.sin(i * 2.2),
    wheelDeform: 0.02 * Math.sin(i * 1.1),
    jumpKind: "",
  };
}

const ebrake = probePin({ handbrake: 1, steer: 0.85, throttle: 1 }, chatterQuery);
check(
  "e-brake + steer + throttle max |ΔY| < 8 mm",
  ebrake.maxStep < 0.008,
  `${(ebrake.maxStep * 1000).toFixed(2)} mm`
);
check(
  "e-brake + steer + throttle jitter < 3 mm",
  ebrake.meanStep < 0.003,
  `${(ebrake.meanStep * 1000).toFixed(2)} mm mean`
);
check(
  "e-brake settled span < 2 cm",
  ebrake.settledSpan < 0.02,
  `${(ebrake.settledSpan * 1000).toFixed(1)} mm`
);
check("e-brake pin does not kill yawRate", ebrake.yawHeld);

const accel = probePin({ handbrake: 0, steer: 0, throttle: 1 }, chatterQuery);
check(
  "throttle-only accel max |ΔY| < 8 mm",
  accel.maxStep < 0.008,
  `${(accel.maxStep * 1000).toFixed(2)} mm`
);
check(
  "throttle-only accel jitter < 3 mm",
  accel.meanStep < 0.003,
  `${(accel.meanStep * 1000).toFixed(2)} mm mean`
);

const drift = probePin({ handbrake: 0.8, steer: -0.7, throttle: 0.7, brake: 0.2 }, chatterQuery);
check(
  "powerslide max |ΔY| < 8 mm",
  drift.maxStep < 0.008,
  `${(drift.maxStep * 1000).toFixed(2)} mm`
);

const jumpV = new Vehicle();
jumpV.onGround = true;
jumpV.handbrake = 1;
jumpV.throttle = 1;
jumpV._q = { onRoad: true, baseHeight: 10, roadMicro: 0, jumpKind: "ramp" };
check("ramp / gap still skip the pin", jumpV._pinManeuverDeck() === false);

if (failed) {
  console.error(`Slide bounce QA failed: ${failed}`);
  process.exit(1);
}
console.log("Slide bounce QA passed.");
