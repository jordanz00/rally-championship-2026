/**
 * Championship courses — Desert (easy), Forest (medium), Mountain (hard),
 * Lakeside (bonus), Phys Lab (dev torture).
 *
 * WHO THIS IS FOR: anyone editing stage layout or surface changes.
 * WHAT IT DOES: All championship stages compile from TrackDefinition segments
 *   (Pass 1). Phys lab remains a short piece list for handling dials.
 * HOW IT CONNECTS: game.js instantiates Track from these defs. Track.query
 *   feeds the surface straight into the tire model.
 *
 * AUTHORING RULE: Edit js/tracks/stages/*-definition.js — not raw pieces here.
 *   See docs/WORLD_GEOMETRY_RULES.md and track-definition.js.
 *
 * CHECKPOINT BUDGET (docs/AM3-RESEARCH.md §3): Desert 1+, Forest 2, Mountain 3.
 *
 * SIGN CONVENTION: positive `angle` bends left, negative bends right.
 */

import { COLORS } from "../config.js?v=207";
import { compileTrackDefinition } from "./track-definition.js?v=2";
import { validateCourseData } from "./stage-data-validate.js?v=1";
import { DESERT_DEFINITION } from "./stages/desert-definition.js?v=2";
import { FOREST_DEFINITION } from "./stages/forest-definition.js?v=2";
import { MOUNTAIN_DEFINITION } from "./stages/mountain-definition.js?v=2";
import { LAKESIDE_DEFINITION } from "./stages/lakeside-definition.js?v=2";

/**
 * Compile + fail-fast gate for a TrackDefinition.
 * @param {object} definition
 * @param {string} label
 * @returns {object}
 */
function mountDefinition(definition, label) {
  const course = compileTrackDefinition(definition);
  const gate = validateCourseData(course);
  if (!gate.ok) {
    throw new Error(
      `${label} TrackDefinition failed quality gate: ${gate.errors.map((e) => e.message).join("; ")}`
    );
  }
  return course;
}

const DESERT_COURSE = mountDefinition(DESERT_DEFINITION, "Desert");
const FOREST_COURSE = mountDefinition(FOREST_DEFINITION, "Forest");
const MOUNTAIN_COURSE = mountDefinition(MOUNTAIN_DEFINITION, "Mountain");
const LAKESIDE_COURSE = mountDefinition(LAKESIDE_DEFINITION, "Lakeside");

export const COURSES = {
  desert: DESERT_COURSE,
  forest: FOREST_COURSE,
  mountain: MOUNTAIN_COURSE,
  lakeside: LAKESIDE_COURSE,

  /**
   * PHYS LAB — Stage 4 torture track for handling dials (not championship).
   * Rhythm: hairpin → gravel → jump → downhill → S → sweeper → mud → jump → hairpin.
   * See docs/SEGA_RALLY_DRIVING_MODEL.md. Enable overlay with ?physlab=1 / F8.
   */
  physlab: {
    id: "physlab",
    name: "PHYS LAB",
    subtitle: "DEV  ·  TORTURE  ·  HANDLING",
    difficulty: "lab",
    fog: COLORS.fogDesert,
    sky: 0xc8b898,
    offroad: "dirt",
    scenery: "desert",
    startWidth: 14,
    startY: 0,
    seed: 77,
    barriers: false,
    pieces: [
      { type: "straight", length: 88, surface: "tarmac", width: 14 },
      { type: "curve", radius: 16, angle: -145, surface: "tarmac", surfaceOut: "gravel", width: 13 },
      { type: "straight", length: 42, surface: "gravel", width: 13 },
      {
        type: "jump",
        ramp: 20,
        rise: 2.8,
        lip: 6,
        gap: 14,
        drop: 2.0,
        land: 22,
        surface: "gravel",
        width: 13,
      },
      { type: "straight", length: 36, surface: "gravel", width: 13 },
      { type: "straight", length: 72, surface: "gravel", surfaceOut: "dirt", width: 12, dy: -7 },
      { type: "curve", radius: 28, angle: 55, surface: "dirt", width: 12 },
      { type: "straight", length: 28, surface: "dirt", width: 12 },
      { type: "curve", radius: 26, angle: -58, surface: "dirt", width: 12 },
      { type: "straight", length: 32, surface: "dirt", width: 12, checkpoint: true },
      { type: "curve", radius: 78, angle: 78, surface: "dirt", surfaceOut: "sand", width: 14 },
      { type: "straight", length: 56, surface: "sand", surfaceOut: "mud", width: 13 },
      { type: "curve", radius: 34, angle: -70, surface: "mud", width: 12 },
      { type: "straight", length: 48, surface: "mud", width: 12 },
      { type: "curve", radius: 22, angle: 95, surface: "mud", width: 12 },
      { type: "straight", length: 40, surface: "mud", surfaceOut: "dirt", width: 12 },
      {
        type: "jump",
        ramp: 22,
        rise: 3.4,
        lip: 6,
        gap: 16,
        drop: 2.4,
        land: 24,
        surface: "dirt",
        width: 13,
      },
      { type: "straight", length: 38, surface: "dirt", width: 13 },
      { type: "curve", radius: 15, angle: 150, surface: "dirt", surfaceOut: "tarmac", width: 12 },
      { type: "straight", length: 96, surface: "tarmac", width: 14 },
    ],
  },
};

/** Championship order. Lakeside is appended only after a 1st on Mountain. */
export const COURSE_ORDER = ["desert", "forest", "mountain"];

/**
 * Resolve a course def (future: more TrackDefinition compiles).
 * @param {string} id
 * @returns {object|undefined}
 */
export function resolveCourse(id) {
  return COURSES[id];
}
