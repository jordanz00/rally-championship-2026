#!/usr/bin/env node
/**
 * Brake glow must sit on the model's tail covers, not inner boxes or pads.
 *
 * RUN: node tools/qa-brake-lamps.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCacheVersions } from "./qa-cache-version.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

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

console.log(`BRAKE LAMP ALIGN  ·  ${new Date().toISOString()}\n`);

const car = read("js/cars/celica.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");
const ai = read("js/ai.js");

check("visible tail covers (combi / TailLight / Light Rear)", /function isVisibleTailCover/.test(car));
check("pick uses covers before inner REARLIGHT glass", /const covers = items.filter/.test(car) && /pool = covers.length \? covers : items/.test(car));
check("ensureBrakeLights lights GLB meshes, no nested pads", /prepareBrakeMaterial\(keep\[i\]\)/.test(car) && !/nestBrakeEmittersInLamp\(keep/.test(car));
check("glass opacity punches when brakes are on", /_brakeRestOpacity/.test(car) && /opacity = on \? 0\.94/.test(car));
check("glow origin is lens AABB", /function lampLocalCenter/.test(car) && /geometry.boundingBox/.test(car));
check("game and AI still call setBrakeLights", /setBrakeLights\(this.playerMesh/.test(game) && /setBrakeLights\(this.mesh/.test(ai));

const { gameV, ok: cacheOk } = readCacheVersions(main, index);
check("cache bust chain", cacheOk && Number(gameV) >= 453, `v=${gameV}`);
check("celica import v=128+", Number((game.match(/celica\.js\?v=(\d+)/) || [])[1]) >= 128);
check("ai celica import v=128+", Number((ai.match(/celica\.js\?v=(\d+)/) || [])[1]) >= 128);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "brake glow sits on modeled tail covers"}`);
process.exit(fail ? 1 : 0);
