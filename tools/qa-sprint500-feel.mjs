#!/usr/bin/env node
/**
 * Sprint 500 — title feel, countdown→race grade continuity, landings, Mountain deck.
 *
 * RUN: node tools/qa-sprint500-feel.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

console.log(`SPRINT 500 FEEL  ·  ${new Date().toISOString()}\n`);

const config = read("js/config.js");
const game = read("js/game.js");
const vehicle = read("js/physics/vehicle.js");
const track = read("js/tracks/track.js");
const main = read("js/main.js");
const index = read("index.html");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

check("title DPR capped", /titleMaxPixelRatio:\s*1\.0/.test(config) && /titleMaxPixels:\s*1400000/.test(config));
check("title shadow 1024", /titleShadowMap:\s*1024/.test(config));
check("title cube off + small RT", /reflectEvery:\s*0/.test(config) && /cubeSize:\s*64/.test(config));
check("title sky low (not cinema)", /skyQuality:\s*"low"/.test(config));
check("title asphalt Standard + 48 segs", /MeshStandardMaterial/.test(game) && /CircleGeometry\(9\.4, 48\)/.test(game));
check("title present is single ACES pass", /onPad \|\| countdownLite \|\| !this\.post/.test(game));
check("title skips post RTs on resize", /Title deliberately skips post RTs/.test(game));
check("title post stays disabled on pad", /Title skips post RTs[\s\S]*?this\.post\.enabled = false/.test(game));

check("countdownLite is webdriver-only", /function countdownLitePresent[\s\S]*?navigator\.webdriver/.test(game));
check(
  "countdown freezes race shadow cadence (no every=1→2 at GO)",
  /_armPresentFreeze/.test(game) &&
    /this\._presentFrozen[\s\S]*?frozenEvery/.test(game) &&
    /const every = countdownLite\s*\?\s*6/.test(game)
);
check("GO extends race warm frames", /_raceWarmFrames = Math\.max\(this\._raceWarmFrames \|\| 0, 16\)/.test(game));
check("settle locks stage grade", /_settleRacePresent[\s\S]*?post\.syncFromConfig\(L\)/.test(game));

check(
  "JUMP settle window tuned for bounce",
  /landSettleMin:\s*0\.2[5-9]/.test(config) && /landSettleMax:\s*0\.[67]\d/.test(config)
);
check(
  "JUMP land damp knobs",
  /landSettleDamp:\s*2\.[4-9]/.test(config) && /landSquashDamp:\s*3\.4/.test(config)
);
check("vehicle uses JUMP damp", /JUMP\.landSettleDamp/.test(vehicle) && /JUMP\.landSettleDampEnd/.test(vehicle));

check("mountain bed tuck ~0.28 m", /scenery === "mountain" \? 0\.28/.test(track) && /drop = mountain \? 0\.28/.test(track));
check("mountain closed underside", /inUnderpass \|\| scenery === "mountain"/.test(track));
check("mountain skirt reach extended", /scenery === "mountain" \? 5\.4/.test(track));
check("mountain shallow skirtDrop", /scenery === "mountain"[\s\S]*?edgeY - 0\.42/.test(track));

check("cache-bust v502", cacheOk && Number(gameV) >= 502 && Number(mainV) >= 502, `game=${gameV} main=${mainV}`);
check("index loads main ≥504", /main\.js\?v=(\d+)/.test(index) && Number((index.match(/main\.js\?v=(\d+)/) || [])[1]) >= 504);

console.log(fail ? `\nFAIL  ${fail} check(s)` : "\nPASS  ·  sprint 500 feel contracts");
process.exit(fail ? 1 : 0);
