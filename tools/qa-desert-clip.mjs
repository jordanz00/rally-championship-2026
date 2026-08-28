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
  Number((gameSrc.match(/track\.js\?v=(\d+)/) || [])[1]) >= 190,
  "stale browser cache would keep the old dune mesh"
);
check(
  "desert full-stage land wash at 56 m",
  /scenery === "desert"[\s\S]*?lateral: 56/.test(trackSrc),
  "_markDriveClearCorridors must flatten the Desert drive corridor"
);
check(
  "desert chase-flat holds dunes past half+56",
  /if \(desert\) \{[\s\S]*?chaseFlat = roadW \* 0\.5 \+ 56/.test(trackSrc),
  "_groundHeight must not rise the instant the trench ends"
);
check(
  "desert land-tile chase flatten",
  /else if \(desert\) \{[\s\S]*?chase = near\.roadW \* 0\.5 \+ 56/.test(trackSrc),
  "_addLandTile mesh must match the height function"
);
check(
  "lane poses are stripped before instancing",
  /_stripLanePoses/.test(trackSrc) && /_laneKeepout/.test(trackSrc),
  "rocks/trees/props must not sit on painted asphalt"
);
check(
  "land verts that can own a triangle over asphalt stay a floor",
  /refusePad/.test(trackSrc) ||
    /minOver < \(tunnelCut \? 2\.4 : \(this\._landCell \|\| 12\) \* 2\.05\)/.test(trackSrc) ||
    /minOver < \(this\._landCell \|\| 12\) \* 2\.05/.test(trackSrc),
  "10 m land tris must not interpolate dunes onto the ribbon"
);
check(
  "tunnel exit refuse keeps drive verge clear",
  /ROAD_VERGE \+ 4\.5/.test(trackSrc) && /_scrubTunnelPortalDrive/.test(trackSrc),
  "portal rock and mouth-cut must not occupy the painted exit"
);
check(
  "mouth cut never invents lateral from along",
  !/ridgeDist = Math\.max\(lat, cutTrench/.test(trackSrc),
  "fake ridgeDist raised hills on lat≈0 exit apron"
);
check(
  "no centre approach mound on the ribbon",
  !/Centre approach mound/.test(trackSrc) && !/ties the ribbon into the cut/.test(trackSrc),
  "mound at outward*14 sat on the racing line"
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
check(
  "desert tunnel cutting preserves ridge under portal",
  /_tunnelCutHeight/.test(trackSrc) && /_inTunnelCut/.test(trackSrc),
  "landmark wash used to plane the tunnel hill to bed — floating portal"
);
check(
  "land tiles keep tunnel cut (skip wash / chase flatten)",
  /_inTunnelCutAt\(/.test(trackSrc) || /_inTunnelCut\(near\.along/.test(trackSrc),
  "_addLandTile must not re-flatten the authored ridge"
);
check(
  "tunnel cut uses bore neighbor + mouth apron",
  /_tunnelNeighbor/.test(trackSrc) && /_tunnelMouthCutY/.test(trackSrc),
  "Euclidean nearest-road beside the mouth was a lower Desert arm"
);
check(
  "desert tunnel portal has buried embankment footing",
  /tunnelPortal/.test(trackSrc) &&
    (/_scrubTunnelPortalDrive/.test(trackSrc) || /Grounding slab under the whole mouth/.test(trackSrc)) &&
    /Approach embankment/.test(trackSrc),
  "portal must plant into the hillside, not float as a gate"
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
              const bed = near.overlapBed != null ? near.overlapBed : near.roadY;
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
      const colliders = track.colliders || [];
      let onLane = 0;
      for (let i = 0; i < colliders.length; i++) {
        const c = colliders[i];
        if (c.kind === "wall") continue;
        const road = track._nearestRoad(c.x, c.z);
        const over = road.minOver != null ? road.minOver : road.dist - road.roadW * 0.5;
        if (over - (c.r || 0.5) < 3.8) onLane += 1;
      }
      // Portal grounding proof:
      // 1) Cut formula raises beside the bore (folded arms make world samples noisy).
      // 2) Portal meshes bury below the deck (footing / embankment).
      let ridgeOk = 0;
      let ridgeN = 0;
      let worstRidge = 99;
      const runs = track._tunnels || [];
      for (let r = 0; r < runs.length; r++) {
        const mid = (runs[r].startDist + runs[r].endDist) * 0.5;
        let best = null;
        let bestD = 1e9;
        for (let i = 0; i < pts.length; i++) {
          const d = Math.abs(pts[i].dist - mid);
          if (d < bestD) {
            bestD = d;
            best = pts[i];
          }
        }
        if (!best || !best.tunnel) continue;
        const lat = best.width * 0.5 + 18;
        const cut = track._tunnelCutHeight(best.dist, lat, best.width, best.y - 1.15);
        ridgeN += 1;
        const lift = cut == null ? -99 : cut - best.y;
        if (lift < worstRidge) worstRidge = lift;
        if (lift >= 4.5) ridgeOk += 1;
        // World sample when clear of other ribbons.
        for (const side of [-1, 1]) {
          const x = best.x + best.nx * side * lat;
          const z = best.z + best.nz * side * lat;
          const near = track._nearestRoad(x, z);
          if (near.minOver < 3) continue;
          const gh = track._groundHeight(x, z, "desert");
          const wLift = gh - best.y;
          ridgeN += 1;
          if (wLift < worstRidge) worstRidge = wLift;
          if (wLift >= 4.5) ridgeOk += 1;
        }
      }
      let portalMeshes = 0;
      let portalBuried = 0;
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
          let minY = Infinity;
          const corners = [
            [bb.min.x, bb.min.y, bb.min.z],
            [bb.min.x, bb.min.y, bb.max.z],
            [bb.max.x, bb.min.y, bb.min.z],
            [bb.max.x, bb.min.y, bb.max.z],
          ];
          for (let c = 0; c < corners.length; c++) {
            const lx = corners[c][0];
            const ly = corners[c][1];
            const lz = corners[c][2];
            const y = e[1] * lx + e[5] * ly + e[9] * lz + e[13];
            if (y < minY) minY = y;
          }
          const near = track._nearestRoad(e[12], e[14]);
          if (minY < near.roadY - 1.2) portalBuried += 1;
        });
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
        meshHits,
        worstMesh,
        instHits,
        ridgeOk,
        ridgeN,
        worstRidge,
        portalMeshes,
        portalBuried,
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
      throw new Error(`${probe.onLane} collider(s) invade the roadway safety corridor`);
    }
    console.log(`  ok  ${probe.colliders} colliders, clear of drive corridor`);
    if (probe.meshHits > 0) {
      throw new Error(
        `land mesh verts on the ribbon at ${probe.meshHits} sample(s); worst ${probe.worstMesh.toFixed(2)} m`
      );
    }
    console.log(`  ok  land mesh verts below ribbon (worst ${probe.worstMesh.toFixed(2)} m)`);
    if (probe.instHits > 0) {
      throw new Error(`${probe.instHits} env instance(s) overlap the painted lane`);
    }
    console.log(`  ok  env instances clear of painted asphalt`);
    if (!probe.ridgeN || probe.ridgeOk < 1) {
      throw new Error(
        `tunnel cut formula too low (${probe.ridgeOk}/${probe.ridgeN}; worst ${Number(probe.worstRidge).toFixed(2)} m)`
      );
    }
    console.log(
      `  ok  tunnel cut formula raises ridge (${probe.ridgeOk}/${probe.ridgeN}; worst lift ${probe.worstRidge.toFixed(2)} m)`
    );
    if (!probe.portalMeshes || probe.portalBuried < Math.max(4, (probe.portalMeshes * 0.25) | 0)) {
      throw new Error(
        `tunnel portal footing not buried (${probe.portalBuried}/${probe.portalMeshes} meshes below deck-1.2 m)`
      );
    }
    console.log(
      `  ok  tunnel portal footing buried (${probe.portalBuried}/${probe.portalMeshes} meshes below deck)`
    );

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
