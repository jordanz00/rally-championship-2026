#!/usr/bin/env node
/**
 * qa-realistic-visual.mjs — Sprint 12 gate: realistic render tier is on in source.
 *
 * RUN: node tools/qa-realistic-visual.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

let fail = 0;

function check(label, ok, detail) {
  if (ok) console.log(`  ok  ${label}`);
  else {
    console.log(`  FAIL  ${label}  —  ${detail}`);
    fail += 1;
  }
}

console.log(`REALISTIC VISUAL GATE  ·  ${new Date().toISOString()}\n`);

const config = read("js/config.js");
check("VISUAL.realisticArcade enabled", /realisticArcade:\s*true/.test(config), "set realisticArcade: true");
check("normalStrength configured", /normalStrength:/.test(config), "missing VISUAL.normalStrength");
check("worldEnvIntensity configured", /worldEnvIntensity:\s*0\.\d+/.test(config), "missing world IBL");
check("pmremSize configured", /pmremSize:\s*64/.test(config), "GFX.pmremSize 64 for 60 Hz budget");
check("normalMapScale half-res", /normalMapScale:\s*0\.5/.test(config), "half-res normals");

const pbr = read("js/gfx/pbr.js");
check("worldRoadMaterial accepts normalMap", /normalMap/.test(pbr), "pbr.js road normals");

const track = read("js/tracks/track.js");
check("roadNormalFor present", /function roadNormalFor/.test(track), "track.js road normals");
check("landNormalMap present", /function landNormalMap/.test(track), "track.js terrain normals");
check("road build wires normals", /roadNormalFor\(b\.id\)/.test(track), "worldRoadMaterial normal wiring");

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "realistic tier armed"}`);
process.exit(fail ? 1 : 0);
