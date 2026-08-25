#!/usr/bin/env node
/**
 * qa-desert-bridge-portal.mjs — prove Stage 1 rock bridge has a drive-through hole.
 *
 * Boots Desert practice, finds the desertBridge group, asserts:
 *   1) portal clearance metadata exists
 *   2) no bridge mesh AABB invades the portal prism
 *   3) land under the arch stays near road bed (not a dune wall)
 *   4) car can be spawned on the centerline under the lintel
 *
 * RUN: node tools/qa-desert-bridge-portal.mjs
 */

import {
  ROOT, startServer, launchChrome, findChrome, preparePage, goto, evaluate,
  waitFor, clickSelector, pressKey, sleep,
} from "./lib/qa-harness.mjs";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function main() {
  const chrome = findChrome();
  if (!chrome) throw new Error("no Chrome");
  const server = await startServer(ROOT);
  const browser = await launchChrome({ headless: true });
  const { cdp } = browser;
  await preparePage(cdp);
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

    let bridge = null;
    t.group.traverse((o) => {
      if (!bridge && o.userData && o.userData.desertBridge && o.isGroup) bridge = o;
      if (!bridge && o.userData && o.userData.desertBridge && o.parent && o.parent.userData && o.parent.userData.portal) {
        bridge = o.parent;
      }
    });
    if (!bridge) {
      // Fallback: any group with portal + desertBridge on children
      t.group.traverse((o) => {
        if (!bridge && o.userData && o.userData.portal && o.children && o.children.length) bridge = o;
      });
    }
    if (!bridge) return { err: "no desertBridge group" };

    const portal = bridge.userData.portal || {};
    const openH = portal.openH;
    const clearHalfW = portal.clearHalfW;
    const clearHalfD = portal.clearHalfD;
    if (!(openH > 8) || !(clearHalfW > 4) || !(clearHalfD > 6)) {
      return { err: "portal meta weak", portal };
    }

    const invaders = [];
    for (const child of bridge.children) {
      if (!child.isMesh) continue;
      // Bridge children are authored in local space (position + scale).
      const sx = Math.abs(child.scale.x);
      const sy = Math.abs(child.scale.y);
      const sz = Math.abs(child.scale.z);
      const x0 = child.position.x - sx * 0.5;
      const x1 = child.position.x + sx * 0.5;
      const y0 = child.position.y - sy * 0.5;
      const y1 = child.position.y + sy * 0.5;
      const z0 = child.position.z - sz * 0.5;
      const z1 = child.position.z + sz * 0.5;
      const ox = x0 < clearHalfW - 0.05 && x1 > -(clearHalfW - 0.05);
      const oz = z0 < clearHalfD - 0.05 && z1 > -(clearHalfD - 0.05);
      const oy = y0 < openH - 0.15 && y1 > 0.25;
      if (ox && oz && oy) {
        invaders.push({
          x: child.position.x,
          y: child.position.y,
          z: child.position.z,
          sx, sy, sz,
        });
      }
    }

    // Land height under arch vs road bed
    const pin = t._findDesertFinaleBridge && t._findDesertFinaleBridge();
    const p = pin ? t.points[pin.i] : null;
    const landSamples = [];
    if (p) {
      for (const zOff of [-clearHalfD * 0.6, 0, clearHalfD * 0.6]) {
        const wx = p.x + Math.sin(p.heading) * zOff;
        const wz = p.z + Math.cos(p.heading) * zOff;
        const gy = t._groundHeight(wx, wz, "desert");
        landSamples.push({ zOff, gy, roadY: p.y, delta: gy - p.y });
      }
    }

    // Spawn car under the lintel and confirm it sits on the deck, not buried.
    let carY = null;
    let carOk = false;
    if (p && g.player && g.player.spawn) {
      g.player.spawn(t, p.dist, 0);
      carY = g.player.position.y;
      carOk = carY > p.y - 0.5 && carY < p.y + 3.5;
    }

    // Car-sized envelope through the hole — no authored block may contain it.
    const clipHits = [];
    if (p) {
      const half = p.width * 0.5;
      for (const zOff of [-clearHalfD * 0.65, -clearHalfD * 0.3, 0, clearHalfD * 0.3, clearHalfD * 0.65]) {
        for (const lat of [0, half * 0.35, -half * 0.35]) {
          for (const yOff of [0.55, 1.35, 2.15]) {
            for (const child of bridge.children) {
              if (!child.isMesh) continue;
              const hx = Math.abs(child.scale.x) * 0.5;
              const hy = Math.abs(child.scale.y) * 0.5;
              const hz = Math.abs(child.scale.z) * 0.5;
              if (
                Math.abs(lat - child.position.x) <= hx &&
                Math.abs(yOff - child.position.y) <= hy &&
                Math.abs(zOff - child.position.z) <= hz
              ) {
                clipHits.push({ yOff, zOff, lat, y: child.position.y });
              }
            }
          }
        }
      }
    }

    return {
      openH,
      clearHalfW,
      clearHalfD,
      meshCount: bridge.children.filter((c) => c.isMesh).length,
      invaders,
      clipHits,
      landSamples,
      carY,
      carOk,
      bridgeDist: p ? p.dist : null,
      underpass: !!(p && p.underpass),
    };
  `);

  console.log(JSON.stringify(snap, null, 2));
  assert(snap && !snap.err, snap && snap.err ? snap.err : "probe failed");
  assert(snap.openH >= 8, `openH too low: ${snap.openH}`);
  assert(snap.clearHalfD >= 15, `clearHalfD too shallow: ${snap.clearHalfD}`);
  assert(!snap.invaders.length, `meshes invade portal: ${JSON.stringify(snap.invaders)}`);
  assert(!snap.clipHits.length, `car envelope hits rock: ${JSON.stringify(snap.clipHits)}`);
  assert(snap.landSamples && snap.landSamples.length, "no land samples");
  for (const s of snap.landSamples) {
    assert(s.delta < 0.2, `dune wall under arch: delta=${s.delta} at zOff=${s.zOff}`);
    assert(s.delta > -2.5, `land collapsed under arch: delta=${s.delta}`);
  }
  assert(snap.carOk, `car not driveable under arch (y=${snap.carY})`);
  assert(snap.underpass, "bridge sample missing underpass flag");

  console.log("PASS  Desert rock bridge portal is open");
    await browser.close();
    server.close();
  } catch (err) {
    console.error("FAIL", err.message || err);
    await browser.close();
    server.close();
    process.exit(1);
  }
}

main();
