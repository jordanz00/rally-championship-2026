#!/usr/bin/env node
/**
 * qa-forest-headlights.mjs — Stage 2 tunnel beams are ~30% dimmer.
 *
 * Player moment: Forest rock tunnel. Headlights still own the bore, but the
 * cabin is not a white flash.
 *
 * RUN: node tools/qa-forest-headlights.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

console.log(`FOREST HEADLIGHTS  ·  ${new Date().toISOString()}\n`);

const game = read("js/game.js");
const main = read("js/main.js");
const html = read("index.html");
const cfg = read("js/config.js");

check("config Forest beam is still the hot authored value", /headBeam: 1850/.test(cfg) && /headBeamTunnelBoost: 2\.55/.test(cfg));
check("raceTunnelLighting dims Forest beams ~30%", /headBeam: 1295/.test(game) && /headEmissive: 34/.test(game));
check("tunnel boost stays so the bore still reads", !/headBeamTunnelBoost: 1\.78/.test(game));
check("setHeadlights uses the race tunnel profile", /profile: TC/.test(game));
check("boot cache is 979+", Number((main.match(/game\.js\?v=(\d+)/) || [])[1]) >= 979);
check("index boots main.js?v=979+", Number((html.match(/main\.js\?v=(\d+)/) || [])[1]) >= 979);

const authored = 1850 * 2.55;
const raced = 1295 * 2.55;
const ratio = raced / authored;
check(
  "effective Forest beam is ~70% of config",
  ratio > 0.64 && ratio < 0.76,
  `${(ratio * 100).toFixed(0)}% (${raced.toFixed(0)} / ${authored.toFixed(0)})`
);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Forest tunnel headlights dimmed"}`);
process.exit(fail ? 1 : 0);
