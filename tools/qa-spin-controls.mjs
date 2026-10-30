/**
 * Gate: spin-out / mid-air 180° does not reverse the wheel.
 *
 * Left stays left, throttle stays nose-forward, through a full 360°.
 *
 * RUN: node --experimental-loader ./tools/qa-strip-query-loader.mjs tools/qa-spin-controls.mjs
 */
import { COURSES } from "../js/tracks/courses.js";
import { Track } from "../js/tracks/track.js";
import { Vehicle } from "../js/physics/vehicle.js";
import { CARS, FIXED_DT } from "../js/config.js";

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function wrapPi(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

const track = new Track(COURSES.desert, { deferBuild: true });
track._buildSpline(COURSES.desert.pieces, COURSES.desert);

function makeCar(yawOff, air) {
  const v = new Vehicle(CARS.celica);
  v.spawn(track, 80, 0);
  const heading = v.yaw;
  const spd = 22;
  v.velocity.x = Math.sin(heading) * spd;
  v.velocity.z = Math.cos(heading) * spd;
  v.yaw = heading + yawOff;
  v.yawRate = 0;
  v.onGround = !air;
  if (air) {
    v.position.y += 4;
    v.velY = 2;
  }
  return { v, heading };
}

function steerSign(yawOff, air, steer) {
  const { v } = makeCar(yawOff, air);
  const yaw0 = v.yaw;
  const input = { throttle: 0.55, brake: 0, steer, handbrake: false };
  for (let i = 0; i < 12; i++) v.step(FIXED_DT, input, track);
  return Math.sign(wrapPi(v.yaw - yaw0)) || Math.sign(v.yawRate);
}

console.log(`SPIN CONTROLS  ·  ${new Date().toISOString()}\n`);

check("left steer yaws left while facing down the road", steerSign(0, false, 1) > 0);
check("right steer yaws right while facing down the road", steerSign(0, false, -1) < 0);

for (const deg of [90, 135, 180, 225, 270, 360]) {
  const off = (deg * Math.PI) / 180;
  const left = steerSign(off, false, 1);
  const right = steerSign(off, false, -1);
  check(`left steer yaws left at ${deg}° spin`, left > 0, `sign ${left}`);
  check(`right steer yaws right at ${deg}° spin`, right < 0, `sign ${right}`);
}

check("left steer yaws left in mid-air 180°", steerSign(Math.PI, true, 1) > 0);
check("right steer yaws right in mid-air 180°", steerSign(Math.PI, true, -1) < 0);

{
  const { v, heading } = makeCar(Math.PI, false);
  const yaw0 = v.yaw;
  const input = { throttle: 0.7, brake: 0, steer: 0, handbrake: false };
  for (let i = 0; i < 45; i++) v.step(FIXED_DT, input, track);
  const drift = Math.abs(wrapPi(v.yaw - yaw0));
  const snapped = Math.abs(wrapPi(v.yaw - heading)) < 0.35;
  check("180° spin is not snapped back to travel", !snapped && drift < 0.9, `Δyaw ${(drift * 180 / Math.PI).toFixed(0)}°`);
}

if (fail) {
  console.log(`\nFAIL  ·  ${fail} check(s) failed`);
  process.exit(1);
}
console.log("\nPASS  ·  spin-out does not reverse the wheel");
process.exit(0);
