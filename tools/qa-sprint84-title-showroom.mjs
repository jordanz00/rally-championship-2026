#!/usr/bin/env node
/**
 * Sprint 84 — title showroom: hero car, tarmac pad, instant boot.
 *
 * RUN: node tools/qa-sprint84-title-showroom.mjs
 *      node tools/qa-sprint84-title-showroom.mjs --static
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCacheVersions } from "./qa-cache-version.mjs";
import {
  ROOT as HARNESS_ROOT,
  startServer,
  launchChrome,
  preparePage,
  goto,
  evaluate,
  waitFor,
  screenshot,
} from "./lib/qa-harness.mjs";

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

console.log(`SPRINT 84 TITLE SHOWROOM  ·  ${new Date().toISOString()}\n`);

const celica = read("js/cars/celica.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");
const config = read("js/config.js");
const css = read("css/game.css");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

check(
  "prepareTitleCar loads the hero GLB first",
  /await tryLocalGltf\(chassis\)/.test(celica) &&
    /export async function prepareTitleCar/.test(celica) &&
    celica.indexOf("await tryLocalGltf(chassis)") < celica.indexOf("await tryRivalGltf(chassis)")
);
check(
  "createTitleCar prefers hero templates",
  /templates\[chassis\] \|\s*\n\s*rivalTemplates\[chassis\]/.test(celica) ||
    /templates\[chassis\] \|\n\s+rivalTemplates\[chassis\]/.test(celica) ||
    /const template =\s*templates\[chassis\]/.test(celica)
);
check("title car hides the cockpit", /hideHeavyInterior\(clone\)/.test(celica) && /setCockpitView\(clone, false\)/.test(celica));
check("hero Celica is HTML-preloaded", /assets\/celica\/gt4\.glb/.test(index) && /rel="preload"/.test(index));
check("WebGL boots on the next frames, not a 1.6s wait", /requestAnimationFrame\(\(\) => requestAnimationFrame\(bootGfx\)\)/.test(game) && !/, 1600\)/.test(game));
check("title fetch starts in the constructor", /this\._titleCarWarm = prepareTitleCar/.test(game));
check("showroom pad is asphalt + kerb + sand, not a beige disc", /_ensureTitleWorld/.test(game) && /makeTitleAsphaltMap/.test(game) && !/CircleGeometry\(52, 24\)/.test(game));
check("title DPR is showroom-sharp", /titleMaxPixelRatio:\s*1\.5/.test(config) && /titleShadowMap:\s*1024/.test(config));
check("IBL bakes after first present", /_bakeSkyEnv\("title"\)/.test(game) && /_titleIblReady/.test(game));
check("title overlay is a vignette, not a dark slab", /rgba\(0, 0, 0, 0\.22\)/.test(css) && !/rgba\(5, 7, 5, 0\.62\)/.test(css));
check("css cache-bust", /game\.css\?v=29/.test(index));
check("celica.js cache-bust", Number((game.match(/celica\.js\?v=(\d+)/) || [])[1]) >= 121);
check("cache-bust chain", cacheOk && Number(gameV) >= 423, `main=${mainV} game=${gameV}`);
check("sphere dune blobs are gone", !/for \(let i = 0; i < 18; i\+\+\)/.test(game) && /loadTitleRocks/.test(game) && /rock_largeA/.test(game));
check("PRESS START does not rebuild the showroom", /_idleWarmAfterTitle/.test(game) && /instant: true/.test(game));
check("car and course menus swap instantly", /showScreen\("screen-courses", \{ instant: true \}/.test(game) && /showScreen\("screen-cars", \{ instant: true \}/.test(game));

const hero = path.join(ROOT, "assets/celica/gt4.glb");
const lod = path.join(ROOT, "assets/celica/rival.glb");
if (fs.existsSync(hero) && fs.existsSync(lod)) {
  check("hero GLB is on disk for the title car", fs.statSync(hero).size > 1e6, `${(fs.statSync(hero).size / 1e6).toFixed(1)} MB`);
}

const STATIC_ONLY = process.argv.includes("--static");

async function probeTitle() {
  const server = await startServer(HARNESS_ROOT);
  const browser = await launchChrome({ headless: true, width: 1600, height: 900 });
  try {
    const { cdp } = browser;
    await preparePage(cdp);
    const t0 = Date.now();
    await goto(cdp, `${server.origin}/index.html?v=${gameV}`);
    await waitFor(
      cdp,
      `return !!(document.querySelector("canvas.saturn-canvas") || (window.game && window.game.renderer));`,
      { timeout: 8000, label: "title WebGL" }
    );
    const boot = await evaluate(
      cdp,
      `const nav = performance.getEntriesByType("navigation")[0];
       const sinceNav = nav ? performance.now() - nav.responseStart : performance.now();
       return {
         hasCanvas: !!document.querySelector("canvas.saturn-canvas"),
         sinceNavMs: Math.round(sinceNav),
         live: !!(document.getElementById("crt") && document.getElementById("crt").classList.contains("showroom-live")),
       };`
    );
    check("WebGL canvas present after load", !!(boot && boot.hasCanvas), JSON.stringify(boot));
    await waitFor(
      cdp,
      `const g = window.game;
       const m = g && g.playerMesh;
       return !!(m && m.userData && (m.userData.titleHero || m.userData.titleLod));`,
      { timeout: 12000, label: "title car" }
    );
    const info = await evaluate(
      cdp,
      `const g = window.game;
       const m = g && g.playerMesh;
       const sky = g && g.sky;
       const su = sky && sky.material && sky.material.uniforms;
       const grainU = g && g.post && g.post._compMat && g.post._compMat.uniforms.grain;
       return {
         state: g && g.state,
         titleHero: !!(m && m.userData && m.userData.titleHero),
         titleLod: !!(m && m.userData && m.userData.titleLod),
         world: !!(g && g._titleWorld),
         dpr: g && g.renderer ? g.renderer.getPixelRatio() : 0,
         showroomLive: !!(document.getElementById("crt") && document.getElementById("crt").classList.contains("showroom-live")),
         bootMs: Date.now() - ${t0},
         volumetricClouds: !!(sky && sky.userData && sky.userData.volumetricClouds),
         cloudCover: su && su.uCloudCover ? su.uCloudCover.value : -1,
         cloudSteps: su && su.uCloudSteps ? su.uCloudSteps.value : 0,
         filmGrain: grainU ? grainU.value : -1,
       };`
    );
    check("title car is the hero GLB, not the rival LOD", info && info.titleHero === true, JSON.stringify(info));
    check("showroom pad is in the scene", !!(info && info.world));
    check("title framebuffer is sharp", !!(info && info.dpr >= 0.85), `dpr=${info && info.dpr}`);
    check("canvas marked live", !!(info && info.showroomLive));
    check("title sky is volumetric", !!(info && info.volumetricClouds), `steps=${info && info.cloudSteps}`);
    check("film grain is off on the compositor", info && info.filmGrain === 0, `grain=${info && info.filmGrain}`);
    const jpeg = await screenshot(cdp);
    const shot = path.join(os.tmpdir(), "rally-title-showroom-sprint84.jpg");
    fs.writeFileSync(shot, Buffer.from(jpeg, "base64"));
    console.log(`  shot ${shot}`);
  } finally {
    await browser.close();
    await server.close();
  }
}

try {
  if (!STATIC_ONLY) await probeTitle();
} catch (err) {
  fail += 1;
  console.log(`  FAIL  headed title probe — ${err && err.message ? err.message : err}`);
}

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "title showroom is the hero car on a real pad"}`);
process.exit(fail ? 1 : 0);
