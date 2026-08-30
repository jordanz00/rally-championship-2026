#!/usr/bin/env node
/**
 * qa-jump-feel.mjs — jumps read as ballistic throws, not trampoline hops.
 *
 * Player moment: leave follows the lip, air coasts with inertia, land has weight.
 *
 * RUN: node tools/qa-jump-feel.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readCacheVersions } from "./qa-cache-version.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`JUMP FEEL  ·  ${new Date().toISOString()}\n`);

const jump = read("js/physics/jump.js");
const vehicle = read("js/physics/vehicle.js");
const config = read("js/config.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

check("leave carries live mesh nose", /meshNose/.test(jump) && /leaveCarry/.test(config) && /meshNose: -\(this\.pitch/.test(vehicle));
check("takeoff locks mesh to leave attitude", /this\._visPitch = -this\.jump\.noseUp/.test(vehicle));
check("air pitch is soft trim (not RC flip)", /airPitchRate:\s*3\.2/.test(config) && /airPitchInertia:\s*2\.05/.test(config));
check("spring burst below old trampoline", /springBurst:\s*1\.85/.test(config) && /throwBlend:\s*0\.45/.test(config));
check("aero float reduced", /aeroFloat:\s*0\.12/.test(config));
check("landing settle is heavier", /landSettleMin:\s*0\.55/.test(config) && /landCompressGain:\s*0\.068/.test(config));
check("land adds nose-down weight (+Rx)", /noseDown/.test(vehicle) && /landImpactSquash/.test(vehicle));
check("chase cam lifts / pulls back in air", /airLift/.test(game) && /airBack/.test(game) && /!p\.onGround/.test(game));
check("no Math.random in jump model", !/Math\.random/.test(jump));
check(
  "cache-bust chain",
  cacheOk &&
    Number(gameV) >= 545 &&
    Number((game.match(/vehicle\.js\?v=(\d+)/) || [])[1]) >= 119 &&
    Number((vehicle.match(/jump\.js\?v=(\d+)/) || [])[1]) >= 22,
  `main=${mainV} game=${gameV}`
);

const jumpUrl = pathToFileURL(path.join(ROOT, "js/physics/jump.js")).href + "?v=22";
try {
  const mod = await import(jumpUrl);
  const JumpModel = mod.JumpModel;
  const a = new JumpModel();
  a.technique = 0;
  const flat = a.launch(6, 0.12, 0.4, { speed: 28, dist: 200, lateral: 0, meshNose: 0.12, jumpLip: 1 });
  a.reset();
  a.technique = 0.9;
  const tech = a.launch(6, 0.12, 0.4, { speed: 28, dist: 200, lateral: 0, meshNose: 0.12, jumpLip: 1 });
  check("technique cuts launch vs flat-out", tech < flat * 0.92, `flat=${flat.toFixed(2)} tech=${tech.toFixed(2)}`);
  const b = new JumpModel();
  b.noseUp = 0.2;
  for (let i = 0; i < 45; i++) b.air(1 / 60, 0, 1, { speed: 30 });
  check("brake in air drops the nose", b.noseUp < 0.12, `nose=${b.noseUp.toFixed(3)}`);
} catch (e) {
  check("live JumpModel import", false, e.message);
}

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "jumps throw and land with weight"}`);
process.exit(fail ? 1 : 0);
