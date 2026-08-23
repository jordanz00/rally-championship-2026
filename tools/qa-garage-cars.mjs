#!/usr/bin/env node
/**
 * qa-garage-cars.mjs — expanded garage + rival chassis gate.
 *
 * RUN: node tools/qa-garage-cars.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCacheVersions } from "./qa-cache-version.mjs";

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

console.log(`GARAGE CARS GATE  ·  ${new Date().toISOString()}\n`);

const celica = read("js/cars/celica.js");
const config = read("js/config.js");
const ai = read("js/ai.js");
const game = read("js/game.js");
const index = read("index.html");
const audio = read("js/audio/engine.js");
const main = read("js/main.js");

for (const id of ["jaguar", "focus", "accord"]) {
  check(`${id} hero glb`, exists(`assets/${id}/${id === "jaguar" ? "etype" : id}.glb`), "assets on disk");
  check(`${id} rival glb`, exists(`assets/${id}/rival.glb`), "rival LOD");
}

check("GARAGE jaguar", /jaguar:\s*\{/.test(celica), "garage entry");
check("GARAGE_CAR_IDS export", /export const GARAGE_CAR_IDS/.test(celica), "ids export");
check("rivalChassisForIndex", /export function rivalChassisForIndex/.test(celica), "rival picker");
check("CARS jaguar", /jaguar:\s*\{/.test(config), "physics spec");
check("AI pro line", /proLineTarmac/.test(config), "pro racing line");
check("AI chassis per rival", /rivalChassisForIndex/.test(ai), "ai import");
check("rival mesh chassis", /createRivalCar\(aiTintForIndex\(index\), index, this\.chassisId\)/.test(ai), "mesh");
check("subtle car bump", /hitCar > 0\.2/.test(game), "lower bump threshold");
check("carBump subtle", /gain: 0\.07 \+ amt \* 0\.16/.test(audio), "quieter bump sfx");
check("select UI jaguar", /data-car="jaguar"/.test(index), "select button");
const { gameV, ok: cacheOk } = readCacheVersions(main, index);
check("cache bust chain", cacheOk, `v=${gameV}`);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Garage expansion armed"}`);
process.exit(fail ? 1 : 0);
