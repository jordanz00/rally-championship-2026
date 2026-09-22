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
  /isPhonePlay\(\)/.test(game) && /2048/.test(game) && /_perfDprScale/.test(game),
  "iPhone must start on a lighter GPU budget"
);

check(
  "Android never position:fixed the body",
  !/body\.is-mobile\s*\{[^}]*position:\s*fixed/.test(css.replace(/\s+/g, " ")),
  "fixed body + overflow hidden = white tab on Android Chrome"
);

check(
  "title CRT class, not opacity-hidden WebGL",
  /#crt\.is-title/.test(css) && !/#game-view\s*\{[^}]*opacity:\s*0/.test(css.replace(/\s+/g, " ")),
  "opacity:0 on a WebGL canvas whites out Android Chrome"
);

check(
  "inline dark paint so CSS 404 is never a white tab",
  /background:\s*#050705/.test(index) && /<style>/.test(index) && /id="crt" class="is-title"/.test(index),
  "index.html must paint dark before game.css"
);

check(
  "WebGL retry ladder",
  /createWebGLRendererSafe/.test(read("js/gfx/renderer-factory.js")) &&
    /failIfMajorPerformanceCaveat:\s*false/.test(read("js/gfx/renderer-factory.js")),
  "Android often rejects the first high-performance context"
);

check(
  "safe-area + 48px menu targets",
  /safe-area-inset-bottom/.test(css) && /min-height: 48px/.test(css) && /100dvh/.test(css),
  "home indicator and tap size"
);

check(
  "phone starts on low quality tier",
  /if \(isPhonePlay\(\)\) \{/.test(game) && /return "low"/.test(game) && /return "min"/.test(game),
  "phones low; weak Android must open on min"
);

check(
  "phones honour low/min look (no cinema lock)",
  /phoneBudget/.test(game) && /lockLook = !explicitPotato && !phoneBudget/.test(game),
  "lockRaceQuality must not pin phones to desktop cinema shadows"
);

check(
  "Android fill-rate caps armed at boot",
  /GFX\.maxPixels = Math\.min\(GFX\.maxPixels/.test(game) &&
    /android \? 900000/.test(game) &&
    /GFX\.preferLock30 = true/.test(game),
  "Android must cap pixels and prefer lock-30 before first setSize"
);

check(
  "phones never stream 2k ground maps",
  /export function wantHiMaps/.test(read("js/tracks/pbr-stream.js")) &&
    /Android\|iPhone\|iPod\|Mobile/.test(read("js/tracks/pbr-stream.js")),
  "2k mipmap uploads hitch Adreno/Mali mid-race"
);

check(
  "phone dust OFF — no brown wall",
  /Phones: dust OFF/.test(read("js/effects.js")) &&
    /uAlpha:\s*\{\s*value:\s*phone \? 0\.0/.test(read("js/effects.js")) &&
    /points\.visible = !phone/.test(read("js/effects.js")) &&
    /if \(isPhonePlay\(\)\) \{/.test(game) &&
    /dust\.points\.visible = false/.test(game),
  "mobile must not draw cinema grit or tire-mark smear"
);

check(
  "Android classifies as lowPower / preferLock30",
  /const android = \/Android\/i\.test\(ua\)/.test(read("js/gfx/capabilities.js")) &&
    /preferLock30: lowPower/.test(read("js/gfx/capabilities.js")),
  "classifyGpuRenderer must arm lock-30 on Android"
);

check(
  "boot watchdog names in-app browsers",
  /in-app browsers \(Instagram, Facebook, Messenger\)/.test(index) &&
    /Use hardware acceleration/.test(index),
  "blank tabs on Android WebViews need an actionable error"
);

check(
  "cache chain main→game",
  /game\.js\?v=\d+/.test(main) && /main\.js\?v=\d+/.test(index) && (main.match(/game\.js\?v=(\d+)/) || [])[1] === (index.match(/main\.js\?v=(\d+)/) || [])[1],
  "stale Safari cache would hide the overlay"
);

const inputVer = (game.match(/input\.js\?v=(\d+)/) || [])[1];
check(
  "input.js cache bump",
  !!inputVer && Number(inputVer) >= 40,
  "game must import input.js?v=40+ (QA-hold release + touch merge)"
);

check(
  "title START + menu tap targets on phones",
  /body\.is-mobile #screen-title #btn-start/.test(css) &&
    /min-height:\s*48px/.test(css) &&
    /body\.is-mobile #screen-menu/.test(css),
  "narrow screens need 48px START and scrollable SELECT MODE"
);

check(
  "HB pedal meets 44px",
  /\.touch-pedal\.hb\s*\{[^}]*min-height:\s*(4[4-9]|[5-9]\d)px/.test(css.replace(/\s+/g, " ")),
  "handbrake hit target must be ≥44px"
);

check(
  "iOS audio unlock path exists",
  /audio\.unlock\(\)/.test(game) && /webkitAudioContext|AudioContext/.test(read("js/audio/engine.js")),
  "Safari needs gesture unlock before engine/nav VO"
);

if (fail) {
  console.log(`\nFAIL  ·  ${fail} check(s)`);
  process.exit(1);
}
console.log("\nPASS  ·  mobile overlay + tilt contracts armed");
