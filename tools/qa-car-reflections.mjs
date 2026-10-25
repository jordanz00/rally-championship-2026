#!/usr/bin/env node
/**
 * Nice reflections on every race car — player + pack share armRaceCarReflections.
 * RUN: node tools/qa-car-reflections.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

console.log(`CAR REFLECTIONS  ·  ${new Date().toISOString()}\n`);

const pbr = read("js/gfx/pbr.js");
const game = read("js/game.js");
const cfg = read("js/config.js");
const rig = read("js/gfx/lighting-rig.js");
const index = read("index.html");

check("armRaceCarReflections export", /export function armRaceCarReflections/.test(pbr));
check("paint clearcoat floor ≥2.75", /kind === "paint" \? 2\.75/.test(pbr));
check("game imports armRaceCarReflections", /armRaceCarReflections/.test(game));
check("player race uses armRaceCarReflections", /armRaceCarReflections\(this\.playerMesh/.test(game));
check("pack uses armRaceCarReflections", /armRaceCarReflections\(mesh, map\)/.test(game));
check("ghost gets reflections", /ghostMesh/.test(game) && /_applyPackCarEnv/.test(game));
const carEnv = Number((cfg.match(/carEnvIntensity:\s*([\d.]+)/) || [])[1] || 0);
check("carEnvIntensity ≥ 1.6", carEnv >= 1.6, `got ${carEnv}`);
check("harsh desert coat allows shine", /carEnvMax: 1\.72/.test(rig) && /coatEnvMax: 2\.85/.test(rig));
check("boot 1142+", Number((index.match(/main\.js\?v=(\d+)/) || [])[1]) >= 1142);
check("pbr?v=62+", Number((game.match(/pbr\.js\?v=(\d+)/) || [])[1]) >= 62);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "lacquer reflections on all cars"}`);
process.exit(fail ? 1 : 0);
