#!/usr/bin/env node
/**
 * qa-sky-diag.mjs — throwaway diagnostic: WHAT is painting the upper frame?
 *
 * Decisive experiment: screenshot Desert normally, then hide every scene child
 * except the sky dome and screenshot again. If the sky alone is a believable
 * gradient, something is occluding it; if it is the same flat wall, the sky
 * shader itself is the defect. Also dumps the biggest meshes so a backdrop
 * ring can be identified by name.
 *
 * RUN: node tools/qa-sky-diag.mjs
 */

import fs from "node:fs";
import {
  ROOT, startServer, launchChrome, findChrome, preparePage, goto, evaluate,
  waitFor, clickSelector, sleep,
  chromeUnavailableHint
} from "./lib/qa-harness.mjs";
import { lumaStats } from "./lib/png-luma.mjs";

async function shot(cdp, file) {
  const r = await cdp.send("Page.captureScreenshot", { format: "png" });
  const buf = Buffer.from(r.data, "base64");
  fs.writeFileSync(file, buf);
  const s = lumaStats(buf, { skipBottomFraction: 0.2 });
  console.log(`  shot ${file}  mean=${s.mean.toFixed(4)}`);
  return buf;
}

async function main() {
  if (!findChrome()) throw new Error(chromeUnavailableHint());
  const server = await startServer(ROOT);
  const browser = await launchChrome({ headless: false, width: 1280, height: 720 });
  const { cdp } = browser;
  await preparePage(cdp);
  try {
    await goto(cdp, `${server.origin}/index.html`);
    await waitFor(cdp, `return window.game ? 1 : null;`, { timeout: 30000, label: "game" });
    await clickSelector(cdp, "#btn-start", "start");
    await waitFor(cdp, `const e=document.querySelector(".screen.active"); return e&&e.id==="screen-menu"?1:null;`, { timeout: 60000, label: "menu" });
    await clickSelector(cdp, "[data-menu='practice']", "practice");
    await waitFor(cdp, `const s=document.querySelector(".screen.active"); if(!s||s.id!=="screen-cars") return null; const b=document.querySelector("[data-car='celica']"); return b&&!b.disabled?1:null;`, { timeout: 60000, label: "cars" });
    await clickSelector(cdp, "[data-car='celica']", "celica");
    await waitFor(cdp, `const e=document.querySelector(".screen.active"); return e&&e.id==="screen-courses"?1:null;`, { timeout: 60000, label: "courses" });
    await clickSelector(cdp, "[data-course='desert']", "desert");
    await waitFor(cdp, `const g=window.game; return g&&g.track&&g.courseId==="desert"?1:null;`, { timeout: 240000, label: "track" });
    await waitFor(cdp, `return window.game.state === "race" ? 1 : null;`, { timeout: 180000, label: "race" });
    await sleep(2000);

    console.log("\n--- baseline ---");
    await shot(cdp, "/tmp/diag-1-baseline.png");

    console.log("\n--- top-level scene children ---");
    const kids = await evaluate(cdp, `
      const g = window.game;
      return g.scene.children.map((o) => ({
        name: o.name || "(anon)", type: o.type, visible: o.visible,
        kids: o.children ? o.children.length : 0,
        isLight: !!o.isLight
      }));
    `);
    for (const k of kids) console.log(`  ${k.visible ? "Y" : "n"} ${k.type.padEnd(20)} kids=${String(k.kids).padStart(4)} light=${k.isLight ? "Y" : "n"}  ${k.name}`);

    console.log("\n--- sky ONLY (everything else hidden) ---");
    await evaluate(cdp, `
      const g = window.game;
      window.__restore = [];
      for (const o of g.scene.children) {
        if (o === g.sky) continue;
        if (o.isLight) continue;
        if (o.visible) { window.__restore.push(o); o.visible = false; }
      }
      1
    `);
    await sleep(700);
    await shot(cdp, "/tmp/diag-2-sky-only.png");

    console.log("\n--- sky only, post FX disabled ---");
    await evaluate(cdp, `window.__postWas = window.game.post ? window.game.post.enabled : null; if (window.game.post) window.game.post.enabled = false; 1`);
    await sleep(700);
    await shot(cdp, "/tmp/diag-3-sky-nopost.png");
    await evaluate(cdp, `if (window.game.post && window.__postWas !== null) window.game.post.enabled = window.__postWas; 1`);

    console.log("\n--- sky only, cinema cloud steps forced (16 / 2 / detail 4 / worley) ---");
    await evaluate(cdp, `
      const u = window.game.sky.material.uniforms;
      u.uCloudSteps.value = 16; u.uLightSteps.value = 2; u.uCloudDetail.value = 4; u.uUseWorley.value = 1;
      1
    `);
    await sleep(900);
    await shot(cdp, "/tmp/diag-4-sky-cinema.png");

    console.log("\n--- sky only, atmoBlend 0 (pure gradient texture) ---");
    await evaluate(cdp, `window.game.sky.material.uniforms.uAtmoBlend.value = 0; 1`);
    await sleep(700);
    await shot(cdp, "/tmp/diag-5-grad-only.png");

    console.log("\n--- sky only, atmoBlend 1 (pure analytic scatter) ---");
    await evaluate(cdp, `window.game.sky.material.uniforms.uAtmoBlend.value = 1; 1`);
    await sleep(700);
    await shot(cdp, "/tmp/diag-6-scatter-only.png");

    console.log("\n--- restore world, cinema clouds kept ---");
    await evaluate(cdp, `
      window.game.sky.material.uniforms.uAtmoBlend.value = 0.84;
      for (const o of (window.__restore || [])) o.visible = true;
      1
    `);
    await sleep(900);
    await shot(cdp, "/tmp/diag-7-world-cinema.png");
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((e) => { console.error("FAIL " + e.message); process.exit(1); });
