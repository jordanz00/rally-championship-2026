#!/usr/bin/env node
/**
 * Sprint 60 — no hitch between screens or C-key camera swaps.
 *
 * RUN: node tools/qa-sprint60-smooth.mjs
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

console.log(`SPRINT 60 SMOOTH TRANSITIONS  ·  ${new Date().toISOString()}\n`);

const game = read("js/game.js");
const car = read("js/cars/celica.js");
const main = read("js/main.js");
const index = read("index.html");
const config = read("js/config.js");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

check(
  "C only starts a pose blend (no cockpit compile on the click)",
  /_cycleCamera\(/.test(game) &&
    /_startCamBlend\(\)/.test(game) &&
    !/if \(mode && mode\.id === "pov"\) this\._applyCockpitCam\(\)/.test(game)
);
check(
  "cabin seats mid-blend; mirror keeps last frame (captures if empty)",
  /const seatIn = !blending \|\| ease >= 0\.45/.test(game) &&
    /_mirrorHasImage/.test(game) &&
    /_ensureMirrorRT/.test(game) &&
    /if \(this\._mirrorDefer > 0 && this\._mirrorHasImage\)/.test(game)
);
check(
  "POV shaders compile against the hero mesh uuid, not a stale title LOD",
  /mesh\.uuid/.test(game) &&
    /titleLod \? "lod" : "hero"/.test(game) &&
    /this\._povWarmKey = ""/.test(game)
);
check(
  "canvas reallocation is monotonic per stage, never oscillating",
  /Reallocating the canvas or the shadow atlas costs/.test(game) &&
    /_qualityDprFloor/.test(game) &&
    /dpr < \(this\._qualityDprFloor != null \? this\._qualityDprFloor : 1\)/.test(game)
);
check(
  "shadow atlas shrinks only for the scaler, only downward",
  /Never shrink the atlas/.test(game) &&
    /s < this\.sun\.shadow\.mapSize\.x/.test(game) &&
    /_qualityShadowFloor/.test(game) &&
    /if \(t\.shadow < floor\)/.test(game)
);
check(
  "each stage re-grades from scratch",
  /this\._qualityDprFloor = null/.test(game) && /this\._qualityShadowFloor = null/.test(game)
);
check(
  "PRESS START defers warm off the click frame",
  /_leaveTitle\(/.test(game) &&
    /_idleWarmAfterTitle\(/.test(game) &&
    /_warmRaceSystems\(\)/.test(game) &&
    /later\(120, \(\) => this\._warmCarMeshes\(\)\)/.test(game)
);
check(
  "return-to-title hides the stage then disposes next frame",
  /_showTitle\(/.test(game) &&
    /this\.track\.group\.visible = false/.test(game) &&
    /staleTrack\.dispose\(\)/.test(game)
);
check(
  "title orbit does not walk the GLB every frame",
  /_titleCam\(dt\) \{[\s\S]{0,280}userData\._cockpitOn/.test(game)
);
check(
  "setCockpitView no-ops when already in the requested mode",
  /_cockpitOn === want/.test(car) && /_povHideReady/.test(car)
);
check(
  "S50-class mirror budget (readable, not a hitch)",
  /mirrorW:\s*256/.test(config) &&
    /mirrorH:\s*80/.test(config) &&
    /mirrorFar:\s*110/.test(config) &&
    /mirrorEveryPov:\s*2/.test(config)
);
check("celica.js cache-bust v>=140", Number((game.match(/celica\.js\?v=(\d+)/) || [])[1]) >= 140);
check("cache-bust chain", cacheOk && Number(gameV) >= 378, `main=${mainV} game=${gameV}`);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "screen + camera hitches cut"}`);
process.exit(fail ? 1 : 0);
