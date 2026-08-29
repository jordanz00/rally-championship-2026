#!/usr/bin/env node
/**
 * qa-jump-variability.mjs — jump throw/landing must vary with speed, grade, attitude.
 *
 * RUN: node tools/qa-jump-variability.mjs
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

console.log(`JUMP VARIABILITY  ·  ${new Date().toISOString()}\n`);

const jump = read("js/physics/jump.js");
const vehicle = read("js/physics/vehicle.js");
const config = read("js/config.js");
const track = read("js/tracks/track.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

check("no Math.random in jump model", !/Math\.random/.test(jump));
check("takeoff is speed × sin(grade), no 0.4 speed floor", /vx \* Math\.sin\(launchGrade\)/.test(vehicle) && !/clamp\(vx \/ 26, 0\.4/.test(vehicle));
check("no 0.75 loft floor on ballistic leave", !/\(0\.75 \+ speedN \* 0\.35\)/.test(vehicle));
check("spring pop scales with approach speed", /clamp\(vx \/ 24, 0\.12, 1\.35\)/.test(vehicle));
check("authored jump profile on spline", /jumpThrow/.test(track) && /jumpLip/.test(track));
check("launch uses jumpThrow and lip grade", /jumpThrow: q2\.jumpThrow/.test(vehicle) && /lipGrade/.test(vehicle));
check("surface bump modulates spring and landing", /surfaceBump/.test(jump) && /surfaceSpringGain/.test(config));
check("ramp climb energy joins leave", /climbThrowGain/.test(config) && /_rampClimb/.test(vehicle));
check("air applies attitude drag", /airLongDrag/.test(jump) && /airLongDrag\(dt\)/.test(vehicle));
check(
  "air keeps momentum (soft nose drag, not 0.84 stall floor)",
  /airBaseDrag/.test(config) &&
    /airNoseDrag:\s*0\.14/.test(config) &&
    /Math\.max\(0\.985/.test(jump) &&
    /airLatBleed/.test(vehicle) &&
    !/vy \*= 1 - 2\.1 \* dt/.test(vehicle)
);
check("gravity hangs on nose-up and dives on nose-down", /aeroDive/.test(jump) && /aeroDive/.test(config));
check("landing grades tail-first vs nose-first", /tailFirst/.test(jump) && /noseFirst/.test(jump));
check("landing keeps residual air attitude (no upright snap)", /_beginLandSettle\(/.test(vehicle) && /_landSettle/.test(vehicle) && /landSettleMin/.test(config));
check("land lock does not wipe settle every frame", /_landLock > 0 && this\._landSettle <= 0/.test(vehicle));
check("overdamped land compress spring", /_seedLandCompress\(/.test(vehicle) && /landCompressWn/.test(config) && /landCompressZeta/.test(config));
check("pad hit absorbs vel into spring", /landVelAbsorb/.test(config) && /_seedLandCompress\(-this\.velY/.test(vehicle));
check("soft re-air only on severe bounce", /landReairMin/.test(config) && /bounce > reairMin && impact > bounceNeed/.test(vehicle));
check("JUMP.launchHeightScale is not the old 0.28 squash", !/launchHeightScale:\s*0\.28/.test(config));
check("land SFX armed via _noteLandImpact", /_noteLandImpact\(/.test(vehicle) && /landThump\(/.test(game));
check("game imports vehicle.js?v=112+", Number((game.match(/vehicle\.js\?v=(\d+)/) || [])[1]) >= 112);
check("cache-bust chain", cacheOk && Number(gameV) >= 522, `main=${mainV} game=${gameV}`);

const jumpUrl = pathToFileURL(path.join(ROOT, "js/physics/jump.js")).href + "?v=20";
let modelOk = false;
try {
  const mod = await import(jumpUrl);
  const JumpModel = mod.JumpModel;
  const hop = new JumpModel();
  hop.technique = 0;
  const slow = hop.launch(8 * Math.sin(0.1) * 0.8, 0.1, 0.2, { speed: 8, dist: 100, lateral: 0 });
  hop.reset();
  hop.technique = 0;
  const fast = hop.launch(32 * Math.sin(0.1) * 0.8, 0.1, 0.8, { speed: 32, dist: 100, lateral: 0 });
  hop.reset();
  hop.technique = 0;
  const steep = hop.launch(32 * Math.sin(0.18) * 0.8, 0.18, 0.8, { speed: 32, dist: 140, lateral: 0 });
  hop.reset();
  hop.technique = 0;
  const big = hop.launch(32 * Math.sin(0.18) * 0.8, 0.18, 0.8, { speed: 32, dist: 140, lateral: 0, jumpThrow: 1.65, jumpLip: 1.3 });
  hop.reset();
  hop.technique = 0;
  const small = hop.launch(32 * Math.sin(0.18) * 0.8, 0.18, 0.8, { speed: 32, dist: 140, lateral: 0, jumpThrow: 0.72, jumpLip: 0.85 });
  hop.reset();
  hop.technique = 1;
  const lifted = hop.launch(32 * Math.sin(0.18) * 0.8, 0.18, 0.8, { speed: 32, dist: 140, lateral: 0, brake: 1 });
  hop.reset();
  hop.technique = 0;
  hop.noseUp = 0.35;
  const hangG = hop.gravityScale(30);
  hop.noseUp = -0.3;
  const diveG = hop.gravityScale(30);
  hop.noseUp = 0.44;
  const tail = hop.land(-8, 32);
  hop.noseUp = -0.36;
  const nose = hop.land(-8, 32);

  // 0.6 s lofted hang must keep most forward speed (old drag kept ~0.55).
  hop.reset();
  hop.noseUp = 0.5;
  let keep = 1;
  const dt = 1 / 60;
  for (let i = 0; i < 36; i++) keep *= hop.airLongDrag(dt);

  check("fast lip throws higher than a crawl", fast > slow * 1.35, `slow=${slow.toFixed(2)} fast=${fast.toFixed(2)}`);
  check("steep lip throws higher than a shallow one", steep > fast * 1.08, `shallow=${fast.toFixed(2)} steep=${steep.toFixed(2)}`);
  check("Safari-scale jump throws higher than teaching hop", big > small * 1.12, `small=${small.toFixed(2)} big=${big.toFixed(2)}`);
  check("lift-and-brake leaves lower than flat-out", lifted < steep * 0.92, `flat=${steep.toFixed(2)} lift=${lifted.toFixed(2)}`);
  check("nose-up hangs (g < 1) and nose-down dives (g > 1)", hangG < 0.98 && diveG > 1.02, `hang=${hangG.toFixed(3)} dive=${diveG.toFixed(3)}`);
  check("tail-first bounces more than a nose plant", tail.bounce > nose.bounce + 0.35, `tail=${tail.bounce.toFixed(2)} nose=${nose.bounce.toFixed(2)}`);
  check("nose plant scrubs more speed", nose.scrub < tail.scrub, `tail=${tail.scrub.toFixed(3)} nose=${nose.scrub.toFixed(3)}`);
  check("0.6s lofted hang keeps ≥90% speed", keep >= 0.9, `keep=${keep.toFixed(3)}`);
  modelOk = true;
} catch (err) {
  check("JumpModel numeric import", false, err && err.message ? err.message : String(err));
}

console.log(
  `\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : modelOk ? "jumps vary with speed, grade, and attitude" : "static contracts"}`
);
process.exit(fail ? 1 : 0);
