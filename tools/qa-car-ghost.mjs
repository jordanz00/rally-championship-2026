#!/usr/bin/env node
/**
 * qa-car-ghost.mjs — live race car is one solid body (no TSR smear).
 *
 * WHO THIS IS FOR: the v988 car-ghost close-out.
 * WHAT IT DOES: source asserts for Quality TSR car-history kill, opaque
 *   race/replay paint, a single player mesh on the race path, and no
 *   leftover attract / time-attack ghost on championship.
 * HOW IT CONNECTS: run after bumping ?v= on the reconstruct graph.
 *
 * RUN:  node tools/qa-car-ghost.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const files = {
  tsr: "js/gfx/tsr-upscaler.js",
  sdk: "js/gfx/browser-reconstruct-sdk/index.js",
  appear: "js/gfx/appearance-net.js",
  post: "js/gfx/postfx.js",
  fade: "js/gfx/occlusion-fade.js",
  celica: "js/cars/celica.js",
  game: "js/game.js",
  main: "js/main.js",
  html: "index.html",
  attract: "js/cinema/attract-reel.js",
  replay: "js/cinema/broadcast-replay.js",
};

let failed = 0;

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function must(cond, msg) {
  if (cond) {
    console.log(`  PASS  ${msg}`);
    return;
  }
  failed += 1;
  console.error(`  FAIL  ${msg}`);
}

function main() {
  console.log("Car ghost contract");
  const src = {};
  for (const [key, rel] of Object.entries(files)) {
    src[key] = read(rel);
  }

  must(src.tsr.includes("export const TSR_CAR_HISTORY_KILL = true"), "TSR_CAR_HISTORY_KILL");
  must(src.tsr.includes("TSR_DEFAULT_MODE = \"quality\""), "desktop default is Quality TSR");
  must(src.tsr.includes("Car silhouette: drop history (colour-only)"), "car pixels are colour-only");
  must(src.tsr.includes("Do not dilate the vector"), "no dilated car velocity on the road");
  must(src.tsr.includes("Final car kill"), "blend cannot restore car history");
  must(src.tsr.includes("if (car > 0.5)") && src.tsr.includes("n = 0.0"), "car mask zeros history weight");
  must(src.tsr.includes("flickerOk = still * (1.0 - car)"), "flicker cannot re-accumulate on cars");
  must(src.tsr.includes("valid > 0.5 && car < 0.5"), "resurrection skipped on cars");
  must(src.tsr.includes("defines: { CHEAP_RESOLVE: 0 }") && src.tsr.includes("defines: { CHEAP_RESOLVE: 1 }"), "Quality and cheap share RESOLVE_FRAG");
  must(src.tsr.includes("dynamicRoots") || src.tsr.includes("setDynamicRoots"), "velocity roots API");
  must(src.sdk.includes("TSR_CAR_HISTORY_KILL"), "SDK exports car kill");
  must(src.sdk.includes("if (roots && typeof tsr.setDynamicRoots"), "SDK applies dynamicRoots each frame");

  must(src.appear.includes("APPEAR_DEFAULT = true"), "LOOK default on; car history still killed");
  must(!/AfterimagePass|UnrealBloom.*ghost|motionBlur|MotionBlur|Afterimage/.test(src.post), "postfx has no afterimage / motion blur");
  must(src.fade.includes("VISUAL.packSeeThrough === true"), "pack see-through stays opt-in");

  must(src.celica.includes("function dressPlayerCarRace"), "race dress exists");
  must(src.celica.includes("phys.transmission = 0"), "race/title glass has no transmission pass");
  must(src.celica.includes("function createPlayerCar"), "one createPlayerCar factory");
  must(!/createPlayerCar[\s\S]{0,400}cloneCar\([\s\S]{0,80}cloneCar\(/.test(src.celica), "player factory does not stamp a second hull");

  must(src.game.includes("m.opacity = 1") && src.game.includes("_solidReplayMesh"), "replay cars forced opacity 1");
  must(src.game.includes("m.transparent = false"), "replay bodywork not transparent");
  must(src.game.includes("this.ghostMesh.visible = this.mode === \"timeattack\""), "time-attack ghost hidden outside TA");
  must(src.game.includes("if (this.ghostMesh) this.ghostMesh.visible = false"), "broadcast hides time-attack ghost");
  must(src.game.includes("c.opacity = 0.42") && src.game.includes("m.clone()"), "TA ghost clones paint (does not tint the live car)");
  must(src.game.includes("if (this.playerMesh.userData.titleLod) this.scene.remove(this.playerMesh)"), "title LOD leaves the scene on race promote");
  must(src.game.includes("this._stopAttractReel()"), "race start stops attract reel");
  must(src.attract.includes("else if (scene && this.group) scene.remove(this.group)"), "attract dispose removes the reel group");
  must(/attract-reel\.js\?v=9/.test(src.game), "attract reel import stays v9");
  must(/broadcast-replay\.js\?v=6/.test(src.game), "broadcast replay import stays v6");
  must(src.game.includes("if (this.playerMesh) this._tsrRoots.push(this.playerMesh)"), "player is a TSR velocity root");
  must(src.game.includes("this._tsrRoots.push(this.opponents[i].mesh)"), "rivals are TSR velocity roots");
  must(src.game.includes("_tsrRoots.length = 0"), "TSR roots rebuilt each present (no leftover title mesh)");

  must(!/DLSS\s*5/i.test(src.html), "live UI never says DLSS 5");
  must(!/DLSS\s*5/i.test(src.game), "game never says DLSS 5");
  must(!/DLSS\s*5/i.test(src.main), "main never says DLSS 5");

  const mainV = Number((src.html.match(/main\.js\?v=(\d+)/) || [])[1] || 0);
  const gameV = Number((src.main.match(/game\.js\?v=(\d+)/) || [])[1] || 0);
  const sdkV = Number((src.game.match(/browser-reconstruct-sdk\/index\.js\?v=(\d+)/) || [])[1] || 0);
  must(mainV >= 988, `index boots main.js?v=${mainV} (>=988)`);
  must(gameV >= 988, `main imports game.js?v=${gameV} (>=988)`);
  must(sdkV >= 988, `game imports SDK ?v=${sdkV} (>=988)`);

  if (failed) {
    console.error(`\nFAIL  ${failed} car-ghost check(s)`);
    process.exit(1);
  }
  console.log("\nPASS  car ghost contract");
}

main();
