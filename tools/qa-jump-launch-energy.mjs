#!/usr/bin/env node
/**
 * qa-jump-launch-energy.mjs — leave vy is v·sin(θ) plus bounded spring.
 *
 * RUN: node tools/qa-jump-launch-energy.mjs
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const jumpUrl = pathToFileURL(path.join(ROOT, "js/physics/jump.js")).href + "?v=energy";

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`JUMP LAUNCH ENERGY  ·  ${new Date().toISOString()}\n`);

const { JumpModel } = await import(jumpUrl);
const theta = (10 * Math.PI) / 180;
const hop = new JumpModel();

function leave(speed, spring = 0, extra = {}) {
  hop.reset();
  hop.technique = 0;
  return hop.launch(speed * Math.sin(theta), theta, spring, {
    speed,
    dist: 220,
    lateral: 0,
    ...extra,
  });
}

const v20 = leave(20);
const v40 = leave(40);
const v60 = leave(60);
const ball20 = 20 * Math.sin(theta);
const ball40 = 40 * Math.sin(theta);
const sprung = leave(40, 80);
const throwA = leave(40, 0, { jumpThrow: 2.2, jumpLip: 2.4 });
const throwB = leave(40, 0, { jumpThrow: 0.5, jumpLip: 0.5 });

check("20 m/s 10° ≈ v sin θ", Math.abs(v20 - ball20) < 0.08, `got=${v20.toFixed(3)} want=${ball20.toFixed(3)}`);
check("40 m/s is ~2× 20 m/s", Math.abs(v40 / v20 - 2) < 0.08, `ratio=${(v40 / v20).toFixed(3)}`);
check("60 m/s is ~3× 20 m/s", Math.abs(v60 / v20 - 3) < 0.12, `ratio=${(v60 / v20).toFixed(3)}`);
check("huge spring still ≤ 18% over ballistic", sprung <= ball40 * 1.181, `ball=${ball40.toFixed(3)} sprung=${sprung.toFixed(3)}`);
check("jumpThrow / jumpLip do not add energy", Math.abs(throwA - throwB) < 0.04, `a=${throwA.toFixed(3)} b=${throwB.toFixed(3)}`);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "leave energy is v·sin(θ)"}`);
process.exit(fail ? 1 : 0);
