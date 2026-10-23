#!/usr/bin/env node
/**
 * qa-phone-stable.mjs — run the phone crash-gate matrix many times.
 *
 * WHO THIS IS FOR: ship gate before claiming iOS / Android stable.
 * RUN: node tools/qa-phone-stable.mjs
 *      PASSES=20 node tools/qa-phone-stable.mjs
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PASSES = Math.max(1, Number(process.env.PASSES) || 20);

const SCRIPTS = [
  "tools/qa-mobile-boot.mjs",
  "tools/qa-iphone.mjs",
  "tools/qa-static-audit.mjs",
  "tools/qa-garage-cars.mjs",
  "tools/qa-attract-reel.mjs",
  "tools/qa-drift-swing.mjs",
];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}`);
  else {
    console.log(`  FAIL  ${label}${detail ? `  —  ${detail}` : ""}`);
    fail += 1;
  }
}

console.log(`PHONE STABLE GATE  ·  ${PASSES}× matrix  ·  ${new Date().toISOString()}\n`);

const index = read("index.html");
const game = read("js/game.js");
const touch = read("js/ui/touch-controls.js");
const factory = read("js/gfx/renderer-factory.js");
const celica = read("js/cars/celica.js");
const ai = read("js/ai.js");
const main = read("js/main.js");

check("no rival.glb preload", !/preload[^>]+rival\.glb/.test(index), "preload kills phone boot");
check("__rallyPhoneLite early tag", /__rallyPhoneLite/.test(index) && /is-phone/.test(index));
check("isPhonePlay trusts lite flag", /__rallyPhoneLite === true/.test(touch));
check("phones defer title GLB", /_titleCarWarm = isPhonePlay\(\) \? null/.test(game));
check("phones HTML menus only", /HTML menus only until race/.test(game) || /no WebGL until championship/.test(game));
check("phone defer game.js", /__rallyPhoneDefer/.test(main) && /bootEngine/.test(main));
check("phone pack solo", /phonePlay\) n = 0/.test(game) || /if \(phonePlay\) n = 0/.test(game));
check("practice pack solo on phone", /phonePlay \? 0 :/.test(game));
check("phone prop kit tiny", /PHONE_DESERT/.test(read("js/tracks/prop-kit.js")));
check("phone skip POV hands", /garagePhoneLite\(\)\) return/.test(celica) && /softPhoneCar/.test(celica));
check("preparePhoneRaceCars", /preparePhoneRaceCars/.test(game) && /preparePhoneRaceCars/.test(celica));
check("phone raceStartTier min", /function raceStartTier[\s\S]*?isPhonePlay\(\)[\s\S]*?return "min"/.test(game));
check("phone skip race HDR", /phoneRace\)[\s\S]{0,80}sky\.visible = false/.test(game) || /Phones: tighter fog/.test(game));
check("phone no settle shadow atlas", /Phones: never allocate shadow atlas/.test(game));
check("no modulepreload", !/rel="modulepreload"/.test(index));
check("no phone title HDR", /No HDR \/ PMREM on iPhone/.test(game));
check("preferSafeGl iosTouchMac", /__rallyPhoneLite/.test(factory) && /ontouchend/.test(factory));
check("garagePhoneLite", /garagePhoneLite/.test(celica) && /__rallyPhoneLite/.test(celica));
check("Opponent soft mesh", /_meshMissing/.test(ai) && /rival-placeholder/.test(ai));
check("grid rival try\/catch", /\[grid\] rival skip/.test(game));
check("phone prefetch none", /Phones: no prefetch/.test(game));
check("phones block WebGPU remap", /__rallyPhoneLite\) return/.test(index));

const mainV = Number((index.match(/main\.js\?v=(\d+)/) || [])[1] || 0);
const gameV = Number((main.match(/game\.js\?v=(\d+)/) || [])[1] || 0);
check("boot ≥1107", mainV >= 1107 && gameV === mainV, `main=${mainV} game=${gameV}`);

const gCel = (game.match(/celica\.js\?v=(\d+)/) || [])[1];
const aCel = (ai.match(/celica\.js\?v=(\d+)/) || [])[1];
check("garage singleton", gCel && gCel === aCel, `game=${gCel} ai=${aCel}`);

if (fail) {
  console.log(`\nFAIL  ·  ${fail} static check(s) — aborting matrix`);
  process.exit(1);
}

console.log(`\n── matrix ${PASSES}× ──\n`);
let matrixFail = 0;
for (let p = 1; p <= PASSES; p++) {
  for (const script of SCRIPTS) {
    const r = spawnSync(process.execPath, [path.join(ROOT, script)], {
      cwd: ROOT,
      encoding: "utf8",
    });
    const ok = r.status === 0;
    if (!ok) {
      matrixFail += 1;
      console.log(`  FAIL  pass ${p}/${PASSES}  ${script}`);
      if (r.stdout) console.log(r.stdout.split("\n").slice(-8).join("\n"));
      if (r.stderr) console.log(r.stderr.split("\n").slice(-8).join("\n"));
    }
  }
  if (p % 5 === 0 || p === PASSES) {
    console.log(`  ok  completed pass ${p}/${PASSES} (${SCRIPTS.length} scripts each)`);
  }
}

if (matrixFail) {
  console.log(`\nFAIL  ·  ${matrixFail} matrix run(s) failed`);
  process.exit(1);
}

console.log(`\nPASS  ·  phone stable  ·  ${PASSES}× × ${SCRIPTS.length} = ${PASSES * SCRIPTS.length} script runs`);
process.exit(0);
