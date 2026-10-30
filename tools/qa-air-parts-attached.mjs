#!/usr/bin/env node
/**
 * qa-air-parts-attached.mjs — car parts never leave the hull in mid air.
 *
 * Player moment: Desert Safari jump / any crest. Wheels, arches, glass and the
 * rest of the shell fly as ONE rigid body. A hub may hang a few cm below its
 * rest pose; it must never follow the road under the jump.
 *
 * (a) static: the clamp contract exists in js/cars/celica.js + every call site
 *     feeds `airborne`, rivals share the same function, replay paths too.
 * (b) numeric (headless node): drive the real `applyWheelPose` over a rig with
 *     the real car topology (hubs under a pitched / rolled root) for airborne
 *     poses, onGround-but-unsupported poses (crest / lip / replay), partial
 *     probes and hostile suspension travel, and assert every hub stays within
 *     TOL of the airborne hang. Grounded poses must stay inside the shock
 *     stroke limits (grounded feel is not changed by this gate).
 *
 * Tolerance: AIR_TOL = airHang (0.05 m) + 1 mm float slack. 5 cm is under the
 * arch gap of the Celica GLB; anything above reads as a detached tire at the
 * chase camera (3–6 m). Fixture hub meshes are a test-only bounding proxy, never
 * shipped geometry.
 *
 * RUN: node tools/qa-air-parts-attached.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`AIR PARTS ATTACHED  ·  ${new Date().toISOString()}\n`);
console.log("static");

const celica = read("js/cars/celica.js");
const game = read("js/game.js");
const ai = read("js/ai.js");

check("WHEEL_TRAVEL_LIMITS exported + frozen", /export const WHEEL_TRAVEL_LIMITS = Object\.freeze\(/.test(celica));
check("air hang is bounded constant", /airHang:\s*0\.0\d+/.test(celica));
check(
  "in-air hub y derives from rest pose, not road",
  /inAir || noRoad \? data\.restPosY - AIR_HANG/.test(celica)
);
check(
  "hub y hard-clamped to stroke limits",
  /restPosY \+ Math\.max\(-WHEEL_TRAVEL_LIMITS\.maxDown, Math\.min\(WHEEL_TRAVEL_LIMITS\.maxUp/.test(celica)
);
check(
  "unsupported road (beyond one stroke + slack) hangs the hub",
  /const beyond = -\(delta - sag\) - droop/.test(celica) &&
    /restPosY - WHEEL_TRAVEL_LIMITS\.airHang/.test(celica)
);
check("road chase skipped in flight", /const chasing = \(data\._flight \|\| 0\) < 0\.35/.test(celica));
check("all-NaN probes count as air", /probedAir/.test(celica));
check(
  "player live path passes !onGround",
  /applyWheelPose\([\s\S]{0,260}!p\.onGround\s*\)/.test(game)
);
check(
  "player broadcast-replay path passes airborne",
  /applyWheelPose\([\s\S]{0,260}!\(this\.player && this\.player\.onGround\)/.test(game)
);
check("rival live path shares applyWheelPose + airborne", /!\(this\.vehicle && this\.vehicle\.onGround\)/.test(ai));
check("rival replay path shares applyWheelPose + airborne", /!\(v && v\.onGround\)/.test(ai));

// Cache-bust lockstep: one version per module across the graph.
const main = read("js/main.js");
const index = read("index.html");
const gameV = (main.match(/game\.js\?v=(\d+)/) || [])[1];
const mainV = (index.match(/main\.js\?v=(\d+)/) || [])[1];
check("boot cache lockstep", !!gameV && gameV === mainV, `main=${mainV} game=${gameV}`);

console.log("\nnumeric (headless)");
register("./qa-strip-query-loader.mjs", import.meta.url);
const THREE = await import("../vendor/three.module.js");
let celicaMod = null;
try {
  celicaMod = await import("../js/cars/celica.js");
} catch (err) {
  check("celica.js imports headless", false, err && err.message ? err.message : String(err));
}

if (celicaMod && celicaMod.applyWheelPose && celicaMod.WHEEL_TRAVEL_LIMITS) {
  const { applyWheelPose, WHEEL_TRAVEL_LIMITS: L } = celicaMod;
  const AIR_TOL = L.airHang + 0.001;
  const GROUND_DOWN = L.maxDown + 0.001;
  const GROUND_UP = L.maxUp + 0.001;
  const AXLE = L.maxAlongAxle + 0.001;

  /** Hub layout matches the Celica GLB: +X side first, fronts first. */
  const HUBS = [
    { x: 0.8, z: 1.28, front: true, side: 1 },
    { x: -0.8, z: 1.28, front: true, side: -1 },
    { x: 0.8, z: -1.28, front: false, side: 1 },
    { x: -0.8, z: -1.28, front: false, side: -1 },
  ];

  function buildRig() {
    const root = new THREE.Object3D();
    root.userData.wheels = [];
    for (const h of HUBS) {
      const hub = new THREE.Object3D();
      hub.position.set(h.x, 0.3, h.z);
      hub.userData.front = h.front;
      hub.userData.side = h.side;
      // Bounding proxy only: gives hubWorldBottom a tread (r = 0.32 m).
      const tread = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.64, 0.64), new THREE.MeshBasicMaterial());
      hub.add(tread);
      root.add(hub);
      root.userData.wheels.push(hub);
    }
    const scene = new THREE.Scene();
    scene.add(root);
    // Seed rest pose on a level, grounded frame (what the game does on spawn).
    root.position.set(0, 0.3, 0);
    root.updateMatrixWorld(true);
    applyWheelPose(root.userData.wheels, [0, 0, 0, 0], 0, 0, null, 0, null, null, false);
    return root;
  }

  const rootRig = buildRig();
  const wheels = rootRig.userData.wheels;
  const spin = [0, 0, 0, 0];

  /** Max |hub - rest| per axis across the four hubs. */
  function offsets() {
    let down = 0;
    let up = 0;
    let axle = 0;
    for (const w of wheels) {
      const d = w.userData;
      const dy = w.position.y - d.restPosY;
      down = Math.max(down, -dy);
      up = Math.max(up, dy);
      axle = Math.max(axle, Math.abs(w.position.x - d.restPosX), Math.abs(w.position.z - d.restPosZ));
    }
    return { down, up, axle };
  }

  function pose(y, pitch, roll) {
    rootRig.position.set(0, y, 0);
    rootRig.rotation.set(pitch, 0, roll, "YXZ");
    rootRig.updateMatrixWorld(true);
  }

  const rand = (() => {
    let s = 0x9e3779b9;
    return () => {
      s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x7f4a7c15) | 0;
      return ((s >>> 0) % 100000) / 100000;
    };
  })();

  // 1) Flag-driven flight: any attitude, hostile travel, road wherever.
  let worstAir = 0;
  let worstAxle = 0;
  let n1 = 0;
  for (let i = 0; i < 4000; i++) {
    const pitch = (rand() - 0.5) * 0.9;
    const roll = (rand() - 0.5) * 0.8;
    pose(1 + rand() * 6, pitch, roll);
    const travel = [0, 0, 0, 0].map(() => (rand() - 0.5) * 0.6);
    const dropOk = [true, true, true, true];
    const road = [0, 0, 0, 0].map(() => (rand() < 0.3 ? NaN : rootRig.position.y - rand() * 6));
    applyWheelPose(wheels, spin, (rand() - 0.5) * 0.8, roll, travel, rand() * 0.06, dropOk, road, true);
    const o = offsets();
    worstAir = Math.max(worstAir, o.down, o.up);
    worstAxle = Math.max(worstAxle, o.axle);
    n1++;
  }
  check(
    "flag airborne: hubs stay at hang",
    worstAir <= AIR_TOL && worstAxle <= 1e-6,
    `${n1} poses, worst ${(worstAir * 1000).toFixed(1)} mm (tol ${(AIR_TOL * 1000).toFixed(1)}), axle ${(worstAxle * 1000).toFixed(2)} mm`
  );

  // 2) Probe-only flight: all corner probes NaN, caller said onGround.
  let worstProbe = 0;
  for (let i = 0; i < 2000; i++) {
    const pitch = (rand() - 0.5) * 0.9;
    const roll = (rand() - 0.5) * 0.8;
    pose(1 + rand() * 6, pitch, roll);
    const travel = [0, 0, 0, 0].map(() => (rand() - 0.5) * 0.6);
    applyWheelPose(wheels, spin, 0, roll, travel, 0.06, [true, true, true, true], [NaN, NaN, NaN, NaN], false);
    const o = offsets();
    worstProbe = Math.max(worstProbe, o.down, o.up);
  }
  check("all-NaN probes: hubs stay at hang", worstProbe <= AIR_TOL, `worst ${(worstProbe * 1000).toFixed(1)} mm`);

  // 3) onGround flag lies (crest / lip / replay): road sampled below the hull.
  //    The hull is level here so road-chase is legal ONLY while the road is
  //    within one stroke of the tread; beyond that the hub must hang.
  let worstLie = 0;
  let worstLieNear = 0;
  let nFar = 0;
  for (let i = 0; i < 4000; i++) {
    const level = rand() < 0.5;
    const pitch = level ? 0 : (rand() - 0.5) * 0.2;
    const roll = level ? 0 : (rand() - 0.5) * 0.2;
    pose(0.3 + rand() * 4, pitch, roll);
    // Tread bottom sits ~0.02 m under the root origin; roadDrop = gap under it.
    const roadDrop = rand() < 0.5 ? rand() * 0.19 : 0.23 + rand() * 4;
    const road = [0, 1, 2, 3].map(() => rootRig.position.y - 0.02 - roadDrop);
    const travel = [0, 0, 0, 0].map(() => rand() * 0.2);
    applyWheelPose(wheels, spin, 0, roll, travel, 0.03, [true, true, true, true], road, false);
    const o = offsets();
    if (roadDrop > 0.22 + Math.abs(pitch) * 1.4 + Math.abs(roll) * 0.9) {
      nFar++;
      worstLie = Math.max(worstLie, o.down, o.up);
    } else if (roadDrop < 0.19 && Math.abs(pitch) < 0.01 && Math.abs(roll) < 0.01) {
      worstLieNear = Math.max(worstLieNear, o.down);
    }
  }
  check(
    "onGround lies with road out of reach: hubs hang",
    nFar > 100 && worstLie <= AIR_TOL,
    `${nFar} poses, worst ${(worstLie * 1000).toFixed(1)} mm (tol ${(AIR_TOL * 1000).toFixed(1)})`
  );
  check(
    "onGround, road in reach: hubs stay inside stroke",
    worstLieNear <= GROUND_DOWN,
    `worst ${(worstLieNear * 1000).toFixed(1)} mm (limit ${(GROUND_DOWN * 1000).toFixed(0)})`
  );

  // 4) Partial probes (1–3 NaN) with the hull flying: same bound.
  let worstPartial = 0;
  for (let i = 0; i < 3000; i++) {
    pose(2 + rand() * 4, (rand() - 0.5) * 0.5, (rand() - 0.5) * 0.4);
    const road = [0, 1, 2, 3].map((k) => (k === i % 4 ? NaN : rootRig.position.y - 1.5 - rand() * 3));
    applyWheelPose(wheels, spin, 0, 0, [0.2, 0.2, 0.2, 0.2], 0.04, [true, true, true, true], road, false);
    const o = offsets();
    worstPartial = Math.max(worstPartial, o.down, o.up);
  }
  check("partial probes, hull flying: hubs hang", worstPartial <= AIR_TOL, `worst ${(worstPartial * 1000).toFixed(1)} mm`);

  // 5) Grounded: hostile travel and road, hubs stay inside the authored stroke.
  let gDown = 0;
  let gUp = 0;
  let gAxle = 0;
  for (let i = 0; i < 4000; i++) {
    pose(0.3 + (rand() - 0.5) * 0.3, (rand() - 0.5) * 0.3, (rand() - 0.5) * 0.4);
    const travel = [0, 0, 0, 0].map(() => (rand() - 0.5) * 0.5);
    const road = [0, 1, 2, 3].map(() => (rand() - 0.5) * 0.4);
    applyWheelPose(wheels, spin, 0, rootRig.rotation.z, travel, 0.06, [true, false, true, false], road, false);
    const o = offsets();
    gDown = Math.max(gDown, o.down);
    gUp = Math.max(gUp, o.up);
    gAxle = Math.max(gAxle, o.axle);
  }
  check(
    "grounded: hubs inside stroke limits",
    gDown <= GROUND_DOWN && gUp <= GROUND_UP && gAxle <= AXLE,
    `down ${(gDown * 1000).toFixed(0)} mm / up ${(gUp * 1000).toFixed(0)} mm / axle ${(gAxle * 1000).toFixed(0)} mm`
  );

  // 6) Level grounded rest: no regression, hub sits at rest + lift.
  pose(0.02, 0, 0);
  applyWheelPose(wheels, spin, 0, 0, null, 0, null, [0, 0, 0, 0], false);
  const rest = offsets();
  check("level rest pose unchanged (≤ 10 mm)", rest.down <= 0.01 && rest.up <= 0.01, `down ${(rest.down * 1000).toFixed(1)} up ${(rest.up * 1000).toFixed(1)} mm`);
}

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "airborne parts are rigidly attached"}`);
process.exit(fail ? 1 : 0);
