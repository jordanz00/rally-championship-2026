#!/usr/bin/env node
/**
 * Headed probe: what still blocks Desert ~1737 m after scrub.
 * RUN: node tools/qa-desert-mud-1737-probe.mjs
 */
import {
  ROOT, startServer, launchChrome, findChrome, preparePage, goto,
  waitFor, clickSelector, evaluate,
  chromeUnavailableHint
} from "./lib/qa-harness.mjs";

async function main() {
  if (!findChrome()) {
    console.log("SKIP — no Chrome");
    process.exit(0);
  }
  const server = await startServer(ROOT);
  let browser;
  try {
    browser = await launchChrome({ headless: true });
  } catch (e) {
    console.log("SKIP —", e.message);
    server.close();
    process.exit(0);
  }
  const { cdp } = browser;
  await preparePage(cdp);
  try {
    await goto(cdp, `${server.origin}/index.html?perf=medium&v=496`);
    await waitFor(cdp, `return window.game ? 1 : null;`, { timeout: 45000, label: "game" });
    await clickSelector(cdp, "#btn-start", "PRESS START");
    await waitFor(cdp, `const e=document.querySelector(".screen.active"); return e&&e.id==="screen-menu"?1:null;`, { timeout: 60000, label: "menu" });
    await clickSelector(cdp, "[data-menu='practice']", "PRACTICE");
    await waitFor(
      cdp,
      `const s=document.querySelector(".screen.active");
       if(!s||s.id!=="screen-cars") return null;
       const b=document.querySelector("[data-car='celica']");
       return b && !b.disabled ? 1 : null;`,
      { timeout: 60000, label: "Celica" }
    );
    await clickSelector(cdp, "[data-car='celica']", "CELICA");
    await waitFor(cdp, `const e=document.querySelector(".screen.active"); return e&&e.id==="screen-courses"?1:null;`, { timeout: 60000, label: "courses" });
    await clickSelector(cdp, "[data-course='desert']", "DESERT");
    await waitFor(
      cdp,
      `const g=window.game;
       return g && (g.state==="countdown"||g.state==="race") && g.courseId==="desert" && g.track ? 1 : null;`,
      { timeout: 180000, label: "desert" }
    );

    const snap = await evaluate(cdp, `
      const t = window.game.track;
      const pts = t.points;
      const tun = t._tunnels && t._tunnels[0];
      let pin = pts[0];
      let best = 1e9;
      for (let i = 0; i < pts.length; i++) {
        const d = Math.abs(pts[i].dist - 1737);
        if (d < best) { best = d; pin = pts[i]; }
      }
      const LO = 1720, HI = 1780;
      const blockHits = [];
      for (let d = LO; d <= HI; d += 0.75) {
        const pose = t._ribbonPoseAt(d);
        if (!pose) continue;
        for (const c of t.colliders || []) {
          if (Math.hypot(c.x - pose.x, c.z - pose.z) > 55) continue;
          if (t._colliderBlocksSample(c, pose.x, pose.z, pose.heading)) {
            blockHits.push({
              d: +d.toFixed(1),
              kind: c.kind || "sphere",
              x: +c.x.toFixed(1),
              z: +c.z.toFixed(1),
              hl: c.halfLen,
              r: c.r,
              depth: c.depth
            });
          }
        }
      }
      const latHits = [];
      for (let lat = -5.5; lat <= 5.5; lat += 0.75) {
        const x = pin.x + pin.nx * lat;
        const z = pin.z + pin.nz * lat;
        for (const c of t.colliders || []) {
          if (Math.hypot(c.x - x, c.z - z) > 55) continue;
          if (t._colliderBlocksSample(c, x, z, pin.heading)) {
            latHits.push({ lat: +lat.toFixed(2), kind: c.kind || "sphere", x: +c.x.toFixed(1), z: +c.z.toFixed(1), hl: c.halfLen, r: c.r });
            break;
          }
        }
      }
      const wallNear = [];
      const sphereNear = [];
      for (const c of t.colliders || []) {
        const road = t._nearestRoad(c.x, c.z);
        if (road.along < LO - 60 || road.along > HI + 60) continue;
        const over = road.minOver != null ? road.minOver : road.dist - road.roadW * 0.5;
        const rec = { x: +c.x.toFixed(1), z: +c.z.toFixed(1), along: +road.along.toFixed(1), over: +over.toFixed(2), hl: c.halfLen, r: c.r, depth: c.depth };
        if (c.kind === "wall") wallNear.push(rec);
        else sphereNear.push(rec);
      }
      const heightSpikes = [];
      for (let d = 1728; d <= 1750; d += 2) {
        let p = pts[0];
        let bd = 1e9;
        for (let i = 0; i < pts.length; i++) {
          const dd = Math.abs(pts[i].dist - d);
          if (dd < bd) { bd = dd; p = pts[i]; }
        }
        for (let lat = -4; lat <= 4; lat += 1) {
          const x = p.x + p.nx * lat;
          const z = p.z + p.nz * lat;
          const q = t.query(x, z, d);
          const dy = (q.height || 0) - (p.y + 0.05);
          if (dy > 0.35) heightSpikes.push({ d, lat, dy: +dy.toFixed(2), kind: q.jumpKind || "", onRoad: !!q.onRoad });
        }
      }
      // drive sim: spawn at 1710 and step with throttle, see if progress stalls
      const g = window.game;
      g.state = "race";
      g.countdown = 0;
      g.player.spawn(t, 1710, 0);
      g._qaDrive = { throttle: 0.85, steer: 0, brake: 0, handbrake: 0 };
      g.input._qaHold = g._qaDrive;
      let stalled = 0;
      let maxHit = 0;
      const prog = [];
      for (let i = 0; i < 900; i++) {
        const p = g.player;
        const ahead = t.sample ? t.sample(Math.min(t.length - 1, p.progress + 8)) : null;
        let steer = 0;
        if (ahead) {
          const dx = ahead.x - p.position.x;
          const dz = ahead.z - p.position.z;
          const want = Math.atan2(dx, dz);
          let err = want - p.yaw;
          while (err > Math.PI) err -= Math.PI * 2;
          while (err < -Math.PI) err += Math.PI * 2;
          steer = Math.max(-1, Math.min(1, err * 2.4));
        }
        g._qaDrive.steer = steer;
        g._fixed(1 / 60);
        maxHit = Math.max(maxHit, p.hitWall || 0);
        if (i % 30 === 0) prog.push({ i, d: +p.progress.toFixed(1), sp: +p.speed.toFixed(1), hit: +(p.hitWall || 0).toFixed(2), y: +p.position.y.toFixed(2) });
        if (p.progress > 1710 && p.speed < 1.5) stalled++;
        else stalled = 0;
        if (p.progress > 1800) break;
        if (stalled > 90) break;
      }
      return {
        tunEnd: tun ? +tun.endDist.toFixed(1) : null,
        scrubBands: tun ? { a0: +(tun.endDist + 130).toFixed(1), a1: +(tun.endDist + 200).toFixed(1) } : null,
        pinDist: +pin.dist.toFixed(1),
        pinSurf: pin.surface,
        pinW: pin.width,
        blockHits: blockHits.slice(0, 40),
        blockCount: blockHits.length,
        latHits,
        wallNear: wallNear.slice(0, 25),
        wallCount: wallNear.length,
        sphereNear: sphereNear.slice(0, 25),
        sphereCount: sphereNear.length,
        heightSpikes: heightSpikes.slice(0, 25),
        heightSpikeCount: heightSpikes.length,
        drive: { final: +g.player.progress.toFixed(1), speed: +g.player.speed.toFixed(1), maxHit, stalled: stalled > 90, prog }
      };
    `);

    console.log(JSON.stringify(snap, null, 2));
    await browser.close();
    server.close();
    if (snap.blockCount > 0 || snap.latHits.length > 0 || (snap.drive && snap.drive.stalled)) process.exit(2);
  } catch (err) {
    console.error("FAIL", err.message);
    try { await browser.close(); } catch {}
    server.close();
    process.exit(1);
  }
}

main();
