#!/usr/bin/env node
/**
 * qa-sprint-matrix.mjs — rerun automated gates for Sprints 1–28.
 *
 * Orchestrates the full headless QA suite and prints a sprint status matrix.
 *
 * RUN: node tools/qa-sprint-matrix.mjs
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const SPRINTS = [
  { id: 1, theme: "Boot + chase foundations", auto: "static + boot smoke" },
  { id: 2, theme: "Stage identity", auto: "boot smoke" },
  { id: 3, theme: "Keep-outs + readability", auto: "static" },
  { id: 4, theme: "Landmark scale", auto: "boot smoke" },
  { id: 5, theme: "Forest drift Acts 5–7", auto: "championship flow" },
  { id: 6, theme: "Mountain drift finale", auto: "championship flow" },
  { id: 7, theme: "Perf + garage + title", auto: "boot smoke" },
  { id: 8, theme: "Co-driver + jump + grid UI", auto: "championship flow" },
  { id: 9, theme: "AI + championship integrity", auto: "advance + grid" },
  { id: 10, theme: "Release matrix + doc sync", auto: "sprint matrix" },
  { id: 11, theme: "Drift sweeps + ruthless closeout", auto: "mountain start + matrix" },
  { id: 12, theme: "Realistic render tier 2", auto: "realistic visual + matrix" },
  { id: 13, theme: "Horizon haze + terrain grain tier 3", auto: "sprint13 visual + matrix" },
  { id: 14, theme: "Aerial depth + hero landmarks tier 4", auto: "sprint14 visual + matrix" },
  { id: 15, theme: "Trackside identity + contact grounding tier 5", auto: "sprint15 visual + matrix" },
  { id: 16, theme: "POV cockpit + contact blobs + occlusion hotfix", auto: "sprint17 visual (regression)" },
  { id: 17, theme: "Chase-cam readability tier 6", auto: "sprint17 visual + matrix" },
  { id: 18, theme: "Championship integrity closeout", auto: "sprint18 championship" },
  { id: 19, theme: "Arcade sense of speed", auto: "sprint19 speed" },
  { id: 20, theme: "Highly realistic level design tier 7", auto: "sprint20 realism" },
  { id: 21, theme: "Authored GLB props & characters", auto: "sprint21 props" },
  { id: 22, theme: "Soft off-road + living crowds", auto: "sprint22 runoff" },
  { id: 23, theme: "Photoreal lighting + post", auto: "sprint23 photoreal" },
  { id: 24, theme: "60fps photoreal + no lag", auto: "sprint24 perf" },
  { id: 25, theme: "UE5-style PBR photoreal", auto: "sprint25 ue5" },
  { id: 26, theme: "Driving integrity + grid plant", auto: "sprint26 driving" },
  { id: 27, theme: "Env realism + rear dirt wake", auto: "sprint27 env" },
  { id: 28, theme: "Launch punch + driveline realism", auto: "sprint28 launch" },
];

const TOOLS = [
  { name: "qa-static-audit", file: "qa-static-audit.mjs", sprints: [1, 3, 10, 11] },
  { name: "qa-boot-smoke", file: "qa-boot-smoke.mjs", sprints: [1, 2, 4, 7, 11] },
  { name: "qa-championship-flow", file: "qa-championship-flow.mjs", sprints: [5, 6, 8, 11] },
  { name: "qa-championship-advance", file: "qa-championship-advance.mjs", sprints: [9] },
  { name: "qa-championship-grid", file: "qa-championship-grid.mjs", sprints: [8, 9, 10] },
  { name: "qa-mountain-start", file: "qa-mountain-start.mjs", sprints: [6, 11] },
  { name: "qa-realistic-visual", file: "qa-realistic-visual.mjs", sprints: [12] },
  { name: "qa-sprint13-visual", file: "qa-sprint13-visual.mjs", sprints: [13, 14] },
  { name: "qa-sprint14-visual", file: "qa-sprint14-visual.mjs", sprints: [14, 15] },
  { name: "qa-sprint15-visual", file: "qa-sprint15-visual.mjs", sprints: [15] },
  { name: "qa-sprint17-visual", file: "qa-sprint17-visual.mjs", sprints: [16, 17] },
  { name: "qa-sprint18-championship", file: "qa-sprint18-championship.mjs", sprints: [18] },
  { name: "qa-sprint19-speed", file: "qa-sprint19-speed.mjs", sprints: [19] },
  { name: "qa-sprint20-realism", file: "qa-sprint20-realism.mjs", sprints: [20] },
  { name: "qa-sprint21-props", file: "qa-sprint21-props.mjs", sprints: [21] },
  { name: "qa-sprint22-runoff", file: "qa-sprint22-runoff.mjs", sprints: [22] },
  { name: "qa-sprint23-photoreal", file: "qa-sprint23-photoreal.mjs", sprints: [23] },
  { name: "qa-sprint24-perf", file: "qa-sprint24-perf.mjs", sprints: [24] },
  { name: "qa-sprint25-ue5", file: "qa-sprint25-ue5.mjs", sprints: [25] },
  { name: "qa-sprint26-driving", file: "qa-sprint26-driving.mjs", sprints: [26] },
  { name: "qa-sprint27-env", file: "qa-sprint27-env.mjs", sprints: [27] },
  { name: "qa-sprint28-launch", file: "qa-sprint28-launch.mjs", sprints: [28] },
];

function runTool(file) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(ROOT, "tools", file)], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });
  const ms = Date.now() - t0;
  const out = (r.stdout || "") + (r.stderr || "");
  const pass = r.status === 0;
  return { pass, ms, out: out.trim().split("\n").slice(-3).join(" · ") };
}

console.log(`SPRINT MATRIX  ·  ${new Date().toISOString()}`);
console.log(`repo: ${ROOT}\n`);

const results = new Map();
for (const tool of TOOLS) {
  process.stdout.write(`running ${tool.name}… `);
  const res = runTool(tool.file);
  results.set(tool.name, res);
  console.log(res.pass ? `PASS (${res.ms}ms)` : `FAIL (${res.ms}ms)`);
  if (!res.pass) console.log(res.out);
}

console.log("\n── Sprint automated coverage ──");
for (const s of SPRINTS) {
  const covered = TOOLS.filter((t) => t.sprints.includes(s.id))
    .map((t) => results.get(t.name))
    .every((r) => r && r.pass);
  const human = s.id <= 9 ? "human feel open" : "headed frame-probe + checklist";
  console.log(`  Sprint ${String(s.id).padStart(2)}  ${s.theme.padEnd(28)}  auto: ${covered ? "PASS" : "FAIL"}  ·  ${human}`);
}

const allPass = [...results.values()].every((r) => r.pass);
console.log(`\n${allPass ? "PASS" : "FAIL"}  ·  ${results.size}/${results.size} tools  ·  see docs/SPRINT-AGENTS.md`);
process.exit(allPass ? 0 : 1);
