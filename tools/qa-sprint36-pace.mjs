#!/usr/bin/env node
/** qa-sprint36-pace.mjs — Sprint 36 pace library + cockpit anim */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fail = 0;
function check(l, ok, d) {
  if (ok) console.log(`  ok  ${l}`);
  else { console.log(`  FAIL  ${l} — ${d}`); fail++; }
}

const pace = fs.readFileSync(path.join(ROOT, "js/tracks/pace-notes.js"), "utf8");
const track = fs.readFileSync(path.join(ROOT, "js/tracks/track.js"), "utf8");
const game = fs.readFileSync(path.join(ROOT, "js/game.js"), "utf8");
const cockpit = fs.readFileSync(path.join(ROOT, "js/cars/cockpit-anim.js"), "utf8");

console.log("SPRINT 36 PACE + COCKPIT\n");
check("authored pace library", /AUTHORED_PACE/.test(pace) && /desert:/.test(pace));
check("geometry picker, not authored override", /pickPaceNote/.test(track) && !/findAuthoredNote/.test(track));
check("cockpit motion module", /updateCockpitMotion/.test(cockpit));
check("game calls cockpit motion", /updateCockpitMotion/.test(game));
check("4 courses in library", (pace.match(/desert:|forest:|mountain:|lakeside:/g) || []).length >= 4);
console.log(fail ? `\nFAIL ${fail}` : "\nPASS");
process.exit(fail ? 1 : 0);
