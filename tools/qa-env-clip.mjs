#!/usr/bin/env node
/**
 * qa-env-clip.mjs — no car-through-environment on any stage; Stage 3 is the stress case.
 *
 * Static contracts plus a headed Mountain corridor probe (land vs ribbon, colliders
 * off the painted lane, cliff plant uses drive-clear).
 *
 * RUN: node tools/qa-env-clip.mjs
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
const collideSrc = fs.readFileSync(path.join(ROOT, "js/physics/collide.js"), "utf8");

let fail = 0;
function check(label, ok, detail) {
  if (ok) console.log(`  ok  ${label}`);
  else {
    console.log(`  FAIL  ${label}  —  ${detail}`);
    fail += 1;
  }
}

console.log(`ENV CLIP GATE  ·  ${new Date().toISOString()}\n`);
console.log("static");

check(
  "hairpin nearest-road searches nearby grid cells",
  /_forNearbySegments\s*\(/.test(trackSrc) && /cellKey\(gx \+ dx/.test(trackSrc),
  "_nearestRoad must see the opposite hairpin arm"
);
check(
  "cliff no longer plants at width/2+18.5",
  !/width \* 0\.5 \+ 18\.5/.test(trackSrc) && /ROAD_VERGE \+ 3\.2/.test(trackSrc),
  "old inside offset punched 15–18 m hairpins"
);
check(
  "cliff columns require _driveClear on face, mid, and back",
  /_addMountainCliff\s*\([\s\S]*?_driveClear\(fx[\s\S]*?_driveClear\(mx[\s\S]*?_driveClear\(bx/.test(
    trackSrc
  ),
  "visual wall must not exist without a clear footprint"
);
check(
  "_driveClear samples cardinal extents",
  /_driveClear\s*\([\s\S]*?_ribbonClear\(x \+ d/.test(trackSrc),
  "AABB larger than the plant centre"
);
check(
  "colliders whose sphere overlaps asphalt are scrubbed",
  /road\.dist - r >= road\.roadW \* 0\.5 - 0\.4/.test(trackSrc),
  "_scrubRoadwayColliders"
);
check(
  "near-road bumps reject asphalt overlap",
  /road\.dist - r < road\.roadW \* 0\.5 \+ 1\.15/.test(trackSrc),
  "_bumpNearRoad"
);
check(
  "opaque env still fully depenetrates",
  /pass < 2/.test(collideSrc) && /must not be penetrable/.test(collideSrc),
  "glanceObstacles"
);
check(
  "mountain trench chase flattened to 48 m",
  /chaseFlat = roadW \* 0\.5 \+ 48/.test(trackSrc) && /lateral: 46/.test(trackSrc),
  "land tris must stay a floor through Stage 3 hairpins"
);

if (fail) {
  console.log(`\nFAIL  ·  ${fail} static check(s)`);
  process.exit(1);
}

const chrome = findChrome();
if (!chrome) {
  console.log("\nSKIP headed  ·  no Chrome");
  console.log("\nPASS  ·  static env-clip contracts");
  process.exit(0);
}

console.log("\nheaded mountain corridor");

async function main() {
  const server = await startServer(ROOT);
  const browser = await launchChrome({ headless: true });
  const { cdp } = browser;
  const { errors } = await preparePage(cdp);
  try {
    await goto(cdp, `${server.origin}/index.html`);
    await waitFor(cdp, `return window.game ? 1 : null;`, { timeout: 15000, label: "game" });
    await pressKey(cdp, "Enter");
    await waitFor(cdp, `return document.querySelector("#screen-menu.active") ? 1 : null;`, {
      timeout: 8000,
      label: "menu",
    });
    await clickSelector(cdp, "[data-menu='practice']", "PRACTICE");
    await waitFor(cdp, `return document.querySelector("#screen-cars.active") ? 1 : null;`, {
      timeout: 12000,
      label: "cars",
    });
    await clickSelector(cdp, "[data-car='celica']", "CELICA");
    await waitFor(cdp, `return document.querySelector("#screen-courses.active") ? 1 : null;`, {
      timeout: 20000,
      label: "courses",
    });
    await clickSelector(cdp, "[data-course='mountain']", "MOUNTAIN");
    await waitFor(
      cdp,
      `return window.game && (window.game.state === "countdown" || window.game.state === "race")
         ? window.game.courseId : null;`,
      { timeout: 90000, label: "mountain boot" }
    );

    const probe = await evaluate(
      cdp,
      `const g = window.game;
      const track = g.track;
      if (!track || !track.points || !track.points.length) return null;
      const pts = track.points;
      let landHits = 0;
      let worstLand = -99;
      const step = Math.max(1, (pts.length / 80) | 0);
      for (let i = 0; i < pts.length; i += step) {
        const p = pts[i];
        if (p.tunnel) continue;
        for (const lat of [0, p.width * 0.28, -p.width * 0.28]) {
          const x = p.x + p.nx * lat;
          const z = p.z + p.nz * lat;
          const near = track._nearestRoad(x, z);
          const gh = track._groundHeight(x, z, "mountain");
          const delta = gh - near.roadY;
          if (delta > worstLand) worstLand = delta;
          if (near.dist < near.roadW * 0.5 + 1.2 && delta > -0.05) landHits += 1;
        }
      }
      const colliders = track.colliders || [];
      let onLane = 0;
      for (let i = 0; i < colliders.length; i++) {
        const c = colliders[i];
        const road = track._nearestRoad(c.x, c.z);
        if (road.dist - (c.r || 0.5) < road.roadW * 0.5 - 0.5) onLane += 1;
      }
      return {
        course: g.courseId,
        samples: Math.ceil(pts.length / step),
        landHits,
        worstLand,
        colliders: colliders.length,
        onLane,
      };`
    );

    if (!probe || probe.course !== "mountain") throw new Error("mountain track not loaded");
    if (probe.landHits > 0) {
      throw new Error(
        `land above deck in-lane at ${probe.landHits} sample(s); worst delta ${probe.worstLand.toFixed(2)} m`
      );
    }
    console.log(
      `  ok  in-lane land below ribbon (worst ${probe.worstLand.toFixed(2)} m over ${probe.samples} stations)`
    );
    if (probe.onLane > 0) {
      throw new Error(`${probe.onLane} collider(s) overlap the painted lane`);
    }
    console.log(`  ok  ${probe.colliders} colliders, none on painted asphalt`);

    const fatal = errors.filter((e) => !/mergeGeometries/.test(String(e.text || "")));
    if (fatal.length) throw new Error(`${fatal.length} page error(s)`);

    console.log(`\nPASS  ·  static + headed mountain corridor`);
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
