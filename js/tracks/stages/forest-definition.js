/**
 * FOREST — hand-migrated TrackDefinition (Pass 1).
 *
 * WHO THIS IS FOR: stage design; compiles via track-definition.js → pieces.
 * WHAT IT DOES: Preserves championship layout while using shared authoring.
 * HOW IT CONNECTS: courses.js mounts compileTrackDefinition(FOREST_DEFINITION).
 *
 * Geometry fidelity: piece lengths/radii/angles match pre-migration COURSES.forest.
 */

import { COLORS } from "../../config.js?v=208";

export const FOREST_DEFINITION = {
  id: "forest",
  name: "FOREST",
  subtitle: "MEDIUM  ·  TREE CORRIDOR  ·  WATERFALL CLEARING",
  difficulty: "medium",
  fog: COLORS.fogForest,
  sky: 6990036,
  offroad: "grass",
  scenery: "forest",
  startWidth: 14.4,
  startY: 2,
  seed: 37,
  barriers: false,
  identity: "Tight corridor → glade bowl → mud hairpins → autumn sprint",
  segments: [
    { kind: "straight", length: 42, surface: "dirt", purpose: "straight", width: 14.4, dy: 1 },
    { kind: "medium_corner", direction: "left", radius: 48, angle: 58, surface: "dirt", width: 14, purpose: "medium_corner" },
    { kind: "straight", length: 22, surface: "dirt", purpose: "straight", width: 13.8 },
    { kind: "medium_corner", direction: "right", radius: 40, angle: 66, surface: "dirt", width: 13.6, purpose: "medium_corner", surfaceOut: "gravel" },
    { kind: "straight", length: 18, surface: "gravel", purpose: "straight", width: 13.6 },
    { kind: "medium_corner", direction: "left", radius: 36, angle: 72, surface: "gravel", width: 13.4, purpose: "medium_corner" },
    { kind: "straight", length: 24, surface: "gravel", purpose: "straight", width: 13.8 },
    { kind: "jump", ramp: 14, rise: 2.4, lip: 5, gap: 11, drop: 1.4, land: 26, surface: "gravel", width: 14.6, purpose: "jump" },
    { kind: "straight", length: 22, surface: "gravel", purpose: "straight", width: 14 },
    { kind: "medium_corner", direction: "left", radius: 52, angle: 48, surface: "gravel", width: 13.6, purpose: "medium_corner" },
    { kind: "medium_corner", direction: "right", radius: 44, angle: 56, surface: "gravel", width: 13.4, purpose: "medium_corner" },
    { kind: "straight", length: 36, surface: "gravel", purpose: "straight", width: 17, checkpoint: true },
    { kind: "straight", length: 38, surface: "dirt", purpose: "straight", width: 18.6, dy: -1 },
    { kind: "hairpin", direction: "right", radius: 44, angle: 176, surface: "dirt", width: 19.4, purpose: "hairpin", landmark: true },
    { kind: "straight", length: 28, surface: "dirt", purpose: "straight", width: 18 },
    { kind: "fast_sweeper", direction: "right", radius: 118, angle: 90, surface: "gravel", width: 18, purpose: "fast_sweeper", dy: -1.2, sweep: true },
    { kind: "straight", length: 20, surface: "gravel", purpose: "straight", width: 17.4 },
    { kind: "surface_transition", length: 14, surface: "gravel", surfaceOut: "mud", purpose: "gravel→mud", width: 16.8 },
    { kind: "hairpin", direction: "right", radius: 34, angle: 164, surface: "mud", width: 16.4, purpose: "hairpin", landmark: true },
    { kind: "straight", length: 16, surface: "mud", purpose: "straight", width: 16.2 },
    { kind: "hairpin", direction: "left", radius: 34, angle: 160, surface: "mud", width: 16.4, purpose: "hairpin", landmark: true },
    { kind: "surface_transition", length: 20, surface: "mud", surfaceOut: "gravel", purpose: "mud→gravel", width: 16.6 },
    { kind: "medium_corner", direction: "left", radius: 42, angle: 78, surface: "gravel", width: 14.4, purpose: "medium_corner" },
    { kind: "straight", length: 18, surface: "gravel", purpose: "straight", width: 14.2 },
    { kind: "medium_corner", direction: "right", radius: 38, angle: 86, surface: "gravel", width: 14, purpose: "medium_corner" },
    { kind: "surface_transition", length: 16, surface: "gravel", surfaceOut: "dirt", purpose: "gravel→dirt", width: 14.4 },
    { kind: "tight_corner", direction: "left", radius: 34, angle: 108, surface: "dirt", width: 14.6, purpose: "tight_corner" },
    { kind: "straight", length: 26, surface: "dirt", purpose: "straight", width: 15.4, checkpoint: true },
    { kind: "surface_transition", length: 18, surface: "dirt", surfaceOut: "gravel", purpose: "dirt→gravel", width: 16.4 },
    { kind: "hairpin", direction: "right", radius: 38, angle: 132, surface: "gravel", width: 16.6, purpose: "hairpin", landmark: true },
    { kind: "straight", length: 24, surface: "gravel", purpose: "straight", width: 16.4 },
    { kind: "medium_corner", direction: "left", radius: 52, angle: 78, surface: "gravel", width: 16.6, purpose: "medium_corner" },
    { kind: "surface_transition", length: 40, surface: "gravel", surfaceOut: "dirt", purpose: "gravel→dirt", width: 17 },
    { kind: "medium_corner", direction: "right", radius: 64, angle: 44, surface: "dirt", width: 17.2, purpose: "medium_corner" },
    { kind: "straight", length: 68, surface: "dirt", purpose: "straight", width: 17.4 },
  ],
};
