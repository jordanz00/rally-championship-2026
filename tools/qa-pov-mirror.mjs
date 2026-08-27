#!/usr/bin/env node
/**
 * qa-pov-mirror.mjs — POV rearview must show the road, not a black rectangle.
 *
 * RUN: node tools/qa-pov-mirror.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ROOT,
  startServer,
  launchChrome,
  findChrome,
  preparePage,
  goto,
  waitFor,
  evaluate,
} from "./lib/qa-harness.mjs";

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

let fail = 0;
function check(label, ok, detail) {
  if (ok) console.log(`  ok  ${label}`);
  else {
    console.log(`  FAIL  ${label}  —  ${detail}`);
    fail += 1;
  }
}

console.log(`POV REARVIEW  ·  ${new Date().toISOString()}\n`);

const car = read("js/cars/celica.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");

check(
  "glass sits on the driver-facing side of the rim",
  /glass\.position\.z = 0\.01/.test(car) && !/glass\.position\.z = -0\.01/.test(car),
  "after lookAt, +Z faces the seat — glass must sit on +Z, not behind the rim"
);

check(
  "glass is HUD-style so the dash cannot eat it",
  /markPovHudMesh\(glass/.test(car) &&
    /POV_HUD_LAYER/.test(car) &&
    /_renderPovHudOverlay\(/.test(game) &&
    /layers\.set\(POV_HUD_LAYER\)/.test(game) &&
    /depthTest: false/.test(car.slice(car.indexOf("function makeRearviewMirror"))),
  "layer-1 overlay after post; glass marked HUD with depthTest false"
);

check(
  "capture is linear so MeshBasicMaterial does not read black",
  /_mirrorRT\.texture\.colorSpace = THREE\.LinearSRGBColorSpace/.test(game) &&
    /toneMapping = THREE\.NoToneMapping/.test(game) &&
    /outputColorSpace = THREE\.LinearSRGBColorSpace/.test(game) &&
    /mirrorCamZ/.test(car),
  "Linear RT + NoToneMapping; capture camera behind the bumper"
);

check(
  "rearview RT is allocated, asserted, and rebuilt on context loss",
  /_ensureMirrorRT\(\)/.test(game) &&
    /_bindMirrorContext\(\)/.test(game) &&
    /webglcontextrestored/.test(game) &&
    /_mirrorHasImage/.test(game),
  "missing/zero RT must recreate; context restore must rebind the glass"
);

check(
  "mirror RT is a cheap fixed size (256–384 long edge), not the main canvas",
  /mirrorW:\s*384/.test(read("js/config.js")) &&
    /mirrorH:\s*120/.test(read("js/config.js")) &&
    /Math\.min\(GFX\.mirrorW \|\| 384, 384\)/.test(game),
  "long edge 384, height 120"
);

check(
  "scene is drawn into the RT after the pack is painted solid",
  /_paintBlockingPack\(0\)/.test(game) &&
    /_renderMirror\(\)/.test(game) &&
    game.indexOf("_paintBlockingPack(0)") < game.indexOf("this._renderMirror()") &&
    game.indexOf("this._renderMirror()") < game.indexOf("_paintBlockingPack(1)"),
  "solid pack → capture → ghost leftover"
);

check(
  "empty RT always captures; last frame may defer",
  /_mirrorDefer > 0 && this\._mirrorHasImage/.test(game) &&
    /this\._mirrorHasImage = true/.test(game),
  "never skip forever / never sit on a null map"
);

check(
  "GLB interior rearview is hidden so it cannot cover the RT",
  /Interior rearview glass in the GLB/.test(car) &&
    /mirror\|rearview\|rear\.\?view/.test(car),
  "hideHeavyInterior must keep cabin GLB mirrors off"
);

const celicaV = game.match(/celica\.js\?v=(\d+)/);
const gameV = main.match(/game\.js\?v=(\d+)/);
const mainV = index.match(/main\.js\?v=(\d+)/);
check(
  "cache bust celica.js?v>=118",
  celicaV && Number(celicaV[1]) >= 118,
  celicaV ? `got ${celicaV[1]}` : "missing"
);
check(
  "cache bust main↔game",
  gameV && mainV && gameV[1] === mainV[1] && Number(gameV[1]) >= 378,
  `game=${gameV && gameV[1]} main=${mainV && mainV[1]}`
);

async function live() {
  if (!findChrome()) {
    console.log("  skip  live RT probe (no Chrome)");
    return;
  }
  const server = await startServer(ROOT);
  const browser = await launchChrome({ headless: true, width: 1280, height: 720 });
  const { cdp } = browser;
  await preparePage(cdp);
  try {
    await goto(cdp, `${server.origin}/index.html`);
    await waitFor(cdp, `return window.game ? 1 : null;`, { timeout: 20000, label: "game" });
    await waitFor(
      cdp,
      `
        const g = window.game;
        if (!g) return null;
        if (g.playerMesh && g.playerMesh.userData && g.playerMesh.userData.mirrorGlass) return 1;
        try {
          if (typeof g._promotePlayerCar === "function") g._promotePlayerCar();
          else if (typeof g._swapPlayerCar === "function") g._swapPlayerCar(g.carId || "celica");
        } catch (err) { /* GLB not ready yet */ }
        return g.playerMesh && g.playerMesh.userData && g.playerMesh.userData.mirrorGlass ? 1 : null;
      `,
      { timeout: 60000, label: "hero car with rearview glass" }
    );
    const sample = await evaluate(cdp, `
      const g = window.game;
      g.state = "countdown";
      g.camMode = 0;
      g._mirrorDefer = 0;
      g._povHudFade = 1;
      g._cockpitLive = true;
      g._applyCockpitCam();
      if (typeof g._ensureMirrorRT === "function") g._ensureMirrorRT();
      if (typeof g._captureMirror === "function") g._captureMirror(true);
      const mesh = g.playerMesh;
      const glass = mesh.userData.mirrorGlass;
      const mat = glass && glass.material;
      const map = mat && mat.map;
      const rt = g._mirrorRT;
      let mean = 0;
      let maxc = 0;
      let samples = 0;
      if (rt && g.renderer && g.renderer.readRenderTargetPixels) {
        const w = Math.min(64, rt.width);
        const h = Math.min(20, rt.height);
        const buf = new Uint8Array(w * h * 4);
        g.renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
        for (let i = 0; i < buf.length; i += 4) {
          const lum = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
          mean += lum;
          if (lum > maxc) maxc = lum;
          samples += 1;
        }
        if (samples) mean /= samples;
      }
      const canvas = g.renderer && g.renderer.domElement;
      return {
        hasGlass: !!glass,
        hasMap: !!(map && map.isTexture),
        mapIsRT: !!(map && rt && map === rt.texture),
        depthTest: mat ? mat.depthTest : null,
        toneMapped: mat ? mat.toneMapped : null,
        glassZ: glass ? glass.position.z : null,
        rotY: glass ? glass.rotation.y : null,
        colorSpace: rt && rt.texture ? rt.texture.colorSpace : null,
        rtW: rt ? rt.width : 0,
        rtH: rt ? rt.height : 0,
        canvasW: canvas ? canvas.width : 0,
        canvasH: canvas ? canvas.height : 0,
        hasImage: !!g._mirrorHasImage,
        mean,
        maxc,
        mirrorVisible: !!(mesh.userData.mirror && mesh.userData.mirror.visible),
      };
    `);
    check(
      "live glass has the rearview RT bound",
      sample && sample.hasGlass && sample.hasMap && sample.mapIsRT,
      sample ? JSON.stringify({ hasMap: sample.hasMap, mapIsRT: sample.mapIsRT }) : "no sample"
    );
    check(
      "live glass faces the seat and ignores depth",
      sample && sample.glassZ > 0 && sample.depthTest === false && sample.toneMapped === false,
      sample ? `z=${sample.glassZ} depthTest=${sample.depthTest} rotY=${sample.rotY}` : "no sample"
    );
    check(
      "live RT is not a black rectangle",
      sample && sample.mean > 18 && sample.maxc > 40,
      sample ? `mean=${sample.mean && sample.mean.toFixed(1)} max=${sample.maxc && sample.maxc.toFixed(1)}` : "no sample"
    );
    check(
      "live RT exists at lower-than-canvas resolution",
      sample &&
        sample.rtW >= 256 &&
        sample.rtW <= 384 &&
        sample.rtH >= 80 &&
        sample.rtH <= 128 &&
        sample.canvasW > sample.rtW,
      sample ? `rt=${sample.rtW}x${sample.rtH} canvas=${sample.canvasW}x${sample.canvasH}` : "no sample"
    );
    check(
      "live capture marked the RT as having an image",
      sample && sample.hasImage,
      sample ? `hasImage=${sample.hasImage}` : "no sample"
    );
  } finally {
    await browser.close();
    await server.close();
  }
}

await live();

console.log(
  `\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "POV rearview shows the world"}`
);
process.exit(fail ? 1 : 0);
