#!/usr/bin/env node
/**
 * qa-crowd-glb.mjs — Desert spectators use Kenney character GLBs.
 * RUN: node tools/qa-crowd-glb.mjs
 */
import fs from "node:fs";
import path from "node:path";
import {
  ROOT, startServer, launchChrome, findChrome, preparePage, goto, evaluate,
  waitFor, clickSelector, pressKey, sleep,
} from "./lib/qa-harness.mjs";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function main() {
  const chars = fs.readdirSync(path.join(ROOT, "assets/props")).filter((f) => /^character-.*\.glb$/i.test(f));
  assert(chars.length >= 12, `expected 12 character GLBs, got ${chars.length}`);
  assert(fs.existsSync(path.join(ROOT, "assets/props/Textures/colormap.png")), "missing colormap.png");

  const chrome = findChrome();
  if (!chrome) throw new Error("no Chrome");
  const server = await startServer(ROOT);
  const browser = await launchChrome({ headless: true });
  const { cdp } = browser;
  await preparePage(cdp);
  await goto(cdp, `${server.origin}/index.html?v=239`);
  await waitFor(cdp, `return window.game ? 1 : null;`, { timeout: 20000, label: "boot" });
  await pressKey(cdp, "Enter");
  await waitFor(cdp, `const el=document.querySelector(".screen.active"); return el&&el.id==="screen-menu"?1:null;`, { timeout: 8000, label: "menu" });
  await clickSelector(cdp, "[data-menu='practice']", "PRACTICE");
  await waitFor(cdp, `const el=document.querySelector(".screen.active"); return el&&el.id==="screen-cars"?1:null;`, { timeout: 8000, label: "cars" });
  await waitFor(cdp, `const b=document.querySelector("[data-car='celica']"); return b&&!b.disabled?1:null;`, { timeout: 20000, label: "celica" });
  await clickSelector(cdp, "[data-car='celica']", "CELICA");
  await waitFor(cdp, `const el=document.querySelector(".screen.active"); return el&&el.id==="screen-courses"?1:null;`, { timeout: 20000, label: "courses" });
  await evaluate(cdp, `
    const g = window.game;
    if (!g) return 0;
    g._preloadToken = null;
    if (g._preloadedTrack) {
      try { g._preloadedTrack.dispose(); } catch (e) {}
      g._preloadedTrack = null;
      g._preloadedCourse = null;
    }
    return 1;
  `);
  await clickSelector(cdp, "[data-course='desert']", "DESERT");
  await waitFor(
    cdp,
    `const g=window.game; return g&&(g.state==="countdown"||g.state==="race")&&g.track?1:null;`,
    { timeout: 240000, label: "desert loaded" }
  );
  await sleep(500);
  const snap = await evaluate(cdp, `
    const t = window.game && window.game.track;
    if (!t) return null;
    const crowd = t._crowd;
    let bodies = 0, glb = 0, poses = 0;
    if (crowd && crowd._bodies) {
      bodies = crowd._bodies.length;
      for (const b of crowd._bodies) {
        if (b && b.userData && b.userData.crowdGlb) glb++;
        if (b && b.userData && b.userData.crowdPoses) poses += b.userData.crowdPoses.length;
      }
    }
    return { hasCrowd: !!crowd, bodies, glb, poses, points: crowd && crowd.points ? crowd.points.length : 0 };
  `);
  console.log(snap);
  assert(snap && snap.hasCrowd, "no CrowdField on desert");
  assert(snap.poses >= 8, `expected several spectators, got ${snap.poses}`);
  assert(snap.glb === snap.bodies && snap.bodies > 0, "crowd meshes should use GLB characters");
  console.log("PASS  Kenney character GLB spectators on Desert");
  await browser.close();
  server.close();
}

main().catch((e) => {
  console.error("FAIL", e.message || e);
  process.exit(1);
});
