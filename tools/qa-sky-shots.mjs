#!/usr/bin/env node
/**
 * qa-sky-shots.mjs — headed PNG capture of the sky + stage lighting.
 *
 * WHO THIS IS FOR: whoever is judging "does Desert look believable at rest".
 * WHAT IT DOES: boots practice on a course, waits out the countdown, then
 *   captures the chase view AND a sky-tilted view, at the DEFAULT quality tier
 *   and again with the cheapest tier forced. A screenshot at min tier is the
 *   only honest way to see what a weak machine actually gets.
 * HOW IT CONNECTS: pure QA. Reads nothing the game does not already expose.
 *
 * IMPORTANT: run HEADED. Headless Chrome uses SwiftShader and the raymarch
 *   output there tells you nothing about the shipped look.
 *
 * RUN:  node tools/qa-sky-shots.mjs --course=desert
 *       node tools/qa-sky-shots.mjs --course=forest --out=/tmp/sky-forest
 */

import fs from "node:fs";
import {
  ROOT, startServer, launchChrome, findChrome, preparePage, goto, evaluate,
  waitFor, clickSelector, sleep,
} from "./lib/qa-harness.mjs";

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const m = new RegExp(`--${name}=([^\\s]+)`).exec(argv.join(" "));
  return m ? m[1] : dflt;
};
const COURSE = arg("course", "desert");
const OUT = arg("out", `/tmp/sky-${COURSE}`);
const HEADLESS = argv.includes("--headless");

/** The `min` rung of the ladder in js/gfx/perf-tier.js, verbatim. */
const MIN_TIER = {
  id: "min", dpr: 0.75, shadow: 1536, post: "low", sky: "min",
  mirrorEvery: 4, shadowEvery: 2,
};

/**
 * @param {object} cdp
 * @param {string} file absolute path ending .png
 */
async function shot(cdp, file) {
  const r = await cdp.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(file, Buffer.from(r.data, "base64"));
  console.log(`  shot ${file}`);
}

/**
 * Tilt the chase camera up by raising its look target. Wraps the camera's own
 * lookAt, so the game's camera code still runs unmodified — we only bias the
 * point it aims at. `lift` in metres; 0 restores the shipped chase view.
 *
 * @param {object} cdp
 * @param {number} lift metres to raise the look target
 */
async function aimSky(cdp, lift) {
  return evaluate(cdp, `
    const g = window.game;
    g._skyLift = ${lift};
    if (!g.__skyShotHook) {
      g.__skyShotHook = true;
      const cam = g.camera;
      const proto = Object.getPrototypeOf(cam).lookAt;
      cam.lookAt = function (v, y, z) {
        let tx, ty, tz;
        if (v && typeof v === "object") { tx = v.x; ty = v.y; tz = v.z; }
        else { tx = v; ty = y; tz = z; }
        return proto.call(this, tx, ty + (g._skyLift || 0), tz);
      };
    }
    1
  `);
}

