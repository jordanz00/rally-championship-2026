#!/usr/bin/env node
/**
 * qa-focus-scale.mjs — Focus ST is retired. Prove the three rally cars
 * share wrapper-identity scale (hero + rival) without the old ST squash.
 *
 * RUN: node tools/qa-focus-scale.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}`);
  else {
    console.log(`  FAIL  ${label}  —  ${detail}`);
    fail += 1;
  }
}

console.log("RALLY CAR SCALE (Focus ST retired)\n");

const config = read("js/config.js");
const celica = read("js/cars/celica.js");
const index = read("index.html");

check("Focus ST not in CARS", !/id:\s*"focus"/.test(config));
check("Focus ST not in GARAGE", !/id:\s*"focus"/.test(celica) || !/name:\s*"focus-st"/.test(celica));
check("Focus ST not on SELECT CAR", !/data-car="focus"/.test(index));
check("Jaguar not on SELECT CAR", !/data-car="jaguar"/.test(index));
check("Accord not on SELECT CAR", !/data-car="accord"/.test(index));
check("inner-scene fit still used", /inner\.scale\.multiplyScalar\(targetLen \/ len\)/.test(celica));
check("wrapper identity scale", /root\.scale\.set\(1, 1, 1\)/.test(celica));
check("Celica / Delta / Stratos selectable", /data-car="celica"/.test(index) && /data-car="delta"/.test(index) && /data-car="stratos"/.test(index));

console.log(fail ? `\nFAIL ${fail}` : "\nPASS");
process.exit(fail ? 1 : 0);
