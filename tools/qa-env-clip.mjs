#!/usr/bin/env node
/**
 * qa-env-clip.mjs — roadway stays clear on every stage; cars do not sit in geo.
 *
 * Static contracts plus a headed probe of desert / forest / mountain / lakeside
 * (land vs every nearby ribbon arm, colliders off the painted lane).
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
  /_forNearbySegments\s*\(/.test(trackSrc) && /dx = -5/.test(trackSrc),
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
  /over - r >= 0\.15/.test(trackSrc),
  "_scrubRoadwayColliders uses minOver across nearby arms"
);
check(
  "near-road bumps reject asphalt overlap",
  /over - r < 1\.15/.test(trackSrc),
  "_bumpNearRoad uses minOver across nearby arms"
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
check(
  "desert full-stage land wash at 56 m",
  /scenery === "desert"[\s\S]*?lateral: 56/.test(trackSrc),
  "coarse dune cells must not fold through Stage 1 ribbon"
);
check(
  "desert skirt is a short tuck, not an 8 m slab",
  /desert \? 2\.6/.test(trackSrc) && !/desert \? 8\.2/.test(trackSrc),
  "long skirts folded sand onto tight gravel corners"
);
check(
  "every biome skirt is a short tuck",
  /scenery === "mountain" \? 3\.8/.test(trackSrc) && /scenery === "lakeside" \? 3\.4/.test(trackSrc),
  "11–12 m skirts folded onto hairpins"
);
check(
  "land verts that can own a triangle over asphalt stay a floor",
  (/refusePad/.test(trackSrc) || /minOver < \(this\._landCell \|\| 12\) \* 2\.05/.test(trackSrc)) &&
    /const drop = mountain \? 1\.2/.test(trackSrc),
  "final sink under any nearby ribbon"
);
check(
  "lane instances cannot sit on painted asphalt",
  /_stripLanePoses\(poses\)/.test(trackSrc) && /_laneKeepout/.test(trackSrc),
  "last-line keep-out before InstancedMesh"
);
check(
  "prop strip is past a GLB rock radius",
  /ROAD_VERGE = 8\.2/.test(trackSrc) && /FOREST_TREE_CLEAR = 8\.6/.test(trackSrc),
  "canopy / boulder bounds must not sit on the painted lane"
);
check(
  "lakeside full-stage land wash",
  /scenery === "lakeside"[\s\S]*?lateral: 48/.test(trackSrc),
  "Stage 4 land tris must stay a floor"
);
check(
  "underpass floor wins before overlapBed flatten",
  /_underpassFloorY\(x, z\);[\s\S]*?if \(near\.overlapBed != null\)/.test(trackSrc) &&
    /_underpassFloorY\(x, z\);[\s\S]*?if \(overlapBed != null\)/.test(trackSrc),
  "bridge hole must not refill from a nearby hairpin arm"
);
check(
  "catch-fence posts sit past the painted edge",
  /barrierOff = ROAD_VERGE \+ 1\.4/.test(trackSrc) &&
    !/width \* 0\.5 \+ 0\.6/.test(trackSrc),
  "Lakeside posts at half+0.6 occupied the kerb"
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

console.log("\nheaded all-course corridor");

const COURSES = ["desert", "forest", "mountain", "lakeside"];

const PROBE_JS = `const g = window.game;
      const track = g.track;
      if (!track || !track.points || !track.points.length) return null;
      const scenery = g.courseId;
      const pts = track.points;
      let landHits = 0;
      let vergeHits = 0;
      let worstLand = -99;
      let worstVerge = -99;
      const step = Math.max(1, (pts.length / 90) | 0);
      for (let i = 0; i < pts.length; i += step) {
        const p = pts[i];
        if (p.tunnel) continue;
        const half = p.width * 0.5;
        for (const lat of [0, half * 0.28, -half * 0.28, half * 0.48, -half * 0.48]) {
          const x = p.x + p.nx * lat;
          const z = p.z + p.nz * lat;
          const near = track._nearestRoad(x, z);
          const gh = track._groundHeight(x, z, scenery);
          // Nearest ribbon deck — not overlapBed (a lower grade-separated arm
          // falsely reports +12 m land "above deck" at the tunnel / underpass).
          const bed = near.roadY;
          const delta = gh - bed;
          const over = near.minOver != null ? near.minOver : near.dist - near.roadW * 0.5;
          if (delta > worstLand) worstLand = delta;
          if (over < 1.2 && delta > -0.05) landHits += 1;
        }
        for (const lat of [half + 4, -(half + 4)]) {
          const x = p.x + p.nx * lat;
          const z = p.z + p.nz * lat;
          const near = track._nearestRoad(x, z);
          const gh = track._groundHeight(x, z, scenery);
          const bed = near.roadY;
          const delta = gh - bed;
          if (delta > worstVerge) worstVerge = delta;
          if (delta > 0.35) vergeHits += 1;
        }
      }
      const colliders = track.colliders || [];
      let onLane = 0;
      for (let i = 0; i < colliders.length; i++) {
        const c = colliders[i];
        if (c.kind === "wall") continue;
        const road = track._nearestRoad(c.x, c.z);
        const over = road.minOver != null ? road.minOver : road.dist - road.roadW * 0.5;
        if (over - (c.r || 0.5) < 0.15) onLane += 1;
      }
      let meshHits = 0;
      let worstMesh = -99;
      let instHits = 0;
      const group = track.group;
      if (group) {
        group.traverse((obj) => {
          if (obj.userData && obj.userData.envLand && obj.geometry && obj.geometry.attributes) {
            const pos = obj.geometry.attributes.position;
            const e = obj.matrixWorld.elements;
            for (let i = 0; i < pos.count; i++) {
              const lx = pos.getX(i);
              const ly = pos.getY(i);
              const lz = pos.getZ(i);
              const x = e[0] * lx + e[4] * ly + e[8] * lz + e[12];
              const y = e[1] * lx + e[5] * ly + e[9] * lz + e[13];
              const z = e[2] * lx + e[6] * ly + e[10] * lz + e[14];
              const near = track._nearestRoad(x, z);
              const over = near.minOver != null ? near.minOver : near.dist - near.roadW * 0.5;
              if (over > 1.2) continue;
              const bed = near.roadY;
              const delta = y - bed;
              if (delta > worstMesh) worstMesh = delta;
              if (delta > -0.02) meshHits += 1;
            }
          }
          if (obj.isInstancedMesh && obj.userData && obj.userData.envProp && obj.instanceMatrix) {
            const arr = obj.instanceMatrix.array;
            const n = obj.count;
            for (let i = 0; i < n; i++) {
              const o = i * 16;
              const x = arr[o + 12];
              const y = arr[o + 13];
              const z = arr[o + 14];
              const sx = Math.hypot(arr[o], arr[o + 1], arr[o + 2]);
              const sz = Math.hypot(arr[o + 8], arr[o + 9], arr[o + 10]);
              const r = Math.max(0.55, Math.max(sx, sz) * 0.48);
              const road = track._nearestRoad(x, z);
              if (y > road.roadY + 2.6) continue;
              const over = road.minOver != null ? road.minOver : road.dist - road.roadW * 0.5;
              if (road.tunnel && over > -1.4) continue;
              if (over - r < 0.75) instHits += 1;
            }
          }
        });
      }
      return {
        course: g.courseId,
        trackId: track.id,
        samples: Math.ceil(pts.length / step),
        landHits,
        worstLand,
        vergeHits,
        worstVerge,
        colliders: colliders.length,
        onLane,
        meshHits,
        worstMesh,
        instHits,
      };`;

async function bootCourse(cdp, courseId) {
  await evaluate(cdp, `window.game._beginRace(${JSON.stringify(courseId)}); return 1;`);
  await waitFor(
    cdp,
    `const g = window.game;
     return g && g.courseId === ${JSON.stringify(courseId)}
       && g.track && g.track.id === ${JSON.stringify(courseId)}
       && (g.state === "countdown" || g.state === "race")
       ? 1 : null;`,
    { timeout: 180000, label: `${courseId} boot` }
  );
}

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
      `return window.game && window.game.track && window.game.track.id === "desert"
         && (window.game.state === "countdown" || window.game.state === "race")
         ? 1 : null;`,
      { timeout: 180000, label: "desert boot" }
    );

    for (let ci = 0; ci < COURSES.length; ci++) {
      const id = COURSES[ci];
      if (ci > 0) await bootCourse(cdp, id);
      const probe = await evaluate(cdp, PROBE_JS);
      if (!probe || probe.course !== id || probe.trackId !== id) {
        throw new Error(`${id} track not loaded`);
      }
      if (probe.landHits > 0) {
        throw new Error(
          `${id}: land above deck in-lane at ${probe.landHits} sample(s); worst ${probe.worstLand.toFixed(2)} m`
        );
      }
      console.log(
        `  ok  ${id} in-lane land below ribbon (worst ${probe.worstLand.toFixed(2)} m over ${probe.samples} stations)`
      );
      if (probe.vergeHits > 0) {
        throw new Error(
          `${id}: bank on the shoulder at ${probe.vergeHits} sample(s); worst ${probe.worstVerge.toFixed(2)} m`
        );
      }
      console.log(
        `  ok  ${id} verge land below deck+0.35 m (worst ${probe.worstVerge.toFixed(2)} m)`
      );
      if (probe.onLane > 0) {
        throw new Error(`${id}: ${probe.onLane} collider(s) overlap the painted lane`);
      }
      console.log(`  ok  ${id} ${probe.colliders} colliders, none on painted asphalt`);
      if (probe.meshHits > 0) {
        throw new Error(
          `${id}: land mesh verts on the ribbon at ${probe.meshHits}; worst ${probe.worstMesh.toFixed(2)} m`
        );
      }
      console.log(`  ok  ${id} land mesh verts below ribbon (worst ${probe.worstMesh.toFixed(2)} m)`);
      if (probe.instHits > 0) {
        throw new Error(`${id}: ${probe.instHits} env instance(s) overlap the painted lane`);
      }
      console.log(`  ok  ${id} env instances clear of painted asphalt`);
    }

    const fatal = errors.filter((e) => !/mergeGeometries/.test(String(e.text || "")));
    if (fatal.length) throw new Error(`${fatal.length} page error(s)`);

    console.log(`\nPASS  ·  static + headed desert/forest/mountain/lakeside corridor`);
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
