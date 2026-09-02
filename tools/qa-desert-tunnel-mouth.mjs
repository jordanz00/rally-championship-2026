#!/usr/bin/env node
/**
 * qa-desert-tunnel-mouth.mjs — Stage 1 tunnel entrance/exit regression gate.
 *
 * Ensures both mouths are terrain-welded rock-cut portals: unified hillside
 * shells, lintel crown, recessed bore liner, no floating arch gate or box
 * embankment at the mouth.
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
const runSlice = trackSrc.slice(trackSrc.indexOf("_addTunnelRun"));

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
  Number((gameSrc.match(/track\.js\?v=(\d+)/) || [])[1]) >= 245,
  "stale cache keeps broken portal"
);
check(
  "unified terrain-welded hillside shells",
  /tunnelMouthHillsideGeometry/.test(trackSrc) && /portalHillside/.test(portalSlice),
  "need single welded hillside per side"
);
check(
  "lintel crown above arch spring",
  /tunnelMouthLintelGeometry/.test(trackSrc) && /portalLintel/.test(portalSlice),
  "overburden crown missing"
);
check(
  "recessed bore liner into mountain",
  /portalBoreLiner/.test(portalSlice),
  "dark bore mouth missing"
);
check(
  "vertex weld to terrain",
  /_weldPortalVerticesToTerrain/.test(trackSrc),
  "portal verts must snap to land"
);
check(
  "no floating extruded arch gate at portal",
  !/portalFace/.test(portalSlice),
  "extruded face floated above hillside"
);
check(
  "no talus shards at portal",
  !/talusSpots/.test(portalSlice),
  "floating shard props at mouth"
);
check(
  "no box embankment at portal",
  !/_addTunnelMouthEmbankment\(pts\[start\]/.test(runSlice),
  "box fill gated the mouth"
);
check(
  "mountain masses skip mouth zone",
  /mouthSkip/.test(trackSrc) && /start \+ mouthSkip/.test(trackSrc),
  "ridge boxes overlapped portal"
);
check(
  "no floating full-width cap box",
  !/BoxGeometry\(p\.width \+ 48/.test(portalSlice),
  "full-width cap box floated above mouth"
);
check(
  "clearHalfW includes verge",
  /clearHalfW:\s*half \+ ROAD_VERGE/.test(trackSrc),
  "narrow clearHalfW left rock in the drive path"
);
check(
  "mouth land prisms registered early",
  /_tunnelMouthPrisms/.test(trackSrc) &&
    /_registerTunnelMouthPrism/.test(trackSrc) &&
    /_markTunnelRuns[\s\S]{0,600}_registerTunnelMouthPrism/.test(trackSrc),
  "prisms must exist before land tiles"
);
check(
  "land refuse uses mouth corridor",
  /_inTunnelMouthCorridor/.test(trackSrc) && /_tunnelMouthFloorY/.test(trackSrc),
  "heightmap must stay a floor through the opening"
);
check(
  "world-space bore scrub",
  /_scrubPortalBoreWorld/.test(trackSrc),
  "hillside wings must not survive inside bore"
);
check(
  "interior lining inset from mouths",
  /wallStart/.test(trackSrc) && /start \+ 1/.test(trackSrc),
  "box walls poked into the approach"
);
check(
  "entrance + exit collider scrub widened",
  /tunStart - 72/.test(trackSrc) && /tunEnd \+ 72/.test(trackSrc),
  "ribbon scrub must cover both mouths"
);
check(
  "portal openH 8.2",
  /openH: 8\.2/.test(trackSrc),
  "clearance spec"
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
  await goto(cdp, `${server.url}/index.html?v=564&perf=medium`);
  await waitFor(cdp, () => evaluate(cdp, () => !!window.__RALLY__), 20000).catch(() => null);

  try {
    await clickSelector(cdp, "#btn-play, .btn-play, [data-action=play]");
  } catch {
    /* title may already be racing */
  }
  await new Promise((r) => setTimeout(r, 2500));

  const probe = await evaluate(cdp, () => {
    const g = window.__RALLY__;
    const track = g && (g.track || g._track);
    if (!track || !track._tunnels || !track._tunnels.length) {
      return { ok: false, reason: "no tunnel runs" };
    }
    const run = track._tunnels[0];
    const prisms = track._tunnelMouthPrisms || [];
    const portals = [];
    track.group.traverse((o) => {
      if (o.userData && o.userData.tunnelPortal && o.isGroup) portals.push(o);
    });
    let hillsides = 0;
    let lintels = 0;
    let liners = 0;
    let floaters = 0;
    const THREE = window.THREE;
    const box = THREE ? new THREE.Box3() : null;
    for (let i = 0; i < portals.length; i++) {
      portals[i].traverse((m) => {
        if (!m.isMesh) return;
        if (m.userData.portalHillside) hillsides += 1;
        if (m.userData.portalLintel) lintels += 1;
        if (m.userData.portalBoreLiner) liners += 1;
        if (!box) return;
        box.setFromObject(m);
        const gy =
          typeof track._tunnelTerrainY === "function"
            ? track._tunnelTerrainY(
                (box.min.x + box.max.x) * 0.5,
                (box.min.z + box.max.z) * 0.5
              )
            : box.min.y;
        if (
          !m.userData.portalLintel &&
          !m.userData.portalBoreLiner &&
          box.min.y - gy > 1.2
        ) {
          floaters += 1;
        }
      });
    }
    const pose = track._ribbonPoseAt
      ? track._ribbonPoseAt(run.startDist - 12)
      : null;
    let apronClear = true;
    if (pose && typeof track._groundHeight === "function") {
      const h = track._groundHeight(pose.x, pose.z, "desert");
      if (h > pose.y - 0.2) apronClear = false;
    }
    return {
      ok: true,
      startDist: run.startDist,
      endDist: run.endDist,
      prisms: prisms.length,
      portals: portals.length,
      hillsides,
      lintels,
      liners,
      floaters,
      apronClear,
    };
  });

  if (!probe || !probe.ok) {
    check("headed probe", false, (probe && probe.reason) || "probe failed");
  } else {
    check("tunnel start near climb", probe.startDist > 1100 && probe.startDist < 1450, `at ${probe.startDist}`);
    check("mouth prisms present", probe.prisms >= 2, `count=${probe.prisms}`);
    check("portal groups for enter+exit", probe.portals >= 2, `count=${probe.portals}`);
    check("hillside shells present", probe.hillsides >= 4, `hillsides=${probe.hillsides}`);
    check("lintel crowns present", probe.lintels >= 2, `lintels=${probe.lintels}`);
    check("bore liners present", probe.liners >= 2, `liners=${probe.liners}`);
    check("no large floaters", probe.floaters === 0, `floaters=${probe.floaters}`);
    check("approach apron land is floor", probe.apronClear, "land rose into bore");
  }

  const pageErrors = (errors || []).filter((e) => /tunnel|portal|SyntaxError/i.test(String(e)));
  check("no tunnel page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join("; "));

  try {
    browser.close();
  } catch {
    /* ignore */
  }
  server.close();

  console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "desert tunnel mouths OK"}`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
