#!/usr/bin/env node
/**
 * QA — TrackDefinition compile + world geometry rules (no browser).
 *
 * WHO THIS IS FOR: CI / Cursor after stage authoring changes.
 * WHAT IT DOES: Compiles Mountain showcase, checks rhythm requirements,
 *   builds tunnel volumes, runs validator on a conformed mock spline.
 */

import { COURSES } from "../js/tracks/courses.js";
import { describeTrackRhythm } from "../js/tracks/track-definition.js";
import { MOUNTAIN_DEFINITION } from "../js/tracks/stages/mountain-definition.js";
import { buildTunnelVolumes } from "../js/tracks/tunnel-volume.js";
import {
  validateWorldGeometry,
  formatGeomReport,
} from "../js/tracks/world-geometry-validator.js";
import { shoulderPadForScenery } from "../js/tracks/track-clearance.js";

let failed = 0;
function check(name, cond) {
  if (cond) console.log(`PASS  ${name}`);
  else {
    console.error(`FAIL  ${name}`);
    failed++;
  }
}

const d = COURSES.desert;
const f = COURSES.forest;
const m = COURSES.mountain;
check("desert authoredFrom TrackDefinition", d.authoredFrom === "TrackDefinition");
check("forest authoredFrom TrackDefinition", f.authoredFrom === "TrackDefinition");
check("mountain authoredFrom TrackDefinition", m.authoredFrom === "TrackDefinition");
check("desert has no tunnel (Saturn Desert is open safari)", !d.pieces.some((p) => p.tunnel));
check("desert has bumps/jumps", d.pieces.filter((p) => p.type === "jump").length >= 2);
check("desert ≥1 checkpoint", d.pieces.filter((p) => p.checkpoint).length >= 1);
check("forest has the rock tunnel", f.pieces.some((p) => p.tunnel));
check("forest has the killer hairpin", f.pieces.some((p) => p.type === "curve" && Math.abs(p.angle) > 150));
check("forest ≥2 checkpoints", f.pieces.filter((p) => p.checkpoint).length >= 2);
check("mountain 3 checkpoint flags", m.pieces.filter((p) => p.checkpoint).length === 3);
check("mountain has no desert-style tunnel", !m.pieces.some((p) => p.tunnel));
check("mountain starts in the village", m.pieces[0] && m.pieces[0].surface === "cobble");

const kinds = describeTrackRhythm(MOUNTAIN_DEFINITION).map((r) => r.kind);
check("has hairpin", kinds.includes("hairpin"));
check("has tight_corner", kinds.includes("tight_corner"));

check("desert clearance pad", shoulderPadForScenery("desert") >= 16);
check("mountain clearance pad", shoulderPadForScenery("mountain") >= 13);

// Mock spline: road sits on ground except intentional jump float.
const points = [];
let dist = 0;
for (let i = 0; i < 40; i++) {
  const tunnel = i >= 20 && i <= 28;
  const jump = i === 12;
  points.push({
    x: i * 3,
    y: tunnel ? 4 : jump ? 8 : 2,
    z: 0,
    width: 9,
    dist,
    tunnel,
    jump,
    jumpKind: jump ? "gap" : null,
  });
  dist += 3.2;
}
const vols = buildTunnelVolumes(points);
check("tunnel volumes detected", vols.length === 1);
check("tunnel volume span", vols[0].dist1 > vols[0].dist0);

const trackMock = {
  points,
  length: dist,
  _def: { scenery: "mountain" },
  _groundHeight(x, z) {
    return 2; // conformed bed
  },
};
const report = validateWorldGeometry(trackMock, { sampleStep: 1, floatTol: 2.8 });
check("mock road not floating (non-jump)", report.stats.floatRoad === 0);
check("validator ok on conformed mock", report.ok);
console.log(formatGeomReport(report));

// Floating mock should fail
const bad = {
  points: [{ x: 0, y: 12, z: 0, width: 9, dist: 0, tunnel: false }],
  length: 400,
  _def: { scenery: "mountain" },
  _groundHeight: () => 2,
};
const badReport = validateWorldGeometry(bad, { sampleStep: 1 });
check("detects floating road", !badReport.ok && badReport.errors.some((e) => e.code === "FLOATING_ROAD"));

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll world-geometry QA checks passed.");
