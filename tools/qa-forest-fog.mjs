#!/usr/bin/env node
/**
 * qa-forest-fog.mjs — Stage 2 distance haze is woodland air, not blue sky.
 *
 * Player moment: Forest horizon. Far trees fade into olive-gray mist, not
 * light-blue fog. The sky can stay blue above the canopy.
 *
 * RUN: node --experimental-loader ./tools/qa-strip-query-loader.mjs tools/qa-forest-fog.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LIGHTING } from "../js/config.js";
import { horizonFogColor } from "../js/gfx/lighting-rig.js";
import * as THREE from "../vendor/three.module.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`FOREST FOG  ·  ${new Date().toISOString()}\n`);

const rig = read("js/gfx/lighting-rig.js");
const game = read("js/game.js");
const main = read("js/main.js");
const html = read("index.html");

check("forest haze is authored in the rig", /stage === "forest"/.test(rig) && /0x8f937a/.test(rig));
check("applyDaylightLook passes courseId into fog", /horizonFogColor\(L, _fogHor, courseId\)/.test(rig));
check("apply lighting passes courseId", /horizonFogColor\(L, fogCol, courseId\)/.test(game));
check("game imports lighting-rig.js?v=30+", Number((game.match(/lighting-rig\.js\?v=(\d+)/) || [])[1]) >= 30);
check("boot cache is 978+", Number((main.match(/game\.js\?v=(\d+)/) || [])[1]) >= 978);
check("index boots main.js?v=978+", Number((html.match(/main\.js\?v=(\d+)/) || [])[1]) >= 978);

const forest = horizonFogColor(LIGHTING.forest, new THREE.Color(), "forest");
const skyH = new THREE.Color(LIGHTING.forest.skyHorizon);
const dr = Math.abs(forest.r - skyH.r);
const dg = Math.abs(forest.g - skyH.g);
const db = Math.abs(forest.b - skyH.b);
check(
  "forest fog is not the blue sky horizon",
  dr + dg + db > 0.18,
  `fog rgb=${forest.r.toFixed(2)},${forest.g.toFixed(2)},${forest.b.toFixed(2)} sky=${skyH.r.toFixed(2)},${skyH.g.toFixed(2)},${skyH.b.toFixed(2)}`
);
check(
  "forest fog is not blue-dominant",
  forest.b <= forest.g + 0.02 && forest.b <= forest.r + 0.08,
  `b=${forest.b.toFixed(2)} g=${forest.g.toFixed(2)} r=${forest.r.toFixed(2)}`
);

const desert = horizonFogColor(LIGHTING.desert, new THREE.Color(), "desert");
check("desert still dissolves into its horizon", desert.r > 0.7 && desert.g > 0.6, `r=${desert.r.toFixed(2)} g=${desert.g.toFixed(2)}`);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Forest haze is woodland air"}`);
process.exit(fail ? 1 : 0);
