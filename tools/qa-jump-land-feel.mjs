#!/usr/bin/env node
/**
 * qa-jump-land-feel.mjs — abrupt, variable landings (attitude + roadway + shocks).
 *
 * Player moment: the pad hit is a thud. Nose / tail / camber / pad grade
 * change which corners squash. Same lip, different line, different plant.
 *
 * RUN: node tools/qa-jump-land-feel.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readCacheVersions } from "./qa-cache-version.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`JUMP LAND FEEL  ·  ${new Date().toISOString()}\n`);

const jump = read("js/physics/jump.js");
const vehicle = read("js/physics/vehicle.js");
const main = read("js/main.js");
const index = read("index.html");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

check("no Math.random in jump model", !/Math\.random/.test(jump));
check("land reads pad grade + axle heights", /padGrade/.test(jump) && /frontH/.test(jump) && /rearH/.test(jump));
check("land returns rollBias + roadBias", /rollBias/.test(jump) && /roadBias/.test(jump));
check("vehicle passes roadway into land()", /frontH: axles/.test(vehicle) && /camber: this\._roadRoll/.test(vehicle));
check("hull follows land spring, not 12mm glue", /plantDeck - sink/.test(vehicle) && /landSink/.test(vehicle));
check("per-corner land heave", /heaveFL/.test(vehicle) && /_landRollBias/.test(vehicle));
check("from-air spring is underdamped on mismatch", /crooked > 0\.22 \? 0\.58/.test(vehicle));
check("leave visPitch is air pose, not road snap", /this\._visPitch = this\.pitch/.test(vehicle));
check("live knobs: absorb < 0.7, zeta < 0.7, max sink ≥ 0.24", /landVelAbsorb = 0\.58/.test(vehicle) && /landCompressZeta = 0\.62/.test(vehicle) && /landCompressMax = 0\.28/.test(vehicle));
check(
  "cache-bust",
  cacheOk && Number(mainV) >= 1250 && Number((vehicle.match(/jump\.js\?v=(\d+)/) || [])[1]) >= 44,
  `main=${mainV} game=${gameV}`
);

const { JUMP } = await import(pathToFileURL(path.join(ROOT, "js/config.js")).href + "?v=260");
JUMP.landBounce = 0.28;
JUMP.landBounceImpact = 4.4;
JUMP.mismatchFull = 0.16;
JUMP.landVelAbsorb = 0.58;

const { JumpModel } = await import(pathToFileURL(path.join(ROOT, "js/physics/jump.js")).href);

function hit(nose, extra = {}) {
  const j = new JumpModel();
  j.reset();
  j.noseUp = nose;
  j.roll = extra.roll || 0;
  return j.land(-8, 32, extra);
}

const tail = hit(0.35);
const nose = hit(-0.36);
check("tail-first bounces more than a nose plant", tail.bounce > nose.bounce + 0.2, `tail=${tail.bounce.toFixed(2)} nose=${nose.bounce.toFixed(2)}`);
check("nose plant scrubs more", nose.scrub < tail.scrub, `tail=${tail.scrub.toFixed(3)} nose=${nose.scrub.toFixed(3)}`);
check("axle bias flips with attitude", tail.axleBias > 0.2 && nose.axleBias < -0.2, `tail=${tail.axleBias.toFixed(2)} nose=${nose.axleBias.toFixed(2)}`);

const uphill = hit(0.05, { frontH: 4.4, rearH: 4.0, padGrade: 0.18 });
const downhill = hit(0.05, { frontH: 4.0, rearH: 4.4, padGrade: -0.08 });
check(
  "same air, different pad → different axle load",
  uphill.axleBias > downhill.axleBias + 0.15,
  `up=${uphill.axleBias.toFixed(2)} down=${downhill.axleBias.toFixed(2)}`
);
check(
  "same air, different pad → different squash",
  Math.abs(uphill.compress - downhill.compress) > 0.002 || Math.abs(uphill.roadBias - downhill.roadBias) > 0.2,
  `upCmp=${uphill.compress.toFixed(3)} downCmp=${downhill.compress.toFixed(3)}`
);

const rolled = hit(0.1);
const jRoll = new JumpModel();
jRoll.reset();
jRoll.noseUp = 0.1;
jRoll.roll = 0.22;
const rolledLand = jRoll.land(-8, 32, {});
check("air roll loads one side", Math.abs(rolledLand.rollBias) > Math.abs(rolled.rollBias) + 0.2, `flat=${rolled.rollBias.toFixed(2)} rolled=${rolledLand.rollBias.toFixed(2)}`);
check("compress is a real thud (≥4 cm)", tail.compress >= 0.04 && nose.compress >= 0.04, `tail=${tail.compress.toFixed(3)} nose=${nose.compress.toFixed(3)}`);

const a = hit(0.2, { frontH: 3.1, rearH: 3.0, padGrade: 0.05 });
const b = hit(0.2, { frontH: 3.1, rearH: 3.0, padGrade: 0.05 });
check("deterministic", a.bounce === b.bounce && a.axleBias === b.axleBias && a.compress === b.compress);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "landings thud and vary"}`);
process.exit(fail ? 1 : 0);
