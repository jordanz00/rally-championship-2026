#!/usr/bin/env node
/**
 * qa-chrome-safe.mjs — Chrome must never crash-dialog under Cursor agent hosts.
 *
 * The recurring macOS crash (SIGABRT in TransformProcessType /
 * _RegisterApplication) came from spawning Google Chrome.app as a child of
 * Cursor. This gate locks the guard: under Cursor, only chrome-headless-shell
 * / CHROME_PATH non-.app binaries are allowed — never Chrome.app.
 *
 * RUN: node tools/qa-chrome-safe.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`CHROME SAFE LAUNCH  ·  ${new Date().toISOString()}\n`);

const harness = fs.readFileSync(path.join(ROOT, "tools/lib/qa-harness.mjs"), "utf8");

check(
  "harness exports chromeLaunchBlockedReason",
  /export function chromeLaunchBlockedReason/.test(harness)
);
check(
  "harness exports isCursorOrIdeAgentHost",
  /export function isCursorOrIdeAgentHost/.test(harness)
);
check(
  "harness exports isMacGuiBrowserApp",
  /export function isMacGuiBrowserApp/.test(harness)
);
check(
  "findChrome refuses when blocked",
  /if \(chromeLaunchBlockedReason\(\)\) return null/.test(harness)
);
check(
  "findChrome skips .app under Cursor",
  /underCursor && isMacGuiBrowserApp/.test(harness)
);
check(
  "launchChrome throws before spawn when blocked",
  /Chrome launch blocked:/.test(harness) &&
    harness.indexOf("chromeLaunchBlockedReason()") < harness.indexOf("const proc = spawn")
);
check(
  "crash reporter / breakpad disabled on QA Chrome",
  /--disable-crash-reporter/.test(harness) && /--disable-breakpad/.test(harness)
);
check(
  "SIGABRT message names TransformProcessType",
  /TransformProcessType/.test(harness)
);
check(
  "opt-in override documented",
  /RALLY_QA_ALLOW_CHROME=1/.test(harness) && /RALLY_QA_NO_CHROME=1/.test(harness)
);
check(
  "GUI escape hatch named (not for Cursor)",
  /RALLY_QA_ALLOW_GUI_CHROME/.test(harness)
);

const url = pathToFileURL(path.join(ROOT, "tools/lib/qa-harness.mjs")).href;
const mod = await import(url);

const prev = { ...process.env };
const restoreEnv = () => {
  for (const k of Object.keys(process.env)) {
    if (!(k in prev)) delete process.env[k];
  }
  Object.assign(process.env, prev);
};

// Simulate Cursor agent host — must block without ALLOW.
process.env.CURSOR_AGENT = "1";
delete process.env.RALLY_QA_ALLOW_CHROME;
delete process.env.RALLY_QA_ALLOW_GUI_CHROME;
delete process.env.CHROME_PATH;
const blockedAgent = mod.chromeLaunchBlockedReason();
check("CURSOR_AGENT blocks Chrome", !!blockedAgent, blockedAgent || "not blocked");
check("findChrome null under CURSOR_AGENT", mod.findChrome() === null);

// ALLOW under Cursor must NOT unlock Google Chrome.app
process.env.RALLY_QA_ALLOW_CHROME = "1";
check("ALLOW clears policy block", mod.chromeLaunchBlockedReason() === null);
check("isMacGuiBrowserApp detects Chrome.app", mod.isMacGuiBrowserApp(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
));
check(
  "ALLOW under Cursor still skips Chrome.app (no shell installed)",
  mod.findChrome() === null || !mod.isMacGuiBrowserApp(mod.findChrome()),
  mod.findChrome() || "null (expected if no headless-shell)"
);
check(
  "hint mentions TransformProcessType / headless-shell",
  /TransformProcessType/.test(mod.chromeUnavailableHint()) &&
    /chrome-headless-shell/.test(mod.chromeUnavailableHint())
);

// macOS: even without Cursor markers, deny unless ALLOW is set.
delete process.env.CURSOR_AGENT;
delete process.env.CURSOR_TRACE_ID;
delete process.env.CURSOR_SESSION_ID;
delete process.env.COMPOSER_SESSION;
delete process.env.VSCODE_PID;
delete process.env.VSCODE_INJECTION;
delete process.env.RALLY_QA_ALLOW_CHROME;
delete process.env.RALLY_QA_FORCE_CURSOR_SAFE;
if (process.platform === "darwin") {
  const blockedDarwin = mod.chromeLaunchBlockedReason();
  check(
    "darwin default-deny without ALLOW",
    !!blockedDarwin && /RALLY_QA_ALLOW_CHROME=1/.test(blockedDarwin),
    blockedDarwin || "not blocked"
  );
}

restoreEnv();

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  chrome-safe gate ${fail ? `(${fail} check(s) failed)` : "locked"}`);
process.exit(fail ? 1 : 0);
