/**
 * DESERT — hand-migrated TrackDefinition (Pass 1).
 *
 * WHO THIS IS FOR: stage design; compiles via track-definition.js → pieces.
 * WHAT IT DOES: Preserves championship layout while using shared authoring.
 * HOW IT CONNECTS: courses.js mounts compileTrackDefinition(DESERT_DEFINITION).
 *
 * Geometry fidelity: piece lengths/radii/angles match pre-migration COURSES.desert.
 */

import { COLORS } from "../../config.js?v=207";

export const DESERT_DEFINITION = {
  id: "desert",
  name: "DESERT",
  subtitle: "EASY  ·  SAFARI  ·  TUNNEL",
  difficulty: "easy",
  fog: COLORS.fogDesert,
  sky: 14865064,
  offroad: "sand",
  scenery: "desert",
  startWidth: 18,
  startY: 0,
  seed: 11,
  barriers: false,
  identity: "Safari teaching stage: wide sand, gravel corridor, tunnel, mud slides, bowl + sweeper",
  segments: [
    { kind: "straight", length: 190, surface: "sand", purpose: "straight", width: 18 },
    { kind: "medium_corner", direction: "left", radius: 132, angle: 30, surface: "sand", width: 18, purpose: "medium_corner" },
    { kind: "straight", length: 58, surface: "sand", purpose: "straight", width: 18 },
    { kind: "medium_corner", direction: "right", radius: 120, angle: 28, surface: "sand", width: 18, purpose: "medium_corner" },
    { kind: "straight", length: 92, surface: "sand", purpose: "straight", width: 18 },
    { kind: "jump", ramp: 22, rise: 2.2, lip: 5, gap: 12, drop: 1.6, land: 24, surface: "sand", width: 18, purpose: "jump" },
    { kind: "surface_transition", length: 66, surface: "sand", surfaceOut: "gravel", purpose: "sand→gravel", width: 17 },
    { kind: "medium_corner", direction: "left", radius: 54, angle: 56, surface: "gravel", width: 15, purpose: "medium_corner" },
    { kind: "straight", length: 52, surface: "gravel", purpose: "straight", width: 14 },
    { kind: "medium_corner", direction: "right", radius: 42, angle: 64, surface: "gravel", width: 14, purpose: "medium_corner" },
    { kind: "straight", length: 44, surface: "gravel", purpose: "straight", width: 13 },
    { kind: "medium_corner", direction: "left", radius: 36, angle: 74, surface: "gravel", width: 13, purpose: "medium_corner" },
    { kind: "surface_transition", length: 54, surface: "gravel", surfaceOut: "sand", purpose: "gravel→sand", width: 16 },
    { kind: "jump", ramp: 20, rise: 3, lip: 6, gap: 16, drop: 2.2, land: 18, surface: "sand", width: 17, purpose: "jump" },
    { kind: "straight", length: 34, surface: "sand", purpose: "straight", width: 17 },
    { kind: "jump", ramp: 30, rise: 5.2, lip: 8, gap: 26, drop: 3.6, land: 52, surface: "sand", width: 17, purpose: "jump" },
    { kind: "straight", length: 72, surface: "sand", purpose: "straight", width: 17, checkpoint: true },
    { kind: "medium_corner", direction: "left", radius: 80, angle: 44, surface: "sand", width: 16, purpose: "medium_corner", dy: 5 },
    { kind: "surface_transition", length: 48, surface: "sand", surfaceOut: "dirt", purpose: "sand→dirt", width: 14, dy: 6 },
    { kind: "tunnel", length: 40, surface: "dirt", purpose: "tunnel", width: 13, dy: 2 },
    { kind: "tunnel", direction: "right", radius: 42, angle: 40, surface: "dirt", width: 13, purpose: "tunnel" },
    { kind: "tunnel", length: 78, surface: "dirt", purpose: "tunnel", width: 13.5 },
    { kind: "tunnel", direction: "left", radius: 46, angle: 52, surface: "dirt", width: 13.5, purpose: "tunnel" },
    { kind: "tunnel", length: 58, surface: "dirt", purpose: "tunnel", width: 13.5 },
    { kind: "tunnel", direction: "right", radius: 42, angle: 44, surface: "dirt", width: 13.5, purpose: "tunnel", surfaceOut: "mud" },
    { kind: "straight", length: 54, surface: "mud", purpose: "straight", width: 13 },
    { kind: "medium_corner", direction: "left", radius: 46, angle: 58, surface: "mud", width: 13, purpose: "medium_corner" },
    { kind: "straight", length: 42, surface: "mud", purpose: "straight", width: 13 },
    { kind: "medium_corner", direction: "right", radius: 40, angle: 62, surface: "mud", width: 13, purpose: "medium_corner" },
    { kind: "surface_transition", length: 60, surface: "mud", surfaceOut: "sand", purpose: "mud→sand", width: 16 },
    { kind: "jump", ramp: 28, rise: 4.2, lip: 7, gap: 22, drop: 3, land: 26, surface: "sand", width: 17, purpose: "jump" },
    { kind: "straight", length: 44, surface: "sand", purpose: "straight", width: 18 },
    { kind: "straight", length: 38, surface: "sand", purpose: "straight", width: 20, dy: -1.2 },
    { kind: "hairpin", direction: "right", radius: 44, angle: 165, surface: "sand", width: 21, purpose: "hairpin", landmark: true },
    { kind: "straight", length: 42, surface: "sand", purpose: "straight", width: 19 },
    { kind: "straight", length: 56, surface: "sand", purpose: "straight", width: 18 },
    { kind: "fast_sweeper", direction: "right", radius: 145, angle: 78, surface: "sand", width: 18, purpose: "fast_sweeper", dy: -2, sweep: true },
    { kind: "straight", length: 52, surface: "sand", purpose: "straight", width: 18 },
    { kind: "surface_transition", length: 24, surface: "sand", surfaceOut: "gravel", purpose: "sand→gravel", width: 18 },
    { kind: "hairpin", direction: "right", radius: 38, angle: 148, surface: "gravel", width: 18, purpose: "hairpin", landmark: true },
    { kind: "straight", length: 30, surface: "gravel", purpose: "straight", width: 17 },
    { kind: "hairpin", direction: "left", radius: 38, angle: 148, surface: "gravel", width: 18, purpose: "hairpin", landmark: true },
    { kind: "surface_transition", length: 28, surface: "gravel", surfaceOut: "sand", purpose: "gravel→sand", width: 18 },
    { kind: "straight", length: 96, surface: "sand", purpose: "straight", width: 18 },
    { kind: "straight", length: 120, surface: "sand", purpose: "straight", width: 19, checkpoint: true },
    { kind: "fast_sweeper", direction: "left", radius: 160, angle: 42, surface: "sand", width: 19, purpose: "fast_sweeper", sweep: true },
    { kind: "straight", length: 88, surface: "sand", purpose: "straight", width: 19 },
    { kind: "jump", ramp: 18, rise: 1.8, lip: 4, gap: 10, drop: 1.2, land: 28, surface: "sand", width: 19, purpose: "jump" },
    { kind: "straight", length: 140, surface: "sand", purpose: "straight", width: 20 },
  ],
};
