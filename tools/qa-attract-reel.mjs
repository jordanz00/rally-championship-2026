#!/usr/bin/env node
/**
 * Attract reel — music-video title coverage, not a pad spinner.
 *
 * RUN: node tools/qa-attract-reel.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCacheVersions } from "./qa-cache-version.mjs";
import {
  ATTRACT_TIRE_PLANT,
  ATTRACT_TIRE_SINK_DEFAULT,
  ATTRACT_WHEEL_KISS,
  ATTRACT_HULL_EPS,
  ATTRACT_ROAD_HALF,
  attractChassisY,
  attractChassisYCleared,
  attractPitchClearance,
  attractPlantGap,
  attractRubberY,
  attractHullMinY,
  attractBackdropY,
  attractPlayLaneLandY,
  attractSandPokesRoad,
} from "../js/cinema/attract-plant.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`ATTRACT REEL  ·  ${new Date().toISOString()}\n`);

const reel = read("js/cinema/attract-reel.js");
const plant = read("js/cinema/attract-plant.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");
const css = read("css/game.css");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

check("AttractReel export", /export class AttractReel/.test(reel));
check("AttractDirector shots", /bumper/.test(reel) && /whip/.test(reel) && /headon/.test(reel) && /smash/.test(reel));
check("mtv pack fly-by + nose + rear + bank", /packfly/.test(reel) && /nose/.test(reel) && /rear/.test(reel) && /bank/.test(reel));
check("speed ramp timeScale", /_timeScale/.test(reel) && /kind === "jump"/.test(reel));
check("no Track import in reel", !/from ["'].*tracks\/track/.test(reel));
check("closed rally spline", /KNOTS/.test(reel) && /CatmullRomCurve3/.test(reel));
check("sculpted land follows ribbon", /nearestRibbon/.test(reel) && /attract-berm/.test(reel) && /attract-shoulder/.test(reel));
check("desert kit backdrop", /loadTitleRocks/.test(reel) && /cactus_tall/.test(reel));
check("forest crest heroes", /forest_hero_tree/.test(reel) && /attract-forest-floor/.test(reel));
check("game starts reel after IBL", /_startAttractReel/.test(game) && /_revealTitleShowroom/.test(game));
check("game stops reel before race", /_stopAttractReel\(\)/.test(game));
check("attract-fx overlay in index", /id="attract-fx"/.test(index) && /attract-letterbox/.test(index) && /attract-smear/.test(index));
check("letterbox + flash CSS", /attract-letterbox/.test(css) && /attract-flash/.test(css) && /attract-live/.test(css));
check("chroma smear FX flags", /attract-chroma/.test(css) && /attract-smear/.test(css) && /attract-lower/.test(css));
check("reduced-motion safe", /prefers-reduced-motion/.test(css) && /is-calm/.test(css) && /this\.reduced/.test(reel));
check("title CRT is dark for footage", /#crt\.is-title/.test(css) && /#050705/.test(css));
check(
  "cache-bust chain",
  cacheOk && Number(gameV) >= 1006 && Number(mainV) >= 1006,
  `main=${mainV} game=${gameV}`
);
check("game imports attract-reel", Number((game.match(/attract-reel\.js\?v=(\d+)/) || [])[1]) >= 14);
check("no white cut flash", /flash: 0/.test(reel) && /this\.flash = 0/.test(reel));
check("shots hold 4s+", /bumper: 4\.4/.test(reel) && /_mustCut/.test(reel) && /shotT < 2/.test(reel));
check("reel imports attract-plant", /attract-plant\.js\?v=2/.test(reel));
check("no chassis hover pad", !/pose\.y \+ embed \+ 0\.16/.test(reel) && !/position\.set\(pose\.x, pose\.y \+/.test(reel));
check("plant uses attractChassisY", /attractChassisY\(pose\.y\)/.test(reel));
check("hub lift not chassis lift", /applyWheelPose\([^;]*deckLift/.test(reel));
check("TIRE_PLANT matches live Celica 14 mm", ATTRACT_TIRE_PLANT === 0.014 && /ATTRACT_TIRE_PLANT = 0\.014/.test(plant));

const decks = [0, 0.04, 0.35, 2.4, 5.6];
const sinks = [ATTRACT_TIRE_SINK_DEFAULT, 0.012, 0.008, 0.016];
let plantOk = true;
let plantDetail = "";
for (let d = 0; d < decks.length && plantOk; d++) {
  for (let s = 0; s < sinks.length && plantOk; s++) {
    const deck = decks[d];
    const sink = sinks[s];
    const chassisY = attractChassisY(deck);
    const rubber = attractRubberY(deck, sink);
    const gap = attractPlantGap(deck, sink);
    if (Math.abs(rubber - (deck - ATTRACT_WHEEL_KISS)) > 1e-9) plantOk = false;
    if (Math.abs(gap + ATTRACT_WHEEL_KISS) > 1e-9) plantOk = false;
    if (Math.abs(chassisY - (deck - ATTRACT_TIRE_PLANT)) > 1e-9) plantOk = false;
    // Wheel bottom on the ribbon (few cm). Kiss is 2 mm into the slab, never a hover.
    if (Math.abs(rubber - deck) > 0.03) plantOk = false;
    if (rubber > deck + 0.002) plantOk = false;
    if (!plantOk) {
      plantDetail = `deck=${deck} sink=${sink} chassis=${chassisY.toFixed(4)} rubber=${rubber.toFixed(4)} gap=${gap.toFixed(4)}`;
    }
  }
}
check(
  "plant: chassis Y − wheel bottom ≈ ribbon",
  plantOk,
  plantDetail || `kiss=${ATTRACT_WHEEL_KISS}m plant=${ATTRACT_TIRE_PLANT}m`
);
check("all pack cars share one plant", /for \(let i = 0; i < n; i\+\+\)/.test(reel) && /attractChassisY\(pose\.y\)/.test(reel));
check("css bust ≥57", Number((index.match(/game\.css\?v=(\d+)/) || [])[1]) >= 57);
check("no giant pale points", !/size: 0\.42/.test(reel) && !/0xd8c4a0/.test(reel));
check("dirt grit sprite + small point cap", /makeGritSprite/.test(reel) && /min\(aSize \* uScale \/ dist, 5\.5\)/.test(reel));
check("tire tracks on the ribbon", /attract-tracks/.test(reel) && /_stampTracks/.test(reel));
check("dust is dirt brown", /0\.4 \* shade, 0\.26 \* shade, 0\.12 \* shade/.test(reel));
check("paintAttractFx smear + chroma + calm", /attract-smear/.test(reel) && /shot\.chroma/.test(reel) && /is-calm/.test(reel));
check("snap plant after cut", /justCut/.test(reel) && /_plantCar/.test(reel) && /attractChassisYCleared/.test(reel));
check("grounded cars sit flat", /pose\.jump \? -0\.12 : 0/.test(reel) && !/Math\.sin\(this\.t \* 8/.test(reel));
check("sand trench under play lane", /attractBackdropY/.test(reel) && /attractPlayLaneLandY/.test(reel));

let hullOk = true;
let hullDetail = "";
for (let d = 0; d < decks.length && hullOk; d++) {
  const deck = decks[d];
  const minY = attractHullMinY(deck);
  if (minY < deck - ATTRACT_WHEEL_KISS - 1e-9) hullOk = false;
  if (minY > deck + 0.002) hullOk = false;
  const jumpPitch = -0.12;
  const cleared = attractChassisYCleared(deck, jumpPitch, 0);
  const planted = attractChassisY(deck);
  if (cleared < planted - 1e-9) hullOk = false;
  if (cleared - attractPitchClearance(jumpPitch, 0) - planted > 1e-9) hullOk = false;
  const lowest = cleared - attractPitchClearance(jumpPitch, 0);
  if (lowest < deck - ATTRACT_TIRE_PLANT - ATTRACT_HULL_EPS) hullOk = false;
  if (!hullOk) hullDetail = `deck=${deck} minY=${minY.toFixed(4)} cleared=${cleared.toFixed(4)}`;
}
check("no car AABB below deck − epsilon", hullOk, hullDetail || `eps=${ATTRACT_HULL_EPS}m`);

let sandOk = true;
let sandDetail = "";
const laneDists = [0, 2.4, 5.2, ATTRACT_ROAD_HALF, ATTRACT_ROAD_HALF + 0.3];
for (let d = 0; d < decks.length && sandOk; d++) {
  for (let i = 0; i < laneDists.length && sandOk; i++) {
    const deck = decks[d];
    const dist = laneDists[i];
    const landY = attractBackdropY(deck, dist, 2.2);
    if (attractSandPokesRoad(deck, landY, Math.min(dist, ATTRACT_ROAD_HALF))) sandOk = false;
    if (dist <= ATTRACT_ROAD_HALF + 0.35 && landY > attractPlayLaneLandY(deck) + 1e-9) sandOk = false;
    if (dist <= ATTRACT_ROAD_HALF && landY > deck - 0.12) sandOk = false;
    if (!sandOk) sandDetail = `deck=${deck} dist=${dist} land=${landY.toFixed(4)} cap=${attractPlayLaneLandY(deck).toFixed(4)}`;
  }
}
check("no sand tile above road in play lane", sandOk, sandDetail || `drop=${(decks[0] - attractPlayLaneLandY(decks[0])).toFixed(2)}m`);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "attract reel armed"}`);
process.exit(fail ? 1 : 0);
