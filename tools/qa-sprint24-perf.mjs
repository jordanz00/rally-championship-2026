#!/usr/bin/env node
/**
 * qa-sprint24-perf.mjs — Sprint 24 gate: photoreal at 60 Hz, no control lag.
 *
 * RUN: node tools/qa-sprint24-perf.mjs
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

console.log(`SPRINT 24 60FPS PHOTOREAL GATE  ·  ${new Date().toISOString()}\n`);

const config = read("js/config.js");
const game = read("js/game.js");
const post = read("js/gfx/postfx.js");
const input = read("js/input.js");

const pr = Number((config.match(/maxPixelRatio:\s*([\d.]+)/) || [])[1] || 99);
const tex = Number((config.match(/textureScale:\s*(\d+)/) || [])[1] || 99);
const shadowEvery = Number((config.match(/shadowEvery:\s*(\d+)/) || [])[1] || 0);
const steer = Number((config.match(/steerSpeed:\s*([\d.]+)/) || [])[1] || 0);

check("maxPixelRatio <= 1.35", pr <= 1.35, `is ${pr}`);
check("textureScale <= 2", tex <= 2, `is ${tex}`);
check("normalMapScale half", /normalMapScale:\s*0\.5\b/.test(config), "0.5");
check("fxaa off", /fxaa:\s*false/.test(config), "fxaa false");
check("sharpen off", /sharpen:\s*0\b/.test(config), "sharpen 0");
check("shadowEvery >= 2", shadowEvery >= 2, `is ${shadowEvery}`);
check("adaptive present thresholds", /adaptHighMs/.test(config) && /adaptLowMs/.test(config), "GFX.adapt*");
check("chassis steerSpeed >= 20", steer >= 20, `is ${steer}`);
check("post setQuality", /setQuality\(/.test(post), "PhotoRealPost.setQuality");
check("quarter-res bloom", /w >> 2/.test(post) || /h >> 2/.test(post), "bloom at 1/4");
check("low quality path", /quality === \"low\"|q === \"low\"/.test(post), "skip bloom when hot");
check("adaptive present in loop", /_lastPresentCost/.test(game) && /setQuality/.test(game), "game adapts");
check("shadow needsUpdate cadence", /shadowMap\.needsUpdate/.test(game), "shadowEvery wired");
check("MSAA off with post", /antialias:\s*!\(VISUAL\.postFx/.test(game), "no MSAA+post tax");
check("snappy keyboard steer", /rate = keyTarget[\s\S]{0,80}3[68]/.test(input) || /38 : 42/.test(input), "input rates");

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Sprint 24 60fps photoreal budget armed"}`);
process.exit(fail ? 1 : 0);
