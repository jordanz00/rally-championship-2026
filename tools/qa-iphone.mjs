#!/usr/bin/env node
/**
 * qa-iphone.mjs — iPhone Safari compatibility gate.
 *
 * RUN: node tools/qa-iphone.mjs
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
    console.log(`  FAIL  ${label}${detail ? `  —  ${detail}` : ""}`);
    fail += 1;
  }
}

console.log(`IPHONE SAFARI GATE  ·  ${new Date().toISOString()}\n`);

const index = read("index.html");
const game = read("js/game.js");
const touch = read("js/ui/touch-controls.js");
const main = read("js/main.js");
const factory = read("js/gfx/renderer-factory.js");

check("viewport-fit cover", /viewport-fit=cover/.test(index));
check("apple-mobile-web-app", /apple-mobile-web-app-capable/.test(index));
check("__rallyPhoneLite early", /__rallyPhoneLite = true/.test(index));
check("iosTouchMac detect", /iosTouchMac/.test(index) && /iosTouchMac/.test(touch));
check("no modulepreload", !/rel="modulepreload"/.test(index), "preload races first paint");
check("no rival.glb preload", !/preload[^>]+rival\.glb/.test(index));
check("phones block WebGPU", /__rallyPhoneLite\) return/.test(index));
check("defer title GLB", /_titleCarWarm = isPhonePlay\(\) \? null/.test(game));
check("no phone title HDR/PMREM", /No HDR \/ PMREM on iPhone/.test(game));
check("no phone title shadow atlas", /Phones: never allocate a 1024/.test(game));
check("skip bakeSkyEnv on phone", /Phones never bake PMREM/.test(game));
check("handset pack ≤1", /phonePlay\) n = Math\.min\(n, 1\)/.test(game));
check("preparePhoneRaceCars first stage", /preparePhoneRaceCars\(this\.carId\)/.test(game));
check("skip menu LOD warm on phone", /Phones: do NOT parse three GLBs/.test(game));
check("skip menu prop-kit", /Phones: PRESS START already starts WebGL/.test(game));
check("safe GL prefers phone", /__rallyPhoneLite/.test(factory));
check("webkit AudioContext", /webkitAudioContext/.test(read("js/audio/engine.js")));
check("visualViewport resize", /visualViewport/.test(game));
check("phone no end-of-load shadow atlas", /Phones stay shadow-off until settle/.test(game));

const mainV = Number((index.match(/main\.js\?v=(\d+)/) || [])[1] || 0);
const gameV = Number((main.match(/game\.js\?v=(\d+)/) || [])[1] || 0);
check("boot ≥1103", mainV >= 1103 && gameV === mainV, `main=${mainV} game=${gameV}`);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " failed" : "iPhone Safari path armed"}`);
process.exit(fail ? 1 : 0);
