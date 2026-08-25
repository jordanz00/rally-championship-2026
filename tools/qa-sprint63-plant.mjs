#!/usr/bin/env node
/**
 * Sprint 63 — tire contact patch sits on the visual tarmac.
 *
 * RUN: node tools/qa-sprint63-plant.mjs
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

console.log(`SPRINT 63 TIRE PLANT  ·  ${new Date().toISOString()}\n`);

const vehicle = read("js/physics/vehicle.js");
const celica = read("js/cars/celica.js");
const game = read("js/game.js");
const ai = read("js/ai.js");
const main = read("js/main.js");
const index = read("index.html");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

const plant = Number((vehicle.match(/const TIRE_PLANT\s*=\s*([0-9.]+)/) || [])[1]);
const deckFilt = Number((vehicle.match(/const DECK_FILT_RATE\s*=\s*([0-9.]+)/) || [])[1]);
const visRate = Number((vehicle.match(/const VIS_PITCH_RATE\s*=\s*([0-9.]+)/) || [])[1]);
const deckFn = (vehicle.match(/_roadDeckY\(axles\) \{[\s\S]*?\n  \}/) || [""])[0];

check(
  "contact origin is the tire patch",
  /plantOnContactPatch\(root\)/.test(celica) && /lowest \*tire\*/.test(celica)
);
check(
  "TIRE_PLANT is a centimetre embed, not a 9 cm sink",
  Number.isFinite(plant) && plant > 0.008 && plant < 0.025,
  `TIRE_PLANT=${plant}`
);
check(
  "deck Y is axle-plane mid (no lower-axle 0.38 bias)",
  /return axles\.midH - TIRE_PLANT/.test(deckFn) && !/\* 0\.38/.test(deckFn)
);
check(
  "hill-sized deck errors use HANDLING.deckFollowRate",
  /DECK_NOISE_BAND/.test(vehicle) && /HANDLING\.deckFollowRate/.test(vehicle)
);
check(
  "noise-only deck filter is faster than the old 8/s lag",
  Number.isFinite(deckFilt) && deckFilt >= 24,
  `DECK_FILT_RATE=${deckFilt}`
);
check(
  "visual pitch follows real grades instead of lagging 5/s",
  Number.isFinite(visRate) && visRate >= 14 && /VIS_PITCH_SNAP/.test(vehicle),
  `VIS_PITCH_RATE=${visRate}`
);
check(
  "mesh pitch catches the axle plane on the ground",
  /Math\.exp\(-24 \* dt\)/.test(vehicle)
);
check("game + AI import vehicle.js", /vehicle\.js\?v=\d+/.test(game) && /vehicle\.js\?v=\d+/.test(ai));
check("cache-bust chain", cacheOk && Number(gameV) >= 379, `main=${mainV} game=${gameV}`);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "tires plant on the visual deck"}`);
process.exit(fail ? 1 : 0);
