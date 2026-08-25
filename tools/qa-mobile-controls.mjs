#!/usr/bin/env node
/**
 * qa-mobile-controls.mjs — iPhone Safari overlay + tilt/touch contracts.
 *
 * RUN: node tools/qa-mobile-controls.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

let fail = 0;
function check(label, ok, detail) {
  if (ok) console.log(`  ok  ${label}`);
  else {
    console.log(`  FAIL  ${label}  —  ${detail}`);
    fail += 1;
  }
}

console.log(`MOBILE / IPHONE CONTROLS  ·  ${new Date().toISOString()}\n`);

const index = read("index.html");
const input = read("js/input.js");
const touch = read("js/ui/touch-controls.js");
const game = read("js/game.js");
const css = read("css/game.css");
const main = read("js/main.js");

check(
  "viewport-fit=cover for iPhone notch",
  /viewport-fit=cover/.test(index) && /apple-mobile-web-app-capable/.test(index),
  "index.html head must declare iOS web-app + cover viewport"
);

check(
  "touch HUD markup (steer + pedals + tilt)",
  /id="touch-hud"/.test(index) &&
    /id="touch-gas"/.test(index) &&
    /id="touch-brake"/.test(index) &&
    /id="touch-steer"/.test(index) &&
    /id="touch-mode-tilt"/.test(index) &&
    /id="touch-hb"/.test(index),
  "overlay must offer GAS, BRAKE, HB, STEER, TILT"
);

check(
  "iOS tilt permission from a tap",
  /requestPermission/.test(touch) && /deviceorientation/.test(touch),
  "Safari requires DeviceOrientationEvent.requestPermission on gesture"
);

check(
  "Input merges overlay when no key/pad",
  /bindTouch/.test(input) && /touch\.active/.test(input) && /usingKeys/.test(input),
  "poll() must take overlay axes only when keyboard/pad are idle"
);

check(
  "game shows overlay only while driving",
  /TouchControls/.test(game) && /setLive\(driving\)/.test(game) && /countdown/.test(game),
  "menus must stay tappable — overlay only race/countdown"
);

check(
  "renderer no longer forces 640×360 (iPhone width)",
  /Math\.max\(1, host\.clientWidth/.test(game) && !/Math\.max\(640, host/.test(game),
  "phone Safari is ~390px CSS wide — 640 min stretched the view"
);

check(
  "phone DPR / shadow budget",
  /isPhonePlay\(\)/.test(game) && /2048/.test(game) && /_perfDprScale = 0\.78/.test(game),
  "iPhone must start on a lighter GPU budget"
);

check(
  "safe-area + 48px menu targets",
  /safe-area-inset-bottom/.test(css) && /min-height: 48px/.test(css) && /100dvh/.test(css),
  "home indicator and tap size"
);

check(
  "phone starts on low quality tier",
  /startTier: isPhonePlay\(\) \? "low"/.test(game),
  "opening on high then dumping mid-corner is a hitch, not a scaler"
);

check(
  "cache chain main→game",
  /game\.js\?v=\d+/.test(main) && /main\.js\?v=\d+/.test(index) && (main.match(/game\.js\?v=(\d+)/) || [])[1] === (index.match(/main\.js\?v=(\d+)/) || [])[1],
  "stale Safari cache would hide the overlay"
);

check(
  "input.js cache bump",
  /input\.js\?v=39/.test(game),
  "game must import the QA-hold input module"
);

if (fail) {
  console.log(`\nFAIL  ·  ${fail} check(s)`);
  process.exit(1);
}
console.log("\nPASS  ·  mobile overlay + tilt contracts armed");
