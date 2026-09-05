#!/usr/bin/env node
/**
 * qa-garage-cars.mjs — authentic Group A garage (Celica / Delta / Stratos).
 *
 * Road cars (Jaguar E-Type, Focus ST, Accord Sport) are retired from the
 * player path. Rivals share the same three rally chassis.
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

const RALLY = ["celica", "delta", "stratos"];
const ROAD = ["jaguar", "focus", "accord"];

for (const id of RALLY) {
  const hero =
    id === "celica"
      ? "assets/celica/gt4.glb"
      : id === "delta"
        ? "assets/delta/integrale.glb"
        : "assets/stratos/stratos.glb";
  check(`${id} hero glb`, exists(hero), hero);
  check(`${id} rival glb`, exists(`assets/${id}/rival.glb`), "rival LOD");
  check(`GARAGE ${id}`, new RegExp(`${id}:\\s*\\{`).test(celica), "garage entry");
  check(`CARS ${id}`, new RegExp(`${id}:\\s*\\{`).test(config), "physics spec");
  check(`select UI ${id}`, new RegExp(`data-car="${id}"`).test(index), "select button");
}

for (const id of ROAD) {
  check(`GARAGE retired ${id}`, !new RegExp(`${id}:\\s*\\{`).test(celica), "must not be selectable");
  check(`CARS retired ${id}`, !new RegExp(`id:\\s*"${id}"`).test(config), "must not have physics spec");
  check(`select UI retired ${id}`, !new RegExp(`data-car="${id}"`).test(index), "must not have a button");
}

check("exactly three garage chassis", /export const GARAGE_CAR_IDS/.test(celica), "ids export");
check(
  "SELECT CAR is three rally buttons",
  (index.match(/data-car="/g) || []).length === 3,
  "Celica / Delta / Stratos only"
);
check("rivalChassisForIndex", /export function rivalChassisForIndex/.test(celica), "rival picker");
check("AI chassis per rival", /rivalChassisForIndex/.test(ai), "ai import");
check("rival mesh chassis", /createRivalCar\(aiTintForIndex\(index\), index, this\.chassisId\)/.test(ai), "mesh");
check("subtle car bump", /hitCar > 0\.2/.test(game), "lower bump threshold");
check("carBump subtle", /gain: 0\.07 \+ amt \* 0\.16/.test(audio), "quieter bump sfx");
// ES modules treat ?v= as part of the URL — mismatched celica versions create
// two garage singletons. LOD warm fills one; createRivalCar reads the empty other.
const gameCelicaV = (game.match(/celica\.js\?v=(\d+)/) || [])[1] || "";
const aiCelicaV = (ai.match(/celica\.js\?v=(\d+)/) || [])[1] || "";
check(
  "garage singleton (game↔ai celica ?v=)",
  !!(gameCelicaV && aiCelicaV && gameCelicaV === aiCelicaV),
  `game=${gameCelicaV || "missing"} ai=${aiCelicaV || "missing"}`
);
const { gameV, ok: cacheOk } = readCacheVersions(main, index);
check("cache bust chain", cacheOk, `v=${gameV}`);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Authentic three-car rally garage"}`);
process.exit(fail ? 1 : 0);
