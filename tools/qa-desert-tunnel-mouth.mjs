#!/usr/bin/env node
/**
 * qa-desert-tunnel-mouth.mjs — Stage 1 tunnel entrance (~1258 m) regression gate.
 *
 * Ensures the desert mouth is a natural rock cut: clear bore, no floating cap
 * box, world-space bore scrub, embankment past the opening.
 *
 * RUN: node tools/qa-desert-tunnel-mouth.mjs
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
  clickSelector,
  pressKey,
  evaluate,
} from "./lib/qa-harness.mjs";

const trackSrc = fs.readFileSync(path.join(ROOT, "js/tracks/track.js"), "utf8");
const gameSrc = fs.readFileSync(path.join(ROOT, "js/game.js"), "utf8");
const portalSlice = trackSrc.slice(trackSrc.indexOf("_addTunnelPortal"));

let fail = 0;
function check(label, ok, detail) {
  if (ok) console.log(`  ok  ${label}`);
  else {
    console.log(`  FAIL  ${label}  —  ${detail}`);
    fail += 1;
  }
}

console.log(`DESERT TUNNEL MOUTH GATE  ·  ${new Date().toISOString()}\n`);
console.log("static");

check(
  "game imports current track.js",
  Number((gameSrc.match(/track\.js\?v=(\d+)/) || [])[1]) >= 243,
  "stale cache keeps broken portal"
);
check(
  "no floating cap box at portal",
  !/BoxGeometry\(p\.width \+ 48/.test(portalSlice),
  "full-width cap box floated above mouth"
);
check(
  "crown lintel replaces cap",
  /tunnelMouthCrownGeometry/.test(trackSrc) && /portalCrown/.test(portalSlice),
  "arch crown over bore"
);
check(
  "world-space bore scrub",
  /_scrubPortalBoreWorld/.test(trackSrc) && /_tunnelPortalSpec/.test(trackSrc),
  "slope wings must not survive inside bore"
);
check(
  "no approach ramp slabs at mouth",
  !/Approach blend/.test(portalSlice),
  "ramp geo blocked the entrance"
);
check(
  "mouth embankment starts past bore",
  /along = 32; along <= 48/.test(trackSrc) && /lat = clear \+ 3\.5/.test(trackSrc),
  "embankment boxes gated the mouth"
);
check(
  "no duplicate mouth shoulder masses",
  !/Mouth shoulders — extra rock/.test(trackSrc),
  "shoulder loop duplicated embankment at entrance"
);
check(
  "entrance collider scrub band widened",
  /tunStart - 58/.test(trackSrc) && /tunStart \+ 48/.test(trackSrc),
  "ribbon scrub must cover climb approach"
);
check(
  "portal openH 8.2",
  /openH: 8\.2/.test(trackSrc),
  "clearance spec"
);
check(
  "cheeks start outside drive prism",
  /latNear: clear \+ 8\.5/.test(portalSlice),
  "inner cheek too close to ribbon"
);

if (fail) {
  console.log(`\nFAIL  ·  ${fail} static check(s)`);
  process.exit(1);
}

const chrome = findChrome();
if (!chrome) {
  console.log("\nSKIP headed  ·  no Chrome");
  console.log("\nPASS  ·  static desert tunnel mouth contracts");
  process.exit(0);
}

console.log("\nheaded tunnel mouth probe");

async function main() {
  const server = await startServer(ROOT);
  let browser;
  try {
    browser = await launchChrome({ headless: true });
  } catch (err) {
    console.log(`\nSKIP headed  ·  ${err.message || err}`);
    server.close();
    console.log("\nPASS  ·  static desert tunnel mouth contracts");
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

    const probe = await evaluate(
      cdp,
      `const g = window.game;
      const track = g.track;
      if (!track || !track._tunnels || !track._tunnels.length) return null;
      const run = track._tunnels[0];
      const tunStart = run.startDist;
      const pts = track.points;
      let entrance = pts[0];
      let bestD = 1e9;
      for (let i = 0; i < pts.length; i++) {
        if (!pts[i].tunnel) continue;
        const d = Math.abs(pts[i].dist - tunStart);
        if (d < bestD) { bestD = d; entrance = pts[i]; }
      }
      const fx = Math.sin(entrance.heading);
      const fz = Math.cos(entrance.heading);
      const nx = entrance.nx;
      const nz = entrance.nz;
      const half = entrance.width * 0.5;
      const clearHalfW = half + 2.6;
      const openH = 8.2;
      let laneBlocks = 0;
      let floatAbove = 0;
      let portalMeshes = 0;
      let boreInvaders = 0;
      const group = track.group;
      if (group) {
        group.traverse((obj) => {
          if (!(obj.isMesh && obj.userData && obj.userData.tunnelPortal)) return;
          portalMeshes += 1;
          obj.updateWorldMatrix(true, false);
          const e = obj.matrixWorld.elements;
          const geo = obj.geometry;
          if (geo && !geo.boundingBox && geo.computeBoundingBox) geo.computeBoundingBox();
          const bb = geo && geo.boundingBox;
          if (!bb) return;
          const corners = [
            [bb.min.x, bb.min.y, bb.min.z],
            [bb.max.x, bb.min.y, bb.min.z],
            [bb.min.x, bb.min.y, bb.max.z],
            [bb.max.x, bb.min.y, bb.max.z],
            [bb.min.x, bb.max.y, bb.min.z],
            [bb.max.x, bb.max.y, bb.min.z],
          ];
          let minY = Infinity;
          let inv = 0;
          for (let c = 0; c < corners.length; c++) {
            const lx = corners[c][0], ly = corners[c][1], lz = corners[c][2];
            const wx = e[0]*lx + e[4]*ly + e[8]*lz + e[12];
            const wy = e[1]*lx + e[5]*ly + e[9]*lz + e[13];
            const wz = e[2]*lx + e[6]*ly + e[10]*lz + e[14];
            if (wy < minY) minY = wy;
            const dx = wx - entrance.x;
            const dy = wy - entrance.y;
            const dz = wz - entrance.z;
            const wAlong = -(dx * fx + dz * fz);
            if (wAlong < -4 || wAlong > 30) continue;
            const lat = dx * nx + dz * nz;
            if (Math.abs(lat) > clearHalfW + 0.3) continue;
            if (dy < -0.4 || dy > openH - 0.1) continue;
            inv += 1;
          }
          if (inv > 0) boreInvaders += 1;
          const gy = track._tunnelTerrainY(e[12], e[14]);
          if (minY - gy > 1.2 && minY > entrance.y + openH + 0.5) floatAbove += 1;
        });
      }
      for (let d = tunStart - 35; d <= tunStart + 12; d += 2) {
        const pose = track._ribbonPoseAt(d);
        if (!pose) continue;
        for (const lat of [-0.35, 0, 0.35]) {
          const x = pose.x + nx * lat * pose.width;
          const z = pose.z + nz * lat * pose.width;
          const road = track._nearestRoad(x, z);
          const over = road.minOver != null ? road.minOver : road.dist - road.roadW * 0.5;
          if (over < 2.8) {
            const gh = track._groundHeight(x, z, "desert");
            if (gh > road.roadY + 0.35) laneBlocks += 1;
          }
        }
        const colliders = track.colliders || [];
        for (let i = 0; i < colliders.length; i++) {
          const c = colliders[i];
          if (c.kind === "wall") continue;
          const road = track._nearestRoad(c.x, c.z);
          if (Math.abs(road.along - d) > 4) continue;
          const over = road.minOver != null ? road.minOver : road.dist - road.roadW * 0.5;
          if (over - (c.r || 0.5) < 3.8) laneBlocks += 1;
        }
      }
      return {
        tunStart,
        entranceY: entrance.y,
        portalMeshes,
        boreInvaders,
        floatAbove,
        laneBlocks,
      };`
    );

    if (!probe) throw new Error("desert tunnel not loaded");
    console.log(`  ok  tunnel starts at ${probe.tunStart.toFixed(1)} m (y=${probe.entranceY.toFixed(2)})`);
    if (probe.boreInvaders > 0) {
      throw new Error(`${probe.boreInvaders} portal mesh(es) still invade the drive bore`);
    }
    console.log(`  ok  portal bore clear (${probe.portalMeshes} portal meshes)`);
    if (probe.floatAbove > 2) {
      throw new Error(`${probe.floatAbove} portal mesh(es) float >1.2 m above terrain`);
    }
    console.log(`  ok  portal footing (${probe.floatAbove} floaters tolerated)`);
    if (probe.laneBlocks > 0) {
      throw new Error(`${probe.laneBlocks} lane block(s) on tunnel approach`);
    }
    console.log("  ok  approach ribbon + colliders clear");

    const fatal = errors.filter((e) => !/mergeGeometries/.test(String(e.text || "")));
    if (fatal.length) throw new Error(`${fatal.length} page error(s)`);

    console.log("\nPASS  ·  static + headed desert tunnel mouth");
    await browser.close();
    server.close();
    process.exit(0);
  } catch (err) {
    console.error(`\nFAIL  ${err.message || err}`);
    await browser.close();
    server.close();
    process.exit(1);
  }
}

main();
