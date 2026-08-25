#!/usr/bin/env node
/**
 * qa-desert-clip.mjs — Stage 1 (Desert): no sand on the ribbon, no car-through-geo.
 *
 * Static contracts plus a headed Desert corridor probe (land vs ribbon, colliders
 * off the painted lane).
 *
 * RUN: node tools/qa-desert-clip.mjs
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

let fail = 0;
function check(label, ok, detail) {
  if (ok) console.log(`  ok  ${label}`);
  else {
    console.log(`  FAIL  ${label}  —  ${detail}`);
    fail += 1;
  }
}

console.log(`DESERT CLIP GATE  ·  ${new Date().toISOString()}\n`);
console.log("static");

check(
  "game imports current track.js",
  /track\.js\?v=176/.test(gameSrc),
  "stale browser cache would keep the old dune mesh"
);
check(
  "desert full-stage land wash at 44 m",
  /scenery === "desert"[\s\S]*?lateral: 44/.test(trackSrc),
  "_markDriveClearCorridors must flatten the Desert drive corridor"
);
check(
  "desert chase-flat holds dunes past half+48",
  /if \(desert\) \{[\s\S]*?chaseFlat = roadW \* 0\.5 \+ 48/.test(trackSrc),
  "_groundHeight must not rise the instant the trench ends"
);
check(
  "desert land-tile chase flatten",
  /else if \(desert\) \{[\s\S]*?chase = near\.roadW \* 0\.5 \+ 48/.test(trackSrc),
  "_addLandTile mesh must match the height function"
);
check(
  "desert skirt is a short tuck",
  /desert \? 2\.6/.test(trackSrc) && !/desert \? 8\.2/.test(trackSrc),
  "8 m dune skirts folded onto tight gravel corners"
);
check(
  "skirt outer verts cannot rise onto the ribbon",
  /Math\.min\(gy, edgeY - 0\.12\)/.test(trackSrc),
  "outer skirt Y must tuck under the deck"
);
check(
  "desert berms plant past the verge keep-out",
  /ROAD_VERGE \+ 5\.8/.test(trackSrc),
  "visual berms at half+9.2 had no collider"
);
check(
  "desert roadside rocks use drive-clear + verge pad",
  /const shoulderPad = def\.scenery === "desert"\s*\n\s*\? 16\.5/.test(trackSrc),
  "rocks at half+9 overlapped the chase corridor"
);

if (fail) {
  console.log(`\nFAIL  ·  ${fail} static check(s)`);
  process.exit(1);
}

const chrome = findChrome();
if (!chrome) {
  console.log("\nSKIP headed  ·  no Chrome");
  console.log("\nPASS  ·  static desert-clip contracts");
  process.exit(0);
}

console.log("\nheaded desert corridor");

async function main() {
  const server = await startServer(ROOT);
  const browser = await launchChrome({ headless: true });
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
      if (!track || !track.points || !track.points.length) return null;
      const pts = track.points;
      let landHits = 0;
      let vergeHits = 0;
      let worstLand = -99;
      let worstVerge = -99;
      const step = Math.max(1, (pts.length / 100) | 0);
      for (let i = 0; i < pts.length; i += step) {
        const p = pts[i];
        if (p.tunnel) continue;
        const half = p.width * 0.5;
        for (const lat of [0, half * 0.28, -half * 0.28, half * 0.48, -half * 0.48]) {
          const x = p.x + p.nx * lat;
          const z = p.z + p.nz * lat;
          const near = track._nearestRoad(x, z);
          const gh = track._groundHeight(x, z, "desert");
          const delta = gh - near.roadY;
          if (delta > worstLand) worstLand = delta;
          if (near.dist < near.roadW * 0.5 + 1.2 && delta > -0.05) landHits += 1;
        }
        for (const lat of [half + 4, -(half + 4)]) {
          const x = p.x + p.nx * lat;
          const z = p.z + p.nz * lat;
          const near = track._nearestRoad(x, z);
          const gh = track._groundHeight(x, z, "desert");
          const delta = gh - near.roadY;
          if (delta > worstVerge) worstVerge = delta;
          if (delta > 0.35) vergeHits += 1;
        }
      }
      const colliders = track.colliders || [];
      let onLane = 0;
      for (let i = 0; i < colliders.length; i++) {
        const c = colliders[i];
        const road = track._nearestRoad(c.x, c.z);
        const over = road.minOver != null ? road.minOver : road.dist - road.roadW * 0.5;
        if (over - (c.r || 0.5) < -0.5) onLane += 1;
      }
      return {
        course: g.courseId,
        samples: Math.ceil(pts.length / step),
        landHits,
        worstLand,
        vergeHits,
        worstVerge,
        colliders: colliders.length,
        onLane,
      };`
    );

    if (!probe || probe.course !== "desert") throw new Error("desert track not loaded");
    if (probe.landHits > 0) {
      throw new Error(
        `land above deck in-lane at ${probe.landHits} sample(s); worst delta ${probe.worstLand.toFixed(2)} m`
      );
    }
    console.log(
      `  ok  in-lane land below ribbon (worst ${probe.worstLand.toFixed(2)} m over ${probe.samples} stations)`
    );
    if (probe.vergeHits > 0) {
      throw new Error(
        `sand bank on the shoulder at ${probe.vergeHits} sample(s); worst ${probe.worstVerge.toFixed(2)} m`
      );
    }
    console.log(`  ok  verge land below deck+0.35 m (worst ${probe.worstVerge.toFixed(2)} m)`);
    if (probe.onLane > 0) {
      throw new Error(`${probe.onLane} collider(s) overlap the painted lane`);
    }
    console.log(`  ok  ${probe.colliders} colliders, none on painted asphalt`);

    const fatal = errors.filter((e) => !/mergeGeometries/.test(String(e.text || "")));
    if (fatal.length) throw new Error(`${fatal.length} page error(s)`);

    console.log(`\nPASS  ·  static + headed desert corridor`);
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
