#!/usr/bin/env node
/**
 * qa-road-deform-live — drive Desert in a real (headless/headed) Chrome and
 * report trail-deformation cost + take screenshots into .qa/shots/.
 *
 * RUN (under Cursor, software GL):
 *   CHROME_PATH=.qa/browsers/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell \
 *   RALLY_QA_ALLOW_CHROME=1 node tools/qa-road-deform-live.mjs [--course=desert] [--seconds=14] [--headless]
 *
 * CAVEAT: SwiftShader frame times are meaningless. CPU ms of the deform path
 * (emit / step / flush, measured with performance.now inside the page), draw
 * calls, triangles, heap and GPU upload bytes are real.
 */
import fs from "node:fs";
import path from "node:path";
import {
  ROOT, startServer, launchChrome, findChrome, preparePage, goto, evaluate,
  waitFor, sleep, chromeUnavailableHint,
} from "./lib/qa-harness.mjs";

const argv = process.argv.slice(2);
const COURSE = (/--course=(\w+)/.exec(argv.join(" ")) || [])[1] || "desert";
const SECONDS = Number((/--seconds=(\d+)/.exec(argv.join(" ")) || [])[1] || 14);
const OUT = path.join(ROOT, ".qa", "shots");
fs.mkdirSync(OUT, { recursive: true });

