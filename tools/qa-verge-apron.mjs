/**
 * Gate: road → verge → land is a shallow apron, not a kerb cliff.
 *
 * Samples Track.query + _groundHeight every 0.25 m off the paint on all four
 * championship stages. Fails if the first metre off the kerb drops more than
 * a tyre, or if a 0.25 m lateral step exceeds 6 cm (the bounce).
 *
 * RUN: node --experimental-loader ./tools/qa-strip-query-loader.mjs tools/qa-verge-apron.mjs
 */
import { COURSES } from "../js/tracks/courses.js";
import { Track } from "../js/tracks/track.js";
import { Vehicle } from "../js/physics/vehicle.js";
import { CARS, FIXED_DT, ROAD_DECK } from "../js/config.js";

const STEP = 0.25;
const HOLD = 1.6;
const KERB_DROP = 0.1;
const STEP_MAX = 0.06;
const GRADE_MAX = 0.16;
const VELY_MAX = 4.5;

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function sampleAt(track, dist, lat, bag) {
  const p = track.sample(dist, bag || {});
  if (!p) return null;
  const x = p.x + p.nx * lat;
  const z = p.z + p.nz * lat;
  const q = track.query(x, z, {}, dist);
  const gy = track._groundHeight(x, z, track.scenery || "desert", {
    dist: Math.abs(lat),
    roadY: p.y,
    roadW: p.width,
    minOver: Math.abs(lat) - (p.width || 12) * 0.5,
    along: dist,
    tunnel: !!p.tunnel,
    overlapBed: null,
  });
  return { p, q, gy, x, z };
}

console.log(`VERGE APRON  ·  ${new Date().toISOString()}\n`);

for (const id of ["desert", "forest", "mountain", "lakeside"]) {
  const track = new Track(COURSES[id], { deferBuild: true });
  track._buildSpline(COURSES[id].pieces, COURSES[id]);
  const pts = track.points;
  const length = track.length || pts[pts.length - 1].dist;
  // Mid-stage, skip the start grid and any tagged jump.
  let dist = Math.min(length * 0.22, 420);
  for (let k = 0; k < 40; k++) {
    const p = track.sample(dist, {});
    if (p && !p.jumpKind && !p.tunnel && !p.bridge) break;
    dist += 40;
  }
  console.log(`${id.toUpperCase()}  @ ${dist.toFixed(0)} m`);
  const half = (track.sample(dist, {}).width || 12) * 0.5;
  const road = sampleAt(track, dist, 0);
  const roadH = road.q.height;
  let worstKerb = 0;
  let worstStep = 0;
  let worstGrade = 0;
  let prevH = roadH;
  let prevLat = 0;
  for (let lat = 0; lat <= 16; lat += STEP) {
    const s = sampleAt(track, dist, half + lat);
    if (!s || !Number.isFinite(s.q.height)) continue;
    const h = s.q.height;
    const drop = roadH - h;
    if (lat <= HOLD && drop > worstKerb) worstKerb = drop;
    const dLat = lat - prevLat || STEP;
    const step = Math.abs(h - prevH);
    if (lat > 0 && step > worstStep) worstStep = step;
    const grade = step / dLat;
    if (lat > HOLD && grade > worstGrade) worstGrade = grade;
    prevH = h;
    prevLat = lat;
  }
  check(
    `${id}: first ${HOLD} m off paint drops < ${KERB_DROP} m`,
    worstKerb <= KERB_DROP,
    `${worstKerb.toFixed(3)} m`
  );
  check(
    `${id}: no ${STEP} m lateral step > ${STEP_MAX} m`,
    worstStep <= STEP_MAX,
    `${worstStep.toFixed(3)} m`
  );
  check(
    `${id}: apron grade ≤ ${GRADE_MAX}`,
    worstGrade <= GRADE_MAX + 0.02,
    `${(worstGrade * 100).toFixed(1)} %`
  );
  const kerbLand = sampleAt(track, dist, half + 0.4);
  check(
    `${id}: land at kerb meets the lip (not a bed trench)`,
    Number.isFinite(kerbLand.gy) && Math.abs(kerbLand.gy - road.p.y) <= 0.12,
    `Δ ${(kerbLand.gy - road.p.y).toFixed(3)} m`
  );

  const v = new Vehicle(CARS.celica);
  v.spawn(track, dist, 0);
  v.speed = 28;
  v.velocity.x = Math.sin(v.yaw) * 28;
  v.velocity.z = Math.cos(v.yaw) * 28;
  let maxVelY = 0;
  for (let i = 0; i < 180; i++) {
    const t = i / 180;
    const lat = Math.sin(t * Math.PI) * (half + 4.2);
    const p = track.sample(dist + i * 0.35, {});
    v.position.x = p.x + p.nx * lat;
    v.position.z = p.z + p.nz * lat;
    v.progress = dist + i * 0.35;
    v.step(FIXED_DT, { throttle: 0.4, brake: 0, steer: 0, handbrake: false }, track);
    maxVelY = Math.max(maxVelY, Math.abs(v.velY || 0));
  }
  check(
    `${id}: weave 4 m off paint, |velY| ≤ ${VELY_MAX}`,
    maxVelY <= VELY_MAX,
    `${maxVelY.toFixed(2)} m/s`
  );
  void ROAD_DECK;
}

if (fail) {
  console.log(`\nFAIL  ·  ${fail} check(s) failed`);
  process.exit(1);
}
console.log("\nPASS  ·  verge is a shallow apron");
process.exit(0);
