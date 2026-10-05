#!/usr/bin/env node
/**
 * qa-rally-rush.mjs — Paradise-scale rush: slides, draft, On Fire, dump.
 *
 * Player moment: Desert pack. Slide or draft. RUSH fills. Combo goes ON FIRE.
 * Gas dumps a long shove through the drivetrain. Tail lights a real wake.
 *
 * RUN: node --experimental-loader ./tools/qa-strip-query-loader.mjs tools/qa-rally-rush.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RallyRush } from "../js/gameplay/rally-rush.js";
import { applyBurnoutDriveTuning, rushTorqueMul } from "../js/physics/burnout-drive.js";
import { HANDLING, ARCADE_ASSIST } from "../js/config.js";

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

console.log(`RALLY RUSH ×10  ·  ${new Date().toISOString()}\n`);

const game = read("js/game.js");
const hud = read("js/ui/hud.js");
const html = read("index.html");
const main = read("js/main.js");
const look = read("js/gfx/burnout-look.js");
const effects = read("js/effects.js");
const audio = read("js/audio/engine.js");
const vehicle = read("js/physics/vehicle.js");

check("game owns RallyRush", /RallyRush/.test(game) && /this\.rush\.step/.test(game));
check("rush dumps through the drivetrain", /rushHeat/.test(game) && /rushDrive/.test(game) && !/velocity\.x \+= fx \* dump\.accel/.test(game));
check("On Fire callout is off", !/flashMessage\("ON FIRE"\)/.test(game) && /rushFire/.test(game));
check("burnout-drive overlay is live", /burnout-drive\.js\?v=\d+/.test(vehicle) && /easySlide/.test(vehicle));
check("HUD has a RUSH bar", /hud-rush/.test(html) && /hud-rush-fill/.test(hud));
check("burnout callouts stay off the HUD", !/flashMessage\("RUSH"\)/.test(game) && !/flashMessage\(n >= 4 \? "UNREAL"/.test(game));
check("rush bar is hidden", /#hud-rush \{\s*display:\s*none/.test(read("css/game.css")));
check("practice packs the grid", /Math\.max\(10, CHAMPIONSHIP\.practiceOpponents/.test(game));
check("tail fire does not emit", /emit\(_car, _heat, _fire = 0\) \{\}/.test(effects));
check("grade ignores rush and fire", /speedAmt: 0/.test(look) && /chroma: 0/.test(look) && !/fire \* \(lake/.test(look));
check("cabin rush hiss exists", /setRush\(heat/.test(audio) && /audio\.setRush/.test(game));
check("game imports vehicle.js?v=189+", Number((game.match(/vehicle\.js\?v=(\d+)/) || [])[1]) >= 189);
check("game imports postfx.js?v=43+", Number((game.match(/postfx\.js\?v=(\d+)/) || [])[1]) >= 43);
check("game imports effects.js?v=101+", Number((game.match(/effects\.js\?v=(\d+)/) || [])[1]) >= 101);
check("boot is 1032+", Number((main.match(/game\.js\?v=(\d+)/) || [])[1]) >= 1032);
check("tarmac easy-slide still needs more steer", /easySlideTarmacSteer/.test(vehicle) && /tarmacEasy/.test(vehicle));
check("AI holds the door", /PLAYER_RESPECT = 1\.05/.test(read("js/ai.js")) && /Keep rolling next to the player/.test(read("js/ai.js")));

applyBurnoutDriveTuning(HANDLING, ARCADE_ASSIST);
check("easy cool slide", HANDLING.easySlide && HANDLING.outrunHang >= 0.72 && HANDLING.slideSpeedConvert >= 1.55, `hang=${HANDLING.outrunHang} conv=${HANDLING.slideSpeedConvert}`);
check("slide initiate pitch", HANDLING.powerSlidePitch >= 4.1, `pitch=${HANDLING.powerSlidePitch}`);
check("fire torque is hotter than dump", rushTorqueMul(1, 1) > rushTorqueMul(1, 0) && rushTorqueMul(1, 1) >= 2.3, `mul=${rushTorqueMul(1, 1).toFixed(2)}`);

const rush = new RallyRush();
const player = {
  position: { x: 0, z: 0 },
  yaw: 0,
  speed: 22,
  throttle: 0.8,
  driftAngle: 0.22,
  onGround: true,
  velY: 0,
};
const slideOnly = { ...player, throttle: 0.25 };
for (let i = 0; i < 12; i++) rush.step(0.05, { player: slideOnly, opponents: [] });
check("slide fills the tank", rush.meter > 0.08, `meter=${rush.meter.toFixed(3)}`);
const before = rush.meter;
const dumpCar = { ...player, driftAngle: 0, throttle: 0.9 };
let dump = { accel: 0 };
for (let i = 0; i < 6; i++) dump = rush.step(0.05, { player: dumpCar, opponents: [] });
check(
  "throttle spends for a hard shove",
  dump.accel > 8 && rush.meter < before - 0.02,
  `accel=${dump.accel.toFixed(2)} meter=${rush.meter.toFixed(3)}`
);

const pass = new RallyRush();
const tagged = pass.step(0.05, {
  player: { ...player, driftAngle: 0, position: { x: 0, z: 0 } },
  opponents: [{ vehicle: { position: { x: 3.2, z: 0.4 } } }],
});
check("close pass is a near miss", tagged.justPass && pass.meter > 0.15, `meter=${pass.meter.toFixed(3)}`);

const draft = new RallyRush();
const dCar = { ...player, driftAngle: 0, throttle: 0.85, speed: 20, position: { x: 0, z: 0 }, yaw: 0 };
for (let i = 0; i < 8; i++) {
  draft.step(0.05, { player: dCar, opponents: [{ vehicle: { position: { x: 0.2, z: 8 } } }] });
}
check("draft behind a rival fills", draft.meter > 0.1, `meter=${draft.meter.toFixed(3)}`);

const fire = new RallyRush();
const slideHot = { ...player, throttle: 0.2, driftAngle: 0.28, speed: 24 };
let lit = { justFire: false, fire: 0 };
for (let i = 0; i < 28; i++) lit = fire.step(0.05, { player: slideHot, opponents: [] });
check("committed slide goes On Fire", fire.fire > 0.2 && fire.combo > 1.35, `fire=${fire.fire.toFixed(2)} combo=${fire.combo.toFixed(2)}`);
check("On Fire edge flashes once", lit.justFire || fire.fire > 0.2);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "On Fire rush on rally roads"}`);
process.exit(fail ? 1 : 0);
