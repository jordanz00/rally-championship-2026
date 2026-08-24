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
  "glass sits on the driver side of the frame",
  /glass\.position\.z = -0\.01/.test(car) && !/glass\.position\.z = 0\.009/.test(car),
  "PlaneGeometry must face the seat, not the windshield"
);

check(
  "glass is HUD-style so the dash cannot eat it",
  /depthTest: false/.test(car.slice(car.indexOf("function makeRearviewMirror"))) &&
    /renderOrder = 12/.test(car),
  "depthTest false + renderOrder on the live glass"
);

check(
  "capture is sRGB without ACES crush",
  /_mirrorRT\.texture\.colorSpace = THREE\.SRGBColorSpace/.test(game) &&
    /toneMapping = THREE\.NoToneMapping/.test(game) &&
    !/NoColorSpace/.test(game.slice(game.indexOf("_initMirror"))),
  "SRGB RT + NoToneMapping on the rear camera"
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
  "cache bust celica.js?v>=112",
  celicaV && Number(celicaV[1]) >= 112,
  celicaV ? `got ${celicaV[1]}` : "missing"
);
check(
  "cache bust main↔game",
  gameV && mainV && gameV[1] === mainV[1] && Number(gameV[1]) >= 346,
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
      `const m = window.game && window.game.playerMesh; return m && m.userData && m.userData.mirrorGlass ? 1 : null;`,
      { timeout: 45000, label: "player car with rearview glass" }
    );
    const sample = await evaluate(cdp, `
      const g = window.game;
      g.camMode = 0;
      g._mirrorDefer = 0;
      g._povHudFade = 1;
      g._applyCockpitCam();
      if (typeof g._renderMirror === "function") g._renderMirror();
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
      return {
        hasGlass: !!glass,
        hasMap: !!(map && map.isTexture),
        mapIsRT: !!(map && rt && map === rt.texture),
        depthTest: mat ? mat.depthTest : null,
        toneMapped: mat ? mat.toneMapped : null,
        glassZ: glass ? glass.position.z : null,
        scaleX: glass ? glass.scale.x : null,
        colorSpace: rt && rt.texture ? rt.texture.colorSpace : null,
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
      sample && sample.glassZ < 0 && sample.depthTest === false && sample.toneMapped === false && sample.scaleX < 0,
      sample ? `z=${sample.glassZ} depthTest=${sample.depthTest} scaleX=${sample.scaleX}` : "no sample"
    );
    check(
      "live RT is not a black rectangle",
      sample && sample.mean > 18 && sample.maxc > 40,
      sample ? `mean=${sample.mean && sample.mean.toFixed(1)} max=${sample.maxc && sample.maxc.toFixed(1)}` : "no sample"
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
