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
  "prepareTitleCar loads the rival LOD first",
  /await tryRivalGltf\(chassis\)/.test(celica) &&
    /export async function prepareTitleCar/.test(celica) &&
    celica.indexOf("await tryRivalGltf(chassis)") < celica.indexOf("await tryLocalGltf(chassis)")
);
check(
  "createTitleCar prefers rival LOD templates",
  /rivalTemplates\[chassis\]/.test(celica) &&
    /export function createTitleCar/.test(celica)
);
check("title car hides the cockpit", /hideHeavyInterior\(clone\)/.test(celica) && /setCockpitView\(clone, false\)/.test(celica));
check("hero Celica is HTML-preloaded", /assets\/celica\/gt4\.glb/.test(index) && /rel="preload"/.test(index));
check("WebGL boots on the next frames, not a 1.6s wait", /requestAnimationFrame\(\(\) => requestAnimationFrame\(bootGfx\)\)/.test(game) && !/, 1600\)/.test(game));
check("title fetch starts in the constructor", /this\._titleCarWarm = prepareTitleCar/.test(game));
check("showroom pad is asphalt + kerb + sand, not a beige disc", /_ensureTitleWorld/.test(game) && /makeTitleAsphaltMaps/.test(game) && !/CircleGeometry\(52, 24\)/.test(game));
check("title pad is wet asphalt with roughness map", /Mesh(?:Physical|Standard)Material/.test(game) && /roughnessMap:\s*asphaltMaps\.roughness/.test(game));
check("title DPR is showroom-soft", /titleMaxPixelRatio:\s*1\.(?:0|05|1[0-5]|25)/.test(config) && /titleShadowMap:\s*(?:512|1024|1536)/.test(config));
check("IBL bakes after first presents", /_bakeSkyEnv\("title"\)/.test(game) && /_titleIblReady/.test(game) && /TITLE_SHOWROOM/.test(game) && /iblDelayMs:\s*(?:420|900)/.test(config));
check("pad keeps sun.castShadow off", /Pad: no sun atlas/.test(game) && /this\.sun\.castShadow = false/.test(game));
check("title live cube reflections are wired", /_updateTitleReflections\(\)/.test(game) && /_ensureTitleReflectCam/.test(game) && /if \(onPad\) this\._updateTitleReflections/.test(game));
check("title overlay is a vignette, not a dark slab", /rgba\(0, 0, 0, 0\.22\)/.test(css) && !/rgba\(5, 7, 5, 0\.62\)/.test(css));
check("SELECT MODE leaves the car visible", /#screen-menu\.active/.test(css) && /transparent 100%/.test(css));
check("css cache-bust", /game\.css\?v=\d+/.test(index) && Number((index.match(/game\.css\?v=(\d+)/) || [])[1]) >= 34);
check("celica.js cache-bust", Number((game.match(/celica\.js\?v=(\d+)/) || [])[1]) >= 141);
check("cache-bust chain", cacheOk && Number(gameV) >= 531, `main=${mainV} game=${gameV}`);
check("prop-kit cache ≥28", Number((game.match(/prop-kit\.js\?v=(\d+)/) || [])[1]) >= 28);
check("yieldFrame never uses queueMicrotask", !/queueMicrotask\(fire\)/.test(game));
check(
  "championship car pick does not double-start Track.create",
  !/this\._scheduleTrackPreload\(next\);\s*this\._beginRace\(next\)/.test(game)
);
check("sphere dune blobs are gone", !/for \(let i = 0; i < 18; i\+\+\)/.test(game) && /loadTitleRocks/.test(game) && /rock_largeA/.test(game));
check("title rocks use HD albedo + bury", /styleTitleRock/.test(game) && /bury:/.test(game) && /rock_diff\.jpg/.test(read("js/tracks/prop-kit.js")));
check("title rocks are clustered / tilted", /sx:/.test(game) && /rx:/.test(game) && /styleTitleRock\(node/.test(game));
check("PRESS START does not rebuild the showroom", /_idleWarmAfterTitle/.test(game));
check(
  "car and course menus fade through the curtain",
  /showScreen\("screen-courses", \{ outMs:/.test(game) && /showScreen\("screen-cars", \{ outMs:/.test(game)
);

const hero = path.join(ROOT, "assets/celica/gt4.glb");
const lod = path.join(ROOT, "assets/celica/rival.glb");
if (fs.existsSync(hero) && fs.existsSync(lod)) {
  check("rival LOD is on disk for the title car", fs.statSync(lod).size > 64 && fs.statSync(lod).size < fs.statSync(hero).size, `${(fs.statSync(lod).size / 1e6).toFixed(1)} MB LOD`);
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
      { timeout: 20000, label: "title car" }
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
    await waitFor(
      cdp,
      `const g = window.game; return !!(g && g._titleIblReady && g.scene && g.scene.environment);`,
      { timeout: 8000, label: "title IBL" }
    );
    const wow = await evaluate(
      cdp,
      `const g = window.game;
       const floor = g && g._titleFloor;
       const mat = floor && floor.material;
       const L = g && g.constructor && null;
       const cfg = (window.__LIGHTING_TITLE) || null;
       return {
         ibl: !!(g && g._titleIblReady && g.scene && g.scene.environment),
         wetPad: !!(mat && mat.isMeshPhysicalMaterial && mat.clearcoat > 0.1 && mat.roughnessMap),
         reflectCam: !!(g && g._reflectCam),
         showroomPost: !!(g && g.post && g.post._titleShowroom && g.post.enabled),
         cloudCover: g && g.sky && g.sky.material && g.sky.material.uniforms && g.sky.material.uniforms.uCloudCover
           ? g.sky.material.uniforms.uCloudCover.value : -1,
         rim: g && g._titleRim ? g._titleRim.intensity : -1,
       };`
    );
    check("title IBL is live under ~1s", !!(wow && wow.ibl), JSON.stringify(wow));
    check("pad is wet Physical asphalt", !!(wow && wow.wetPad), JSON.stringify(wow));
    check("title CubeCamera exists", !!(wow && wow.reflectCam));
    check("showroom post path is on", !!(wow && wow.showroomPost), JSON.stringify(wow));
    check("title clouds are denser than a wash", !!(wow && wow.cloudCover >= 0.34), `cover=${wow && wow.cloudCover}`);
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
