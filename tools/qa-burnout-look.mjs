#!/usr/bin/env node
/**
 * qa-burnout-look.mjs — race present is arcade-hot, Lakeside stays pulled.
 *
 * Player moment: Desert chase. Paint, sun, and road read like a glossy
 * arcade racer. Lakeside does not flash white. Medium FOV punch stays off.
 *
 * RUN: node --experimental-loader ./tools/qa-strip-query-loader.mjs tools/qa-burnout-look.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { burnoutLookFor, burnoutSpeedAmt } from "../js/gfx/burnout-look.js";
import { HARSH_PEAKS } from "../js/gfx/lighting-rig.js";

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

console.log(`BURNOUT LOOK  ·  ${new Date().toISOString()}\n`);

const post = read("js/gfx/postfx.js");
const game = read("js/game.js");
const cfg = read("js/config.js");
const main = read("js/main.js");
const html = read("index.html");
const css = read("css/game.css");

check("post imports burnout-look", /burnout-look\.js\?v=4/.test(post) && /setDriveFeel/.test(post));
check("composite has teal + speed CA", /tealLift/.test(post) && /speedAmt/.test(post) && /chroma/.test(post));
check("low path still kills bloom", /if \(q === "low"\)[\s\S]{0,280}?bloomStrength\.value = 0/.test(post));
check("game drives feel from speed", /setDriveFeel/.test(game) && /this\.player\.speed/.test(game));
check("medium chase keeps speedFovScale 0", /speedFovScale:\s*0/.test(cfg));
check("config grade stays muted (override lives in post)", /gradeSaturation:\s*1\.02/.test(cfg));
check("HUD speed is not an orange glow", /#hud-speed/.test(css) && !/rgba\(255, 140, 0/.test(css));
check("Lakeside car env peak stays pulled", HARSH_PEAKS.lakeside.carEnvMax <= 0.88);
check("Desert paint can go candy", HARSH_PEAKS.desert.carEnvMax >= 1.18);

const desert = burnoutLookFor("desert", { speed: 40 });
const lake = burnoutLookFor("lakeside", { speed: 40 });
const title = burnoutLookFor("desert", { title: true, speed: 40 });
check("Desert grade stays authored", desert.sat <= 1.04 && desert.bloom <= 0.16 && desert.chroma === 0 && desert.teal === 0, `sat=${desert.sat} bloom=${desert.bloom.toFixed(2)}`);
check("Lakeside bloom stays under Desert", lake.bloom <= desert.bloom && lake.sat <= desert.sat);
check("title has no speed CA", title.speedAmt === 0 && title.chroma === 0);
check("speed does not fringe", burnoutSpeedAmt(10) === 0 && burnoutSpeedAmt(60) === 0);
check("game imports postfx.js?v=43+", Number((game.match(/postfx\.js\?v=(\d+)/) || [])[1]) >= 43);
check("game imports lighting-rig.js?v=33+", Number((game.match(/lighting-rig\.js\?v=(\d+)/) || [])[1]) >= 33);
check("boot is 1026+", Number((main.match(/game\.js\?v=(\d+)/) || [])[1]) >= 1026);
check("index boots main.js?v=1026+", Number((html.match(/main\.js\?v=(\d+)/) || [])[1]) >= 1026);
check("css cache is 65+", Number((html.match(/game\.css\?v=(\d+)/) || [])[1]) >= 65);

const desertFire = burnoutLookFor("desert", { speed: 40, rush: 0.8, fire: 1 });
const lakeFire = burnoutLookFor("lakeside", { speed: 40, rush: 0.8, fire: 1 });
check("On Fire does not heat the grade", desertFire.bloom === desert.bloom && desertFire.chroma === 0 && desertFire.speedAmt === 0);
check("Lakeside On Fire stays flat", lakeFire.bloom === lake.bloom && lakeFire.chroma === 0);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Race grade stays flat"}`);
process.exit(fail ? 1 : 0);
