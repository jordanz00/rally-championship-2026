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
  chromeUnavailableHint
} from "./lib/qa-harness.mjs";

const trackSrc = fs.readFileSync(path.join(ROOT, "js/tracks/track.js"), "utf8");
const gameSrc = fs.readFileSync(path.join(ROOT, "js/game.js"), "utf8");
const portalStart = trackSrc.indexOf("_addTunnelPortal");
const portalEnd = trackSrc.indexOf("_weldPortalVerticesToTerrain", portalStart);
const portalSlice = trackSrc.slice(portalStart, portalEnd > portalStart ? portalEnd : undefined);
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
  Number((gameSrc.match(/track\.js\?v=(\d+)/) || [])[1]) >= 262,
  "stale cache keeps broken portal"
);
check(
  "one continuous mountain mass with horseshoe hole",
  /tunnelMountainMassGeometry/.test(trackSrc) &&
    /portalMountainMass/.test(portalSlice),
  "need single ridge silhouette with open bore — not stacked boxes"
);
check(
  "horseshoe hole arcs through crown (not inverted)",
  /absarc\(0, spring, clearHalfW, 0, Math\.PI, false\)/.test(trackSrc),
  "inverted arc filled the mouth solid"
);
check(
  "battered cliff face (not cardboard plate)",
  /batterTunnelMountainFace/.test(trackSrc),
  "front face must lean into the hill"
);
check(
  "no stacked solid wing / lintel / cheek / bench boxes at portal",
  !/portalSolidWing/.test(portalSlice) &&
    !/portalSolidLintel/.test(portalSlice) &&
    !/portalSolidCheek/.test(portalSlice) &&
    !/portalQuarryBench/.test(portalSlice),
  "legacy box pieces closed the mouth"
);
check(
  "short mouth throat only (no deep solid fill into the bore)",
  /throatLen:\s*9/.test(trackSrc) &&
    /faceDepth:\s*16/.test(trackSrc) &&
    !/throatLen:\s*32/.test(trackSrc),
  "long throat + plug sealed the driveable tunnel"
);
check(
  "no solid far-end bore plug in the drive path",
  !/portalBorePlug/.test(portalSlice) &&
    !/tunnelBorePlugGeometry\(clearHalfW/.test(
      trackSrc.slice(trackSrc.indexOf("function tunnelBoreAssembly"), trackSrc.indexOf("function batterTunnelMountainFace"))
    ),
  "solid plug filled the tunnel interior"
);
check(
  "thick sealed bore tube (no sky-through rings)",
  /tunnelBoreAssembly/.test(trackSrc) &&
    /tunnelThickBoreTubeGeometry/.test(trackSrc),
  "bore must be a thick hollow tube at the mouth"
);
check(
  "lining arch hole uses open crown winding (not solid fill)",
  /archHollow\|/.test(trackSrc) ||
    (/function tunnelPortalArchGeometry[\s\S]*?absarc\(0, spring, clearHalfW, 0, Math\.PI, false\)/.test(trackSrc) &&
      !/absarc\(0, spring - 0\.04, clearHalfW, Math\.PI, 0, true\)/.test(
        trackSrc.slice(trackSrc.indexOf("function tunnelPortalArchGeometry"), trackSrc.indexOf("function tunnelBoreStriationMap"))
      )),
  "inverted lining hole filled every bore segment solid"
);
check(
  "portal openH scales with road width",
  /_tunnelOpenHeight/.test(trackSrc) && /openH = this\._tunnelOpenHeight/.test(trackSrc),
  "clearance must scale with wider corridor"
);
check(
  "shoulder berms never span the drive opening",
  /tunnelMouthShoulderBermGeometry/.test(trackSrc) &&
    /portalApron/.test(portalSlice),
  "apron across the bore closed the mouth"
);
check(
  "no floating backdrop cards at mouth",
  !/portalBackdrop/.test(portalSlice),
  "flat backdrop cards forbidden"
);
check(
  "no shoulder pylon cards",
  !/portalShoulder/.test(portalSlice),
  "pylon cards forbidden"
);
check(
  "arched bore lining (not box walls)",
  /tunnelBoreLining/.test(trackSrc) && /tunnelPortalArchGeometry\(liningHalf/.test(trackSrc),
  "box walls made enter/exit shape-swap fake"
);
check(
  "unified terrain-welded hillside shells",
  /tunnelMouthHillsideGeometry/.test(trackSrc) && /portalHillside/.test(portalSlice),
  "need single welded hillside per side"
);
check(
  "recessed horseshoe mouth ring into mountain",
  /tunnelPortalArchGeometry/.test(trackSrc) && /portalMouthRing/.test(portalSlice),
  "need sunk arch ring with drive hole"
);
check(
  "arched bore liner into mountain",
  /portalBoreLiner/.test(trackSrc) && /tunnelBoreAssembly/.test(portalSlice),
  "dark bore mouth missing"
);
check(
  "vertex weld to terrain",
  /_weldPortalVerticesToTerrain/.test(trackSrc),
  "portal verts must snap to land"
);
check(
  "no legacy free-standing portalFace gate tag",
  !/portalFace/.test(portalSlice),
  "extruded face floated above hillside"
);
check(
  "grounded scree outside drive cone",
  /portalScree/.test(portalSlice) && /_inTunnelMouthCorridor/.test(portalSlice),
  "scree must refuse mouth corridor"
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
  "clearHalfW matches lining (not stadium verge hole)",
  /clearHalfW:\s*half \+ ROAD_COLLIDER_CLEAR/.test(trackSrc),
  "wide ROAD_VERGE clear left rock/env in the mouth then snapped to a tight tube"
);
check(
  "mouth drive floor narrower than hillside plant zone",
  /driveHalfLat/.test(trackSrc) && /_tunnelMouthHit/.test(trackSrc),
  "oversized prism planted hillsides in a trench"
);
check(
  "props refuse tunnel mouth corridor",
  /_ribbonClear[\s\S]{0,220}_inTunnelMouthCorridor/.test(trackSrc),
  "rocks/dunes must not sit in the horseshoe"
);
check(
  "bore lining never camera-fades",
  /tunnelBoreLining[\s\S]{0,80}cameraFade\s*=\s*false|cameraFade\s*=\s*false[\s\S]{0,80}tunnelBoreLining/.test(
    trackSrc
  ) || /bores\.userData\.cameraFade\s*=\s*false/.test(trackSrc),
  "fading the lining reads as clipping through rock"
);
check(
  "mouth land prisms registered early",
  /_tunnelMouthPrisms/.test(trackSrc) &&
    /_registerTunnelMouthPrism/.test(trackSrc) &&
    /_markTunnelRuns[\s\S]{0,600}_registerTunnelMouthPrism/.test(trackSrc),
  "prisms must exist before land tiles"
);
check(
  "mouth land prism reaches deep into bore",
  /along0:\s*-78/.test(trackSrc),
  "shallow prism left a sand cliff across the opening"
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
  "interior lining meets mouth throat (continuous bore)",
  /wallStart/.test(trackSrc) && /start \+ 2/.test(trackSrc) && !/start \+ 8/.test(
    trackSrc.slice(trackSrc.indexOf("_addTunnelRun"), trackSrc.indexOf("_tunnelShade"))
  ),
  "lining must start immediately after the mouth — start+8 left a sky gap"
);
check(
  "entrance + exit collider scrub widened",
  /tunStart - 72/.test(trackSrc) && /tunEnd \+ 72/.test(trackSrc),
  "ribbon scrub must cover both mouths"
);
check(
  "portal openH scales with road width",
  /_tunnelOpenHeight/.test(trackSrc),
  "dynamic clearance spec"
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
  await goto(cdp, `${server.url}/index.html?v=577&perf=medium`);
  await waitFor(cdp, () => evaluate(cdp, () => !!window.game), 20000).catch(() => null);

  try {
    await clickSelector(cdp, "#btn-play, .btn-play, [data-action=play]");
  } catch {
    /* title may already be racing */
  }
  await new Promise((r) => setTimeout(r, 2500));

  const probe = await evaluate(cdp, () => {
    const g = window.game;
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
    let masses = 0;
    let hillsides = 0;
    let liners = 0;
    let rings = 0;
    let boxPieces = 0;
    let floaters = 0;
    const THREE = window.THREE;
    const box = THREE ? new THREE.Box3() : null;
    for (let i = 0; i < portals.length; i++) {
      portals[i].traverse((m) => {
        if (!m.isMesh) return;
        if (m.userData.portalMountainMass) masses += 1;
        if (m.userData.portalHillside) hillsides += 1;
        if (m.userData.portalBoreLiner) liners += 1;
        if (m.userData.portalMouthRing) rings += 1;
        if (
          m.userData.portalSolidWing ||
          m.userData.portalSolidLintel ||
          m.userData.portalSolidCheek ||
          m.userData.portalQuarryBench
        ) {
          boxPieces += 1;
        }
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
          !m.userData.portalBoreLiner &&
          !m.userData.portalMouthRing &&
          !m.userData.portalMountainMass &&
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
      masses,
      hillsides,
      liners,
      rings,
      boxPieces,
      floaters,
      apronClear
    };
  });

  if (!probe || !probe.ok) {
    check("headed probe", false, (probe && probe.reason) || "probe failed");
  } else {
    check("tunnel start near climb", probe.startDist > 1100 && probe.startDist < 1450, `at ${probe.startDist}`);
    check("mouth prisms present", probe.prisms >= 2, `count=${probe.prisms}`);
    check("portal groups for enter+exit", probe.portals >= 2, `count=${probe.portals}`);
    check("mountain mass present", probe.masses >= 2, `masses=${probe.masses}`);
    check("no stacked box pieces", probe.boxPieces === 0, `boxPieces=${probe.boxPieces}`);
    check("hillside shells present", probe.hillsides >= 4, `hillsides=${probe.hillsides}`);
    check("mouth rings present", probe.rings >= 2, `rings=${probe.rings}`);
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
