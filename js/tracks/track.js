/**
 * Track builder — spline road with dynamic surfaces.
 *
 * WHO THIS IS FOR: course authors and the physics query.
 * WHAT IT DOES: turns piece lists into a sampled racing line, road mesh, and height/surface queries.
 * HOW IT CONNECTS: courses.js supplies pieces; Vehicle and AI call Track.query / sample.
 */

import * as THREE from "../../vendor/three.module.js";
import { mergeGeometries } from "../../vendor/BufferGeometryUtils.js";
import { SURFACES, COLORS, ROAD_DECK, LIGHTING, VISUAL, STREAM } from "../config.js?v=153";
import { roadMicroHeight } from "./road-micro.js?v=1";
import {
  shadowGeometry,
  shadowMaterial,
  crownGeometry,
  foliageMaterial,
  treeCardKind,
} from "./trees.js?v=33";
import {
  upgradeWorld,
  water as waterPbr,
  worldRoadMaterial,
  worldTerrainMaterial,
  worldSkirtMaterial,
  worldKerbMaterial,
  worldPropMaterial,
  upgradeWorldMaterials,
} from "../gfx/pbr.js?v=27";
import { paintedTexture } from "../gfx/saturn.js?v=1";
import { armCameraFade } from "../gfx/occlusion-fade.js?v=10";
import { preparePropKit, propGeometry, propCharacterParts, propForestTreeParts, propReady, propNatureMaterial, FOREST_TREE_KINDS, FOREST_CARD_KINDS, FOREST_STAGE_PALETTE, FOREST_MOUNTAIN_PALETTE } from "./prop-kit.js?v=24";
import { CrowdField, CROWD_CHARACTER_KINDS } from "./crowd.js?v=14";
import { pickPaceNote } from "./pace-call.mjs?v=3";
// Spectators: character-male-a … character-female-f biped GLBs (CrowdField).

const STEP = 3.2;

/**
 * Yield so the loading screen can paint and Chrome stays responsive.
 * Never use queueMicrotask — that keeps Track.create on the click turn and
 * the tab freezes while music keeps playing. setTimeout(0) still completes
 * headless QA when rAF is paused because the canvas is not painting.
 */
function yieldFrame() {
  return new Promise((resolve) => {
    let done = false;
    const fire = () => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(fire);
    setTimeout(fire, 0);
  });
}

/**
 * Yield only after a slice of real work, not after every tile row / plant step.
 * A 10 ms budget still paints the load bar without turning 80 rows into 80 rAF waits.
 * @param {number} [budgetMs]
 * @returns {() => Promise<void>}
 */
function createWorkYielder(budgetMs = 10) {
  let last = performance.now();
  return () => {
    const now = performance.now();
    if (now - last < budgetMs) return null;
    last = now;
    return yieldFrame();
  };
}

/**
 * Length of one streaming slice, in metres along the racing line.
 *
 * Everything the course builds — road ribbon, kerbs, skirts, trees, crowds,
 * barriers — is cut at these boundaries. Two things fall out of that:
 *   1. Each slice gets a tight bounding sphere, so the frustum can throw away
 *      the ~two thirds of the course that is behind the car. A single
 *      course-long InstancedMesh can never be culled: its bounding sphere
 *      always contains the camera.
 *   2. Slices past the fog wall can be switched off outright (see update()).
 *
 * 220 m is a compromise: short enough that a slice is either clearly in front
 * of you or clearly behind, long enough that a stage is ~12-16 slices rather
 * than a hundred tiny draws.
 */
const CHUNK_LEN = 220;

/** Grid cell for the nearest-spline-point lookup, in metres. */
const CELL = 32;

/**
 * Steepest grade a flyover lift ramp may build, as rise over run.
 *
 * Matches the steepest hand-authored geometry in the game (the Safari jump ramp
 * is 5.2 m over 30 m ≈ 17%), so a generated ramp never out-climbs anything a
 * course designer would draw. A lift that cannot fit inside this grade is
 * reduced rather than allowed to become a step in the road.
 */
const LIFT_GRADE_MAX = 0.18;

/**
 * Fallback cull distance when the scene has no fog, in metres. With fog the
 * limit comes from fog.far instead — culling anything nearer than that would
 * punch a hole in ground the player can still see through the haze.
 */
const STREAM_FAR = 1200;

/** Minimum clear strip beyond the painted edge — no props on the driven line. */
const ROAD_VERGE = 8.2;
/**
 * Collision-safe corridor past the painted edge (m). Car half-width (~0.95) +
 * nose/tail slack so no env solid can sit where the chassis drives.
 * Visual props may still dress the verge; physics spheres must clear THIS.
 */
const ROAD_COLLIDER_CLEAR = 3.8;
/** Extra clearance for tall forest pack trees (canopy radius at scale). */
const FOREST_TREE_CLEAR = 8.6;

/** How often each surface texture tiles along the ribbon (1 / meters per repeat). */
const ROAD_UV_SCALE = {
  tarmac: 0.07,
  gravel: 0.2,
  dirt: 0.14,
  cobble: 0.09,
  grass: 0.16,
  sand: 0.11,
  mud: 0.13,
};

/**
 * @typedef {{x:number,y:number,z:number,nx:number,nz:number,heading:number,width:number,surface:string,dist:number,tunnel?:boolean}} TrackPoint
 */

export class Track {
  /**
   * @param {object} def
   * @param {string} def.id
   * @param {string} def.name
   * @param {string} def.difficulty
   * @param {number} def.fog
   * @param {number} def.sky
   * @param {string} def.offroad
   * @param {Array<object>} def.pieces
   */
  constructor(def, opts = {}) {
    this.id = def.id;
    this.name = def.name;
    this.difficulty = def.difficulty;
    this.fogColor = def.fog;
    this.skyColor = def.sky;
    this.offroad = def.offroad || "grass";
    this.checkpoints = [];
    /** @type {TrackPoint[]} */
    this.points = [];
    this.length = 0;
    this.colliders = [];
    /** Colliders scrubbed from the roadway safety corridor (build audit). */
    this.corridorViolations = [];
    /** When true, overlapping corridor after scrub throws (QA / debug). */
    this.strictCorridor = false;
    /** @type {{startDist:number,endDist:number}[]} */
    this._tunnels = [];
    /** Wall-lamp world positions for the fixed PointLight pool. */
    this._tunnelLamps = [];
    this._fixedLampCache = null;
    this._fixedLampCount = 0;
    this.startDist = 12;
    this.finishDist = 0;
    this.group = new THREE.Group();
    /** Chunked objects that streaming is allowed to switch off. */
    this._streamable = [];
    /** @type {Map<number, number[]>|null} spline point index, keyed by grid cell */
    this._grid = null;
    this._chunkCount = 1;
    this._streamFrame = 0;
    this._streamLook = new THREE.Vector3();
    /** Lake meshes for tier-5 UV scroll. */
    this._waterMeshes = [];
    /** @type {import("./crowd.js").CrowdField|null} */
    this._crowd = null;
    /** Desert tumbleweeds — real twig balls that occasionally roll past. */
    this._tumbleweeds = null;
    this._tumbleWeedTime = 0;
    this._tumbleDummy = null;
    /** @type {{dist0:number,dist1:number,side:number|null,minOff:number,maxH:number}[]} */
    this._keepOut = [];
    this._def = def;
    // Known before skirts / height samples so trench width matches the land grid.
    this._landCell = STREAM.terrainTileSize / STREAM.terrainTileSegs;
    if (!opts.deferBuild) this._build(def.pieces, def);
  }

  /**
   * Build a stage across animation frames so the loading bar can update.
   * @param {(frac: number, status: string) => void} [onProgress]
   */
  static async create(def, onProgress) {
    const track = new Track(def, { deferBuild: true });
    await track.buildAsync(onProgress);
    return track;
  }

  /**
   * @param {(frac: number, status: string) => void} [onProgress]
   */
  async buildAsync(onProgress) {
    const def = this._def;
    /** Work-weighted overall fraction — matches real wall time better than even steps. */
    const report = (frac, status) => {
      if (onProgress) onProgress(Math.max(0, Math.min(1, frac)), status);
    };
    const tick = () => yieldFrame();

    report(0.02, "Sampling racing line…");
    await tick();
    this._buildSpline(def.pieces, def);

    report(0.08, "Laying tarmac & kerbs…");
    this._mesh = this._buildMesh(def);
    this.group.add(this._mesh);

    // Terrain is the bulk of first-load time — drive the bar from tile rows.
    report(0.1, "Sculpting terrain…");
    await this._addGroundAsync(def, (t) => report(0.1 + t * 0.42, "Sculpting terrain…"));

    report(0.52, "Loading trackside models…");
    await preparePropKit(def.scenery);

    report(0.54, "Planting trees & props…");
    await this._addSceneryBody(def, (t) => report(0.54 + t * 0.34, "Planting trees & props…"));

    report(0.88, "Tunnel & stage gates…");
    this._addTunnel();
    this._addStageGates();
    if (VISUAL.tracksideSignage && (VISUAL.tier || 0) >= 5) {
      this._addTracksideSignage(def);
    }
    this._scrubRoadwayColliders();
    this._scrubRoadwayVisuals();
    upgradeWorld(this.group);
    upgradeWorldMaterials(this.group);
    armCameraFade(this.group);

    report(1, "Course ready");
    await tick();
  }

  _build(pieces, def) {
    this._buildSpline(pieces, def);
    this._mesh = this._buildMesh(def);
    this.group.add(this._mesh);
    this._addGround(def);
    this._addScenery(def);
    this._addTunnel();
    this._addStageGates();
    if (VISUAL.tracksideSignage && (VISUAL.tier || 0) >= 5) {
      this._addTracksideSignage(def);
    }
    this._scrubRoadwayColliders();
    this._scrubRoadwayVisuals();
    upgradeWorld(this.group);
    upgradeWorldMaterials(this.group);
    armCameraFade(this.group);
  }

  _buildSpline(pieces, def) {
    let x = 0;
    let y = def.startY || 0;
    let z = 0;
    let heading = 0;
    let width = def.startWidth || 12;
    let surface = pieces[0]?.surface || "dirt";
    let dist = 0;

    const raw = [{ x, y, z, heading, width, surface, dist, tunnel: false }];

    for (const piece of pieces) {
      if (piece.width) width = piece.width;
      if (piece.surface) surface = piece.surface;
      const dy = piece.dy || 0;

      if (piece.type === "straight") {
        const n = Math.max(1, Math.round(piece.length / STEP));
        const ds = piece.length / n;
        const dyi = dy / n;
        for (let i = 0; i < n; i++) {
          heading += (piece.bend || 0) / n;
          x += Math.sin(heading) * ds;
          z += Math.cos(heading) * ds;
          y += dyi;
          dist += ds;
          if (piece.surfaceOut && i > n * 0.45) surface = piece.surfaceOut;
          raw.push({
            x, y, z, heading, width, surface, dist,
            tunnel: !!piece.tunnel,
            jump: !!piece.jump,
          });
        }
      } else if (piece.type === "curve") {
        const angle = (piece.angle * Math.PI) / 180;
        const radius = piece.radius;
        const arc = Math.abs(angle) * radius;
        const n = Math.max(2, Math.round(arc / STEP));
        const da = angle / n;
        const dyi = dy / n;
        const dir = Math.sign(angle) || 1;
        for (let i = 0; i < n; i++) {
          heading += da;
          const ds = Math.abs(da) * radius;
          x += Math.sin(heading) * ds;
          z += Math.cos(heading) * ds;
          y += dyi;
          dist += ds;
          if (piece.surfaceOut && i > n * 0.55) surface = piece.surfaceOut;
          raw.push({
            x, y, z, heading, width: piece.width || width, surface, dist,
            tunnel: !!piece.tunnel,
            jump: !!piece.jump,
            jumpKind: null,
            landmark: !!piece.landmark,
            sweep: !!piece.sweep,
          });
        }
        void dir;
      } else if (piece.type === "jump") {
        if (piece.width) width = piece.width;
        if (piece.surface) surface = piece.surface;
        const ramp = piece.ramp || 26;
        const rise = piece.rise || 3.4;
        const lip = piece.lip || 7;
        const gap = piece.gap || 20;
        const drop = piece.drop || 2.6;
        const land = piece.land || 24;
        const dropFast = Math.min(11, Math.max(8, gap * 0.4));
        const flyover = Math.max(10, gap - dropFast + 4);
        // Authored throw profile — Safari vs teaching hop must not share one arc.
        const jumpThrow =
          Math.max(0.45, rise / 3.2) * Math.max(0.55, gap / 18) * Math.max(0.7, drop / 2.4);
        const jumpLip = Math.max(
          0.4,
          (rise / Math.max(ramp, 8)) * (8 / Math.max(lip, 4)) * (1 + drop * 0.04)
        );
        const easeInSine = (t) => 1 - Math.cos((t * Math.PI) / 2);
        const pushPhase = (len, dyTotal, kind, ease) => {
          const step = kind === "ramp" ? 1.05 : 1.35;
          const n = Math.max(2, Math.round(len / step));
          for (let i = 0; i < n; i++) {
            const t0 = i / n;
            const t1 = (i + 1) / n;
            const k0 = ease ? easeInSine(t0) : t0;
            const k1 = ease ? easeInSine(t1) : t1;
            const dyi = dyTotal * (k1 - k0);
            const ds = len / n;
            x += Math.sin(heading) * ds;
            z += Math.cos(heading) * ds;
            y += dyi;
            dist += ds;
            const air = kind === "ramp" || kind === "crest" || kind === "gap";
            raw.push({
              x, y, z, heading, width, surface, dist,
              tunnel: false,
              jump: air || kind === "land",
              jumpKind: kind,
              jumpThrow,
              jumpLip,
              jumpDrop: drop,
            });
          }
        };
        pushPhase(ramp, rise, "ramp", true);
        pushPhase(Math.max(5, lip), 0, "crest", false);
        pushPhase(dropFast, -drop, "gap", true);
        pushPhase(flyover, 0, "gap", false);
        pushPhase(land, drop * 0.18, "land", true);
      }
      if (piece.checkpoint) {
        this.checkpoints.push(dist);
      }
    }

    this.length = dist;
    if (this.checkpoints.length === 0) {
      this.checkpoints = [this.length * 0.28, this.length * 0.55, this.length * 0.82, this.length * 0.98];
    }

    this.points = raw.map((p) => {
      const nx = Math.cos(p.heading);
      const nz = -Math.sin(p.heading);
      return { ...p, nx, nz };
    });
    // Self-crossings occupied the same XZ (Desert mud vs sweeper, Forest glade
    // vs sweep). Driving that diamond reset cars and killed the frame loop.
    // Mark the Desert underpass first so the flyover cannot lift a hairpin
    // into the rock-bridge hole.
    this._underpassRuns = [];
    this._underpassPrisms = [];
    this._landmarkFlats = [];
    if ((def.scenery || "forest") === "desert") {
      this._markDesertUnderpassCorridors();
    }
    this._separateOverlappingRibbon();

    // Tunnel runs must be known before the land plane: Desert raises a ridge
    // around them so the tube is not a gate in empty sand.
    this._markTunnelRuns();

    // Jump + landmark washes before land mesh — dirt/grass tris must not
    // fold walls through the ribbon (Forest/Mountain same failure as Desert).
    this._markJumpCorridors();
    this._markLandmarkFlats();
    // Forest finale + full Mountain/Desert corridor — land stays a floor so the car
    // never clips through heightmap polygons on the racing line.
    this._markDriveClearCorridors(def);

    // The spatial index has to exist before anything asks for ground height:
    // _groundHeight() runs thousands of times while the land plane and the
    // scenery are being placed, and each call needs the nearest spline point.
    this._buildIndex();
  }

  /**
   * When two ribbons occupy the same XZ at nearly the same Y (a later sweeper
   * crossing earlier mud), lift the later one into a short flyover.
   *
   * Land still tucks under the *lower* deck (`overlapBed`), so the first pass
   * stays a road. The return line becomes a ~7 m hill instead of a second
   * tarmac inside the first — that diamond was the reset/crash point.
   */
  _separateOverlappingRibbon() {
    const pts = this.points;
    const n = pts.length;
    if (n < 40) return;
    const CLEAR = 7.4;
    const half = 24;
    for (let pass = 0; pass < 6; pass++) {
      let hits = 0;
      for (let i = 0; i < n; i += 2) {
        const a = pts[i];
        if (a.jumpKind === "gap" || a.jumpKind === "crest" || a.jumpKind === "ramp") continue;
        for (let j = i + 24; j < n; j += 2) {
          const b = pts[j];
          if (b.tunnel || b.underpass) continue;
          if (a.underpass) continue;
          if (b.jumpKind === "gap" || b.jumpKind === "crest" || b.jumpKind === "ramp") continue;
          const along = b.dist - a.dist;
          if (along < 80) continue;
          const xz = Math.hypot(b.x - a.x, b.z - a.z);
          const need = (a.width + b.width) * 0.5 + 3;
          if (xz >= need) continue;
          const yGap = b.y - a.y;
          if (yGap >= CLEAR || a.y - b.y >= CLEAR) continue;
          const lift = a.y + CLEAR - b.y;
          if (lift <= 0.05) continue;

          // Tunnel and underpass posts cannot move: their tube geometry is
          // built around a fixed floor. Skipping them mid-ramp is what broke
          // Desert — post #934 was lifted to 24.7 m while #935, the first post
          // of the finale underpass, stayed at 15.9 m, leaving an 8.9 m cliff
          // in the middle of the road at 2438 m. The car drove off it at
          // 48 m/s and the guard logged under-world + y-warp.
          //
          // So fade the ramp to zero *before* the first protected post, and
          // only lift as much as the remaining run can carry at a drivable
          // grade. Next to an underpass that means almost no lift, which is
          // right: the underpass already is the grade-separated crossing.
          const j0 = this._liftRampEnd(j, -1, half);
          const j1 = this._liftRampEnd(j, 1, half);
          if (j0 >= j || j1 <= j) continue;
          const runBack = b.dist - pts[j0].dist;
          const runFwd = pts[j1].dist - b.dist;
          const room = Math.min(runBack, runFwd);
          // All or nothing, and this matters: a *partial* lift never reaches
          // CLEAR, so every remaining pass re-applies it. Clamping the height
          // instead of refusing the lift stacked a 12.5 m hump that still had
          // to fall to the underpass floor inside 16 m — a 154% wall in place
          // of the old 8.9 m cliff. Smoothstep's steepest point is 1.5x the
          // average grade, so this is the real worst-case test. Where the ramp
          // will not fit, the crossing is already grade-separated by the
          // tunnel or underpass that is limiting the run.
          if (lift * 1.5 > LIFT_GRADE_MAX * room) continue;
          hits += 1;
          for (let k = j0; k <= j1; k++) {
            const span = k < j ? runBack : runFwd;
            if (span <= 1e-6) continue;
            const t = 1 - Math.abs(pts[k].dist - b.dist) / span;
            if (t <= 0) continue;
            const w = t * t * (3 - 2 * t);
            pts[k].y += lift * w;
          }
        }
      }
      if (!hits) break;
    }
  }

  /**
   * Furthest spline index a flyover ramp may reach from `j` before it runs into
   * a post that must not move (tunnel / underpass floor).
   *
   * @param {number} j centre post of the lift
   * @param {number} dir -1 backwards along the stage, +1 forwards
   * @param {number} half maximum posts to walk
   * @returns {number} last safe index, or `j` when a protected post is adjacent
   */
  _liftRampEnd(j, dir, half) {
    const pts = this.points;
    let end = j;
    for (let s = 1; s <= half; s++) {
      const k = j + dir * s;
      if (k < 0 || k >= pts.length) break;
      if (pts[k].tunnel || pts[k].underpass) break;
      end = k;
    }
    return end;
  }

  /**
   * Uniform grid over the racing line so "which spline post is nearest to this
   * world XZ?" stops being a linear scan.
   *
   * WHY IT MATTERS: a stage is 1500-2500 spline posts. The land plane alone
   * asks that question once per vertex (65x65 = 4225), and every tree, rock,
   * house, and lake disc asks it again. Linear scanning was ~10 million
   * distance tests per stage load, which showed up as a visible hitch between
   * championship rounds — not as frame time, but the player still feels it.
   */
  _buildIndex() {
    const pts = this.points;
    this._chunkCount = Math.max(1, Math.ceil(this.length / CHUNK_LEN));
    const grid = new Map();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const key = cellKey(Math.floor(p.x / CELL), Math.floor(p.z / CELL));
      let bucket = grid.get(key);
      if (!bucket) {
        bucket = [];
        grid.set(key, bucket);
      }
      bucket.push(i);
    }
    this._grid = grid;
  }

  /**
   * Index of the nearest spline post to a world XZ, plus that distance.
   *
   * Exact inside ~96 m (the grid rings terminate only once the best hit is
   * provably closer than the next unscanned ring). Beyond that it falls back
   * to a strided scan plus a local refine: out there the query is only feeding
   * terrain blends that are already flat, so a few metres of slop is invisible
   * and the exact answer is not worth 2000 more distance tests.
   *
   * @param {number} x
   * @param {number} z
   * @returns {{i:number, d:number}}
   */
  _nearestPointIndex(x, z) {
    const pts = this.points;
    let bestI = 0;
    let bestD2 = Infinity;
    const grid = this._grid;
    if (grid) {
      const gx = Math.floor(x / CELL);
      const gz = Math.floor(z / CELL);
      for (let ring = 0; ring <= 3; ring++) {
        for (let dx = -ring; dx <= ring; dx++) {
          const ax = dx < 0 ? -dx : dx;
          for (let dz = -ring; dz <= ring; dz++) {
            const az = dz < 0 ? -dz : dz;
            if (ax !== ring && az !== ring) continue;
            const bucket = grid.get(cellKey(gx + dx, gz + dz));
            if (!bucket) continue;
            for (let k = 0; k < bucket.length; k++) {
              const p = pts[bucket[k]];
              const ddx = x - p.x;
              const ddz = z - p.z;
              const d2 = ddx * ddx + ddz * ddz;
              if (d2 < bestD2) {
                bestD2 = d2;
                bestI = bucket[k];
              }
            }
          }
        }
        const safe = ring * CELL;
        if (bestD2 <= safe * safe) return { i: bestI, d: Math.sqrt(bestD2) };
      }
    }
    const stride = Math.max(1, (pts.length / 110) | 0);
    let coarse = 0;
    let coarseD2 = Infinity;
    for (let i = 0; i < pts.length; i += stride) {
      const p = pts[i];
      const ddx = x - p.x;
      const ddz = z - p.z;
      const d2 = ddx * ddx + ddz * ddz;
      if (d2 < coarseD2) {
        coarseD2 = d2;
        coarse = i;
      }
    }
    const i0 = Math.max(0, coarse - stride);
    const i1 = Math.min(pts.length - 1, coarse + stride);
    for (let i = i0; i <= i1; i++) {
      const p = pts[i];
      const ddx = x - p.x;
      const ddz = z - p.z;
      const d2 = ddx * ddx + ddz * ddz;
      if (d2 < coarseD2) {
        coarseD2 = d2;
        coarse = i;
      }
    }
    if (coarseD2 < bestD2) {
      bestD2 = coarseD2;
      bestI = coarse;
    }
    return { i: bestI, d: Math.sqrt(bestD2) };
  }

  /**
   * Which streaming slice a world position belongs to.
   * @param {number} x
   * @param {number} z
   * @returns {number}
   */
  _chunkAt(x, z) {
    const hit = this._nearestPointIndex(x, z);
    return this._chunkOfDist(this.points[hit.i].dist);
  }

  /**
   * Slice index for a distance along the racing line. Prefer this over
   * _chunkAt whenever the caller already has a spline point in hand — the
   * lookup is the expensive half.
   * @param {number} dist
   * @returns {number}
   */
  _chunkOfDist(dist) {
    return Math.min(this._chunkCount - 1, Math.max(0, Math.floor(dist / CHUNK_LEN)));
  }

  /**
   * GTA-style streaming — geometry loads while still inside fog, unloads only
   * after it is fully haze-hidden. Multi-anchor (player, camera, lookahead)
   * prevents chase-cam and high-speed pop-in.
   *
   * @param {THREE.Vector3} playerPos
   * @param {THREE.Vector3} [cameraPos]
   * @param {{ fogFar?: number, progress?: number, speed?: number, yaw?: number }} [opts]
   */
  update(playerPos, cameraPos, opts = {}) {
    const list = this._streamable;
    if (!list || !list.length) return;
    const player = playerPos || cameraPos;
    const camera = cameraPos || playerPos;
    if (!player) return;

    const fogFar = opts.fogFar && opts.fogFar > 0 ? opts.fogFar : 0;
    let loadR;
    let unloadR;
    if (fogFar > 0) {
      loadR = Math.max(fogFar * STREAM.loadFogFactor, STREAM.minLoadRadius);
      unloadR = Math.max(fogFar * STREAM.unloadFogFactor, STREAM.minLoadRadius + STREAM.hysteresis);
    } else {
      loadR = STREAM.loadRadius;
      unloadR = STREAM.unloadRadius;
    }
    if (unloadR < loadR + STREAM.hysteresis) unloadR = loadR + STREAM.hysteresis;
    if (opts.settle) {
      const settleR = STREAM.countdownLoadRadius != null ? STREAM.countdownLoadRadius : 720;
      loadR = Math.max(loadR, settleR);
      unloadR = Math.max(unloadR, loadR + STREAM.hysteresis);
    }

    const speed = opts.speed && opts.speed > 0 ? opts.speed : 0;
    const yaw = opts.yaw || 0;
    const lookM = speed * STREAM.lookaheadSeconds;
    if (lookM > 1) {
      this._streamLook.set(
        player.x + Math.sin(yaw) * lookM,
        player.y,
        player.z + Math.cos(yaw) * lookM
      );
    }

    let prefetch = null;
    const ahead = STREAM.prefetchChunks | 0;
    if (ahead > 0 && opts.progress != null && Number.isFinite(opts.progress)) {
      const pc = this._chunkOfDist(opts.progress);
      prefetch = new Set();
      for (let c = pc - ahead; c <= pc + ahead; c++) {
        if (c >= 0 && c < this._chunkCount) prefetch.add(c);
      }
    }

    for (let i = 0; i < list.length; i++) {
      const obj = list[i];
      const sphere = obj.userData.bounds;
      if (!sphere) continue;

      const dPlayer = sphere.center.distanceTo(player) - sphere.radius;
      const dCam = camera ? sphere.center.distanceTo(camera) - sphere.radius : dPlayer;
      let dNear = dPlayer < dCam ? dPlayer : dCam;
      if (lookM > 1) {
        const dLook = sphere.center.distanceTo(this._streamLook) - sphere.radius;
        if (dLook < dNear) dNear = dLook;
      }

      let want;
      if (obj.userData.streamVisible === true) want = dNear < unloadR;
      else want = dNear < loadR;

      if (!want && prefetch && obj.userData.chunk >= 0 && prefetch.has(obj.userData.chunk)) {
        want = dNear < loadR * 1.12;
      }

      const lod = obj.userData.lod;
      if ((lod === "hi" || lod === "lo") && STREAM.lodNear) {
        let band = obj.userData.lodBand || 0;
        const near = STREAM.lodNear;
        const hyst = STREAM.lodHysteresis || 22;
        if (dNear < near) band = 1;
        else if (dNear > near + hyst) band = 2;
        else if (!band) band = dNear < near + hyst * 0.5 ? 1 : 2;
        obj.userData.lodBand = band;
        if (lod === "hi") want = want && band !== 2;
        else want = want && band === 2;
      }

      obj.visible = want;
      obj.userData.streamVisible = want;
    }
    this._tickWaterScroll();
    this._tickTumbleweeds(player);
    if (this._crowd) {
      this._crowd.update(
        performance.now() * 0.001,
        player,
        opts.speed && opts.speed > 0 ? opts.speed : 0
      );
    }
  }

  /**
   * World points for crowd SFX (chest height). Empty when no spectators.
   * @returns {Array<{x:number,y:number,z:number}>}
   */
  crowdPoints() {
    return this._crowd && this._crowd.points ? this._crowd.points : [];
  }

  /**
   * Cheap lake motion — scrolls the painted ripple map (Sprint 15 tier 5).
   */
  _tickWaterScroll() {
    if (!VISUAL.waterScroll || (VISUAL.tier || 0) < 5) return;
    const list = this._waterMeshes;
    if (!list || !list.length) return;
    const t = performance.now() * 0.001;
    for (let i = 0; i < list.length; i++) {
      const mat = list[i].material;
      if (mat && mat.map) {
        mat.map.offset.set(t * 0.038, t * 0.021);
      }
    }
  }

  /**
   * Scale factor for contact shadow blobs under props.
   * @returns {number}
   */
  _contactShadowScale() {
    return (VISUAL.tier || 0) >= 5 && VISUAL.contactShadowBoost !== false ? 1.28 : 1;
  }

  /**
   * Push one ground-contact shadow instance.
   * @param {Array<object>} shadows
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} chunk
   * @param {number} radius
   */
  _pushContactShadow(shadows, x, y, z, chunk, radius) {
    const s = this._contactShadowScale();
    shadows.push({
      c: chunk,
      x,
      y: y + 0.03,
      z,
      sx: radius * s,
      sy: 1,
      sz: radius * 0.86 * s,
      ry: 0,
    });
  }

  /** Failure path: put every slice back on screen. */
  showAllChunks() {
    for (const obj of this._streamable) {
      obj.visible = true;
      obj.userData.streamVisible = true;
    }
  }

  /**
   * Force-on nearby slices so the start grid is fully drawn before countdown.
   * @param {THREE.Vector3} playerPos
   * @param {THREE.Vector3} [cameraPos]
   * @param {number} [radius]
   */
  prewarmAround(playerPos, cameraPos, radius) {
    const r = radius != null ? radius : STREAM.countdownLoadRadius || 720;
    const list = this._streamable;
    if (!list || !list.length || !playerPos) return;
    const cam = cameraPos || playerPos;
    for (let i = 0; i < list.length; i++) {
      const obj = list[i];
      const sphere = obj.userData.bounds;
      if (!sphere) {
        obj.visible = true;
        obj.userData.streamVisible = true;
        continue;
      }
      const dP = sphere.center.distanceTo(playerPos) - sphere.radius;
      const dC = sphere.center.distanceTo(cam) - sphere.radius;
      const d = dP < dC ? dP : dC;
      if (d < r) {
        obj.visible = true;
        obj.userData.streamVisible = true;
      }
    }
  }

  /**
   * Register a slice so streaming can reach it, and give it a tight bounding
   * sphere the frustum test can actually use. Parenting is left to the caller.
   *
   * Everything a course builds is authored in world coordinates with the track
   * group at the origin, so the local bounding sphere is already the world one.
   *
   * @param {THREE.Object3D} obj
   * @param {number} chunk
   */
  _registerChunk(obj, chunk) {
    obj.userData.chunk = chunk;
    obj.userData.streamVisible = false;
    obj.visible = false;
    try {
      if (obj.isInstancedMesh) obj.computeBoundingSphere();
      else if (obj.geometry && !obj.geometry.boundingSphere) obj.geometry.computeBoundingSphere();
      obj.updateWorldMatrix(true, false);
      const box = new THREE.Box3().setFromObject(obj);
      if (!box.isEmpty()) {
        obj.userData.bounds = box.getBoundingSphere(new THREE.Sphere());
      } else {
        const src = obj.isInstancedMesh ? obj.boundingSphere : obj.geometry && obj.geometry.boundingSphere;
        if (src) obj.userData.bounds = src.clone();
      }
      if (obj.userData.bounds) {
        obj.userData.bounds = obj.userData.bounds.clone();
        obj.userData.bounds.radius += STREAM.boundsPadding;
      }
    } catch (err) {
      console.warn("Chunk bounds failed", err);
    }
    this._streamable.push(obj);
  }

  _addGround(def) {
    const b = this._trackBounds();
    const pad = 980;
    const span = Math.max(b.spanX + pad * 2, b.spanZ + pad * 2, 1800);
    this._addLandPlane(def, b, span);
    this._addBackdropBiome(def, b);
  }

  /**
   * Yield between terrain tile rows so the loading screen stays responsive.
   * @param {object} def
   * @param {(rowFrac: number) => void} [onRowProgress] 0–1 over land tiles only
   */
  async _addGroundAsync(def, onRowProgress) {
    const b = this._trackBounds();
    const pad = 980;
    const span = Math.max(b.spanX + pad * 2, b.spanZ + pad * 2, 1800);
    await this._addLandPlaneAsync(def, b, span, onRowProgress);
    this._addBackdropBiome(def, b);
  }

  /**
   * Axis-aligned bounds of the racing line — land and hills are sized from this
   * so a long stage never runs off a plane centered on the origin.
   */
  _trackBounds() {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let maxR = 0;
    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const cx = (minX + maxX) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      const r = Math.hypot(p.x - cx, p.z - cz);
      if (r > maxR) maxR = r;
    }
    return {
      minX,
      maxX,
      minZ,
      maxZ,
      minY,
      maxY,
      cx,
      cz,
      spanX: maxX - minX,
      spanZ: maxZ - minZ,
      maxR,
    };
  }

  /**
   * Pad beyond the track AABB so treeline rings sit on authored terrain, not open sky.
   * @param {string} scenery
   * @returns {number}
   */
  _landPad(scenery) {
    if (scenery === "forest" || scenery === "mountain") return 640;
    if (scenery === "desert") return 520;
    if (scenery === "lakeside") return 420;
    return STREAM.terrainTileSize * 0.5;
  }

  /**
   * Ground Y for scenery — same heightmap as the visible land mesh.
   * @param {number} x
   * @param {number} z
   * @param {string} scenery
   * @returns {number}
   */
  _footSceneryY(x, z, scenery) {
    return this._groundHeight(x, z, scenery);
  }

  /**
   * Plant a backdrop prop on the land surface (never track minY — that floated props).
   * @param {object} pose
   * @param {string} scenery
   * @returns {object}
   */
  _groundBackdropPose(pose, scenery) {
    if (pose && Number.isFinite(pose.x) && Number.isFinite(pose.z)) {
      pose.y = this._footSceneryY(pose.x, pose.z, scenery);
    }
    return pose;
  }

  /**
   * Heightmapped country tiled for GTA-style streaming. Each tile registers
   * with update() so only ground near the player is drawn.
   */
  _addLandPlane(def, b, span) {
    const scenery = def.scenery || "forest";
    const desert = scenery === "desert";
    const tileSize = STREAM.terrainTileSize;
    const segs = STREAM.terrainTileSegs;
    this._landCell = tileSize / segs;
    const pad = this._landPad(scenery);
    const minX = b.minX - pad;
    const maxX = b.maxX + pad;
    const minZ = b.minZ - pad;
    const maxZ = b.maxZ + pad;
    const x0 = Math.floor(minX / tileSize) * tileSize;
    const z0 = Math.floor(minZ / tileSize) * tileSize;

    const floorHex =
      scenery === "desert"
        ? 0xc4a878
        : scenery === "mountain"
          ? 0x7a6e58
          : scenery === "lakeside"
            ? 0x4a6a52
            : 0x324828;

    for (let tz = z0; tz < maxZ; tz += tileSize) {
      for (let tx = x0; tx < maxX; tx += tileSize) {
        const cx = tx + tileSize * 0.5;
        const cz = tz + tileSize * 0.5;
        this._addLandTile(def, scenery, desert, b, cx, cz, tileSize, segs, floorHex);
      }
    }
  }

  /**
   * Same as _addLandPlane but yields on a time budget so the load bar can paint.
   * @param {object} def
   * @param {object} b
   * @param {number} span unused — kept for parity with _addLandPlane
   * @param {(rowFrac: number) => void | Promise<void>} [onRowProgress]
   */
  async _addLandPlaneAsync(def, b, span, onRowProgress) {
    const scenery = def.scenery || "forest";
    const desert = scenery === "desert";
    const tileSize = STREAM.terrainTileSize;
    const segs = STREAM.terrainTileSegs;
    this._landCell = tileSize / segs;
    const pad = this._landPad(scenery);
    const minX = b.minX - pad;
    const maxX = b.maxX + pad;
    const minZ = b.minZ - pad;
    const maxZ = b.maxZ + pad;
    const x0 = Math.floor(minX / tileSize) * tileSize;
    const z0 = Math.floor(minZ / tileSize) * tileSize;

    const floorHex =
      scenery === "desert"
        ? 0xc4a878
        : scenery === "mountain"
          ? 0x7a6e58
          : scenery === "lakeside"
            ? 0x4a6a52
            : 0x324828;

    const rows = [];
    for (let tz = z0; tz < maxZ; tz += tileSize) rows.push(tz);
    const yieldWork = createWorkYielder(10);
    for (let ri = 0; ri < rows.length; ri++) {
      const tz = rows[ri];
      for (let tx = x0; tx < maxX; tx += tileSize) {
        const cx = tx + tileSize * 0.5;
        const cz = tz + tileSize * 0.5;
        this._addLandTile(def, scenery, desert, b, cx, cz, tileSize, segs, floorHex);
      }
      if (onRowProgress) onRowProgress((ri + 1) / rows.length);
      const wait = yieldWork();
      if (wait) await wait;
    }
  }

  /**
   * One streamable terrain tile — heightmapped land only (no infinite underfill plane).
   * @param {object} def
   * @param {string} scenery
   * @param {boolean} desert
   * @param {object} b track bounds
   * @param {number} cx world centre X
   * @param {number} cz world centre Z
   * @param {number} tileSize
   * @param {number} segs
   * @param {number} floorHex
   */
  _addLandTile(def, scenery, desert, b, cx, cz, tileSize, segs, floorHex) {
    const geo = new THREE.PlaneGeometry(tileSize, tileSize, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = [];
    const c = new THREE.Color();
    const bedDrop =
      scenery === "mountain" ? 1.2 : scenery === "forest" ? 1.15 : desert ? 1.15 : 0.9;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + cx;
      const z = pos.getZ(i) + cz;
      const near = this._nearestRoad(x, z);
      // Pass `near` through so _groundHeight does not re-query the same sample.
      let h = this._groundHeight(x, z, scenery, near);
      // Absolute: in the drive corridor, land never rises above the nearest
      // ribbon deck — tunnel ridge / mouth cut must not punch the exit apron.
      {
        const over = near.minOver != null ? near.minOver : near.dist - near.roadW * 0.5;
        if (over < ROAD_VERGE + 2.4) {
          h = Math.min(h, near.roadY - bedDrop);
        }
      }
      if (desert && this._inUnderpassCorridor(x, z)) {
        // Floor Y is the BRIDGE sample, not nearest-road — a hairpin arm
        // looping back would otherwise fill the hole with a sand slab.
        const floor = this._underpassFloorY(x, z);
        h = floor != null ? floor : near.roadY - 0.14;
      } else if (desert && this._inTunnelCutAt(x, z)) {
        // Keep the authored tunnel ridge from _groundHeight — landmark wash /
        // chase flatten would plane it off and leave the portal floating.
      } else if (this._inLandmarkFlat(near.along, near.dist, near.roadW)) {
        h = Math.min(h, near.roadY - bedDrop);
      } else if (near.dist < this._trenchWidth(near.roadW)) {
        // min() — never raise a hairpin-low floor up to the nearer (higher) arm.
        h = Math.min(h, near.roadY - bedDrop);
      } else if (scenery === "mountain") {
        // Hard bed through chase-cam verge — soft banks were still clipping the chassis.
        const chase = near.roadW * 0.5 + 48;
        if (near.dist < chase) {
          const bed = near.roadY - bedDrop;
          h = Math.min(h, bed + Math.max(0, near.dist - this._trenchWidth(near.roadW)) * 0.015);
        }
      } else if (scenery === "forest") {
        const chase = near.roadW * 0.5 + 28;
        if (near.dist < chase) {
          const bed = near.roadY - bedDrop;
          h = Math.min(h, bed + Math.max(0, near.dist - this._trenchWidth(near.roadW)) * 0.03);
        }
      } else if (desert) {
        // Same chase flatten as Mountain — dunes used to rise the instant the
        // trench ended, so 10 m cells interpolated sand banks onto the asphalt.
        const chase = near.roadW * 0.5 + 56;
        if (near.dist < chase) {
          const bed = near.roadY - bedDrop;
          h = Math.min(h, bed + Math.max(0, near.dist - this._trenchWidth(near.roadW)) * 0.012);
        }
      } else if (scenery === "lakeside") {
        const chase = near.roadW * 0.5 + 40;
        if (near.dist < chase) {
          const bed = near.roadY - bedDrop;
          h = Math.min(h, bed + Math.max(0, near.dist - this._trenchWidth(near.roadW)) * 0.04);
        }
      }
      // Absolute refuse: ANY nearby ribbon (not just nearest) — hairpin arms
      // looping back must not receive a hill interpolated from the other arm.
      // Skip inside the underpass prism: overlapBed from the hairpin opposite
      // arm used to drop a trench under the deck (road backfaces).
      if (!(desert && this._inUnderpassCorridor(x, z))) {
        const tunnelCut = desert && this._inTunnelCutAt(x, z);
        // Drive corridor always stays a floor — tunnel ridge may rise only
        // past the verge. A 2.4 m refuse let 10 m land tris fold rock onto
        // the exit apron and through the car.
        const refusePad = tunnelCut
          ? Math.max(ROAD_VERGE + 4.5, 14)
          : ROAD_COLLIDER_CLEAR + Math.max(this._landCell || 12, 10) * (desert ? 0.55 : 0.35);
        const overPaint = near.minOver < refusePad;
        if (overPaint) {
          const bed = near.overlapBed != null ? near.overlapBed : near.roadY;
          h = Math.min(h, bed - bedDrop);
        } else if (!tunnelCut) {
          if (near.overlapBed != null) {
            h = Math.min(h, near.overlapBed - bedDrop);
          } else if (
            near.dist < near.roadW * 0.5 + ROAD_VERGE + Math.max(this._landCell || 12, 12)
          ) {
            h = Math.min(h, near.roadY - bedDrop);
          }
        }
        if (near.minOver < ROAD_COLLIDER_CLEAR + 0.25) {
          h = Math.min(h, near.roadY - ROAD_DECK - 0.14);
        }
      }
      pos.setY(i, h);
      this._biomeTint(c, scenery, h, near.roadY, x, z);
      if (VISUAL.aerialPerspective && (VISUAL.tier || 0) >= 4) {
        this._applyAerialPerspective(c, scenery, near.dist);
      }
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const landMap = landAlbedoMap(scenery, tileSize);
    const landNorm = landNormalMap(scenery, tileSize);
    const landRough = landRoughnessMap(scenery, tileSize);
    const land = new THREE.Mesh(
      geo,
      worldTerrainMaterial({
        map: landMap || null,
        normalMap: landNorm || null,
        roughnessMap: landRough || null,
        vertexColors: true,
        side: THREE.FrontSide,
      })
    );
    land.position.set(cx, 0, cz);
    land.receiveShadow = true;
    land.renderOrder = -1;
    land.userData.envLand = true;
    if (land.material) {
      land.material.polygonOffset = true;
      land.material.polygonOffsetFactor = 2;
      land.material.polygonOffsetUnits = 2;
    }
    this.group.add(land);
    this._registerChunk(land, -1);
  }

  /**
   * Height of the visible land mesh at (x, z). Trees must use this — biome
   * hills alone float above the wash that tucks the plane under the ribbon.
   * @param {number} x
   * @param {number} z
   * @param {string} scenery
   */
  /**
   * Visit spline segments that can own a world XZ: the local window around the
   * Euclidean-nearest sample, plus every sample in nearby grid cells so a
   * hairpin's opposite arm is not invisible to ribbon tests.
   * @param {number} x
   * @param {number} z
   * @param {(i: number) => void} visit
   */
  _forNearbySegments(x, z, visit) {
    const pts = this.points;
    if (pts.length < 2) return;
    const hit = this._nearestPointIndex(x, z);
    const i0 = Math.max(0, hit.i - 28);
    const i1 = Math.min(pts.length - 2, hit.i + 28);
    for (let i = i0; i <= i1; i++) visit(i);
    const grid = this._grid;
    if (!grid) return;
    const gx = Math.floor(x / CELL);
    const gz = Math.floor(z / CELL);
    for (let dx = -5; dx <= 5; dx++) {
      for (let dz = -5; dz <= 5; dz++) {
        const bucket = grid.get(cellKey(gx + dx, gz + dz));
        if (!bucket) continue;
        for (let k = 0; k < bucket.length; k++) {
          const i = bucket[k];
          if (i < 0 || i >= pts.length - 1) continue;
          if (i >= i0 && i <= i1) continue;
          visit(i);
        }
      }
    }
  }

  /**
   * Closest point on the racing ribbon — lateral metres from centreline, not
   * Euclidean distance to a spline sample (hairpins fooled the old test).
   * @param {number} x
   * @param {number} z
   */
  _nearestRoad(x, z) {
    const pts = this.points;
    const empty = {
      dist: 1e6,
      roadY: 0,
      roadW: 14,
      tunnel: false,
      side: 0,
      along: 0,
      minOver: 1e6,
      overlapBed: null,
    };
    if (!pts.length) return empty;

    const pad = ROAD_VERGE + Math.max((this._landCell || 12) * 2.4, 32);
    let bestLat = Infinity;
    let bestSide = 0;
    let bestAlong = 0;
    let bestY = 0;
    let bestW = 14;
    let bestTunnel = false;
    let minOver = Infinity;
    let overlapBed = Infinity;

    this._forNearbySegments(x, z, (i) => {
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len2 = dx * dx + dz * dz;
      let t = 0;
      if (len2 > 1e-6) {
        t = ((x - a.x) * dx + (z - a.z) * dz) / len2;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
      }
      const px = a.x + dx * t;
      const pz = a.z + dz * t;
      const nx = a.nx + (b.nx - a.nx) * t;
      const nz = a.nz + (b.nz - a.nz) * t;
      const side = (x - px) * nx + (z - pz) * nz;
      const lat = Math.abs(side);
      const w = a.width + (b.width - a.width) * t;
      const y = a.y + (b.y - a.y) * t;
      const over = lat - w * 0.5;
      if (over < minOver) minOver = over;
      if (lat < w * 0.5 + pad && y < overlapBed) overlapBed = y;
      if (lat < bestLat) {
        bestLat = lat;
        bestSide = side;
        bestAlong = a.dist + (b.dist - a.dist) * t;
        bestY = y;
        bestW = w;
        bestTunnel = !!(a.tunnel || b.tunnel);
      }
    });

    if (!Number.isFinite(bestLat)) {
      const hit = this._nearestPointIndex(x, z);
      const p = pts[hit.i];
      const side = (x - p.x) * p.nx + (z - p.z) * p.nz;
      const over = Math.abs(side) - p.width * 0.5;
      return {
        dist: Math.abs(side),
        roadY: p.y,
        roadW: p.width,
        tunnel: !!p.tunnel,
        side,
        along: p.dist,
        minOver: over,
        overlapBed: Math.abs(side) < p.width * 0.5 + pad ? p.y : null,
      };
    }

    return {
      dist: bestLat,
      roadY: bestY,
      roadW: bestW,
      tunnel: bestTunnel,
      side: bestSide,
      along: bestAlong,
      minOver: Number.isFinite(minOver) ? minOver : bestLat - bestW * 0.5,
      overlapBed: Number.isFinite(overlapBed) ? overlapBed : null,
    };
  }

  /**
   * How far from the racing line the heightmap must stay below the deck.
   *
   * The land plane is a coarse grid (often 40–60 m per cell). A 20 m tuck
   * never lands on a vertex, so triangles interpolate a flat slab at hill
   * height straight through the car. Both ends of any triangle that crosses
   * the road have to sit in this trench.
   *
   * @param {number} roadW
   * @returns {number}
   */
  _trenchWidth(roadW) {
    // One land cell ≈ 10.7 m at STREAM defaults — pad past a full cell so
    // triangles that straddle the ribbon stay at bed on both ends.
    const cell = this._landCell || 48;
    return roadW * 0.5 + Math.max(cell * 1.85, 22);
  }

  /**
   * Same function as the land-plane vertices so props sit in the dirt.
   * Forest/Mountain hills are OFFSETS from the nearest road, not world Y —
   * an absolute dune mean of ~4 m became a green ceiling whenever the
   * ribbon dipped. Desert stays a wash so dunes never sit on the tarmac.
   * @param {number} x
   * @param {number} z
   * @param {string} scenery
   * @param {ReturnType<Track["_nearestRoad"]>} [nearHint] reuse a sample when the caller already has one
   */
  _groundHeight(x, z, scenery, nearHint) {
    const near = nearHint || this._nearestRoad(x, z);
    const { dist, roadY, roadW, tunnel, side, along, overlapBed } = near;
    const dune = this._biomeHeight(x, z, scenery);
    const desert = scenery === "desert";
    const mountain = scenery === "mountain";
    const forest = scenery === "forest";
    const drop = mountain ? 1.2 : scenery === "lakeside" ? 0.9 : 1.15;
    if (desert) {
      const underFloor = this._underpassFloorY(x, z);
      if (underFloor != null) return underFloor;
      // Portal mouths first — a folded lower arm must not own the hillside
      // under the gate. Never raise over painted asphalt or the drive verge.
      const clearance = near.minOver != null ? near.minOver : dist - roadW * 0.5;
      const floorCap =
        overlapBed != null ? Math.min(roadY, overlapBed) - drop : roadY - drop;
      if (clearance > ROAD_VERGE + 2.4) {
        const mouthY = this._tunnelMouthCutY(x, z, drop);
        if (mouthY != null) return mouthY;
      }
      // Raise the tunnel ridge on the bore's own road (approach envelope).
      // Clearance guard: nearest lat can be large while another arm sits under
      // the sample (Desert fold) — never put the ridge on that asphalt.
      const onTunRoad = !!(tunnel || this._tunnelAlong(along || 0) > 0.08);
      if (onTunRoad) {
        if (tunnel && dist < roadW * 0.5 + 14) return floorCap;
        if (clearance > ROAD_VERGE + 2.4) {
          const cut = this._tunnelCutHeight(along || 0, dist, roadW, roadY - drop);
          if (cut != null) return cut;
        }
        return floorCap;
      }
      if (clearance > 8) {
        const tun = this._tunnelNeighbor(x, z);
        if (tun && !(tun.tunnel && tun.dist < tun.roadW * 0.5 + 14)) {
          const cut = this._tunnelCutHeight(tun.along, tun.dist, tun.roadW, tun.roadY - drop);
          if (cut != null) return cut;
        }
      }
    }
    // Any vertex that can own a triangle over ANY nearby ribbon (hairpin
    // opposite arm included) stays a floor. Chase banks start past this pad.
    if (overlapBed != null) return overlapBed - drop;
    const follow = roadW * 0.5 + (desert ? 72 : mountain ? 26 : forest ? 20 : 64);
    const blend = desert ? 220 : forest ? 64 : mountain ? 70 : 190;
    const sm = (t) => {
      const k = Math.max(0, Math.min(1, t));
      return k * k * (3 - 2 * k);
    };
    /** Jump / hairpin / underpass wash — land stays a floor through the corridor. */
    const flatBed = (bed) => {
      const flats = this._landmarkFlats;
      if (!flats || !flats.length) return null;
      // Tunnel approach must keep the authored ridge — jump-3 wash used to
      // plane the climb back to bed and leave the portal floating at 1258 m.
      if (this._tunnelAlong(along || 0) > 0.08) return null;
      const flatReach = Math.max(roadW * 0.5 + 36, this._trenchWidth(roadW) + 12);
      for (let fi = 0; fi < flats.length; fi++) {
        const run = flats[fi];
        const reach = run.lateral != null ? run.lateral : flatReach;
        if ((along || 0) >= run.dist0 && (along || 0) <= run.dist1 && dist < reach) {
          return bed;
        }
      }
      return null;
    };
    if (forest) {
      const trench = Math.max(this._trenchWidth(roadW), roadW * 0.5 + 24);
      const chaseFlat = roadW * 0.5 + 50;
      const rise = Math.max(70, (this._landCell || 48) * 1.65);
      const bed = roadY - drop;
      const washed = flatBed(bed);
      if (washed != null) return washed;
      if (dist < roadW * 0.5 + ROAD_VERGE + 1.2) return bed;
      const bank = clamp(dune - 3.2, -1.4, 5.5);
      if (dist < trench) return bed;
      if (dist < chaseFlat) {
        const t = sm((dist - trench) / Math.max(1, chaseFlat - trench));
        return bed + bank * t * 0.08;
      }
      if (dist < trench + rise) return bed + bank * sm((dist - trench) / rise);
      return bed + bank;
    }
    if (mountain) {
      // Ridges follow the climbing ribbon so hairpins are not a sky-bridge.
      // Trench width must match _addLandPlane clamp so heightmap and mesh agree.
      const trench = Math.max(this._trenchWidth(roadW), roadW * 0.5 + 22);
      const chaseFlat = roadW * 0.5 + 48;
      const rise = Math.max(40, (this._landCell || 48) * 1.15);
      const bed = roadY - drop;
      const washed = flatBed(bed);
      if (washed != null) return washed;
      if (dist < roadW * 0.5 + ROAD_VERGE + 1.2) return bed;
      const ridge =
        Math.abs(Math.sin(x * 0.008 + z * 0.006)) * 8.5 +
        Math.sin(x * 0.02 - z * 0.016) * 2.8 +
        Math.sin(x * 0.038 + z * 0.028) * 1.3;
      let bank = Math.max(0, ridge - 1.2);
      // Tier 7+: fold biome octaves into the bank so ridges read layered, not a single sine.
      // Keep amplitudes modest — trench/chaseFlat still flatten the ribbon corridor.
      if (this._terrainRealismOn()) {
        const bio = clamp(dune - 8, -1.5, 9);
        bank = Math.max(0, bank + bio * 0.28);
      }
      const pin = this._landmark;
      if (pin && Math.abs((along || 0) - pin.dist) < 95 && side === pin.inside && dist > roadW * 0.5 + 18) {
        const t = 1 - Math.abs((along || 0) - pin.dist) / 95;
        bank += t * t * 4.5;
      }
      if (dist < trench) return bed;
      if (dist < chaseFlat) {
        // Near-zero bank in the drive corridor — ridges start past chase cam.
        const t = sm((dist - trench) / Math.max(1, chaseFlat - trench));
        return bed + bank * t * 0.02;
      }
      if (dist < trench + rise) return bed + bank * sm((dist - chaseFlat) / Math.max(1, rise - (chaseFlat - trench)));
      return bed + bank * 0.85;
    }
    if (desert) {
      // Chase cam only sees ~20 m of verge, but a trench narrower than one
      // land-grid cell lets dune triangles interpolate straight across the
      // ribbon — "heavy sand on the roadway." Hold a near-zero bank through
      // the chase corridor (same pattern as Mountain); dunes rise after that.
      const trench = Math.max(this._trenchWidth(roadW), roadW * 0.5 + 22);
      const chaseFlat = roadW * 0.5 + 56;
      const bed = roadY - drop;
      // Inside the tube the land plane must stay a floor, never a dune wall.
      if (tunnel && dist < roadW * 0.5 + 14) return bed;
      // Tunnel ridge already applied via _tunnelNeighbor above. Remaining
      // dunes use chase flatten so sand cannot refill the ribbon.
      const hill = this._tunnelHill(along || 0, dist, roadW);
      const rise = hill > 1 ? 36 : 48;
      const bank = Math.max(hill, clamp(dune - bed, -0.4, 7.2));
      const washed = flatBed(bed);
      if (washed != null) return washed;
      if (dist < roadW * 0.5 + ROAD_VERGE + 1.2) return bed;
      if (dist < trench) return bed;
      if (dist < chaseFlat) {
        const t = sm((dist - trench) / Math.max(1, chaseFlat - trench));
        return bed + bank * t * 0.015;
      }
      if (dist < chaseFlat + rise) return bed + bank * sm((dist - chaseFlat) / rise);
      if (dist < chaseFlat + rise + blend) {
        const t = sm((dist - chaseFlat - rise) / blend);
        return bed + bank * (0.9 + 0.1 * t);
      }
      return Math.max(dune, bed + bank * 0.85);
    }
    if (scenery === "lakeside") {
      const cell = this._landCell || 32;
      // Match Forest/Mountain trench floor so land tris cannot fold through asphalt.
      const trench = Math.max(this._trenchWidth(roadW), roadW * 0.5 + 12, cell * 1.15);
      const chaseFlat = roadW * 0.5 + 40;
      const rise = 18;
      const bed = roadY - drop;
      const bank = clamp(dune * 0.28, -0.4, 2.6);
      const washed = flatBed(bed);
      if (washed != null) return washed;
      if (dist < roadW * 0.5 + ROAD_VERGE + 1.2) return bed;
      const alongT = this.length > 1 ? (along || 0) / this.length : 0;
      const lakeA = alongT > 0.1 && alongT < 0.5 && side > 0;
      const lakeB = alongT > 0.56 && alongT < 0.88 && side < 0;
      const lake = lakeA || lakeB;
      if (dist < trench) return bed;
      if (lake) {
        const floor = roadY - 2.15;
        const shelf = 72;
        if (dist < trench + rise) return bed + (floor - bed) * sm((dist - trench) / rise);
        if (dist < trench + rise + shelf) return floor;
        const t = sm((dist - trench - rise - shelf) / 110);
        return floor * (1 - t) + (bed + 0.85 + bank) * t;
      }
      if (dist < chaseFlat) {
        const t = sm((dist - trench) / Math.max(1, chaseFlat - trench));
        return bed + (bank + 0.35) * t * 0.08;
      }
      if (dist < trench + rise) return bed + (bank + 0.35) * sm((dist - trench) / rise);
      return bed + 0.55 + bank;
    }
    let h;
    if (dist < shoulder) {
      h = tuck;
    } else if (dist < follow) {
      const t = sm((dist - shoulder) / Math.max(1, follow - shoulder));
      h = tuck * (1 - t * 0.2) + dune * (t * 0.2);
      h = Math.min(h, roadY - 0.14);
    } else if (dist < follow + blend) {
      const t = sm((dist - follow) / blend);
      h = tuck * (1 - t) + dune * t;
    } else {
      h = dune;
    }
    return h;
  }

  /**
   * True when Sprint 20 land realism is on — extra height octaves + denser paint.
   * @returns {boolean}
   */
  _terrainRealismOn() {
    return (VISUAL.tier || 0) >= 7 || VISUAL.terrainRealism === true;
  }

  /**
   * @param {number} x
   * @param {number} z
   * @param {string} scenery
   */
  _biomeHeight(x, z, scenery) {
    const hi = this._terrainRealismOn();
    if (scenery === "desert") {
      // Multi-scale dune field: long spines + mid wind waves + fine ripples.
      // Amplitudes stay modest — trench/road-bed in _groundHeight still owns the ribbon.
      const dune =
        Math.sin(x * 0.0075 + z * 0.01) * 8.2 +
        Math.sin(x * 0.019 - z * 0.016) * 4.6 +
        Math.sin(x * 0.042 + z * 0.031) * 1.8 +
        Math.sin(x * 0.0028 - z * 0.0036) * 16 +
        (hi
          ? Math.sin(x * 0.011 - z * 0.014) * 3.4 +
            Math.sin(x * 0.031 + z * 0.027) * 1.35 +
            Math.sin(x * 0.058 - z * 0.049) * 0.55
          : 0);
      // Close-camera grit. Kept small so the road trench still wins.
      const grit =
        Math.sin(x * 0.078 + z * 0.061) * 0.42 +
        Math.sin(x * 0.19 - z * 0.16) * 0.16 +
        Math.sin(x * 0.37 + z * 0.29) * 0.06 +
        (hi ? Math.sin(x * 0.52 + z * 0.41) * 0.035 + Math.sin(x * 0.91 - z * 0.73) * 0.018 : 0);
      return 2.6 + Math.max(-2, dune) * 0.62 + grit;
    }
    if (scenery === "mountain") {
      // Primary ridge + secondary shoulders + talus freckle (hi only).
      return (
        4 +
        Math.abs(Math.sin(x * 0.0055 + z * 0.004)) * 22 +
        Math.sin(x * 0.012 - z * 0.01) * 8 +
        Math.sin(x * 0.028 + z * 0.02) * 3.2 +
        Math.abs(Math.sin(x * 0.041 + z * 0.037)) * 1.6 +
        Math.sin(x * 0.11 - z * 0.09) * 0.45 +
        (hi
          ? Math.abs(Math.sin(x * 0.009 + z * 0.0075)) * 4.8 +
            Math.sin(x * 0.018 - z * 0.015) * 2.2 +
            Math.abs(Math.sin(x * 0.055 + z * 0.048)) * 0.85 +
            Math.sin(x * 0.21 - z * 0.17) * 0.22
          : 0)
      );
    }
    if (scenery === "lakeside") {
      // Soft shores + inland knolls; hi adds reed-bank freckle and shelf ripples.
      return (
        1.4 +
        Math.sin(x * 0.01 + z * 0.008) * 3.2 +
        Math.sin(x * 0.022 - z * 0.018) * 1.6 +
        Math.max(0, Math.sin(x * 0.0035) * Math.sin(z * 0.004)) * 9 +
        Math.sin(x * 0.09 + z * 0.07) * 0.28 +
        (hi
          ? Math.sin(x * 0.016 + z * 0.013) * 1.1 +
            Math.sin(x * 0.038 - z * 0.033) * 0.48 +
            Math.max(0, Math.sin(x * 0.0062) * Math.sin(z * 0.0055 + 0.7)) * 2.4 +
            Math.sin(x * 0.14 + z * 0.11) * 0.12
          : 0)
      );
    }
    // Forest banks: broad mounds + mid undulation; hi adds root-mound and leaf-litter freckle.
    return (
      1.8 +
      Math.sin(x * 0.011 + z * 0.009) * 2.1 +
      Math.sin(x * 0.024 - z * 0.017) * 1.1 +
      Math.max(0, Math.sin(x * 0.004 + 1.2) * Math.sin(z * 0.0045)) * 5.2 +
      Math.sin(x * 0.085 - z * 0.072) * 0.22 +
      Math.sin(x * 0.19 + z * 0.16) * 0.08 +
      (hi
        ? Math.sin(x * 0.015 + z * 0.012) * 0.85 +
          Math.max(0, Math.sin(x * 0.0065 + 0.4) * Math.sin(z * 0.007)) * 2.1 +
          Math.sin(x * 0.048 - z * 0.041) * 0.35 +
          Math.sin(x * 0.28 + z * 0.23) * 0.06
        : 0)
    );
  }

  /**
   * @param {THREE.Color} c
   * @param {string} scenery
   * @param {number} h
   * @param {number} roadY
   */
  _biomeTint(c, scenery, h, roadY, x, z) {
    const lift = clamp((h - roadY) / 24, -0.4, 1);
    const hi = this._terrainRealismOn();
    if (scenery === "desert") {
      if (lift > 0.45) {
        // Raised tunnel ridge: rockier escarpment, not a tall sand dune.
        c.setRGB(0.62 + lift * 0.16, 0.54 + lift * 0.12, 0.4 + lift * 0.06);
      } else {
        c.setRGB(0.82 + lift * 0.12, 0.68 + lift * 0.1, 0.44 + lift * 0.05);
      }
      const grit = Math.abs(Math.sin(x * 0.055 + z * 0.049));
      if (grit > 0.82) c.multiplyScalar(0.9);
      if (hi) {
        // Wind-shadow cool bands + pale crest wash + sparse stone flecks.
        const shadow = Math.abs(Math.sin(x * 0.021 + z * 0.017));
        if (shadow > 0.78 && lift < 0.35) c.multiplyScalar(0.93);
        const crest = Math.abs(Math.sin(x * 0.014 - z * 0.019));
        if (crest > 0.88 && lift > 0.2) {
          c.r = Math.min(1, c.r * 1.06);
          c.g = Math.min(1, c.g * 1.03);
          c.b = Math.min(1, c.b * 0.98);
        }
        const stone = Math.abs(Math.sin(x * 0.11 + z * 0.097));
        if (stone > 0.93) c.multiplyScalar(0.86);
      }
      return;
    }
    if (scenery === "mountain") {
      c.setRGB(0.55 + lift * 0.14, 0.5 + lift * 0.1, 0.4 + lift * 0.06);
      const maquis = Math.abs(Math.sin(x * 0.028 + z * 0.025));
      if (maquis > 0.55 && maquis < 0.82) c.setRGB(0.34 + lift * 0.08, 0.44 + lift * 0.1, 0.24);
      const speck = Math.abs(Math.sin(x * 0.08 + z * 0.07));
      if (speck > 0.84) c.multiplyScalar(0.88);
      if (hi) {
        // Pale scree streaks on high lift; darker basalt flecks.
        if (lift > 0.55) {
          const scree = Math.abs(Math.sin(x * 0.045 + z * 0.038));
          if (scree > 0.72) c.setRGB(0.62 + lift * 0.1, 0.58 + lift * 0.08, 0.5 + lift * 0.05);
        }
        const basalt = Math.abs(Math.sin(x * 0.13 - z * 0.11));
        if (basalt > 0.91) c.multiplyScalar(0.82);
        const lichen = Math.abs(Math.sin(x * 0.036 + z * 0.042));
        if (lichen > 0.86 && lichen < 0.94 && lift < 0.5) {
          c.setRGB(0.3 + lift * 0.06, 0.4 + lift * 0.08, 0.22);
        }
      }
      return;
    }
    if (scenery === "lakeside") {
      c.setRGB(0.26 + lift * 0.12, 0.46 + lift * 0.14, 0.3 + lift * 0.08);
      const wet = Math.abs(Math.sin(x * 0.03 + z * 0.028));
      if (wet > 0.88) c.setRGB(0.22, 0.4, 0.38);
      if (h < roadY - 0.7) c.setRGB(0.18, 0.32, 0.3);
      if (hi) {
        // Mud shelf + reed tint + pale gravel spit.
        if (h < roadY - 0.35 && h > roadY - 1.4) {
          const mud = Math.abs(Math.sin(x * 0.022 + z * 0.019));
          if (mud > 0.7) c.setRGB(0.28, 0.34, 0.26);
        }
        const reed = Math.abs(Math.sin(x * 0.048 - z * 0.041));
        if (reed > 0.86) c.setRGB(0.2, 0.38, 0.22);
        const spit = Math.abs(Math.sin(x * 0.017 + z * 0.023));
        if (spit > 0.9 && lift > 0.05 && lift < 0.4) {
          c.setRGB(0.42, 0.44, 0.36);
        }
      }
      return;
    }
    // Forest floor: needle litter, moss, fern patches, damp hollows.
    c.setRGB(0.18 + lift * 0.08, 0.38 + lift * 0.14, 0.14 + lift * 0.04);
    const litter = Math.abs(Math.sin(x * 0.019 + z * 0.017));
    if (litter > 0.68 && litter < 0.88) c.setRGB(0.32, 0.28, 0.12);
    const moss = Math.abs(Math.sin(x * 0.012 - z * 0.016));
    if (moss > 0.78) c.setRGB(0.14, 0.34, 0.12);
    const fern = Math.abs(Math.sin(x * 0.031 + z * 0.027));
    if (fern > 0.84) c.setRGB(0.12, 0.42, 0.14);
    const damp = Math.abs(Math.sin(x * 0.008 + z * 0.009));
    if (damp > 0.9 && lift < 0.15) c.setRGB(0.1, 0.22, 0.1);
    if ((((x * 0.03) | 0) + ((z * 0.03) | 0)) & 1) c.g *= 0.93;
    const shade = Math.abs(Math.sin(x * 0.038 + z * 0.035));
    if (shade > 0.86) c.multiplyScalar(0.88);
    if (hi) {
      // Root mound brown, richer moss cushions, pale birch litter.
      const root = Math.abs(Math.sin(x * 0.026 + z * 0.022));
      if (root > 0.88 && lift > 0.1) c.setRGB(0.26, 0.22, 0.12);
      const cushion = Math.abs(Math.sin(x * 0.009 - z * 0.011));
      if (cushion > 0.84) c.setRGB(0.1, 0.36, 0.14);
      const birch = Math.abs(Math.sin(x * 0.052 + z * 0.047));
      if (birch > 0.92) {
        c.r = Math.min(1, c.r * 1.15);
        c.g = Math.min(1, c.g * 1.05);
        c.b = Math.min(1, c.b * 0.9);
      }
    }
  }

  /**
   * Stage fog colour for aerial perspective — matches LIGHTING.fog per scenery.
   * @param {string} scenery
   * @returns {THREE.Color}
   */
  _fogTintForScenery(scenery) {
    const stage = LIGHTING[scenery];
    const hex =
      stage && stage.fog != null
        ? stage.fog
        : scenery === "desert"
          ? COLORS.fogDesert
          : scenery === "mountain"
            ? COLORS.fogMountain
            : scenery === "lakeside"
              ? COLORS.fogLakeside
              : COLORS.fogForest;
    return new THREE.Color(hex);
  }

  /**
   * Lerp vertex albedo toward stage fog by distance from the ribbon — sells depth
   * without a second render pass (Sprint 14 tier 4).
   * @param {THREE.Color} c
   * @param {string} scenery
   * @param {number} distFromRoad
   */
  _applyAerialPerspective(c, scenery, distFromRoad) {
    const start = VISUAL.aerialStart ?? 48;
    const end = VISUAL.aerialEnd ?? 420;
    const span = Math.max(1, end - start);
    const t = clamp((distFromRoad - start) / span, 0, 1);
    const strength = (VISUAL.aerialStrength ?? 0.72) * t * t;
    if (strength <= 0.001) return;
    c.lerp(this._fogTintForScenery(scenery), strength);
  }

  /**
   * Replace the old low-poly skyline blocks with rings of actual biome props.
   * The land plane still owns the ground silhouette; this method fills the
   * horizon with trees, rocks, and cacti so the backdrop reads as scenery, not
   * boxes.
   */
  _addBackdropBiome(def, b) {
    const scenery = def.scenery || "forest";
    if (scenery === "forest") {
      this._addForestTreeline(def, b);
      return;
    }
    if (scenery === "mountain") {
      this._addMountainTreeline(def, b);
      this._addBackdropRockRings(b, 0x6a6258, [
        { r: b.maxR + 430, n: 34, sMin: 18, sMax: 34, y: 0.2 },
        { r: b.maxR + 680, n: 26, sMin: 26, sMax: 46, y: 0.3 },
      ], "mountain");
      return;
    }
    if (scenery === "desert") {
      this._addBackdropCactusRings(b);
      this._addBackdropRockRings(
        b,
        0xa38254,
        [
          { r: b.maxR + 420, n: 32, sMin: 12, sMax: 24, y: 0.12 },
          { r: b.maxR + 700, n: 24, sMin: 20, sMax: 36, y: 0.18 },
        ],
        "desert"
      );
      return;
    }
    if (scenery === "lakeside") {
      this._addBackdropTreeRings(
        b,
        [
          { kind: "autumn", r: b.maxR + 320, n: 56, hMin: 24, hMax: 42, wMin: 6.8, wMax: 11.8 },
          { kind: "autumnGold", r: b.maxR + 500, n: 40, hMin: 30, hMax: 48, wMin: 7.5, wMax: 12.8 },
          { kind: "oak", r: b.maxR + 700, n: 30, hMin: 28, hMax: 46, wMin: 8.5, wMax: 13.5 },
        ],
        "lakeside"
      );
      this._addBackdropRockRings(
        b,
        0x5a6c58,
        [{ r: b.maxR + 410, n: 24, sMin: 10, sMax: 18, y: 0.14 }],
        "lakeside"
      );
    }
  }

  /**
   * Continuous forest wall on the horizon — pack 3D trees + atlas cards.
   */
  _addForestTreeline(def, b) {
    const treeA = [];
    const treeB = [];
    const treeC = [];
    const treeD = [];
    const treeE = [];
    const treeF = [];
    const rings = [
      { r: b.maxR + 180, n: 88, hMin: 18, hMax: 30 },
      { r: b.maxR + 300, n: 72, hMin: 24, hMax: 40 },
      { r: b.maxR + 420, n: 56, hMin: 32, hMax: 52 },
    ];
    const packReady = FOREST_TREE_KINDS.some((k) => !!propForestTreeParts(k));
    for (let ri = 0; ri < rings.length; ri++) {
      const ring = rings[ri];
      for (let i = 0; i < ring.n; i++) {
        const ang = (i / ring.n) * Math.PI * 2 + (i % 5) * 0.06;
        const jitter = ((i * 13) % 7) - 3;
        const rad = ring.r + jitter * 10;
        const x = b.cx + Math.cos(ang) * rad;
        const z = b.cz + Math.sin(ang) * rad;
        const t = (i % 11) / 10;
        const h = ring.hMin + t * (ring.hMax - ring.hMin);
        const pose = this._groundBackdropPose(
          { x, y: 0, z, s: h / 11.5, ry: ang + Math.PI },
          "forest"
        );
        if (packReady) {
          const pick = i % 6;
          if (pick === 0) treeA.push(pose);
          else if (pick === 1) treeB.push(pose);
          else if (pick === 2) treeC.push(pose);
          else if (pick === 3) treeD.push(pose);
          else if (pick === 4) treeE.push(pose);
          else treeF.push(pose);
        } else {
          const pick = i % 5;
          if (pick === 0) treeD.push(pose);
          else if (pick === 1 || pick === 2) treeB.push(pose);
          else treeA.push(pose);
        }
      }
    }
    if (packReady) {
      this._addHdBackdrop("forest_tree_a", treeA, b);
      this._addHdBackdrop("forest_tree_b", treeB, b);
      this._addHdBackdrop("forest_tree_c", treeC, b);
      this._addHdBackdrop("forest_tree_d", treeD, b);
      this._addHdBackdrop("forest_tree_e", treeE, b);
      this._addHdBackdrop("forest_tree_f", treeF, b);
    } else {
      this._addHdBackdrop("tree_pineDefaultA", treeA, b);
      this._addHdBackdrop("tree_pineDefaultB", treeB, b);
      this._addHdBackdrop("tree_fir", treeD, b);
    }
  }

  /**
   * Stage 3 horizon wall — same pack GLB as Forest, fir-weighted mix so the
   * hills read alpine instead of a clone of Stage 2 woodland.
   */
  _addMountainTreeline(def, b) {
    /** @type {Record<string, object[]>} */
    const byKind = Object.create(null);
    for (let i = 0; i < FOREST_TREE_KINDS.length; i++) byKind[FOREST_TREE_KINDS[i]] = [];
    const rings = [
      { r: b.maxR + 160, n: 64, hMin: 16, hMax: 28 },
      { r: b.maxR + 280, n: 52, hMin: 22, hMax: 36 },
      { r: b.maxR + 400, n: 40, hMin: 28, hMax: 46 },
    ];
    const packReady = FOREST_TREE_KINDS.some((k) => !!propForestTreeParts(k));
    const palette = FOREST_MOUNTAIN_PALETTE;
    for (let ri = 0; ri < rings.length; ri++) {
      const ring = rings[ri];
      for (let i = 0; i < ring.n; i++) {
        const ang = (i / ring.n) * Math.PI * 2 + (i % 5) * 0.05;
        const jitter = ((i * 17) % 7) - 3;
        const rad = ring.r + jitter * 9;
        const x = b.cx + Math.cos(ang) * rad;
        const z = b.cz + Math.sin(ang) * rad;
        const t = (i % 11) / 10;
        const h = ring.hMin + t * (ring.hMax - ring.hMin);
        const pose = this._groundBackdropPose(
          { x, y: 0, z, s: h / 11.5, ry: ang + Math.PI },
          "mountain"
        );
        if (packReady) {
          const pick = palette[i % palette.length];
          if (!byKind[pick]) byKind[pick] = [];
          byKind[pick].push(pose);
        } else {
          const fallback = i % 3 === 0 ? "fir" : i % 3 === 1 ? "cedar" : "pine";
          if (!byKind[fallback]) byKind[fallback] = [];
          byKind[fallback].push({ ...pose, s: h / 8.2 });
        }
      }
    }
    if (packReady) {
      for (let i = 0; i < FOREST_TREE_KINDS.length; i++) {
        const k = FOREST_TREE_KINDS[i];
        if (byKind[k]?.length) this._addHdBackdrop(k, byKind[k], b);
      }
    } else {
      this._addHdBackdrop("tree_fir", byKind.fir || [], b);
      this._addHdBackdrop("tree_pineDefaultB", byKind.cedar || [], b);
      this._addHdBackdrop("tree_pineDefaultA", byKind.pine || [], b);
    }
  }

  /**
   * Instanced horizon props — split into angular sectors so streaming can
   * drop rings the player cannot see.
   * @param {THREE.BufferGeometry} geo
   * @param {THREE.Material} mat
   * @param {object[]} poses
   * @param {{ cx: number, cz: number }} origin track centre for sector bucketing
   */
  _addBackdropInstances(geo, mat, poses, origin) {
    if (!poses.length) return;
    const sectors = Math.max(4, STREAM.backdropSectors | 0);
    const ox = origin?.cx ?? 0;
    const oz = origin?.cz ?? 0;
    const buckets = Array.from({ length: sectors }, () => []);
    for (let i = 0; i < poses.length; i++) {
      const p = poses[i];
      const ang = Math.atan2(p.z - oz, p.x - ox);
      let idx = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * sectors);
      if (idx >= sectors) idx = sectors - 1;
      if (idx < 0) idx = 0;
      buckets[idx].push(p);
    }
    for (let s = 0; s < sectors; s++) {
      const bag = buckets[s];
      if (!bag.length) continue;
      const mesh = new THREE.InstancedMesh(geo, mat, bag.length);
      mesh.receiveShadow = false;
      mesh.castShadow = false;
      const dummy = new THREE.Object3D();
      for (let i = 0; i < bag.length; i++) {
        const p = bag[i];
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(p.rx || 0, p.ry || 0, p.rz || 0);
        const sc = Math.abs(p.s || 1);
        const sx = p.sx != null ? Math.abs(p.sx) : sc;
        const sy = p.sy != null ? Math.abs(p.sy) : sc;
        const sz = p.sz != null ? Math.abs(p.sz) : sc;
        dummy.scale.set(sx, sy, sz);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      this.group.add(mesh);
      this._registerChunk(mesh, -2);
    }
  }

  /**
   * @param {{ cx:number, cz:number, minY:number, maxR:number }} b
   * @param {object[]} rings
   * @param {string|null} [scenery] forest/mountain → pack variants
   */
  _addBackdropTreeRings(b, rings, scenery = null) {
    const bags = new Map();
    const packLive =
      (scenery === "forest" || scenery === "mountain") &&
      FOREST_TREE_KINDS.some((k) => !!propForestTreeParts(k));
    const refH = packLive ? 11.5 : 8.2;
    for (let ri = 0; ri < rings.length; ri++) {
      const ring = rings[ri];
      let bag = bags.get(ring.kind);
      if (!bag) {
        bag = [];
        bags.set(ring.kind, bag);
      }
      for (let i = 0; i < ring.n; i++) {
        const ang = (i / ring.n) * Math.PI * 2 + (i % 7) * 0.04;
        const rad = ring.r + (((i * 11) % 9) - 4) * 10;
        const x = b.cx + Math.cos(ang) * rad;
        const z = b.cz + Math.sin(ang) * rad;
        const t = ((i * 7) % 13) / 12;
        const h = ring.hMin + t * (ring.hMax - ring.hMin);
        // Footed HD trees — uniform scale from authored height.
        bag.push(
          this._groundBackdropPose(
            { x, y: 0, z, s: h / refH, ry: ang + Math.PI },
            scenery || "forest"
          )
        );
      }
    }
    for (const [kind, bag] of bags) {
      if (packLive) {
        const palette = scenery === "mountain" ? FOREST_MOUNTAIN_PALETTE : FOREST_STAGE_PALETTE;
        const live = [];
        for (let i = 0; i < palette.length; i++) {
          const k = palette[i];
          if (propForestTreeParts(k) && !live.includes(k)) live.push(k);
        }
        if (live.length) {
          /** @type {Record<string, object[]>} */
          const split = Object.create(null);
          for (let i = 0; i < bag.length; i++) {
            const k = live[i % live.length];
            if (!split[k]) split[k] = [];
            split[k].push(bag[i]);
          }
          for (const k of Object.keys(split)) this._addHdBackdrop(k, split[k], b);
          continue;
        }
      }
      const glbKey = this._hdTreeGlb(kind, scenery);
      if (!glbKey) continue;
      this._addHdBackdrop(glbKey, bag, b);
    }
  }

  _addBackdropRockRings(b, _colorHex, rings, scenery = "desert") {
    const poses = [];
    for (let ri = 0; ri < rings.length; ri++) {
      const ring = rings[ri];
      for (let i = 0; i < ring.n; i++) {
        const ang = (i / ring.n) * Math.PI * 2 + (i % 5) * 0.06;
        const rad = ring.r + (((i * 13) % 7) - 3) * 12;
        const s = ring.sMin + (((i * 17) % 9) / 8) * (ring.sMax - ring.sMin);
        const x = b.cx + Math.cos(ang) * rad;
        const z = b.cz + Math.sin(ang) * rad;
        poses.push(
          this._groundBackdropPose(
            {
              x,
              y: 0,
              z,
              s: Math.max(0.8, s / 12),
              ry: ang,
              rx: (i % 5) * 0.08,
              rz: (i % 7) * 0.06,
            },
            scenery
          )
        );
      }
    }
    // Split bags for rock variety.
    const a = [];
    const bb = [];
    for (let i = 0; i < poses.length; i++) (i % 2 === 0 ? a : bb).push(poses[i]);
    this._addHdBackdrop("rock_largeA", a, b);
    this._addHdBackdrop("rock_largeB", bb, b);
  }

  _addBackdropCactusRings(b) {
    const stems = [];
    const rings = [
      { r: b.maxR + 320, n: 28, hMin: 8, hMax: 14 },
      { r: b.maxR + 560, n: 20, hMin: 11, hMax: 18 },
    ];
    for (let ri = 0; ri < rings.length; ri++) {
      const ring = rings[ri];
      for (let i = 0; i < ring.n; i++) {
        const ang = (i / ring.n) * Math.PI * 2 + ((i * 13) % 7) * 0.11;
        const rad = ring.r + (((i * 9) % 11) - 5) * 18;
        const h = ring.hMin + (((i * 5) % 9) / 8) * (ring.hMax - ring.hMin);
        const x = b.cx + Math.cos(ang) * rad;
        const z = b.cz + Math.sin(ang) * rad;
        stems.push(
          this._groundBackdropPose(
            {
              x,
              y: 0,
              z,
              s: h / 3.0,
              ry: ang + Math.PI,
            },
            "desert"
          )
        );
      }
    }
    this._addHdBackdrop("cactus_tall", stems, b);
  }

  /**
   * The racing ribbon, its dirt skirt, and its kerbs — cut into streaming
   * slices.
   *
   * WHAT CHANGED AND WHY:
   *  - One mesh per (surface, slice) instead of one mesh per surface. A single
   *    course-long ribbon has a bounding sphere the camera always sits inside,
   *    so it was submitted in full every frame including the two thirds
   *    already behind the car.
   *  - Quads no longer share vertices along the ribbon. That costs about 8k
   *    extra vertices on a long stage — nothing — and it means a slice
   *    boundary is just "start a new bucket" instead of index bookkeeping
   *    across the seam.
   *  - MeshStandardMaterial -> MeshLambertMaterial. The road is dirt and
   *    tarmac lit by one sun; roughness 0.82 / metalness 0.04 was paying for a
   *    GGX specular lobe and an IBL lookup per pixel to produce, essentially,
   *    Lambert. The painted texture carries the surface read (see
   *    docs/AM3-RESEARCH.md section 5).
   */
  _buildMesh(def) {
    const pts = this.points;
    /** @type {Map<string, {id:string, chunk:number, pos:number[], col:number[], uv:number[], idx:number[], n:number}>} */
    const road = new Map();
    /** @type {Map<number, {pos:number[], col:number[], idx:number[], n:number}>} */
    const skirt = new Map();
    /** @type {Map<number, {pos:number[], col:number[], idx:number[], n:number}>} */
    const kerb = new Map();
    const color = new THREE.Color();
    const desert = def.scenery === "desert";
    const scenery = def.scenery || "forest";
    const terrainHex = desert ? COLORS.dunePale : SURFACES[this.offroad]?.color || COLORS.sand;
    /**
     * Skirt used to be a 32 m flat shelf — it buried the heightmap and made
     * every stage read as a beige slab from chase cam. Keep a short tuck, then
     * drop the outer edge onto the land so dunes/banks actually show.
     */
    const sl = desert ? 2.6 : scenery === "mountain" ? 3.8 : scenery === "lakeside" ? 3.4 : 3.2;
    const kerbW = 0.42;
    const chunkOf = (dist) => Math.min(this._chunkCount - 1, Math.max(0, Math.floor(dist / CHUNK_LEN)));

    const roadBucket = (id, chunk) => {
      const key = `${id}|${chunk}`;
      let b = road.get(key);
      if (!b) {
        b = { id, chunk, pos: [], col: [], uv: [], idx: [], n: 0 };
        road.set(key, b);
      }
      return b;
    };
    const plainBucket = (map, chunk) => {
      let b = map.get(chunk);
      if (!b) {
        b = { pos: [], col: [], idx: [], n: 0 };
        map.set(chunk, b);
      }
      return b;
    };

    const vert = (b, x, y, z, hex, u, v) => {
      b.pos.push(x, y, z);
      color.setHex(hex);
      b.col.push(color.r, color.g, color.b);
      if (b.uv) b.uv.push(u, v);
    };
    /** Emit one quad as four fresh vertices: a b / c d, wound a-b-c, b-d-c. */
    const quad = (b) => {
      const i = b.n;
      b.idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
      b.n += 4;
    };

    const edge = (p) => {
      const half = p.width * 0.5;
      const jk = p.jumpKind || null;
      const microL = roadMicroHeight(p.dist, half, p.surface, jk, !!p.tunnel);
      const microR = roadMicroHeight(p.dist, -half, p.surface, jk, !!p.tunnel);
      const yL = p.y + ROAD_DECK + microL;
      const yR = p.y + ROAD_DECK + microR;
      return {
        yL,
        yR,
        lx: p.x + p.nx * half,
        lz: p.z + p.nz * half,
        rx: p.x - p.nx * half,
        rz: p.z - p.nz * half,
      };
    };

    const kerbHexFor = (surface, dist, tunnel) => {
      if (tunnel) return 0x6a5a48;
      if (surface === "tarmac") {
        return Math.floor(dist / 3.2) % 2 === 0 ? COLORS.kerbRed : COLORS.kerbCream;
      }
      if (surface === "cobble") return Math.floor(dist / 2.4) % 2 === 0 ? 0xc8c2b4 : 0x5a564e;
      if (surface === "mud") return 0x5a4a38;
      if (surface === "grass") return 0xd8e0b8;
      return COLORS.kerbCream;
    };

    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i];
      const q = pts[i + 1];
      const e = edge(p);
      const f = edge(q);
      const chunk = chunkOf(p.dist);

      const hereP = SURFACES[p.surface] ? p.surface : "dirt";
      const hereQ = SURFACES[q.surface] ? q.surface : "dirt";
      const blendP = this._surfaceBlend(p.dist, hereP);
      const blendQ = this._surfaceBlend(q.dist, hereQ);
      const id = (blendP.mix + blendQ.mix) * 0.5 > 0.72 ? blendQ.to : blendP.from;
      const rb = roadBucket(id, chunk);
      const vScale = ROAD_UV_SCALE[id] || 0.12;
      const v0 = p.dist * vScale;
      const v1 = q.dist * vScale;
      const tintP = p.tunnel ? 0x7a6e62 : roadTintHex(blendP.from, blendP.to, blendP.mix);
      const tintQ = q.tunnel ? 0x7a6e62 : roadTintHex(blendQ.from, blendQ.to, blendQ.mix);
      vert(rb, e.lx, e.yL, e.lz, tintP, 0, v0);
      vert(rb, e.rx, e.yR, e.rz, tintP, 1, v0);
      vert(rb, f.lx, f.yL, f.lz, tintQ, 0, v1);
      vert(rb, f.rx, f.yR, f.rz, tintQ, 1, v1);
      quad(rb);

      // Skirt: the strip of loose ground that tucks the ribbon into the land
      // plane. Two quads, one per side, drawn double-sided so a car that gets
      // underneath the lip still sees ground rather than sky.
      // Desert tunnel: the 8 m dune skirt ran through the walls as sand
      // slabs. Keep a short dark tuck so the kerb meets the rock, nothing else.
      const inTunnel = !!(p.tunnel || q.tunnel);
      const inUnderpass = !!(p.underpass || q.underpass);
      // Closed deck under the arch — FrontSide ribbon otherwise shows its
      // underside (backfaces) the moment the camera sits a few centimetres low.
      if (inUnderpass) {
        const yDown = 0.12;
        vert(rb, e.rx, e.yR - yDown, e.rz, tintP, 1, v0);
        vert(rb, e.lx, e.yL - yDown, e.lz, tintP, 0, v0);
        vert(rb, f.rx, f.yR - yDown, f.rz, tintQ, 1, v1);
        vert(rb, f.lx, f.yL - yDown, f.lz, tintQ, 0, v1);
        quad(rb);
      }
      const atLandmark = !!(p.landmark || q.landmark);
      const atJump = !!(p.jump || q.jump || p.jumpWash || q.jumpWash);
      let dHead = q.heading - p.heading;
      while (dHead > Math.PI) dHead -= Math.PI * 2;
      while (dHead < -Math.PI) dHead += Math.PI * 2;
      const tightBend = Math.abs(dHead) > 0.04;
      const skirtReach =
        inTunnel || inUnderpass
          ? 0.85
          : atJump
            ? 1.4
            : atLandmark
              ? 1.8
              : tightBend
                ? 1.55
                : sl;
      const skirtHex = inTunnel || inUnderpass ? 0x3a3228 : terrainHex;
      const sb = plainBucket(skirt, chunk);
      const ey = e.y - 0.04;
      const fy = f.y - 0.04;
      const eLx = e.lx + p.nx * skirtReach;
      const eLz = e.lz + p.nz * skirtReach;
      const eRx = e.rx - p.nx * skirtReach;
      const eRz = e.rz - p.nz * skirtReach;
      const fLx = f.lx + q.nx * skirtReach;
      const fLz = f.lz + q.nz * skirtReach;
      const fRx = f.rx - q.nx * skirtReach;
      const fRz = f.rz - q.nz * skirtReach;
      const skirtDrop = (edgeY, lx, lz) => {
        if (inTunnel || inUnderpass || atJump) return edgeY - 0.14;
        // Long sand skirts on tight hairpins fold into camera-blocking slabs.
        if (atLandmark) return edgeY - 0.24;
        const road = this._nearestRoad(lx, lz);
        const over = road.minOver != null ? road.minOver : road.dist - road.roadW * 0.5;
        if (over < ROAD_COLLIDER_CLEAR + 0.35) return edgeY - 0.38;
        const gy = this._groundHeight(lx, lz, scenery);
        // Outer skirt must tuck under the ribbon, never rise onto the asphalt.
        return Math.min(gy, edgeY - 0.12);
      };
      const eDropL = skirtDrop(ey, eLx, eLz);
      const eDropR = skirtDrop(ey, eRx, eRz);
      const fDropL = skirtDrop(fy, fLx, fLz);
      const fDropR = skirtDrop(fy, fRx, fRz);
      const shoulderP = inTunnel
        ? 0x4a4034
        : shoulderTintHex(terrainHex, blendP.from, blendP.to, blendP.mix);
      const shoulderQ = inTunnel
        ? 0x4a4034
        : shoulderTintHex(terrainHex, blendQ.from, blendQ.to, blendQ.mix);
      vert(sb, eLx, eDropL, eLz, skirtHex);
      vert(sb, e.lx, ey, e.lz, shoulderP);
      vert(sb, fLx, fDropL, fLz, skirtHex);
      vert(sb, f.lx, fy, f.lz, shoulderQ);
      quad(sb);
      vert(sb, e.rx, ey, e.rz, shoulderP);
      vert(sb, eRx, eDropR, eRz, skirtHex);
      vert(sb, f.rx, fy, f.rz, shoulderQ);
      vert(sb, fRx, fDropR, fRz, skirtHex);
      quad(sb);

      const kb = plainBucket(kerb, chunk);
      const hexP = mixHex(kerbHexFor(blendP.from, p.dist, p.tunnel), kerbHexFor(blendP.to, p.dist, p.tunnel), blendP.mix);
      const hexQ = mixHex(kerbHexFor(blendQ.from, q.dist, q.tunnel), kerbHexFor(blendQ.to, q.dist, q.tunnel), blendQ.mix);
      vert(kb, e.lx, e.y + 0.02, e.lz, hexP);
      vert(kb, e.lx + p.nx * kerbW, e.y + 0.05, e.lz + p.nz * kerbW, hexP);
      vert(kb, f.lx, f.y + 0.02, f.lz, hexQ);
      vert(kb, f.lx + q.nx * kerbW, f.y + 0.05, f.lz + q.nz * kerbW, hexQ);
      quad(kb);
      vert(kb, e.rx, e.y + 0.02, e.rz, hexP);
      vert(kb, e.rx - p.nx * kerbW, e.y + 0.05, e.rz - p.nz * kerbW, hexP);
      vert(kb, f.rx, f.y + 0.02, f.rz, hexQ);
      vert(kb, f.rx - q.nx * kerbW, f.y + 0.05, f.rz - q.nz * kerbW, hexQ);
      quad(kb);
    }

    const group = new THREE.Group();
    /** @type {Map<string, THREE.Material>} one material per surface, shared by its slices */
    const roadMats = new Map();
    for (const b of road.values()) {
      if (!b.n) continue;
      let mat = roadMats.get(b.id);
      if (!mat) {
        mat = worldRoadMaterial(
          b.id,
          roadTextureFor(b.id),
          roadNormalFor(b.id),
          roadAoFor(b.id),
          roadRoughFor(b.id)
        );
        roadMats.set(b.id, mat);
      }
      const mesh = new THREE.Mesh(buildGeo(b, true), mat);
      mesh.receiveShadow = true;
      mesh.renderOrder = 2;
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -4;
      mat.polygonOffsetUnits = -8;
      this._registerChunk(mesh, b.chunk);
      group.add(mesh);
    }

    const skirtMat = worldSkirtMaterial();
    const kerbMat = worldKerbMaterial();
    for (const [chunk, b] of skirt) {
      if (!b.n) continue;
      const mesh = new THREE.Mesh(buildGeo(b, false), skirtMat);
      mesh.receiveShadow = true;
      this._registerChunk(mesh, chunk);
      group.add(mesh);
    }
    for (const [chunk, b] of kerb) {
      if (!b.n) continue;
      const mesh = new THREE.Mesh(buildGeo(b, false), kerbMat);
      mesh.receiveShadow = true;
      this._registerChunk(mesh, chunk);
      group.add(mesh);
    }
    return group;
  }

  _terrain(p, side, def) {
    const dune = def && def.scenery === "desert";
    if (dune) {
      return (
        Math.sin(p.dist * 0.045 + side * 1.7) * 3.4 +
        Math.sin(p.x * 0.02 + p.z * 0.018) * 2.2 +
        Math.abs(Math.sin(p.dist * 0.011 + side)) * 2.8
      );
    }
    return Math.sin(p.dist * 0.07 + side) * 1.4 + Math.sin(p.x * 0.03) * 0.8;
  }

  /**
   * Sprint 21 — prefer authored GLB kit geometry over procedural stand-ins.
   * @param {string} kind
   * @param {THREE.BufferGeometry|null} [fallback]
   * @returns {THREE.BufferGeometry|null}
   */
  _propGeo(kind, fallback = null) {
    if ((VISUAL.tier || 0) >= 8 && VISUAL.glbProps !== false && propReady()) {
      const geo = propGeometry(kind);
      if (geo) return geo;
    }
    return fallback;
  }

  /**
   * Map foliage bag names → HD tree GLB kind. Forest + Mountain use
   * low_poly_forest_tree_pack; other biomes keep Kenney nature trees.
   * @param {string} kind
   * @param {string} [scenery]
   * @returns {string|null}
   */
  _hdTreeGlb(kind, scenery) {
    if (scenery === "forest" || scenery === "mountain") {
      const forestMap = {
        pine: "forest_tree_a",
        cedar: "forest_tree_b",
        oak: "forest_tree_c",
        fir: "forest_tree_d",
        autumn: "forest_tree_e",
        autumnGold: "forest_tree_f",
        acacia: "forest_tree_b",
      };
      const pack = forestMap[kind];
      if (pack && propForestTreeParts(pack)) return pack;
      // Any live pack variant beats a Kenney fallback on these stages.
      for (let i = 0; i < FOREST_TREE_KINDS.length; i++) {
        if (propForestTreeParts(FOREST_TREE_KINDS[i])) return FOREST_TREE_KINDS[i];
      }
    }
    const map = {
      pine: "tree_pineDefaultA",
      cedar: "tree_pineDefaultB",
      oak: "tree_oak",
      autumn: "tree_detailed",
      autumnGold: "tree_default",
      acacia: "tree_palmDetailedTall",
      fir: "tree_fir",
    };
    return map[kind] || null;
  }

  /**
   * Instanced HD nature prop — skip silently if the GLB is missing (never plant cones).
   * Forest pack trees plant trunk + canopy as a pair (authored textures).
   * Trees also get a crossed-plane far LOD so Forest does not shade every GLB
   * out to the fog wall.
   * @param {string} glbKind
   * @param {object[]} poses
   * @param {{castShadow?:boolean, receiveShadow?:boolean}} [opts]
   */
  _addHdNature(glbKind, poses, opts) {
    if (!poses || !poses.length) return;
    if (this._addLodTrees(glbKind, poses, opts)) return;
    const geo = this._propGeo(glbKind);
    if (!geo) {
      console.warn(`[scenery] HD prop missing — skip primitives: ${glbKind}`);
      return;
    }
    this._addInstances(geo, propNatureMaterial(glbKind), poses, opts || { castShadow: true });
  }

  /**
   * True when this GLB is a tree we can pair with a card impostor.
   * @param {string} glbKind
   */
  _isLodTreeKind(glbKind) {
    const n = String(glbKind || "");
    return /tree|pine|fir|oak|cedar|acacia|palm/i.test(n);
  }

  /**
   * GLB ground-scale poses → 3-plane card poses (metres, origin at mid-crown).
   * @param {object[]} poses
   * @returns {object[]}
   */
  _treeCardPoses(poses) {
    const out = [];
    for (let i = 0; i < poses.length; i++) {
      const p = poses[i];
      const s = p.s != null ? Math.abs(p.s) : 1;
      const h = p.sy != null ? Math.abs(p.sy) : s * 11.5;
      const w = p.sx != null ? Math.abs(p.sx) : s * 6.2;
      const ground = p.groundY != null ? p.groundY : p.sy != null ? p.y - h * 0.5 : p.y;
      out.push({
        c: p.c,
        x: p.x,
        y: ground + h * 0.48,
        z: p.z,
        sx: w,
        sy: h,
        sz: w,
        rx: (p.rx || 0) * 0.45,
        ry: p.ry || 0,
        rz: (p.rz || 0) * 0.45,
      });
    }
    return out;
  }

  /**
   * Near = authored GLB (or trunk+canopy pair). Far = painted crown cards.
   * @param {string} glbKind
   * @param {object[]} poses
   * @param {{castShadow?:boolean, receiveShadow?:boolean, farOnly?:boolean}} [opts]
   * @returns {boolean} true if handled as a tree LOD pair
   */
  _addLodTrees(glbKind, poses, opts) {
    if (!poses || !poses.length || !this._isLodTreeKind(glbKind)) return false;
    const farOnly = !!(opts && opts.farOnly);
    const cards = this._treeCardPoses(poses);
    const cardMat = foliageMaterial(treeCardKind(glbKind));
    const loOpts = { castShadow: false, receiveShadow: true, lod: "lo" };
    if (!farOnly) {
      const hiOpts = Object.assign({}, opts || { castShadow: true }, { lod: "hi" });
      const forestParts = propForestTreeParts(glbKind);
      if (forestParts) {
        this._addInstances(forestParts.trunk, forestParts.trunkMat, poses, hiOpts);
        this._addInstances(forestParts.canopy, forestParts.canopyMat, poses, hiOpts);
      } else {
        const geo = this._propGeo(glbKind);
        if (!geo) return false;
        this._addInstances(geo, propNatureMaterial(glbKind), poses, hiOpts);
      }
    }
    this._addInstances(crownGeometry(), cardMat, cards, loOpts);
    return true;
  }

  /**
   * Horizon ring of HD props (same rule: GLB only).
   * @param {string} glbKind
   * @param {object[]} poses
   * @param {{ cx: number, cz: number }} origin
   */
  _addHdBackdrop(glbKind, poses, origin) {
    if (!poses || !poses.length) return;
    if (!propReady()) return;
    if (this._isLodTreeKind(glbKind)) {
      this._addBackdropInstances(
        crownGeometry(),
        foliageMaterial(treeCardKind(glbKind)),
        this._treeCardPoses(poses),
        origin
      );
      return;
    }
    const geo = propGeometry(glbKind);
    if (!geo) {
      console.warn(`[scenery] HD backdrop missing — skip: ${glbKind}`);
      return;
    }
    this._addBackdropInstances(geo, propNatureMaterial(glbKind), poses, origin);
  }

  _addScenery(def) {
    // Sync path for idle preload (`new Track`): no awaits → runs to completion.
    void this._addSceneryBody(def, null);
  }

  /**
   * Trackside props. When `onProgress` is set, yields every N plant steps so the
   * loading % can advance during the long scenery pass instead of freezing.
   * @param {object} def
   * @param {((t: number) => void) | null} onProgress 0–1 within this phase
   */
  async _addSceneryBody(def, onProgress) {
    const yieldWork = createWorkYielder(10);
    const plantStep = def.scenery === "forest" ? 1 : 2;
    const plantTotal = Math.max(1, Math.ceil((this.points.length - 2) / plantStep));
    let planted = 0;
    this._markSightlines(def);
    const useGlb = (VISUAL.tier || 0) >= 8 && VISUAL.glbProps !== false && propReady();
    const rockGeo = this._propGeo("rock_largeA");
    const cactusStem = this._propGeo("cactus_tall");
    const bushGeo = this._propGeo("plant_bushDetailed");
    const glbCactus = useGlb && !!propGeometry("cactus_tall");
    const glbRock = useGlb && !!propGeometry("rock_largeA");
    const glbBush = useGlb && !!propGeometry("plant_bushDetailed");

    const rng = mulberry(def.seed || 7);
    const crowns = [];
    const crownsDark = [];
    const trunks = [];
    const rocks = [];
    const desertSpires = [];
    const bushes = [];
    const cacti = [];
    const cactiShort = [];
    const pine = [];
    const cedar = [];
    const oak = [];
    const autumn = [];
    const autumnGold = [];
    const acacia = [];
    const forestTrunks = [];
    const treeShadows = [];
    const forestBush = [];
    const forestBushDense = [];
    const forestBushRound = [];
    const forestFern = [];
    const fir = [];
    const forest = def.scenery === "forest";
    const mountain = def.scenery === "mountain";
    const lakeside = def.scenery === "lakeside";
    const cardBags = { pine, cedar, oak, autumn, autumnGold, acacia, fir, forestTrunks, treeShadows };
    /** Corsican maquis — mixed pack species for Stage 3 (not a single clone). */
    const MAQUIS_KINDS = ["cedar", "fir", "oak", "pine", "cedar", "fir"];
    /** Rust, gold, and a little green holdout — northern-European autumn. */
    const AUTUMN_KINDS = ["autumn", "autumnGold", "autumn", "autumnGold", "oak"];
    /** Pack-direct bags — Stage 2/3 plant straight into these for real variety. */
    for (let i = 0; i < FOREST_TREE_KINDS.length; i++) {
      cardBags[FOREST_TREE_KINDS[i]] = [];
    }

    for (let i = 2; i < this.points.length; i += plantStep) {
      const p = this.points[i];
      if (p.tunnel) continue;
      if (p.underpass) continue;
      if (p.jump || p.jumpWash) continue;
      const chunk = this._chunkOfDist(p.dist);
      for (const side of [-1, 1]) {
        if (def.scenery !== "forest" && def.scenery !== "lakeside" && rng() > 0.58) continue;
        if (forest && rng() > 0.94) continue;
        const spread = def.scenery === "desert" ? 18 : def.scenery === "forest" ? 24 : 12;
        // Sprint 26b: stages 2–4 keep a wide clear shoulder — 5.2 m used to put
        // trunks/bushes on the ribbon once jitter and canopy radius stacked up.
        const finaleClear = forest || mountain;
        const shoulderPad = def.scenery === "desert"
          ? 16.5
          : forest
            ? 16.5
            : finaleClear
              ? 13.5
              : 8.2;
        const off = p.width * 0.5 + shoulderPad + rng() * spread;
        const px = p.x + p.nx * side * off;
        const pz = p.z + p.nz * side * off;
        if (def.scenery === "desert" && this._inUnderpassCorridor(px, pz)) continue;
        const py = this._groundHeight(px, pz, def.scenery);
        const near = off < p.width * 0.5 + 11;
        const plantH = def.scenery === "mountain" ? 10 : def.scenery === "lakeside" ? 8 : 4;
        if (!this._mayPlant(p.dist, side, off, plantH)) continue;

        if (def.scenery === "desert") {
          const pick = rng();
          const cactusShort = useGlb && !!propGeometry("cactus_short");
          if (pick < 0.34) {
            if (!this._driveClear(px, pz, 1.4)) continue;
            cacti.push({
              c: chunk,
              x: px,
              y: glbCactus ? py : py + 1.55,
              z: pz,
              s: 0.85 + rng() * 0.85,
              ry: rng() * 6,
            });
            this._bumpNearRoad(px, pz, 0.9);
          } else if (pick < 0.48 && cactusShort) {
            if (!this._driveClear(px, pz, 1.0)) continue;
            cactiShort.push({
              c: chunk,
              x: px,
              y: py,
              z: pz,
              s: 0.65 + rng() * 0.55,
              ry: rng() * 6,
            });
            this._bumpNearRoad(px, pz, 0.65);
          } else if (pick < 0.74) {
            const s = 0.9 + rng() * 1.8;
            if (!this._driveClear(px, pz, Math.max(1.6, s * 0.75))) continue;
            const half = p.width * 0.5;
            if (off - s * 0.7 < half + ROAD_VERGE + 1.2) continue;
            rocks.push({
              c: chunk,
              x: px,
              y: glbRock ? py : py + 0.35,
              z: pz,
              s: glbRock ? s * 0.55 : s,
              rx: glbRock ? 0 : rng(),
              ry: rng() * 6,
              rz: glbRock ? 0 : rng(),
            });
            this._bumpNearRoad(px, pz, Math.max(0.85, s * 0.62));
          } else if (pick < 0.88) {
            if (!this._driveClear(px, pz, 1.2)) continue;
            bushes.push({
              c: chunk,
              x: px,
              y: glbBush ? py : py + 0.45,
              z: pz,
              ...(glbBush
                ? { s: 0.9 + rng() * 0.5, ry: rng() * 6 }
                : { sx: 0.8 + rng(), sy: 0.6 + rng(), sz: 0.8 + rng() }),
            });
            this._bumpNearRoad(px, pz, 0.7);
          } else {
            // Tall sandstone instead of palms / lollipop cacti — Desert only
            // plants saguaros, rocks, and scrub.
            const s = 1.4 + rng() * 2.2;
            if (!this._driveClear(px, pz, Math.max(1.8, s * 0.7))) continue;
            const half = p.width * 0.5;
            if (off - s * 0.65 < half + ROAD_VERGE + 1.2) continue;
            desertSpires.push({
              c: chunk,
              x: px,
              y: py,
              z: pz,
              s: s * 0.85,
              ry: rng() * 6,
            });
            this._bumpNearRoad(px, pz, Math.max(0.9, s * 0.55));
          }
        } else if (def.scenery === "mountain") {
          const gy = this._groundHeight(px, pz, "mountain");
          if (!this._ribbonClear(px, pz, 2.6)) continue;
          const pick = rng();
          const half = p.width * 0.5;
          if (pick < 0.48) {
            const s = 0.9 + rng() * 2.1;
            // Keep every boulder off the racing line: radius plus a clear verge.
            if (off - s * 0.7 > half + ROAD_VERGE + 1.2 && this._driveClear(px, pz, Math.max(2.6, s * 0.7))) {
              rocks.push({ c: chunk, x: px, y: gy + s * 0.28, z: pz, s, rx: rng(), ry: rng() * 6, rz: rng() });
              this._bumpNearRoad(px, pz, Math.max(0.7, s * 0.55));
            } else {
              this._plantForestTree(cardBags, px, gy, pz, rng, near, MAQUIS_KINDS, chunk, "mountain");
            }
          } else if (pick < 0.84) {
            this._plantForestTree(cardBags, px, gy, pz, rng, near, MAQUIS_KINDS, chunk, "mountain");
          } else {
            // Along-track jitter only — lateral jitter was sliding bushes onto asphalt.
            const along = (rng() - 0.5) * 3.2;
            const fx = Math.sin(p.heading);
            const fz = Math.cos(p.heading);
            const bx = px + fx * along;
            const bz = pz + fz * along;
            if (!this._ribbonClear(bx, bz, 1.4)) continue;
            const shy = this._groundHeight(bx, bz, "mountain");
            const sh = 1.15 + rng() * 0.7;
            forestBush.push({
              c: chunk,
              x: bx,
              y: shy + sh * 0.48,
              z: bz,
              sx: 1.5 + rng() * 1.4,
              sy: sh,
              sz: 1.5 + rng() * 1.4,
              ry: rng() * 6,
              r: 0.92 + rng() * 0.08,
              g: 0.9 + rng() * 0.08,
              b: 0.78 + rng() * 0.1,
            });
          }
        } else if (def.scenery === "lakeside") {
          const gy = this._groundHeight(px, pz, "lakeside");
          if (gy < p.y - 0.85) continue;
          if (!this._ribbonClear(px, pz, 2.4)) continue;
          if (rng() > 0.38) {
            this._plantForestTree(cardBags, px, gy, pz, rng, near, AUTUMN_KINDS, chunk);
          } else {
            bushes.push({
              c: chunk,
              x: px,
              y: gy + 0.45,
              z: pz,
              sx: 0.9 + rng(),
              sy: 0.7 + rng(),
              sz: 0.9 + rng(),
            });
          }
        } else {
          const gy = this._forestGround(px, pz);
          if (!this._ribbonClear(px, pz, FOREST_TREE_CLEAR)) continue;
          this._plantForestTree(cardBags, px, gy, pz, rng, near, null, chunk, "forest");
          if (rng() > 0.58) {
            const off2 = off + 7 + rng() * 16;
            const x2 = p.x + p.nx * side * off2;
            const z2 = p.z + p.nz * side * off2;
            if (!this._ribbonClear(x2, z2, FOREST_TREE_CLEAR)) continue;
            this._plantForestTree(cardBags, x2, this._forestGround(x2, z2), z2, rng, false, null, chunk, "forest");
          }
          if (rng() > 0.55) {
            const along = (rng() - 0.5) * 3.5;
            const fx = Math.sin(p.heading);
            const fz = Math.cos(p.heading);
            const bx = px + fx * along;
            const bz = pz + fz * along;
            if (!this._ribbonClear(bx, bz, 1.5)) continue;
            const by = this._forestGround(bx, bz);
            const glbBushPlant = useGlb && !!propGeometry("plant_bushLarge");
            const sh = 1.05 + rng() * 0.55;
            const pickBush = rng();
            const bushPose = glbBushPlant
              ? {
                  c: chunk,
                  x: bx,
                  y: by,
                  z: bz,
                  s: sh * (0.85 + rng() * 0.45),
                  ry: rng() * 6,
                }
              : {
                  c: chunk,
                  x: bx,
                  y: by + sh * 0.48,
                  z: bz,
                  sx: 1.7 + rng() * 1.8,
                  sy: sh,
                  sz: 1.7 + rng() * 1.8,
                  ry: rng() * 6,
                  r: 0.9 + rng() * 0.08,
                  g: 0.94 + rng() * 0.06,
                  b: 0.84 + rng() * 0.08,
                };
            if (pickBush < 0.34) forestBush.push(bushPose);
            else if (pickBush < 0.62) forestBushDense.push(bushPose);
            else if (pickBush < 0.88) forestBushRound.push(bushPose);
            else forestBush.push(bushPose);
          }
          if (rng() > 0.58) {
            const along = (rng() - 0.5) * 4;
            const fx = Math.sin(p.heading);
            const fz = Math.cos(p.heading);
            const fx2 = px + fx * along;
            const fz2 = pz + fz * along;
            if (!this._ribbonClear(fx2, fz2, 1.2)) continue;
            const fy = this._forestGround(fx2, fz2);
            const fh = 0.85 + rng() * 0.55;
            const glbFern = useGlb && !!propGeometry("plant_bushFern");
            forestFern.push(
              glbFern
                ? {
                    c: chunk,
                    x: fx2,
                    y: fy,
                    z: fz2,
                    s: fh * (0.9 + rng() * 0.4),
                    ry: rng() * 6,
                  }
                : {
                    c: chunk,
                    x: fx2,
                    y: fy + fh * 0.42,
                    z: fz2,
                    sx: 1.4 + rng() * 1.2,
                    sy: fh,
                    sz: 1.4 + rng() * 1.2,
                    ry: rng() * 6,
                  }
            );
          }
        }
      }
      planted += 1;
      if (onProgress && planted % 18 === 0) {
        onProgress(Math.min(0.72, planted / plantTotal));
        const wait = yieldWork();
        if (wait) await wait;
      }
    }

    if (onProgress) {
      onProgress(0.75);
      const wait = yieldWork();
      if (wait) await wait;
    }

    this._fillWild(def, rng, Object.assign(cardBags, {
      crowns,
      crownsDark,
      trunks,
      rocks,
      bushes,
      cacti,
      forestBush,
      forestBushDense,
      forestBushRound,
      forestFern,
    }));

    // Foliage: pack trees first (Stage 2/3), then species bags for other biomes.
    // Strip any pose whose mesh footprint invades the drive corridor.
    const stripDrive = (bag, foot) => {
      if (!bag || !bag.length) return;
      let w = 0;
      for (let i = 0; i < bag.length; i++) {
        const p = bag[i];
        if (!p) continue;
        const span = p.s != null ? p.s : Math.max(p.sx || 1, p.sz || 1, p.sy || 1, 0.7);
        const r = Math.max(foot, span * 0.55);
        const halfH = p.sy != null ? Math.abs(p.sy) * 0.5 : span * 0.5;
        if (this._laneKeepout(p.x, p.z, r, p.y, halfH)) continue;
        bag[w++] = p;
      }
      bag.length = w;
    };
    for (let ti = 0; ti < FOREST_TREE_KINDS.length; ti++) {
      const packKind = FOREST_TREE_KINDS[ti];
      const bag = cardBags[packKind];
      stripDrive(bag, forest || mountain ? FOREST_TREE_CLEAR + 0.8 : 5.8);
      if (!bag || !bag.length) continue;
      const forestParts = propForestTreeParts(packKind);
      if (!forestParts) continue;
      for (let i = 0; i < bag.length; i++) {
        const p = bag[i];
        if (p && p.y != null && p.sy == null) p.y = p.groundY != null ? p.groundY : p.y;
      }
      this._addLodTrees(packKind, bag);
    }
    const cards = [
      ["pine", pine],
      ["cedar", cedar],
      ["oak", oak],
      ["autumn", autumn],
      ["autumnGold", autumnGold],
      ["acacia", acacia],
      ["fir", fir],
    ];
    /** Non-pack biomes (desert / lakeside) keep Kenney trees. */
    const treeKindFor = {
      pine: "tree_pineDefaultA",
      cedar: "tree_pineDefaultB",
      oak: "tree_oak",
      autumn: "tree_detailed",
      autumnGold: "tree_default",
      acacia: "tree_palmDetailedTall",
      fir: "tree_fir",
    };
    for (const [kind, bag] of cards) {
      stripDrive(bag, forest ? FOREST_TREE_CLEAR : 5.8);
      if (!bag.length) continue;
      // Skip species bags emptied into pack bags on forest/mountain.
      if ((forest || mountain) && FOREST_TREE_KINDS.some((k) => propForestTreeParts(k))) continue;
      let glbKey = treeKindFor[kind] || this._hdTreeGlb(kind, def.scenery);
      if (!glbKey) continue;
      for (let i = 0; i < bag.length; i++) {
        const p = bag[i];
        if (p && p.y != null && p.sy == null) p.y = p.groundY != null ? p.groundY : p.y;
      }
      this._addLodTrees(glbKey, bag, { castShadow: true });
    }
    const plantBush = (geoKind, bag) => {
      if (!bag || !bag.length) return;
      this._addHdNature(geoKind, bag, { castShadow: true });
    };
    stripDrive(rocks, 3.6);
    stripDrive(cacti, 2.2);
    stripDrive(forestBush, 2.2);
    stripDrive(forestBushDense, 2.2);
    stripDrive(forestBushRound, 2.2);
    stripDrive(forestFern, 1.8);
    stripDrive(bushes, 2.2);
    stripDrive(crowns, 5.8);
    stripDrive(treeShadows, 4.0);
    plantBush("plant_bushLarge", forestBush);
    plantBush("plant_bushDense", forestBushDense);
    plantBush("plant_bushRound", forestBushRound);
    if (forestFern.length) this._addHdNature("plant_bushFern", forestFern, { castShadow: true });
    // Trunk cylinders only when GLB trees failed to load for a bag — HD trees include bark.
    if (!useGlb || !propGeometry("tree_pineDefaultA")) {
      /* no primitive trunks either when kit is armed */
    }
    this._addInstances(shadowGeometry(), shadowMaterial(), treeShadows, { receiveShadow: false });
    if (glbRock && rockGeo) {
      this._addInstances(rockGeo, propNatureMaterial("rock_largeA"), rocks, { castShadow: true });
      this._bumpPoses(rocks, 0.52);
    } else if (rocks.length) {
      console.warn("[scenery] rock GLB missing — skip primitive rocks");
    }
    if (desertSpires.length) {
      this._addHdNature("rock_tallA", desertSpires, { castShadow: true });
      this._bumpPoses(desertSpires, 0.58);
    }
    if (glbBush && bushGeo) {
      this._addInstances(bushGeo, propNatureMaterial("plant_bushDetailed"), bushes);
      this._bumpPoses(bushes, 0.48);
    }
    if (glbCactus && cactusStem) {
      this._addInstances(cactusStem, propNatureMaterial("cactus_tall"), cacti, { castShadow: true });
      this._bumpPoses(cacti, 0.45);
    }
    if (cactiShort.length) {
      this._addHdNature("cactus_short", cactiShort, { castShadow: true });
      this._bumpPoses(cactiShort, 0.38);
    }

    // Barriers: visual posts only. Hard colliders here used to build a sliding
    // wall along the verge and blocked legitimate off-road runoff. Sit past
    // the painted edge so they never occupy the racing line (hairpin opposite
    // arm included via _ribbonClear).
    if (def.barriers) {
      const wallMat = new THREE.MeshLambertMaterial({
        color: def.scenery === "mountain" ? 0x9a8a76 : 0x8a7a62,
        flatShading: true,
      });
      const wallGeo = new THREE.BoxGeometry(0.35, 0.85, 2.8);
      const posts = [];
      const barrierOff = ROAD_VERGE + 1.4;
      for (let i = 0; i < this.points.length; i += 3) {
        const p = this.points[i];
        if (p.tunnel) continue;
        if (Math.abs(Math.sin(p.dist * 0.04)) < 0.35) continue;
        const chunk = Math.min(this._chunkCount - 1, Math.max(0, Math.floor(p.dist / CHUNK_LEN)));
        for (const side of [-1, 1]) {
          const off = p.width * 0.5 + barrierOff;
          if (!this._mayPlant(p.dist, side, off, 1)) continue;
          const bx = p.x + p.nx * side * off;
          const bz = p.z + p.nz * side * off;
          if (!this._ribbonClear(bx, bz, 0.9)) continue;
          posts.push({ x: bx, y: p.y + 0.4, z: bz, ry: p.heading, c: chunk });
        }
      }
      this._addInstances(wallGeo, wallMat, posts);
    }

    if (onProgress) {
      onProgress(0.82);
      const wait = yieldWork();
      if (wait) await wait;
    }
    if (def.scenery === "desert") {
      this._addSafariHerd(rng);
      this._addDesertDriftLandmarks();
      this._addDesertTumbleweeds(rng);
      this._addDesertRoadsideGallery(rng);
      this._addDesertHorizonAcacia(rng);
    }
    if (def.scenery === "mountain") {
      this._addVillage(rng);
      this._addMountainCliff();
      this._addMountainDriftLandmarks();
      this._addDriftSweepBerms("mountain");
    }
    if (def.scenery === "forest") {
      this._addForestDriftLandmarks();
      this._addDriftSweepBerms("forest");
    }
    if (def.scenery === "lakeside") {
      this._addLake();
    }
    if (VISUAL.heroLandmarks && (VISUAL.tier || 0) >= 4) {
      this._addHeroLandmarks(def, rng);
    }
    // Tier 7 — roadside scrub / understory / scree / reeds (Environment Art).
    if ((VISUAL.tier || 0) >= 7) {
      this._addRealisticVergeDetail(def, rng);
    }
    this._addSpectators(rng, def);
    this._scrubRoadwayColliders();
    this._scrubRoadwayVisuals();
    if (onProgress) onProgress(1);
  }

  /**
   * Drop obstacle colliders that invade the drive corridor (painted lane +
   * car-footprint safety). Visual meshes may stay for scenery; physics solids
   * must never overlap the roadway buffer. Fail-loud when strictCorridor is on.
   */
  _scrubRoadwayColliders() {
    const list = this.colliders;
    if (!list || !list.length) {
      this.corridorViolations = [];
      return;
    }
    const kept = [];
    const dropped = [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.kind === "wall") {
        kept.push(c);
        continue;
      }
      const r = c.r || 0.5;
      const road = this._nearestRoad(c.x, c.z);
      const over = road.minOver != null ? road.minOver : road.dist - road.roadW * 0.5;
      // World-space sphere vs corridor — not the prop's origin alone.
      if (over - r >= ROAD_COLLIDER_CLEAR) {
        kept.push(c);
      } else {
        dropped.push({
          x: c.x,
          z: c.z,
          r,
          over,
          clear: ROAD_COLLIDER_CLEAR,
          along: road.along,
        });
      }
    }
    list.length = 0;
    for (let i = 0; i < kept.length; i++) list.push(kept[i]);
    this.corridorViolations = dropped;
    this._assertDriveCorridor(dropped);
    this._scrubCollidersOnRibbonSamples();
  }

  /**
   * Asset-level invariant: after scrub, no sphere collider may still sit in
   * the roadway safety corridor. Development / QA can set `strictCorridor`
   * (or `globalThis.__RALLY_STRICT_CORRIDOR__`) to throw instead of log.
   * @param {Array<{x:number,z:number,r:number,over:number}>} [alreadyDropped]
   */
  _assertDriveCorridor(alreadyDropped) {
    const list = this.colliders || [];
    const bad = [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.kind === "wall") continue;
      const r = c.r || 0.5;
      const road = this._nearestRoad(c.x, c.z);
      const over = road.minOver != null ? road.minOver : road.dist - road.roadW * 0.5;
      if (over - r < ROAD_COLLIDER_CLEAR) {
        bad.push({ x: c.x, z: c.z, r, over, along: road.along });
      }
    }
    if (!bad.length) {
      if (alreadyDropped && alreadyDropped.length && typeof console !== "undefined" && console.info) {
        console.info(
          `[corridor] scrubbed ${alreadyDropped.length} collider(s) from roadway safety zone`
        );
      }
      return;
    }
    const sample = bad[0];
    const msg =
      `Invalid track: collider overlaps roadway corridor ` +
      `(x=${sample.x.toFixed(1)} z=${sample.z.toFixed(1)} r=${sample.r.toFixed(2)} ` +
      `over=${sample.over.toFixed(2)} need≥${ROAD_COLLIDER_CLEAR})`;
    const strict =
      this.strictCorridor === true ||
      (typeof globalThis !== "undefined" && globalThis.__RALLY_STRICT_CORRIDOR__ === true);
    if (strict) throw new Error(msg);
    if (typeof console !== "undefined" && console.error) console.error(msg, bad.slice(0, 8));
    // Belt: drop any survivors that somehow remained.
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.kind === "wall") {
        list[w++] = c;
        continue;
      }
      const r = c.r || 0.5;
      const road = this._nearestRoad(c.x, c.z);
      const over = road.minOver != null ? road.minOver : road.dist - road.roadW * 0.5;
      if (over - r >= ROAD_COLLIDER_CLEAR) list[w++] = c;
    }
    list.length = w;
  }

  /**
   * Interpolate ribbon pose at an along-track distance (for corridor sampling).
   * @param {number} dist
   * @returns {{x:number,z:number,y:number,heading:number,width:number,dist:number}|null}
   */
  _ribbonPoseAt(dist) {
    const pts = this.points;
    if (!pts.length) return null;
    if (dist <= pts[0].dist) return pts[0];
    const last = pts[pts.length - 1];
    if (dist >= last.dist) return last;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (dist < a.dist || dist > b.dist) continue;
      const t = (dist - a.dist) / Math.max(1e-6, b.dist - a.dist);
      let dh = b.heading - a.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      return {
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        y: a.y + (b.y - a.y) * t,
        heading: a.heading + dh * t,
        width: a.width + (b.width - a.width) * t,
        dist,
      };
    }
    return last;
  }

  /**
   * True when a solid would block the car OBB centred on a ribbon sample.
   * Mirrors collide.js wall/sphere rules so scrub matches runtime authority.
   * @param {object} c collider
   * @param {number} px
   * @param {number} pz
   * @param {number} heading
   */
  _colliderBlocksSample(c, px, pz, heading) {
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const rx = fz;
    const rz = -fx;
    const HL = 2.35;
    const HW = 0.95;
    const WB = 2.4;
    if (c.kind === "wall") {
      const nx = c.nx;
      const nz = c.nz;
      const dx = px - c.x;
      const dz = pz - c.z;
      const along = dx * c.tx + dz * c.tz;
      if (along > c.halfLen + HL || along < -c.halfLen - HL) return false;
      const ext =
        HL * Math.abs(fx * nx + fz * nz) + HW * Math.abs(rx * nx + rz * nz);
      const dist = dx * nx + dz * nz;
      const overlap = ext - dist;
      if (overlap <= 0) return false;
      if (dist < -((c.depth || WB) + ext)) return false;
      return true;
    }
    const dx = px - c.x;
    const dz = pz - c.z;
    const r = c.r || 0.5;
    const ext =
      HL * Math.abs(fx) + HW * Math.abs(rx) + r;
    return Math.hypot(dx, dz) < ext + 0.15;
  }

  /**
   * Drop wall/sphere colliders that block the painted lane on the post-tunnel
   * mud hairpin (~1737 m). Point tests miss props whose origin sits on a
   * folded arm while the mesh spans the inner apex of the -62° corner.
   */
  _scrubCollidersOnRibbonSamples() {
    const runs = this._tunnels;
    if (!runs || !runs.length) return;
    const tunEnd = runs[0].endDist;
    const bands = [
      { dist0: tunEnd + 130, dist1: tunEnd + 200, step: 1.2 },
      { dist0: tunEnd - 36, dist1: tunEnd + 48, step: 2.0 },
    ];
    const list = this.colliders;
    if (!list || !list.length) return;
    const drop = new Set();
    for (let b = 0; b < bands.length; b++) {
      const band = bands[b];
      for (let d = band.dist0; d <= band.dist1; d += band.step) {
        const pose = this._ribbonPoseAt(d);
        if (!pose) continue;
        for (let i = 0; i < list.length; i++) {
          if (drop.has(i)) continue;
          const c = list[i];
          if (Math.hypot(c.x - pose.x, c.z - pose.z) > 42) continue;
          if (this._colliderBlocksSample(c, pose.x, pose.z, pose.heading)) {
            drop.add(i);
          }
        }
      }
    }
    if (!drop.size) return;
    const kept = [];
    for (let i = 0; i < list.length; i++) {
      if (!drop.has(i)) kept.push(list[i]);
    }
    list.length = 0;
    for (let i = 0; i < kept.length; i++) list.push(kept[i]);
    if (typeof console !== "undefined" && console.info) {
      console.info(`[corridor] ribbon-sample scrub dropped ${drop.size} collider(s) on mud band`);
    }
  }

  /**
   * Remove or tuck visual env geometry that still invades the drive corridor.
   * Collider scrub alone left meshes on the paint — the car drove through sand
   * banks and bush canopies with no matching solid.
   */
  _scrubRoadwayVisuals() {
    const world = new THREE.Vector3();
    const inv = new THREE.Matrix4();
    const doomed = [];
    this.group.traverse((obj) => {
      if (!obj.isMesh || !obj.geometry) return;
      const attr = obj.geometry.attributes.position;
      if (!attr) return;
      if (obj.userData.envLand) {
        obj.updateMatrixWorld(true);
        inv.copy(obj.matrixWorld).invert();
        let changed = false;
        for (let i = 0; i < attr.count; i++) {
          world.fromBufferAttribute(attr, i);
          world.applyMatrix4(obj.matrixWorld);
          const road = this._nearestRoad(world.x, world.z);
          const over = road.minOver != null ? road.minOver : road.dist - road.roadW * 0.5;
          if (over >= ROAD_COLLIDER_CLEAR + 0.2) continue;
          const floor = road.roadY - ROAD_DECK - 0.14;
          if (world.y <= floor + 0.04) continue;
          world.y = floor;
          world.applyMatrix4(inv);
          attr.setXYZ(i, world.x, world.y, world.z);
          changed = true;
        }
        if (changed) {
          attr.needsUpdate = true;
          obj.geometry.computeVertexNormals();
        }
        return;
      }
      if (obj.isInstancedMesh || obj.userData.tunnelPortal) return;
      if (!obj.userData.envProp) return;
      obj.updateMatrixWorld(true);
      if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
      const box = obj.geometry.boundingBox.clone().applyMatrix4(obj.matrixWorld);
      const cx = (box.min.x + box.max.x) * 0.5;
      const cz = (box.min.z + box.max.z) * 0.5;
      const r = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.5;
      if (this._laneKeepout(cx, cz, r, box.min.y)) doomed.push(obj);
    });
    for (let i = 0; i < doomed.length; i++) {
      const obj = doomed[i];
      if (obj.parent) obj.parent.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
    }
    this._scrubInstancedCorridor();
    this._scrubBridgeGroups();
    this._scrubRoadwayColliders();
  }

  /**
   * Remove non-instanced rock-bridge hills whose world AABB still spans asphalt.
   */
  _scrubBridgeGroups() {
    const doomed = [];
    this.group.traverse((obj) => {
      if (!obj.isGroup || !obj.userData.desertBridge) return;
      this._scrubBridgeDriveCorridor(obj);
    });
    void doomed;
  }

  /**
   * Drop instanced env props whose footprint still invades the drive corridor.
   * Centre-only tests let tall embankment boxes read as "overhead" while their
   * base sat on the mud ribbon (~1747 m post-tunnel).
   */
  _scrubInstancedCorridor() {
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const m = new THREE.Matrix4();
    this.group.traverse((obj) => {
      if (!obj.isInstancedMesh || obj.userData.tunnelPortal) return;
      if (!obj.userData.envProp) return;
      const arr = obj.instanceMatrix.array;
      const n = obj.count;
      let w = 0;
      for (let i = 0; i < n; i++) {
        const o = i * 16;
        m.fromArray(arr, o);
        m.decompose(pos, quat, scl);
        const r = Math.max(0.65, Math.max(Math.abs(scl.x), Math.abs(scl.y), Math.abs(scl.z)) * 0.55);
        const halfH = Math.abs(scl.y) * 0.5;
        if (this._laneKeepout(pos.x, pos.z, r, pos.y, halfH)) continue;
        if (w !== i) {
          for (let k = 0; k < 16; k++) arr[w * 16 + k] = arr[o + k];
          if (obj.instanceColor) {
            const ca = obj.instanceColor.array;
            ca[w * 3] = ca[i * 3];
            ca[w * 3 + 1] = ca[i * 3 + 1];
            ca[w * 3 + 2] = ca[i * 3 + 2];
          }
        }
        w += 1;
      }
      if (w < n) {
        obj.count = w;
        obj.instanceMatrix.needsUpdate = true;
        if (obj.instanceColor) obj.instanceColor.needsUpdate = true;
      }
    });
  }

  /**
   * Mid/far props so looking off-line hits solid woods, dunes, or rock — not sky.
   */
  _fillWild(def, rng, bags) {
    const scenery = def.scenery;
    const samples = [];
    for (let i = 0; i < this.points.length; i += 2) {
      if (!this.points[i].tunnel) samples.push(this.points[i]);
    }
    if (!samples.length) return;
    const farTrees = scenery === "forest" ? 420 : scenery === "lakeside" ? 220 : scenery === "mountain" ? 140 : 0;
    const farRocks = scenery === "desert" ? 145 : scenery === "mountain" ? 140 : 36;
    const farCacti = scenery === "desert" ? 105 : 0;
    const farBush = scenery === "desert" ? 82 : scenery === "forest" ? 85 : 48;

    const scatter = (count, minOff, maxOff, push) => {
      for (let n = 0; n < count; n++) {
        const p = samples[(rng() * samples.length) | 0];
        const side = rng() > 0.5 ? 1 : -1;
        const off = minOff + rng() * (maxOff - minOff);
        const along = (rng() - 0.5) * 14;
        const fx = Math.sin(p.heading);
        const fz = Math.cos(p.heading);
        const x = p.x + p.nx * side * off + fx * along;
        const z = p.z + p.nz * side * off + fz * along;
        const y = this._groundHeight(x, z, scenery);
        push(x, y, z, rng, this._chunkOfDist(p.dist));
      }
    };

    const AUTUMN_KINDS = ["autumn", "autumnGold", "autumn", "autumnGold", "oak"];
    scatter(farTrees, 26, scenery === "forest" ? 145 : scenery === "mountain" ? 70 : 100, (x, y, z, r, c) => {
      if (!this._driveClear(x, z, 2.8)) return;
      if (scenery === "lakeside") {
        if (y < 0.2) return;
        const road = this._nearestRoad(x, z);
        const side = road.side >= 0 ? 1 : -1;
        if (!this._mayPlant(road.along, side, road.dist, 8)) return;
        this._plantForestTree(bags, x, y, z, r, false, AUTUMN_KINDS, c);
        return;
      }
      if (scenery === "forest") {
        const road = this._nearestRoad(x, z);
        const plantSide = road.side >= 0 ? 1 : -1;
        if (!this._mayPlant(road.along, plantSide, road.dist, 12)) return;
        if (!this._ribbonClear(x, z, FOREST_TREE_CLEAR)) return;
        this._plantForestTree(bags, x, y, z, r, false, null, c, "forest");
        return;
      }
      if (scenery === "mountain") {
        const road = this._nearestRoad(x, z);
        const side = road.side >= 0 ? 1 : -1;
        if (!this._mayPlant(road.along, side, road.dist, 10)) return;
        this._plantForestTree(bags, x, y, z, r, false, ["cedar", "fir", "oak", "pine"], c, "mountain");
        return;
      }
      if (scenery === "desert") return;
      const tall = 1.6 + r() * 2.4;
      bags.trunks.push({ c, x, y: y + 1.2, z, sx: 1.2 + r(), sy: 2 + r(), sz: 1.2 + r() });
      const list = r() > 0.5 ? bags.crownsDark : bags.crowns;
      list.push({ c, x, y: y + 5.2 + tall, z, sx: 1.4 + r(), sy: tall + 1.2, sz: 1.4 + r(), ry: r() * 6 });
    });
    scatter(farRocks, scenery === "desert" ? 24 : 16, scenery === "mountain" ? 130 : 110, (x, y, z, r, c) => {
      const s = 1.2 + r() * 3.4;
      if (!this._driveClear(x, z, s * 0.7)) return;
      const road = this._nearestRoad(x, z);
      if (scenery === "forest" || scenery === "mountain") {
        if (road.dist < road.roadW * 0.5 + s * 0.7 + 3.5) return;
        if (scenery === "forest") {
          const side = road.side >= 0 ? 1 : -1;
          if (!this._mayPlant(road.along, side, road.dist, s + 1.2)) return;
        }
      } else if (scenery === "desert") {
        if (road.tunnel) return;
        if (road.dist < road.roadW * 0.5 + s * 0.7 + ROAD_VERGE) return;
        const side = road.side >= 0 ? 1 : -1;
        if (!this._mayPlant(road.along, side, road.dist, s + 1.2)) return;
      }
      bags.rocks.push({ c, x, y: y + s * 0.25, z, s, rx: r(), ry: r() * 6, rz: r() });
      this._bumpNearRoad(x, z, Math.max(0.9, s * 0.62));
    });
    scatter(farCacti, 20, 80, (x, y, z, r, c) => {
      if (!this._ribbonClear(x, z, 1.2)) return;
      if (scenery === "desert") {
        const road = this._nearestRoad(x, z);
        if (road.tunnel) return;
        const side = road.side >= 0 ? 1 : -1;
        if (!this._mayPlant(road.along, side, road.dist, 3.2)) return;
      }
          bags.cacti.push({
            c,
            x,
            y:
              (VISUAL.tier || 0) >= 8 && VISUAL.glbProps !== false && propGeometry("cactus_tall")
                ? y
                : y + 1.55,
            z,
            s: 0.8 + r() * 1.1,
            ry: r() * 6,
          });
          this._bumpNearRoad(x, z, 0.85);
    });
    scatter(farBush, 12, 70, (x, y, z, r, c) => {
      if (!this._ribbonClear(x, z, 1.2)) return;
      if (scenery === "desert" && !this._ribbonClear(x, z, 1.0)) return;
      const glbBush =
        (VISUAL.tier || 0) >= 8 && VISUAL.glbProps !== false && propGeometry("plant_bushLarge");
      if (scenery === "forest" && bags.forestFern && r() > 0.52) {
        const fh = 0.9 + r() * 0.55;
        const glbFern = propGeometry("plant_bushFern");
        bags.forestFern.push(
          glbFern
            ? { c, x, y, z, s: fh * (0.9 + r() * 0.35), ry: r() * 6 }
            : {
                c,
                x,
                y: y + fh * 0.4,
                z,
                sx: 1.5 + r() * 1.4,
                sy: fh,
                sz: 1.5 + r() * 1.4,
                ry: r() * 6,
              }
        );
        return;
      }
      if (scenery === "forest" || scenery === "mountain" || scenery === "lakeside") {
        const sy = 1.0 + r() * 0.55;
        const bag =
          scenery === "forest" && bags.forestBushDense && r() > 0.55
            ? bags.forestBushDense
            : bags.forestBush;
        bag.push(
          glbBush
            ? { c, x, y, z, s: sy * (0.9 + r() * 0.45), ry: r() * 6 }
            : {
                c,
                x,
                y: y + sy * 0.48,
                z,
                sx: 2.1 + r() * 2.2,
                sy,
                sz: 2.1 + r() * 2.2,
                ry: r() * 6,
                r: 0.9 + r() * 0.08,
                g: 0.94 + r() * 0.06,
                b: 0.84 + r() * 0.08,
              }
        );
        return;
      }
      bags.bushes.push({ c, x, y: y + 0.5, z, sx: 1 + r() * 1.4, sy: 0.7 + r(), sz: 1 + r() * 1.4 });
    });
  }

  /**
   * Sit a Forest tree on the land plane, not the racing ribbon or a hill that
   * the mesh never actually reaches.
   */
  _forestGround(x, z) {
    return this._groundHeight(x, z, "forest");
  }

  /**
   * One mixed-species tree. Forest + Mountain plant from
   * low_poly_forest_tree_pack variants; other biomes use Kenney / cards.
   * `y` is ground. Trunk is buried a few cm so it never hovers.
   */
  _plantForestTree(bags, x, y, z, rng, near, kinds, chunk, scenery) {
    const foot = scenery === "forest" || scenery === "mountain" ? FOREST_TREE_CLEAR : 5.8;
    if (!this._ribbonClear(x, z, foot)) return;
    const roll = rng();
    const leanX = (rng() - 0.5) * 0.08;
    const leanZ = (rng() - 0.5) * 0.08;
    const yaw = rng() * Math.PI * 2;
    let kind = "oak";
    let h = 6.2 + rng() * 3.4;
    let w = 4.6 + rng() * 2.2;
    if (kinds && kinds.length) {
      // Course-specific canopy: Lakeside runs rust and gold broadleaf, the
      // Safari gallery runs flat-topped acacia. Same cards, different paint.
      kind = kinds[Math.min(kinds.length - 1, (roll * kinds.length) | 0)];
      if (kind === "acacia") {
        h = 5.4 + rng() * 2.8;
        w = 7.2 + rng() * 3.4;
      } else if (kind === "cedar" || kind === "fir") {
        h = 9.5 + rng() * 5.5;
        w = 2.8 + rng() * 1.2;
      } else if (kind === "pine") {
        h = 8.5 + rng() * 4.8;
        w = 4 + rng() * 1.8;
      } else {
        h = 6.8 + rng() * 3.8;
        w = 5.2 + rng() * 2.6;
      }
    } else if (roll < 0.34) {
      kind = "pine";
      h = 8.5 + rng() * 4.8;
      w = 4 + rng() * 1.8;
    } else if (roll < 0.58) {
      kind = "cedar";
      h = 10 + rng() * 6;
      w = 3 + rng() * 1.4;
    } else if (roll < 0.74) {
      kind = "fir";
      h = 9 + rng() * 5;
      w = 3.4 + rng() * 1.5;
    } else {
      kind = "oak";
      h = 7 + rng() * 3.6;
      w = 5.4 + rng() * 2.8;
    }
    const embed = kind === "pine" || kind === "cedar" || kind === "fir" ? 0.45 : 0.32;
    const ground = y - embed;

    // Stage 2 / 3: plant into pack-variant bags so the verge is a real mix.
    const usePack =
      (scenery === "forest" || scenery === "mountain") &&
      (VISUAL.tier || 0) >= 8 &&
      VISUAL.glbProps !== false &&
      propReady();
    if (usePack) {
      const palette = scenery === "mountain" ? FOREST_MOUNTAIN_PALETTE : FOREST_STAGE_PALETTE;
      let packKind = null;
      for (let attempt = 0; attempt < palette.length; attempt++) {
        const candidate = palette[((roll * 97 + attempt * 13) | 0) % palette.length];
        if (propForestTreeParts(candidate)) {
          packKind = candidate;
          break;
        }
      }
      if (!packKind) {
        for (let i = 0; i < FOREST_TREE_KINDS.length; i++) {
          if (propForestTreeParts(FOREST_TREE_KINDS[i])) {
            packKind = FOREST_TREE_KINDS[i];
            break;
          }
        }
      }
      if (packKind) {
        if (!bags[packKind]) bags[packKind] = [];
        const refH = 11.5;
        const scaleJitter =
          scenery === "mountain" ? 0.92 + rng() * 0.38 : 0.78 + rng() * 0.48;
        bags[packKind].push({
          c: chunk,
          x,
          y: ground,
          z,
          s: (h / refH) * scaleJitter,
          ry: yaw,
          rx: leanX * 0.35,
          rz: leanZ * 0.35,
          groundY: ground,
        });
        bags.treeShadows.push({
          c: chunk,
          x,
          y: y + 0.04,
          z,
          sx: w * 0.34 * this._contactShadowScale(),
          sy: 1,
          sz: w * 0.28 * this._contactShadowScale(),
          ry: yaw,
        });
        this._bumpNearRoad(x, z, 0.95);
        return;
      }
    }

    const useGlbTree =
      (VISUAL.tier || 0) >= 8 &&
      VISUAL.glbProps !== false &&
      propReady() &&
      (propForestTreeParts("forest_tree_a") ||
        propGeometry("tree_pineDefaultA") ||
        propGeometry("tree_oak"));
    if (useGlbTree) {
      if (!bags[kind]) bags[kind] = [];
      const refH = propForestTreeParts("forest_tree_a") ? 11.5 : 8;
      bags[kind].push({
        c: chunk,
        x,
        y: ground,
        z,
        s: (h / refH) * (0.85 + rng() * 0.35),
        ry: yaw,
        rx: leanX * 0.35,
        rz: leanZ * 0.35,
        groundY: ground,
      });
      bags.treeShadows.push({
        c: chunk,
        x,
        y: y + 0.04,
        z,
        sx: w * 0.34 * this._contactShadowScale(),
        sy: 1,
        sz: w * 0.28 * this._contactShadowScale(),
        ry: yaw,
      });
      this._bumpNearRoad(x, z, 0.95);
      return;
    }
    const broad = kind === "oak" || kind === "autumn" || kind === "autumnGold";
    const trunkH = kind === "acacia" ? h * 0.52 : broad ? h * 0.38 : h * 0.55;
    const trunkR = broad ? 0.28 + rng() * 0.16 : 0.16 + rng() * 0.1;
    bags.forestTrunks.push({
      c: chunk,
      x,
      y: ground + trunkH * 0.5,
      z,
      sx: trunkR / 0.22,
      sy: trunkH,
      sz: trunkR / 0.22,
      rx: leanX,
      ry: yaw,
      rz: leanZ,
    });
    const crownH = kind === "acacia" ? h * 0.5 : broad ? h * 0.72 : h * 0.92;
    if (!bags[kind]) bags[kind] = [];
    // Pine/cedar cards are a triangle whose visual base is the bottom of the
    // plane. Sit that base on the dirt. Broadleaf canopies stay lifted on a
    // trunk so they still read as a crown, not a hedge.
    const cone = kind === "pine" || kind === "cedar" || kind === "fir";
    bags[kind].push({
      c: chunk,
      x,
      y: cone ? ground + crownH * 0.48 : ground + trunkH * 0.55 + crownH * 0.5,
      z,
      sx: w,
      sy: crownH,
      sz: w,
      rx: leanX * 0.35,
      ry: yaw,
      rz: leanZ * 0.35,
      r: 0.9 + rng() * 0.1,
      g: 0.94 + rng() * 0.08,
      b: 0.86 + rng() * 0.1,
    });
    bags.treeShadows.push({
      c: chunk,
      x,
      y: y + 0.04,
      z,
      sx: w * 0.34 * this._contactShadowScale(),
      sy: 1,
      sz: w * 0.28 * this._contactShadowScale(),
      ry: yaw,
    });
    if (near) this._bumpNearRoad(x, z, Math.max(broad ? 1.15 : 0.95, w * 0.44));
    else this._bumpNearRoad(x, z, Math.max(0.95, w * 0.38));
  }

  /**
   * @param {THREE.BufferGeometry} geo
   * @param {THREE.Material} mat
   * @param {Array<{x:number,y:number,z:number,s?:number,sx?:number,sy?:number,sz?:number,rx?:number,ry?:number,rz?:number,r?:number,g?:number,b?:number}>} poses
   * @param {{castShadow?:boolean, receiveShadow?:boolean}} [opts]
   */
  _addInstances(geo, mat, poses, opts) {
    if (!poses.length) return;
    const kept = this._stripLanePoses(poses);
    if (!kept.length) return;
    poses = kept;
    // One batch per streaming slice. A course-long batch can never be culled,
    // so a Forest stage was shading all ~1400 tree cards every frame — most of
    // them behind the camera, all of them alpha-tested and double-sided.
    const byChunk = new Map();
    for (let i = 0; i < poses.length; i++) {
      const p = poses[i];
      const c = p.c != null ? p.c : this._chunkAt(p.x, p.z);
      let list = byChunk.get(c);
      if (!list) {
        list = [];
        byChunk.set(c, list);
      }
      list.push(p);
    }
    for (const [chunk, list] of byChunk) this._instanceBatch(geo, mat, list, chunk, opts);
  }

  /**
   * One InstancedMesh for one slice.
   * @param {THREE.BufferGeometry} geo
   * @param {THREE.Material} mat
   * @param {Array<object>} poses
   * @param {number} chunk
   * @param {{castShadow?:boolean, receiveShadow?:boolean}} [opts]
   */
  _instanceBatch(geo, mat, poses, chunk, opts) {
    const mesh = new THREE.InstancedMesh(geo, mat, poses.length);
    mesh.receiveShadow = !opts || opts.receiveShadow !== false;
    mesh.castShadow = !!(opts && opts.castShadow);
    const dummy = new THREE.Object3D();
    const tint = new THREE.Color(1, 1, 1);
    for (let i = 0; i < poses.length; i++) {
      const p = poses[i];
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(p.rx || 0, p.ry || 0, p.rz || 0);
      const s = p.s || 1;
      const sc = Math.abs(s);
      dummy.scale.set(
        p.sx != null ? Math.abs(p.sx) : sc,
        p.sy != null ? Math.abs(p.sy) : sc,
        p.sz != null ? Math.abs(p.sz) : sc
      );
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (p.r != null) tint.setRGB(p.r, p.g, p.b);
      else tint.setRGB(1, 1, 1);
      mesh.setColorAt(i, tint);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.userData.envProp = true;
    if (opts && opts.cameraFade) mesh.userData.cameraFade = true;
    if (opts && opts.lod) mesh.userData.lod = opts.lod;
    this._registerChunk(mesh, chunk);
    this.group.add(mesh);
  }

  /**
   * The Safari gallery. Zebra, elephant-grey, and tan animals standing off the
   * road — the single loudest signal that this is the Desert stage and not a
   * European rally (docs/AM3-RESEARCH.md section 7).
   *
   * Bigger and more numerous than before: at 30+ metres off the road the old
   * 0.7 m boxes were a few pixels tall and read as litter. Body and head are
   * merged into one geometry so a whole herd is two draw calls.
   */
  _addSafariHerd(rng) {
    const kinds = ["animal-zebra", "animal-elephant", "animal-gazelle"];
    /** @type {Array<Array<object>>} one bag per animal kind */
    const bags = [[], [], []];
    const n = Math.min(30, Math.max(10, (this.points.length / 46) | 0));
    for (let k = 0; k < n; k++) {
      const p = this.points[(6 + k * 10) % this.points.length];
      if (!p || p.tunnel) continue;
      const side = k % 2 === 0 ? 1 : -1;
      const herd = 2 + ((rng() * 3) | 0);
      const baseOff = p.width * 0.5 + 18 + rng() * 26;
      for (let m = 0; m < herd; m++) {
        const off = baseOff + (rng() - 0.5) * 9;
        const along = (rng() - 0.5) * 12;
        const fx = Math.sin(p.heading);
        const fz = Math.cos(p.heading);
        const scale = 0.85 + rng() * 0.45;
        const x = p.x + p.nx * side * off + fx * along;
        const z = p.z + p.nz * side * off + fz * along;
        if (this._nearestRoad(x, z).tunnel) continue;
        if (!this._driveClear(x, z, 1.6 * scale)) continue;
        bags[k % 3].push({
          x,
          y: this._groundHeight(x, z, "desert"),
          z,
          s: scale,
          ry: p.heading + (rng() - 0.5) * 2.2,
        });
        this._bumpNearRoad(x, z, Math.max(0.8, scale * 0.9));
      }
    }
    for (let i = 0; i < 3; i++) {
      if (bags[i].length) this._addHdNature(kinds[i], bags[i], { castShadow: true });
    }
  }

  /**
   * Desert rally gallery — tape barriers, posts, and tire stacks at landmarks
   * so the stage reads as a WRC spectator event, not an empty dune field.
   * @param {() => number} rng
   */
  _addDesertRoadsideGallery(rng) {
    const postMat = worldPropMaterial({ color: 0x707880, roughness: 0.72, metalness: 0.18 });
    const tapeRed = worldPropMaterial({ color: 0xc83028, roughness: 0.78, metalness: 0.02 });
    const tapeWhite = worldPropMaterial({ color: 0xf0ece4, roughness: 0.76, metalness: 0.02 });
    const tireMat = worldPropMaterial({ color: 0x181818, roughness: 0.94, metalness: 0.04 });
    const postGeo = new THREE.CylinderGeometry(0.06, 0.08, 1.15, 6);
    const tapeGeo = new THREE.BoxGeometry(0.14, 0.22, 1.0);
    const tireGeo = new THREE.TorusGeometry(0.42, 0.14, 8, 16);
    const posts = [];
    const redTape = [];
    const whiteTape = [];
    const tires = [];

    for (let i = 6; i < this.points.length - 4; i += 1) {
      const p = this.points[i];
      if (p.tunnel || p.underpass) continue;
      const landmark = !!p.landmark;
      const gallery = landmark || i % 28 === 0;
      if (!gallery) continue;
      if (rng() > (landmark ? 0.92 : 0.55)) continue;

      const prev = this.points[Math.max(0, i - 4)];
      let dh = p.heading - prev.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      const outside = dh > 0 ? -1 : 1;
      const chunk = this._chunkOfDist(p.dist);
      const span = landmark ? 7 : 3;
      const step = landmark ? 1.05 : 1.35;

      for (let k = -span; k <= span; k++) {
        const j = Math.max(0, Math.min(this.points.length - 1, i + k));
        const q = this.points[j];
        const off = q.width * 0.5 + ROAD_VERGE + 2.4 + Math.abs(k) * 0.08;
        const bx = q.x + q.nx * outside * off;
        const bz = q.z + q.nz * outside * off;
        if (!this._ribbonClear(bx, bz, 0.85)) continue;
        const gy = this._groundHeight(bx, bz, "desert");
        posts.push({ c: chunk, x: bx, y: gy + 0.58, z: bz, s: 1, ry: q.heading + outside * 0.08 });
        const tapeY = gy + 0.82;
        const alt = Math.floor((k + span) / step) % 2 === 0;
        if (alt) {
          redTape.push({ c: chunk, x: bx, y: tapeY, z: bz, sx: 1, sy: 1, sz: 1, ry: q.heading + outside * 0.08 });
        } else {
          whiteTape.push({ c: chunk, x: bx, y: tapeY, z: bz, sx: 1, sy: 1, sz: 1, ry: q.heading + outside * 0.08 });
        }
      }

      if (landmark) {
        const q = p;
        const off = q.width * 0.5 + ROAD_VERGE + 3.2;
        const bx = q.x + q.nx * outside * off;
        const bz = q.z + q.nz * outside * off;
        const gy = this._groundHeight(bx, bz, "desert");
        for (let t = 0; t < 4; t++) {
          tires.push({
            c: chunk,
            x: bx + q.nx * outside * (t * 0.35 - 0.5),
            y: gy + 0.14 + t * 0.28,
            z: bz + q.nz * outside * (t * 0.35 - 0.5),
            s: 0.95,
            ry: q.heading + (rng() - 0.5) * 0.2,
            rx: Math.PI * 0.5,
          });
        }
      }
    }

    if (posts.length) this._addInstances(postGeo, postMat, posts, { castShadow: true, cameraFade: true });
    if (redTape.length) this._addInstances(tapeGeo, tapeRed, redTape, { cameraFade: true });
    if (whiteTape.length) this._addInstances(tapeGeo, tapeWhite, whiteTape, { cameraFade: true });
    if (tires.length) this._addInstances(tireGeo, tireMat, tires, { castShadow: true, cameraFade: true });
  }

  /**
   * Flat-topped acacia silhouettes on the desert horizon — depth without forest pack cost.
   * @param {() => number} rng
   */
  _addDesertHorizonAcacia(rng) {
    if ((VISUAL.tier || 0) < 4) return;
    const geo = crownGeometry();
    const mat = foliageMaterial("acacia");
    const trees = [];
    const n = 55 + ((rng() * 40) | 0);
    for (let k = 0; k < n; k++) {
      const p = this.points[(4 + k * 17) % this.points.length];
      if (!p || p.tunnel) continue;
      const side = k % 2 === 0 ? 1 : -1;
      const off = 95 + rng() * 130;
      const along = (rng() - 0.5) * 28;
      const fx = Math.sin(p.heading);
      const fz = Math.cos(p.heading);
      const x = p.x + p.nx * side * off + fx * along;
      const z = p.z + p.nz * side * off + fz * along;
      if (!this._driveClear(x, z, 4.5)) continue;
      const y = this._groundHeight(x, z, "desert");
      trees.push({
        c: this._chunkOfDist(p.dist),
        x,
        y: y + 3.2,
        z,
        sx: 5.5 + rng() * 4.5,
        sy: 3.2 + rng() * 2.8,
        sz: 5.5 + rng() * 4.5,
        ry: rng() * 6,
      });
    }
    if (trees.length) this._addInstances(geo, mat, trees, { receiveShadow: false, cameraFade: true });
  }

  /**
   * Alpine hamlet — authored house/tent GLBs along the cobbled section.
   */
  _addVillage(rng) {
    const plaster = new THREE.MeshLambertMaterial({ color: 0xd8c49c, flatShading: true });
    const roof = new THREE.MeshLambertMaterial({ color: 0x9a4028, flatShading: true });
    const houseGeo = this._propGeo("house-alpine");
    const tentGeo = this._propGeo("tent_detailedClosed");
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const walls = [];
    const roofs = [];
    const houses = [];
    const tents = [];
    for (let i = 8; i < this.points.length; i += 4) {
      const p = this.points[i];
      if (p.surface !== "cobble") continue;
      const side = rng() > 0.45 ? 1 : -1;
      const off = p.width * 0.5 + 10 + rng() * 6;
      const hx = p.x + p.nx * side * off;
      const hz = p.z + p.nz * side * off;
      if (!this._driveClear(hx, hz, 4.2)) continue;
      const hy = this._groundHeight(hx, hz, "mountain");
      const chunk = Math.min(this._chunkCount - 1, Math.max(0, Math.floor(p.dist / CHUNK_LEN)));
      if (houseGeo && rng() > 0.35) {
        houses.push({
          x: hx,
          y: hy,
          z: hz,
          s: 0.55 + rng() * 0.35,
          ry: p.heading + (rng() - 0.5) * 0.4,
          c: chunk,
        });
      } else if (tentGeo && rng() > 0.5) {
        tents.push({
          x: hx,
          y: hy,
          z: hz,
          s: 1.1 + rng() * 0.4,
          ry: p.heading,
          c: chunk,
        });
      } else {
        const w = 2.4 + rng();
        const d = 3.2 + rng();
        const h = 2.2 + rng();
        walls.push({ x: hx, y: hy + h * 0.5, z: hz, sx: w, sy: h, sz: d, ry: p.heading, c: chunk });
        roofs.push({
          x: hx,
          y: hy + h + 0.28,
          z: hz,
          sx: w + 0.5,
          sy: 0.55,
          sz: d + 0.5,
          ry: p.heading,
          c: chunk,
        });
      }
      this._bump(hx, hz, 2.4);
    }
    if (houses.length && houseGeo) this._addInstances(houseGeo, plaster, houses, { castShadow: true });
    if (tents.length && tentGeo) this._addInstances(tentGeo, roof, tents, { castShadow: true });
    if (walls.length) this._addInstances(unit, plaster, walls);
    if (roofs.length) this._addInstances(unit, roof, roofs);
  }

  /**
   * Racing-line sightlines, registered before trees are planted.
   * Landmarks and water need a camera corridor, not a sterile empty verge.
   * @param {object} def
   */
  _markSightlines(def) {
    this._keepOut = [];
    if (def.scenery === "desert") {
      this._keepOut.push({ dist0: 0, dist1: 210, side: null, minOff: 15, maxH: 2.4 });
      // Whole stage — keep cacti/rocks off the drive corridor so cars cannot
      // ghost through a mesh that sits on the painted verge.
      this._keepOut.push({ dist0: 0, dist1: this.length + 80, side: null, minOff: 16, maxH: 1.7 });
      const runs = this._tunnels || [];
      for (let i = 0; i < runs.length; i++) {
        const run = runs[i];
        this._keepOut.push({
          dist0: run.startDist - 55,
          dist1: run.startDist + 18,
          side: null,
          minOff: 7,
          maxH: 2.2,
        });
        this._keepOut.push({
          dist0: run.endDist - 18,
          dist1: run.endDist + 40,
          side: null,
          minOff: 7,
          maxH: 2.2,
        });
        // Whole tube: no cacti/rocks whose nearest road is the tunnel.
        this._keepOut.push({
          dist0: run.startDist,
          dist1: run.endDist,
          side: null,
          minOff: 80,
          maxH: 1.2,
        });
      }
    }
    if (def.scenery === "desert" || def.scenery === "forest" || def.scenery === "mountain") {
      // Landmark hairpins: keep tall canopy off the inside apex face.
      this._markLandmarkKeepOuts(false);
    }
    if (def.scenery === "forest") {
      const pin = this._findFirstLandmark();
      if (pin) {
        this._landmark = pin;
        // Glade bowl: chase cone through the clearing hairpin.
        this._keepOut.push({
          dist0: pin.dist - 55,
          dist1: pin.dist + 45,
          side: null,
          minOff: 12,
          maxH: 3.2,
        });
      }
      // Whole stage — keep tall canopy and banks off the drive corridor.
      this._keepOut.push({
        dist0: 0,
        dist1: this.length + 80,
        side: null,
        minOff: 15,
        maxH: 1.85,
      });
    }
    if (def.scenery === "mountain") {
      this._keepOut.push({ dist0: 0, dist1: this.length + 40, side: null, minOff: 14, maxH: 1.65 });
      this._keepOut.push({ dist0: 0, dist1: 320, side: null, minOff: 11, maxH: 1.85 });
      const pin = this._findHairpin();
      if (pin) {
        this._landmark = pin;
        this._keepOut.push({
          dist0: pin.dist - 95,
          dist1: pin.dist + 55,
          side: pin.inside,
          minOff: pin.width * 0.5 + 22,
          maxH: 1.15,
        });
        this._keepOut.push({
          dist0: pin.dist - 50,
          dist1: pin.dist + 80,
          side: null,
          minOff: 13,
          maxH: 2.8,
        });
      }
    }
    if (def.scenery === "lakeside") {
      const lakes = [
        { from: 0.12, to: 0.5, side: 1 },
        { from: 0.58, to: 0.86, side: -1 },
      ];
      this._lakes = lakes;
      for (let i = 0; i < lakes.length; i++) {
        const lake = lakes[i];
        this._keepOut.push({
          dist0: this.length * lake.from,
          dist1: this.length * lake.to,
          side: lake.side,
          minOff: 52,
          maxH: 1.35,
        });
        // Far-shore canopy beyond the basin — depth cue across the water.
        this._keepOut.push({
          dist0: this.length * lake.from,
          dist1: this.length * lake.to,
          side: lake.side,
          minOff: 108,
          maxH: 0.8,
        });
      }
    }
    // Universal chase-cam cone: tall canopy inside ~7 m of the verge fills
    // the medium camera. Low shrubs and rocks may still sit there.
    this._keepOut.push({ dist0: -1e6, dist1: 1e6, side: null, minOff: 12, maxH: 2.2 });
  }

  /**
   * Flatten land around authored landmark hairpins (all biomes).
   * Must run before the heightmap so tris cannot fold a bank through the apex.
   */
  _markLandmarkFlats() {
    if (!this._landmarkFlats) this._landmarkFlats = [];
    let runStart = -1;
    for (let i = 0; i < this.points.length; i++) {
      const marked = !!this.points[i].landmark;
      const last = i === this.points.length - 1;
      if (marked && runStart < 0) runStart = i;
      if (runStart >= 0 && (!marked || last)) {
        const end = marked && last ? i : i - 1;
        if (end >= runStart) {
          const a = this.points[runStart];
          const b = this.points[end];
          const lateral = Math.max(a.width, b.width) * 0.5 + 42;
          this._landmarkFlats.push({
            dist0: a.dist - 58,
            dist1: b.dist + 48,
            lateral,
          });
        }
        runStart = -1;
      }
    }
  }

  /**
   * Extra land washes where the car was clipping through environment polys:
   * Desert full corridor, Stage 2 finale (sweep + linked mud hairpins) and
   * Stage 3 full corridor.
   * @param {object} def
   */
  _markDriveClearCorridors(def) {
    if (!this._landmarkFlats) this._landmarkFlats = [];
    const scenery = def.scenery || "forest";
    if (scenery === "forest") {
      // Full-stage corridor — coarse land cells were folding ridges through the ribbon.
      this._landmarkFlats.push({
        dist0: -40,
        dist1: this.length + 90,
        lateral: 54,
      });
    }
    if (scenery === "mountain") {
      // Whole stage — coarse land cells were interpolating ridges through the ribbon.
      this._landmarkFlats.push({
        dist0: -40,
        dist1: this.length + 90,
        lateral: 46,
      });
    }
    if (scenery === "desert") {
      // Whole stage — 10 m land cells were folding dune banks through the
      // ribbon and the inside of tight gravel corners (radius 36–54).
      this._landmarkFlats.push({
        dist0: -40,
        dist1: this.length + 90,
        lateral: 56,
      });
      // Jump 3 (Safari throw) land + climb + tunnel mouth: dunes must stay
      // a floor under the ribbon so a landing cannot clip into sand.
      let gapN = 0;
      let prevK = "";
      let gap3 = null;
      for (let i = 0; i < this.points.length; i++) {
        const k = this.points[i].jumpKind || "";
        if (k === "gap" && prevK !== "gap") {
          gapN += 1;
          if (gapN === 3) gap3 = this.points[i].dist;
        }
        prevK = k;
      }
      if (gap3 != null) {
        let flatEnd = gap3 + 340;
        if (this._tunnels && this._tunnels.length) {
          flatEnd = Math.min(flatEnd, this._tunnels[0].startDist - 32);
        }
        this._landmarkFlats.push({
          dist0: gap3 - 24,
          dist1: flatEnd,
          lateral: 64,
        });
      }
      // Post-tunnel mud band — coarse land tris folded berms through the tight
      // -62° corner (~1737 m) after the bore exit.
      if (this._tunnels && this._tunnels.length) {
        const tunEnd = this._tunnels[0].endDist;
        this._landmarkFlats.push({
          dist0: tunEnd - 48,
          dist1: tunEnd + 320,
          lateral: 72,
        });
        // Inner-apex wash on the -62° mud hairpin (1720–1764 m).
        this._landmarkFlats.push({
          dist0: tunEnd + 130,
          dist1: tunEnd + 200,
          lateral: 80,
        });
      }
    }
    if (scenery === "lakeside") {
      this._landmarkFlats.push({
        dist0: -40,
        dist1: this.length + 90,
        lateral: 48,
      });
    }
    // Sweep berms sit outside the lane; flatten the corridor so land doesn't
    // climb under the car on the committed slide.
    let runStart = -1;
    for (let i = 0; i < this.points.length; i++) {
      const marked = !!this.points[i].sweep;
      const last = i === this.points.length - 1;
      if (marked && runStart < 0) runStart = i;
      if (runStart >= 0 && (!marked || last)) {
        const end = marked && last ? i : i - 1;
        if (end >= runStart) {
          const a = this.points[runStart];
          const b = this.points[end];
          const lateral = Math.max(a.width, b.width) * 0.5 + 48;
          this._landmarkFlats.push({
            dist0: a.dist - 40,
            dist1: b.dist + 36,
            lateral,
          });
        }
        runStart = -1;
      }
    }
  }

  /**
   * Flatten land under every jump (ramp → land) so the heightmap cannot fill
   * the flight path with dirt/grass walls the car clips through mid-air.
   */
  _markJumpCorridors() {
    if (!this._landmarkFlats) this._landmarkFlats = [];
    let runStart = -1;
    for (let i = 0; i < this.points.length; i++) {
      const marked = !!this.points[i].jump || !!this.points[i].jumpKind;
      const last = i === this.points.length - 1;
      if (marked && runStart < 0) runStart = i;
      if (runStart >= 0 && (!marked || last)) {
        const end = marked && last ? i : i - 1;
        if (end >= runStart) {
          const a = this.points[runStart];
          const b = this.points[end];
          const lateral = Math.max(a.width, b.width) * 0.5 + 36;
          this._landmarkFlats.push({
            dist0: a.dist - 18,
            dist1: b.dist + 28,
            lateral,
          });
          for (let j = runStart; j <= end; j++) {
            this.points[j].jumpWash = true;
          }
        }
        runStart = -1;
      }
    }
  }

  /**
   * Keep tall props off landmark hairpin insides — shared by Desert and Forest.
   * @param {boolean} [flatLand] — also flatten the heightmap near hairpins (legacy; prefer _markLandmarkFlats).
   */
  _markLandmarkKeepOuts(flatLand = false) {
    if (flatLand && !this._landmarkFlats) this._landmarkFlats = [];
    let runStart = -1;
    for (let i = 0; i < this.points.length; i++) {
      const marked = !!this.points[i].landmark;
      const last = i === this.points.length - 1;
      if (marked && runStart < 0) runStart = i;
      if (runStart >= 0 && (!marked || last)) {
        const end = marked && last ? i : i - 1;
        if (end >= runStart) {
          const a = this.points[runStart];
          const b = this.points[end];
          const half = Math.max(a.width, b.width) * 0.5;
          this._keepOut.push({
            dist0: a.dist - 48,
            dist1: b.dist + 38,
            side: null,
            minOff: half + 16,
            maxH: 1.8,
          });
          if (flatLand) {
            this._landmarkFlats.push({
              dist0: a.dist - 58,
              dist1: b.dist + 48,
              lateral: half + 42,
            });
          }
        }
        runStart = -1;
      }
    }
  }

  /**
   * First authored landmark on the stage — used for chase-cam framing.
   * @returns {{i:number, inside:number, dist:number, width:number}|null}
   */
  _findFirstLandmark() {
    for (let i = 0; i < this.points.length; i++) {
      if (!this.points[i].landmark) continue;
      const p = this.points[i];
      const prev = this.points[Math.max(0, i - 8)];
      let dh = p.heading - prev.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      const inside = dh > 0 ? 1 : -1;
      return { i, inside, dist: p.dist, width: p.width };
    }
    return null;
  }

  _findLastLandmark() {
    for (let i = this.points.length - 1; i >= 0; i--) {
      if (!this.points[i].landmark) continue;
      const p = this.points[i];
      const prev = this.points[Math.max(0, i - 8)];
      let dh = p.heading - prev.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      const inside = dh > 0 ? 1 : -1;
      return { i, inside, dist: p.dist, width: p.width };
    }
    return null;
  }

  /**
   * True when (along, lateral dist) sits inside a landmark / jump land wash.
   * @param {number} along
   * @param {number} dist
   * @param {number} roadW
   * @returns {boolean}
   */
  _inLandmarkFlat(along, dist, roadW) {
    const flats = this._landmarkFlats;
    if (!flats || !flats.length) return false;
    if (this._tunnelAlong(along) > 0.08) return false;
    const flatReach = Math.max(roadW * 0.5 + 36, this._trenchWidth(roadW) + 12);
    for (let i = 0; i < flats.length; i++) {
      const run = flats[i];
      const reach = run.lateral != null ? run.lateral : flatReach;
      if (along >= run.dist0 && along <= run.dist1 && dist < reach) return true;
    }
    return false;
  }

  /**
   * Drive-through hole under the Desert rock bridge. Shared by land wash,
   * portal refuse, and the authored arch so the empty volume cannot drift.
   * @param {{width:number}} p
   * @returns {{half:number, openH:number, clearHalfW:number, clearHalfD:number}}
   */
  _desertBridgePortal(p) {
    const half = p.width * 0.5;
    return {
      half,
      // Roof + chase cam + a jump crest, with metres to spare so the lintel
      // never sits in the car's bounding box.
      // Low enough that the lintel reads overhead in chase cam, tall enough
      // for the car + camera. The old 12.8 m hole felt like open sky, not a bridge.
      openH: 11.2,
      // Full lane plus more than a car-width kerb each side so a rally car fits.
      clearHalfW: half + 5.6,
      // Long enough that driving through it is a beat, not a picture-frame gate.
      clearHalfD: 20,
    };
  }

  /**
   * Land Y under the rock-bridge prism — the arch's own road height, not
   * whichever spline `_nearestRoad` picked (hairpin opposite arm).
   * @param {number} x
   * @param {number} z
   * @returns {number|null}
   */
  _underpassFloorY(x, z) {
    const prisms = this._underpassPrisms;
    if (!prisms || !prisms.length) return null;
    for (let i = 0; i < prisms.length; i++) {
      const pr = prisms[i];
      if (pr.y == null) continue;
      const dx = x - pr.x;
      const dz = z - pr.z;
      const along = dx * pr.fx + dz * pr.fz;
      const lat = dx * pr.nx + dz * pr.nz;
      if (along >= -pr.back && along <= pr.fwd && Math.abs(lat) <= pr.halfLat) {
        // Tuck just under the deck — a 1 m trench showed the underside of the
        // FrontSide road ribbon (backfaces) and read as a broken mesh.
        return pr.y - 0.14;
      }
    }
    return null;
  }

  /**
   * True when (x,z) sits inside a Desert underpass land corridor — wider than
   * the ribbon so coarse land tiles cannot fold sand through the opening.
   *
   * World-space prisms win over along-track runs: the finale hairpin loops
   * back near the bridge in XZ, so nearest-road `along` alone mis-labels
   * underpass vertices and lets dune triangles refill the hole.
   * @param {number} x
   * @param {number} z
   * @returns {boolean}
   */
  _inUnderpassCorridor(x, z) {
    const prisms = this._underpassPrisms;
    if (prisms && prisms.length) {
      for (let i = 0; i < prisms.length; i++) {
        const pr = prisms[i];
        const dx = x - pr.x;
        const dz = z - pr.z;
        const along = dx * pr.fx + dz * pr.fz;
        const lat = dx * pr.nx + dz * pr.nz;
        if (along >= -pr.back && along <= pr.fwd && Math.abs(lat) <= pr.halfLat) {
          return true;
        }
      }
    }
    const runs = this._underpassRuns;
    if (!runs || !runs.length) return false;
    const near = this._nearestRoad(x, z);
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      if (near.along >= run.dist0 && near.along <= run.dist1 && near.dist < run.lateral) {
        return true;
      }
    }
    return false;
  }

  /**
   * Desert — flatten land + suppress road skirts only under the finale rock
   * arch. Sweep berms are NOT an underpass; tagging them used to strip skirts
   * for a hundred metres and flash the underside of the ribbon.
   */
  _markDesertUnderpassCorridors() {
    this._underpassPrisms = [];

    const pin = this._findDesertFinaleBridge();
    if (!pin) return;
    const p = this.points[pin.i];
    const portal = this._desertBridgePortal(p);
    // Floor only the drive tube plus one land cell past the inner pier so the
    // heightmap fold hides inside the rock, not in the hole. Wider wash used
    // to erase the hill the arch is supposed to cut through.
    const lateral = Math.max(portal.clearHalfW + 20, p.width * 0.5 + 22);
    const dist0 = pin.dist - (portal.clearHalfD + 10);
    const dist1 = pin.dist + (portal.clearHalfD + 10);
    this._landmarkFlats.push({ dist0, dist1, lateral });
    this._underpassRuns.push({ dist0, dist1, lateral: lateral + 28 });
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    this._underpassPrisms.push({
      x: p.x,
      z: p.z,
      y: p.y,
      fx,
      fz,
      nx: p.nx,
      nz: p.nz,
      back: portal.clearHalfD + 8,
      fwd: portal.clearHalfD + 8,
      halfLat: lateral,
      openH: portal.openH,
    });
    for (let i = 0; i < this.points.length; i++) {
      const pt = this.points[i];
      if (pt.dist >= dist0 && pt.dist <= dist1) pt.underpass = true;
    }
  }

  /**
   * Approach to the linked gravel hairpins — where the finale rock bridge sits.
   * Place the arch on the short sand→gravel approach straight so the road is
   * straight through the portal (not mid-hairpin).
   * @returns {{i:number, dist:number, width:number}|null}
   */
  _findDesertFinaleBridge() {
    for (let i = 0; i < this.points.length; i++) {
      if (!this.points[i].landmark) continue;
      if (this.points[i].surface !== "gravel") continue;
      // Walk back along the ribbon to the approach straight (sand→gravel).
      let j = Math.max(0, i - 8);
      while (j > 2 && this.points[j].surface === "gravel") j -= 1;
      // Prefer a sample still on the approach, a few posts before the hairpin.
      j = Math.max(2, Math.min(j, i - 6));
      const p = this.points[j];
      return { i: j, dist: p.dist, width: p.width };
    }
    return this._findLastLandmark();
  }

  /**
   * World-space clearance prism for the rock-bridge portal (must stay empty).
   * @param {object} p road sample at bridge centerline
   * @param {{halfW:number, halfD:number, openH:number}} clear
   */
  _registerBridgePortalPrism(p, clear) {
    if (!this._underpassPrisms) this._underpassPrisms = [];
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    this._underpassPrisms.push({
      x: p.x,
      z: p.z,
      y: p.y,
      fx,
      fz,
      nx: p.nx,
      nz: p.nz,
      back: clear.halfD + 8,
      fwd: clear.halfD + 8,
      halfLat: Math.max(clear.halfW + 20, p.width * 0.5 + 22),
      openH: clear.openH,
    });
  }

  /**
   * Desert finale — natural rock arch you drive under before the linked gravel
   * hairpins. Abutments hold the dunes back; the land wash stays a floor.
   */
  _addDesertHeroLandmark() {
    const pin = this._findDesertFinaleBridge();
    if (!pin) return;
    const p = this.points[pin.i];
    const rock = new THREE.MeshLambertMaterial({
      color: 0xb89a72,
      flatShading: true,
      side: THREE.FrontSide,
    });
    const rockDark = new THREE.MeshLambertMaterial({
      color: 0x7a6348,
      flatShading: true,
      side: THREE.FrontSide,
    });
    const rockLit = new THREE.MeshLambertMaterial({
      color: 0xcbb892,
      flatShading: true,
      side: THREE.FrontSide,
    });
    this._addDesertRockBridge(p, rock, rockDark, rockLit);
  }

  /**
   * Closed sandstone underpass: a hollow tube of boxes. Inner faces of the
   * piers and lintel ARE the tunnel. No heightmap hole, no one-sided shards
   * in the drive volume — those showed polygon backs and clipped the car.
   * @param {object} p road sample on the bridge centerline
   * @param {THREE.Material} rock
   * @param {THREE.Material} rockDark
   * @param {THREE.Material} [rockLit]
   */
  _addDesertRockBridge(p, rock, rockDark, rockLit = rock) {
    const g = new THREE.Group();
    const { half, openH, clearHalfW, clearHalfD } = this._desertBridgePortal(p);
    this._registerBridgePortalPrism(p, { halfW: clearHalfW, halfD: clearHalfD, openH });

    const box = new THREE.BoxGeometry(1, 1, 1);
    const wallT = 5.2;
    const depth = clearHalfD * 2;
    const lintelH = 4.0;

    /**
     * Closed box. Inner pier faces sit on the portal walls; nothing is allowed
     * inside |x|<clearHalfW && |z|<clearHalfD && 0<y<openH.
     * @param {number} sx
     * @param {number} sy
     * @param {number} sz
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {THREE.Material} mat
     * @param {boolean} [fade] outer hill only — inner lining must stay opaque
     */
    const addBlock = (sx, sy, sz, x, y, z, mat, fade = false) => {
      const x0 = x - sx * 0.5;
      const x1 = x + sx * 0.5;
      const y0 = y - sy * 0.5;
      const y1 = y + sy * 0.5;
      const z0 = z - sz * 0.5;
      const z1 = z + sz * 0.5;
      const overlapsPortalX = x0 < clearHalfW - 0.2 && x1 > -clearHalfW + 0.2;
      const overlapsPortalZ = z0 < clearHalfD - 0.2 && z1 > -clearHalfD + 0.2;
      const overlapsPortalY = y0 < openH - 0.2 && y1 > 0.05;
      if (overlapsPortalX && overlapsPortalZ && overlapsPortalY) return null;
      const m = new THREE.Mesh(box, mat);
      m.scale.set(sx, sy, sz);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData.cameraFade = !!fade;
      if (!fade && Math.abs(x) >= clearHalfW - 0.5 && y <= openH + 0.5) {
        m.userData.bridgeLining = true;
      }
      g.add(m);
      return m;
    };

    // Inner lining — closed boxes whose inner faces ARE the tunnel walls.
    for (const side of [-1, 1]) {
      const x = side * (clearHalfW + wallT * 0.5);
      addBlock(wallT, openH, depth, x, openH * 0.5, 0, rockLit);
      // Plinth slightly below deck so land/road edges cannot flash a backface.
      addBlock(wallT, 1.2, depth, x, -0.72, 0, rockDark);
      addBlock(14, openH + 12, depth + 10, side * (clearHalfW + wallT + 7), (openH + 12) * 0.48, 0, rockDark, true);
      addBlock(20, openH + 18, depth + 16, side * (clearHalfW + wallT + 20), (openH + 18) * 0.46, 0, rock, true);
    }

    // Lintel + hill mass over the road (bottom of lintel at y = openH).
    const span = clearHalfW * 2 + wallT * 2;
    addBlock(span, lintelH, depth, 0, openH + lintelH * 0.5, 0, rockLit);
    addBlock(span + 18, 12, depth + 8, 0, openH + lintelH + 6, 0, rock, true);
    addBlock(span + 10, 10, depth + 4, 0, openH + lintelH + 14, 0, rockDark, true);

    // Mouth frames flush with the portal so you cannot look into a hollow box.
    for (const zSign of [-1, 1]) {
      const mouthD = 8;
      const z = zSign * (clearHalfD + mouthD * 0.5);
      for (const side of [-1, 1]) {
        const mouthT = wallT + 6;
        addBlock(
          mouthT,
          openH + 2,
          mouthD,
          side * (clearHalfW + mouthT * 0.5),
          (openH + 2) * 0.5,
          z,
          rockDark
        );
        addBlock(18, 20, 16, side * (clearHalfW + 22), 9.6, zSign * (clearHalfD + 20), rock, true);
      }
      addBlock(span + 4, lintelH + 2, mouthD, 0, openH + (lintelH + 2) * 0.5, z, rock);
    }

    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.heading;
    g.userData.desertBridge = true;
    g.userData.portal = { openH, clearHalfW, clearHalfD };
    this._scrubBridgePortalMeshes(g, { openH, clearHalfW, clearHalfD });
    g.traverse((obj) => {
      if (obj.isMesh) obj.userData.desertBridge = true;
    });
    this._scrubBridgeDriveCorridor(g);
    this.group.add(g);

    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    // One planar slab per lining — inner face at ±clearHalfW, not three
    // spheres in the pier cores that bulged into the lane and left gaps.
    for (const side of [-1, 1]) {
      const wx = p.x + p.nx * side * clearHalfW;
      const wz = p.z + p.nz * side * clearHalfW;
      this._wallFace(wx, wz, -p.nx * side, -p.nz * side, fx, fz, clearHalfD + 8, wallT);
    }
  }

  /**
   * Drop any bridge mesh whose local AABB still invades the drive-through prism.
   * Conservative: world-AABB corners → local min/max, then AABB vs portal.
   * @param {THREE.Group} g
   * @param {{openH:number, clearHalfW:number, clearHalfD:number}} portal
   */
  _scrubBridgePortalMeshes(g, portal) {
    const { openH, clearHalfW, clearHalfD } = portal;
    const pad = 0.2;
    g.updateMatrixWorld(true);
    const doomed = [];
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
    const corner = new THREE.Vector3();
    for (let i = 0; i < g.children.length; i++) {
      const child = g.children[i];
      if (!child.isMesh) continue;
      child.updateWorldMatrix(true, false);
      const box = new THREE.Box3().setFromObject(child);
      let minX = Infinity;
      let minY = Infinity;
      let minZ = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let maxZ = -Infinity;
      for (let xi = 0; xi < 2; xi++) {
        for (let yi = 0; yi < 2; yi++) {
          for (let zi = 0; zi < 2; zi++) {
            corner.set(
              xi ? box.max.x : box.min.x,
              yi ? box.max.y : box.min.y,
              zi ? box.max.z : box.min.z
            );
            corner.applyMatrix4(inv);
            if (corner.x < minX) minX = corner.x;
            if (corner.y < minY) minY = corner.y;
            if (corner.z < minZ) minZ = corner.z;
            if (corner.x > maxX) maxX = corner.x;
            if (corner.y > maxY) maxY = corner.y;
            if (corner.z > maxZ) maxZ = corner.z;
          }
        }
      }
      const ox = minX < clearHalfW - pad && maxX > -clearHalfW + pad;
      const oz = minZ < clearHalfD - pad && maxZ > -clearHalfD + pad;
      const oy = minY < openH - pad && maxY > 0.12;
      if (ox && oz && oy) doomed.push(child);
    }
    for (let i = 0; i < doomed.length; i++) {
      g.remove(doomed[i]);
    }
  }

  /**
   * World-space corridor scrub for the finale rock bridge — local portal AABB
   * misses mouth blocks whose corners sit outside the prism but still span the
   * painted lane at ~2437 m on the sand→gravel approach.
   * @param {THREE.Group} g
   */
  _scrubBridgeDriveCorridor(g) {
    g.updateMatrixWorld(true);
    const doomed = [];
    g.traverse((child) => {
      if (!child.isMesh || !child.geometry) return;
      if (child.userData.bridgeLining) return;
      child.updateWorldMatrix(true, false);
      const box = new THREE.Box3().setFromObject(child);
      const cx = (box.min.x + box.max.x) * 0.5;
      const cz = (box.min.z + box.max.z) * 0.5;
      const r = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.5;
      const midY = (box.min.y + box.max.y) * 0.5;
      const halfH = (box.max.y - box.min.y) * 0.5;
      if (this._laneKeepout(cx, cz, r, midY, halfH)) doomed.push(child);
    });
    for (let i = 0; i < doomed.length; i++) {
      const m = doomed[i];
      if (m.parent) m.parent.remove(m);
      if (m.geometry) m.geometry.dispose();
    }
  }

  /**
   * Sprint 14 — one authored silhouette per stage so the horizon reads as place,
   * not procedural scatter. Mountain uses _addMountainCliff as its hero.
   * @param {object} def course definition
   * @param {() => number} rng
   */
  _addHeroLandmarks(def, rng) {
    const scenery = def.scenery || "forest";
    if (scenery === "desert") this._addDesertHeroLandmark();
    else if (scenery === "forest") this._addForestHeroLandmark();
    else if (scenery === "lakeside") this._addLakesideHeroLandmark();
  }

  /**
   * Sprint 20 / visual tier 7 — lightweight trackside verge accents so the racing
   * line sits in believable place detail (scrub, understory, scree, reeds).
   * Instanced only; reuses trees.js + cliffShardGeometry; never tags cameraFade.
   *
   * @param {object} def course definition
   * @param {() => number} rng
   */
  _addRealisticVergeDetail(def, rng) {
    const scenery = def.scenery || "forest";
    if (scenery === "desert") this._addDesertVergeDetail(rng);
    else if (scenery === "forest") this._addForestVergeDetail(rng);
    else if (scenery === "mountain") this._addMountainVergeDetail(rng);
    else if (scenery === "lakeside") this._addLakesideVergeDetail(rng);
  }

  /**
   * Heading delta over a short look-back — used to pick the outside of a bend.
   * @param {number} i spline index
   * @param {number} [look]
   * @returns {{outside:number, turn:number}}
   */
  _curveOutsideAt(i, look = 6) {
    const p = this.points[i];
    const prev = this.points[Math.max(0, i - look)];
    let dh = p.heading - prev.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    return { outside: dh > 0 ? -1 : 1, turn: Math.abs(dh) };
  }

  /**
   * Desert — sparse scrub clumps + small rock scatter on the outside of gentle
   * curves, always beyond the road trench / ribbon keep-out.
   * @param {() => number} rng
   */
  _addDesertVergeDetail(rng) {
    const scrub = [];
    const chips = [];
    const clumpShadows = [];
    const pts = this.points;
    // Gentle bend window: enough to read as a curve, not a hairpin wall.
    const GENTLE_LO = 0.07;
    const GENTLE_HI = 0.42;
    for (let i = 4; i < pts.length - 2; i += 4) {
      const p = pts[i];
      if (p.tunnel) continue;
      if (p.underpass) continue;
      if (this._inUnderpassCorridor(p.x, p.z)) continue;
      const { outside, turn } = this._curveOutsideAt(i, 7);
      if (turn < GENTLE_LO || turn > GENTLE_HI) continue;
      if (rng() > 0.48) continue;
      // Beyond desert trench bed so dunes/scrub never sit in the cut.
      const trenchOff = Math.max(this._trenchWidth(p.width), p.width * 0.5 + 16);
      const off = trenchOff + 1.5 + rng() * 12;
      if (!this._mayPlant(p.dist, outside, off, 1.4)) continue;
      const px = p.x + p.nx * outside * off + (rng() - 0.5) * 3.2;
      const pz = p.z + p.nz * outside * off + (rng() - 0.5) * 3.2;
      if (!this._ribbonClear(px, pz, 0.9)) continue;
      const near = this._nearestRoad(px, pz);
      if (near.tunnel || near.dist < trenchOff) continue;
      const gy = this._groundHeight(px, pz, "desert");
      const chunk = this._chunkOfDist(p.dist);
      const pick = rng();
      if (pick < 0.55) {
        const sh = 0.7 + rng() * 0.45;
        scrub.push({
          c: chunk,
          x: px,
          y: gy,
          z: pz,
          s: sh,
          ry: rng() * 6,
        });
        if (sh > 0.85 && rng() > 0.55) {
          clumpShadows.push({
            c: chunk,
            x: px,
            y: gy + 0.03,
            z: pz,
            sx: 1.4 + rng() * 0.6,
            sy: 1,
            sz: 1.1 + rng() * 0.5,
            ry: rng() * 6,
          });
        }
      } else {
        const s = 0.45 + rng() * 0.55;
        chips.push({
          c: chunk,
          x: px,
          y: gy,
          z: pz,
          s,
          rx: rng() * 0.4,
          ry: rng() * 6,
          rz: rng() * 0.4,
        });
      }
    }
    if (scrub.length) this._addHdNature("plant_bushDetailed", scrub, { castShadow: true });
    if (chips.length) this._addHdNature("rock_smallA", chips, { castShadow: false });
    if (clumpShadows.length) {
      this._addInstances(shadowGeometry(), shadowMaterial(), clumpShadows, { receiveShadow: false });
    }
  }

  /**
   * Forest — denser understory in the tree belt, plus a few fallen branch / stump accents.
   * @param {() => number} rng
   */
  _addForestVergeDetail(rng) {
    const ferns = [];
    const shrubs = [];
    const stumps = [];
    const stumpShadows = [];
    const pts = this.points;
    for (let i = 3; i < pts.length - 2; i += 3) {
      const p = pts[i];
      if (p.tunnel) continue;
      for (const side of [-1, 1]) {
        if (rng() > 0.78) continue;
        const off = p.width * 0.5 + 8.5 + rng() * 11;
        if (!this._mayPlant(p.dist, side, off, 1.6)) continue;
        const along = (rng() - 0.5) * 3.2;
        const fx = Math.sin(p.heading);
        const fz = Math.cos(p.heading);
        const px = p.x + p.nx * side * off + fx * along;
        const pz = p.z + p.nz * side * off + fz * along;
        if (!this._ribbonClear(px, pz, 1.0)) continue;
        const gy = this._forestGround(px, pz);
        const chunk = this._chunkOfDist(p.dist);
        const fh = 0.85 + rng() * 0.55;
        ferns.push({
          c: chunk,
          x: px,
          y: gy,
          z: pz,
          s: fh * (0.9 + rng() * 0.35),
          ry: rng() * 6,
        });
        if (rng() > 0.62) {
          const along = (rng() - 0.5) * 2.2;
          const fx = Math.sin(p.heading);
          const fz = Math.cos(p.heading);
          const sx = px + fx * along;
          const sz = pz + fz * along;
          if (!this._ribbonClear(sx, sz, 1.1)) continue;
          const shy = this._forestGround(sx, sz);
          const sh = 0.75 + rng() * 0.45;
          shrubs.push({
            c: chunk,
            x: sx,
            y: shy,
            z: sz,
            s: sh * (0.9 + rng() * 0.4),
            ry: rng() * 6,
          });
        }
      }
    }
    // Few stump / fallen-log accents — HD log GLB, sparse.
    const accentN = Math.min(14, Math.max(6, (pts.length / 90) | 0));
    for (let n = 0; n < accentN; n++) {
      const i = 8 + ((rng() * (pts.length - 16)) | 0);
      const p = pts[i];
      if (!p || p.tunnel) continue;
      const side = rng() > 0.5 ? 1 : -1;
      const off = p.width * 0.5 + 8 + rng() * 10;
      if (!this._mayPlant(p.dist, side, off, 1.2)) continue;
      const px = p.x + p.nx * side * off;
      const pz = p.z + p.nz * side * off;
      if (!this._ribbonClear(px, pz, 0.85)) continue;
      const gy = this._forestGround(px, pz);
      const chunk = this._chunkOfDist(p.dist);
      const s = 0.7 + rng() * 0.45;
      stumps.push({
        c: chunk,
        x: px,
        y: gy,
        z: pz,
        s,
        ry: rng() * 6,
        rz: (rng() - 0.5) * 0.35,
      });
      stumpShadows.push({
        c: chunk,
        x: px,
        y: gy + 0.02,
        z: pz,
        sx: s * 1.4,
        sy: 1,
        sz: s * 0.9,
        ry: rng() * 6,
      });
    }
    if (ferns.length) this._addHdNature("plant_bushFern", ferns, { castShadow: true });
    if (shrubs.length) this._addHdNature("plant_bushDense", shrubs, { castShadow: true });
    if (stumps.length) this._addHdNature("log_large", stumps, { castShadow: true });
    if (stumpShadows.length) {
      this._addInstances(shadowGeometry(), shadowMaterial(), stumpShadows, { receiveShadow: false });
    }
  }

  /**
   * Mountain — fine scree / rock chips on downhill outsides, clear of the road
   * and away from the authored cliff face.
   * @param {() => number} rng
   */
  _addMountainVergeDetail(rng) {
    const chips = [];
    const shard = cliffShardGeometry();
    const rockMat = worldPropMaterial(0x7a6e58, 0.94);
    const rockDark = worldPropMaterial(0x5a5248, 0.95);
    const pts = this.points;
    const pin = this._landmark || this._findHairpin();
    for (let i = 6; i < pts.length - 4; i += 3) {
      const p = pts[i];
      if (p.tunnel) continue;
      const prev = pts[Math.max(0, i - 3)];
      // Downhill only — chips read as shed scree, not ridge clutter.
      if (p.y >= prev.y - 0.05) continue;
      const { outside, turn } = this._curveOutsideAt(i, 6);
      if (turn < 0.035) continue;
      if (rng() > 0.55) continue;
      // Keep chips off the cliff-facing inside near the hairpin landmark.
      if (pin && Math.abs(p.dist - pin.dist) < 90 && outside === pin.inside) continue;
      const off = p.width * 0.5 + 8.5 + rng() * 10;
      if (!this._mayPlant(p.dist, outside, off, 0.9)) continue;
      const px = p.x + p.nx * outside * off + (rng() - 0.5) * 2.5;
      const pz = p.z + p.nz * outside * off + (rng() - 0.5) * 2.5;
      if (!this._ribbonClear(px, pz, 1.4)) continue;
      const gy = this._groundHeight(px, pz, "mountain");
      const chunk = this._chunkOfDist(p.dist);
      const s = 0.22 + rng() * 0.38;
      chips.push({
        c: chunk,
        x: px,
        y: gy + s * 0.2,
        z: pz,
        s,
        rx: rng(),
        ry: rng() * 6,
        rz: rng() * 0.8,
        r: rng() > 0.5 ? 1 : 0.82,
        g: rng() > 0.5 ? 1 : 0.86,
        b: rng() > 0.5 ? 1 : 0.78,
      });
    }
    if (!chips.length) return;
    // Split light/dark bags so chips read as mixed scree without extra materials.
    const light = [];
    const dark = [];
    for (let i = 0; i < chips.length; i++) {
      if (i % 3 === 0) dark.push(chips[i]);
      else light.push(chips[i]);
    }
    if (light.length) this._addInstances(shard, rockMat, light, { castShadow: false });
    this._bumpPoses(light, 0.48);
    if (dark.length) this._addInstances(shard, rockDark, dark, { castShadow: false });
    this._bumpPoses(dark, 0.48);
  }

  /**
   * Lakeside — extra reed clumps and shore stones along authored water runs.
   * @param {() => number} rng
   */
  _addLakesideVergeDetail(rng) {
    const reeds = [];
    const stones = [];
    const reedShadows = [];
    const shard = cliffShardGeometry();
    const shoreMat = worldPropMaterial(0x6a7460, 0.92);
    const runs = this._lakes || [
      { from: 0.12, to: 0.5, side: 1 },
      { from: 0.58, to: 0.86, side: -1 },
    ];
    const pts = this.points;
    for (const run of runs) {
      const start = (pts.length * run.from) | 0;
      const end = (pts.length * run.to) | 0;
      if (end - start < 4) continue;
      for (let i = start; i <= end; i += 4) {
        const p = pts[i];
        if (p.tunnel) continue;
        if (rng() > 0.68) continue;
        // Inner shore — just outside the ribbon, same bank the lake mesh uses.
        const off = p.width * 0.5 + 3.6 + rng() * 4.5;
        if (!this._mayPlant(p.dist, run.side, off, 1.3)) continue;
        const px = p.x + p.nx * run.side * off + (rng() - 0.5) * 2;
        const pz = p.z + p.nz * run.side * off + (rng() - 0.5) * 2;
        if (!this._ribbonClear(px, pz, 0.65)) continue;
        const gy = this._groundHeight(px, pz, "lakeside");
        if (gy < p.y - 1.1) continue;
        const chunk = this._chunkOfDist(p.dist);
        if (rng() > 0.42) {
          const fh = 0.95 + rng() * 0.55;
          reeds.push({
            c: chunk,
            x: px,
            y: gy + fh * 0.42,
            z: pz,
            sx: 0.95 + rng() * 0.45,
            sy: fh,
            sz: 0.95 + rng() * 0.45,
            ry: rng() * 6,
          });
          if (fh > 1.2 && rng() > 0.6) {
            reedShadows.push({
              c: chunk,
              x: px,
              y: gy + 0.02,
              z: pz,
              sx: 1.2,
              sy: 1,
              sz: 0.9,
              ry: rng() * 6,
            });
          }
        } else {
          const s = 0.32 + rng() * 0.4;
          stones.push({
            c: chunk,
            x: px,
            y: gy + s * 0.22,
            z: pz,
            s,
            rx: rng(),
            ry: rng() * 6,
            rz: rng() * 0.5,
          });
        }
      }
    }
    if (reeds.length) {
      for (let i = 0; i < reeds.length; i++) {
        const r = reeds[i];
        if (r.sy != null) {
          r.s = (r.sy || 1) * 0.85;
          r.y = (r.y || 0) - (r.sy || 1) * 0.35;
          delete r.sx;
          delete r.sy;
          delete r.sz;
        }
      }
      this._addHdNature("plant_bushFern", reeds, { castShadow: true });
    }
    if (stones.length) this._addHdNature("rock_smallA", stones, { castShadow: false });
    this._bumpPoses(stones, 0.5);
    if (reedShadows.length) {
      this._addInstances(shadowGeometry(), shadowMaterial(), reedShadows, { receiveShadow: false });
    }
  }

  /**
   * Real tumbleweed meshes on Desert — dry twig balls sitting off the ribbon
   * that occasionally roll with the wind instead of a sprite or a stuck prop.
   * @param {() => number} rng
   */
  _addDesertTumbleweeds(rng) {
    const geo = tumbleweedGeometry();
    if (!geo) return;
    const mat = tumbleweedMaterial();
    const items = [];
    const samples = [];
    for (let i = 6; i < this.points.length - 4; i += 5) {
      const p = this.points[i];
      if (p.tunnel || p.underpass || p.jump || p.jumpWash) continue;
      samples.push(p);
    }
    if (!samples.length) return;
    const want = Math.min(16, Math.max(8, (samples.length / 7) | 0));
    for (let n = 0; n < want * 3 && items.length < want; n++) {
      const p = samples[(rng() * samples.length) | 0];
      const side = rng() > 0.5 ? 1 : -1;
      const off = p.width * 0.5 + 14 + rng() * 16;
      const along = (rng() - 0.5) * 10;
      const fx = Math.sin(p.heading);
      const fz = Math.cos(p.heading);
      const x = p.x + p.nx * side * off + fx * along;
      const z = p.z + p.nz * side * off + fz * along;
      if (!this._ribbonClear(x, z, 2.4)) continue;
      if (this._inUnderpassCorridor(x, z)) continue;
      const gy = this._groundHeight(x, z, "desert");
      const s = 0.72 + rng() * 0.48;
      const radius = 0.52 * s;
      items.push({
        x,
        y: gy + radius * 0.92,
        z,
        s,
        radius,
        heading: rng() * Math.PI * 2,
        roll: rng() * Math.PI * 2,
        speed: 0,
        tumbling: false,
        cooldown: 2.5 + rng() * 10,
        life: 0,
        windH: rng() * Math.PI * 2,
      });
    }
    if (!items.length) return;
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.userData.envProp = true;
    const dummy = this._tumbleDummy || (this._tumbleDummy = new THREE.Object3D());
    const tint = new THREE.Color();
    for (let i = 0; i < items.length; i++) {
      const w = items[i];
      dummy.position.set(w.x, w.y, w.z);
      dummy.rotation.set(w.roll * 0.35, w.heading, w.roll * 0.2);
      dummy.scale.setScalar(w.s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const shade = 0.82 + ((i * 17) % 9) * 0.02;
      tint.setRGB(0.62 * shade, 0.48 * shade, 0.28 * shade);
      mesh.setColorAt(i, tint);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.group.add(mesh);
    const windH = rng() * Math.PI * 2;
    this._tumbleweeds = {
      mesh,
      items,
      windX: Math.sin(windH),
      windZ: Math.cos(windH),
    };
  }

  /**
   * Sit still most of the time; at most two weeds roll past the car at once.
   * @param {THREE.Vector3} player
   */
  _tickTumbleweeds(player) {
    const pack = this._tumbleweeds;
    if (!pack || !pack.items || !pack.mesh) return;
    const now = performance.now() * 0.001;
    const dt = Math.min(0.05, Math.max(0, now - (this._tumbleWeedTime || now)));
    this._tumbleWeedTime = now;
    if (dt <= 0) return;
    const dummy = this._tumbleDummy || (this._tumbleDummy = new THREE.Object3D());
    const axis = _TUMBLE_AXIS;
    let tumbling = 0;
    for (let i = 0; i < pack.items.length; i++) {
      if (pack.items[i].tumbling) tumbling += 1;
    }
    for (let i = 0; i < pack.items.length; i++) {
      const w = pack.items[i];
      if (!w.tumbling) {
        w.cooldown -= dt;
        if (player && tumbling < 2 && w.cooldown <= 0) {
          const dist = Math.hypot(w.x - player.x, w.z - player.z);
          // Close enough to read as a pass-by, not a distant spin.
          if (dist > 14 && dist < 92 && Math.random() < dt * 0.08) {
            w.tumbling = true;
            w.life = 3.6 + Math.random() * 3.4;
            w.speed = 5.2 + Math.random() * 3.6;
            w.windH = Math.atan2(pack.windX, pack.windZ) + (Math.random() - 0.5) * 0.7;
            tumbling += 1;
          }
        }
      } else {
        w.life -= dt;
        const nx = w.x + Math.sin(w.windH) * w.speed * dt;
        const nz = w.z + Math.cos(w.windH) * w.speed * dt;
        const road = this._nearestRoad(nx, nz);
        const keep = (road.roadW || 14) * 0.5 + 3.4;
        if (road.tunnel || road.dist < keep || w.life <= 0) {
          w.tumbling = false;
          w.speed = 0;
          w.cooldown = 7 + Math.random() * 14;
        } else {
          w.x = nx;
          w.z = nz;
          w.roll += (w.speed / Math.max(0.28, w.radius)) * dt;
          const gy = this._groundHeight(w.x, w.z, "desert");
          w.y = gy + w.radius * 0.92;
        }
      }
      dummy.position.set(w.x, w.y, w.z);
      axis.set(Math.cos(w.windH), 0, -Math.sin(w.windH));
      dummy.quaternion.setFromAxisAngle(axis, w.roll);
      dummy.scale.setScalar(w.s);
      dummy.updateMatrix();
      pack.mesh.setMatrixAt(i, dummy.matrix);
    }
    pack.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Outside lean berms on Desert drift hairpins — Bowl and linked gravel pair.
   */
  _addDesertDriftLandmarks() {
    const rock = new THREE.MeshLambertMaterial({ color: 0x9a8468, flatShading: true });
    const rockDark = new THREE.MeshLambertMaterial({ color: 0x6a5a48, flatShading: true });
    const berms = [];
    const shards = [];
    const box = new THREE.BoxGeometry(1, 1, 1);
    const shardGeo = cliffShardGeometry();
    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      if (!p.landmark) continue;
      const prev = this.points[Math.max(0, i - 6)];
      let dh = p.heading - prev.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      const outside = dh > 0 ? -1 : 1;
      const chunk = this._chunkOfDist(p.dist);
      for (let k = -8; k <= 8; k += 2) {
        const j = Math.max(0, Math.min(this.points.length - 1, i + k));
        const q = this.points[j];
        const off = q.width * 0.5 + ROAD_VERGE + 5.8 + Math.abs(k) * 0.14;
        const bx = q.x + q.nx * outside * off;
        const bz = q.z + q.nz * outside * off;
        const span = 3.8 + Math.abs(k) * 0.12;
        if (!this._driveClear(bx, bz, Math.max(3.2, span * 0.55))) continue;
        const gy = this._groundHeight(bx, bz, "desert");
        berms.push({
          c: chunk,
          x: bx,
          y: gy + 0.55,
          z: bz,
          sx: span,
          sy: 1.05,
          sz: 2.8,
          ry: q.heading + outside * 0.16,
        });
        if (k % 4 === 0) {
          shards.push({
            c: chunk,
            x: bx + q.nx * outside * 1.8,
            y: gy + 0.9,
            z: bz + q.nz * outside * 1.8,
            s: 1.1 + Math.abs(k) * 0.06,
            rx: k * 0.12,
            ry: q.heading,
            rz: outside * 0.2,
          });
        }
      }
    }
    const bermsKept = this._stripLanePoses(berms);
    const shardsKept = this._stripLanePoses(shards);
    for (let i = 0; i < bermsKept.length; i++) {
      const b = bermsKept[i];
      this._bump(b.x, b.z, Math.max((b.sx || 3.8) * 0.62, 2.0));
    }
    for (let i = 0; i < shardsKept.length; i++) {
      const s = shardsKept[i];
      this._bump(s.x, s.z, 0.85);
    }
    if (bermsKept.length) {
      this._addInstances(box, rock, bermsKept, { castShadow: true, cameraFade: true });
    }
    if (shardsKept.length) {
      this._addInstances(shardGeo, rockDark, shardsKept, { castShadow: true, cameraFade: true });
    }
  }

  /**
   * Forest glade — three tall cedars framing the first landmark hairpin outside.
   */
  _addForestHeroLandmark() {
    const pin = this._landmark || this._findFirstLandmark();
    if (!pin) return;
    const p = this.points[pin.i];
    const outside = -pin.inside;
    const chunk = this._chunkOfDist(p.dist);
    const trunks = [];
    const heroShadows = [];
    for (let i = 0; i < 3; i++) {
      const angle = (i - 1) * 0.44;
      const off = p.width * 0.5 + 24 + i * 3.2;
      const fx = Math.sin(p.heading + angle);
      const fz = Math.cos(p.heading + angle);
      const x = p.x + p.nx * outside * off + fx * 5.5;
      const z = p.z + p.nz * outside * off + fz * 5.5;
      const gy = this._groundHeight(x, z, "forest");
      const h = 17 + i * 2.8;
      trunks.push({
        c: chunk,
        x,
        y: gy,
        z,
        s: h / 8.2,
        ry: p.heading + angle * 0.2,
      });
      this._pushContactShadow(heroShadows, x, gy, z, chunk, 3.8 + i * 0.4);
    }
    if (trunks.length) {
      const heroKind = propForestTreeParts("forest_tree_d")
        ? "forest_tree_d"
        : propForestTreeParts("forest_tree_a")
          ? "forest_tree_a"
          : "tree_fir";
      for (const t of trunks) t.s = (t.s || 1) * (heroKind.startsWith("forest_") ? 8.2 / 11.5 : 1);
      this._addHdNature(heroKind, trunks, { castShadow: true });
      if (heroShadows.length) {
        this._addInstances(shadowGeometry(), shadowMaterial(), heroShadows, { receiveShadow: false });
      }
    }
  }

  /**
   * Lakeside — wooden pier and boathouse on the far bank of the first lake run.
   */
  _addLakesideHeroLandmark() {
    const runs = this._lakes;
    if (!runs || !runs.length) return;
    const run = runs[0];
    const pts = this.points;
    const mid = ((pts.length * run.from + pts.length * run.to) / 2) | 0;
    const p = pts[mid];
    if (!p) return;
    const chunk = this._chunkOfDist(p.dist);
    const outer = p.width * 0.5 + 92;
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    const wood = worldPropMaterial({ color: 0x5a4030, roughness: 0.88 });
    const roof = worldPropMaterial({ color: 0x3a3028, roughness: 0.92 });
    const box = new THREE.BoxGeometry(1, 1, 1);
    const posts = [];
    const planks = [];
    const px = p.x + p.nx * run.side * outer;
    const pz = p.z + p.nz * run.side * outer;
    const gy = this._groundHeight(px, pz, "lakeside");
    for (let i = 0; i < 8; i++) {
      const along = (i - 3.5) * 2.6;
      posts.push({
        c: chunk,
        x: px + fx * along,
        y: gy + 1.05,
        z: pz + fz * along,
        sx: 0.38,
        sy: 2.1,
        sz: 0.38,
        ry: p.heading,
      });
    }
    for (let i = 0; i < 7; i++) {
      const along = (i - 3) * 2.6;
      planks.push({
        c: chunk,
        x: px + fx * along,
        y: gy + 2.05,
        z: pz + fz * along,
        sx: 2.5,
        sy: 0.16,
        sz: 1.35,
        ry: p.heading,
      });
    }
    const houseX = px + fx * 11;
    const houseZ = pz + fz * 11;
    planks.push({
      c: chunk,
      x: houseX,
      y: gy + 2.6,
      z: houseZ,
      sx: 5.8,
      sy: 3.4,
      sz: 4.6,
      ry: p.heading + 0.25,
    });
    if (posts.length) this._addInstances(box, wood, posts, { castShadow: true });
    if (planks.length) {
      this._addInstances(box, wood, planks.slice(0, 7), { castShadow: true });
      this._addInstances(box, roof, planks.slice(7), { castShadow: true });
    }
    const heroShadows = [];
    this._pushContactShadow(heroShadows, px, gy, pz, chunk, 5.5);
    this._pushContactShadow(heroShadows, houseX, gy, houseZ, chunk, 4.8);
    if (heroShadows.length) {
      this._addInstances(shadowGeometry(), shadowMaterial(), heroShadows, { receiveShadow: false });
    }
  }

  /**
   * Rock berms on the outside of Mountain gravel hairpins — lean surface for
   * the Sprint 6 Bowl / linked pair (Desert pattern, Corsica rock skin).
   */
  _addMountainDriftLandmarks() {
    const rock = new THREE.MeshLambertMaterial({ color: 0x7a6e58, flatShading: true });
    const rockDark = new THREE.MeshLambertMaterial({ color: 0x5a5248, flatShading: true });
    const berms = [];
    const shards = [];
    const box = new THREE.BoxGeometry(1, 1, 1);
    const shardGeo = cliffShardGeometry();
    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      if (!p.landmark) continue;
      if (p.surface !== "gravel") continue;
      const prev = this.points[Math.max(0, i - 6)];
      let dh = p.heading - prev.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      const outside = dh > 0 ? -1 : 1;
      const chunk = this._chunkOfDist(p.dist);
      for (let k = -8; k <= 8; k += 2) {
        const j = Math.max(0, Math.min(this.points.length - 1, i + k));
        const q = this.points[j];
        const off = q.width * 0.5 + 14.5 + Math.abs(k) * 0.14;
        const bx = q.x + q.nx * outside * off;
        const bz = q.z + q.nz * outside * off;
        if (!this._driveClear(bx, bz, 3.8)) continue;
        const gy = this._groundHeight(bx, bz, "mountain");
        berms.push({
          c: chunk,
          x: bx,
          y: gy + 0.55,
          z: bz,
          sx: 2.8 + Math.abs(k) * 0.12,
          sy: 1.1 + (8 - Math.abs(k)) * 0.05,
          sz: 2.2,
          ry: q.heading + outside * 0.2,
        });
      }
      const sx = p.x + p.nx * outside * (p.width * 0.5 + 13.5);
      const sz = p.z + p.nz * outside * (p.width * 0.5 + 13.5);
      if (this._driveClear(sx, sz, 3.2)) {
        shards.push({
          c: chunk,
          x: sx,
          y: this._groundHeight(sx, sz, "mountain") + 0.4,
          z: sz,
          s: 2.2 + (i % 3) * 0.4,
          rx: i * 0.15,
          ry: i * 0.35,
          rz: outside * 0.25,
        });
      }
    }
    if (berms.length) this._addInstances(box, rock, berms, { castShadow: true });
    this._bumpPoses(berms, 0.48);
    if (shards.length) this._addInstances(shardGeo, rockDark, shards, { castShadow: true });
    this._bumpPoses(shards, 0.5);
  }

  /**
   * Outside lean banks on Act 6 long gravel sweeps — gives the driver a wall to
   * trust through the committed slide (Forest + Mountain finales).
   * @param {"forest"|"mountain"} scenery
   */
  _addDriftSweepBerms(scenery) {
    const forest = scenery === "forest";
    const mat = new THREE.MeshLambertMaterial({
      color: forest ? 0x3a4828 : 0x7a6e58,
      flatShading: true,
    });
    const berms = [];
    const box = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      if (!p.sweep) continue;
      const prev = this.points[Math.max(0, i - 4)];
      let dh = p.heading - prev.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      const outside = dh > 0 ? -1 : 1;
      const chunk = this._chunkOfDist(p.dist);
      if (i % 3 !== 0) continue;
      const off = p.width * 0.5 + 11.5;
      const bx = p.x + p.nx * outside * off;
      const bz = p.z + p.nz * outside * off;
      if (!this._driveClear(bx, bz, forest ? 4.0 : 3.4)) continue;
      const gy = this._groundHeight(bx, bz, scenery);
      berms.push({
        c: chunk,
        x: bx,
        y: gy + (forest ? 0.65 : 0.5),
        z: bz,
        sx: forest ? 4.2 : 3.6,
        sy: forest ? 1.25 : 1.05,
        sz: forest ? 3.0 : 2.6,
        ry: p.heading + outside * 0.18,
      });
    }
    if (berms.length) this._addInstances(box, mat, berms, { castShadow: true });
    this._bumpPoses(berms, 0.5);
  }

  /**
   * Moss root banks and fallen logs on Forest drift hairpins — outside lean
   * surface for the Bowl and linked pair (Desert Act 5–7 pattern, Forest skin).
   */
  _addForestDriftLandmarks() {
    const earth = new THREE.MeshLambertMaterial({ color: 0x3a4828, flatShading: true });
    const root = new THREE.MeshLambertMaterial({ color: 0x4a3820, flatShading: true });
    const logs = [];
    const banks = [];
    const box = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      if (!p.landmark) continue;
      const prev = this.points[Math.max(0, i - 6)];
      let dh = p.heading - prev.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      const outside = dh > 0 ? -1 : 1;
      const chunk = this._chunkOfDist(p.dist);
      for (let k = -10; k <= 10; k += 2) {
        const j = Math.max(0, Math.min(this.points.length - 1, i + k));
        const q = this.points[j];
        const off = q.width * 0.5 + 14.8 + Math.abs(k) * 0.12;
        const bx = q.x + q.nx * outside * off;
        const bz = q.z + q.nz * outside * off;
        if (!this._driveClear(bx, bz, 3.8)) continue;
        const gy = this._groundHeight(bx, bz, "forest");
        banks.push({
          c: chunk,
          x: bx,
          y: gy + 0.75,
          z: bz,
          sx: 3.4 + Math.abs(k) * 0.15,
          sy: 1.35 + (10 - Math.abs(k)) * 0.06,
          sz: 2.6,
          ry: q.heading + outside * 0.25,
        });
      }
      const logOff = p.width * 0.5 + 15.5;
      const lx = p.x + p.nx * outside * logOff;
      const lz = p.z + p.nz * outside * logOff;
      if (!this._driveClear(lx, lz, 3.6)) continue;
      logs.push({
        c: chunk,
        x: lx,
        y: this._groundHeight(lx, lz, "forest") + 0.32,
        z: lz,
        sx: 4.4,
        sy: 0.52,
        sz: 0.52,
        ry: p.heading + Math.PI * 0.5,
      });
    }
    if (banks.length) this._addInstances(box, earth, banks, { castShadow: true });
    this._bumpPoses(banks, 0.5);
    if (logs.length) this._addInstances(box, root, logs, { castShadow: true });
    this._bumpPoses(logs, 0.55);
  }

  /**
   * True when a prop at (x,z) sits off the racing ribbon. Uses nearest-point
   * distance so hairpins do not fool spline-offset planting.
   * @param {number} x
   * @param {number} z
   * @param {number} [footprint] radius of the prop in metres
   */
  _ribbonClear(x, z, footprint = 0.6) {
    const road = this._nearestRoad(x, z);
    const over = road.minOver != null ? road.minOver : road.dist - road.roadW * 0.5;
    return over >= ROAD_VERGE + footprint;
  }

  /**
   * True when a solid of radius `r` would sit on (or through) painted asphalt
   * on any nearby ribbon arm. Overhead tunnel ribs are not a lane block.
   * @param {number} x
   * @param {number} z
   * @param {number} r
   * @param {number} [y]
   * @param {number} [halfH] vertical half-extent — tall props only skip keepout when the base clears the deck
   */
  _laneKeepout(x, z, r, y, halfH = 0) {
    const road = this._nearestRoad(x, z);
    const over = road.minOver != null ? road.minOver : road.dist - road.roadW * 0.5;
    // Strip visual instances that invade the collision-safe corridor.
    if (over - r >= ROAD_COLLIDER_CLEAR) return false;
    const bottom = y != null && halfH > 0 ? y - halfH : y;
    if (bottom != null && Number.isFinite(road.roadY) && bottom > road.roadY + ROAD_DECK + 2.5) {
      return false;
    }
    return true;
  }

  /**
   * Drop poses whose footprint overlaps the driven lane.
   * @param {Array<{x:number,z:number,y?:number,s?:number,sx?:number,sz?:number}>} poses
   * @returns {typeof poses}
   */
  _stripLanePoses(poses) {
    if (!poses || !poses.length) return poses || [];
    const kept = [];
    for (let i = 0; i < poses.length; i++) {
      const p = poses[i];
      if (!p) continue;
      const span = p.s != null ? p.s : Math.max(p.sx || 1, p.sz || 1, p.sy || 1, 0.7);
      const r = Math.max(0.65, span * 0.55);
      const halfH = p.sy != null ? Math.abs(p.sy) * 0.5 : span * 0.5;
      if (this._laneKeepout(p.x, p.z, r, p.y, halfH)) continue;
      kept.push(p);
    }
    return kept;
  }

  /**
   * True when a solid of this radius can sit at (x,z) without overlapping any
   * nearby ribbon — including a hairpin's opposite arm. Cardinal samples catch
   * meshes whose AABB is larger than a centre-only test.
   * @param {number} x
   * @param {number} z
   * @param {number} [footprint]
   */
  _driveClear(x, z, footprint = 0.6) {
    if (!this._ribbonClear(x, z, footprint)) return false;
    if (footprint > 0.55) {
      const d = footprint * 0.7;
      const inner = Math.max(0.35, footprint * 0.35);
      if (!this._ribbonClear(x + d, z, inner)) return false;
      if (!this._ribbonClear(x - d, z, inner)) return false;
      if (!this._ribbonClear(x, z + d, inner)) return false;
      if (!this._ribbonClear(x, z - d, inner)) return false;
    }
    return true;
  }

  /**
   * @param {number} dist along-track metres
   * @param {number} side -1 or 1
   * @param {number} off metres from centreline
   * @param {number} height metres
   * @returns {boolean}
   */
  _mayPlant(dist, side, off, height) {
    const zones = this._keepOut;
    if (!zones || !zones.length) return true;
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      if (dist < z.dist0 || dist > z.dist1) continue;
      if (z.side != null && side !== z.side) continue;
      if (off < z.minOff && height > (z.maxH ?? 2.2)) return false;
    }
    return true;
  }

  /**
   * Strongest tarmac hairpin in the opening climb — the authored cliff lives here.
   * @returns {{i:number, inside:number, dist:number, width:number}|null}
   */
  _findHairpin() {
    const pts = this.points;
    let bestI = -1;
    let bestTurn = 0;
    let bestDh = 0;
    for (let i = 12; i < pts.length - 12; i++) {
      const p = pts[i];
      if (p.dist < 70 || p.dist > 280) continue;
      if (p.surface !== "tarmac") continue;
      const a = pts[i - 8];
      const b = pts[i + 8];
      let dh = b.heading - a.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      const turn = Math.abs(dh);
      if (turn > bestTurn) {
        bestTurn = turn;
        bestI = i;
        bestDh = dh;
      }
    }
    if (bestI < 0 || bestTurn < 1.35) return null;
    // Inside of the turn: the face the driver looks at through the apex.
    const inside = bestDh > 0 ? 1 : -1;
    const p = pts[bestI];
    return { i: bestI, inside, dist: p.dist, width: p.width };
  }

  /**
   * Corsican rock cutting on the first hairpin — the stage's establishing
   * landmark (docs/AM3-RESEARCH.md §4: the rock face across from the hairpin).
   * A faceted wall that follows the inside verge, not a box in the sky.
   */
  _addMountainCliff() {
    const pin = this._landmark || this._findHairpin();
    if (!pin) return;
    const pts = this.points;
    const bestI = pin.i;
    const inside = pin.inside;
    const lo = Math.max(2, bestI - 22);
    const hi = Math.min(pts.length - 2, bestI + 20);
    const pos = [];
    const col = [];
    const idx = [];
    const color = new THREE.Color();
    const rows = 8;
    let n = 0;
    const vert = (x, y, z) => {
      pos.push(x, y, z);
      color.setRGB(0.56, 0.5, 0.44);
      col.push(color.r, color.g, color.b);
      n += 1;
      return n - 1;
    };
    const cols = [];
    const foot = 2.5;
    for (let i = lo; i <= hi; i++) {
      const p = pts[i];
      // Sit just past the inner verge. Offset 18.5 + thick ~6 m punched the
      // opposite carriageway of 15–18 m hairpins (Stage 3 clip-through).
      const off = p.width * 0.5 + ROAD_VERGE + 3.2;
      const thick = 3.2 + Math.sin(i * 0.55) * 0.55;
      const fx = p.x + p.nx * inside * off;
      const fz = p.z + p.nz * inside * off;
      const bx = fx + p.nx * inside * thick;
      const bz = fz + p.nz * inside * thick;
      const mx = (fx + bx) * 0.5;
      const mz = (fz + bz) * 0.5;
      if (!this._driveClear(fx, fz, foot)) continue;
      if (!this._driveClear(mx, mz, foot)) continue;
      if (!this._driveClear(bx, bz, foot)) continue;
      const gy = this._groundHeight(fx, fz, "mountain");
      const colIdx = [];
      for (let r = 0; r <= rows; r++) {
        const t = r / rows;
        const jagged = Math.sin(i * 0.9 + r * 1.3) * (1.4 + t * 3.2);
        const h = gy + t * (22 + Math.sin(i * 0.37) * 4.2) + jagged * 0.38;
        const pull = t * t * 1.8;
        colIdx.push(
          vert(
            fx + p.nx * inside * pull * 0.15,
            h,
            fz + p.nz * inside * pull * 0.15
          )
        );
      }
      const back = [];
      for (let r = 0; r <= rows; r++) {
        const t = r / rows;
        const h = gy + t * (24.8 + Math.sin(i * 0.31) * 3.8);
        back.push(vert(bx, h, bz));
      }
      cols.push({ front: colIdx, back, gy, fx, fz, bx, bz, mx, mz, p, i });
    }
    if (cols.length < 2) return;
    for (let c = 0; c < cols.length - 1; c++) {
      const a = cols[c];
      const b = cols[c + 1];
      for (let r = 0; r < rows; r++) {
        idx.push(a.front[r], a.front[r + 1], b.front[r]);
        idx.push(b.front[r], a.front[r + 1], b.front[r + 1]);
        idx.push(a.back[r], b.back[r], a.back[r + 1]);
        idx.push(b.back[r], b.back[r + 1], a.back[r + 1]);
      }
      idx.push(a.front[rows], a.back[rows], b.front[rows]);
      idx.push(b.front[rows], a.back[rows], b.back[rows]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    // Facet-owned vertices so wrap lighting can paint planes, not a smoothed slab.
    const faceted = geo.toNonIndexed();
    geo.dispose();
    faceted.computeVertexNormals();
    this._relightCliff(faceted);
    faceted.computeBoundingSphere();
    const mat = VISUAL.realisticArcade
      ? worldTerrainMaterial({ vertexColors: true, roughness: 0.92, envMapIntensity: 0.18 })
      : new THREE.MeshBasicMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(faceted, mat);
    mesh.userData.cameraFade = true;
    // Basic + baked wrap lighting: Lambert * the 18 m follow shadow map
    // paints this wall as a black silhouette whenever it leaves the frustum.
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    const mid = pts[bestI];
    this._registerChunk(mesh, this._chunkOfDist(mid.dist));
    this.group.add(mesh);

    // Solid face: sample bumps along the cutting so the car cannot drive through.
    for (let k = 0; k < cols.length; k++) {
      const c = cols[k];
      this._bump(c.fx, c.fz, 2.2);
      this._bump(c.mx, c.mz, 2.0);
    }

    const rockMat = new THREE.MeshLambertMaterial({ color: 0x6a6258, flatShading: true });
    const shard = cliffShardGeometry();
    const debris = [];
    const shrubs = [];
    const endK = cols.length - 1;
    for (let k = 0; k < cols.length; k += 2) {
      const c = cols[k];
      const chunk = this._chunkOfDist(c.p.dist);
      const dx = c.fx + (c.p.nx || 0) * inside * 1.1;
      const dz = c.fz;
      if (this._driveClear(dx, dz, 1.4)) {
        debris.push({
          c: chunk,
          x: dx,
          y: c.gy + 0.55,
          z: dz,
          s: 0.7 + (k % 5) * 0.18,
          rx: k * 0.4,
          ry: k * 0.7,
          rz: k * 0.2,
        });
      }
      if (k === 0 || k === endK || k === endK - (endK % 2)) {
        const sh = 0.85 + (k % 3) * 0.2;
        const sx = c.fx + c.p.nx * inside * 2.4;
        const sz = c.fz + c.p.nz * inside * 2.4;
        if (!this._driveClear(sx, sz, 1.6)) continue;
        shrubs.push({
          c: chunk,
          x: sx,
          y: c.gy,
          z: sz,
          s: sh,
          ry: k * 0.9,
        });
      }
    }
    this._addInstances(shard, rockMat, debris, { castShadow: true });
    this._bumpPoses(debris, 0.55);
    if (shrubs.length) this._addHdNature("plant_bushRound", shrubs, { castShadow: true });
  }

  /**
   * Bake sun and sky response into cliff vertex colours so Lambert still shows
   * planes in shadow. Does not raise the stage's global lights.
   * @param {THREE.BufferGeometry} geo
   */
  _relightCliff(geo) {
    const nrm = geo.getAttribute("normal");
    const col = geo.getAttribute("color");
    if (!nrm || !col) return;
    const L = LIGHTING.mountain || {};
    const dir = L.sunDir || [0.55, 0.72, 0.4];
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const ux = dir[0] / len;
    const uy = dir[1] / len;
    const uz = dir[2] / len;
    for (let i = 0; i < col.count; i++) {
      const nd = nrm.getX(i) * ux + nrm.getY(i) * uy + nrm.getZ(i) * uz;
      const sky = Math.max(0, nrm.getY(i));
      // Half-Lambert wrap: the road-facing wall is often the shady side of
      // the mountain sun, but planes must still separate.
      const wrap = Math.pow(Math.max(0, nd * 0.5 + 0.5), 1.35);
      const lit = 0.1 + wrap * 0.95 + sky * 0.08;
      const speck = ((i * 17) % 9) * 0.02;
      col.setXYZ(
        i,
        Math.min(0.86, 0.22 + lit * 0.55 + speck),
        Math.min(0.76, 0.18 + lit * 0.42),
        Math.min(0.64, 0.14 + lit * 0.32)
      );
    }
    col.needsUpdate = true;
  }

  /**
   * Cold northern water as a continuous basin beside the ribbon — not discs.
   * Inner edge tucks under the verge; outer edge sits in the lowered land.
   * Shore rocks and reeds sell the bank. No realtime reflections.
   */
  _addLake() {
    const waterMat = waterPbr();
    const pts = this.points;
    const runs = this._lakes || [
      { from: 0.12, to: 0.5, side: 1 },
      { from: 0.58, to: 0.86, side: -1 },
    ];
    const shoreMat = new THREE.MeshLambertMaterial({ color: 0x6a7460, flatShading: true });
    const boulder = cliffShardGeometry();
    const rocks = [];
    const reeds = [];

    for (const run of runs) {
      const start = (pts.length * run.from) | 0;
      const end = (pts.length * run.to) | 0;
      if (end - start < 4) continue;
      const pos = [];
      const col = [];
      const uv = [];
      const idx = [];
      const color = new THREE.Color();
      let n = 0;
      const vert = (x, y, z, deep) => {
        pos.push(x, y, z);
        color.setRGB(0.32 + deep * 0.05, 0.52 + deep * 0.08, 0.5 + deep * 0.18);
        col.push(color.r, color.g, color.b);
        uv.push(x * 0.028, z * 0.028);
        n += 1;
        return n - 1;
      };
      const ring = [];
      const span = Math.max(1, end - start);
      for (let i = start; i <= end; i++) {
        const p = pts[i];
        const t = (i - start) / span;
        const bend = Math.sin(t * Math.PI) * 32;
        const inner = p.width * 0.5 + 4.2;
        const outer = inner + 98 + bend;
        const ix = p.x + p.nx * run.side * inner;
        const iz = p.z + p.nz * run.side * inner;
        const ox = p.x + p.nx * run.side * outer;
        const oz = p.z + p.nz * run.side * outer;
        const y = p.y - 0.78;
        const a = vert(ix, y, iz, 0.08);
        const b = vert(ox, y - 0.72, oz, 0.82);
        ring.push({ a, b, p, ix, iz, ox, oz, i, t });
      }
      for (let k = 0; k < ring.length - 1; k++) {
        const u = ring[k];
        const v = ring[k + 1];
        if (run.side > 0) {
          idx.push(u.a, v.a, u.b);
          idx.push(v.a, v.b, u.b);
        } else {
          idx.push(u.a, u.b, v.a);
          idx.push(v.a, u.b, v.b);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, waterMat);
      mesh.name = "lake";
      mesh.receiveShadow = false;
      mesh.castShadow = false;
      if (!this._waterMeshes) this._waterMeshes = [];
      this._waterMeshes.push(mesh);
      const mid = pts[(start + end) >> 1];
      this._registerChunk(mesh, this._chunkOfDist(mid.dist));
      this.group.add(mesh);

      for (let k = 0; k < ring.length; k += 3) {
        const u = ring[k];
        const chunk = this._chunkOfDist(u.p.dist);
        const gy = this._groundHeight(u.ix, u.iz, "lakeside");
        rocks.push({
          c: chunk,
          x: u.ix,
          y: gy + 0.28,
          z: u.iz,
          s: 0.55 + (k % 5) * 0.12,
          rx: k * 0.3,
          ry: k * 0.5,
          rz: k * 0.2,
        });
        if (k % 6 === 0) {
          const fh = 1.05 + (k % 4) * 0.18;
          reeds.push({
            c: chunk,
            x: u.ix - u.p.nx * run.side * 1.2,
            y: gy,
            z: u.iz - u.p.nz * run.side * 1.2,
            s: fh * 0.9,
            ry: k * 0.8,
          });
        }
      }
    }
    this._addInstances(boulder, shoreMat, rocks, { castShadow: true });
    this._bumpPoses(rocks, 0.55);
    if (reeds.length) this._addHdNature("plant_bushFern", reeds, { castShadow: true });
    this._addLakeFarShore(runs);
  }

  /**
   * Autumn canopy on the far bank so the basin reads as water between two shores.
   * @param {Array<{from:number, to:number, side:number}>} runs
   */
  _addLakeFarShore(runs) {
    const pts = this.points;
    const AUTUMN = ["autumn", "autumnGold", "oak"];
    const treeBags = { autumn: [], autumnGold: [], oak: [] };
    for (const run of runs) {
      const start = (pts.length * run.from) | 0;
      const end = (pts.length * run.to) | 0;
      const span = Math.max(1, end - start);
      for (let i = start; i <= end; i += 5) {
        const p = pts[i];
        const t = (i - start) / span;
        const bend = Math.sin(t * Math.PI) * 32;
        const far = p.width * 0.5 + 98 + bend + 16 + Math.sin(i * 0.6) * 8;
        const fx = p.x + p.nx * run.side * far;
        const fz = p.z + p.nz * run.side * far;
        const gy = this._groundHeight(fx, fz, "lakeside");
        const chunk = this._chunkOfDist(p.dist);
        const kind = AUTUMN[i % AUTUMN.length];
        const tall = 5.5 + (i % 7) * 1.1;
        treeBags[kind].push({
          c: chunk,
          x: fx,
          y: gy,
          z: fz,
          s: tall / 8.2,
          ry: p.heading + i * 0.2,
        });
      }
    }
    for (const kind of AUTUMN) {
      const glb = this._hdTreeGlb(kind);
      if (glb) this._addHdNature(glb, treeBags[kind], { castShadow: true });
    }
  }

  /**
   * Index contiguous tunnel pieces so the land plane can raise a ridge before
   * the tube meshes exist.
   */
  _markTunnelRuns() {
    this._tunnels = [];
    const pts = this.points;
    let i = 0;
    while (i < pts.length) {
      if (!pts[i].tunnel) {
        i += 1;
        continue;
      }
      const start = i;
      while (i < pts.length && pts[i].tunnel) i += 1;
      this._tunnels.push({ startDist: pts[start].dist, endDist: pts[i - 1].dist });
    }
  }

  /**
   * 0..1 along-track envelope around every tunnel, including the approach so
   * the hill is visible before the mouth.
   * @param {number} along
   * @returns {number}
   */
  _tunnelAlong(along) {
    const runs = this._tunnels;
    if (!runs || !runs.length) return 0;
    const enter = 160;
    const exit = 95;
    let best = 0;
    for (let i = 0; i < runs.length; i++) {
      const a = runs[i].startDist;
      const b = runs[i].endDist;
      if (along < a - enter || along > b + exit) continue;
      let t = 1;
      if (along < a) t = smoothstep((along - (a - enter)) / enter);
      else if (along > b) t = smoothstep((b + exit - along) / exit);
      if (t > best) best = t;
    }
    return best;
  }

  /**
   * Nearest racing-line sample that belongs to a tunnel run (or its approach
   * envelope). Used so Desert land beside the mouth follows the tunnel deck,
   * not a lower arm that happens to be Euclidean-closer in XZ.
   * @param {number} x
   * @param {number} z
   * @returns {{along:number,dist:number,roadY:number,roadW:number,tunnel:boolean}|null}
   */
  _tunnelNeighbor(x, z) {
    const runs = this._tunnels;
    const pts = this.points;
    if (!runs || !runs.length || !pts || !pts.length) return null;
    let best = null;
    let bestD = 72 * 72;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const env = this._tunnelAlong(p.dist);
      if (env <= 0.08 && !p.tunnel) continue;
      const dx = x - p.x;
      const dz = z - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= bestD) continue;
      bestD = d2;
      const lat = Math.abs(dx * p.nx + dz * p.nz);
      best = {
        along: p.dist,
        dist: lat,
        roadY: p.y,
        roadW: p.width,
        tunnel: !!p.tunnel,
      };
    }
    return best;
  }

  /**
   * Ground Y for tunnel mouth / ridge props — always uses the bore neighbor,
   * not a folded Desert arm that would read flat sand under the portal.
   * @param {number} x
   * @param {number} z
   * @returns {number}
   */
  _tunnelTerrainY(x, z) {
    const drop = 1.15;
    const mouthY = this._tunnelMouthCutY(x, z, drop);
    if (mouthY != null) return mouthY;
    const tun = this._tunnelNeighbor(x, z);
    if (tun) {
      const clearance = tun.dist - tun.roadW * 0.5;
      if (tun.tunnel && tun.dist < tun.roadW * 0.5 + 14) return tun.roadY - drop;
      if (clearance > ROAD_VERGE + 2.4) {
        const cut = this._tunnelCutHeight(tun.along, tun.dist, tun.roadW, tun.roadY - drop);
        if (cut != null) return cut;
      }
      return tun.roadY - drop;
    }
    return this._groundHeight(x, z, "desert");
  }

  /**
   * Lowest terrain sample around a portal mouth for footing depth.
   * @param {{x:number,y:number,z:number,heading:number,width:number}} p
   * @param {number} outward
   * @returns {number}
   */
  _portalFootingY(p, outward) {
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    const half = p.width * 0.5;
    const clear = half + ROAD_VERGE + 1.6;
    let minY = Infinity;
    for (const side of [-1, 1]) {
      for (const along of [2, 8, 16, 26, 34]) {
        for (const lat of [clear + 4, clear + 12, clear + 22, clear + 30]) {
          const hx = p.x + p.nx * side * lat + fx * outward * along;
          const hz = p.z + p.nz * side * lat + fz * outward * along;
          const gy = this._tunnelTerrainY(hx, hz);
          if (gy < minY) minY = gy;
        }
      }
    }
    return Number.isFinite(minY) ? minY : p.y - 1.15;
  }

  /**
   * Land Y on the approach / exit apron in front of a tunnel mouth.
   * Lateral-only samples often sit on a folded Desert arm (minOver < 0);
   * the outward cone is where the hillside must meet the portal.
   * @param {number} x
   * @param {number} z
   * @param {number} drop
   * @returns {number|null}
   */
  _tunnelMouthCutY(x, z, drop) {
    const runs = this._tunnels;
    const pts = this.points;
    if (!runs || !runs.length || !pts || !pts.length) return null;
    let best = null;
    let bestD = 48 * 48;
    for (let r = 0; r < runs.length; r++) {
      const ends = [
        { target: runs[r].startDist, outward: -1 },
        { target: runs[r].endDist, outward: 1 },
      ];
      for (let e = 0; e < ends.length; e++) {
        const { target, outward } = ends[e];
        let p = null;
        let ad = 1e9;
        for (let i = 0; i < pts.length; i++) {
          const d = Math.abs(pts[i].dist - target);
          if (d < ad) {
            ad = d;
            p = pts[i];
          }
        }
        if (!p) continue;
        const dx = x - p.x;
        const dz = z - p.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= bestD) continue;
        const fx = Math.sin(p.heading);
        const fz = Math.cos(p.heading);
        const alongFwd = dx * fx + dz * fz;
        const outAlong = alongFwd * outward;
        // In front of the mouth (approach / exit), not back into the bore.
        if (outAlong < 2 || outAlong > 38) continue;
        const lat = Math.abs(dx * p.nx + dz * p.nz);
        // Real lateral clearance only — inventing ridgeDist from along used to
        // raise a full hill on the painted exit apron (lat≈0, outAlong>10).
        const cutTrench = Math.max(p.width * 0.5 + ROAD_VERGE + 4.5, 16);
        if (lat < cutTrench) continue;
        bestD = d2;
        best = { p, lat };
      }
    }
    if (!best) return null;
    const bed = best.p.y - drop;
    return this._tunnelCutHeight(best.p.dist, best.lat, best.p.width, bed);
  }

  /**
   * Extra metres of Desert ridge around a tunnel. Zero on the ribbon so the
   * land grid cannot interpolate a hill through the car.
   * @param {number} along
   * @param {number} dist metres from centreline
   * @param {number} roadW
   * @returns {number}
   */
  _tunnelHill(along, dist, roadW) {
    const env = this._tunnelAlong(along);
    if (env <= 0.02) return 0;
    // Zero through the drive verge so land tris cannot fold rock onto asphalt.
    const verge = roadW * 0.5 + ROAD_VERGE + 1.2;
    const peakAt = 26;
    const fallAt = 98;
    let lat = 0;
    if (dist <= verge) lat = 0;
    else if (dist < peakAt) lat = smoothstep((dist - verge) / Math.max(1, peakAt - verge));
    else if (dist < fallAt) lat = 1 - 0.1 * smoothstep((dist - peakAt) / (fallAt - peakAt));
    else lat = 0.9 * (1 - smoothstep((dist - fallAt) / 80));
    const jagged = 0.86 + 0.14 * Math.sin(along * 0.055 + dist * 0.04);
    // Embankment / escarpment height — tall enough to bury the portal, not a
    // skyscraper dune that reads as a prop on flat sand.
    return env * lat * 32 * jagged;
  }

  /**
   * True when this sample sits on the Desert tunnel cutting (outside the
   * drive trench, inside the ridge envelope). Land mesh must keep this rise.
   * @param {number} along
   * @param {number} dist
   * @param {number} roadW
   * @returns {boolean}
   */
  _inTunnelCut(along, dist, roadW) {
    if (this._tunnelAlong(along || 0) <= 0.08) return false;
    const cutTrench = Math.max((roadW || 10) * 0.5 + ROAD_VERGE + 4.5, 16);
    return dist > cutTrench;
  }

  /**
   * World-space tunnel cutting test — uses the bore neighbor, not Euclidean
   * nearest-road (which can be a lower Desert arm beside the mouth).
   * @param {number} x
   * @param {number} z
   * @returns {boolean}
   */
  _inTunnelCutAt(x, z) {
    if (this._tunnelMouthCutY(x, z, 1.15) != null) return true;
    const tun = this._tunnelNeighbor(x, z);
    return !!(tun && this._inTunnelCut(tun.along, tun.dist, tun.roadW));
  }

  /**
   * Land Y for a Desert tunnel cutting — road punches through a ridge.
   * Returns null when no ridge applies (caller uses wash / dunes).
   * @param {number} along
   * @param {number} dist
   * @param {number} roadW
   * @param {number} bed
   * @returns {number|null}
   */
  _tunnelCutHeight(along, dist, roadW, bed) {
    const hill = this._tunnelHill(along, dist, roadW);
    if (hill < 0.55) return null;
    const cutTrench = Math.max(roadW * 0.5 + ROAD_VERGE + 4.5, 16);
    if (dist <= cutTrench) return bed;
    // Steep face just outside the drive verge so the mouth reads as a cut,
    // then the authored ridge envelope (_tunnelHill lat falloff) takes over.
    const face = 11;
    if (dist < cutTrench + face) {
      const t = smoothstep((dist - cutTrench) / face);
      return bed + hill * (0.35 + 0.65 * t);
    }
    return bed + hill;
  }

  /**
   * Saturn-style rock tunnel: PBR stone, inverse-square sodium lamps, portals.
   * Cars glance off wall colliders instead of clipping through.
   */
  _addTunnel() {
    const pts = this.points;
    let i = 0;
    while (i < pts.length) {
      if (!pts[i].tunnel) {
        i += 1;
        continue;
      }
      const start = i;
      while (i < pts.length && pts[i].tunnel) i += 1;
      this._addTunnelRun(start, i - 1);
    }
  }

  /**
   * One contiguous tunnel segment along the racing line.
   * @param {number} start
   * @param {number} end
   */
  _addTunnelRun(start, end) {
    if (end <= start) return;
    const pts = this.points;
    const boreMap = tunnelBoreStriationMap();
    const rock = new THREE.MeshStandardMaterial({
      color: 0x9a8a6e,
      roughness: 0.9,
      metalness: 0.02,
      flatShading: true,
      side: THREE.FrontSide,
      map: boreMap || null,
    });
    const rockDark = new THREE.MeshStandardMaterial({
      color: 0x5a5040,
      roughness: 0.94,
      metalness: 0.01,
      flatShading: true,
      side: THREE.FrontSide,
      map: boreMap || null,
    });
    const rockSun = new THREE.MeshStandardMaterial({
      color: 0xc4ae84,
      roughness: 0.88,
      metalness: 0.02,
      side: THREE.FrontSide,
      map: boreMap || null,
    });
    const rockSunDark = new THREE.MeshStandardMaterial({
      color: 0x8a7358,
      roughness: 0.92,
      metalness: 0.01,
      side: THREE.FrontSide,
      map: boreMap || null,
    });
    const vault = new THREE.MeshStandardMaterial({
      color: 0x4a4034,
      roughness: 0.96,
      metalness: 0,
      flatShading: true,
    });
    // Basic so the bulbs stay lit even when the car is still outside the mouth.
    const lampMat = new THREE.MeshBasicMaterial({
      color: 0xfff0c0,
    });

    this._addTunnelPortal(pts[start], -1, rockSun, rockSunDark);
    this._addTunnelPortal(pts[end], 1, rockSun, rockSunDark);
    this._addTunnelMouthEmbankment(pts[start], -1, rockSun, rockSunDark);
    this._addTunnelMouthEmbankment(pts[end], 1, rockSun, rockSunDark);
    this._addTunnelMountain(start, end, rockSun, rockSunDark);

    const n = end - start + 1;
    const dummy = new THREE.Object3D();
    const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), rockDark, n * 2);
    const ceils = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), vault, n);
    walls.receiveShadow = true;
    ceils.receiveShadow = true;
    let w = 0;
    const ribs = [];
    const lamps = [];
    for (let i = start; i <= end; i += 1) {
      const p = pts[i];
      const q = pts[Math.min(i + 1, end)];
      const segLen = Math.max(3.6, Math.hypot(q.x - p.x, q.z - p.z) + 0.55);
      const wallH = 8.2;
      const wallT = 2.4;
      const half = p.width * 0.5;
      const fx = Math.sin(p.heading);
      const fz = Math.cos(p.heading);
      const inner = half + 0.25;
      for (const side of [-1, 1]) {
        dummy.position.set(
          p.x + p.nx * side * (half + wallT * 0.5 + 0.25),
          p.y + wallH * 0.5 - 0.2,
          p.z + p.nz * side * (half + wallT * 0.5 + 0.25)
        );
        dummy.rotation.set(0, p.heading, 0);
        dummy.scale.set(wallT, wallH, segLen);
        dummy.updateMatrix();
        walls.setMatrixAt(w, dummy.matrix);
        w += 1;
        this._wallFace(
          p.x + p.nx * side * inner,
          p.z + p.nz * side * inner,
          -p.nx * side,
          -p.nz * side,
          fx,
          fz,
          segLen * 0.5 + 0.4,
          wallT
        );
      }
      dummy.position.set(p.x, p.y + 7.6, p.z);
      dummy.rotation.set(0, p.heading, 0);
      dummy.scale.set(p.width + 4.8, 1.2, segLen);
      dummy.updateMatrix();
      ceils.setMatrixAt(i - start, dummy.matrix);

      if (i % 4 === 0) {
        ribs.push({ x: p.x, y: p.y + 7.2, z: p.z, sx: p.width + 4.4, sy: 0.55, sz: 0.7, ry: p.heading });
      }
      // Wall sconces down both sides, alternating, so the whole run is lit
      // rather than a single ceiling bulb at the car.
      if (i % 2 === 0) {
        const side = (Math.floor(i / 2) % 2 === 0 ? 1 : -1);
        const lx = p.x + p.nx * side * (half - 0.35);
        const ly = p.y + 3.55;
        const lz = p.z + p.nz * side * (half - 0.35);
        lamps.push({ x: lx, y: ly, z: lz, sx: 0.28, sy: 0.62, sz: 0.4, ry: p.heading });
        this._tunnelLamps.push({ x: lx, y: ly, z: lz });
      }
    }
    walls.instanceMatrix.needsUpdate = true;
    ceils.instanceMatrix.needsUpdate = true;
    walls.userData.cameraFade = true;
    ceils.userData.cameraFade = true;
    this.group.add(walls, ceils);
    this._addInstances(new THREE.BoxGeometry(1, 1, 1), rock, ribs, { cameraFade: true });
    // Sconces stay in the live scene (not streamed) so the bore is already
    // glowing when you look in from the desert, instead of popping on.
    if (lamps.length) {
      const bulbs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.28, 0.62, 0.4), lampMat, lamps.length);
      bulbs.castShadow = false;
      bulbs.receiveShadow = false;
      for (let k = 0; k < lamps.length; k++) {
        const L = lamps[k];
        dummy.position.set(L.x, L.y, L.z);
        dummy.rotation.set(0, L.ry, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        bulbs.setMatrixAt(k, dummy.matrix);
      }
      bulbs.instanceMatrix.needsUpdate = true;
      this.group.add(bulbs);
    }
  }

  /**
   * How fully the sun should be killed at this distance along the stage.
   * 0 = outdoor key light, 1 = lamps only.
   *
   * WHY LOOK-AHEAD: a boolean "are we inside" snaps the whole lighting rig at
   * the portal. Entrance starts dimming 18 m out so shaders never pop; exit
   * brings the sun back over the LAST 48 m so daylight is already on before
   * you leave the mouth.
   *
   * @param {number} dist metres along the racing line
   * @returns {number} 0..1
   */
  tunnelShade(dist) {
    const runs = this._tunnels;
    if (!runs || !runs.length) return 0;
    const ENTER = 18;
    const EXIT = 48;
    let shade = 0;
    for (let i = 0; i < runs.length; i++) {
      const a = runs[i].startDist;
      const b = runs[i].endDist;
      if (dist < a - ENTER || dist > b) continue;
      if (dist < a) {
        shade = Math.max(shade, (dist - (a - ENTER)) / ENTER);
      } else if (dist < b - EXIT) {
        shade = 1;
      } else {
        shade = Math.max(shade, Math.max(0, (b - dist) / EXIT));
      }
    }
    return shade < 0 ? 0 : shade > 1 ? 1 : shade;
  }

  /**
   * Evenly spaced wall-lamp positions for the fixed PointLight pool.
   * Always the same fixtures — never the nearest-to-car set — so the tunnel
   * is lit before you arrive and does not blink as you drive.
   * @param {number} n
   * @returns {Array<{x:number,y:number,z:number}>}
   */
  fixedTunnelLamps(n) {
    const lamps = this._tunnelLamps;
    const take = Math.max(0, n | 0);
    if (!lamps || !lamps.length || take <= 0) return [];
    if (lamps.length <= take) return lamps;
    if (this._fixedLampCache && this._fixedLampCount === take) return this._fixedLampCache;
    const out = [];
    const last = lamps.length - 1;
    for (let i = 0; i < take; i++) {
      const idx = take === 1 ? 0 : Math.round((i * last) / (take - 1));
      out.push(lamps[idx]);
    }
    this._fixedLampCount = take;
    this._fixedLampCache = out;
    return out;
  }

  /**
   * Nearest wall-lamp positions for the fixed PointLight pool.
   * @param {{x:number,y:number,z:number}} pos
   * @param {number} n
   * @returns {Array<{x:number,y:number,z:number}>}
   */
  nearestTunnelLamps(pos, n) {
    return this.fixedTunnelLamps(n);
  }

  /**
   * Rock cut at the mouth: an opening under the hill, not a free-standing gate.
   * Overburden sits ABOVE the 8 m clearance so the car never drives through a wall.
   * Embankment aprons bury into the land bed so the portal meets the ridge.
   * @param {object} p
   * @param {number} outward +Z local for exit, -Z for entrance
   * @param {THREE.Material} rock
   * @param {THREE.Material} rockDark
   */
  _addTunnelPortal(p, outward, rock, rockDark) {
    const g = new THREE.Group();
    const half = p.width * 0.5;
    const openH = 8.0;
    const postW = 2.4;
    const postD = 4.2;
    // Clear half-width of the drive tube — every prop sits outside this.
    const clear = half + ROAD_VERGE + 1.6;
    const footingY = this._portalFootingY(p, outward);
    const toeGap = Math.max(0, p.y - 1.15 - footingY);
    const bedExtra = Math.min(14, toeGap + 2.8);
    // Grounding slab under the shoulders only — buried fully below the deck.
    // A full-width slab with top above Y0 used to punch through the exit apron.
    for (const side of [-1, 1]) {
      const bed = new THREE.Mesh(new THREE.BoxGeometry(22, 6 + bedExtra, 28), rockDark);
      bed.position.set(side * (clear + 10), -3.4 - bedExtra * 0.5, outward * 8);
      bed.receiveShadow = false;
      g.add(bed);
    }
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(postW, openH + 2.4, postD), rockDark);
      post.position.set(side * (half + postW * 0.55 + 0.35), (openH + 2.4) * 0.5 - 1.4, 0);
      post.castShadow = true;
      post.receiveShadow = false;
      g.add(post);
      // Cut face — inner edge past the drive verge.
      const face = new THREE.Mesh(new THREE.BoxGeometry(12, 16, 18), rock);
      face.position.set(side * (clear + 7), 4.5, outward * 4);
      face.castShadow = true;
      face.receiveShadow = false;
      g.add(face);
      const wing = new THREE.Mesh(new THREE.BoxGeometry(16, 24, 22), rock);
      wing.position.set(side * (clear + 14), 8.5, outward * 7);
      wing.castShadow = true;
      wing.receiveShadow = false;
      g.add(wing);
      const buttress = new THREE.Mesh(new THREE.BoxGeometry(20, 28, 24), rockDark);
      buttress.position.set(side * (clear + 24), 9.5, outward * 10);
      buttress.receiveShadow = false;
      g.add(buttress);
      // Talus apron at the foot of the cut — still off the painted lane.
      const apron = new THREE.Mesh(new THREE.BoxGeometry(11, 7, 16), rockDark);
      apron.position.set(side * (clear + 6), 0.2, outward * 5);
      apron.receiveShadow = false;
      g.add(apron);
      // Approach embankment — ramps the hillside into the mouth.
      const ramp = new THREE.Mesh(new THREE.BoxGeometry(14, 9, 20), rock);
      ramp.position.set(side * (clear + 11), 2.4, outward * 16);
      ramp.receiveShadow = false;
      g.add(ramp);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(p.width + 5.2, 1.6, postD + 0.4), rock);
    lintel.position.set(0, openH + 0.55, 0);
    lintel.receiveShadow = false;
    g.add(lintel);
    // Sill buried under the deck — top stays below ROAD_DECK.
    const sill = new THREE.Mesh(new THREE.BoxGeometry(p.width + 4.5, 1.4, 5), rockDark);
    sill.position.set(0, -1.05, outward * 1.6);
    sill.receiveShadow = false;
    g.add(sill);
    // Overburden above the opening only — never a centre mound on the ribbon.
    const cap = new THREE.Mesh(new THREE.BoxGeometry(p.width + 36, 14, 24), rock);
    cap.position.set(0, 14.2, outward * 5);
    cap.receiveShadow = false;
    g.add(cap);
    const peak = new THREE.Mesh(new THREE.BoxGeometry(p.width + 22, 10, 16), rockDark);
    peak.position.set(0, 23, outward * 7);
    peak.receiveShadow = false;
    g.add(peak);
    const rubbleGeo = new THREE.BoxGeometry(1, 1, 1);
    const scatter = [
      [clear + 8, 2.8, outward * 5, 4.2, 3.2, 4.0],
      [-(clear + 9), 3.0, outward * 6, 4.4, 3.4, 4.2],
      [clear + 13, 2.2, outward * 12, 4.0, 2.6, 3.8],
      [-(clear + 14), 2.0, outward * 13, 4.2, 2.4, 4.0],
      [clear + 16, 3.6, outward * 18, 4.8, 3.0, 4.6],
      [-(clear + 17), 3.4, outward * 19, 5.0, 2.8, 4.8],
    ];
    for (let i = 0; i < scatter.length; i++) {
      const s = scatter[i];
      const chunk = new THREE.Mesh(rubbleGeo, i % 2 ? rockDark : rock);
      chunk.position.set(s[0], s[1], s[2]);
      chunk.scale.set(s[3], s[4], s[5]);
      chunk.rotation.set(0, i * 0.35, 0);
      chunk.receiveShadow = false;
      g.add(chunk);
    }
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.heading;
    g.userData.tunnelPortal = true;
    g.traverse((obj) => {
      if (obj.isMesh) {
        obj.userData.cameraFade = true;
        obj.userData.tunnelPortal = true;
      }
    });
    this._scrubTunnelPortalDrive(g, p);
    this._scrubPortalEmbankmentCorridor(g);
    this.group.add(g);
  }

  /**
   * Drop any portal child whose AABB still overlaps the drive tube.
   * Posts and the overhead lintel/cap stay; mid-lane rock must not.
   * @param {THREE.Group} g
   * @param {{width:number}} p
   */
  _scrubTunnelPortalDrive(g, p) {
    const clearHalf = p.width * 0.5 + 0.35;
    const openH = 8.0;
    const doomed = [];
    g.updateMatrixWorld(true);
    g.traverse((obj) => {
      if (!obj.isMesh || !obj.geometry) return;
      if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
      const box = obj.geometry.boundingBox.clone();
      box.applyMatrix4(obj.matrixWorld);
      // Local to the portal frame (g.matrixWorld inverse).
      const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
      const local = box.clone().applyMatrix4(inv);
      const cx = (local.min.x + local.max.x) * 0.5;
      const cy = (local.min.y + local.max.y) * 0.5;
      const halfW = (local.max.x - local.min.x) * 0.5;
      const top = local.max.y;
      // Overhead rock above the clearance height is fine.
      if (cy > openH - 0.4 || local.min.y > openH - 0.2) return;
      // Overlaps the painted drive tube in X (lateral).
      if (Math.abs(cx) - halfW < clearHalf && top > -0.35) {
        doomed.push(obj);
      }
    });
    for (let i = 0; i < doomed.length; i++) {
      const obj = doomed[i];
      if (obj.parent) obj.parent.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
    }
  }

  /**
   * World-space corridor scrub for tunnel portal wings — local AABB misses
   * embankment blocks that still span the exit apron on the mud approach.
   * @param {THREE.Group} g
   */
  _scrubPortalEmbankmentCorridor(g) {
    g.updateMatrixWorld(true);
    const doomed = [];
    g.traverse((child) => {
      if (!child.isMesh || !child.geometry) return;
      child.updateWorldMatrix(true, false);
      const box = new THREE.Box3().setFromObject(child);
      const cx = (box.min.x + box.max.x) * 0.5;
      const cz = (box.min.z + box.max.z) * 0.5;
      const r = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.5;
      const midY = (box.min.y + box.max.y) * 0.5;
      const halfH = (box.max.y - box.min.y) * 0.5;
      if (this._laneKeepout(cx, cz, r, midY, halfH)) doomed.push(child);
    });
    for (let i = 0; i < doomed.length; i++) {
      const obj = doomed[i];
      if (obj.parent) obj.parent.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
    }
  }

  /**
   * Terrain-following fill from the hillside up to the portal wings so the
   * mouth reads as a cut through rock, not a tube on flat sand.
   * @param {{x:number,y:number,z:number,heading:number,width:number,dist:number,nx:number,nz:number}} p
   * @param {number} outward
   * @param {THREE.Material} rock
   * @param {THREE.Material} rockDark
   */
  _addTunnelMouthEmbankment(p, outward, rock, rockDark) {
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    const half = p.width * 0.5;
    const clear = half + ROAD_VERGE + 1.6;
    const chunk = this._chunkOfDist(p.dist);
    const masses = [];
    const shards = [];
    for (const side of [-1, 1]) {
      for (let along = 0; along <= 36; along += 4) {
        for (let lat = clear + 2; lat <= clear + 34; lat += 5) {
          const hx = p.x + p.nx * side * lat + fx * outward * along;
          const hz = p.z + p.nz * side * lat + fz * outward * along;
          if (!this._ribbonClear(hx, hz, 3.0)) continue;
          const gy = this._tunnelTerrainY(hx, hz);
          const target = p.y + 2.4;
          const h = target - gy;
          if (h < 2.8) continue;
          masses.push({
            c: chunk,
            x: hx,
            y: gy + h * 0.46,
            z: hz,
            sx: 6.5 + lat * 0.05 + along * 0.04,
            sy: h,
            sz: 5.5 + along * 0.14,
            ry: p.heading + side * 0.07,
          });
          if (along % 8 === 0 && lat <= clear + 20) {
            shards.push({
              c: chunk,
              x: hx + p.nx * side * 1.6,
              y: gy + 0.45,
              z: hz + fz * outward * 0.6,
              s: 1.5 + (along % 5) * 0.35,
              rx: along * 0.08,
              ry: lat * 0.05,
              rz: side * 0.22,
            });
          }
        }
      }
    }
    const massesKept = this._stripLanePoses(masses);
    const shardsKept = this._stripLanePoses(shards);
    this._bumpPoses(massesKept, 0.42);
    this._bumpPoses(shardsKept, 0.38);
    if (massesKept.length) {
      this._addInstances(new THREE.BoxGeometry(1, 1, 1), rock, massesKept, {
        castShadow: true,
        receiveShadow: true,
        cameraFade: true,
      });
    }
    if (shardsKept.length) {
      this._addInstances(cliffShardGeometry(), rockDark, shardsKept, {
        castShadow: true,
        receiveShadow: false,
        cameraFade: true,
      });
    }
  }

  /**
   * Shoulder rock along the buried run so the tube reads as a cut through a
   * ridge, not a free-standing corridor in open desert.
   * @param {number} start
   * @param {number} end
   * @param {THREE.Material} rock
   * @param {THREE.Material} rockDark
   */
  _addTunnelMountain(start, end, rock, rockDark) {
    const pts = this.points;
    const masses = [];
    const shards = [];
    for (let i = start; i <= end; i += 2) {
      const p = pts[i];
      const half = p.width * 0.5;
      const chunk = this._chunkOfDist(p.dist);
      for (const side of [-1, 1]) {
        // Keep the inner face outside the tube. half+9.5 with a 7 m box
        // clipped through the walls as sand slabs along the driving line.
        const off = half + 15.5 + Math.sin(i * 0.7 + side) * 2.2;
        const hx = p.x + p.nx * side * off;
        const hz = p.z + p.nz * side * off;
        const gy = this._tunnelTerrainY(hx, hz);
        if (!this._ribbonClear(hx, hz, 4.2)) continue;
        const h = 11 + Math.abs(Math.sin(i * 0.51 + side)) * 7;
        // Sit the mass ON the ridge (gy), not floating above washed sand.
        masses.push({
          c: chunk,
          x: hx,
          y: gy + h * 0.28,
          z: hz,
          sx: 7.5 + (i % 5) * 0.6,
          sy: h,
          sz: 10,
          ry: p.heading + side * 0.08,
        });
        if (i % 4 === 0) {
          shards.push({
            c: chunk,
            x: hx + p.nx * side * 3.4,
            y: gy + 0.6,
            z: hz,
            s: 1.8 + (i % 3) * 0.5,
            rx: i * 0.2,
            ry: i * 0.4,
            rz: side * 0.3,
          });
        }
      }
    }
    // Mouth shoulders — extra rock planted on the approach / exit ridge so
    // the portal is buried in embankment, not a free-standing gate.
    for (const mouth of [start, end]) {
      const p = pts[mouth];
      const half = p.width * 0.5;
      const outward = mouth === start ? -1 : 1;
      const fx = Math.sin(p.heading);
      const fz = Math.cos(p.heading);
      const chunk = this._chunkOfDist(p.dist);
      for (const side of [-1, 1]) {
        for (const along of [8, 16, 26]) {
          const lat = half + 11 + along * 0.22;
          const hx = p.x + p.nx * side * lat + fx * outward * along;
          const hz = p.z + p.nz * side * lat + fz * outward * along;
          const gy = this._tunnelTerrainY(hx, hz);
          if (!this._ribbonClear(hx, hz, 3.6)) continue;
          const h = 8 + along * 0.28;
          masses.push({
            c: chunk,
            x: hx,
            y: gy + h * 0.3,
            z: hz,
            sx: 6.5 + along * 0.12,
            sy: h,
            sz: 8 + along * 0.15,
            ry: p.heading + side * 0.1,
          });
        }
      }
    }
    const massesKept = this._stripLanePoses(masses);
    const shardsKept = this._stripLanePoses(shards);
    this._bumpPoses(massesKept, 0.55);
    this._bumpPoses(shardsKept, 0.5);
    if (massesKept.length) {
      this._addInstances(new THREE.BoxGeometry(1, 1, 1), rock, massesKept, {
        castShadow: true,
        receiveShadow: false,
        cameraFade: true,
      });
    }
    if (shardsKept.length) {
      this._addInstances(cliffShardGeometry(), rockDark, shardsKept, {
        castShadow: true,
        receiveShadow: false,
        cameraFade: true,
      });
    }
  }

  /**
   * Textured biped spectators (character-male-a … character-female-f) along
   * Desert & Lakeside. Planted clear of the ribbon — no colliders, cheer motion only.
   */
  _addSpectators(rng, def) {
    if (this._crowd) {
      this._crowd.dispose();
      this._crowd = null;
    }
    if (def.scenery === "mountain") return;
    if (!propReady()) return;
    const kinds = CROWD_CHARACTER_KINDS.filter((k) => !!propCharacterParts(k));
    if (!kinds.length) {
      console.warn("[crowd] character GLBs missing — skip spectators");
      return;
    }

    const desert = def.scenery === "desert";
    const forest = def.scenery === "forest";
    const step = desert ? 10 : forest ? 34 : 12;
    const chance = desert ? 0.58 : forest ? 0.22 : 0.44;
    const standOff = ROAD_VERGE + 2.4;
    /** Instanced bipeds — body + 2 arm layers each; keep under draw budget. */
    const maxPoses = desert ? 128 : forest ? 40 : 88;
    const poses = [];
    let kindIdx = 0;
    for (let i = 8; i < this.points.length && poses.length < maxPoses; i++) {
      const p = this.points[i];
      if (p.tunnel) continue;
      const landmark = !!p.landmark;
      if (landmark) {
        if (i % 8) continue;
      } else {
        if (i % step) continue;
        if (rng() > chance) continue;
      }
      let side = rng() > 0.5 ? 1 : -1;
      if (landmark) {
        const prev = this.points[Math.max(0, i - 4)];
        let dh = p.heading - prev.heading;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        side = dh > 0 ? 1 : -1;
      }
      const n = landmark ? 3 + ((rng() * 5) | 0) : 1 + ((rng() * 3) | 0);
      const chunk = Math.min(this._chunkCount - 1, Math.max(0, Math.floor(p.dist / CHUNK_LEN)));
      const fx = Math.sin(p.heading);
      const fz = Math.cos(p.heading);
      const rowDepth = landmark ? 2 : 1;
      for (let row = 0; row < rowDepth && poses.length < maxPoses; row++) {
        for (let k = 0; k < n && poses.length < maxPoses; k++) {
          const lat = p.width * 0.5 + standOff + row * 1.15 + k * 0.52 + rng() * 0.38;
          const along = (rng() - 0.5) * (landmark ? 3.6 : 2.2);
          const x = p.x + p.nx * side * lat + fx * along;
          const z = p.z + p.nz * side * lat + fz * along;
          if (!this._ribbonClear(x, z, 1.1)) continue;
          const kind = kinds[kindIdx++ % kinds.length];
          const gy = this._groundHeight(x, z, def.scenery);
          poses.push({
            x,
            y: gy + (landmark ? 0.12 : 0) + row * 0.06,
            z,
            s: 0.94 + rng() * 0.16,
            ry: p.heading + Math.PI * 0.5 * side + (rng() - 0.5) * 0.38,
            c: chunk,
            kind,
            phase: (i * 0.41 + k * 1.7 + row * 2.3 + rng()) % (Math.PI * 2),
          });
        }
      }
    }
    if (!poses.length) return;
    this._crowd = new CrowdField(this.group, poses, (mesh, chunk) => this._registerChunk(mesh, chunk));
  }

  /**
   * Sprint 15 — rally boards at the start, landmarks, and half-km markers so
   * the stage reads as an authored event from the chase camera.
   * @param {object} def course definition
   */
  _addTracksideSignage(def) {
    const scenery = def.scenery || "forest";
    const stageName = (def.name || "STAGE").toUpperCase();
    const subtitle = def.subtitle || "";
    const accent =
      scenery === "desert"
        ? "#c47828"
        : scenery === "mountain"
          ? "#6888a8"
          : scenery === "lakeside"
            ? "#488898"
            : "#4a7848";
    const steel = worldPropMaterial({ color: 0x3a3a40, roughness: 0.88 });
    const postGeo = new THREE.BoxGeometry(1, 1, 1);
    const posts = [];
    const boards = [];
    const shadows = [];

    const placeBoard = (p, title, sub, side, w, h, chunk) => {
      const off = p.width * 0.5 + ROAD_VERGE + 1.8;
      const px = p.x + p.nx * side * off;
      const pz = p.z + p.nz * side * off;
      if (!this._ribbonClear(px, pz, 0.8)) return;
      const gy = this._groundHeight(px, pz, scenery);
      posts.push({
        c: chunk,
        x: px,
        y: gy + 1.35,
        z: pz,
        sx: 0.22,
        sy: 2.7,
        sz: 0.22,
        ry: p.heading,
      });
      boards.push({
        c: chunk,
        x: px + p.nx * side * 0.08,
        y: gy + 2.55,
        z: pz + p.nz * side * 0.08,
        sx: w,
        sy: h,
        sz: 1,
        ry: p.heading + (side > 0 ? Math.PI : 0),
        title,
        sub,
      });
      this._pushContactShadow(shadows, px, gy, pz, chunk, w * 0.42);
    };

    const startP = this.sample(Math.min(28, this.length * 0.04));
    const startChunk = this._chunkOfDist(startP.dist);
    placeBoard(startP, stageName, subtitle, 1, 4.2, 1.55, startChunk);

    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      if (!p.landmark) continue;
      const prev = this.points[Math.max(0, i - 8)];
      let dh = p.heading - prev.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      const outside = dh > 0 ? -1 : 1;
      const chunk = this._chunkOfDist(p.dist);
      const tag =
        scenery === "desert"
          ? "BOWL"
          : scenery === "forest"
            ? "GLADE"
            : scenery === "mountain"
              ? "HAIRPIN"
              : "LAKESIDE";
      placeBoard(p, tag, `${((p.dist / 1000) * 10) | 0}.${(((p.dist % 1000) / 100) | 0)} KM`, outside, 3.2, 1.2, chunk);
    }

    const kmStep = 500;
    for (let d = kmStep; d < this.length - 120; d += kmStep) {
      const p = this.sample(d);
      if (p.tunnel || p.jump) continue;
      const side = d / kmStep % 2 === 0 ? 1 : -1;
      const chunk = this._chunkOfDist(p.dist);
      const km = (d / 1000).toFixed(1);
      placeBoard(p, `KM ${km}`, stageName, side, 2.4, 0.95, chunk);
    }

    const boardMats = new Map();
    const matFor = (key, title, sub) => {
      let m = boardMats.get(key);
      if (!m) {
        m = new THREE.MeshStandardMaterial({
          map: stageBoardTexture(title, sub, accent),
          roughness: 0.86,
          metalness: 0.04,
          side: THREE.DoubleSide,
          fog: true,
        });
        boardMats.set(key, m);
      }
      return m;
    };

    const boardGeo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < boards.length; i++) {
      const b = boards[i];
      const mesh = new THREE.Mesh(boardGeo, matFor(`${b.title}|${b.sub}|${accent}`, b.title, b.sub));
      mesh.position.set(b.x, b.y, b.z);
      mesh.rotation.y = b.ry;
      mesh.scale.set(b.sx, b.sy, b.sz);
      this._registerChunk(mesh, b.c);
      this.group.add(mesh);
    }

    if (posts.length) this._addInstances(postGeo, steel, posts, { castShadow: true });
    if (shadows.length) {
      this._addInstances(shadowGeometry(), shadowMaterial(), shadows, { receiveShadow: false });
    }
  }

  /**
   * Start and finish gantries — checkered banner + posts at both ends of the stage.
   */
  _addStageGates() {
    const start = this._gatePoint(false);
    const finish = this._gatePoint(true);
    this.startDist = start.dist;
    this.finishDist = finish.dist;
    this._addGantry(start, "START");
    this._addGantry(finish, "FINISH");
  }

  /**
   * First (or last) non-jump, non-tunnel sample used for a stage gate.
   * @param {boolean} fromEnd
   */
  _gatePoint(fromEnd) {
    if (fromEnd) {
      const lo = this.length * 0.72;
      for (let d = this.length - 12; d > lo; d -= 3) {
        const p = this.sample(d);
        if (!p.tunnel && !p.jump) return p;
      }
      return this.sample(Math.max(8, this.length - 12));
    }
    const hi = Math.min(80, this.length * 0.2);
    for (let d = 10; d < hi; d += 3) {
      const p = this.sample(d);
      if (!p.tunnel && !p.jump) return p;
    }
    return this.sample(12);
  }

  /**
   * Overhead checkered banner, posts at the road edge, stripe on the tarmac.
   * @param {object} p
   * @param {string} label
   */
  _addGantry(p, label) {
    const half = p.width * 0.5;
    const postX = half + 1.8;
    const steel = new THREE.MeshLambertMaterial({ color: 0x3a3a40, flatShading: true });
    const red = new THREE.MeshLambertMaterial({ color: 0xd4121a, flatShading: true });
    const postGeo = new THREE.BoxGeometry(0.38, 5.4, 0.38);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, steel);
      post.position.set(p.x + p.nx * side * postX, p.y + 2.7, p.z + p.nz * side * postX);
      post.rotation.y = p.heading;
      this.group.add(post);
      this._bump(p.x + p.nx * side * postX, p.z + p.nz * side * postX, 0.55);
    }

    const beam = new THREE.Mesh(new THREE.BoxGeometry(p.width + 2.4, 0.28, 0.42), steel);
    beam.position.set(p.x, p.y + 5.35, p.z);
    beam.rotation.y = p.heading;
    this.group.add(beam);

    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(p.width + 1.8, 1.45),
      new THREE.MeshBasicMaterial({ map: bannerTexture(label), side: THREE.DoubleSide })
    );
    banner.position.set(p.x, p.y + 4.55, p.z);
    // PlaneGeometry faces +Z; heading is driving direction. Add PI so the
    // printed face points at oncoming cars (otherwise FINISH reads mirrored).
    banner.rotation.y = p.heading + Math.PI;
    this.group.add(banner);

    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(p.width * 0.96, 0.05, 1.55),
      new THREE.MeshBasicMaterial({ map: checkStripeTexture() })
    );
    stripe.position.set(p.x, p.y + ROAD_DECK + 0.02, p.z);
    stripe.rotation.y = p.heading;
    this.group.add(stripe);

    for (const side of [-0.35, 0.35]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), red);
      lamp.position.set(
        p.x + p.nx * side * p.width * 0.4,
        p.y + 5.58,
        p.z + p.nz * side * p.width * 0.4
      );
      this.group.add(lamp);
    }
  }

  /**
   * Pace note at a distance along the racing line.
   * Soonest turn or jump wins — not the sharpest corner in the window.
   * @param {number} dist
   * @param {number} [look]
   */
  noteAt(dist, look = 42) {
    return pickPaceNote((d) => this.sample(d), dist, look, this.length);
  }

  /**
   * Closest racing-line sample.
   * Pass `out` on the hot path so 14-car grids do not allocate every tick.
   * @param {number} dist
   * @param {object} [out]
   */
  sample(dist, out) {
    const d = ((dist % this.length) + this.length) % this.length;
    const pts = this.points;
    let lo = 0;
    let hi = pts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].dist < d) lo = mid + 1;
      else hi = mid;
    }
    const i = Math.max(1, lo);
    const a = pts[i - 1];
    const b = pts[i];
    const span = b.dist - a.dist || 1;
    const t = clamp((d - a.dist) / span, 0, 1);
    return fillSample(out || {}, a, b, t, d);
  }

  /**
   * Height, surface, and lateral offset at a world XZ.
   * Height is interpolated along the nearest spline segment so ramps
   * are a slope, not a staircase of sample posts.
   *
   * @param {number} x
   * @param {number} z
   * @param {object} [out] reuse bag — AI and Vehicle pass scratch objects
   * @param {number} [hintDist] last known progress (skips the coarse scan)
   */
  query(x, z, out, hintDist) {
    const pts = this.points;
    const best = this._nearestIndex(x, z, hintDist);
    let segI = Math.max(0, best - 1);
    let segT = 0;
    let segD = Infinity;
    const s0 = Math.max(0, best - 12);
    const s1 = Math.min(pts.length - 2, best + 12);
    for (let i = s0; i <= s1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const len2 = abx * abx + abz * abz;
      const t = len2 < 1e-8 ? 0 : clamp(((x - a.x) * abx + (z - a.z) * abz) / len2, 0, 1);
      const px = a.x + abx * t;
      const pz = a.z + abz * t;
      const d = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (d < segD) {
        segD = d;
        segI = i;
        segT = t;
      }
    }

    const a = pts[segI];
    const b = pts[Math.min(segI + 1, pts.length - 1)];
    const t = segT;
    const y = a.y + (b.y - a.y) * t;
    let dh = b.heading - a.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    const heading = a.heading + dh * t;
    const nx = Math.cos(heading);
    const nz = -Math.sin(heading);
    const px = a.x + (b.x - a.x) * t;
    const pz = a.z + (b.z - a.z) * t;
    const lateral = (x - px) * nx + (z - pz) * nz;
    const width = a.width + (b.width - a.width) * t;
    const half = width * 0.5;
    const onRoad = Math.abs(lateral) <= half;
    const useB = t > 0.5;
    let surface = useB ? b.surface : a.surface;
    const tunnel = !!(useB ? b.tunnel : a.tunnel);
    const jumpKind = (useB ? b.jumpKind : a.jumpKind) || null;
    const jump = !!(useB ? b.jump : a.jump);
    const jtA = a.jumpThrow != null ? a.jumpThrow : 1;
    const jtB = b.jumpThrow != null ? b.jumpThrow : 1;
    const jlA = a.jumpLip != null ? a.jumpLip : 1;
    const jlB = b.jumpLip != null ? b.jumpLip : 1;
    const distAlong = a.dist + (b.dist - a.dist) * t;
    const blend = this._surfaceBlend(distAlong, surface);
    if (!onRoad && !tunnel) {
      const extra = Math.abs(lateral) - half;
      if (extra > 1.2) surface = this.offroad;
      else if (extra > 0.2) surface = this.offroad === "sand" ? "sand" : "grass";
    }
    const micro =
      onRoad || tunnel
        ? roadMicroHeight(distAlong, lateral, blend.id, jumpKind, tunnel)
        : 0;
    const r = out || {};
    r.height = y + ROAD_DECK + micro;
    r.normalY = 1;
    r.surface = onRoad || tunnel ? blend.id : surface;
    r.surfFrom = onRoad || tunnel ? blend.from : surface;
    r.surfTo = onRoad || tunnel ? blend.to : surface;
    r.surfMix = onRoad || tunnel ? blend.mix : 0;
    r.lateral = lateral;
    r.width = width;
    r.dist = distAlong;
    r.heading = heading;
    r.nx = nx;
    r.nz = nz;
    r.onRoad = onRoad;
    r.tunnel = tunnel;
    r.jump = jump;
    r.jumpKind = jumpKind;
    r.jumpThrow = jtA + (jtB - jtA) * t;
    r.jumpLip = jlA + (jlB - jlA) * t;
    r.jumpDrop =
      (a.jumpDrop != null ? a.jumpDrop : 2.6) +
      ((b.jumpDrop != null ? b.jumpDrop : 2.6) - (a.jumpDrop != null ? a.jumpDrop : 2.6)) * t;
    r.roadMicro = micro;
    return r;
  }

  /**
   * Coarse then refine, or a progress-seeded window when the car is on-line.
   * @param {number} x
   * @param {number} z
   * @param {number} [hintDist]
   * @returns {number}
   */
  _nearestIndex(x, z, hintDist) {
    const pts = this.points;
    if (hintDist != null && Number.isFinite(hintDist) && pts.length > 8) {
      let lo = 0;
      let hi = pts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (pts[mid].dist < hintDist) lo = mid + 1;
        else hi = mid;
      }
      let best = Math.max(1, Math.min(pts.length - 2, lo));
      let bestScore = Infinity;
      let bestD = Infinity;
      // A visual pit is not a racing line. Desert jump 3's gap mesh is ~30 m;
      // along-weighted scoring then kept every car on the hole while their XZ
      // was already on the land / tunnel climb, so the pack sank through the road.
      const hintedPit = !!(pts[best] && pts[best].jumpKind === "gap");
      const hintHeading = pts[best] && pts[best].heading;
      const i0 = Math.max(0, best - (hintedPit ? 8 : 22));
      const i1 = Math.min(pts.length - 1, best + (hintedPit ? 80 : 40));
      // Hairpin opposite arms are close in XZ but far along the spline.
      // Euclidean-nearest inside this window was the teleport: the car
      // snapped to the other loop, then bounceOffRoad planted it there.
      const ALONG_W = 2.4;
      // Stay on THIS loop even when another ribbon occupies the same XZ
      // (Desert mud vs later sweeper, Forest glade vs sweep, Mountain stack).
      // A global fallback here is the warp that resets cars and NaNs the loop.
      const MAX_ALONG = hintedPit ? 180 : 36;
      const n = pts.length;
      const visit = (i) => {
        const p = pts[i];
        let along = Math.abs(p.dist - hintDist);
        const span = pts[n - 1].dist || 0;
        if (span > 80 && along > span * 0.5) along = span - along;
        const dx = x - p.x;
        const dz = z - p.z;
        const d = dx * dx + dz * dz;
        // Tunnel only if the car is actually there. A 110 m walk from jump 3
        // used to magnetize the tube; a 50 m cap then left the floor on the pit
        // pad while the chassis was already on the climb.
        if (p.tunnel && d > 12 * 12) return;
        if (p.jumpKind === "gap" && d > 8 * 8) return;
        if (hintedPit) {
          if (d > 12 * 12 && along > MAX_ALONG) return;
        } else if (along > MAX_ALONG) {
          // Same-ribbon continuation (Desert jump 3 climb is ~70 m). An
          // opposite hairpin arm is close in XZ but heading is ~π.
          const hintP = hintHeading;
          let dh = (p.heading || 0) - (hintP || 0);
          while (dh > Math.PI) dh -= Math.PI * 2;
          while (dh < -Math.PI) dh += Math.PI * 2;
          if (!(d < 10 * 10 && along < 100 && Math.abs(dh) < 1.15)) return;
        }
        let score = d;
        // Inside MAX_ALONG, Euclidean must be able to follow the next 40 m of
        // THIS ribbon (Desert climb after jump 3). along²·2.4 trapped the
        // floor on the pad while the car was already on the rising road.
        if (!hintedPit) score += along * ALONG_W * 0.2;
        if (p.jumpKind === "gap") score += d * 4;
        if (score < bestScore) {
          bestScore = score;
          bestD = d;
          best = i;
        }
      };
      for (let i = i0; i <= i1; i++) visit(i);
      // Finish-line wrap: the first/last posts can share XZ.
      if (best <= 8) {
        for (let i = Math.max(0, n - 24); i < n; i++) visit(i);
      }
      if (best >= n - 9) {
        for (let i = 0; i < Math.min(n, 24); i++) visit(i);
      }
      if (bestScore < Infinity) {
        // Stale pit hint: XZ has left this ribbon — walk ahead by Euclidean
        // nearest. Adopt a sample only if the car is on it. Tunnel is legal
        // only when XZ is in the tube, not as a magnet from the pit.
        if (hintedPit && bestD > 12 * 12) {
          const iFwd1 = Math.min(pts.length - 1, best + 80);
          for (let i = best; i <= iFwd1; i++) {
            const p = pts[i];
            const dx = x - p.x;
            const dz = z - p.z;
            const d = dx * dx + dz * dz;
            if (p.tunnel && d > 12 * 12) continue;
            if (p.jumpKind === "gap" && d > 8 * 8) continue;
            let along = Math.abs(p.dist - hintDist);
            const span = pts[n - 1].dist || 0;
            if (span > 80 && along > span * 0.5) along = span - along;
            if (d > 12 * 12 && along > 180) continue;
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
        }
        return best;
      }
    }
    let best = 0;
    let bestD = Infinity;
    const step = Math.max(1, (pts.length / 80) | 0);
    for (let i = 0; i < pts.length; i += step) {
      const p = pts[i];
      const dx = x - p.x;
      const dz = z - p.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const i0 = Math.max(1, best - 12);
    const i1 = Math.min(pts.length - 1, best + 12);
    for (let i = i0; i <= i1; i++) {
      const p = pts[i];
      const dx = x - p.x;
      const dz = z - p.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /**
   * Free GPU resources before the next championship stage loads.
   * Shared tree cards/textures stay alive (tagged userData.shared).
   */
  dispose() {
    if (!this.group) return;
    this._streamable = [];
    this._grid = null;
    this.group.traverse((obj) => {
      if (obj.geometry && !obj.geometry.userData.shared) {
        obj.geometry.dispose();
      }
      const mats = obj.material
        ? Array.isArray(obj.material)
          ? obj.material
          : [obj.material]
        : [];
      for (const m of mats) {
        if (!m) continue;
        if (m.map && !m.map.userData.shared) m.map.dispose();
        if (m.alphaMap && !m.alphaMap.userData.shared) m.alphaMap.dispose();
        if (m.emissiveMap && !m.emissiveMap.userData.shared) m.emissiveMap.dispose();
        m.dispose();
      }
    });
    this.group.clear();
    if (this._crowd) {
      this._crowd.dispose();
      this._crowd = null;
    }
    this._tumbleweeds = null;
    this._tumbleDummy = null;
  }

  /**
   * Ease into the current ribbon over ~72 m AFTER the named cut.
   *
   * Blending both sides of the cut used to flip mix from ~1 to ~0 at the
   * spline boundary (gravel for a metre, then sand again, then gravel) —
   * that is the HUD/audio/grip teleporter. One-sided smoothstep stays
   * continuous: just before the cut you are fully `here`, just after you
   * are still fully the previous surface, then you ease into the new one.
   *
   * @param {number} dist
   * @param {string} here
   */
  _surfaceBlend(dist, here) {
    const pts = this.points;
    const BLEND = 72;
    let prev = here;
    let prevDist = -1e9;
    let lo = 0;
    let hi = pts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].dist < dist) lo = mid + 1;
      else hi = mid;
    }
    const i = Math.max(0, lo);
    for (let k = i; k >= 0; k--) {
      if (pts[k].surface !== here) {
        prev = pts[k].surface;
        prevDist = pts[k].dist;
        break;
      }
    }
    const dPrev = dist - prevDist;
    if (dPrev >= 0 && dPrev < BLEND && prev !== here) {
      const mix = smoothstep(dPrev / BLEND);
      return { id: mix > 0.55 ? here : prev, from: prev, to: here, mix };
    }
    return { id: here, from: here, to: here, mix: 0 };
  }

  /**
   * Register an opaque env solid. Never on the roadway corridor — origin off
   * the paint is not enough if the radius reaches the drive path. Tunnel /
   * underpass linings use `_wallFace` instead.
   * @param {number} x
   * @param {number} z
   * @param {number} r
   * @param {number} [knownOver] precomputed edge clearance (skip a second query)
   */
  _bump(x, z, r, knownOver = null) {
    const rad = Math.max(0.05, Number(r) || 0.5);
    let over = knownOver;
    if (over == null || !Number.isFinite(over)) {
      const road = this._nearestRoad(x, z);
      over = road.minOver != null ? road.minOver : road.dist - road.roadW * 0.5;
    }
    if (over - rad < ROAD_COLLIDER_CLEAR) return;
    this.colliders.push({ x, z, r: rad });
  }

  /**
   * Planar inner face of a tunnel or underpass wall. (x, z) sits on the
   * visible lining. (nx, nz) points into the drive volume. halfLen is metres
   * along the wall from that point.
   * @param {number} x
   * @param {number} z
   * @param {number} nx
   * @param {number} nz
   * @param {number} tx
   * @param {number} tz
   * @param {number} halfLen
   * @param {number} depth lining thickness behind the face (m). A wall is a
   *   slab, not an infinite half-space: without a back, a car anywhere behind
   *   the plane reads as buried in it, and collide.js flings it out by however
   *   far away it was. Pass the real thickness of the box being lined.
   */
  _wallFace(x, z, nx, nz, tx, tz, halfLen, depth) {
    const nLen = Math.hypot(nx, nz) || 1;
    const tLen = Math.hypot(tx, tz) || 1;
    this.colliders.push({
      kind: "wall",
      x,
      z,
      nx: nx / nLen,
      nz: nz / nLen,
      tx: tx / tLen,
      tz: tz / tLen,
      halfLen,
      depth,
      r: 0.01,
    });
  }

  /**
   * Register a solid collider only when the prop sits near the driven line
   * (and never on the roadway corridor). Far wilderness stays visual-only.
   * @param {number} x
   * @param {number} z
   * @param {number} r
   * @param {number} [maxDist] metres from ribbon centre
   */
  _bumpNearRoad(x, z, r, maxDist = 34) {
    const road = this._nearestRoad(x, z);
    if (road.dist > maxDist) return;
    const over = road.minOver != null ? road.minOver : road.dist - road.roadW * 0.5;
    this._bump(x, z, r, over);
  }

  /**
   * Batch solid colliders for instanced opaque props (rocks, berms, houses).
   * @param {Array<{x:number,z:number,s?:number,sx?:number,sz?:number,r?:number}>} poses
   * @param {number} [radiusScale]
   * @param {number} [maxDist]
   */
  _bumpPoses(poses, radiusScale = 0.55, maxDist = 34) {
    if (!poses || !poses.length) return;
    for (let i = 0; i < poses.length; i++) {
      const p = poses[i];
      const span = p.s != null ? p.s : Math.max(p.sx || 1, p.sz || 1);
      const r = p.r != null ? p.r : Math.max(0.55, span * radiusScale);
      this._bumpNearRoad(p.x, p.z, r, maxDist);
    }
  }
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

/** Hermite ease 0..1 so grip and HUD mix have no linear kinks. */
function smoothstep(t) {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

function mixHex(a, b, t) {
  const k = clamp(t, 0, 1);
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  return (
    (((ar + (br - ar) * k) & 255) << 16) |
    (((ag + (bg - ag) * k) & 255) << 8) |
    ((ab + (bb - ab) * k) & 255)
  );
}

function surfaceRibbonHex(id) {
  const s = SURFACES[id] || SURFACES.dirt;
  return s.ribbon || s.color || COLORS.ribbonDirt;
}

function surfaceShoulderHex(id) {
  if (id === "tarmac") return 0x5c564e;
  if (id === "cobble") return 0x72685a;
  if (id === "gravel") return 0x8a7456;
  if (id === "dirt") return 0x764c2a;
  if (id === "sand") return 0xa68852;
  if (id === "mud") return 0x4e3828;
  if (id === "grass") return 0x5e6e30;
  return 0x7a6242;
}

function roadTintHex(from, to, mix) {
  const surfaceBlend = mixHex(surfaceRibbonHex(from), surfaceRibbonHex(to), mix);
  // Tiny lift so Lambert does not crush the ribbon. 0.72 toward cream used
  // to wash Stage 1 into loose dune sand sitting on the driving line.
  return mixHex(surfaceBlend, 0xf2eee6, 0.08);
}

function shoulderTintHex(terrainHex, from, to, mix) {
  const edgeBlend = mixHex(surfaceShoulderHex(from), surfaceShoulderHex(to), mix);
  return mixHex(terrainHex, edgeBlend, 0.5);
}

/**
 * Unique integer key for a grid cell. Valid while |coordinate| stays under
 * ~1,000 km, which is four orders of magnitude past the longest stage.
 * @param {number} gx
 * @param {number} gz
 * @returns {number}
 */
function cellKey(gx, gz) {
  return (gx + 32768) * 65536 + (gz + 32768);
}

/** @type {THREE.BufferGeometry|null} */
let SPECTATOR_GEO = null;
/** @type {THREE.BufferGeometry|null} */
let ANIMAL_GEO = null;

/** Normalise box primitives so mergeGeometries does not console.error on mixed index/uv buffers. */
function mergeReadyBox(geo) {
  const flat = geo.toNonIndexed();
  const pos = flat.getAttribute("position");
  const out = new THREE.BufferGeometry();
  if (pos) {
    if (pos.isInterleavedBufferAttribute) {
      const arr = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        arr[i * 3] = pos.getX(i);
        arr[i * 3 + 1] = pos.getY(i);
        arr[i * 3 + 2] = pos.getZ(i);
      }
      out.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
    } else {
      out.setAttribute("position", pos.clone());
    }
  }
  out.computeVertexNormals();
  const count = out.getAttribute("position")?.count || 0;
  out.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
  if (flat !== geo) flat.dispose();
  return out;
}

/**
 * Unused legacy stub — live stages use CrowdField + character-male-a GLBs.
 * Kept so old imports do not break; never plant this primitive.
 * @returns {THREE.BufferGeometry}
 */
function spectatorGeometry() {
  if (SPECTATOR_GEO) return SPECTATOR_GEO;
  // Intentionally empty unit — callers must not use primitives for people.
  SPECTATOR_GEO = new THREE.BufferGeometry();
  SPECTATOR_GEO.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  SPECTATOR_GEO.userData.shared = true;
  SPECTATOR_GEO.userData.deprecated = true;
  return SPECTATOR_GEO;
}

/**
 * A gallery animal for the Safari stage: barrel body, neck, head, four stubby
 * legs, origin at the hooves. Scaled per instance so one geometry covers
 * everything from a small zebra to something elephant-sized.
 * @returns {THREE.BufferGeometry}
 */
function animalGeometry() {
  if (ANIMAL_GEO) return ANIMAL_GEO;
  const parts = [];
  const body = new THREE.BoxGeometry(0.62, 0.6, 1.5);
  body.translate(0, 0.86, 0);
  parts.push(mergeReadyBox(body));
  const neck = new THREE.BoxGeometry(0.3, 0.5, 0.3);
  neck.translate(0, 1.16, 0.72);
  parts.push(mergeReadyBox(neck));
  const head = new THREE.BoxGeometry(0.3, 0.28, 0.5);
  head.translate(0, 1.36, 0.94);
  parts.push(mergeReadyBox(head));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.BoxGeometry(0.17, 0.6, 0.17);
      leg.translate(sx * 0.21, 0.3, sz * 0.5);
      parts.push(mergeReadyBox(leg));
    }
  }
  ANIMAL_GEO = mergeGeometries(parts, false) || mergeReadyBox(body);
  ANIMAL_GEO.userData.shared = true;
  return ANIMAL_GEO;
}

/** @type {THREE.BufferGeometry|null} */
let TUMBLEWEED_GEO = null;
const _TUMBLE_AXIS = new THREE.Vector3(1, 0, 0);

/**
 * Dry twig ball — a real tumbleweed, not a textured sprite.
 * @returns {THREE.BufferGeometry}
 */
function tumbleweedGeometry() {
  if (TUMBLEWEED_GEO) return TUMBLEWEED_GEO;
  const parts = [];
  const rng = mulberry(91);
  for (let i = 0; i < 16; i++) {
    const len = 0.7 + rng() * 0.4;
    const cyl = new THREE.CylinderGeometry(0.01 + rng() * 0.012, 0.006, len, 4);
    cyl.rotateX(rng() * Math.PI);
    cyl.rotateY(rng() * Math.PI * 2);
    cyl.rotateZ((rng() - 0.5) * Math.PI);
    parts.push(mergeReadyBox(cyl));
    cyl.dispose();
  }
  for (let i = 0; i < 5; i++) {
    const torus = new THREE.TorusGeometry(0.26 + rng() * 0.14, 0.012, 5, 10);
    torus.rotateX(rng() * Math.PI);
    torus.rotateY(rng() * Math.PI);
    torus.rotateZ(rng() * Math.PI);
    parts.push(mergeReadyBox(torus));
    torus.dispose();
  }
  TUMBLEWEED_GEO = mergeGeometries(parts, false);
  if (!TUMBLEWEED_GEO) {
    TUMBLEWEED_GEO = new THREE.IcosahedronGeometry(0.48, 1);
  }
  TUMBLEWEED_GEO.computeVertexNormals();
  TUMBLEWEED_GEO.userData.shared = true;
  return TUMBLEWEED_GEO;
}

/**
 * Straw / sun-bleached tumbleweed Lambert. Fresh per stage so dispose() is safe.
 * @returns {THREE.Material}
 */
function tumbleweedMaterial() {
  return new THREE.MeshLambertMaterial({
    color: 0xb89658,
    flatShading: true,
  });
}

/** @type {THREE.BufferGeometry|null} */
let CLIFF_SHARD_GEO = null;

/**
 * Closed convex rock chip. The old 6-vertex fan was non-manifold (holes +
 * mixed winding), so every debris pile showed interior backfaces.
 */
function cliffShardGeometry() {
  if (CLIFF_SHARD_GEO) return CLIFF_SHARD_GEO;
  const geo = new THREE.IcosahedronGeometry(0.62, 0);
  geo.scale(1.22, 0.78, 1.08);
  geo.computeVertexNormals();
  geo.userData.shared = true;
  CLIFF_SHARD_GEO = geo;
  return geo;
}

/**
 * Turn a vertex bucket into an indexed BufferGeometry.
 * @param {{pos:number[], col:number[], uv?:number[], idx:number[]}} b
 * @param {boolean} withUv
 * @returns {THREE.BufferGeometry}
 */
function buildGeo(b, withUv) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
  if (withUv && b.uv) geo.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
  geo.setIndex(b.idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Interpolate two spline posts into a reusable sample bag.
 * @param {object} out
 * @param {object} a
 * @param {object} b
 * @param {number} t
 * @param {number} d
 */
function fillSample(out, a, b, t, d) {
  let dh = b.heading - a.heading;
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  out.nx = a.nx + (b.nx - a.nx) * t;
  out.nz = a.nz + (b.nz - a.nz) * t;
  out.heading = a.heading + dh * t;
  out.width = a.width + (b.width - a.width) * t;
  out.surface = t > 0.5 ? b.surface : a.surface;
  out.tunnel = !!(t > 0.5 ? b.tunnel : a.tunnel);
  out.jump = !!(t > 0.5 ? b.jump : a.jump);
  out.jumpKind = (t > 0.5 ? b.jumpKind : a.jumpKind) || null;
  const jtA = a.jumpThrow != null ? a.jumpThrow : 1;
  const jtB = b.jumpThrow != null ? b.jumpThrow : 1;
  const jlA = a.jumpLip != null ? a.jumpLip : 1;
  const jlB = b.jumpLip != null ? b.jumpLip : 1;
  out.jumpThrow = jtA + (jtB - jtA) * t;
  out.jumpLip = jlA + (jlB - jlA) * t;
  out.jumpDrop = (a.jumpDrop != null ? a.jumpDrop : 2.6) + ((b.jumpDrop != null ? b.jumpDrop : 2.6) - (a.jumpDrop != null ? a.jumpDrop : 2.6)) * t;
  out.landmark = !!(a.landmark || b.landmark);
  out.sweep = !!(a.sweep || b.sweep);
  out.dist = d;
  return out;
}

/** @type {Map<string, THREE.CanvasTexture>} */
const BANNER_TEX = new Map();

/**
 * Checkered overhead sign — START / FINISH.
 * @param {string} label
 */
function bannerTexture(label) {
  const hit = BANNER_TEX.get(label);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d");
  const cell = 32;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 16; x++) {
      g.fillStyle = (x + y) % 2 === 0 ? "#111111" : "#f4f4f0";
      g.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  g.fillStyle = "#d4121a";
  g.fillRect(0, 38, 512, 52);
  g.fillStyle = "#ffffff";
  g.font = "bold 40px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(label, 256, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  tex.userData.shared = true;
  BANNER_TEX.set(label, tex);
  return tex;
}

/** @type {Map<string, THREE.CanvasTexture>} */
const STAGE_BOARD_TEX = new Map();

/**
 * Rally stage board — white face, coloured header band, subtitle strip.
 * @param {string} title
 * @param {string} subtitle
 * @param {string} accent hex colour
 * @returns {THREE.CanvasTexture}
 */
function stageBoardTexture(title, subtitle, accent) {
  const key = `${title}|${subtitle}|${accent}`;
  const hit = STAGE_BOARD_TEX.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 192;
  const g = c.getContext("2d");
  g.fillStyle = "#f2f0ea";
  g.fillRect(0, 0, 512, 192);
  g.fillStyle = accent;
  g.fillRect(0, 0, 512, 52);
  g.fillStyle = "#1a1a18";
  g.fillRect(0, 52, 512, 4);
  g.fillStyle = "#2a2824";
  g.font = "bold 44px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(title.slice(0, 14), 256, 108);
  if (subtitle) {
    g.fillStyle = "#5a564e";
    g.font = "22px sans-serif";
    g.fillText(subtitle.slice(0, 28), 256, 158);
  }
  g.strokeStyle = "rgba(0,0,0,0.12)";
  g.lineWidth = 3;
  g.strokeRect(4, 4, 504, 184);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  tex.userData.shared = true;
  STAGE_BOARD_TEX.set(key, tex);
  return tex;
}

let STRIPE_TEX = null;
/** @type {Map<string, THREE.CanvasTexture>} */
const ROAD_TEX = new Map();
/** @type {Map<string, THREE.CanvasTexture>} */
const ROAD_NORM = new Map();
/** @type {Map<string, THREE.CanvasTexture>} */
const LAND_NORM = new Map();

function texHash(x, y, s) {
  let n = Math.imul(x + s * 17, 374761393) ^ Math.imul(y + s * 13, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n >>> 0) % 10000) / 10000;
}

/**
 * Vertical bore striations for Desert tunnel walls — drill grooves and rock
 * chip so instanced boxes read as a cut rock tube, not flat beige slabs.
 * Modulation map: material colour still owns the hue; this adds groove depth.
 * @returns {THREE.CanvasTexture|null}
 */
function tunnelBoreStriationMap() {
  const tier = VISUAL.tier || 1;
  return paintedTexture(
    `tunnel-bore-striation-t${tier}`,
    (g, w, h) => {
      const img = g.createImageData(w, h);
      const d = img.data;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const blotch = texHash((x / 10) | 0, (y / 14) | 0, 41);
          const grain = texHash(x, y, 53);
          const chip = texHash((x / 4) | 0, y, 61);

          // Primary vertical drill grooves — variable pitch like a bore bit.
          const pitch = 5.5 + texHash(0, (y / 20) | 0, 67) * 4.5;
          const gx = x % pitch;
          let groove = 1;
          if (gx < 0.9) groove = 0.62;
          else if (gx < 1.6) groove = 0.82;
          else if (gx > pitch - 1.1 && gx < pitch - 0.35) groove = 1.12;

          // Finer striations between main grooves.
          const fine = (x % 2.2) < 0.35 ? 0.9 : 1;

          // Subtle horizontal bedding / fracture (rock layers, not sand bands).
          const bed =
            Math.sin(y * 0.065 + texHash((x / 18) | 0, 0, 73) * 2.4) > 0.93 ? 0.86 : 1;

          // Occasional vertical tool scar — darker streak down the bore face.
          const scarCol = texHash((x / 9) | 0, 0, 79);
          if (scarCol > 0.955 && gx < pitch * 0.45) groove *= 0.72;

          let lum =
            (118 + blotch * 36 + grain * 22) * groove * fine * bed * (0.94 + chip * 0.1);
          lum = clamp(lum, 48, 212);
          const i = (y * w + x) * 4;
          d[i] = lum;
          d[i + 1] = lum * 0.97;
          d[i + 2] = lum * 0.88;
          d[i + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
    },
    { w: 64, h: 128, repeat: [2, 1], aniso: 1 }
  );
}

/**
 * Tiled ground grain for the heightmap. Vertex colours still own the biome
 * wash; this map is a near-white overlay so sand, litter, and scree read at
 * rest instead of a smooth Lambert hill.
 * @param {string} scenery
 * @param {number} span metres across the land plane
 * @returns {THREE.CanvasTexture|null}
 */
function landAlbedoMap(scenery, span) {
  const kind = scenery === "desert" || scenery === "mountain" || scenery === "lakeside" ? scenery : "forest";
  const scale = VISUAL.textureScale || 1;
  const tier = VISUAL.tier || 1;
  const base = paintedTexture(
    `land-albedo-t${tier}-${kind}`,
    (g, w, h) => {
      const img = g.createImageData(w, h);
      paintLandAlbedo(kind, w, h, img.data);
      g.putImageData(img, 0, 0);
    },
    { w: 256 * scale, h: 256 * scale, repeat: [1, 1], aniso: 4 }
  );
  if (!base) return null;
  const map = base.clone();
  const tiles = Math.max(28, span / 8.5);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(tiles, tiles);
  map.userData.shared = true;
  map.needsUpdate = true;
  return map;
}

/**
 * Near-white grain so vertex colours stay in charge of hue.
 * Tier ≥7 / terrainRealism adds denser grain, sand ripples, moss, and rock flecks.
 * Cache keys in landAlbedoMap / landNormalMap include VISUAL.tier so paint stays coherent.
 * @param {string} kind
 * @param {number} w
 * @param {number} h
 * @param {Uint8ClampedArray} d
 */
function paintLandAlbedo(kind, w, h, d) {
  const hi = (VISUAL.tier || 0) >= 7 || VISUAL.terrainRealism === true;
  const photo = (VISUAL.tier || 0) >= 9;
  const cinema = (VISUAL.tier || 0) >= 13 || VISUAL.cinemaRealism === true;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = texHash(x, y, 1);
      const n2 = texHash(x, y, 11);
      const blotch = texHash((x / 10) | 0, (y / 10) | 0, 5);
      let lum = 208 + n * 36 + blotch * 14;
      let r = lum;
      let g = lum;
      let b = lum;
      if (kind === "desert") {
        const ripple = 0.5 + 0.5 * Math.sin(y * 0.21 + x * 0.03);
        const windRipple = 0.5 + 0.5 * Math.sin(x * 0.08 + y * 0.015);
        lum *= 0.91 + ripple * 0.08 + windRipple * 0.05;
        if (hi) {
          const cross = 0.5 + 0.5 * Math.sin(x * 0.31 + y * 0.09);
          const fine = 0.5 + 0.5 * Math.sin(y * 0.55 + x * 0.12);
          lum *= 0.97 + cross * 0.04 + fine * 0.03 + (n - 0.5) * 0.04;
        }
        if (photo) {
          // Micro-scale dune chatter + sparse darker wet patches.
          const micro = 0.5 + 0.5 * Math.sin(x * 1.15 + y * 0.87) * Math.sin(y * 0.93);
          const wet = texHash((x / 3) | 0, (y / 3) | 0, 101);
          lum *= 0.96 + micro * 0.06 + (n2 - 0.5) * 0.05;
          if (wet > 0.93) lum *= 0.86;
        }
        if (cinema) {
          // Fine silica glitter + wind-sorted grain bands.
          const silica = texHash(x, y, 131);
          if (silica > 0.97) lum *= 1.08;
          const band = 0.5 + 0.5 * Math.sin(x * 0.045 + y * 0.22);
          lum *= 0.98 + band * 0.035;
          lum += (texHash(x * 3, y * 3, 137) - 0.5) * 14;
        }
        r = lum * 1.04;
        g = lum * 0.98;
        b = lum * 0.88;
        if (n2 > 0.985) {
          const peb = texHash(x, y, 31);
          r = lum * (0.58 + peb * 0.32);
          g = lum * (0.54 + peb * 0.3);
          b = lum * (0.46 + peb * 0.26);
        } else if (n2 > 0.975) {
          r *= 0.62;
          g *= 0.58;
          b *= 0.5;
        } else if (hi && n2 > 0.955) {
          // Sparse dark gravel flecks between larger pebbles.
          r *= 0.78;
          g *= 0.74;
          b *= 0.66;
        }
        const crack = texHash((x / 4) | 0, (y / 4) | 0, 17);
        const crack2 = texHash((x / 6) | 0, (y / 6) | 0, 23);
        if ((crack > 0.88 && crack < 0.905) || (crack2 > 0.91 && crack2 < 0.928)) {
          r *= 0.72;
          g *= 0.68;
          b *= 0.58;
        }
        if (hi) {
          const crust = texHash((x / 5) | 0, (y / 7) | 0, 71);
          if (crust > 0.9 && crust < 0.94) {
            r *= 1.05;
            g *= 1.02;
            b *= 0.95;
          }
        }
      } else if (kind === "mountain") {
        r = lum * 0.98;
        g = lum * 0.96;
        b = lum * 0.92;
        const vein = Math.sin(x * 0.12 + y * 0.04 + texHash((x / 8) | 0, (y / 8) | 0, 19) * 3);
        if (vein > 0.82) {
          r += 22;
          g += 20;
          b += 16;
        }
        if (n2 > 0.9 && n2 < 0.96) {
          r *= 0.78;
          g *= 0.88;
          b *= 0.62;
        } else if (n2 > 0.965) {
          const chip = texHash(x, y, 29);
          r = lum * (0.66 + chip * 0.24);
          g = lum * (0.63 + chip * 0.22);
          b = lum * (0.58 + chip * 0.18);
        }
        const grassStreak = texHash((x / 3) | 0, y, 37);
        if (grassStreak > 0.94 && grassStreak < 0.975) {
          r *= 0.88;
          g *= 1.06;
          b *= 0.82;
        }
        if (n > 0.97) {
          r += 18;
          g += 16;
          b += 12;
        }
        if (hi) {
          // Dense scree speck + quartz flecks + darker basalt grains.
          const scree = texHash(x, y, 59);
          if (scree > 0.88 && scree < 0.96) {
            const k = (scree - 0.88) / 0.08;
            r = r * (1 - k * 0.18) + lum * (0.7 + k * 0.12) * k;
            g = g * (1 - k * 0.16) + lum * (0.68 + k * 0.1) * k;
            b = b * (1 - k * 0.14) + lum * (0.62 + k * 0.08) * k;
          }
          const quartz = texHash(x, y, 67);
          if (quartz > 0.985) {
            r += 28;
            g += 26;
            b += 22;
          }
          const basalt = texHash((x / 2) | 0, (y / 2) | 0, 73);
          if (basalt > 0.9 && basalt < 0.93) {
            r *= 0.7;
            g *= 0.68;
            b *= 0.64;
          }
          const grain = (n - 0.5) * 10;
          r += grain;
          g += grain * 0.9;
          b += grain * 0.8;
        }
        if (cinema) {
          // Talus flecks + lichen wash for alpine close-up read.
          const talus = texHash(x * 2, y * 2, 149);
          if (talus > 0.92) {
            r = lum * (0.62 + talus * 0.2);
            g = lum * (0.6 + talus * 0.18);
            b = lum * (0.55 + talus * 0.16);
          }
          const lichen = texHash((x / 3) | 0, (y / 3) | 0, 151);
          if (lichen > 0.9 && lichen < 0.96) {
            r *= 0.9;
            g *= 1.05;
            b *= 0.85;
          }
        }
      } else if (kind === "lakeside") {
        r = lum * 0.9;
        g = lum * 1.02;
        b = lum * 0.88;
        const wet = texHash((x / 8) | 0, (y / 8) | 0, 13);
        if (wet > 0.72) {
          const k = (wet - 0.72) / 0.28;
          r *= 1 - k * 0.22;
          g *= 1 - k * 0.18;
          b *= 1 - k * 0.15;
        }
        const reed = texHash(x, (y / 12) | 0, 41);
        if (reed > 0.93 && reed < 0.97) {
          r *= 0.75;
          g *= 0.78;
          b *= 0.72;
        }
        if (n2 > 0.88) {
          r *= 0.78;
          g *= 0.82;
          b *= 0.8;
        }
        if (hi) {
          // Shore silt bands + pebble spit + algae freckle.
          const silt = 0.5 + 0.5 * Math.sin(y * 0.18 + x * 0.04);
          r *= 0.96 + silt * 0.06;
          g *= 0.97 + silt * 0.05;
          b *= 0.98 + silt * 0.03;
          const pebble = texHash(x, y, 79);
          if (pebble > 0.97) {
            r = lum * 0.72;
            g = lum * 0.7;
            b = lum * 0.64;
          }
          const algae = texHash((x / 5) | 0, (y / 5) | 0, 83);
          if (algae > 0.88 && algae < 0.94) {
            r *= 0.82;
            g *= 1.08;
            b *= 0.78;
          }
          const grain = (n - 0.5) * 8;
          r += grain;
          g += grain;
          b += grain * 0.9;
        }
        if (cinema) {
          // Wet shoreline sparkle + mud freckle.
          const sparkle = texHash(x, y, 157);
          if (sparkle > 0.985) {
            r += 22;
            g += 24;
            b += 20;
          }
          const mud = texHash((x / 4) | 0, (y / 2) | 0, 163);
          if (mud > 0.88 && mud < 0.93) {
            r *= 0.86;
            g *= 0.84;
            b *= 0.78;
          }
        }
      } else {
        r = lum * 0.92;
        g = lum * 0.98;
        b = lum * 0.84;
        if (n2 > 0.82 && n2 < 0.93) {
          r *= 1.08;
          g *= 0.9;
          b *= 0.7;
        } else if (n2 > 0.93 && n2 < 0.965) {
          const moss = texHash((x / 6) | 0, (y / 6) | 0, 43);
          r *= 0.82;
          g *= 1.08 + moss * 0.06;
          b *= 0.75;
        }
        const litter = texHash(x, y, 47);
        if (litter > 0.92 && litter < 0.945) {
          r *= 0.78;
          g *= 0.72;
          b *= 0.55;
        } else if (litter > 0.97) {
          r *= 0.85;
          g *= 0.88;
          b *= 0.62;
        }
        if (n > 0.94) {
          r *= 0.62;
          g *= 0.74;
          b *= 0.52;
        }
        if (hi) {
          // Denser moss cushions, needle litter streaks, soft soil grain.
          const mossPad = texHash((x / 4) | 0, (y / 4) | 0, 89);
          if (mossPad > 0.78 && mossPad < 0.92) {
            const k = (mossPad - 0.78) / 0.14;
            r *= 1 - k * 0.12;
            g *= 1 + k * 0.1;
            b *= 1 - k * 0.08;
          }
          const needle = texHash(x, (y / 3) | 0, 97);
          if (needle > 0.9 && needle < 0.955) {
            r *= 0.9;
            g *= 0.84;
            b *= 0.68;
          }
          const soil = texHash(x, y, 101);
          if (soil > 0.94) {
            r *= 0.88;
            g *= 0.82;
            b *= 0.7;
          }
          const grain = (n - 0.5) * 9;
          r += grain;
          g += grain * 1.05;
          b += grain * 0.85;
        }
        if (cinema) {
          // Leaf litter flecks + damp soil pits for forest floor close-ups.
          const leaf = texHash(x, y, 167);
          if (leaf > 0.94 && leaf < 0.975) {
            r *= 1.08;
            g *= 0.92;
            b *= 0.7;
          }
          const pit = texHash((x / 2) | 0, (y / 2) | 0, 173);
          if (pit > 0.9 && pit < 0.94) {
            r *= 0.78;
            g *= 0.74;
            b *= 0.62;
          }
        }
      }
      putPx(d, w, x, y, r, g, b);
    }
  }
}

function clampByte(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

function putPx(d, w, x, y, r, g, b) {
  if (x < 0 || y < 0 || x >= w) return;
  const i = (y * w + x) * 4;
  d[i] = clampByte(r);
  d[i + 1] = clampByte(g);
  d[i + 2] = clampByte(b);
  d[i + 3] = 255;
}

function fillRectPx(d, w, h, x0, y0, x1, y1, r, g, b) {
  const xa = Math.max(0, Math.min(x0, x1) | 0);
  const xb = Math.min(w - 1, Math.max(x0, x1) | 0);
  const ya = Math.max(0, Math.min(y0, y1) | 0);
  const yb = Math.min(h - 1, Math.max(y0, y1) | 0);
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) putPx(d, w, x, y, r, g, b);
  }
}

/**
 * Paint one Saturn-readable surface into an ImageData buffer.
 * @param {string} id
 * @param {number} w
 * @param {number} h
 * @param {Uint8ClampedArray} d
 */
function paintSurface(id, w, h, d) {
  if (id === "cobble") {
    fillRectPx(d, w, h, 0, 0, w - 1, h - 1, 42, 38, 34);
    const cols = 7;
    const rows = 12;
    const cw = w / cols;
    const ch = h / rows;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const jitter = texHash(col, row, 9);
        const x0 = col * cw + 1 + jitter * 2;
        const y0 = row * ch + 1 + texHash(row, col, 3) * 2;
        const x1 = (col + 1) * cw - 2;
        const y1 = (row + 1) * ch - 2;
        const shade = 0.72 + texHash(col, row, 21) * 0.28;
        const warm = texHash(col, row, 4);
        const r = (118 + warm * 40) * shade;
        const g = (112 + warm * 22) * shade;
        const b = (102 + warm * 8) * shade;
        fillRectPx(d, w, h, x0, y0, x1, y1, r, g, b);
      }
    }
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const grime = texHash(col, row, 51);
        const mr = 28 + grime * 18;
        const mg = 26 + grime * 14;
        const mb = 22 + grime * 10;
        const mx = (col * cw) | 0;
        const my = (row * ch) | 0;
        fillRectPx(d, w, h, mx, my, mx + 2, my + (ch | 0), mr, mg, mb);
        fillRectPx(d, w, h, mx, my, mx + (cw | 0), my + 2, mr, mg, mb);
      }
    }
    return;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / (w - 1);
      const n = texHash(x, y, 1);
      const n2 = texHash(x, y, 7);
      let r = 120;
      let g = 110;
      let b = 90;

      if (id === "tarmac") {
        r = 48 + n * 22;
        g = 50 + n * 20;
        b = 56 + n * 18;
        if (n2 > 0.94 && n2 < 0.975) {
          const agg = texHash(x, y, 33);
          r += agg * 35;
          g += agg * 32;
          b += agg * 28;
        } else if (n2 > 0.975) {
          r += 28;
          g += 26;
          b += 22;
        }
        const oil = texHash(x >> 3, y >> 3, 39);
        if (oil > 0.78 && oil < 0.88) {
          r -= 18;
          g -= 14;
          b -= 8;
        }
        const rut = Math.min(Math.abs(u - 0.32), Math.abs(u - 0.68));
        if (rut < 0.06) {
          const wear = 1 - rut / 0.06;
          r -= 10 + wear * 8;
          g -= 10 + wear * 8;
          b -= 8 + wear * 6;
        }
        if (Math.abs(u - 0.5) < 0.018 && y % 36 < 16) {
          r = 214;
          g = 186;
          b = 48;
        }
        if ((VISUAL.tier || 0) >= 13 || VISUAL.cinemaRealism) {
          // Bitumen bleed + fine aggregate for photoreal tarmac.
          const bit = texHash(x >> 2, y >> 2, 181);
          if (bit > 0.82 && bit < 0.9) {
            r -= 8;
            g -= 6;
            b -= 2;
          }
          const agg2 = texHash(x, y, 191);
          if (agg2 > 0.96) {
            r += 18;
            g += 16;
            b += 12;
          }
        }
      } else if (id === "gravel") {
        r = 96 + n * 28;
        g = 82 + n * 22;
        b = 58 + n * 16;
        if (n2 > 0.88) {
          const chip = texHash(x, y, 11);
          r = 140 + chip * 70;
          g = 132 + chip * 55;
          b = 118 + chip * 40;
        } else if (n2 > 0.82) {
          const chip = texHash(x, y, 55);
          r = 118 + chip * 40;
          g = 108 + chip * 32;
          b = 92 + chip * 24;
        } else if (n2 < 0.12) {
          r = 62;
          g = 52;
          b = 40;
        }
      } else if (id === "dirt") {
        r = 92 + n * 24;
        g = 54 + n * 16;
        b = 28 + n * 10;
        const streak = Math.sin(u * 18 + y * 0.2) * 10;
        r += streak;
        g += streak * 0.5;
        const rut = Math.min(Math.abs(u - 0.34), Math.abs(u - 0.66));
        if (rut < 0.08) {
          r -= 22;
          g -= 14;
          b -= 8;
        }
        if (n2 > 0.93) {
          r = 70;
          g = 58;
          b = 42;
        }
      } else if (id === "sand") {
        // Packed safari ribbon — darker than the dune wash so the line reads.
        const ripple = Math.sin(y * 0.22 + u * 6) * 6 + Math.sin(y * 0.07) * 3;
        const shimmer = Math.sin(y * 0.045 + u * 2.5) * 4 + Math.sin(y * 0.018) * 2.5;
        r = 108 + n * 14 + ripple + shimmer;
        g = 78 + n * 10 + ripple * 0.55 + shimmer * 0.35;
        b = 42 + n * 7 + ripple * 0.18 + shimmer * 0.12;
        const rut = Math.min(Math.abs(u - 0.33), Math.abs(u - 0.67));
        if (rut < 0.12) {
          r -= 32;
          g -= 24;
          b -= 12;
        }
      } else if (id === "mud") {
        r = 48 + n * 14;
        g = 36 + n * 10;
        b = 24 + n * 8;
        const puddle = texHash(x >> 2, y >> 2, 5);
        if (puddle > 0.62) {
          r = 28 + n * 8;
          g = 32 + n * 10;
          b = 22 + n * 6;
          const edge = texHash(x, y, 45);
          if (edge > 0.88 && edge < 0.93) {
            r += 14;
            g += 10;
            b += 6;
          }
        }
        if (n2 > 0.9) {
          r += 18;
          g += 12;
        }
        const rut = Math.min(Math.abs(u - 0.35), Math.abs(u - 0.65));
        if (rut < 0.1) {
          r -= 8;
          g -= 4;
        }
      } else if (id === "grass") {
        r = 46 + n * 18;
        g = 92 + n * 28;
        b = 36 + n * 12;
        if (n2 > 0.78) {
          r += 20;
          g += 28;
          b += 8;
        }
        const rut = Math.min(Math.abs(u - 0.34), Math.abs(u - 0.66));
        if (rut < 0.11) {
          const k = 1 - rut / 0.11;
          r = r * (1 - k) + (86 + n * 16) * k;
          g = g * (1 - k) + (58 + n * 10) * k;
          b = b * (1 - k) + (28 + n * 8) * k;
        }
      } else {
        r = 96 + n * 20;
        g = 82 + n * 16;
        b = 58 + n * 12;
      }

      putPx(d, w, x, y, r, g, b);
    }
  }

  if (id === "gravel") {
    for (let i = 0; i < 280; i++) {
      const sx = (texHash(i, 3, 19) * w) | 0;
      const sy = (texHash(i, 8, 23) * h) | 0;
      const sizeTier = texHash(i, 7, 53);
      const rad =
        sizeTier > 0.7
          ? (2 + texHash(i, 1, 2) * 2.5) | 0
          : (1 + texHash(i, 1, 2) * 1.5) | 0;
      const light = texHash(i, 4, 6);
      const sr = 110 + light * 90;
      const sg = 102 + light * 70;
      const sb = 88 + light * 50;
      for (let oy = -rad; oy <= rad; oy++) {
        for (let ox = -rad; ox <= rad; ox++) {
          if (ox * ox + oy * oy <= rad * rad) {
            putPx(d, w, sx + ox, (sy + oy + h) % h, sr, sg, sb);
          }
        }
      }
    }
  }
}

/**
 * Procedural normal map for heightmap land — paired with landAlbedoMap.
 * @param {string} scenery
 * @param {number} span
 * @returns {THREE.CanvasTexture|null}
 */
function landNormalMap(scenery, span) {
  if (!VISUAL.realisticArcade) return null;
  const kind = scenery === "desert" || scenery === "mountain" || scenery === "lakeside" ? scenery : "forest";
  const tier = VISUAL.tier || 1;
  const hit = LAND_NORM.get(`${tier}|${kind}`);
  if (hit) {
    const map = hit.clone();
    const tiles = Math.max(28, span / 8.5);
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(tiles, tiles);
    map.needsUpdate = true;
    return map;
  }
  const scale = VISUAL.textureScale || 1;
  const w = 256 * scale;
  const h = 256 * scale;
  const tex = canvasNormalFromPaint(
    (g, ww, hh, data) => paintLandAlbedo(kind, ww, hh, data),
    w,
    h
  );
  if (!tex) return null;
  LAND_NORM.set(`${tier}|${kind}`, tex);
  const map = tex.clone();
  const tiles = Math.max(28, span / 8.5);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(tiles, tiles);
  map.needsUpdate = true;
  return map;
}

/**
 * Build a tangent-space normal map from an RGB height field.
 * @param {Uint8ClampedArray} data
 * @param {number} w
 * @param {number} h
 * @param {number} [strength]
 */
function normalFromImageData(data, w, h, strength) {
  const out = new Uint8ClampedArray(w * h * 4);
  const s = strength ?? VISUAL.normalStrength ?? 0.85;
  const lum = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return 0.5;
    const i = (y * w + x) * 4;
    return (data[i] + data[i + 1] + data[i + 2]) / (3 * 255);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (lum(x + 1, y) - lum(x - 1, y)) * s;
      const dy = (lum(x, y + 1) - lum(x, y - 1)) * s;
      let nx = -dx;
      let ny = -dy;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * w + x) * 4;
      out[i] = (nx * 0.5 + 0.5) * 255;
      out[i + 1] = (ny * 0.5 + 0.5) * 255;
      out[i + 2] = (nz * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

/**
 * @param {(g: CanvasRenderingContext2D, w: number, h: number, data: Uint8ClampedArray) => void} paintFn
 * @param {number} w
 * @param {number} h
 * @param {number} [strength]
 */
function canvasNormalFromPaint(paintFn, w, h, strength) {
  const scale = VISUAL.normalMapScale ?? 0.5;
  const nw = Math.max(64, Math.round(w * scale));
  const nh = Math.max(64, Math.round(h * scale));
  const c = document.createElement("canvas");
  c.width = nw;
  c.height = nh;
  const g = c.getContext("2d");
  const img = g.createImageData(nw, nh);
  paintFn(g, nw, nh, img.data);
  const norm = normalFromImageData(img.data, nw, nh, strength);
  const nc = document.createElement("canvas");
  nc.width = nw;
  nc.height = nh;
  nc.getContext("2d").putImageData(new ImageData(norm, nw, nh), 0, 0);
  const tex = new THREE.CanvasTexture(nc);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  tex.userData.shared = true;
  return tex;
}

/**
 * Cached normal map for one driving surface ribbon.
 * @param {string} id
 * @returns {THREE.CanvasTexture|null}
 */
function roadNormalFor(id) {
  if (!VISUAL.realisticArcade) return null;
  const key = SURFACES[id] ? id : "dirt";
  const hit = ROAD_NORM.get(key);
  if (hit) return hit;
  const texScale = VISUAL.textureScale || 1;
  const w = 128 * texScale;
  const h = 256 * texScale;
  const tex = canvasNormalFromPaint((g, ww, hh, data) => paintSurface(key, ww, hh, data), w, h);
  ROAD_NORM.set(key, tex);
  return tex;
}

/**
 * Cached repeating canvas texture for one driving surface.
 * @param {string} id
 */
function roadTextureFor(id) {
  const key = SURFACES[id] ? id : "dirt";
  const tier = VISUAL.tier || 1;
  const cacheKey = `t${tier}|${key}`;
  const hit = ROAD_TEX.get(cacheKey);
  if (hit) return hit;
  const texScale = VISUAL.textureScale || 1;
  const w = 128 * texScale;
  const h = 256 * texScale;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  const img = g.createImageData(w, h);
  paintSurface(key, w, h, img.data);
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  tex.userData.shared = true;
  ROAD_TEX.set(cacheKey, tex);
  return tex;
}

/** @type {Map<string, THREE.CanvasTexture>} */
const ROAD_AO = new Map();

/**
 * Cheap cavity map from road albedo — darkens ruts and aggregate without a bake pass.
 * @param {string} id
 * @returns {THREE.CanvasTexture|null}
 */
function roadAoFor(id) {
  if (!VISUAL.realisticArcade || (VISUAL.tier || 0) < 3) return null;
  const key = SURFACES[id] ? id : "dirt";
  const tier = VISUAL.tier || 3;
  const cacheKey = `t${tier}|${key}`;
  const hit = ROAD_AO.get(cacheKey);
  if (hit) return hit;
  const texScale = VISUAL.textureScale || 1;
  const w = 128 * texScale;
  const h = 256 * texScale;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  const img = g.createImageData(w, h);
  paintSurface(key, w, h, img.data);
  for (let i = 0; i < img.data.length; i += 4) {
    const lum = (img.data[i] + img.data[i + 1] + img.data[i + 2]) / (3 * 255);
    const ao = Math.pow(1 - lum, 1.35);
    const v = (ao * 255) | 0;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  tex.userData.shared = true;
  ROAD_AO.set(cacheKey, tex);
  return tex;
}

/** @type {Map<string, THREE.CanvasTexture>} */
const ROAD_ROUGH = new Map();

/**
 * Procedural roughness for UE5-style PBR (Sprint 25) — dark = smoother.
 * @param {string} id
 * @returns {THREE.CanvasTexture|null}
 */
function roadRoughFor(id) {
  if (!VISUAL.realisticArcade || VISUAL.roughnessMaps === false || (VISUAL.tier || 0) < 10) return null;
  const key = SURFACES[id] ? id : "dirt";
  const tier = VISUAL.tier || 10;
  const cacheKey = `rough|t${tier}|${key}`;
  const hit = ROAD_ROUGH.get(cacheKey);
  if (hit) return hit;
  const texScale = Math.max(1, (VISUAL.textureScale || 1) * 0.5);
  const w = Math.max(64, (128 * texScale) | 0);
  const h = Math.max(128, (256 * texScale) | 0);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  const img = g.createImageData(w, h);
  paintSurface(key, w, h, img.data);
  const base = key === "tarmac" || key === "cobble" ? 0.22 : key === "gravel" ? 0.7 : 0.82;
  for (let i = 0; i < img.data.length; i += 4) {
    const lum = (img.data[i] + img.data[i + 1] + img.data[i + 2]) / (3 * 255);
    // Specular flecks on bright aggregate; darker ruts stay rough.
    let r = base + (1 - lum) * 0.45 + (lum - 0.5) * 0.12;
    r = Math.max(0.08, Math.min(0.98, r));
    const v = (r * 255) | 0;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  tex.userData.shared = true;
  ROAD_ROUGH.set(cacheKey, tex);
  return tex;
}

/** @type {Map<string, THREE.CanvasTexture>} */
const LAND_ROUGH = new Map();

/**
 * Land roughness from albedo — sand softer, rock flecks harder.
 * @param {string} scenery
 * @param {number} span
 * @returns {THREE.CanvasTexture|null}
 */
function landRoughnessMap(scenery, span) {
  if (!VISUAL.realisticArcade || VISUAL.roughnessMaps === false || (VISUAL.tier || 0) < 10) return null;
  const kind = scenery === "desert" || scenery === "mountain" || scenery === "lakeside" ? scenery : "forest";
  const tier = VISUAL.tier || 10;
  const cacheKey = `land-rough|t${tier}|${kind}`;
  const hit = LAND_ROUGH.get(cacheKey);
  if (hit) {
    const map = hit.clone();
    const tiles = Math.max(28, span / 8.5);
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(tiles, tiles);
    map.userData.shared = true;
    return map;
  }
  const scale = Math.max(1, ((VISUAL.textureScale || 1) * 0.5) | 0);
  const w = 128 * scale;
  const h = 128 * scale;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  const img = g.createImageData(w, h);
  paintLandAlbedo(kind, w, h, img.data);
  const base = kind === "desert" ? 0.88 : kind === "mountain" ? 0.72 : kind === "lakeside" ? 0.78 : 0.9;
  for (let i = 0; i < img.data.length; i += 4) {
    const lum = (img.data[i] + img.data[i + 1] + img.data[i + 2]) / (3 * 255);
    let r = base + (0.5 - lum) * 0.35;
    r = Math.max(0.2, Math.min(0.98, r));
    const v = (r * 255) | 0;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  tex.userData.shared = true;
  LAND_ROUGH.set(cacheKey, tex);
  const map = tex.clone();
  const tiles = Math.max(28, span / 8.5);
  map.repeat.set(tiles, tiles);
  map.userData.shared = true;
  return map;
}

/** Checkered paint on the road under the gantry. */
function checkStripeTexture() {
  if (STRIPE_TEX) return STRIPE_TEX;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d");
  const cell = 16;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 16; x++) {
      g.fillStyle = (x + y) % 2 === 0 ? "#1a1a1a" : "#f0f0ea";
      g.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  STRIPE_TEX = new THREE.CanvasTexture(c);
  STRIPE_TEX.magFilter = THREE.NearestFilter;
  STRIPE_TEX.minFilter = THREE.NearestFilter;
  STRIPE_TEX.needsUpdate = true;
  STRIPE_TEX.userData.shared = true;
  return STRIPE_TEX;
}

function mulberry(seed) {
  let s = seed | 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
