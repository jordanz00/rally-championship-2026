#!/usr/bin/env node
/**
 * Attract reel — smooth cinematic tour (no MTV flash edits).
 *
 * RUN: node tools/qa-attract-reel.mjs
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

console.log(`ATTRACT REEL  ·  ${new Date().toISOString()}\n`);

const reel = read("js/cinema/attract-reel.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");
const css = read("css/game.css");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

check("AttractReel export", /export class AttractReel/.test(reel));
check("AttractDirector shots", /bumper/.test(reel) && /heli/.test(reel) && /headon/.test(reel) && /jump/.test(reel));
check("lazy-loads Track.create", /loadStageApi/.test(reel) && /track\.js\?v=/.test(reel) && /COURSES/.test(reel));
check("no junk CatmullRom ribbon", !/KNOTS/.test(reel) && !/CatmullRomCurve3/.test(reel) && !/makeCurve/.test(reel));
check("highlight beats from jumps/apexes", /function buildBeats/.test(reel) && /jumpKind/.test(reel) && /_advanceBeat/.test(reel));
check("stage tour desert→forest→mountain→lakeside", /"desert"/.test(reel) && /"forest"/.test(reel) && /"mountain"/.test(reel) && /"lakeside"/.test(reel));
check(
  "cinematic holds ≥2.8s",
  /bumper: 3\.4/.test(reel) && /heli: 4\.4/.test(reel) && /SHOT_HOLD/.test(reel) && !/bumper: 1\.05/.test(reel)
);
check("soft crossfade FADE_OUT/IN", /FADE_OUT = 0\.55/.test(reel) && /FADE_IN = 0\.7/.test(reel));
check("no hard snap on every cut", /Always ease/.test(reel) && /this\._follow\(dt\)/.test(reel));
check("continuous drive beat clock", /_beatInterval/.test(reel) && /_beatClock/.test(reel));
check("jump soft timeScale", /_timeScale/.test(reel) && /jumpSlow/.test(reel));
check("splash keeps showroom; reel on menu", /Splash stays showroom turntable/.test(game) && /_leaveTitle/.test(game) && /_startAttractReel\(\)/.test(game));
check("phones skip Track.create attract", /isPhonePlay\(\)/.test(game) && /SHOWROOM LIVE/.test(game) && /Track\.create on title OOMs/.test(game));
check("desktop defers attract boot", /requestIdleCallback/.test(game) || /setTimeout\(boot/.test(game));
check("game stops reel before race", /_stopAttractReel\(\)/.test(game));
check("game applies stage lighting on tour", /onStage:/.test(game) && /_applyLighting\(id\)/.test(game));
check("title showroom turntable spin", /Showroom turntable/.test(game) && /p\.yaw = spin/.test(game) && !/Math\.atan2\(ox, oz\)/.test(game));
check("game imports attract-reel", Number((game.match(/attract-reel\.js\?v=(\d+)/) || [])[1]) >= 19);
check("attract-fx overlay in index", /id="attract-fx"/.test(index) && /attract-letterbox/.test(index));
check("letterbox + flash CSS", /attract-letterbox/.test(css) && /attract-live/.test(css));
check("reduced-motion safe", /prefers-reduced-motion/.test(css) && /is-calm/.test(css) && /this\.reduced/.test(reel));
check(
  "cache-bust chain",
  cacheOk && Number(gameV) >= 1101 && Number(mainV) >= 1101,
  `main=${mainV} game=${gameV}`
);
check("no white cut flash", /flash: 0/.test(reel) && /this\.flash = 0/.test(reel));
check("calm overlays by default", /calm: true/.test(reel) && /smear: 0/.test(reel));
check("plant uses attractChassisY", /attractChassisYCleared/.test(reel) && /attract-plant\.js\?v=2/.test(reel));

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "smooth attract + front showroom"}`);
process.exit(fail ? 1 : 0);