async function main() {
  if (!findChrome()) throw new Error("no Chrome/Chromium found — set CHROME_PATH");
  console.log(`SKY SHOTS  ·  ${COURSE}  ·  ${new Date().toISOString()}`);
  const server = await startServer(ROOT);
  const browser = await launchChrome({ headless: HEADLESS, width: 1600, height: 900 });
  const { cdp } = browser;
  const { errors } = await preparePage(cdp);
  console.log(`chrome ${browser.browserVersion} ${HEADLESS ? "(headless — INVALID for looks)" : "(headed)"}`);

  try {
    await goto(cdp, `${server.origin}/index.html`);
    await waitFor(cdp, `return window.game ? 1 : null;`, { timeout: 30000, label: "window.game" });
    await clickSelector(cdp, "#btn-start", "PRESS START");
    await waitFor(cdp, `const e=document.querySelector(".screen.active"); return e&&e.id==="screen-menu"?1:null;`, { timeout: 60000, label: "menu" });
    await clickSelector(cdp, "[data-menu='practice']", "PRACTICE");
    await waitFor(
      cdp,
      `const s=document.querySelector(".screen.active");
       if(!s||s.id!=="screen-cars") return null;
       const b=document.querySelector("[data-car='celica']");
       return b && !b.disabled ? 1 : null;`,
      { timeout: 60000, label: "cars" }
    );
    await clickSelector(cdp, "[data-car='celica']", "CELICA");
    await waitFor(cdp, `const e=document.querySelector(".screen.active"); return e&&e.id==="screen-courses"?1:null;`, { timeout: 60000, label: "courses" });
    await clickSelector(cdp, `[data-course='${COURSE}']`, COURSE.toUpperCase());
    await waitFor(cdp, `const g=window.game; return g&&g.track&&g.courseId==="${COURSE}"?1:null;`, { timeout: 240000, label: `${COURSE} track` });
    await waitFor(cdp, `return window.game && window.game.state === "race" ? 1 : null;`, { timeout: 180000, label: '"race" state' });

    // Drive a few seconds so we are on open stage, not staring at the grid wall.
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "w", code: "KeyW", windowsVirtualKeyCode: 87, text: "w" });
    await sleep(5200);
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "w", code: "KeyW", windowsVirtualKeyCode: 87 });
    await sleep(1400);

    const info = await evaluate(cdp, `
      const g = window.game;
      const u = g.sky && g.sky.material && g.sky.material.uniforms;
      return {
        tier: g.perfTier ? g.perfTier.tier : "?",
        ema: g.perfTier ? Math.round(g.perfTier.emaMs * 10) / 10 : 0,
        fps: g.fps,
        dpr: g.renderer.getPixelRatio(),
        shadow: g.sun ? g.sun.shadow.mapSize.x : 0,
        cloudSteps: u ? u.uCloudSteps.value : null,
        lightSteps: u ? u.uLightSteps.value : null,
        sun: u ? [u.uSun.value.x, u.uSun.value.y, u.uSun.value.z] : null,
        sunLight: g.sun ? (() => {
          const d = g.sun.position.clone().sub(g.sun.target.position).normalize();
          return [d.x, d.y, d.z];
        })() : null,
        exposure: g.renderer.toneMappingExposure,
        fog: g.scene.fog ? "#" + g.scene.fog.color.getHexString() : null,
      };
    `);
    console.log(`  DEFAULT tier=${info.tier} ema=${info.ema}ms fps=${info.fps} dpr=${info.dpr.toFixed(2)} shadow=${info.shadow} cloudSteps=${info.cloudSteps}/${info.lightSteps} exposure=${info.exposure}`);
    console.log(`  sky sun ${JSON.stringify(info.sun && info.sun.map((n) => Math.round(n * 100) / 100))}  light sun ${JSON.stringify(info.sunLight && info.sunLight.map((n) => Math.round(n * 100) / 100))}  fog ${info.fog}`);

    await shot(cdp, `${OUT}-default.png`);
    await aimSky(cdp, 22);
    await sleep(900);
    await shot(cdp, `${OUT}-default-sky.png`);
    await aimSky(cdp, 0);
    await sleep(600);

    // Force the cheapest rung and shoot the same view. This is what a weak
    // machine (or a stale QA page) actually renders.
    await evaluate(cdp, `window.game._applyQualityTier(${JSON.stringify(MIN_TIER)}); 1`);
    await sleep(1600);
    const minInfo = await evaluate(cdp, `
      const g = window.game;
      const u = g.sky && g.sky.material && g.sky.material.uniforms;
      return { dpr: g.renderer.getPixelRatio(), shadow: g.sun ? g.sun.shadow.mapSize.x : 0,
               cloudSteps: u ? u.uCloudSteps.value : null, lightSteps: u ? u.uLightSteps.value : null,
               detail: u ? u.uCloudDetail.value : null, worley: u ? u.uUseWorley.value : null };
    `);
    console.log(`  MIN     dpr=${minInfo.dpr.toFixed(2)} shadow=${minInfo.shadow} cloudSteps=${minInfo.cloudSteps}/${minInfo.lightSteps} detail=${minInfo.detail} worley=${minInfo.worley}`);
    await shot(cdp, `${OUT}-min.png`);
    await aimSky(cdp, 22);
    await sleep(900);
    await shot(cdp, `${OUT}-min-sky.png`);

    if (errors.length) {
      console.log(`  ${errors.length} page error(s):`);
      for (const e of errors.slice(0, 5)) console.log(`    [${e.type}] ${e.text}`);
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((err) => {
  console.error(`FAIL  ${err.message}`);
  process.exit(1);
});
