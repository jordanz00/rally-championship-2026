/**
 * qa-sprint38-realism.mjs — Sprint 38 visual realism gate (Desert / sky / crowd).
 * RUN: node tools/qa-sprint38-realism.mjs
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const crowd = read("js/tracks/crowd.js");
const track = read("js/tracks/track.js");
const config = read("js/config.js");
const sky = read("js/sky.js");
const index = read("index.html");
const game = read("js/game.js");

let pass = 0;
let fail = 0;

function check(label, ok, hint) {
  if (ok) {
    pass++;
    console.log(`  ok  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${hint ? ` — ${hint}` : ""}`);
  }
}

console.log("SPRINT 38 REALISM  ·  " + new Date().toISOString() + "\n");

check("crowd per-instance tints", /CROWD_TINTS/.test(crowd) && /setColorAt/.test(crowd));
check("crowd cheer styles (clap/wave/overhead)", /cheerStyle/.test(crowd));
check("crowd casts shadows", /\.castShadow\s*=\s*true/.test(crowd));
check("desert gallery barriers", /_addDesertRoadsideGallery/.test(track));
check("desert horizon acacia", /_addDesertHorizonAcacia/.test(track));
check("safari herd uses HD nature", /_addHdNature\(kinds\[i\]/.test(track));
check("desert spectator density", /maxPoses = desert \? 128/.test(track));
check("cactus_short variety", /cactus_short/.test(track));
check("desert sun intensity raised", /sunInt:\s*3\.05/.test(config));
check("desert dust haze", /dustStrength:\s*0\.28/.test(config));
check("desert cloud palette tuned", /cover:\s*0\.18/.test(sky));
check("cache v495", /\?v=495/.test(index) && /\?v=495/.test(read("js/main.js")));

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Sprint 38 visual realism armed"}`);
process.exit(fail ? 1 : 0);
