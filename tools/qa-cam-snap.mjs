#!/usr/bin/env node
/**
 * qa-cam-snap.mjs — C-key camera modes snap. POV must not hitch-compile.
 *
 * RUN: node tools/qa-cam-snap.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
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

console.log(`CAM SNAP  ·  ${new Date().toISOString()}\n`);

const game = read("js/game.js");
const car = read("js/cars/celica.js");
const main = read("js/main.js");
const html = read("index.html");

check(
  "C hard-snaps pose (blendT 0, camCut)",
  /_camBlendDur = 0\.001/.test(game) &&
    /_camBlendT = 0/.test(game) &&
    /_camCut = true/.test(game) &&
    !/Math\.max\(0\.72/.test(game) &&
    !/Math\.max\(0\.95/.test(game)
);

check(
  "C seats cabin same frame",
  /_cycleCamera\(\) \{[\s\S]{0,500}?_applyCockpitCam\(\)/.test(game) &&
    /_chaseCam\(0\)/.test(game)
);

{
  const cycle = game.match(/_cycleCamera\(\) \{[\s\S]*?\n  \}/);
  check(
    "C never renderer.compile",
    !!(cycle && cycle[0] && !/renderer\.compile/.test(cycle[0])),
    cycle ? `len=${cycle[0].length}` : "no _cycleCamera block"
  );
}

check(
  "cabin seats on the click",
  /const seatIn = true/.test(game) && /seatIn/.test(game)
);

check(
  "warm does not abort when the mirror is missing",
  /Cabin compile is mandatory/.test(game) &&
    !/if \(!this\._mirrorRT \|\| !this\._mirrorCam\) return;/.test(game)
);

check(
  "warm compiles cabin + HUD layer + optional mirror",
  /this\.renderer\.compile\(this\.scene, this\.camera\)/.test(game) &&
    /layers\.enable\(POV_HUD_LAYER\)/.test(game) &&
    /this\.renderer\.compile\(this\.scene, this\._mirrorCam\)/.test(game)
);

check(
  "setCockpitView C-path is a warmed visibility flip",
  /function flipCockpitVisibility/.test(car) &&
    /_povClipPrepared/.test(car) &&
    /_povHideReady/.test(car) &&
    !/attachPovDriverArms\(root\);\s*\n\s*const driver/.test(
      car.slice(car.indexOf("export function setCockpitView"))
    )
);

const gameV = Number((main.match(/game\.js\?v=(\d+)/) || [])[1]);
const mainV = Number((html.match(/main\.js\?v=(\d+)/) || [])[1]);
const celV = Number((game.match(/celica\.js\?v=(\d+)/) || [])[1]);
check(
  "cache bust main↔game + celica",
  gameV >= 1145 && mainV === gameV && celV >= 272,
  `main=${mainV} game=${gameV} celica=${celV}`
);

if (fail) {
  console.log(`\nFAIL  ${fail}`);
  process.exit(1);
}
console.log("\nPASS  ·  C-key snap, POV warm off the click");
process.exit(0);
