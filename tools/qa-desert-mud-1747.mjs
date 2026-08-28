#!/usr/bin/env node
/**
 * Desert post-tunnel mud band (~1747 m) — no env geometry on the ribbon.
 *
 * RUN: node tools/qa-desert-mud-1747.mjs
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

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`DESERT MUD 1747 GATE  ·  ${new Date().toISOString()}\n`);
console.log("static");

check("instanced corridor scrub", /_scrubInstancedCorridor\s*\(/.test(trackSrc));
check("lane keepout uses prop base Y", /_laneKeepout\(x, z, r, y, halfH/.test(trackSrc));
check("post-tunnel mud wash", /tunEnd - 48/.test(trackSrc) && /tunEnd \+ 320/.test(trackSrc));
check("mud hairpin inner-apex wash", /tunEnd \+ 120/.test(trackSrc) && /lateral: 96/.test(trackSrc));
check("desert land refuse widened", /desert \? 0\.55 : 0\.35/.test(trackSrc));
check("full-width mud ribbon scrub", /tunEnd \+ 280/.test(trackSrc) && /laterals = \[/.test(trackSrc));

if (fail) {
  console.log(`\nFAIL  ·  ${fail} static check(s)`);
  process.exit(1);
}

const chrome = findChrome();
if (!chrome) {
  console.log("\nSKIP headed  ·  no Chrome");
  console.log("\nPASS  ·  static mud-band contracts");
  process.exit(0);
}

console.log("\nheaded mud-band probe");

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
      const pts = track.points;
      const LO = 1720;
      const HI = 1780;
      let instHits = 0;
      let meshHits = 0;
      let collHits = 0;
      let worstMesh = -99;
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
              if (near.along < LO || near.along > HI) continue;
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
              const sy = Math.hypot(arr[o + 4], arr[o + 5], arr[o + 6]);
              const sz = Math.hypot(arr[o + 8], arr[o + 9], arr[o + 10]);
              const r = Math.max(0.65, Math.max(sx, sy, sz) * 0.55);
              const road = track._nearestRoad(x, z);
              if (road.along < LO || road.along > HI) continue;
              const over = road.minOver != null ? road.minOver : road.dist - road.roadW * 0.5;
              const bottom = y - sy * 0.5;
              if (bottom > road.roadY + 2.6) continue;
              if (over - r < 0.75) instHits += 1;
            }
          }
        });
      }
      for (const c of track.colliders || []) {
        if (c.kind === "wall") continue;
        const road = track._nearestRoad(c.x, c.z);
        if (road.along < LO || road.along > HI) continue;
        const over = road.minOver != null ? road.minOver : road.dist - road.roadW * 0.5;
        if (over - (c.r || 0.5) < 3.8) collHits += 1;
      }
      return { instHits, meshHits, worstMesh, collHits };
    `
    );

    if (probe.collHits > 0) throw new Error(`${probe.collHits} collider(s) on mud ribbon 1720–1780 m`);
    console.log(`  ok  colliders clear (${probe.collHits} hits)`);
    if (probe.meshHits > 0) {
      throw new Error(
        `${probe.meshHits} land vert(s) on ribbon; worst ${Number(probe.worstMesh).toFixed(2)} m`
      );
    }
    console.log(`  ok  land mesh below deck (worst ${Number(probe.worstMesh).toFixed(2)} m)`);
    if (probe.instHits > 0) throw new Error(`${probe.instHits} env instance(s) overlap mud ribbon`);
    console.log(`  ok  env instances clear of mud ribbon`);

    const fatal = errors.filter((e) => !/mergeGeometries/.test(String(e.text || "")));
    if (fatal.length) throw new Error(`${fatal.length} page error(s)`);

    console.log("\nPASS  ·  static + headed mud-band 1720–1780 m");
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

main().catch((err) => {
  if (/Chrome did not open/.test(String(err.message || err))) {
    console.log("\nSKIP headed  ·  no Chrome");
    console.log("\nPASS  ·  static mud-band contracts");
    process.exit(0);
  }
  console.error(err);
  process.exit(1);
});
