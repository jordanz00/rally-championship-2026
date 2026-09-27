#!/usr/bin/env node
/**
 * qa-lane-floor.mjs — no fake wall on any roadway.
 *
 * A fake wall is ground, or the drive query, more than 1.6 m above the
 * ribbon the sample is actually on. Centre and both edges, every stage.
 *
 * RUN: node --experimental-loader ./tools/qa-strip-query-loader.mjs tools/qa-lane-floor.mjs
 */
import { COURSES } from "../js/tracks/courses.js";
import { Track } from "../js/tracks/track.js";

const IDS = ["desert", "forest", "mountain", "lakeside", "physlab"];
const RISE = 1.6;

/**
 * @param {string} id
 * @returns {{hits: object[], cliffs: number}}
 */
function wallsOn(id) {
  const def = COURSES[id];
  const track = new Track(def, { deferBuild: true });
  track._buildSpline(def.pieces, def);
  const pts = track.points;
  const hits = [];
  let cliffs = 0;
  for (let i = 1; i < pts.length; i++) {
    const ds = pts[i].dist - pts[i - 1].dist;
    if (ds < 0.15) continue;
    const dy = pts[i].y - pts[i - 1].y;
    const grade = dy / ds;
    if (grade > 0.55 || dy > 1.4) {
      cliffs += 1;
      if (hits.length < 6) {
        hits.push({
          kind: "ribbon-step",
          dist: Number(pts[i].dist.toFixed(1)),
          dy: Number(dy.toFixed(2)),
          grade: Number(grade.toFixed(2)),
        });
      }
    }
  }
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.jumpKind === "gap") continue;
    const half = p.width * 0.5;
    const lats = [0, half * 0.5, -half * 0.5, half * 0.92, -half * 0.92];
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    for (let li = 0; li < lats.length; li++) {
      const lat = lats[li];
      const x = p.x + p.nx * lat;
      const z = p.z + p.nz * lat;
      const q = track.query(x, z, {}, p.dist);
      const gy = track._groundHeight(x, z, track.scenery);
      const ahead = track._groundHeight(x + fx * 2.4, z + fz * 2.4, track.scenery);
      const deck = p.y + 0.2;
      const stolen =
        Number.isFinite(q.dist) && Math.abs(q.dist - p.dist) > 40 && q.height > deck + 2.5;
      const bad =
        q.height - deck > RISE || gy - deck > RISE || ahead - Math.max(gy, q.height, deck) > RISE || stolen;
      if (!bad) continue;
      if (hits.length < 12) {
        hits.push({
          kind: stolen ? "stolen-deck" : "floor",
          dist: Number(p.dist.toFixed(1)),
          lat: Number(lat.toFixed(1)),
          qh: Number(q.height.toFixed(2)),
          gy: Number(gy.toFixed(2)),
          deck: Number(deck.toFixed(2)),
        });
      }
    }
  }
  return { hits, cliffs };
}

let fail = 0;
console.log("LANE FLOOR  ·  every stage, centre and both edges\n");
for (let s = 0; s < IDS.length; s++) {
  const id = IDS[s];
  const r = wallsOn(id);
  const lane = r.hits.filter((h) => h.kind !== "ribbon-step");
  if (!lane.length && !r.cliffs) {
    console.log(`  ok  ${id}`);
    continue;
  }
  fail += 1;
  console.log(`  FAIL  ${id}  cliffs=${r.cliffs} lane=${lane.length}`);
  for (let i = 0; i < r.hits.length; i++) console.log("       ", r.hits[i]);
}
if (fail) {
  console.log(`\n${fail} stage(s) still have a roadway wall`);
  process.exit(1);
}
console.log("\nall stages clear");
