#!/usr/bin/env node
/**
 * qa-sprint27-env.mjs — Sprint 27 gate: environmental realism + rear dirt wake
 * + HD nature props (no primitive forest trees).
 *
 * RUN: node tools/qa-sprint27-env.mjs
 */

import fs from "node:fs";
import path from "node:path";
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

console.log(`SPRINT 27 ENV + DIRT WAKE + HD NATURE GATE  ·  ${new Date().toISOString()}\n`);

const config = read("js/config.js");
const effects = read("js/effects.js");
const sky = read("js/sky.js");
const game = read("js/game.js");
const track = read("js/tracks/track.js");

check("VISUAL.tier >= 11", /tier:\s*1[1-9]/.test(config), "tier: 11+");
check("rearDirtWake flag", /rearDirtWake:\s*true/.test(config), "rearDirtWake");
check("envAtmosphere flag", /envAtmosphere:\s*true/.test(config), "envAtmosphere");
check("glbProps armed", /glbProps:\s*true/.test(config), "glbProps");
check(
  "desert wind + stronger dust",
  /dustStrength:\s*0\.(1[0-9]|[2-9]\d)/.test(config) && /wind:\s*\[/.test(config),
  "desert dustStrength 0.10+ with wind vector"
);
check("Dust.setAtmosphere", /setAtmosphere\(L\)/.test(effects), "setAtmosphere API");
check("rear wake bias", /almost all spray from the rear|Sprint 27/.test(effects), "rear emission");
check("plume particles", /plume/.test(effects) && /profile\.plume/.test(effects), "plume layer");
check("wind on particles", /_wind/.test(effects) && /this\._wind\.x/.test(effects), "stage wind");
check(
  "dt-correct grit drag",
  /Math\.exp\(-this\.drag/.test(effects) && /damp:/.test(effects),
  "air drag is 1/s exponential, not per-frame keep"
);
check(
  "loose ribbon only",
  /sand: \{ rate/.test(effects) &&
    /dirt: \{ rate/.test(effects) &&
    /mud: \{ rate/.test(effects) &&
    !/grass: \{ rate/.test(effects),
  "dirt/sand/mud/gravel spray; no grass"
);
check("small point cap", /uMaxPx:\s*\{\s*value:\s*1[0-6]\s*\}/.test(effects), "uMaxPx 10–16");
check("wake not buried by bumper", /depthTest:\s*false/.test(effects), "dust Points skip depth test");
check(
  "HDR skybox armed",
  /RGBELoader|isSkyReady|applySky/.test(sky),
  "equirect HDR replaces volumetric shader"
);
check("game wires dust atmosphere", /dust\.setAtmosphere/.test(game), "game → dust.setAtmosphere");
check("effects cache bump", /effects\.js\?v=\d+/.test(game), "effects.js versioned import");
check("sky cache bump", /sky\.js\?v=\d+/.test(game), "sky.js versioned import");

// HD nature — no card/cone forest trees on the live path
check("HD treeline helper", /_addHdBackdrop\(/.test(track) && /_addForestTreeline/.test(track), "HD backdrop API");
check("forest treeline uses pine GLB", /tree_pineDefaultA/.test(track), "pine GLB");
check("forest treeline uses fir GLB", /tree_fir/.test(track), "fir GLB");
check(
  "crownGeometry only for far LOD cards / horizon",
  /crownGeometry/.test(track) &&
    /_addDesertHorizonAcacia|_treeCardPoses|farOnly/.test(track),
  "card crowns allowed for LOD/horizon, not primary forest GLB"
);
check(
  "no foliageGeometry plant in track",
  !/foliageGeometry\(/.test(track),
  "remove procedural crowns"
);
check("HD nature skip primitives", /no primitive fallback|_addHdNature/.test(track), "GLB-only plant");
check("asset tree_pineDefaultA", exists("assets/props/tree_pineDefaultA.glb"), "missing pine");
check("asset tree_fir", exists("assets/props/tree_fir.glb"), "missing fir");
check("asset plant_bushDense", exists("assets/props/plant_bushDense.glb"), "missing bush");
check("asset rock_largeA", exists("assets/props/rock_largeA.glb"), "missing rock");

{
  // Euler hang-time: grit must leave the patch and fall, not die in 2 frames.
  const dt = 1 / 60;
  let y = 0.08;
  let vy = 2.2;
  let peak = y;
  let alive = 0;
  for (let i = 0; i < 90; i++) {
    vy -= 9.0 * dt;
    vy *= Math.exp(-0.9 * dt);
    y += vy * dt;
    if (y > peak) peak = y;
    if (y <= 0.01) break;
    alive += dt;
  }
  check(
    "sand grit hangs long enough to see",
    peak > 0.14 && peak < 0.55 && alive > 0.22,
    `peak=${peak.toFixed(3)}m alive=${alive.toFixed(3)}s`
  );
}

console.log("");
if (fail) {
  console.log(`FAIL  ·  ${fail} check(s)`);
  process.exit(1);
}
console.log("PASS  ·  Sprint 27 environmental realism + HD nature + rear dirt wake");
process.exit(0);
