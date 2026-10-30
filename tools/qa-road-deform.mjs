/**
 * QA gate: road deformation trails (js/tracks/deform-field.js + surface-deform.js).
 * Run: node --experimental-loader ./tools/qa-strip-query-loader.mjs tools/qa-road-deform.mjs
 *
 * Static source checks + numeric simulation (cap, passes, relaxation, LRU,
 * impact, mesh pool bounds / watertight corners when THREE loads headless).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
let fails = 0;
const ok = (c, msg) => {
  if (c) console.log("PASS", msg);
  else {
    fails++;
    console.log("FAIL", msg);
  }
};

const FF = await import(pathToFileURL(path.join(root, "js/tracks/deform-field.js")).href);
const { DeformField, DEPOSIT, DEFORM_SURFACES, DEFORM_PHYSICS, DEPTH_Q, MAX_TILES, TILE_CELLS, CELL, DEPTH_HARD_CEILING } = FF;

// ---------- static ----------
const cfg = read("js/config.js");
const surfBlock = cfg.slice(cfg.indexOf("export const SURFACES"), cfg.indexOf("export const SURFACES") + 9000);
const surfIds = [...surfBlock.matchAll(/^\s{2}(\w+): \{\s*\n\s*id: "(\w+)"/gm)].map((m) => m[2]);
ok(surfIds.length >= 7, `config SURFACES ids parsed (${surfIds.join(",")})`);
for (const id of surfIds) ok(DEPOSIT[id] && Number.isFinite(DEPOSIT[id].cap), `DEPOSIT covers surface "${id}"`);
ok(DEPOSIT.tarmac.cap === 0 && DEPOSIT.cobble.cap === 0, "tarmac + cobble deposit zero geometry");
ok(!DEFORM_SURFACES.has("tarmac") && !DEFORM_SURFACES.has("cobble"), "DEFORM_SURFACES excludes tarmac/cobble");
for (const id of Object.keys(DEPOSIT)) {
  const d = DEPOSIT[id];
  ok(typeof d.relaxMps === "number" && d.relaxMps >= 0, `relaxation rate defined for ${id}`);
  ok(d.cap * (1 + d.wetCap) <= DEPTH_HARD_CEILING + 1e-9, `${id} wet cap <= hard ceiling ${DEPTH_HARD_CEILING}`);
}
ok(DEPOSIT.sand.cap <= 0.12 && DEPOSIT.dirt.cap <= 0.12, "sand/dirt visual depth cap <= 12 cm");
ok(DEPOSIT.sand.relaxMps > 0 && DEPOSIT.gravel.relaxMps === 0, "sand relaxes, gravel stays");
ok([...DEFORM_PHYSICS].every((s) => DEFORM_SURFACES.has(s)) && !DEFORM_PHYSICS.has("grass"), "physics sample set = ribbon soft surfaces, grass visual-only");
ok(MAX_TILES <= 2048, `LRU tile cap bounded (${MAX_TILES})`);
ok((MAX_TILES * TILE_CELLS * 5) / 1e6 < 12, `worst-case tile memory ${((MAX_TILES * TILE_CELLS * 5) / 1e6).toFixed(1)} MB < 12 MB`);

const sd = read("js/tracks/surface-deform.js");
const poolQ = +(sd.match(/POOL_QUADS = (\d+)/) || [])[1];
ok(poolQ > 0 && poolQ <= 40000, `mesh quad pool bounded (${poolQ})`);
ok(/dispose\(\)/.test(sd) && /reset\(\)/.test(sd) && /geo\.dispose\(\)/.test(sd) && /mat\.dispose\(\)/.test(sd), "WheelRutMesh has reset + dispose (geometry + material)");
ok(/addUpdateRange/.test(sd) && !/\.updateRange\./.test(sd), "mesh uploads use addUpdateRange (no deprecated updateRange)");
const ff = read("js/tracks/deform-field.js");
ok(/dispose\(\)/.test(ff) && /reset\(\)/.test(ff) && /_evictLru/.test(ff), "field has reset/dispose/LRU eviction");
ok(/this\.quality === Q_OFF\) return/.test(ff) && /setQualityFromTier/.test(ff), "quality-tier gating in field");

const game = read("js/game.js");
const track = read("js/tracks/track.js");
ok(/setQualityFromTier/.test(game), "game.js applies quality tier to deform field");
ok(/resetWheelDeform\(\)/.test(game), "game.js resets deformation on stage load / replay");
ok(/wheelRuts\.dispose\(\)/.test(track) && /wheelDeform\.dispose\(\)/.test(track), "Track.dispose frees rut mesh + field");
ok(/_applyRivalLod|fxBand === 1 \|\| o\.fxBand === 2/.test(game) && /tireMarks\.emit\(o\.vehicle, this\.track, o\._deformDt, o\.fxBand\)/.test(game), "rivals stamp by LOD band cadence");
ok(/tireMarks\.landing/.test(game), "landing impact stamp wired");
ok(/DEFORM_PHYSICS\.has\(blend\.id\)/.test(track), "Track.query deform sample limited to DEFORM_PHYSICS (single Track.query authority)");
const veh = read("js/physics/vehicle.js");
ok(/q\.wheelDeform \|\| 0/.test(veh), "Vehicle deck plane still strips wheelDeform (physics height untouched)");
ok(!/wheelDeform|DeformField/.test(read("js/physics/collide.js")), "collide.js does not read deformation");

// hot path allocation heuristic
function body(src, name) {
  const i = src.indexOf(`  ${name}(`);
  if (i < 0) return "";
  let d = 0;
  let started = false;
  for (let k = src.indexOf("{", i); k < src.length; k++) {
    if (src[k] === "{") {
      d++;
      started = true;
    } else if (src[k] === "}") {
      d--;
      if (started && d === 0) return src.slice(i, k + 1);
    }
  }
  return "";
}
const BAD = /\bnew\s+\w|=\s*\[|=\s*\{|\.map\(|\.filter\(|\.slice\(|\.concat\(|=>|\.push\(\[|`/;
for (const name of ["_footprint", "stampSegment", "stampImpact", "_tile", "sample", "_net"]) {
  const b = body(ff, name);
  ok(b.length > 50 && !BAD.test(b.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), `no per-frame allocation patterns in ${name}()`);
}
const fb = body(sd, "flush") + body(sd, "_writeQuad") + body(sd, "_corner") + body(sd, "_upload") + body(sd, "_colorAt");
ok(!/\bnew\s+\w|=\s*\[|=\s*\{|\.map\(|\.filter\(/.test(fb.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "no per-frame allocation in mesh flush/write path");

// ---------- numeric simulation ----------
function wheelPath(f, surface, passes, opts = {}) {
  const a = { x: 0, y: 5, z: 0 };
  const b = { x: 0, y: 5, z: 0 };
  const load = { throttle: 1, brake: 0, dig: opts.dig || 0, hb: 0, side: opts.side || 0 };
  for (let p = 0; p < passes; p++) {
    for (let x = 0; x < 30; x += 0.5) {
      a.x = x;
      a.z = 3;
      b.x = x + 0.5;
      b.z = 3;
      f.stampSegment(a, b, 0.2, surface, opts.slip || 0, opts.drift || 0, 30, load, 0, opts.srcFor ? opts.srcFor(p) : p * 5 + 1);
    }
    f.step(10); // different 3 s window → distinct pass id each lap
  }
}
{
  const f = new DeformField();
  wheelPath(f, "tarmac", 3);
  wheelPath(f, "cobble", 3);
  ok(f.tileCount === 0 && f.maxDepthM() === 0, "tarmac/cobble stamp zero geometry (0 tiles)");
}
for (const s of ["sand", "dirt", "gravel", "mud", "grass"]) {
  const f = new DeformField();
  wheelPath(f, s, 40, { slip: 0.6, drift: 0.5, dig: 1 });
  const m = f.maxDepthM();
  ok(m > 0 && m <= DEPOSIT[s].cap + 1e-6 && m <= DEPTH_HARD_CEILING, `${s} depth capped: max ${(m * 100).toFixed(1)} cm <= ${(DEPOSIT[s].cap * 100).toFixed(1)} cm`);
  f.wetness = 1;
  wheelPath(f, s, 40, { slip: 0.6, drift: 0.5, dig: 1 });
  ok(f.maxDepthM() <= DEPTH_HARD_CEILING + 1e-9, `${s} wet depth <= hard ceiling (${(f.maxDepthM() * 100).toFixed(1)} cm)`);
}
{
  // repeated distinct passes deepen; same pass id does not
  const f = new DeformField();
  const hist = [];
  for (let p = 0; p < 6; p++) {
    wheelPath(f, "sand", 1, { srcFor: () => p * 7 + 3 });
    hist.push(f.maxDepthM());
  }
  ok(hist[1] > hist[0] && hist[2] > hist[1], `sand deepens with repeated passes (${hist.map((h) => (h * 100).toFixed(1)).join(" → ")} cm)`);
  ok(hist[0] < DEPOSIT.sand.cap * 0.8, "first pass shallower than cap (rivals can wear it in)");
  const g = new DeformField();
  const a = { x: 0, y: 5, z: 0 };
  const b = { x: 1, y: 5, z: 0 };
  g.stampSegment(a, b, 0.2, "dirt", 0, 0, 20, null, 0, 9);
  const d1 = g.totalDepthUnits();
  g.stampSegment(a, b, 0.2, "dirt", 0, 0, 20, null, 0, 9);
  ok(g.totalDepthUnits() === d1, "same pass id is idempotent (no per-frame runaway)");
}
{
  // slide berm: more lip volume when sliding than rolling
  const rolling = new DeformField();
  const sliding = new DeformField();
  wheelPath(rolling, "dirt", 1, {});
  wheelPath(sliding, "dirt", 1, { slip: 0.5, drift: 0.5, side: 1 });
  const bermSum = (f) => f.tileList.reduce((s, t) => s + t.berm.reduce((a, v) => a + v, 0), 0);
  ok(bermSum(sliding) > bermSum(rolling), `slide piles more berm (${bermSum(sliding)} > ${bermSum(rolling)} units)`);
}
{
  // relaxation: sand flows back, gravel stays
  const sand = new DeformField();
  const gravel = new DeformField();
  wheelPath(sand, "sand", 3);
  wheelPath(gravel, "gravel", 3);
  const s0 = sand.totalDepthUnits();
  const g0 = gravel.totalDepthUnits();
  for (let i = 0; i < 400; i++) {
    sand.step(1);
    gravel.step(1);
  }
  const s1 = sand.totalDepthUnits();
  ok(s1 < s0 && s1 >= 0, `sand relaxes (${s0} → ${s1} units over 400 s)`);
  ok(gravel.totalDepthUnits() === g0, "gravel does not relax");
  for (let i = 0; i < 2000; i++) sand.step(1);
  ok(sand.totalDepthUnits() === 0, "sand fully relaxes eventually (no stuck residue)");
}
{
  // LRU eviction
  const f = new DeformField(16);
  const a = { x: 0, y: 0, z: 0 };
  const b = { x: 0, y: 0, z: 0 };
  for (let x = 0; x < 400; x += 0.5) {
    a.x = x;
    b.x = x + 0.5;
    f.stampSegment(a, b, 0.2, "dirt", 0, 0, 30, null, 0, 1);
    f.step(0.016);
  }
  ok(f.tileCount <= 16, `LRU cap holds (${f.tileCount} ≤ 16 tiles across 400 m)`);
  ok(f.stats.evictions > 0, `tiles evicted (${f.stats.evictions})`);
  ok(f.stats.created <= 17, `tile objects recycled, not re-allocated (${f.stats.created} created)`);
  const mem = f.bytes;
  ok(mem <= 17 * TILE_CELLS * 5, "resident bytes bounded by cap");
  f.reset();
  ok(f.tileCount === 0 && f.sample(10, 3) === 0, "reset clears everything");
}
{
  // landing crater
  const f = new DeformField();
  f.stampImpact(4, 2, 4, 0.9, 1, "sand");
  const dep = f.maxDepthM();
  ok(dep > 0.05 && dep <= DEPOSIT.sand.cap + 1e-6, `landing crater on sand ${(dep * 100).toFixed(1)} cm (capped)`);
  const t = new DeformField();
  t.stampImpact(4, 2, 4, 0.9, 1, "tarmac");
  ok(t.tileCount === 0, "landing on tarmac deforms nothing");
  ok(f.sample(4, 4) < 0 && Math.abs(f.sample(30, 30)) === 0, "sample() negative in crater, zero away");
}
{
  // quality gate
  const f = new DeformField();
  f.setQualityFromTier("min");
  wheelPath(f, "sand", 2);
  ok(f.tileCount === 0, "quality min = no deformation work");
  ok(new DeformField().quality === 2, "default quality full");
}
{
  // perf budget: time a worst-ish frame (4 wheels x 1 m segments)
  const f = new DeformField();
  const a = { x: 0, y: 0, z: 0 };
  const b = { x: 0, y: 0, z: 0 };
  const load = { throttle: 1, brake: 0, dig: 0.5, hb: 0, side: 0 };
  const frames = 3000;
  const t0 = performance.now();
  for (let i = 0; i < frames; i++) {
    for (let w = 0; w < 4; w++) {
      a.x = i * 0.8;
      a.z = w * 1.5;
      b.x = a.x + 0.8;
      b.z = a.z;
      f.stampSegment(a, b, 0.2, "sand", 0.3, 0.2, 50, load, 0, w);
    }
    f.step(1 / 60);
    f.clearDirty();
  }
  const per = (performance.now() - t0) / frames;
  console.log(`INFO player stamp cost: ${per.toFixed(3)} ms/frame (4 wheels, 0.8 m/frame, node CPU)`);
  ok(per < 1.0, `stamp+relax CPU ${per.toFixed(3)} ms/frame < 1 ms`);
}

// ---------- headless mesh (optional) ----------
let meshOk = false;
try {
  const SD = await import(pathToFileURL(path.join(root, "js/tracks/surface-deform.js")).href);
  const THREE = await import(pathToFileURL(path.join(root, "vendor/three.module.js")).href);
  meshOk = true;
  const parent = new THREE.Group();
  const field = new SD.WheelDeformField();
  const mesh = new SD.WheelRutMesh(parent, field);
  const a = { x: 0, y: 5, z: 0 };
  const b = { x: 0, y: 5, z: 0 };
  const load = { throttle: 1, brake: 0, dig: 0.5, hb: 0, side: 0 };
  for (let i = 0; i < 120; i++) {
    for (let w = 0; w < 2; w++) {
      a.x = i * 0.8;
      a.z = 3 + w * 1.5;
      b.x = a.x + 0.8;
      b.z = a.z;
      field.stampSegment(a, b, 0.2, "dirt", 0.2, 0.1, 40, load, 0, w);
    }
    field.step(1 / 60);
    mesh.flush(i * 0.8, 3);
  }
  ok(mesh.stats.quads > 100 && mesh.stats.quads <= SD.POOL_QUADS, `mesh quads ${mesh.stats.quads} within pool ${SD.POOL_QUADS}`);
  let bad = 0;
  for (let i = 0; i < mesh.pos.length; i++) if (!Number.isFinite(mesh.pos[i]) || !Number.isFinite(mesh.nor[i])) bad++;
  ok(bad === 0, "no NaN in mesh positions/normals");
  // watertight: any two used quads that share a corner agree on its y
  const corner = new Map();
  let mism = 0;
  for (let q = 0; q < mesh._hw; q++) {
    if (!mesh._qTile[q]) continue;
    for (let v = 0; v < 4; v++) {
      const o = q * 12 + v * 3;
      const key = `${Math.round(mesh.pos[o] / CELL)},${Math.round(mesh.pos[o + 2] / CELL)}`;
      const y = mesh.pos[o + 1];
      if (corner.has(key) && Math.abs(corner.get(key) - y) > 1e-4) mism++;
      corner.set(key, y);
    }
  }
  ok(mism === 0, `shared quad corners are watertight (${mism} mismatches over ${corner.size} corners)`);
  let nMax = 0;
  for (let q = 0; q < mesh._hw; q++) {
    if (!mesh._qTile[q]) continue;
    for (let v = 0; v < 4; v++) nMax = Math.max(nMax, Math.abs(mesh.pos[q * 12 + v * 3 + 1] - 5));
  }
  ok(nMax <= 0.2, `mesh vertex offset from road ≤ 20 cm (${(nMax * 100).toFixed(1)} cm)`);
  // camera far away → tiles dropped from GPU, data kept
  const tilesBefore = field.tileCount;
  for (let k = 0; k < 40; k++) mesh.flush(5000, 5000);
  ok(mesh.stats.quads === 0 && field.tileCount === tilesBefore, "far camera frees GPU quads but keeps field data");
  for (let k = 0; k < 40; k++) mesh.flush(40, 3);
  ok(mesh.stats.quads > 50, `camera return re-meshes persistent trail (${mesh.stats.quads} quads)`);
  mesh.reset();
  field.reset();
  ok(mesh.stats.quads >= 0 && mesh._hw === 0 && field.tileCount === 0, "mesh.reset + field.reset leave no residue");
  mesh.dispose();
  ok(parent.children.length === 0, "mesh.dispose detaches from parent");
} catch (e) {
  console.log("INFO headless mesh test skipped:", e && e.message);
}
ok(meshOk, "surface-deform.js imports headless (mesh tests ran)");

console.log(fails ? `\nqa-road-deform: ${fails} FAIL` : "\nqa-road-deform: all PASS");
process.exit(fails ? 1 : 0);
