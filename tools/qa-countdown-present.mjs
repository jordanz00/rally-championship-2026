#!/usr/bin/env node
/**
 * qa-countdown-present.mjs — Countdown and race share the same present path
 * on real GPUs (no lighting/post/color pop at 3/2/1/GO). Lite path is webdriver-only.
 * Settle finishes race DPR/post/sky/shadows/lights under the load overlay, freezes
 * those knobs through GO, and paints "3" only after HUD live warms.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCacheVersions } from "./qa-cache-version.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fail = 0;
function check(l, ok, d) {
  if (ok) console.log(`  ok  ${l}`);
  else {
    console.log(`  FAIL  ${l} — ${d || ""}`);
    fail++;
  }
}

const game = fs.readFileSync(path.join(ROOT, "js/game.js"), "utf8");
const main = fs.readFileSync(path.join(ROOT, "js/main.js"), "utf8");
const index = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

console.log("COUNTDOWN → RACE PRESENT CONTINUITY\n");

check(
  "countdownLitePresent helper exists",
  /function countdownLitePresent\s*\(/.test(game)
);
check(
  "lite path gated on navigator.webdriver",
  /function countdownLitePresent[\s\S]*?navigator\.webdriver/.test(game)
);
check(
  "_render uses countdownLite not blanket countdown skip",
  /const countdownLite = this\.state === "countdown" && countdownLitePresent\(\)/.test(game)
);
check(
  "post skipped only when countdownLite (or title pad)",
  /if \(onPad \|\| countdownLite \|\| !this\.post \|\| !this\.post\.enabled\)/.test(game) ||
    /if \(countdownLite \|\| !this\.post \|\| !this\.post\.enabled\)/.test(game)
);
check(
  "blanket countdownSettling post-skip removed",
  !/countdownSettling \|\| !this\.post/.test(game) && !/const countdownSettling = this\.state === "countdown"/.test(game)
);
check(
  "shadow throttle 6 only for countdownLite",
  /const every = countdownLite\s*\?\s*6/.test(game)
);
check(
  "mirror skipped only when countdownLite (title pad has no POV mirror)",
  /if \(!onPad && !countdownLite\) this\._renderMirror\(\)/.test(game) ||
    /if \(!countdownLite\) this\._renderMirror\(\)/.test(game)
);
check(
  "reflections skipped while present-frozen (and countdownLite)",
  /!countdownLite && !this\._presentFrozen/.test(game) &&
    /_updateReflections\(\)/.test(game)
);
check(
  "settle warm still uses post when enabled",
  /_settleRacePresent[\s\S]*?if \(this\.post && this\.post\.enabled\) this\.post\.render/.test(game)
);
check(
  "quality adapt still frozen through countdown",
  /const settling =\s*this\.state === "loading" \|\|\s*this\.state === "countdown" \|\|\s*this\._presentFrozen \|\|\s*\(this\._raceWarmFrames/.test(
    game
  )
);
check(
  "quality adapt refuses countdown / freeze",
  /!settling &&\s*!onTitle &&\s*!this\._presentFrozen &&\s*this\.state !== "countdown"/.test(game)
);

const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);
check(
  "GO keeps warm frames",
  /_raceWarmFrames = Math\.max\(this\._raceWarmFrames \|\| 0, 16\)/.test(game)
);
check(
  "warm frames burn only in race (not mid-countdown)",
  /_raceWarmFrames > 0 && this\.state === "race"/.test(game) &&
    !/_raceWarmFrames > 0 && this\.state !== "loading"/.test(game)
);
check(
  "settle resets title DPR then race _onResize",
  /_settleRacePresent[\s\S]*?_perfDprScale = isPhonePlay\(\)[\s\S]*?this\._onResize\(\)/.test(game)
);
check(
  "settle forces race shadow atlas size",
  /_settleRacePresent[\s\S]*?_setShadowMapSize\(tier\.shadow,\s*true\)/.test(game)
);
check(
  "settle forces sky quality from race tier",
  /_settleRacePresent[\s\S]*?setSkyQuality\(this\.sky,\s*tier\.sky\)/.test(game)
);
check(
  "settle warms at least four presents",
  /_settleRacePresent[\s\S]*?present\(\);\s*present\(\);\s*present\(\);\s*present\(\);/.test(game)
);
check(
  "settle warms reflections once under load overlay",
  /_settleRacePresent[\s\S]*?_updateReflections\(\)/.test(game)
);
check(
  "countdown hard-snaps cam for full 3-2-1 (no 2.8s hold)",
  /Hard cam for the entire 3-2-1/.test(game) && !/_gridCamHold = 2\.8/.test(game)
);
check(
  "no next-stage preload at countdown flash",
  !/_countShown = "3"[\s\S]{0,400}_scheduleTrackPreload\(nextId/.test(game)
);
check(
  "preload pump blocked during countdown",
  /_pumpPreloadQueue\(\)[\s\S]*?if \(this\.state === "countdown" \|\| this\._presentFrozen\) return/.test(
    game
  )
);

// —— Present freeze: mid-countdown + pre-GO continuity ——
check(
  "settle arms present freeze before HUD",
  /_settleRacePresent[\s\S]*?_armPresentFreeze\(tier\)/.test(game)
);
check(
  "_armPresentFreeze snapshots lights + fog + post grade",
  /_armPresentFreeze[\s\S]*?sunIntensity:/.test(game) &&
    /_armPresentFreeze[\s\S]*?fogColor:/.test(game) &&
    /_armPresentFreeze[\s\S]*?postWarmth:/.test(game)
);
check(
  "instant HUD (no curtain grade path into 3)",
  /showScreen\("screen-hud",\s*\{\s*instant:\s*true\s*\}\)/.test(game)
);
check(
  "HUD live frozen warms before unlocking 3",
  /_presentFrozenWarms\(3\)[\s\S]*?_countShown = "3"/.test(game)
);
check(
  "enforce freeze on GO frame",
  /countdown <= 0[\s\S]*?_enforcePresentFreeze\(\)[\s\S]*?countGo\(\)/.test(game)
);
check(
  "_updateLights short-circuits intensity writes while frozen",
  /if \(this\._presentFrozen\)[\s\S]*?_enforcePresentFreeze\(\);\s*return;/.test(game)
);
check(
  "sky time frozen during present freeze",
  /_presentFrozen && this\._presentFreeze[\s\S]*?skyTime/.test(game)
);
check(
  "frozen shadow cadence uses race-tier every (no every=1 flip at GO)",
  /this\._presentFrozen[\s\S]*?Math\.max\(1, frozenEvery/.test(game) &&
    !/: settling\s*\?\s*1/.test(game)
);
check(
  "present freeze releases after GO warm frames",
  /_presentFrozen &&[\s\S]*?_raceWarmFrames[\s\S]*?_releasePresentFreeze\(\)/.test(game)
);
check(
  "no settling→every=1 during countdown present path",
  !/settling\s*\?\s*1\s*:\s*onPad/.test(game)
);
check("cache-bust aligned", cacheOk && Number(gameV) >= 521, `game=${gameV} main=${mainV}`);

console.log(fail ? `\nFAIL ${fail}` : "\nPASS");
process.exit(fail ? 1 : 0);
