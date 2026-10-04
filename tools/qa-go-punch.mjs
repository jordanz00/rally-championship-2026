#!/usr/bin/env node
/**
 * qa-go-punch.mjs — lights-out punches; first 10 s sell the launch.
 *
 * Player moment: GO snaps, the car hooks, the pack leaves with you.
 * Play-turn lock and Desert 1654 stay put.
 *
 * RUN: node tools/qa-go-punch.mjs
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

console.log(`GO PUNCH  ·  ${new Date().toISOString()}\n`);

const veh = read("js/physics/vehicle.js");
const game = read("js/game.js");
const ai = read("js/ai.js");
const hud = read("js/ui/hud.js");
const css = read("css/game.css");
const main = read("js/main.js");
const html = read("index.html");
const config = read("js/config.js");

check("GO rush window is 1.18 s", /const GO_RUSH_S = 1\.18/.test(veh));
check("GO rush drive is 1.22×", /const GO_RUSH_DRIVE = 1\.22/.test(veh));
check("freezeLaunch arms the rush", /this\._goRush = GO_RUSH_S/.test(veh));
check("straight launch plants, steer still slides", /Math\.abs\(st\) < 0\.18/.test(veh) && /muR \*= lerp\(1, 1\.16/.test(veh));
check("play-turn lock untouched", /maxSteer \* 1\.28/.test(veh) && /kus \*= 0\.55/.test(veh));
check("rack bite untouched", /lerp\(1\.62, 0\.82/.test(veh));
check("slide-bounce plant still the glue", /_pinManeuverDeck\(\)/.test(veh));

check("GO feel lasts 1.35 s", /this\._goFeel = 1\.35/.test(game));
check("GO FOV kick is 4.6°", /_camFovKick \|\| 0, 4\.6/.test(game));
check("GO shake survives chatter", /goImpulse/.test(game) && /0\.05 \+ this\._goFeel \* 0\.07/.test(game));
check("first 30 s rush the lens", /raceTime < 30/.test(game) && /startRushFov/.test(game) && /min\(5\.2/.test(game));
check("countersteer catches earlier", /Math\.abs\(st\) \/ 0\.2/.test(veh) && /counterAuthority \* snap \* 1\.18/.test(veh));
check("recovery assist is quicker", /recAsst \* counter \* \(0\.72/.test(veh));
check("config CAMERA speedFovScale left at 0", /speedFovScale: 0/.test(config));
check("config launchBoost left at 1.88", /launchBoost: 1\.88/.test(config));

check("HUD marks GO!", /classList\.toggle\("is-go", text === "GO!"\)/.test(hud));
check("GO banner is the big flash", /#hud-flash\.show\.is-go/.test(css) && /@keyframes flashGo/.test(css));

check("AI floors the start town", /v\.progress < 82 && spd < 22 && Math\.abs\(d1\) < 0\.22/.test(ai));
check("AI pack pace unchanged", /0\.78 \+ this\.skill \* 0\.15/.test(ai));

check("game imports vehicle.js?v=183+", Number((game.match(/vehicle\.js\?v=(\d+)/) || [])[1]) >= 183);
check("game imports ai.js?v=215+", Number((game.match(/ai\.js\?v=(\d+)/) || [])[1]) >= 215);
check("game imports hud.js?v=43+", Number((game.match(/hud\.js\?v=(\d+)/) || [])[1]) >= 43);
check("boot cache is 982+", Number((main.match(/game\.js\?v=(\d+)/) || [])[1]) >= 982);
check("index boots main.js?v=982+", Number((html.match(/main\.js\?v=(\d+)/) || [])[1]) >= 982);
check("index css is 58+", Number((html.match(/game\.css\?v=(\d+)/) || [])[1]) >= 58);

check("rain module not rewritten here", /rain\.js\?v=28/.test(game));
check("codriver import left alone", /codriver\.js\?v=\d+/.test(game));
check("tsr sdk import is live WebTSR", Number((game.match(/browser-reconstruct-sdk\/index\.js\?v=(\d+)/) || [])[1]) >= 981);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "punchy GO, hook-up launch"}`);
process.exit(fail ? 1 : 0);
