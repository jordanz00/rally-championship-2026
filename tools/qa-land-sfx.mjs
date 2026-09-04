#!/usr/bin/env node
/**
 * Landing SFX — authentic jump→ground one-shot (not curb ticks).
 *
 * RUN: node tools/qa-land-sfx.mjs
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

console.log(`LAND SFX  ·  ${new Date().toISOString()}\n`);

const vehicle = read("js/physics/vehicle.js");
const engine = read("js/audio/engine.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");
const attr = read("assets/sfx/ATTRIBUTION.txt");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

check("_noteLandImpact arms lastImpact before air clear", /_noteLandImpact\(/.test(vehicle) && /this\.lastImpact = Math\.max/.test(vehicle));
check("floor-clamp land path notes impact", /solidDeck\) \{[\s\S]*?_noteLandImpact\(impact\)/.test(vehicle));
check("pad-hit land path notes impact", /hitting\) \{[\s\S]*?_noteLandImpact\(impact\)/.test(vehicle));
check("axle-lift land path notes impact", /!this\.onGround && anySolid[\s\S]*?_noteLandImpact\(impact\)/.test(vehicle));
check("authentic gate skips micro-airs", /air >= 0\.085/.test(vehicle) && /_landPadArmed \|\| this\._jumpPhase/.test(vehicle));

check("landThump exists and uses playHit", /landThump\(impact/.test(engine) && /playHit\(this\.ctx/.test(engine));
check("landThump respects mute / sfxVol / bus", /_workMute/.test(engine.match(/landThump[\s\S]*?wallGlance/)?.[0] || "") && /sfxVol <= 0\.001/.test(engine.match(/landThump[\s\S]*?wallGlance/)?.[0] || ""));
check("landThump varies recipe by impact / upset / surface", /_landRecipe/.test(engine) && /surfaceId/.test(engine.match(/landThump[\s\S]*?wallGlance/)?.[0] || ""));
check("land layers use bank overrun/gravel/chirp", /_hits\.overrun/.test(engine) && /_hits\.gravel/.test(engine) && /_hits\.chirp/.test(engine));
check("procedural land buffers boot", /landSoft/.test(engine) && /landHard/.test(engine));
check("impact bus bypasses cabin high-pass", /_impactIn/.test(engine) && /impactHp/.test(engine));
check("makeLandNoise multi-band plant", /makeLandNoise\(ctx,\s*[\d.]+,\s*"soft"\)/.test(engine) || /kind === "soft"/.test(engine));

check("game fires landThump once per armed impact", /landThump\(landHit/.test(game) || /audio\.landThump\(/.test(game));
check(
  "game gates on airTime or hard impact",
  /landAir > 0\.05 \|\| landHit > 1\.8/.test(game) || /landAir > 0\.055/.test(game)
);
check("game clears land telemetry after play", /lastImpact = 0/.test(game) && /lastAirTime = 0/.test(game));

check("ATTRIBUTION documents land thumps", /Jump landing thumps/.test(attr));
check("engine.js cache-bust v>=65", Number((game.match(/engine\.js\?v=(\d+)/) || [])[1]) >= 65);
check("vehicle.js cache-bust v>=132", Number((game.match(/vehicle\.js\?v=(\d+)/) || [])[1]) >= 132);
check("cache-bust chain v>=639", cacheOk && Number(gameV) >= 639 && Number(mainV) >= 639, `main=${mainV} game=${gameV}`);

console.log(fail ? `\nFAIL  ${fail} check(s)` : "\nPASS");
process.exit(fail ? 1 : 0);
