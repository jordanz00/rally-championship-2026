/**
 * Authored track segment kind vocabulary.
 * WHO THIS IS FOR: track-definition + stage-data-validate (no circular imports).
 */

/** @type {readonly string[]} */
export const SEGMENT_KINDS = Object.freeze([
  "straight",
  "fast_sweeper",
  "medium_corner",
  "tight_corner",
  "hairpin",
  "s_bend",
  "crest",
  "dip",
  "compression",
  "jump",
  "banked_corner",
  "off_camber_corner",
  "surface_transition",
  "tunnel",
  "bridge",
  "narrow_section",
  "open_section",
]);
