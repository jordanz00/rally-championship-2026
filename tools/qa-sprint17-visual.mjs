#!/usr/bin/env node
/**
 * qa-sprint17-visual.mjs — Sprint 17 gate: tier 6 chase-cam readability.
 *
 * Checks camera occlusion fade, tunnel cameraFade tags, contact blob grounding,
 * and carry-forward Sprint 15 tier gates.
 *
 * RUN: node tools/qa-sprint17-visual.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

let fail = 0;

function check(label, ok, detail) {
  if (ok) console.log(`  ok  ${label}`);
  else {
    console.log(`  FAIL  ${label}  —  ${detail}`);
    fail += 1;
  }
}

console.log(`SPRINT 17 VISUAL GATE  ·  ${new Date().toISOString()}\n`);

const config = read("js/config.js");
const tierMatch = config.match(/\btier:\s*(\d+)/);
const tier = tierMatch ? Number(tierMatch[1]) : 0;
const occlusionOn = /cameraOcclusionFade:\s*true/.test(config);
check(
  "VISUAL.tier >= 6 or cameraOcclusionFade",
  tier >= 6 || occlusionOn,
  tierMatch
    ? `tier is ${tier} and cameraOcclusionFade is ${occlusionOn ? "true" : "false/missing"}`
    : "missing VISUAL.tier and cameraOcclusionFade"
);

check("occlusion-fade.js present", exists("js/gfx/occlusion-fade.js"), "add js/gfx/occlusion-fade.js");
const occlusion = exists("js/gfx/occlusion-fade.js") ? read("js/gfx/occlusion-fade.js") : "";
check(
  "occlusion shader cam→car tube + discard",
  /uOccludeRadius/.test(occlusion) && /discard/.test(occlusion),
  "patchCameraFadeMaterial must discard only along the cam→car sightline tube"
);
check(
  "updateCameraFade export",
  /export function updateCameraFade/.test(occlusion),
  "export updateCameraFade(camPos, carPos, on)"
);

const track = read("js/tracks/track.js");
check(
  "tunnel walls tagged cameraFade",
  /walls\.userData\.cameraFade\s*=\s*true/.test(track) && /ceils\.userData\.cameraFade\s*=\s*true/.test(track),
  "tag tunnel wall/ceiling instanced meshes for chase-cam fade"
);
check(
  "armCameraFade wired in track",
  /armCameraFade/.test(track),
  "import and call armCameraFade when building occluders"
);
check(
  "mountain cliff tagged cameraFade",
  /_addMountainCliff[\s\S]{0,12000}cameraFade\s*=\s*true/.test(track),
  "tag the faceted mountain cliff wall so chase cam can ghost it"
);
check(
  "tunnel bore striation map",
  /function tunnelBoreStriationMap/.test(track) && /boreMap/.test(track),
  "EA1 bake-time striation on desert tunnel wall materials"
);

const game = read("js/game.js");
check(
  "game.js updateCameraFade",
  /updateCameraFade/.test(game) && /from\s+["'].*occlusion-fade/.test(game),
  "import updateCameraFade from occlusion-fade and call each frame on chase cam"
);
check(
  "HUD gets onGround",
  /h\.onGround\s*=\s*this\.player\.onGround/.test(game),
  "pass player.onGround into HUD so AIR can show"
);

const hud = read("js/ui/hud.js");
const css = read("css/game.css");
check(
  "chase HUD AIR when airborne",
  /onGround === false/.test(hud) && /"AIR"/.test(hud) && /data-surf="air"/.test(css),
  "Hud.update shows AIR; game.css colors data-surf=air"
);

check(
  "_syncContactBlobs uses track.query ground height",
  /_syncContactBlobs/.test(game) &&
    /track\.query/.test(game) &&
    /hit\.height/.test(game) &&
    /groundY/.test(game),
  "_syncContactBlobs must query road/terrain Y — not chassis d.y alone"
);

console.log("\nrunning qa-sprint15-visual (carry-forward)…");
const s15 = spawnSync(process.execPath, [path.join(ROOT, "tools", "qa-sprint15-visual.mjs")], {
  cwd: ROOT,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const s15Out = ((s15.stdout || "") + (s15.stderr || "")).trim();
check("qa-sprint15-visual still passes", s15.status === 0, s15Out.split("\n").slice(-1)[0] || "exit non-zero");

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Sprint 17 visual tier armed"}`);
process.exit(fail ? 1 : 0);
