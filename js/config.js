/**
 * Rally Championship — global tunables.
 *
 * WHO THIS IS FOR: anyone tweaking feel, Saturn look, or car performance.
 * WHAT IT DOES: one place for physics, surfaces, render, and championship rules.
 * HOW IT CONNECTS: imported by vehicle, tracks, renderer, HUD, and the game loop.
 */

export const FIXED_DT = 1 / 60;
export const MAX_SUBSTEPS = 4;

/** Internal Saturn-like framebuffer. Upscaled with nearest-neighbor. */
export const INTERNAL_WIDTH = 640;
export const INTERNAL_HEIGHT = 448;

export const COLORS = {
  castrolGreen: 0x0a7a3c,
  castrolGreenDark: 0x065c2c,
  castrolWhite: 0xf4f4f0,
  castrolRed: 0xd4121a,
  castrolYellow: 0xffd200,
  toyotaRed: 0xeb0a1e,
  asphalt: 0x4a4a52,
  gravel: 0x8a7a62,
  dirt: 0x6b4e32,
  cobble: 0x7a7368,
  grass: 0x3d6b32,
  sand: 0xc4a56a,
  mud: 0x4a3a28,
  fogDesert: 0xc9b48a,
  fogForest: 0x6a8a62,
  fogMountain: 0x8aa0b4,
};

/**
 * Per-surface tire and chassis response.
 * muPeak: peak friction. muSlide: sliding friction (drift).
 * roll: rolling resistance. sink: extra compression feel.
 * bump: high-frequency suspension noise amplitude (meters).
 */
export const SURFACES = {
  tarmac: {
    id: "tarmac",
    label: "TARMAC",
    muPeak: 1.35,
    muSlide: 1.05,
    roll: 0.012,
    sink: 0,
    bump: 0.004,
    dust: 0.15,
    speedScale: 1.0,
    driftEase: 0.55,
    color: COLORS.asphalt,
  },
  gravel: {
    id: "gravel",
    label: "GRAVEL",
    muPeak: 0.92,
    muSlide: 0.62,
    roll: 0.028,
    sink: 0.02,
    bump: 0.028,
    dust: 0.85,
    speedScale: 0.92,
    driftEase: 1.15,
    color: COLORS.gravel,
  },
  dirt: {
    id: "dirt",
    label: "DIRT",
    muPeak: 0.78,
    muSlide: 0.5,
    roll: 0.035,
    sink: 0.035,
    bump: 0.04,
    dust: 1.0,
    speedScale: 0.88,
    driftEase: 1.25,
    color: COLORS.dirt,
  },
  cobble: {
    id: "cobble",
    label: "COBBLE",
    muPeak: 1.05,
    muSlide: 0.78,
    roll: 0.022,
    sink: 0.01,
    bump: 0.055,
    dust: 0.25,
    speedScale: 0.94,
    driftEase: 0.8,
    color: COLORS.cobble,
  },
  grass: {
    id: "grass",
    label: "GRASS",
    muPeak: 0.55,
    muSlide: 0.38,
    roll: 0.055,
    sink: 0.05,
    bump: 0.03,
    dust: 0.35,
    speedScale: 0.72,
    driftEase: 1.05,
    color: COLORS.grass,
  },
  sand: {
    id: "sand",
    label: "SAND",
    muPeak: 0.68,
    muSlide: 0.42,
    roll: 0.048,
    sink: 0.06,
    bump: 0.022,
    dust: 1.15,
    speedScale: 0.82,
    driftEase: 1.35,
    color: COLORS.sand,
  },
  mud: {
    id: "mud",
    label: "MUD",
    muPeak: 0.48,
    muSlide: 0.28,
    roll: 0.07,
    sink: 0.08,
    bump: 0.035,
    dust: 0.7,
    speedScale: 0.65,
    driftEase: 1.4,
    color: COLORS.mud,
  },
};

/** Castrol Celica GT-Four ST205-inspired chassis. */
export const CELICA = {
  name: "CELICA GT-FOUR",
  mass: 1220,
  yawInertia: 1650,
  pitchInertia: 720,
  rollInertia: 480,
  wheelbase: 2.55,
  trackFront: 1.51,
  trackRear: 1.51,
  cgHeight: 0.48,
  wheelRadius: 0.32,
  restLength: 0.34,
  travel: 0.16,
  spring: 32000,
  damper: 4200,
  damperBump: 4800,
  damperRebound: 3600,
  antiRollFront: 5200,
  antiRollRear: 3800,
  maxSteer: 0.58,
  steerSpeed: 7.5,
  peakPowerKw: 186,
  redline: 7500,
  idleRpm: 950,
  gears: [0, 3.166, 1.904, 1.258, 0.918, 0.731],
  finalDrive: 4.285,
  drivetrain: "4wd",
  torqueSplitFront: 0.42,
  engineBrake: 0.18,
  aeroDrag: 0.38,
  downforce: 0.12,
  maxSpeedKmh: 212,
};

export const CAMERA = {
  chaseDistance: 6.4,
  chaseHeight: 2.15,
  lookAhead: 10,
  stiffness: 8.5,
  fov: 55,
};

export const CHAMPIONSHIP = {
  opponents: 8,
  startPosition: 9,
  checkpointBonus: 18,
  stageTime: {
    desert: 95,
    forest: 105,
    mountain: 115,
  },
};
