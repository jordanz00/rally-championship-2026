#!/usr/bin/env node
/**
 * qa-crowd-glb.mjs — Desert spectators: diverse bipeds + start/finish grandstands.
 * RUN: node tools/qa-crowd-glb.mjs
 *
 * Gates:
 *   - 12 character-*.glb on disk
 *   - CrowdField plants several spectators clear of the ribbon
 *   - ≥8 distinct kinds used (per-person mix, not a clone strip)
 *   - male + female kinds both present
 *   - animStyle / animRate / grandstand planting present in source
 *   - authored arm parts when available (crowdGlb)
 */
import fs from "node:fs";
import path from "node:path";
import {
  ROOT, startServer, launchChrome, findChrome, preparePage, goto, evaluate,
  waitFor, clickSelector, sleep,
} from "./lib/qa-harness.mjs";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function main() {
  const chars = fs.readdirSync(path.join(ROOT, "assets/props")).filter((f) => /^character-.*\.glb$/i.test(f));
  assert(chars.length >= 12, `expected 12 character GLBs, got ${chars.length}`);
  assert(fs.existsSync(path.join(ROOT, "assets/props/Textures/hd/crowd_atlas.png")), "missing crowd_atlas.png");
  assert(fs.existsSync(path.join(ROOT, "assets/props/Textures/colormap.png")), "missing colormap.png");

  const kit = fs.readFileSync(path.join(ROOT, "js/tracks/prop-kit.js"), "utf8");
  assert(/CROWD_ALL/.test(kit), "prop-kit must load CROWD_ALL (full 12-kind pack)");
  assert(/extractCrowdCharacterParts/.test(kit), "prop-kit must prefer authored body/arm parts");
  assert(/if \(s === "mountain"\) return MOUNTAIN_NATURE/.test(kit), "mountain must skip crowd GLBs");

  const crowdSrc = fs.readFileSync(path.join(ROOT, "js/tracks/crowd.js"), "utf8");
  assert(/character-female-f/.test(crowdSrc) && /character-male-f/.test(crowdSrc), "crowd kinds list incomplete");
  assert(/cameraFade/.test(crowdSrc), "crowd meshes need cameraFade");
  assert(/animStyle|cheerStyle/.test(crowdSrc), "crowd needs cheer style variety");
  assert(/animRate/.test(crowdSrc), "crowd needs per-person animRate");

  const trackSrc = fs.readFileSync(path.join(ROOT, "js/tracks/track.js"), "utf8");
  assert(/_ribbonClear\(x, z, 1\.1\)/.test(trackSrc), "spectators must plant clear of ribbon");
  assert(/_addGrandstandCrowds/.test(trackSrc), "start/finish grandstands missing");
  assert(/pushSpectator/.test(trackSrc) && /order\[\(kindCursor/.test(trackSrc), "per-person kind mix planting missing");
  assert(/animStyle/.test(trackSrc), "spectator poses need animStyle");

  const chrome = findChrome();
  if (!chrome) throw new Error("no Chrome");
  const server = await startServer(ROOT);
  const browser = await launchChrome({ headless: true });
  const { cdp } = browser;
  await preparePage(cdp);
  await goto(cdp, `${server.origin}/index.html?v=519`);
  await waitFor(cdp, `return window.game ? 1 : null;`, { timeout: 90000, evalTimeoutMs: 20000, label: "boot" });
  await clickSelector(cdp, "#btn-start", "PRESS START");
  await waitFor(cdp, `const el=document.querySelector(".screen.active"); return el&&el.id==="screen-menu"?1:null;`, { timeout: 60000, evalTimeoutMs: 20000, label: "menu" });
  await clickSelector(cdp, "[data-menu='practice']", "PRACTICE");
  await waitFor(cdp, `const el=document.querySelector(".screen.active"); return el&&el.id==="screen-cars"?1:null;`, { timeout: 45000, evalTimeoutMs: 20000, label: "cars" });
  await waitFor(cdp, `const b=document.querySelector("[data-car='celica']"); return b&&!b.disabled?1:null;`, { timeout: 60000, evalTimeoutMs: 20000, label: "celica" });
  await clickSelector(cdp, "[data-car='celica']", "CELICA");
  await waitFor(cdp, `const el=document.querySelector(".screen.active"); return el&&el.id==="screen-courses"?1:null;`, { timeout: 60000, evalTimeoutMs: 20000, label: "courses" });
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
    { timeout: 300000, evalTimeoutMs: 20000, label: "desert loaded" }
  );
  await sleep(500);
  const snap = await evaluate(cdp, `
    const t = window.game && window.game.track;
    if (!t) return null;
    const crowd = t._crowd;
    let bodies = 0, glb = 0, poses = 0, fade = 0;
    const kinds = new Set();
    let male = 0, female = 0;
    let styles = new Set();
    let rates = 0;
    let minS = 99, maxS = 0;
    let onRoad = 0;
    let elevated = 0;
    if (crowd && crowd._bodies) {
      bodies = crowd._bodies.length;
      for (const b of crowd._bodies) {
        if (b && b.userData && b.userData.crowdGlb) glb++;
        if (b && b.userData && b.userData.cameraFade) fade++;
        if (b && b.userData && b.userData.crowdKind) kinds.add(b.userData.crowdKind);
        if (b && b.userData && b.userData.crowdPoses) {
          for (const p of b.userData.crowdPoses) {
            poses++;
            if (p.kind && /^character-male-/.test(p.kind)) male++;
            if (p.kind && /^character-female-/.test(p.kind)) female++;
            if (p.animStyle != null) styles.add(p.animStyle % 5);
            if (p.animRate != null) rates++;
            if (p.s != null) { if (p.s < minS) minS = p.s; if (p.s > maxS) maxS = p.s; }
            if (typeof t._ribbonClear === "function" && !t._ribbonClear(p.x, p.z, 1.0)) onRoad++;
            const gy = typeof t._groundHeight === "function" ? t._groundHeight(p.x, p.z, "desert") : p.y;
            if (p.y - gy > 0.35) elevated++;
          }
        }
      }
    }
    return {
      hasCrowd: !!crowd,
      bodies,
      glb,
      fade,
      poses,
      kinds: [...kinds].sort(),
      kindCount: kinds.size,
      male,
      female,
      styleCount: styles.size,
      rates,
      elevated,
      minS: minS === 99 ? null : minS,
      maxS,
      onRoad,
      points: crowd && crowd.points ? crowd.points.length : 0,
    };
  `);
  console.log(snap);
  assert(snap && snap.hasCrowd, "no CrowdField on desert");
  assert(snap.poses >= 40, `expected densified gallery+grandstand, got ${snap.poses}`);
  assert(snap.glb === snap.bodies && snap.bodies > 0, "crowd meshes should use GLB characters");
  assert(snap.fade === snap.bodies, "crowd bodies should set cameraFade");
  assert(snap.kindCount >= 8, `expected ≥8 distinct kinds for diversity, got ${snap.kindCount}: ${snap.kinds && snap.kinds.join(",")}`);
  assert(snap.male > 0 && snap.female > 0, `need male+female poses (m=${snap.male} f=${snap.female})`);
  assert(snap.styleCount >= 3, `expected ≥3 cheer styles, got ${snap.styleCount}`);
  assert(snap.rates >= snap.poses * 0.8, `most poses need animRate (got ${snap.rates}/${snap.poses})`);
  assert(snap.elevated >= 8, `grandstand seats should lift spectators (elevated=${snap.elevated})`);
  assert(snap.onRoad === 0, `spectators planted on roadway: ${snap.onRoad}`);
  console.log("PASS  diverse biped crowd + grandstands — Desert");
  await browser.close();
  server.close();
}

main().catch((e) => {
  console.error("FAIL", e.message || e);
  process.exit(1);
});
