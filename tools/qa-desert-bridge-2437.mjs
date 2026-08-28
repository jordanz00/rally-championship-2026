#!/usr/bin/env node
/**
 * Desert rock-bridge approach (~2437 m) — no env geometry on the ribbon.
 *
 * RUN: node tools/qa-desert-bridge-2437.mjs
 */
import fs from "node:fs";
import path from "node:path";
import {
  ROOT,
  startServer,
  launchChrome,
  findChrome,
  preparePage,
  goto,
  waitFor,
  clickSelector,
  pressKey,
  evaluate,
} from "./lib/qa-harness.mjs";

const trackSrc = fs.readFileSync(path.join(ROOT, "js/tracks/track.js"), "utf8");
const gameSrc = fs.readFileSync(path.join(ROOT, "js/game.js"), "utf8");

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`DESERT BRIDGE 2437 GATE  ·  ${new Date().toISOString()}\n`);
console.log("static");

check("bridge drive corridor scrub", /_scrubBridgeDriveCorridor\s*\(/.test(trackSrc));
check("bridge groups scrubbed at build end", /_scrubBridgeGroups\s*\(/.test(trackSrc));
check("mouth blocks pushed out", /clearHalfW \+ 22/.test(trackSrc) && /clearHalfD \+ 20/.test(trackSrc));
check("bridge lining preserved", /userData\.bridgeLining/.test(trackSrc));
check("drift berms bump after strip", /bermsKept/.test(trackSrc) && /_stripLanePoses\(berms\)/.test(trackSrc));
check("game imports track.js?v=213+", Number((gameSrc.match(/track\.js\?v=(\d+)/) || [])[1]) >= 213);

if (fail) {
  console.log(`\nFAIL  ·  ${fail} static check(s)`);
  process.exit(1);
}

const chrome = findChrome();
if (!chrome) {
  console.log("\nSKIP headed  ·  no Chrome");
  console.log("\nPASS  ·  static bridge-2437 contracts");
  process.exit(0);
}

console.log("\nheaded bridge-approach probe");

async function main() {
  const server = await startServer(ROOT);
  let browser;
  try {
    browser = await launchChrome({ headless: true });
  } catch (launchErr) {
    console.log(`\nSKIP headed  ·  ${launchErr.message || launchErr}`);
    console.log("\nPASS  ·  static bridge-2437 contracts");
    server.close();
    process.exit(0);
  }
  const { cdp } = browser;
  const { errors } = await preparePage(cdp);
  try {
    await goto(cdp, `${server.origin}/index.html`);
    await waitFor(cdp, `return window.game ? 1 : null;`, { timeout: 20000, label: "game" });
    await pressKey(cdp, "Enter");
    await waitFor(
      cdp,
      `const el=document.querySelector(".screen.active"); return el&&el.id==="screen-menu"?1:null;`,
      { timeout: 8000, label: "menu" }
    );
    await clickSelector(cdp, "[data-menu='practice']", "PRACTICE");
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

    const snap = await evaluate(cdp, `
      const g = window.game;
      const t = g && g.track;
      if (!t || !t.points) return { err: "no track" };

      const ROAD_COLLIDER_CLEAR = 3.8;
      const laneKeepout = (cx, cz, r, midY, halfH) => {
        const road = t._nearestRoad(cx, cz);
        if (!road) return false;
        const dx = cx - road.x;
        const dz = cz - road.z;
        const over = Math.abs(dx * road.nz - dz * road.nx) - r;
        if (over >= ROAD_COLLIDER_CLEAR) return false;
        const baseY = midY - halfH;
        const deck = road.y + 0.12;
        if (baseY > deck + 2.5) return false;
        return true;
      };

      let bridge = null;
      t.group.traverse((o) => {
        if (!bridge && o.userData && o.userData.desertBridge && o.isGroup) bridge = o;
      });

      const targetDist = 2437;
      let pin = null;
      let best = 1e9;
      for (let i = 0; i < t.points.length; i++) {
        const d = Math.abs(t.points[i].dist - targetDist);
        if (d < best) {
          best = d;
          pin = t.points[i];
        }
      }
      if (!pin) return { err: "no spline pin near 2437m" };

      const corridorHits = [];
      if (bridge) {
        bridge.updateMatrixWorld(true);
        bridge.traverse((child) => {
          if (!child.isMesh || child.userData.bridgeLining) return;
          child.updateWorldMatrix(true, false);
          const box = new THREE.Box3().setFromObject(child);
          const cx = (box.min.x + box.max.x) * 0.5;
          const cz = (box.min.z + box.max.z) * 0.5;
          const r = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.5;
          const midY = (box.min.y + box.max.y) * 0.5;
          const halfH = (box.max.y - box.min.y) * 0.5;
          if (laneKeepout(cx, cz, r, midY, halfH)) {
            corridorHits.push({
              x: +cx.toFixed(2),
              z: +cz.toFixed(2),
              y: +midY.toFixed(2),
            });
          }
        });
      }

      const colliderHits = [];
      for (const c of t.colliders || []) {
        const dx = c.x - pin.x;
        const dz = c.z - pin.z;
        const over = Math.abs(dx * pin.nz - dz * pin.nx) - (c.r || 1);
        if (over < ROAD_COLLIDER_CLEAR) colliderHits.push({ x: c.x, z: c.z, r: c.r });
      }

      return {
        pinDist: pin.dist,
        pinY: pin.y,
        underpass: !!pin.underpass,
        bridgeMeshCount: bridge ? bridge.children.filter((c) => c.isMesh).length : 0,
        corridorHits,
        colliderHits,
      };
    `);

    console.log(JSON.stringify(snap, null, 2));
    check("spline pin near 2437m", snap && !snap.err && Math.abs(snap.pinDist - 2437) < 8, `dist=${snap?.pinDist}`);
    check("underpass flag on bridge approach", !!snap?.underpass);
    check("no bridge mesh in drive corridor", !(snap?.corridorHits?.length), JSON.stringify(snap?.corridorHits));
    check("no colliders on ribbon at pin", !(snap?.colliderHits?.length), JSON.stringify(snap?.colliderHits));

    if (fail) {
      console.log(`\nFAIL  ·  ${fail} headed check(s)`);
      if (errors?.length) {
        for (const e of errors.slice(0, 6)) console.log(`  [${e.type}] ${e.text || e}`);
      }
      process.exit(1);
    }
    console.log("\nPASS  ·  desert bridge approach clear at ~2437 m");
    await browser.close();
    server.close();
  } catch (err) {
    console.error("FAIL", err.message || err);
    if (errors?.length) {
      for (const e of errors.slice(0, 6)) console.log(`  [${e.type}] ${e.text || e}`);
    }
    await browser.close();
    server.close();
    process.exit(1);
  }
}

main();
