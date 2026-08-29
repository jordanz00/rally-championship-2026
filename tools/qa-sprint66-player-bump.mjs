#!/usr/bin/env node
/**
 * Sprint 66 — AI pack cannot shove/slide the player off their line.
 *
 * RUN: node tools/qa-sprint66-player-bump.mjs
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

console.log(`SPRINT 66 PLAYER BUMP  ·  ${new Date().toISOString()}\n`);

const collide = read("js/physics/collide.js");
const game = read("js/game.js");
const vehicle = read("js/physics/vehicle.js");
const ai = read("js/ai.js");
const main = read("js/main.js");
const index = read("index.html");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

check(
  "player-vs-rival has its own resolver",
  /function resolvePlayerRival\(/.test(collide) &&
    /resolvePlayerRival\(a, b, hit/.test(collide)
);
check(
  "player depenetration is capped to a bump",
  /PLAYER_PUSH_CAP\s*=\s*0\.028/.test(collide) && /PLAYER_SEPARATE\s*=\s*0\.18/.test(collide)
);
check(
  "player inverse-mass share is well under the old 0.42",
  /PLAYER_ANCHOR\s*=\s*0\.12/.test(collide)
);
check(
  "player closing-speed Δv is capped",
  /PLAYER_BUMP_VEL\s*=\s*2\.2/.test(collide)
);
check(
  "tangent drag barely reaches the player",
  /PLAYER_SLIDE_SHARE\s*=\s*0\.12/.test(collide) && /PLAYER_TANGENT_GRIP\s*=\s*0\.04/.test(collide)
);
check(
  "rival steps around instead of staying glued",
  /PLAYER_RIVAL_SIDESTEP\s*=\s*0\.4/.test(collide) && /_aiPassT\s*=\s*0\.7/.test(collide)
);
check(
  "pass / sidestep is one-shot while _aiPassT is hot",
  /_aiPassT \|\| 0\) <= 0\.04/.test(collide) &&
    /Re-firing AI_PASS_LATERAL/.test(collide) &&
    /One sidestep per rub/.test(collide)
);
check(
  "AI-AI pack path is unchanged",
  /AI_PASS_LATERAL\s*=\s*0\.55/.test(collide) && /AI_SEPARATE\s*=\s*0\.55/.test(collide)
);
check(
  "game + vehicle import collide.js?v=34+",
  Number((game.match(/collide\.js\?v=(\d+)/) || [])[1]) >= 34 &&
    Number((vehicle.match(/collide\.js\?v=(\d+)/) || [])[1]) >= 34
);
const vehGame = (game.match(/vehicle\.js\?v=(\d+)/) || [])[1];
const vehAi = (ai.match(/vehicle\.js\?v=(\d+)/) || [])[1];
check("game + AI import vehicle.js", Number(vehGame) >= 75 && Number(vehAi) >= 75, `game=${vehGame} ai=${vehAi}`);
check(
  "game imports ai.js?v=109+",
  Number((game.match(/ai\.js\?v=(\d+)/) || [])[1]) >= 109
);
check("cache-bust chain", cacheOk && Number(gameV) >= 376, `main=${mainV} game=${gameV}`);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "rivals bump, they do not slide the player"}`);
process.exit(fail ? 1 : 0);
