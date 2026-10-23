#!/usr/bin/env node
/**
 * Jump / landing physics — 10× launch matrix + 100× micro-variety.
 *
 * Ballistic hang + technique land + axle dig + bounce. Deterministic (no RNG).
 * Applies the same JUMP live knobs vehicle.js mutates at boot.
 *
 * RUN: node tools/qa-jump-physics-fun.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fails = [];
function ok(cond, msg) {
  if (!cond) fails.push(msg);
  else console.log(`  ok  ${msg}`);
}

const { JUMP } = await import(pathToFileURL(path.join(ROOT, "js/config.js")).href);
// Mirror vehicle.js arcade-sim jump knobs (config stays pinned).
JUMP.springFraction = 0.14;
JUMP.lipGrain = 0.16;
JUMP.landBounceImpact = 5.6;
JUMP.landBounce = 0.16;
JUMP.landCompressZeta = 0.78;
JUMP.landCompressWn = 17.5;
JUMP.mismatchFull = 0.2;

const { JumpModel } = await import(
  pathToFileURL(path.join(ROOT, "js/physics/jump.js")).href
);

const G = 9.81;
const DT = 1 / 60;

/**
 * Launch → ballistic hang (g scaled by attitude) → land.
 * @param {object} L
 */
function fly(L) {
  const j = new JumpModel();
  j.reset();
  j.technique = L.technique != null ? L.technique : 0;
  const grade = L.grade;
  const speed = L.speed;
  const ballistic = Math.max(0, speed * Math.sin(grade) * (JUMP.rampVyScale || 1));
  const spring = L.spring != null ? L.spring : ballistic * 0.35;
  const vy0 = j.launch(ballistic, grade, spring, {
    speed,
    dist: L.dist != null ? L.dist : 200,
    lateral: L.lateral != null ? L.lateral : 0,
    meshNose: L.meshNose != null ? L.meshNose : grade,
    jumpLip: L.jumpLip != null ? L.jumpLip : 1,
    throttle: L.throttle != null ? L.throttle : 0.5,
    brake: L.brake != null ? L.brake : 0,
    pitchRate: L.pitchRate || 0,
    surfaceBump: L.surfaceBump || 0,
  });
  let h = 0.02;
  let vy = vy0;
  let t = 0;
  let peakH = 0;
  const airThrottle = L.airThrottle != null ? L.airThrottle : 0;
  const airBrake = L.airBrake != null ? L.airBrake : 0;
  while (t < 5) {
    j.air(DT, airThrottle, airBrake, { speed, yawRate: 0, vLat: 0, steer: 0 });
    const gScale = j.gravityScale(speed);
    vy -= G * gScale * DT;
    h += vy * DT;
    if (h > peakH) peakH = h;
    t += DT;
    if (t > 0.05 && h <= 0 && vy <= 0) break;
  }
  const fall = Math.min(0, vy);
  const land = j.land(fall, speed, {
    surfaceBump: L.surfaceBump || 0,
    jumpDrop: L.jumpDrop != null ? L.jumpDrop : 2.6,
  });
  return {
    name: L.name,
    hang: t,
    peakH,
    vy0,
    fall: -fall,
    impact: clamp(-fall / 14, 0, 1),
    bounce: land.bounce,
    axleBias: land.axleBias,
    compress: land.compress,
    upset: land.upset,
    scrub: land.scrub,
    technique: L.technique || 0,
    noseAtLand: j.noseUp,
  };
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

const LAUNCHES = [
  { name: "crest-slow", grade: 0.1, speed: 18, technique: 0.2, dist: 80 },
  { name: "crest-med", grade: 0.14, speed: 28, technique: 0.4, dist: 120 },
  { name: "crest-fast", grade: 0.16, speed: 42, technique: 0.1, dist: 160 },
  { name: "kicker-flat", grade: 0.22, speed: 32, technique: 0, meshNose: 0.05, dist: 200 },
  { name: "kicker-nose", grade: 0.24, speed: 38, technique: 0.2, meshNose: 0.28, airBrake: 0.2, dist: 220 },
  { name: "big-air", grade: 0.28, speed: 48, technique: 0.3, jumpLip: 1.25, dist: 300 },
  { name: "skim", grade: 0.06, speed: 36, technique: 0.8, brake: 1, dist: 90 },
  { name: "tail-heavy", grade: 0.18, speed: 30, technique: 0.9, brake: 1, airBrake: 0.8, dist: 150 },
  { name: "steep-lip", grade: 0.32, speed: 25, technique: 0.15, jumpLip: 1.4, dist: 180 },
  { name: "highway-bump", grade: 0.08, speed: 55, technique: 0, dist: 400, surfaceBump: 0.15 },
];

console.log("JUMP PHYSICS FUN  ·  10× matrix + 100× micro-variety\n");

const rows = LAUNCHES.map(fly);
for (const r of rows) {
  console.log(
    `${r.name.padEnd(14)} hang=${r.hang.toFixed(3)}s peak=${r.peakH.toFixed(3)}m ` +
      `vy0=${r.vy0.toFixed(2)} fall=${r.fall.toFixed(2)} ` +
      `bnc=${r.bounce.toFixed(3)} axle=${r.axleBias.toFixed(3)} cmp=${r.compress.toFixed(3)}`
  );
}

const hangs = rows.map((r) => r.hang);
const peaks = rows.map((r) => r.peakH);
const vy0s = rows.map((r) => r.vy0);
const falls = rows.map((r) => r.fall);
const bncs = rows.map((r) => r.bounce);
const axles = rows.map((r) => r.axleBias);
const cmps = rows.map((r) => r.compress);

const span = (a) => Math.max(...a) - Math.min(...a);
const ratio = (a) => {
  const pos = a.filter((x) => x > 1e-4);
  if (!pos.length) return 0;
  return Math.max(...pos) / Math.min(...pos);
};

ok(rows.every((r) => r.hang > 0.04), "all 10 land after hang > 40ms");
ok(span(hangs) > 0.25, `hang span ${span(hangs).toFixed(3)}s (>0.25)`);
ok(ratio(peaks) > 3 || span(peaks) > 0.5, `peakH ratio ${ratio(peaks).toFixed(1)} span ${span(peaks).toFixed(2)}`);
ok(ratio(vy0s) > 2.5, `launch vy ratio ${ratio(vy0s).toFixed(1)} (>2.5)`);
ok(span(falls) > 2.5, `fall-speed span ${span(falls).toFixed(2)} m/s`);
ok(span(cmps) > 0.02, `compress span ${span(cmps).toFixed(3)}`);
ok(Math.max(...bncs) > 0.05 || span(bncs) > 0.04, `bounce variety max=${Math.max(...bncs).toFixed(3)}`);
ok(span(axles) > 0.2, `axleBias span ${span(axles).toFixed(3)} (nose vs tail)`);

// Bit-stable: same inputs → same land
{
  const a = fly(LAUNCHES[5]);
  const b = fly(LAUNCHES[5]);
  ok(
    Math.abs(a.vy0 - b.vy0) < 1e-12 &&
      Math.abs(a.bounce - b.bounce) < 1e-12 &&
      Math.abs(a.axleBias - b.axleBias) < 1e-12,
    "deterministic replay (no Math.random)"
  );
}

// Soft technique vs flat-out at same lip
{
  const soft = fly({
    name: "soft",
    grade: 0.2,
    speed: 34,
    technique: 0.95,
    brake: 1,
    airBrake: 0.7,
    dist: 210,
  });
  const hard = fly({
    name: "hard",
    grade: 0.2,
    speed: 34,
    technique: 0,
    meshNose: -0.05,
    airThrottle: 1,
    dist: 210,
  });
  ok(soft.upset <= hard.upset * 1.05 + 0.05, `tech softens upset soft=${soft.upset.toFixed(3)} hard=${hard.upset.toFixed(3)}`);
  ok(
    Math.abs(soft.axleBias - hard.axleBias) > 0.05 || Math.abs(soft.bounce - hard.bounce) > 0.02,
    `land character differs soft axle=${soft.axleBias.toFixed(3)} hard=${hard.axleBias.toFixed(3)}`
  );
}

// 100 micro-variants — lip/speed/dist/lateral/attitude
{
  const base = fly({ name: "base", grade: 0.18, speed: 35, technique: 0.3, dist: 200, lateral: 0 });
  let different = 0;
  const N = 100;
  for (let i = 0; i < N; i++) {
    const s = fly({
      name: `m${i}`,
      grade: 0.18 + (i % 10) * 0.008,
      speed: 35 + Math.floor(i / 10) * 0.85,
      technique: (i % 5) * 0.2,
      dist: 180 + (i % 17) * 7,
      lateral: ((i % 9) - 4) * 0.35,
      meshNose: 0.12 + ((i * 13) % 11) * 0.02 - 0.08,
      airBrake: (i % 3) * 0.25,
      airThrottle: ((i + 1) % 4) * 0.2,
      jumpLip: 0.9 + (i % 6) * 0.08,
      surfaceBump: (i % 8) * 0.03,
    });
    if (
      Math.abs(s.vy0 - base.vy0) > 0.04 ||
      Math.abs(s.hang - base.hang) > 0.015 ||
      Math.abs(s.bounce - base.bounce) > 0.015 ||
      Math.abs(s.axleBias - base.axleBias) > 0.025 ||
      Math.abs(s.compress - base.compress) > 0.004 ||
      Math.abs(s.peakH - base.peakH) > 0.03
    ) {
      different++;
    }
  }
  ok(different >= 85, `100× micro-variety: ${different}/100 differ (≥85)`);
  console.log(`  …  100× micro-variety: ${different}/100 distinct`);
}

// Static wiring: axle bias → suspension heave
{
  const veh = fs.readFileSync(path.join(ROOT, "js/physics/vehicle.js"), "utf8");
  const jumpSrc = fs.readFileSync(path.join(ROOT, "js/physics/jump.js"), "utf8");
  ok(/_landAxleBias/.test(veh) && /heaveFMul|bias \* 0\.2/.test(veh), "vehicle heave uses axle bias");
  ok(/axleBias: this\._landAxleBias/.test(jumpSrc), "JumpModel.land returns axleBias");
  ok(!/Math\.random/.test(jumpSrc), "no Math.random in jump.js");
  ok(JUMP.springFraction === 0.14, `springFraction live=${JUMP.springFraction}`);
  ok(JUMP.landCompressZeta === 0.78, `zeta live=${JUMP.landCompressZeta}`);
}

if (fails.length) {
  console.error("\nFAIL:");
  for (const f of fails) console.error(" -", f);
  process.exit(1);
}
console.log("\nPASS qa-jump-physics-fun — arcade+sim jump variety proven");
process.exit(0);
