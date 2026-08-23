#!/usr/bin/env node
/** qa-sprint37-audio.mjs — Sprint 37 mixer + reverb zones */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fail = 0;
function check(l, ok, d) {
  if (ok) console.log(`  ok  ${l}`);
  else { console.log(`  FAIL  ${l} — ${d}`); fail++; }
}

const engine = fs.readFileSync(path.join(ROOT, "js/audio/engine.js"), "utf8");
const reverb = fs.readFileSync(path.join(ROOT, "js/audio/reverb-zones.js"), "utf8");
const game = fs.readFileSync(path.join(ROOT, "js/game.js"), "utf8");

console.log("SPRINT 37 AUDIO MIX + REVERB\n");
check("reverb zones module", /ReverbZones/.test(reverb) && /REVERB_ZONES/.test(reverb));
check("engine wires reverb", /_reverb/.test(engine) && /setZone/.test(engine));
check("game passes reverbZone", /reverbZone/.test(game) && /zoneFromSample/.test(game));
check("tunnel zone", /tunnel:/.test(reverb));
console.log(fail ? `\nFAIL ${fail}` : "\nPASS");
process.exit(fail ? 1 : 0);
