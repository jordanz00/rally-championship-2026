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

check("post imports burnout-look", /burnout-look\.js\?v=9/.test(post) && /setDriveFeel/.test(post));
check("desktop scene is linear HDR", /HalfFloatType/.test(post) && /acesFit/.test(post) && /setLinearScene/.test(post));
check("low and phones skip the HDR buffer", /q === "low"\) return false/.test(post) && /__rallyPhoneLite/.test(post));
check("composite has teal + speed CA", /tealLift/.test(post) && /speedAmt/.test(post) && /chroma/.test(post));
check("low path still kills bloom", /if \(q === "low"\)[\s\S]{0,280}?bloomStrength\.value = 0/.test(post));
check("game drives feel from speed", /setDriveFeel/.test(game) && /this\.player\.speed/.test(game));
check("medium chase keeps speedFovScale 0", /speedFovScale:\s*0/.test(cfg));
check("config grade stays under the post override", /gradeSaturation:\s*1\.0[0-8]/.test(cfg));
check("HUD speed is not an orange glow", /#hud-speed/.test(css) && !/rgba\(255, 140, 0/.test(css));
check("Lakeside car env peak stays pulled", HARSH_PEAKS.lakeside.carEnvMax <= 0.88);
check("Desert paint can go candy", HARSH_PEAKS.desert.carEnvMax >= 1.18);

const desert = burnoutLookFor("desert", { speed: 40 });
const lake = burnoutLookFor("lakeside", { speed: 40 });
const title = burnoutLookFor("desert", { title: true, speed: 40 });
const crawl = burnoutLookFor("desert", { speed: 10 });
check(
  "Desert photograph has color and no teal fringe",
  desert.sat > 1 &&
    desert.sat < 1.12 &&
    desert.contrast > 1 &&
    desert.contrast < 1.12 &&
    desert.teal === 0 &&
    desert.chroma === 0 &&
    desert.speedAmt === 0 &&
    desert.warmth < 0.08,
  `sat=${desert.sat} contrast=${desert.contrast} warmth=${desert.warmth} teal=${desert.teal}`
);
check(
  "Lakeside stays quieter than Desert",
  lake.bloom < desert.bloom && lake.sat < desert.sat && lake.teal === 0 && lake.chroma === 0
);
check("title has no speed CA", title.speedAmt === 0 && title.chroma === 0);
check("crawl does not fringe", crawl.speedAmt === 0 && crawl.chroma === 0 && burnoutSpeedAmt(10) === 0);
check("pace does not fringe", burnoutSpeedAmt(40) === 0 && burnoutSpeedAmt(60) === 0);
check("game imports postfx.js?v=46+", Number((game.match(/postfx\.js\?v=(\d+)/) || [])[1]) >= 46);
check("game imports lighting-rig.js?v=33+", Number((game.match(/lighting-rig\.js\?v=(\d+)/) || [])[1]) >= 33);
const boot = Number((main.match(/game\.js\?v=(\d+)/) || [])[1]);
const indexBoot = Number((html.match(/main\.js\?v=(\d+)/) || [])[1]);
check("boot matches index", boot >= 1159 && boot === indexBoot, `main=${boot} index=${indexBoot}`);
check("css cache is 65+", Number((html.match(/game\.css\?v=(\d+)/) || [])[1]) >= 65);

const desertFire = burnoutLookFor("desert", { speed: 40, rush: 0.8, fire: 1 });
const lakeFire = burnoutLookFor("lakeside", { speed: 40, rush: 0.8, fire: 1 });
check(
  "On Fire does not lift bloom",
  desertFire.bloom === desert.bloom && desertFire.chroma === 0 && desertFire.speedAmt === 0 && desertFire.teal === 0
);
check(
  "Lakeside On Fire stays pulled",
  lakeFire.bloom === lake.bloom && lakeFire.sat === lake.sat && lakeFire.teal === 0
);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Desert grade is hot, Lakeside stays pulled"}`);
process.exit(fail ? 1 : 0);