if (!findChrome()) {
  console.error(chromeUnavailableHint());
  process.exit(/SKIP/.test(chromeUnavailableHint()) ? 0 : 1);
}
const server = await startServer(ROOT);
const browser = await launchChrome({ headless: true, width: 1280, height: 720 });
const { cdp } = browser;
const { errors } = await preparePage(cdp);
const shot = async (name) => {
  const r = await cdp.send("Page.captureScreenshot", { format: "png" });
  const p = path.join(OUT, `deform-${COURSE}-${name}.png`);
  fs.writeFileSync(p, Buffer.from(r.data, "base64"));
  console.log("shot", p);
};
const sdk = (code) => evaluate(cdp, code, { timeoutMs: 60000 });
let exitCode = 0;
try {
  await goto(cdp, `${server.origin}/index.html`);
  await waitFor(cdp, `return window.game ? 1 : null;`, { timeout: 60000, label: "window.game" });
  await sdk(`const g=window.game; g.mode='championship'; g.stageIndex=${COURSE === "desert" ? 0 : 1}; g.courseId='${COURSE}'; g.champOrder=['desert','forest','mountain','lakeside']; g.champPlace=8; g._beginRace('${COURSE}'); return 1;`);
  await waitFor(cdp, `const g=window.game; return g.state==='race' && g.track && g.track.wheelDeform && g.player ? 1 : null;`, { timeout: 240000, interval: 500, evalTimeoutMs: 20000, label: "race state" });
  console.log("race started on", COURSE);
  await sdk(`
    const g=window.game; const S=window.__S={emit:0,flush:0,step:0,frames:0,ft:[],upload:0,uploadMax:0,flushMax:0};
    const tm=g.tireMarks, tr=g.track, ru=tr.wheelRuts, df=tr.wheelDeform;
    const oe=tm.emit.bind(tm); tm.emit=function(a,b,c,d){const t=performance.now(); oe(a,b,c,d); S.emit+=performance.now()-t;};
    const of=ru.flush.bind(ru); ru.flush=function(x,z){const t=performance.now(); of(x,z); const d=performance.now()-t; S.flush+=d; S.flushMax=Math.max(S.flushMax,d); S.frames++; S.upload+=ru.stats.uploadBytes; S.uploadMax=Math.max(S.uploadMax,ru.stats.uploadBytes);};
    const os=df.step.bind(df); df.step=function(dt){const t=performance.now(); os(dt); S.step+=performance.now()-t;};
    let last=performance.now(); (function tick(n){S.ft.push(n-last); last=n; requestAnimationFrame(tick);})(last);
    window.__errs=[];
    return 1;`);
  const drive = (steer, hb, thr = 1) => sdk(`window.game._qaDrive={throttle:${thr},steer:${steer},brake:0,handbrake:${hb}}; return 1;`);

  // Phase 1: roll + weave
  const t0 = Date.now();
  while (Date.now() - t0 < SECONDS * 1000) {
    const k = ((Date.now() - t0) / 1000) * 0.9;
    await drive(Math.sin(k) * 0.5, 0);
    await sleep(150);
  }
  await shot("1-roll-weave");
  // Phase 2: handbrake slide arc
  const t1 = Date.now();
  while (Date.now() - t1 < 3500) {
    await drive(0.85, 1);
    await sleep(120);
  }
  await shot("2-handbrake-slide");
  await drive(0, 0);
  await sleep(2500);
  await shot("3-slide-trail-behind");
  // Phase 3: landing crater (direct stamp via the same API the game calls)
  await sdk(`const g=window.game; g.tireMarks.landing(g.player, g.track, 7); return 1;`);
  await sleep(1200);
  await shot("4-landing");
  await drive(0.0, 0);
  await sleep(4000);

  const res = await sdk(`
    const g=window.game, S=window.__S, ru=g.track.wheelRuts, f=g.track.wheelDeform, info=g.renderer.info;
    const ft=S.ft.slice(5).sort((a,b)=>a-b);
    const cap={sand:0.12,dirt:0.10,gravel:0.07,mud:0.15,grass:0.045};
    let deep=0, cells=0, bermCells=0;
    for(const t of f.tileList){for(let i=0;i<1024;i++){if(t.depth[i]){cells++; if(t.depth[i]*0.0007>0.7*(cap[ (['tarmac','cobble','sand','dirt','gravel','mud','grass'])[t.surf] ]||0.1)) deep++;} if(t.berm[i]) bermCells++;}}
    let nan=0; for(let i=0;i<ru.pos.length;i++){ if(!Number.isFinite(ru.pos[i])) nan++; }
    return {
      course:g.courseId, surface:g.player.surfaceId, speed:+g.player.speed.toFixed(1),
      frames:S.frames, emitMsPerFrame:+(S.emit/S.frames).toFixed(3), stepMsPerFrame:+(S.step/S.frames).toFixed(3),
      flushMsPerFrame:+(S.flush/S.frames).toFixed(3), flushMaxMs:+S.flushMax.toFixed(2),
      uploadKBPerFrame:+(S.upload/S.frames/1024).toFixed(1), uploadMaxKB:+(S.uploadMax/1024).toFixed(1),
      tiles:f.tileCount, residentMB:+(f.bytes/1e6).toFixed(2), cellsDepth:cells, cellsBerm:bermCells, cellsOver70pctCap:deep,
      maxDepthCm:+(f.maxDepthM()*100).toFixed(1), stamps:f.stats.stamps, evictions:f.stats.evictions, tileObjectsCreated:f.stats.created,
      meshQuads:ru.stats.quads, meshedTiles:ru.stats.meshedTiles, meshNaN:nan,
      drawCalls:info.render.calls, triangles:info.render.triangles, geometries:info.memory.geometries, textures:info.memory.textures,
      heapMB: performance.memory ? +(performance.memory.usedJSHeapSize/1e6).toFixed(0) : 0,
      frameP50:+ft[ft.length>>1].toFixed(1), frameP95:+ft[Math.floor(ft.length*0.95)].toFixed(1),
      rivals:g.opponents.length, bands:g.opponents.map(o=>o.fxBand).join(''),
    };`);
  console.log(JSON.stringify(res, null, 2));
  // Reset / leak check
  const reset = await sdk(`const g=window.game; g.track.resetWheelDeform(); const f=g.track.wheelDeform, ru=g.track.wheelRuts; ru.flush(0,0); return {tiles:f.tileCount, quads:ru.stats.quads, hw:ru._hw};`);
  console.log("after reset", JSON.stringify(reset));
  console.log("console errors:", errors.length);
  for (const e of errors.slice(0, 12)) console.log("  ", e.type, String(e.text).slice(0, 240));
  if (res.meshNaN || errors.some((e) => /deform|rut|wheel/i.test(e.text))) exitCode = 1;
} catch (e) {
  console.error("probe failed:", e && e.stack ? e.stack : e);
  exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
process.exit(exitCode);
