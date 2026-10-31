#!/usr/bin/env node
/**
 * qa-lock-race-look.mjs — desktop look stays put for a whole stage.
 *
 * Player moment: lighting, textures and resolution do not pop or mush
 * worse as the lap goes on. Cadence may still lock 30. Phones may still shed.
 *
 * RUN: node tools/qa-lock-race-look.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCacheVersions } from "./qa-cache-version.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`LOCK RACE LOOK  ·  ${new Date().toISOString()}\n`);

const game = read("js/game.js");
const config = read("js/config.js");
const main = read("js/main.js");
const index = read("index.html");
const floor = read("js/gfx/floor-guard.js");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

check("config pins lockRaceQuality", /lockRaceQuality:\s*true/.test(config));
check("config softScaleMin is 1", /softScaleMin:\s*1/.test(config));
check("lockRaceLook helper exists", /function lockRaceLook\(/.test(game));
check("desktop only (phones still shed)", /!isPhonePlay\(\)/.test(game) && /lockRaceQuality/.test(game));
check(
  "present loop skips TSR / floor / scale sheds",
  /if \(!lockRaceLook\(\)\) \{/.test(game) &&
    /_adaptPresentBudget\(presentDelta\)/.test(game) &&
    /_applyFloorLevel/.test(game)
);
check("adapt early-returns on lockRaceLook", /_adaptPresentBudget\(presentDelta\) \{[\s\S]{0,80}?if \(lockRaceLook\(\)\) return;/.test(game));
check(
  "floor apply refuses desktop sheds",
  /_applyFloorLevel\(level\) \{[\s\S]{0,80}?if \(lockRaceLook\(\)\) \{/.test(game)
);
check("desktop does not open a soft-scale hole", /GFX\.softScaleMin = 1/.test(game) && !/GFX\.softScaleMin = 0\.(78|86)/.test(game));
check("GO desktop present scale is 1", /_softRenderScale = phoneRace \? 0\.62 : 1/.test(game));
check("settle restores TSR unless user-pinned", /restoreTsr \|\| "quality"/.test(game));
check("floor-guard docs defer to lockRaceLook", /lockRaceLook\(\)/.test(floor));
check(
  "cache-bust lockstep",
  cacheOk && Number(mainV) >= 1249 && Number(gameV) >= 1249,
  `main=${mainV} game=${gameV}`
);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "desktop look pinned for the stage"}`);
process.exit(fail ? 1 : 0);
