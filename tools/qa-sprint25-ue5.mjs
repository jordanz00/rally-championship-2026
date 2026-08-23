#!/usr/bin/env node
/**
 * qa-sprint25-ue5.mjs — Sprint 25 gate: UE5-style PBR photoreal in browser.
 *
 * RUN: node tools/qa-sprint25-ue5.mjs
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

console.log(`SPRINT 25 UE5 PHOTOREAL GATE  ·  ${new Date().toISOString()}\n`);

const config = read("js/config.js");
const pbr = read("js/gfx/pbr.js");
const post = read("js/gfx/postfx.js");
const track = read("js/tracks/track.js");
const game = read("js/game.js");

const tier = Number((config.match(/\btier:\s*(\d+)/) || [])[1] || 0);
check("VISUAL.tier >= 10", tier >= 10, `tier is ${tier}`);
check("ue5Look armed", /ue5Look:\s*true/.test(config), "ue5Look: true");
check("physicalLighting armed", /physicalLighting:\s*true/.test(config), "physicalLighting");
check("roughnessMaps armed", /roughnessMaps:\s*true/.test(config), "roughnessMaps");
check("filmGrain set", /filmGrain:\s*0\.\d+/.test(config), "filmGrain");
check("pmremSize 128", /pmremSize:\s*128/.test(config), "IBL bake size");
check("paint clearcoat", /clearcoat:\s*1/.test(pbr) && /MeshPhysicalMaterial/.test(pbr), "player lacquer");
check("glass Physical no transmission", /ior:\s*1\.45/.test(pbr) && !/transmission:\s*[1-9]/.test(pbr), "ior glass");
check("chrome metal Standard", /metalness:\s*1/.test(pbr), "chrome metalness");
check("road roughnessMap arg", /roughnessMap/.test(pbr) && /worldRoadMaterial\(id, map, normalMap = null, aoMap = null, roughnessMap/.test(pbr), "road PBR");
check("roadRoughFor", /function roadRoughFor/.test(track), "road roughness bake");
check("landRoughnessMap", /function landRoughnessMap/.test(track), "land roughness bake");
check("roadRough wired", /roadRoughFor\(b\.id\)/.test(track), "ribbon uses roughness");
check("legacy lights off", /useLegacyLights\s*=\s*false/.test(game), "physical light model");
check("adaptive 60Hz kept", /adaptHighMs/.test(config) && /setQuality/.test(post), "Sprint 24 budget");
check("post film grain", /uniform float grain/.test(post), "grade grain");

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Sprint 25 UE5 photoreal armed"}`);
process.exit(fail ? 1 : 0);
