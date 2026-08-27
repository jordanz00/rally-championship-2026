/**
 * Championship courses — Desert (easy), Forest (medium), Mountain (hard),
 * Lakeside (bonus).
 *
 * WHO THIS IS FOR: anyone editing stage layout or surface changes.
 * WHAT IT DOES: piece lists with long surface bands (sand, gravel, dirt, mud,
 *   cobble, tarmac) and short blend zones via surfaceOut — not a new texture
 *   every corner.
 * HOW IT CONNECTS: game.js instantiates Track from these defs. Track.query
 *   feeds the surface straight into the tire model, so a surface band here IS a
 *   handling change: see the SURFACES table in js/config.js for what each one
 *   does to braking distance, slide entry, and recovery.
 *
 * STAGE RAMP: the three championship stages get LONGER as they get harder
 * (Desert ~75 s, Forest ~90 s, Mountain ~105 s for a clean lap). Difficulty is
 * carried by corner radius and surface, but length is what makes Mountain feel
 * like the end of a championship rather than another circuit.
 *
 * CHECKPOINT BUDGET (docs/AM3-RESEARCH.md §3): six checkpoints split UNEVENLY
 * across the first three courses — Desert 1, Forest 2, Mountain 3. The split is
 * uneven because it follows stage LENGTH, not stage count: a checkpoint exists
 * to buy back time proportional to how much driving is left, which works out to
 * roughly one per 35-40 s of lap. Lakeside is a bonus stage outside that budget
 * and carries 2 of its own.
 *
 * SIGN CONVENTION: positive `angle` bends left, negative bends right. This has
 * to match Track.noteAt, which calls a positive heading change "LEFT" — get it
 * backwards and the co-driver reads every corner the wrong way.
 */

import { COLORS } from "../config.js?v=148";

