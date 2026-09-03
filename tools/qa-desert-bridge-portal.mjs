#!/usr/bin/env node
/**
 * qa-desert-bridge-portal.mjs — Sprint 524: prove the Desert rock bridge is GONE.
 *
 * Former arch scrubbed to floating debris. Player path must not spawn a
 * desertBridge group or tag underpass posts for a missing hole.
 *
 * RUN: node tools/qa-desert-bridge-portal.mjs
 */

import {
  ROOT, startServer, launchChrome, findChrome, preparePage, goto, evaluate,
  waitFor, clickSelector, pressKey, sleep,
  chromeUnavailableHint
} from "./lib/qa-harness.mjs";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function main() {
  const chrome = findChrome();
  if (!chrome) throw new Error(chromeUnavailableHint());
  const server = await startServer(ROOT);
  const browser = await launchChrome({ headless: true });
  const { cdp } = browser;
  const { errors } = await preparePage(cdp);
  try {
    await goto(cdp, `${server.origin}/index.html`);
    await waitFor(cdp, `return window.game ? 1 : null;`, { timeout: 20000, label: "boot" });
    await pressKey(cdp, "Enter");
    await waitFor(
      cdp,
      `const el=document.querySelector(".screen.active"); return el&&el.id==="screen-menu"?1:null;`,
      { timeout: 8000, label: "menu" }
    );
    await clickSelector(cdp, "[data-menu='practice']", "PRACTICE");
    await waitFor(
      cdp,
      `const el=document.querySelector(".screen.active"); return el&&el.id==="screen-cars"?1:null;`,
      { timeout: 12000, label: "cars" }
    );
    await waitFor(
      cdp,
      `const b=document.querySelector("[data-car='celica']"); return b&&!b.disabled?1:null;`,
      { timeout: 20000, label: "celica" }
    );
    await clickSelector(cdp, "[data-car='celica']", "CELICA");
    await waitFor(
      cdp,
      `const el=document.querySelector(".screen.active"); return el&&el.id==="screen-courses"?1:null;`,
      { timeout: 25000, label: "courses" }
    );
    await clickSelector(cdp, "[data-course='desert']", "DESERT");
    await waitFor(
      cdp,
      `return window.game && (window.game.state === "countdown" || window.game.state === "race")
         ? window.game.courseId : null;`,
      { timeout: 120000, label: "desert boot" }
    );
    await sleep(400);

    const snap = await evaluate(cdp, `
    const g = window.game;
    const t = g && g.track;
    if (!t || !t.group) return { err: "no track" };

    let bridgeMeshes = 0;
    let bridgeGroups = 0;
    t.group.traverse((o) => {
      if (o.userData && o.userData.desertBridge) {
        if (o.isGroup) bridgeGroups += 1;
        if (o.isMesh) bridgeMeshes += 1;
      }
    });

    const pin = t._findDesertFinaleBridge && t._findDesertFinaleBridge();
    const p = pin ? t.points[pin.i] : null;
    let underpassTagged = 0;
    if (t.points) {
      for (let i = 0; i < t.points.length; i++) {
        if (t.points[i].underpass) underpassTagged += 1;
      }
    }
    const prisms = (t._underpassPrisms && t._underpassPrisms.length) || 0;
    const runs = (t._underpassRuns && t._underpassRuns.length) || 0;

    let carOk = false;
    let carY = null;
    if (p && g.player && g.player.spawn) {
      g.player.spawn(t, p.dist, 0);
      carY = g.player.position.y;
      carOk = carY > p.y - 0.5 && carY < p.y + 3.5;
    }

    return {
      bridgeMeshes,
      bridgeGroups,
      underpassTagged,
      prisms,
      runs,
      approachDist: p ? p.dist : null,
      carY,
      carOk
    };
  `);

    console.log(JSON.stringify(snap, null, 2));
    assert(snap && !snap.err, snap && snap.err ? snap.err : "probe failed");
    assert(snap.bridgeGroups === 0, `desertBridge group still present (${snap.bridgeGroups})`);
    assert(snap.bridgeMeshes === 0, `desertBridge meshes still present (${snap.bridgeMeshes})`);
    assert(snap.underpassTagged === 0, `underpass posts still tagged (${snap.underpassTagged})`);
    assert(snap.prisms === 0 && snap.runs === 0, `underpass prism/run leftover (${snap.prisms}/${snap.runs})`);
    assert(snap.carOk, `car not driveable on former approach (y=${snap.carY})`);

    console.log("PASS  Desert rock bridge cut — no floating arch remnant");
    await browser.close();
    server.close();
  } catch (err) {
    console.error("FAIL", err.message || err);
    try {
      const state = await evaluate(
        cdp,
        `const g = window.game;
         return g ? { state: g.state, courseId: g.courseId, hasTrack: !!g.track, hasPlayer: !!g.player } : null;`,
        { timeoutMs: 5000 }
      );
      console.error("  game:", JSON.stringify(state));
      if (errors && errors.length) console.error("  page errors:", errors.slice(0, 8));
    } catch (_) { /* ignore */ }
    try { await browser.close(); } catch (_) { /* ignore */ }
    try { server.close(); } catch (_) { /* ignore */ }
    process.exit(1);
  }
}

main();
