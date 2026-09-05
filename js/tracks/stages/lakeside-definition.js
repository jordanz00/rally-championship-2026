/**
 * LAKESIDE — hand-migrated TrackDefinition (Pass 1).
 *
 * WHO THIS IS FOR: stage design; compiles via track-definition.js → pieces.
 * WHAT IT DOES: Preserves championship layout while using shared authoring.
 * HOW IT CONNECTS: courses.js mounts compileTrackDefinition(LAKESIDE_DEFINITION).
 *
 * Geometry fidelity: piece lengths/radii/angles match pre-migration COURSES.lakeside.
 */

import { COLORS } from "../../config.js?v=208";

export const LAKESIDE_DEFINITION = {
  id: "lakeside",
  name: "LAKESIDE",
  subtitle: "BONUS  ·  AUTUMN  ·  1st AFTER MOUNTAIN",
  difficulty: "bonus",
  fog: COLORS.fogLakeside,
  sky: 9352388,
  offroad: "grass",
  scenery: "lakeside",
  startWidth: 10,
  startY: 1,
  seed: 61,
  barriers: true,
  identity: "Bonus autumn lakeside: tarmac flow + cobble run + jumps",
  segments: [
    { kind: "straight", length: 92, surface: "tarmac", purpose: "straight", width: 10 },
    { kind: "jump", ramp: 24, rise: 3.8, lip: 7, gap: 18, drop: 2.6, land: 22, surface: "tarmac", width: 10, purpose: "jump" },
    { kind: "medium_corner", direction: "left", radius: 48, angle: 40, surface: "tarmac", width: undefined, purpose: "medium_corner" },
    { kind: "straight", length: 64, surface: "tarmac", purpose: "straight", width: 9 },
    { kind: "tight_corner", direction: "right", radius: 26, angle: 95, surface: "tarmac", width: undefined, purpose: "tight_corner" },
    { kind: "straight", length: 52, surface: "tarmac", purpose: "straight", width: 10, dy: 2 },
    { kind: "tight_corner", direction: "left", radius: 32, angle: 70, surface: "tarmac", width: undefined, purpose: "tight_corner" },
    { kind: "straight", length: 78, surface: "tarmac", purpose: "straight", width: 10 },
    { kind: "medium_corner", direction: "right", radius: 56, angle: 52, surface: "tarmac", width: 10, purpose: "medium_corner" },
    { kind: "straight", length: 58, surface: "tarmac", purpose: "straight", width: 9, checkpoint: true },
    { kind: "tight_corner", direction: "left", radius: 30, angle: 88, surface: "tarmac", width: undefined, purpose: "tight_corner", dy: 2 },
    { kind: "surface_transition", length: 66, surface: "tarmac", surfaceOut: "cobble", purpose: "tarmac→cobble", width: 9 },
    { kind: "hairpin", direction: "right", radius: 20, angle: 130, surface: "cobble", width: undefined, purpose: "hairpin", dy: -1 },
    { kind: "straight", length: 54, surface: "cobble", purpose: "straight", width: 8.6, dy: -1 },
    { kind: "medium_corner", direction: "left", radius: 55, angle: 55, surface: "cobble", width: undefined, purpose: "medium_corner", dy: 1 },
    { kind: "straight", length: 48, surface: "cobble", purpose: "straight", width: 9, dy: 1 },
    { kind: "tight_corner", direction: "right", radius: 26, angle: 84, surface: "cobble", width: undefined, purpose: "tight_corner" },
    { kind: "straight", length: 62, surface: "cobble", purpose: "straight", width: 9 },
    { kind: "medium_corner", direction: "left", radius: 62, angle: 46, surface: "cobble", width: undefined, purpose: "medium_corner", dy: 1 },
    { kind: "surface_transition", length: 54, surface: "cobble", surfaceOut: "tarmac", purpose: "cobble→tarmac", width: 9 },
    { kind: "tight_corner", direction: "right", radius: 24, angle: 80, surface: "tarmac", width: undefined, purpose: "tight_corner" },
    { kind: "straight", length: 62, surface: "tarmac", purpose: "straight", width: 10, dy: 1, checkpoint: true },
    { kind: "medium_corner", direction: "left", radius: 38, angle: 62, surface: "tarmac", width: undefined, purpose: "medium_corner" },
    { kind: "jump", ramp: 20, rise: 3.2, lip: 6, gap: 15, drop: 2.2, land: 18, surface: "tarmac", width: 10, purpose: "jump" },
    { kind: "straight", length: 58, surface: "tarmac", purpose: "straight", width: 10 },
    { kind: "tight_corner", direction: "right", radius: 28, angle: 70, surface: "tarmac", width: undefined, purpose: "tight_corner" },
    { kind: "straight", length: 104, surface: "tarmac", purpose: "straight", width: 10 },
    { kind: "medium_corner", direction: "left", radius: 44, angle: 48, surface: "tarmac", width: undefined, purpose: "medium_corner" },
    { kind: "straight", length: 72, surface: "tarmac", purpose: "straight", width: 10 },
    { kind: "medium_corner", direction: "right", radius: 34, angle: 64, surface: "tarmac", width: undefined, purpose: "medium_corner" },
    { kind: "straight", length: 70, surface: "tarmac", purpose: "straight", width: 10 },
    { kind: "medium_corner", direction: "left", radius: 40, angle: 45, surface: "tarmac", width: undefined, purpose: "medium_corner" },
    { kind: "straight", length: 110, surface: "tarmac", purpose: "straight" },
  ],
};