export const COURSES = {
  /**
   * DESERT — Safari rally reference. Wide, generous, long easy turns, dry dirt
   * shading into darker wet mud, a few jumps. The shortest stage: it is the
   * teaching stage, so it says what it needs to and stops.
   *
   * TEACHING ORDER, and it is deliberate:
   *  1. A long opening straight to find top gear.
   *  2. TWO deliberately shallow, wide turns. Flat out, huge runoff, nothing to
   *     punish you. This is where a new player learns that steering at speed in
   *     3D is something you aim, not something you snap.
   *  3. A forgiving jump, then a snaky gravel corridor: the first real work.
   *  4. A jump PAIR close enough that the second arrives while the car is still
   *     unsettled from the first — "teetering on the edge of control".
   *  5. The tunnel, then the wet mud band. Mud is where the brake pedal stops
   *     being a brake and starts being a drift button.
   *  6. THE BOWL — a wide open right hairpin with a braking flare and sand
   *     runoff: the first place you can choose a grip line or throw it.
   *  7. THE LONG EASY RIGHT: open ground, full width, 145 m radius held for
   *     78° — a speed-drift sweeper, with the outside embankment to lean on.
   *  8. LINKED HAIRPINS on gravel: right, a gulp of throttle, then left. The
   *     second one arrives while the car is still rotating from the first.
   */
  desert: {
    id: "desert",
    name: "DESERT",
    subtitle: "EASY  ·  SAFARI  ·  TUNNEL",
    difficulty: "easy",
    fog: COLORS.fogDesert,
    sky: 0xe2d2a8,
    offroad: "sand",
    scenery: "desert",
    startWidth: 16,
    startY: 0,
    seed: 11,
    barriers: false,
    pieces: [
      { type: "straight", length: 190, surface: "sand", width: 16 },

      // --- Act 1: the two teaching turns. Shallow, wide, flat out.
      { type: "curve", radius: 132, angle: 30, surface: "sand", width: 16 },
      { type: "straight", length: 58, surface: "sand", width: 16 },
      { type: "curve", radius: 120, angle: -28, surface: "sand", width: 16 },
      { type: "straight", length: 92, surface: "sand", width: 16 },

      // First jump: short hop — teaches the crest without a big throw.
      { type: "jump", ramp: 22, rise: 2.2, lip: 5, gap: 12, drop: 1.6, land: 24, surface: "sand", width: 16 },
      { type: "straight", length: 66, surface: "sand", surfaceOut: "gravel", width: 15 },

      // --- Act 2: snaky gravel corridor. Narrower, alternating, real work.
      { type: "curve", radius: 54, angle: 56, surface: "gravel", width: 13 },
      { type: "straight", length: 52, surface: "gravel", width: 12 },
      { type: "curve", radius: 42, angle: -64, surface: "gravel", width: 12 },
      { type: "straight", length: 44, surface: "gravel", width: 11 },
      { type: "curve", radius: 36, angle: 74, surface: "gravel", width: 11 },
      { type: "straight", length: 54, surface: "gravel", surfaceOut: "sand", width: 14 },

      // Jump pair: medium then big Safari throw — heights must read different.
      { type: "jump", ramp: 20, rise: 3.0, lip: 6, gap: 16, drop: 2.2, land: 18, surface: "sand", width: 15 },
      { type: "straight", length: 34, surface: "sand", width: 15 },
      { type: "jump", ramp: 30, rise: 5.2, lip: 8, gap: 26, drop: 3.6, land: 52, surface: "sand", width: 15 },

      // Long flat after the Safari throw so a fast landing stays on sand,
      // not inside the climb / tunnel.
      { type: "straight", length: 72, surface: "sand", width: 15, checkpoint: true },
      { type: "curve", radius: 80, angle: 44, surface: "sand", width: 14, dy: 5 },
      { type: "straight", length: 48, surface: "sand", surfaceOut: "dirt", width: 12, dy: 6 },

      // --- Act 3: the tunnel. Close walls, no sky, engine note changes.
      { type: "straight", length: 40, surface: "dirt", width: 10, dy: 2, tunnel: true },
      { type: "curve", radius: 42, angle: -40, surface: "dirt", tunnel: true },
      { type: "straight", length: 78, surface: "dirt", width: 10.5, tunnel: true },
      { type: "curve", radius: 46, angle: 52, surface: "dirt", tunnel: true },
      { type: "straight", length: 58, surface: "dirt", width: 10.5, tunnel: true },
      { type: "curve", radius: 42, angle: -44, surface: "dirt", surfaceOut: "mud", tunnel: true },

      // --- Act 4: dry dirt shades into darker WET MUD out of the tunnel. Two
      // corners on it, so you have to discover that braking here rotates you
      // instead of stopping you — and then use that on the second one.
      { type: "straight", length: 54, surface: "mud", width: 11 },
      { type: "curve", radius: 46, angle: 58, surface: "mud", width: 11 },
      { type: "straight", length: 42, surface: "mud", width: 11 },
      { type: "curve", radius: 40, angle: -62, surface: "mud", width: 11 },
      { type: "straight", length: 60, surface: "mud", surfaceOut: "sand", width: 14 },

      { type: "jump", ramp: 28, rise: 4.2, lip: 7, gap: 22, drop: 3.0, land: 26, surface: "sand", width: 15 },
      { type: "straight", length: 44, surface: "sand", width: 16 },

      // --- Act 5: THE BOWL. Approach at speed, flare the road, brake, rotate
      // through a wide right hairpin, sand runoff if you miss. Type C open
      // hairpin — grip line or drift line, both fit.
      { type: "straight", length: 38, surface: "sand", width: 18, dy: -1.2 },
      { type: "curve", radius: 44, angle: -165, surface: "sand", width: 19, landmark: true },
      { type: "straight", length: 42, surface: "sand", width: 17 },
      { type: "straight", length: 56, surface: "sand", width: 16 },

      // --- Act 6: THE LONG EASY RIGHT. Open ground, full width, 145 m radius
      // held for 78° — long enough that you cannot steer your way round it and
      // have to commit to a slide, with the outside embankment to lean on.
      { type: "curve", radius: 145, angle: -78, surface: "sand", width: 16, dy: -2, sweep: true },
      { type: "straight", length: 52, surface: "sand", width: 16 },

      // --- Act 7: LINKED HAIRPINS. Gravel so the slide is the default, not a
      // stunt. Right, short accel, left — the second asks for a transition.
      { type: "straight", length: 24, surface: "sand", surfaceOut: "gravel", width: 16 },
      { type: "curve", radius: 38, angle: -148, surface: "gravel", width: 16, landmark: true },
      { type: "straight", length: 30, surface: "gravel", width: 15 },
      { type: "curve", radius: 38, angle: 148, surface: "gravel", width: 16, landmark: true },
      { type: "straight", length: 28, surface: "gravel", surfaceOut: "sand", width: 16 },
      { type: "straight", length: 96, surface: "sand", width: 16 },

      // --- Act 8 (Sprint 40 WRC extension): long run home — flat sand straight,
      // crest jump, final checkpoint, stadium finish straight.
      { type: "straight", length: 120, surface: "sand", width: 17, checkpoint: true },
      { type: "curve", radius: 160, angle: 42, surface: "sand", width: 17, sweep: true },
      { type: "straight", length: 88, surface: "sand", width: 17 },
      { type: "jump", ramp: 18, rise: 1.8, lip: 4, gap: 10, drop: 1.2, land: 28, surface: "sand", width: 17 },
      { type: "straight", length: 140, surface: "sand", width: 18 },
    ],
  },

  /**
   * FOREST — wide autumn glades built for slides, not tree-corridor grind.
   * Shorter lap (~1.35 km): opening sweeps, crest jump, then three committed
   * drift moments — Glade Bowl, Long Sweep, linked mud hairpins — sprint home.
   */
  forest: {
    id: "forest",
    name: "FOREST",
    subtitle: "MEDIUM  ·  GLADE DRIFTS  ·  AUTUMN CLEARING",
    difficulty: "medium",
    fog: COLORS.fogForest,
    sky: 0x6aa8d4,
    offroad: "grass",
    scenery: "forest",
    startWidth: 14,
    startY: 2,
    seed: 37,
    barriers: false,
    pieces: [
      // --- Act 1: fast opening — open dirt sweeps, room to build speed.
      { type: "straight", length: 62, surface: "dirt", width: 14.2, dy: 1 },
      { type: "curve", radius: 78, angle: 46, surface: "dirt", width: 14 },
      { type: "straight", length: 44, surface: "dirt", width: 13.8 },
      { type: "curve", radius: 62, angle: -40, surface: "dirt", width: 13.6, surfaceOut: "gravel" },

      // --- Act 2: crest jump + flowing chicane into checkpoint meadow.
      { type: "straight", length: 38, surface: "gravel", width: 14.2 },
      { type: "jump", ramp: 14, rise: 2.4, lip: 5, gap: 11, drop: 1.4, land: 30, surface: "gravel", width: 14.6 },
      { type: "straight", length: 52, surface: "gravel", width: 14.4 },
      { type: "curve", radius: 102, angle: 26, surface: "gravel", width: 14.2 },
      { type: "curve", radius: 94, angle: -32, surface: "gravel", width: 14 },
      { type: "straight", length: 46, surface: "gravel", width: 14, checkpoint: true },

      // --- Act 3: THE GLADE BOWL — clearing opens, wide right hairpin, drift room.
      { type: "straight", length: 44, surface: "dirt", width: 16.8, dy: -1 },
      { type: "curve", radius: 48, angle: -172, surface: "dirt", width: 17.5, landmark: true },
      { type: "straight", length: 40, surface: "dirt", width: 16.2 },

      // --- Act 4: THE LONG SWEEP — full-width gravel right, commit to the slide.
      { type: "curve", radius: 132, angle: -82, surface: "gravel", width: 16.8, dy: -1.2, sweep: true },
      { type: "straight", length: 38, surface: "gravel", width: 16.4 },

      // --- Act 5: LINKED HAIRPINS — mud belt, throttle transitions right then left.
      { type: "straight", length: 22, surface: "gravel", surfaceOut: "mud", width: 15.8 },
      { type: "curve", radius: 42, angle: -158, surface: "mud", width: 15.2, landmark: true },
      { type: "straight", length: 28, surface: "mud", width: 15 },
      { type: "curve", radius: 42, angle: 152, surface: "mud", width: 15.2, landmark: true },
      { type: "straight", length: 32, surface: "mud", surfaceOut: "dirt", width: 15.6 },

      // --- Act 6: sprint home through the autumn clearing.
      { type: "straight", length: 86, surface: "dirt", width: 16.2 },
    ],
  },

  /**
   * MOUNTAIN — Tour de Corse reference. TARMAC and hairpins, with a cobbled
   * village in the middle. Tarmac is where braking is a wall and the slide has
   * to be earned, which is exactly the opposite lesson to Desert.
   *
   * The longest and hardest stage, and it is relentless by design: nine hairpins
   * of 15-22 m radius, so there is almost no rest and the clock is always close.
   * Three checkpoints, spread evenly, are what make it survivable. It ends on
   * tarmac after a gravel drift exam in the last kilometre.
   *
   * Act 5–7 (Sprint 6): gravel Bowl, long sweep, linked hairpins — the grip you
   * trusted all stage disappears for one last slide-or-fail sequence.
   */
  mountain: {
    id: "mountain",
    name: "MOUNTAIN",
    subtitle: "HARD  ·  TOUR DE CORSE  ·  TARMAC",
    difficulty: "hard",
    fog: COLORS.fogMountain,
    sky: 0x5a9ad4,
    offroad: "grass",
    scenery: "mountain",
    startWidth: 9,
    startY: 8,
    seed: 44,
    barriers: false,
    pieces: [
      { type: "straight", length: 88, surface: "tarmac", width: 9, dy: 4 },
      { type: "curve", radius: 18, angle: 160, surface: "tarmac", dy: 2 },
      { type: "straight", length: 62, surface: "tarmac", width: 9, dy: 3 },
      { type: "curve", radius: 16, angle: -170, surface: "tarmac", dy: 1 },
      { type: "straight", length: 58, surface: "tarmac", width: 9, dy: -2 },
      { type: "curve", radius: 24, angle: 90, surface: "tarmac" },
      { type: "straight", length: 74, surface: "tarmac", width: 8.5 },

      // A fast pair before the next hairpin: on tarmac these are grip corners,
      // not slides, which is the whole point of the surface change from Desert.
      { type: "curve", radius: 58, angle: -44, surface: "tarmac", width: 9, dy: 3 },
      { type: "straight", length: 66, surface: "tarmac", width: 9, dy: 4 },
      { type: "curve", radius: 46, angle: 54, surface: "tarmac", width: 9, dy: 2 },
      { type: "straight", length: 58, surface: "tarmac", width: 8.5 },

      { type: "curve", radius: 15, angle: -155, surface: "tarmac", dy: -3, checkpoint: true },
      { type: "straight", length: 68, surface: "tarmac", width: 9, dy: -4 },
      { type: "jump", ramp: 14, rise: 1.6, lip: 4, gap: 9, drop: 1.2, land: 28, surface: "tarmac", width: 10 },
      { type: "straight", length: 52, surface: "tarmac", width: 9.6 },
      { type: "curve", radius: 24, angle: 132, surface: "tarmac", width: 9.2 },
      { type: "straight", length: 48, surface: "tarmac", width: 9, dy: 3 },
      { type: "curve", radius: 34, angle: -62, surface: "tarmac", width: 9, dy: 2 },
      { type: "straight", length: 56, surface: "tarmac", surfaceOut: "cobble", width: 8.5 },

      // --- The village. Cobbles stop nearly as well as tarmac but the stones
      // steer you while you do it, so the same braking point is suddenly busy.
      { type: "curve", radius: 18, angle: -130, surface: "cobble" },
      { type: "straight", length: 50, surface: "cobble", width: 9, dy: 5 },
      { type: "curve", radius: 17, angle: 145, surface: "cobble", dy: 2 },
      { type: "straight", length: 46, surface: "cobble", width: 8.6, checkpoint: true },
      { type: "curve", radius: 21, angle: -108, surface: "cobble", dy: 1 },
      { type: "straight", length: 58, surface: "cobble", width: 8.6, dy: 2 },
      { type: "curve", radius: 19, angle: 122, surface: "cobble", dy: 1 },
      { type: "straight", length: 44, surface: "cobble", surfaceOut: "tarmac", width: 8 },

      // --- The descent. Downhill hairpins, so the brakes are working against
      // gravity and the front is light on entry. Same radius as the climb, much
      // harder to stop for.
      { type: "curve", radius: 22, angle: 96, surface: "tarmac", dy: -2 },
      { type: "straight", length: 78, surface: "tarmac", width: 8.5, dy: -4 },
      { type: "curve", radius: 17, angle: -150, surface: "tarmac", dy: -1 },
      { type: "straight", length: 64, surface: "tarmac", width: 9, dy: -2 },
      { type: "curve", radius: 40, angle: 58, surface: "tarmac", width: 9 },
      { type: "straight", length: 62, surface: "tarmac", width: 9, checkpoint: true },
      { type: "curve", radius: 16, angle: -158, surface: "tarmac", dy: -2 },
      { type: "straight", length: 72, surface: "tarmac", width: 9, dy: -3 },
      { type: "curve", radius: 19, angle: 132, surface: "tarmac", dy: -1 },
      { type: "straight", length: 52, surface: "tarmac", width: 9, dy: -2 },
      { type: "curve", radius: 52, angle: -48, surface: "tarmac", width: 9 },
      { type: "straight", length: 46, surface: "tarmac", surfaceOut: "gravel", width: 8 },

      // --- Act 5: CORSE GRAVEL BOWL. Wide right on loose stone — tarmac habits
      // do not work here; brake to rotate, not to stop.
      { type: "straight", length: 32, surface: "gravel", width: 10, dy: -2 },
      { type: "curve", radius: 36, angle: -158, surface: "gravel", width: 10.5, landmark: true },
      { type: "straight", length: 36, surface: "gravel", width: 10.2 },

      // --- Act 6: LONG GRAVEL SWEEP. Downhill right — commit to the slide.
      { type: "curve", radius: 108, angle: -68, surface: "gravel", width: 10, dy: -1, sweep: true },
      { type: "straight", length: 40, surface: "gravel", width: 9.8 },

      // --- Act 7: LINKED GRAVEL HAIRPINS. Right then left while still rotating.
      { type: "straight", length: 20, surface: "gravel", width: 9.6 },
      { type: "curve", radius: 32, angle: -140, surface: "gravel", width: 9.5, landmark: true },
      { type: "straight", length: 24, surface: "gravel", width: 9.4 },
      { type: "curve", radius: 32, angle: 138, surface: "gravel", width: 9.5, landmark: true },
      { type: "straight", length: 28, surface: "gravel", surfaceOut: "tarmac", width: 9.2, dy: -2 },
      { type: "curve", radius: 30, angle: 50, surface: "tarmac", width: 9 },
      { type: "straight", length: 96, surface: "tarmac", width: 9 },

      // --- Act 8 (Sprint 40): WRC finale — downhill tarmac sprint + cobble chicane.
      { type: "straight", length: 88, surface: "tarmac", width: 9.2, checkpoint: true, dy: -2 },
      { type: "curve", radius: 44, angle: -62, surface: "tarmac", width: 9, sweep: true },
      { type: "straight", length: 56, surface: "tarmac", width: 9 },
      { type: "curve", radius: 20, angle: 118, surface: "cobble", width: 8.8, landmark: true },
      { type: "straight", length: 72, surface: "cobble", surfaceOut: "tarmac", width: 9 },
      { type: "straight", length: 104, surface: "tarmac", width: 9.5 },
    ],
  },

  /**
   * LAKESIDE — the bonus stage, northern Europe in autumn colour. Unlocked only
   * by finishing Mountain in 1st. Fast, flowing tarmac with a cobbled lakeside
   * section: the reward for beating Mountain is a stage that lets you use the
   * grip instead of fighting for it. Two checkpoints of its own, outside the
   * six-checkpoint championship budget.
   */
  lakeside: {
    id: "lakeside",
    name: "LAKESIDE",
    subtitle: "BONUS  ·  1st AFTER MOUNTAIN",
    difficulty: "bonus",
    fog: COLORS.fogLakeside,
    sky: 0x8eb4c4,
    offroad: "grass",
    scenery: "lakeside",
    startWidth: 10,
    startY: 1,
    seed: 61,
    barriers: true,
    pieces: [
      { type: "straight", length: 92, surface: "tarmac", width: 10 },
      { type: "jump", ramp: 24, rise: 3.8, lip: 7, gap: 18, drop: 2.6, land: 22, surface: "tarmac", width: 10 },
      { type: "curve", radius: 48, angle: 40, surface: "tarmac" },
      { type: "straight", length: 64, surface: "tarmac", width: 9 },
      { type: "curve", radius: 26, angle: -95, surface: "tarmac" },
      { type: "straight", length: 52, surface: "tarmac", width: 10, dy: 2 },
      { type: "curve", radius: 32, angle: 70, surface: "tarmac" },
      { type: "straight", length: 78, surface: "tarmac", width: 10 },
      { type: "curve", radius: 56, angle: -52, surface: "tarmac", width: 10 },
      { type: "straight", length: 58, surface: "tarmac", width: 9, checkpoint: true },
      { type: "curve", radius: 30, angle: 88, surface: "tarmac", dy: 2 },
      { type: "straight", length: 66, surface: "tarmac", surfaceOut: "cobble", width: 9 },

      { type: "curve", radius: 20, angle: -130, surface: "cobble", dy: -1 },
      { type: "straight", length: 54, surface: "cobble", width: 8.6, dy: -1 },
      { type: "curve", radius: 55, angle: 55, surface: "cobble", dy: 1 },
      { type: "straight", length: 48, surface: "cobble", width: 9, dy: 1 },
      { type: "curve", radius: 26, angle: -84, surface: "cobble" },
      { type: "straight", length: 62, surface: "cobble", width: 9 },
      { type: "curve", radius: 62, angle: 46, surface: "cobble", dy: 1 },
      { type: "straight", length: 54, surface: "cobble", surfaceOut: "tarmac", width: 9 },

      { type: "curve", radius: 24, angle: -80, surface: "tarmac" },
      { type: "straight", length: 62, surface: "tarmac", width: 10, dy: 1, checkpoint: true },
      { type: "curve", radius: 38, angle: 62, surface: "tarmac" },
      { type: "jump", ramp: 20, rise: 3.2, lip: 6, gap: 15, drop: 2.2, land: 18, surface: "tarmac", width: 10 },
      { type: "straight", length: 58, surface: "tarmac", width: 10 },
      { type: "curve", radius: 28, angle: -70, surface: "tarmac" },
      { type: "straight", length: 104, surface: "tarmac", width: 10 },
      { type: "curve", radius: 44, angle: 48, surface: "tarmac" },
      { type: "straight", length: 72, surface: "tarmac", width: 10 },
      { type: "curve", radius: 34, angle: -64, surface: "tarmac" },
      { type: "straight", length: 70, surface: "tarmac", width: 10 },
      { type: "curve", radius: 40, angle: 45, surface: "tarmac" },
      { type: "straight", length: 110, surface: "tarmac" },
    ],
  },
};

/** Championship order. Lakeside is appended only after a 1st on Mountain. */
export const COURSE_ORDER = ["desert", "forest", "mountain"];
