/**
 * perf-probe-inpage.js — in-page frame-time probe (30 fps floor contract).
 *
 * WHO THIS IS FOR: tools/qa-perf-floor.mjs (headless harness) and a human /
 *   agent driving the Cursor IDE browser: `await import('/tools/lib/perf-probe-inpage.js')`.
 * WHAT IT DOES: taps game._render (PRESENTED frames — what the player sees) and
 *   requestAnimationFrame (display cadence), plus long tasks, renderer.info and
 *   scaler telemetry. Nothing here changes game state except when asked
 *   (startStage / place / autopilot / hold countdown).
 * HOW IT CONNECTS: reads window.game only. Safe to import twice (idempotent).
 *
 * FLOOR CONTRACT (documented thresholds, asserted by qa-perf-floor):
 *   presented p95 <= 33.3 ms (+1.0 ms vsync/timer quantisation), worst frame <= 100 ms,
 *   sustained hitches (> 50 ms) tracked and reported.
 */

const FLOOR_MS = 33.3;

function pct(sorted, p) {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

function summarize(arr) {
  if (!arr.length) return { n: 0 };
  const s = arr.slice().sort((a, b) => a - b);
  const sum = arr.reduce((a, b) => a + b, 0);
  let longest = 0;
  for (const v of arr) if (v > longest) longest = v;
  return {
    n: arr.length,
    avg: +(sum / arr.length).toFixed(2),
    p50: +pct(s, 0.5).toFixed(2),
    p95: +pct(s, 0.95).toFixed(2),
    p99: +pct(s, 0.99).toFixed(2),
    max: +longest.toFixed(1),
    over33: arr.filter((v) => v > FLOOR_MS + 1).length,
    over50: arr.filter((v) => v > 50).length,
    over100: arr.filter((v) => v > 100).length,
  };
}

const P = (window.__perf = window.__perf || {});

if (!P.installed) {
  P.installed = true;
  P.present = [];
  P.raf = [];
  P.cost = [];
  P.long = [];
  P.rec = false;
  P._lastP = 0;
  P._lastR = 0;
  P.calls = 0;
  P.tris = 0;

  const g = window.game;
  const origRender = g._render.bind(g);
  g._render = function (dt) {
    const r = g.renderer;
    const inf = r && r.info;
    const prevAuto = inf ? inf.autoReset : true;
    if (inf) {
      inf.autoReset = false;
      inf.reset();
    }
    const t0 = performance.now();
    const out = origRender(dt);
    const t1 = performance.now();
    if (inf) {
      P.calls = inf.render.calls;
      P.tris = inf.render.triangles;
      inf.autoReset = prevAuto;
    }
    if (P.rec) {
      if (P._lastP) P.present.push(t1 - P._lastP);
      P.cost.push(t1 - t0);
    }
    P._lastP = t1;
    return out;
  };
  const tick = (now) => {
    if (P.rec && P._lastR) P.raf.push(now - P._lastR);
    P._lastR = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver((list) => {
      if (!P.rec) return;
      for (const e of list.getEntries()) P.long.push(e.duration);
    }).observe({ entryTypes: ["longtask"] });
  } catch {
    /* longtask unsupported */
  }
}

/** Hardware / viewport honesty block. */
P.env = function () {
  const c = document.createElement("canvas");
  const gl = c.getContext("webgl2");
  let renderer = "n/a";
  if (gl) {
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  }
  const g = window.game;
  return {
    gpu: renderer,
    software: /swiftshader|software|llvmpipe|basic render/i.test(renderer),
    ua: navigator.userAgent.replace(/.*Chrome\//, "Chrome/").slice(0, 40),
    viewport: `${innerWidth}x${innerHeight}`,
    dpr: window.devicePixelRatio,
    cores: navigator.hardwareConcurrency,
    canvas: g && g.renderer ? `${g.renderer.domElement.width}x${g.renderer.domElement.height}` : "?",
  };
};

/** Scaler / tier telemetry snapshot. */
P.tier = function () {
  const g = window.game;
  const pt = g.perfTier;
  return {
    state: g.state,
    tier: pt ? pt.tier : "?",
    hz: pt ? pt.presentHz : 0,
    locked30: pt ? !!pt.locked30 : false,
    emaMs: pt ? +pt.emaMs.toFixed(1) : 0,
    pr: g.renderer ? +g.renderer.getPixelRatio().toFixed(3) : 0,
    soft: g._softRenderScale,
    floorLevel: g.floorGuard ? g.floorGuard.level : null,
    shadows: !!(g.renderer && g.renderer.shadowMap.enabled),
    post: !!(g.post && g.post.enabled),
    fps: g.fps,
  };
};

/**
 * Sample N presented frames (or maxMs wall), return stats.
 * @param {string} label
 * @param {{frames?:number, maxMs?:number, warmMs?:number}} [o]
 */
P.measure = async function (label, o = {}) {
  const frames = o.frames || 600;
  const maxMs = o.maxMs || 60000;
  if (o.warmMs) await new Promise((r) => setTimeout(r, o.warmMs));
  P.present.length = P.raf.length = P.cost.length = P.long.length = 0;
  const heap0 = performance.memory ? performance.memory.usedJSHeapSize : 0;
  P._lastP = 0;
  P._lastR = 0;
  P.rec = true;
  const t0 = performance.now();
  const tierStart = P.tier();
  let calls = 0;
  let tris = 0;
  let nCalls = 0;
  await new Promise((resolve) => {
    const id = setInterval(() => {
      calls = Math.max(calls, P.calls);
      tris = Math.max(tris, P.tris);
      nCalls++;
      if (P.present.length >= frames || performance.now() - t0 > maxMs) {
        clearInterval(id);
        resolve();
      }
    }, 100);
  });
  P.rec = false;
  const wall = performance.now() - t0;
  const out = {
    label,
    wallMs: Math.round(wall),
    present: summarize(P.present),
    raf: summarize(P.raf),
    cpuRender: summarize(P.cost),
    longTasks: { n: P.long.length, max: P.long.length ? +Math.max(...P.long).toFixed(0) : 0 },
    deliveredFps: +((P.present.length * 1000) / wall).toFixed(1),
    drawCalls: calls,
    triangles: tris,
    heapDeltaMB: performance.memory ? +((performance.memory.usedJSHeapSize - heap0) / 1048576).toFixed(1) : null,
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(0) : null,
    tierStart,
    tierEnd: P.tier(),
    info: window.game.renderer
      ? {
          geometries: window.game.renderer.info.memory.geometries,
          textures: window.game.renderer.info.memory.textures,
          programs: window.game.renderer.info.programs ? window.game.renderer.info.programs.length : 0,
        }
      : null,
  };
  P.last = out;
  return out;
};

/** Compact one-line text for a result. */
P.line = function (r) {
  const p = r.present;
  return (
    `${r.label} | n=${p.n} fps=${r.deliveredFps} avg=${p.avg} p50=${p.p50} p95=${p.p95} p99=${p.p99} max=${p.max} ` +
    `>33=${p.over33} >50=${p.over50} >100=${p.over100} | rAF p50=${r.raf.p50} cpuRender avg=${r.cpuRender.avg} p95=${r.cpuRender.p95} max=${r.cpuRender.max} | ` +
    `calls=${r.drawCalls} tris=${r.triangles} long=${r.longTasks.n}/${r.longTasks.max} | tier=${r.tierEnd.tier} hz=${r.tierEnd.hz} lock30=${r.tierEnd.locked30} pr=${r.tierEnd.pr} guard=${r.tierEnd.floorLevel} heap=${r.heapMB}`
  );
};

/** Start a championship stage (does not wait). */
P.startStage = function (courseId) {
  const g = window.game;
  const order = ["desert", "forest", "mountain", "lakeside"];
  g.mode = "championship";
  g.stageIndex = Math.max(0, order.indexOf(courseId));
  g.courseId = courseId;
  g.champOrder = order;
  g.champPlace = 8;
  g._beginRace(courseId);
};

/** Wait until game.state === s. */
P.waitState = async function (s, timeoutMs = 120000) {
  const t0 = performance.now();
  while (window.game.state !== s) {
    if (performance.now() - t0 > timeoutMs) throw new Error("timeout waiting for state " + s + " (now " + window.game.state + ")");
    await new Promise((r) => setTimeout(r, 100));
  }
  return performance.now() - t0;
};

/** Hold / release the 3-2-1 clock so countdown can be sampled for many frames. */
P.holdCountdown = function (on) {
  const g = window.game;
  g._countHold = !!on;
  if (on && g.countdown < 2.9) g.countdown = 2.95;
};

/** Teleport the player along the stage. */
P.place = function (dist) {
  const g = window.game;
  g.player.spawn(g.track, dist, 0);
  if (g._syncWorldStream) g._syncWorldStream(true);
};

/** Look-ahead centreline autopilot through the game's QA hook. */
P.autopilot = function (on, o = {}) {
  const g = window.game;
  P._auto = !!on;
  if (!on) {
    g._qaDrive = null;
    if (g.input) g.input._qaHold = null;
    return;
  }
  g._qaDrive = { throttle: 1, steer: 0, brake: 0, handbrake: 0 };
  g.input._qaHold = g._qaDrive;
  const out = {};
  const capSpeed = o.speed || 55;
  const step = () => {
    if (!P._auto) return;
    const p = g.player;
    const t = g.track;
    if (p && t && t.sample && g._qaDrive) {
      const look = 16 + Math.min(26, p.speed * 0.7);
      const aim = t.sample(p.progress + look, out);
      if (aim && Number.isFinite(aim.x)) {
        const want = Math.atan2(aim.x - p.position.x, aim.z - p.position.z);
        let err = want - p.yaw;
        while (err > Math.PI) err -= Math.PI * 2;
        while (err < -Math.PI) err += Math.PI * 2;
        const steer = Math.max(-1, Math.min(1, err * 2.2));
        const tight = Math.abs(steer);
        g._qaDrive.steer = steer;
        g._qaDrive.throttle = p.speed > capSpeed ? 0.2 : tight > 0.55 ? 0.35 : tight > 0.3 ? 0.7 : 1;
        g._qaDrive.brake = tight > 0.75 && p.speed > 24 ? 0.5 : 0;
      }
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
};

/** Verdict against the floor contract. */
P.verdict = function (r) {
  const p = r.present;
  const fails = [];
  if (!(p.p95 <= FLOOR_MS + 1)) fails.push(`p95 ${p.p95} > ${FLOOR_MS + 1}`);
  if (!(p.max <= 100)) fails.push(`max ${p.max} > 100`);
  if (!(r.deliveredFps >= 29)) fails.push(`delivered ${r.deliveredFps} fps < 29`);
  return { ok: fails.length === 0, fails };
};

export default P;
