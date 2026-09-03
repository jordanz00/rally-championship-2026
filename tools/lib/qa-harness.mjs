/**
 * qa-harness.mjs — zero-dependency browser harness for the rally build.
 *
 * WHO THIS IS FOR: tools/qa-boot-smoke.mjs and tools/qa-frame-probe.mjs.
 * WHAT IT DOES: three things, none of which need `npm install`.
 *   1. Serves the repo over http on an ephemeral free port (never 8765).
 *   2. Launches the locally installed Chrome/Chromium with remote debugging.
 *   3. Speaks the Chrome DevTools Protocol over the WebSocket that ships with
 *      Node 22+, so we can evaluate JS in the page, send *real* trusted mouse
 *      and key events, and capture console errors and uncaught exceptions.
 *
 * WHY NOT PLAYWRIGHT: neither Playwright nor Puppeteer is installed in this
 *   repo and there is no package.json. Chrome is already on the machine and
 *   Node ships a WebSocket client, so CDP costs us nothing and installs nothing.
 *
 * HOW IT CONNECTS: pure test infrastructure. It never writes to the repo.
 */

import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The user may have a dev server on 8765 they depend on. We never touch it. */
const FORBIDDEN_PORTS = new Set([8765]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

/* ------------------------------------------------------------------ */
/* Static server                                                       */
/* ------------------------------------------------------------------ */

/**
 * Serve `root` read-only over http on a free ephemeral port.
 * @param {string} root absolute directory to serve
 * @returns {Promise<{port:number, origin:string, close:()=>Promise<void>}>}
 */
export async function startServer(root = ROOT) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      // Strip the ?v= cache-buster the game uses on every import.
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith("/")) rel += "index.html";
      const target = path.resolve(root, "." + rel);
      // Path traversal guard — this server is local but still gets it right.
      if (!target.startsWith(root)) {
        res.writeHead(403).end("forbidden");
        return;
      }
      const data = await fsp.readFile(target);
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(target).toLowerCase()] || "application/octet-stream",
        "Content-Length": data.length,
        "Cache-Control": "no-store",
      });
      res.end(data);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
    }
  });

  const port = await new Promise((resolve, reject) => {
    server.once("error", reject);
    // Port 0 = let the OS pick a free one, so we can never collide with 8765.
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  if (FORBIDDEN_PORTS.has(port)) {
    await new Promise((r) => server.close(r));
    return startServer(root);
  }

  return {
    port,
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

/* ------------------------------------------------------------------ */
/* Chrome discovery + launch                                           */
/* ------------------------------------------------------------------ */

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  // Prefer Chrome for Testing / headless shell when present — no GUI registration.
  path.join(os.homedir(), ".cache/puppeteer/chrome-headless-shell"),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome-stable",
].filter(Boolean);

/**
 * Why launching Google Chrome would abort and dump a macOS crash dialog.
 *
 * Cursor's agent (and other sandboxed IDE hosts) spawn `node` → Chrome.
 * On macOS, Chrome then calls HIServices `TransformProcessType` /
 * `_RegisterApplication` and SIGABRTs almost immediately — the crash report
 * the user keeps seeing. Static QA stays green; headed probes are for a real
 * Terminal session with an explicit opt-in.
 *
 * Opt in:  RALLY_QA_ALLOW_CHROME=1 node tools/qa-boot-smoke.mjs
 * Opt out: RALLY_QA_NO_CHROME=1   (always skip)
 *
 * @returns {string|null} human reason, or null if launch is allowed
 */
export function chromeLaunchBlockedReason() {
  if (process.env.RALLY_QA_ALLOW_CHROME === "1") return null;
  if (process.env.RALLY_QA_NO_CHROME === "1") return "RALLY_QA_NO_CHROME=1";

  // Explicit Cursor / Composer agent markers (any OS).
  if (
    process.env.CURSOR_AGENT ||
    process.env.CURSOR_TRACE_ID ||
    process.env.CURSOR_SESSION_ID ||
    process.env.COMPOSER_SESSION
  ) {
    return "Cursor agent host (Chrome aborts in TransformProcessType)";
  }

  // VS Code / Cursor inject these into task + agent shells.
  const ideHost = !!(process.env.VSCODE_PID || process.env.VSCODE_INJECTION);
  if (ideHost && !process.stdin.isTTY) {
    return "IDE agent shell without TTY (Chrome GUI registration crashes)";
  }

  // macOS hard rule: never spawn Chrome without an explicit opt-in.
  // Cursor does not always set CURSOR_* in every shell, and Chrome still
  // SIGABRTs in HIServices TransformProcessType when nested under Cursor's
  // node. Env sniffing alone failed — default-deny is the only reliable fix.
  if (process.platform === "darwin") {
    return "macOS Chrome QA requires RALLY_QA_ALLOW_CHROME=1 (prevents Cursor crash dialog)";
  }

  if (ideHost) {
    return "IDE host (set RALLY_QA_ALLOW_CHROME=1 in a real terminal)";
  }

  return null;
}

/** @returns {string|null} path to a usable Chromium-family binary */
export function findChrome() {
  if (chromeLaunchBlockedReason()) return null;
  for (const c of CHROME_CANDIDATES) {
    try {
      // Puppeteer cache is a directory — look for the binary inside if needed.
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * Human message when {@link findChrome} is null — distinguishes policy block
 * (Cursor/macOS) from a missing binary so agents do not chase CHROME_PATH.
 */
export function chromeUnavailableHint() {
  const blocked = chromeLaunchBlockedReason();
  if (blocked) {
    return (
      `SKIP  Chrome blocked: ${blocked}. ` +
      `Static QA only. For CDP probes: RALLY_QA_ALLOW_CHROME=1 node tools/… in Terminal.app`
    );
  }
  return "FAIL  no Chrome/Chromium binary found. Set CHROME_PATH.";
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => (FORBIDDEN_PORTS.has(p) ? freePort().then(resolve, reject) : resolve(p)));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Launch headless Chrome and attach to its first page target.
 * Only the process we spawn is ever killed.
 *
 * Never spawns Chrome when {@link chromeLaunchBlockedReason} is set — that is
 * what stopped the recurring macOS crash dialog under Cursor.
 *
 * @param {{headless?:boolean, width?:number, height?:number}} [opts]
 */
export async function launchChrome(opts = {}) {
  const blocked = chromeLaunchBlockedReason();
  if (blocked) {
    throw new Error(
      `Chrome launch blocked: ${blocked}. Static checks only. ` +
        `Run headed QA from Terminal.app with RALLY_QA_ALLOW_CHROME=1.`
    );
  }

  const bin = findChrome();
  if (!bin) throw new Error("No Chrome/Chromium found. Set CHROME_PATH to a browser binary.");
  const port = await freePort();
  const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "rally-qa-"));
  const width = opts.width || 1280;
  const height = opts.height || 720;

  // Always headless unless the caller AND the environment both allow headed.
  // Headed under Cursor is what triggers TransformProcessType → SIGABRT.
  const wantHeadless = opts.headless !== false;

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${width},${height}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--mute-audio",
    "--disable-features=CalculateNativeWinOcclusion,Crashpad",
    // Never show OS crash UI / dialogs from a QA child process.
    "--disable-breakpad",
    "--disable-crash-reporter",
    "--disable-in-process-stack-traces",
    "--noerrdialogs",
    "--disable-hang-monitor",
    "--disable-component-update",
    "--use-mock-keychain",
    "about:blank",
  ];
  if (wantHeadless) {
    // Headless has no GPU, so WebGL must fall back to the SwiftShader software
    // rasteriser or nothing renders at all. It works, but it caps this game at
    // roughly 2 fps — fine for correctness assertions, useless for measuring
    // frame time. Run headed (real GPU) for anything performance related —
    // only from Terminal.app with RALLY_QA_ALLOW_CHROME=1.
    args.unshift("--headless=new");
    args.push(
      "--enable-unsafe-swiftshader",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--ozone-platform=headless"
    );
  }

  const proc = spawn(bin, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      // Keep Crashpad from writing ~/Library/Logs/DiagnosticReports spam.
      CHROME_HEADLESS: "1",
      BREAKPAD_DUMP_LOCATION: path.join(userDataDir, "crashes"),
    },
  });
  let stderr = "";
  proc.stderr.on("data", (d) => {
    stderr += d.toString().slice(0, 400);
  });

  // Wait for the debugging endpoint — bail immediately if Chrome aborts
  // (the old path waited 12s then left a macOS crash dialog on screen).
  let version = null;
  let launchErr = null;
  proc.once("exit", (code, signal) => {
    if (!version) {
      launchErr = new Error(
        `Chrome exited before CDP ready (code=${code} signal=${signal}). ` +
          `stderr: ${stderr.trim() || "(none)"}`
      );
    }
  });
  for (let i = 0; i < 120; i++) {
    if (launchErr) break;
    if (proc.exitCode !== null) break;
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) {
        version = await r.json();
        break;
      }
    } catch {
      /* not up yet */
    }
    await sleep(100);
  }
  if (launchErr || !version) {
    try {
      proc.kill("SIGKILL");
    } catch {
      /* ignore */
    }
    try {
      await fsp.rm(userDataDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    throw (
      launchErr ||
      new Error(`Chrome did not open a debugging port in 12s. stderr: ${stderr.trim() || "(none)"}`)
    );
  }

  // Find the page target.
  let pageWs = null;
  for (let i = 0; i < 60; i++) {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    if (page) {
      pageWs = page.webSocketDebuggerUrl;
      break;
    }
    await sleep(100);
  }
  if (!pageWs) {
    try {
      proc.kill("SIGKILL");
    } catch {
      /* ignore */
    }
    try {
      await fsp.rm(userDataDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    throw new Error("Chrome started but exposed no page target to attach to.");
  }

  const cdp = await connectCdp(pageWs);

  return {
    browserVersion: version.Browser,
    cdp,
    async close() {
      try {
        await cdp.close();
      } catch {
        /* ignore */
      }
      try {
        proc.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      // Give it a moment, then make sure only *our* process is gone.
      await sleep(300);
      if (proc.exitCode === null) {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }
      try {
        await fsp.rm(userDataDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* Minimal CDP client                                                  */
/* ------------------------------------------------------------------ */

/**
 * @param {string} url webSocketDebuggerUrl
 */
async function connectCdp(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("CDP WebSocket failed to open")), { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  /** @type {Map<string, ((p:any)=>void)[]>} */
  const listeners = new Map();

  ws.addEventListener("message", (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (CDP ${msg.error.code})`));
      else resolve(msg.result);
      return;
    }
    if (msg.method) for (const fn of listeners.get(msg.method) || []) fn(msg.params);
  });

  const api = {
    /**
     * @param {string} method e.g. "Runtime.evaluate"
     * @param {object} [params]
     */
    send(method, params = {}, opts = {}) {
      const id = nextId++;
      const timeoutMs = opts.timeoutMs ?? 180000;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
        // Generous: Input.* calls block until the renderer acknowledges, and a
        // multi-megabyte GLB parse or a shader compile can stall the main
        // thread for a long time. A short timeout here would report a harness
        // failure for what is really a page-side stall.
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error(`CDP timeout after ${Math.round(timeoutMs / 1000)}s: ${method}`));
          }
        }, timeoutMs);
      });
    },
    /**
     * @param {string} method
     * @param {(params:any)=>void} fn
     */
    on(method, fn) {
      if (!listeners.has(method)) listeners.set(method, []);
      listeners.get(method).push(fn);
    },
    close() {
      return new Promise((resolve) => {
        ws.addEventListener("close", resolve, { once: true });
        try { ws.close(); } catch { resolve(); }
        setTimeout(resolve, 1000);
      });
    },
  };
  return api;
}

/* ------------------------------------------------------------------ */
/* Page conveniences                                                   */
/* ------------------------------------------------------------------ */

/**
 * Wire up a page: enable domains and start collecting console errors and
 * uncaught exceptions. Root cause (b) in this project's history was code
 * throwing during boot while the splash still looked fine, so every message
 * is recorded with its source.
 *
 * Failed network requests are collected separately in `soft`: the car loader
 * deliberately probes a list of candidate GLB filenames and expects most of
 * them to 404, so treating those as failures would make the suite cry wolf.
 * They are still counted and reported.
 *
 * @param {{send:Function,on:Function}} cdp
 * @returns {Promise<{errors:{type:string,text:string,url?:string}[], soft:{type:string,text:string,url?:string}[]}>}
 */
export async function preparePage(cdp) {
  const errors = [];
  const soft = [];
  /** console.warn text. The game reports silent asset fallbacks this way. */
  const warnings = [];
  /** Requests the app is designed to try and tolerate missing. */
  const isExpectedMiss = (url = "") =>
    /favicon\.ico$/.test(url) || /\.(glb|gltf)$/i.test(url);
  const argText = (p) =>
    (p.args || [])
      .map((a) => a.description ?? (a.value !== undefined ? String(a.value) : a.unserializableValue ?? a.type))
      .join(" ")
      .slice(0, 1200);
  cdp.on("Runtime.consoleAPICalled", (p) => {
    if (p.type === "warning") { warnings.push(argText(p)); return; }
    if (p.type !== "error" && p.type !== "assert") return;
    errors.push({ type: "console.error", text: argText(p) });
  });
  cdp.on("Runtime.exceptionThrown", (p) => {
    const d = p.exceptionDetails || {};
    const text = d.exception?.description || d.text || "unknown exception";
    errors.push({ type: "uncaught", text: String(text).slice(0, 1200), url: d.url });
  });
  cdp.on("Log.entryAdded", (p) => {
    const e = p.entry || {};
    if (e.level !== "error") return;
    const rec = { type: `log.${e.source}`, text: String(e.text).slice(0, 1200), url: e.url };
    (e.source === "network" && isExpectedMiss(e.url) ? soft : errors).push(rec);
  });

  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  try {
    await cdp.send("Page.bringToFront");
  } catch {
    /* headless may omit this */
  }
  await cdp.send("Log.enable");
  await cdp.send("Network.enable");
  cdp.on("Network.loadingFailed", (p) => {
    if (p.canceled) return;
    soft.push({ type: "network", text: `${p.type} request failed: ${p.errorText}` });
  });

  return { errors, soft, warnings };
}

/**
 * Navigate and wait for the load event.
 * @param {{send:Function,on:Function}} cdp
 * @param {string} url
 */
export async function goto(cdp, url) {
  const loaded = new Promise((resolve) => cdp.on("Page.loadEventFired", resolve));
  await cdp.send("Page.navigate", { url });
  await Promise.race([loaded, sleep(20000)]);
}

/**
 * Evaluate an expression in the page and return its value.
 * Throws if the page threw, so a broken assertion never silently passes.
 *
 * @param {{send:Function}} cdp
 * @param {string} expression
 * @returns {Promise<any>}
 */
export async function evaluate(cdp, expression, opts = {}) {
  const res = await cdp.send(
    "Runtime.evaluate",
    {
      expression: `(() => { ${expression} })()`,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    },
    { timeoutMs: opts.timeoutMs }
  );
  if (res.exceptionDetails) {
    const d = res.exceptionDetails;
    throw new Error(`page threw: ${d.exception?.description || d.text}`);
  }
  return res.result?.value;
}

/**
 * Poll an expression until it returns truthy.
 * @param {{send:Function}} cdp
 * @param {string} expression must `return` a value
 * @param {{timeout?:number, interval?:number, label?:string}} [opts]
 */
export async function waitFor(cdp, expression, opts = {}) {
  const timeout = opts.timeout ?? 15000;
  const interval = opts.interval ?? 100;
  const evalTimeoutMs = opts.evalTimeoutMs ?? 8000;
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    const remain = Math.max(1000, deadline - Date.now());
    try {
      last = await evaluate(cdp, expression, { timeoutMs: Math.min(evalTimeoutMs, remain) });
      if (last) return last;
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      if (!/CDP timeout/.test(msg)) throw err;
      if (Date.now() >= deadline) {
        throw new Error(`timed out after ${timeout}ms waiting for: ${opts.label || expression.trim().slice(0, 120)}`);
      }
    }
    await sleep(interval);
  }
  throw new Error(`timed out after ${timeout}ms waiting for: ${opts.label || expression.trim().slice(0, 120)}`);
}

/**
 * Hit-test a selector the way a mouse does, then click it with a real
 * trusted CDP mouse event at the hit point.
 *
 * This is the check that matters for this project: a control can be perfectly
 * styled and still be unclickable because something else is painted over it.
 * `getBoundingClientRect` cannot see that; `elementFromPoint` can.
 *
 * @param {{send:Function}} cdp
 * @param {string} selector
 * @returns {Promise<{ok:boolean, reason?:string, blocker?:string, x?:number, y?:number}>}
 */
export async function hitTest(cdp, selector) {
  return evaluate(
    cdp,
    `
    const sel = ${JSON.stringify(selector)};
    const el = document.querySelector(sel);
    if (!el) return { ok: false, reason: "selector matched no element" };
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return { ok: false, reason: "element has zero size (w=" + r.width + " h=" + r.height + ")" };
    const cs = getComputedStyle(el);
    if (cs.display === "none") return { ok: false, reason: "display:none" };
    if (cs.visibility === "hidden") return { ok: false, reason: "visibility:hidden" };
    if (Number(cs.opacity) === 0) return { ok: false, reason: "opacity:0" };
    if (cs.pointerEvents === "none") return { ok: false, reason: "pointer-events:none — cannot be clicked" };
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) {
      return { ok: false, reason: "element is outside the viewport" };
    }
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height / 2);
    const hit = document.elementFromPoint(x, y);
    if (!hit) return { ok: false, reason: "nothing is hittable at the element's centre point", x, y };
    if (hit !== el && !el.contains(hit)) {
      const describe = (n) => {
        if (!n) return "(none)";
        const id = n.id ? "#" + n.id : "";
        const cls = n.className && typeof n.className === "string" ? "." + n.className.trim().split(/\\s+/).join(".") : "";
        const z = getComputedStyle(n).zIndex;
        return n.tagName.toLowerCase() + id + cls + " [z-index:" + z + "]";
      };
      return { ok: false, reason: "another element is on top of it", blocker: describe(hit), x, y };
    }
    return { ok: true, x, y };
  `
  );
}

/**
 * Real trusted mouse click at viewport coordinates.
 * @param {{send:Function}} cdp
 */
export async function clickAt(cdp, x, y) {
  const base = { x, y, button: "left", clickCount: 1, buttons: 1 };
  const opts = { timeoutMs: 8000 };
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 }, opts);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...base }, opts);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base }, opts);
}

/** Hit-test then click. Falls back to an in-page click if the GPU is too busy to ack the mouse. */
export async function clickSelector(cdp, selector, label = selector) {
  return clickResilient(cdp, selector, label);
}

/**
 * How long the page's main thread takes to answer a trivial task.
 *
 * This is the direct measurement of historical root cause (a): renderer
 * construction and shader compilation blocking the main thread so the splash
 * could not become interactive. A high number here means the page looks alive
 * but will not respond to a click.
 *
 * @param {{send:Function}} cdp
 * @returns {Promise<number>} milliseconds
 */
export async function mainThreadLag(cdp) {
  const t0 = Date.now();
  try {
    await evaluate(cdp, `return 1;`, { timeoutMs: 8000 });
    return Date.now() - t0;
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    if (/CDP timeout/.test(msg)) return 8000;
    throw err;
  }
}

/**
 * Wait until the main thread answers within `maxLagMs`.
 * @param {{send:Function}} cdp
 * @returns {Promise<{lag:number, waitedMs:number}>}
 */
export async function waitForResponsiveMainThread(cdp, maxLagMs = 400, timeout = 120000) {
  const t0 = Date.now();
  let lag = await mainThreadLag(cdp);
  while (lag > maxLagMs && Date.now() - t0 < timeout) {
    await sleep(250);
    lag = await mainThreadLag(cdp);
  }
  return { lag, waitedMs: Date.now() - t0 };
}

/**
 * Click a control, preferring a real trusted CDP mouse event. If the renderer
 * is too busy to acknowledge input, fall back to an in-page click so a
 * performance stall does not masquerade as a broken button. Reports which
 * path was used, because the distinction matters.
 *
 * @param {{send:Function}} cdp
 * @returns {Promise<{via:"trusted-mouse"|"in-page", lag:number}>}
 */
export async function clickResilient(cdp, selector, label = selector, settleMs = 15000) {
  // A saturated boot main thread can answer `evaluate` before style/layout has
  // flushed, so the control measures 0×0 for a moment. That is a perf symptom,
  // not a broken button — poll until it is genuinely reachable.
  const deadline = Date.now() + settleMs;
  let hit = await hitTest(cdp, selector);
  while (!hit.ok && Date.now() < deadline) {
    await sleep(250);
    hit = await hitTest(cdp, selector);
  }
  if (!hit.ok) {
    throw new Error(`"${label}" is not clickable: ${hit.reason}` + (hit.blocker ? ` — covered by ${hit.blocker}` : ""));
  }
  const { lag } = await waitForResponsiveMainThread(cdp, 400, 60000);
  try {
    await Promise.race([
      clickAt(cdp, hit.x, hit.y),
      sleep(20000).then(() => { throw new Error("input dispatch stalled"); }),
    ]);
    return { via: "trusted-mouse", lag };
  } catch {
    await evaluate(cdp, `document.querySelector(${JSON.stringify(selector)}).click(); return 1;`);
    return { via: "in-page", lag };
  }
}

/** Windows virtual key codes for the few keys the game reads. */
const KEYS = {
  Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  Space: { key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " " },
  w: { key: "w", code: "KeyW", windowsVirtualKeyCode: 87, text: "w" },
  a: { key: "a", code: "KeyA", windowsVirtualKeyCode: 65, text: "a" },
  s: { key: "s", code: "KeyS", windowsVirtualKeyCode: 83, text: "s" },
  d: { key: "d", code: "KeyD", windowsVirtualKeyCode: 68, text: "d" },
  p: { key: "p", code: "KeyP", windowsVirtualKeyCode: 80, text: "p" },
  c: { key: "c", code: "KeyC", windowsVirtualKeyCode: 67, text: "c" },
};

/**
 * @param {{send:Function}} cdp
 * @param {keyof typeof KEYS} name
 * @param {"down"|"up"} dir
 */
export async function keyEvent(cdp, name, dir) {
  const k = KEYS[name];
  if (!k) throw new Error(`unmapped key: ${name}`);
  await cdp.send("Input.dispatchKeyEvent", {
    type: dir === "down" ? "keyDown" : "keyUp",
    key: k.key,
    code: k.code,
    windowsVirtualKeyCode: k.windowsVirtualKeyCode,
    nativeVirtualKeyCode: k.windowsVirtualKeyCode,
    ...(dir === "down" ? { text: k.text, unmodifiedText: k.text } : {}),
  });
}

export async function pressKey(cdp, name) {
  await keyEvent(cdp, name, "down");
  await sleep(30);
  await keyEvent(cdp, name, "up");
}

/** Which `.screen` element is currently active. */
export async function activeScreen(cdp) {
  return evaluate(cdp, `
    const el = document.querySelector(".screen.active");
    return el ? el.id : null;
  `);
}

/**
 * Look for the failure mode that hid the canvas for whole sessions: a
 * near-full-viewport element with an opaque background sitting above the
 * render surface.
 * @param {{send:Function}} cdp
 */
export async function findOpaqueOverlays(cdp) {
  return evaluate(cdp, `
    const out = [];
    const vw = innerWidth, vh = innerHeight, area = vw * vh;
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      if (Number(cs.opacity) < 0.9) continue;
      const r = el.getBoundingClientRect();
      if (r.width * r.height < area * 0.9) continue;
      const bg = cs.backgroundColor || "";
      const m = /rgba?\\(([^)]+)\\)/.exec(bg);
      if (!m) continue;
      const parts = m[1].split(",").map((s) => parseFloat(s));
      const alpha = parts.length > 3 ? parts[3] : 1;
      if (alpha < 0.9) continue;
      if (el.tagName === "CANVAS") continue;
      out.push({
        id: el.id || null,
        tag: el.tagName.toLowerCase(),
        cls: typeof el.className === "string" ? el.className : "",
        zIndex: cs.zIndex,
        background: bg,
        alpha,
      });
    }
    return out;
  `);
}

/**
 * Install a requestAnimationFrame tap that records real frame timestamps.
 * Used both as a "are frames happening at all" signal and as the data source
 * for the frame-time percentiles.
 * @param {{send:Function}} cdp
 */
export async function installFrameRecorder(cdp) {
  await evaluate(cdp, `
    if (!window.__qaFrames) {
      window.__qaFrames = [];
      window.__qaRecording = false;
      const tick = (t) => {
        if (window.__qaRecording) window.__qaFrames.push(t);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
    return true;
  `);
}

export async function startRecording(cdp) {
  await evaluate(cdp, `window.__qaFrames.length = 0; window.__qaRecording = true; return true;`);
}

/**
 * Stop recording and return frame deltas in milliseconds.
 * @param {{send:Function}} cdp
 * @returns {Promise<number[]>}
 */
export async function stopRecording(cdp) {
  return evaluate(cdp, `
    window.__qaRecording = false;
    const t = window.__qaFrames;
    const d = [];
    for (let i = 1; i < t.length; i++) d.push(t[i] - t[i - 1]);
    return d;
  `);
}

/** Base64 JPEG screenshot. Comparing two of them proves pixels are moving. */
export async function screenshot(cdp) {
  const r = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 70 });
  return r.data;
}

export { sleep };
