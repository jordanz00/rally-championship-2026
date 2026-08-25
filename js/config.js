/**
 * Rally Championship — global tunables.
 *
 * WHO THIS IS FOR: anyone tweaking feel, Saturn look, or car performance.
 * WHAT IT DOES: one place for physics, surfaces, render, and championship rules.
 * HOW IT CONNECTS: imported by vehicle, tracks, renderer, HUD, and the game loop.
 *
 * GTA IV rival (Sprint 75c): HANDLING/CHASSIS/SURFACES encode Rockstar's
 * readable-mass formula, not a handling.dat clone. Sources in HANDLING.
 */

export const FIXED_DT = 1 / 60;
/**
 * Fixed steps the loop may run to catch up after one slow frame.
 * Three lets a 20 ms hitch stay in real time; more than that and a stall
 * would snowball into a substep spiral, so the loop drops the surplus.
 */
export const MAX_SUBSTEPS = 3;

/** Native framebuffer — PBR needs real resolution, not a 640px Saturn blit. */
export const INTERNAL_WIDTH = 1600;
export const INTERNAL_HEIGHT = 900;

/**
 * GPU budget for a 60 Hz arcade pack (14 cars on Desert).
 * Live CubeCamera is 6 extra scene draws — leave it off; sky IBL is enough.
 * Shadows update every frame (skipping frames feels like hitching).
 */
export const GFX = {
  /** Race — photoreal at 60 Hz: prefer frame time over pixel density. */
  maxPixelRatio: 1.5,
  maxPixels: 2800000,
  /** Title / SELECT MODE showroom — cheap framebuffer so splash paints fast. */
  titleMaxPixelRatio: 0.68,
  titleMaxPixels: 720000,
  /** Title sun atlas — 512 is enough for one LOD car on a pad. */
  titleShadowMap: 512,
  /** AM3 criterion 1 — cap presentation at 60 Hz; physics stays fixed-step. */
  targetFps: 60,
  lockRenderFps: true,
  /** Title attract may render uncapped for smooth orbit on high-refresh panels. */
  unlockFpsOnTitle: true,
  /** Soft shadows — update every frame so the blob under the car does not strobe. */
  shadowMap: 4096,
  shadowExtent: 22,
  /** Race shadow ortho half-width — tighter = sharper contact (Sprint 32 PBR). */
  shadowExtentRace: 17,
  shadowNear: 3,
  shadowFar: 96,
  shadowEvery: 1,
  reflectEvery: 0,
  cubeSize: 64,
  /**
   * Rearview RT — 384 on the long edge (readable cabin glass, ~1/4 of a
   * 1600-wide framebuffer). Full-res was a hitch; postage-stamp is unreadable.
   */
  mirrorW: 384,
  mirrorH: 120,
  mirrorEvery: 1,
  /** PMREM sky capture far plane (internal bake is 256³). */
  pmremFar: 240,
  /**
   * Adaptive present quality (Sprint 24 / 30 fps floor).
   * frameMs above highMs → drop post bloom; above floorMs → emergency low + DPR cut.
   */
  adaptHighMs: 22,
  adaptLowMs: 14.5,
  /** Hard floor — present cost above this forces low post + thinner pixel ratio. */
  adaptFloorMs: 33.3,
  /** Minimum DPR when the 30 fps floor trips (restored when cost recovers). */
  minPixelRatio: 0.85,
  /** Sprint 39 — integrated GPU targets (iGPU / M-series low power). */
  integratedFloorMs: 18.5,
  integratedEmergencyMs: 22,
  integratedShadowMap: 2048,
};

/**
 * Sprint 23–25 photoreal / UE5-inspired look — Sprint 30 cinema realism (tier 13).
 */
export const VISUAL = {
  realisticArcade: true,
  /** SK1 tier — tier 13: photographic environment, textures, lighting (Sprint 30). */
  tier: 13,
  /** ACES filmic path + denser procedural albedo (not arcade punch alone). */
  cinemaRealism: true,
  /** Clearcoat paint, metal chrome, roughness maps, stronger IBL response. */
  ue5Look: true,
  /** Physically based sun/hemi intensities (no legacy light model). */
  physicalLighting: true,
  /**
   * Photographic grade — believable midtones, restrained sat, soft bloom.
   * Depth comes from ACES + IBL + texture, not saturation/bloom boosts.
   */
  postFx: true,
  bloomStrength: 0.15,
  bloomThreshold: 0.76,
  vignette: 0.08,
  gradeContrast: 0.96,
  gradeSaturation: 1.04,
  gradeWarmth: 0.08,
  /** Fine film grain — cinema read; adaptive low still zeros this. */
  sharpen: 0,
  fxaa: false,
  filmGrain: 0.026,
  /** Trackside crowds, animals, trees, rocks from assets/props/*.glb. */
  glbProps: true,
  /** Extra dune/bank/ridge octaves + denser procedural land paint. */
  terrainRealism: true,
  /** Ghost only fragments on the cam→car sightline (tight tube; opaque otherwise). */
  cameraOcclusionFade: true,
  /** Soft distance fade — stronger at tier 13 for atmospheric depth. */
  aerialPerspective: true,
  aerialStrength: 0.38,
  aerialStart: 55,
  aerialEnd: 640,
  /** One authored silhouette cluster per stage (desert arch, forest cedars, lakeside pier). */
  heroLandmarks: true,
  /** Stronger water env response at tier 4+ (lakeside). */
  waterReflection: true,
  /** Rally boards at landmarks + km markers — reads as authored stage. */
  tracksideSignage: true,
  /** Darker/larger ground blobs under trees and hero props. */
  contactShadowBoost: true,
  /** Subtle UV scroll on lake surfaces (cheap motion read). */
  waterScroll: true,
  /** Sprint 27 — billowing rear dirt wake + grit (effects.js). */
  rearDirtWake: true,
  /** Stage sky dust band + horizon bounce (sky.js). */
  envAtmosphere: true,
  /** Tier 13 IBL — world and car read sunlit materials. */
  worldEnvIntensity: 1.18,
  carEnvIntensity: 1.12,
  /** Sprint 32 — sky-rim directional (no shadow) for PBR specular fill. */
  pbrSkyRim: true,
  /** Composite highlight shoulder after ACES ( tame spec bloom ). */
  highlightRolloff: 0.24,
  pbrSkySigma: 0,
  /** Normal strength on road/terrain. */
  normalStrength: 1.22,
  /** Half-res normals — chase-cam distance; keep Sprint 24 GPU win. */
  normalMapScale: 0.5,
  /** Albedo ×4 + procedural roughness maps. */
  textureScale: 4,
  roughnessMaps: true,
  propSegments: 16,
  rockDetail: 3,
};

/**
 * GTA-style world streaming — only draw geometry within a radius of the player.
 * Load/unload align with fog so slices appear while still haze-hidden, not at
 * the visible edge. Hysteresis stops boundary flicker.
 */
export const STREAM = {
  /** Load at fog.far × this — geometry must exist before it clears the haze. */
  loadFogFactor: 1.08,
  /** Unload beyond fog so slices stay warm until fully fogged out. */
  unloadFogFactor: 1.16,
  /** Fallback radii when the scene has no fog (metres). */
  loadRadius: 900,
  unloadRadius: 980,
  /** Heightmap tile edge length (metres). */
  terrainTileSize: 256,
  /** 24 = denser heightmap than 18 without the 32-seg fill cost. */
  terrainTileSegs: 24,
  backdropSectors: 16,
  /** Spline chunks kept loaded ahead/behind the car (220 m each). */
  prefetchChunks: 2,
  /** Driving seconds to pre-warm streaming along the racing line. */
  lookaheadSeconds: 3,
  /** Extra load margin for large bounds (terrain tiles, backdrop rings). */
  boundsPadding: 96,
  /** Minimum gap between load and unload when using fixed radii (metres). */
  hysteresis: 80,
  /** Floor load radius when fog is tight (tunnels, title) — avoids sudden pops. */
  minLoadRadius: 320,
  /** Countdown / GPU-settle radius — the start grid must be fully drawn. */
  countdownLoadRadius: 720,
  /**
   * Tree / prop mesh LOD (metres to chunk sphere). Inside lodNear the player
   * sees authored GLB canopies; beyond it, crossed-plane cards. Hysteresis
   * stops the swap strobing on a 220 m slice boundary.
   */
  lodNear: 108,
  lodHysteresis: 22,
};

/** Visual tarmac sits this far above the spline. Physics deck must match. */
export const ROAD_DECK = 0.06;

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
  /** Packed driving ribbon — darker than landscape sand/grass so the line reads. */
  ribbonSand: 0x8a6238,
  ribbonGravel: 0x5c4a38,
  ribbonDirt: 0x4a3018,
  ribbonTarmac: 0x32363e,
  ribbonCobble: 0x4e4a44,
  ribbonMud: 0x2e2218,
  ribbonGrass: 0x2a481c,
  kerbCream: 0xf2ead0,
  kerbRed: 0xd4121a,
  dunePale: 0xd8c090,
  fogDesert: 0xc8d8e8,
  fogForest: 0xb8d0e8,
  fogMountain: 0xb0cce8,
  fogLakeside: 0xa8c8dc,
};

/**
 * Per-stage outdoor rig: physically based sky (Rayleigh/Mie), key sun, sky fill.
 * Sky colors stay atmospheric blue — they do not copy sand/grass/rock.
 * sunDir is a unit-ish vector (x, y, z) toward the light.
 */
export const LIGHTING = {
  desert: {
    /**
     * Sprint 30 cinema Desert — warm sand bounce, clear key sun, soft dust haze.
     * Tuned for ACES (not arcade Reinhard punch).
     */
    skyGradient: [
      [0.0, "#c4b090"],
      [0.38, "#d8cdb8"],
      [0.5, "#b8cce0"],
      [0.62, "#5a9ed4"],
      [0.8, "#2e7eb8"],
      [1.0, "#1e6aa8"],
    ],
    skyZenith: 0x1e6aa8,
    skyHorizon: 0xb8cce0,
    skyTurbidity: 2.4,
    skyRayleigh: 1.12,
    skyMie: 0.0042,
    skyMieG: 0.78,
    skyExposure: 1.04,
    sunSkyBoost: 0.92,
    sunBloom: 0.58,
    zenithBoost: 0.28,
    groundBounceMix: 0.18,
    cloudCover: 0.36,
    cloudScale: 1.42,
    horizonGlow: 0xe0d4c0,
    horizonStrength: 0.32,
    dustStrength: 0.22,
    wind: [1.8, 0, 0.6],
    fog: 0xc0c8d0,
    fogNear: 340,
    fogFar: 1280,
    hemiSky: 0xa8c8e8,
    hemiGround: 0xd0b080,
    hemi: 1.22,
    sun: 0xfff0d8,
    sunKelvin: 5780,
    sunInt: 2.05,
    sunDir: [0.42, 0.86, 0.28],
    rimSky: 0xb8d4f0,
    rimInt: 0.38,
    fill: 0xa0b8d0,
    fillInt: 0.82,
    ambient: 0xb8c4c8,
    ambientInt: 0.64,
    exposure: 1.4,
    gradeWarmth: 0.12,
    skyBack: 0x2e7eb8,
    worldEnv: 1.16,
  },
  forest: {
    /**
     * Sprint 30 cinema Forest — cool canopy bounce, clear key, soft green ground.
     */
    skyGradient: [
      [0.0, "#a8b890"],
      [0.38, "#c8d8c0"],
      [0.5, "#a8c8e0"],
      [0.62, "#4a98d8"],
      [0.82, "#2878c0"],
      [1.0, "#1868b0"],
    ],
    skyZenith: 0x1868b0,
    skyHorizon: 0xa8c8e0,
    skyTurbidity: 2.0,
    skyRayleigh: 1.15,
    skyMie: 0.0032,
    skyMieG: 0.76,
    skyExposure: 1.06,
    sunSkyBoost: 0.9,
    sunBloom: 0.55,
    zenithBoost: 0.3,
    groundBounceMix: 0.2,
    cloudCover: 0.44,
    cloudScale: 1.48,
    horizonGlow: 0xc8dcc8,
    horizonStrength: 0.28,
    dustStrength: 0.08,
    wind: [0.4, 0, -0.9],
    fog: 0xa8bcd0,
    fogNear: 280,
    fogFar: 1180,
    skyBack: 0x2878c0,
    hemiSky: 0xb0d8f0,
    hemiGround: 0x5a8848,
    hemi: 1.24,
    sun: 0xfff8e8,
    sunKelvin: 5520,
    sunInt: 1.98,
    sunDir: [0.4, 0.88, 0.32],
    rimSky: 0xc0e0f8,
    rimInt: 0.34,
    fill: 0x88b070,
    fillInt: 0.78,
    ambient: 0x98b090,
    ambientInt: 0.64,
    exposure: 1.42,
    gradeWarmth: 0.06,
    worldEnv: 1.14,
  },
  mountain: {
    /**
     * Sprint 30 cinema Mountain — thin alpine air, hard key, cool rock bounce.
     */
    skyGradient: [
      [0.0, "#a8b8a0"],
      [0.4, "#c8d8d0"],
      [0.52, "#98c4e8"],
      [0.68, "#3a8cd8"],
      [0.88, "#2070c8"],
      [1.0, "#1058b0"],
    ],
    skyZenith: 0x1058b0,
    skyHorizon: 0x98c4e8,
    skyTurbidity: 1.6,
    skyRayleigh: 1.22,
    skyMie: 0.0026,
    skyMieG: 0.74,
    skyExposure: 1.08,
    sunSkyBoost: 0.95,
    sunBloom: 0.52,
    zenithBoost: 0.34,
    groundBounceMix: 0.14,
    cloudCover: 0.32,
    cloudScale: 1.52,
    horizonGlow: 0xc0d8e8,
    horizonStrength: 0.24,
    dustStrength: 0.05,
    wind: [2.4, 0, 1.1],
    fog: 0xa0bcd8,
    fogNear: 320,
    fogFar: 1380,
    skyBack: 0x2070c8,
    hemiSky: 0xa8d0f0,
    hemiGround: 0x7a7460,
    hemi: 1.2,
    sun: 0xfffaf5,
    sunKelvin: 6420,
    sunInt: 2.05,
    sunDir: [0.48, 0.84, 0.28],
    rimSky: 0xb0d8f8,
    rimInt: 0.34,
    fill: 0x88a878,
    fillInt: 0.78,
    ambient: 0x90a8b8,
    ambientInt: 0.62,
    exposure: 1.42,
    gradeWarmth: 0.03,
    worldEnv: 1.14,
  },
  lakeside: {
    /**
     * Sprint 30 cinema Lakeside — cool water bounce, soft mist, bright key.
     */
    skyGradient: [
      [0.0, "#90b8a8"],
      [0.38, "#b8d4d0"],
      [0.52, "#90c4e0"],
      [0.7, "#3a94c8"],
      [0.9, "#2278b8"],
      [1.0, "#1468a8"],
    ],
    skyZenith: 0x1468a8,
    skyHorizon: 0x90c4e0,
    skyTurbidity: 2.2,
    skyRayleigh: 1.25,
    skyMie: 0.004,
    skyMieG: 0.76,
    skyExposure: 1.04,
    sunSkyBoost: 0.88,
    sunBloom: 0.5,
    zenithBoost: 0.26,
    groundBounceMix: 0.22,
    cloudCover: 0.38,
    cloudScale: 1.4,
    horizonGlow: 0xb8dce8,
    horizonStrength: 0.34,
    dustStrength: 0.18,
    wind: [-0.8, 0, 1.4],
    fog: 0x98b8c8,
    fogNear: 240,
    fogFar: 980,
    skyBack: 0x2278b8,
    hemiSky: 0xa0d0e8,
    hemiGround: 0x487858,
    hemi: 1.22,
    sun: 0xfff0e0,
    sunKelvin: 5980,
    sunInt: 2.0,
    sunDir: [0.5, 0.86, 0.2],
    rimSky: 0xa8d8f0,
    rimInt: 0.36,
    fill: 0x80b8d0,
    fillInt: 0.8,
    ambient: 0x88a8b8,
    ambientInt: 0.64,
    exposure: 1.42,
    gradeWarmth: 0.05,
    worldEnv: 1.16,
  },
  /**
   * Title attract — showroom key/fill/rim tuned for lacquer and chrome on the
   * splash car. Brighter IBL than race so paint reads wet, not flat.
   */
  title: {
    skyTurbidity: 2.8,
    skyRayleigh: 0.92,
    skyMie: 0.0038,
    skyMieG: 0.74,
    skyExposure: 1.08,
    cloudCover: 0.06,
    cloudScale: 1.05,
    fog: 0x6a98c8,
    fogNear: 38,
    fogFar: 92,
    skyBack: 0x6aa8e0,
    horizonGlow: 0x98c8f0,
    horizonStrength: 0.28,
    dustStrength: 0,
    hemiSky: 0xd8f0ff,
    hemiGround: 0xb08858,
    hemi: 1.48,
    sun: 0xfffaf2,
    sunInt: 2.12,
    sunDir: [0.48, 0.82, 0.32],
    fill: 0xf0f8ff,
    fillInt: 1.68,
    ambient: 0xfff4e8,
    ambientInt: 0.74,
    exposure: 1.74,
    rim: 0xd0e8ff,
    rimInt: 1.12,
    kick: 0xfff8e0,
    kickInt: 0.72,
    envIntensity: 1.4,
    bodyEnv: 1.28,
    chromeEnv: 1.72,
    glassEnv: 1.0,
  },
};

/**
 * Desert rock tunnel — fill + sconces + headlights when the sun is killed.
 * Outdoor LIGHTING still owns the key; these values only apply while
 * tunnelShade() blends toward 1.
 */
export const TUNNEL = {
  /** Ambient floor at full shade (was ~0.08 — pitch black bore). */
  ambientFloor: 0.82,
  /** How much outdoor hemi survives at full shade (was 0.15). */
  hemiRetain: 0.72,
  /** Fill directional remnant at full shade. */
  fillRetain: 0.48,
  /** Overhead spot that follows the car (physical intensity). */
  caveInt: 48,
  caveDistance: 52,
  caveDecay: 1.15,
  /** Fixed wall PointLights (physical intensity). */
  wallInt: 72,
  wallDistance: 68,
  wallDecay: 0.95,
  wallColor: 0xffd9a0,
  /** Fog inside the bore — warm brown, not black. */
  fog: 0x5a4030,
  fogNear: 32,
  fogFar: 320,
  /** Exposure multiplier at full shade. */
  exposureBoost: 1.18,
  /** Lens emissive when headlights are fully on. */
  headEmissive: 18,
  /** SpotLight beam intensity per lamp. */
  headBeam: 520,
  headBeamDistance: 148,
  headBeamAngle: Math.PI / 9.2,
  headBeamPenumbra: 0.55,
  headBeamDecay: 1.15,
};

/**
 * Per-surface tire and chassis response — the headline mechanic.
 *
 * AM3 research: "brake on tarmac and you stop; brake on mud and you begin a
 * power slide." Each surface therefore needs three separable characters, not
 * one grip number: how far it takes to STOP, how early it BREAKS AWAY, and
 * how it RECOVERS once it has. The five fields below own those three jobs.
 *
 * muPeak: peak friction. muSlide: sliding friction (drift).
 * slipPeak: slip angle (rad) where the tire tips from grip into a holdable
 *   slide. Small = knife-edge and late (tarmac); large = early and lazy (mud).
 * brakeHold: 1 = the surface lets a tire sit at peak slip under braking, so
 *   the stop is short and dead straight. 0 = the wheel locks freely and you
 *   brake on muSlide instead. This is what makes a tarmac stop feel like a
 *   wall and a mud stop feel like an invitation.
 * brakeYaw: fraction of the brake pedal that becomes ROTATION instead of
 *   deceleration once you are also steering. ~0 on tarmac, near 1 on mud —
 *   the literal implementation of the research quote above.
 * slideHold: how long a slide sustains itself with no driver input.
 *   <1 self-centres (tarmac snaps straight), >1 carries (mud hangs on).
 * gripSnap: authority of an ACTIVE recovery — countersteer and unwinding.
 *   High = the car obeys instantly (tarmac). Low = you must be patient (mud).
 * bumpSteer: how strongly ribbon roughness couples into yaw here.
 * roll: rolling resistance. sink: extra compression feel.
 * bump: high-frequency suspension noise amplitude (meters).
 * color: HUD / dust / landscape. ribbon: packed driving surface (darker so the line reads).
 */
export const SURFACES = {
  tarmac: {
    id: "tarmac",
    label: "TARMAC",
    muPeak: 1.55,
    /**
     * IV tarmac still slides (Traxion / GTA Wiki drifting: IV is looser than V).
     * Peak 1.55 / slide 1.02 = CurveMax–CurveMin gap. Not ice — brakeHold 1.0
     * still stops you dead-straight (AM3: "brake on tarmac and you stop").
     */
    muSlide: 1.02,
    slipPeak: 0.068,
    /** Threshold braking holds: shortest stop on the championship, arrow-straight. */
    brakeHold: 1.0,
    brakeYaw: 0.08,
    slideHold: 0.82,
    gripSnap: 1.58,
    bumpSteer: 0.4,
    roll: 0.014,
    sink: 0,
    bump: 0.01,
    dust: 0,
    speedScale: 1.0,
    driftEase: 0.88,
    pacejkaB: 4.2,
    pacejkaC: 1.34,
    pacejkaE: 0.07,
    color: COLORS.asphalt,
    ribbon: COLORS.ribbonTarmac,
  },
  gravel: {
    id: "gravel",
    label: "GRAVEL",
    muPeak: 1.18,
    muSlide: 0.72,
    slipPeak: 0.122,
    /** Half-locking: brakes bite, then let go — the classic gravel pitch-in. */
    brakeHold: 0.48,
    brakeYaw: 0.72,
    slideHold: 1.42,
    gripSnap: 1.18,
    bumpSteer: 0.85,
    roll: 0.026,
    sink: 0.014,
    bump: 0.038,
    dust: 0.85,
    speedScale: 0.94,
    driftEase: 1.42,
    pacejkaB: 3.6,
    pacejkaC: 1.28,
    pacejkaE: 0.12,
    color: COLORS.gravel,
    ribbon: COLORS.ribbonGravel,
  },
  dirt: {
    id: "dirt",
    label: "DIRT",
    muPeak: 1.1,
    muSlide: 0.8,
    slipPeak: 0.105,
    brakeHold: 0.42,
    brakeYaw: 0.66,
    slideHold: 1.36,
    gripSnap: 1.16,
    bumpSteer: 0.95,
    roll: 0.03,
    sink: 0.022,
    bump: 0.044,
    dust: 1.0,
    speedScale: 0.9,
    driftEase: 1.34,
    pacejkaB: 3.4,
    pacejkaC: 1.26,
    pacejkaE: 0.14,
    color: COLORS.dirt,
    ribbon: COLORS.ribbonDirt,
  },
  cobble: {
    id: "cobble",
    label: "COBBLE",
    muPeak: 1.32,
    muSlide: 0.92,
    slipPeak: 0.085,
    /** Almost tarmac stopping power, but the stones steer you while you do it. */
    brakeHold: 0.88,
    brakeYaw: 0.18,
    slideHold: 0.75,
    gripSnap: 1.4,
    bumpSteer: 1.05,
    roll: 0.02,
    sink: 0.008,
    bump: 0.048,
    dust: 0,
    speedScale: 0.95,
    driftEase: 0.9,
    color: COLORS.cobble,
    ribbon: COLORS.ribbonCobble,
  },
  grass: {
    id: "grass",
    label: "GRASS",
    muPeak: 0.92,
    muSlide: 0.68,
    slipPeak: 0.12,
    brakeHold: 0.42,
    brakeYaw: 0.4,
    slideHold: 0.98,
    gripSnap: 1.1,
    bumpSteer: 1.1,
    roll: 0.048,
    sink: 0.038,
    bump: 0.024,
    dust: 0.35,
    speedScale: 0.8,
    driftEase: 1.05,
    color: COLORS.grass,
    ribbon: COLORS.ribbonGrass,
  },
  sand: {
    id: "sand",
    label: "SAND",
    muPeak: 0.98,
    muSlide: 0.64,
    slipPeak: 0.132,
    brakeHold: 0.38,
    brakeYaw: 0.82,
    slideHold: 1.68,
    gripSnap: 1.12,
    bumpSteer: 0.8,
    roll: 0.04,
    sink: 0.038,
    bump: 0.022,
    dust: 1.15,
    speedScale: 0.9,
    driftEase: 1.52,
    pacejkaB: 3.2,
    pacejkaC: 1.24,
    pacejkaE: 0.16,
    ribbon: COLORS.ribbonSand,
  },
  mud: {
    id: "mud",
    label: "MUD",
    muPeak: 0.84,
    muSlide: 0.58,
    slipPeak: 0.138,
    /** Still the loosest — brake initiates the power slide on exit. */
    brakeHold: 0.16,
    brakeYaw: 0.94,
    slideHold: 1.78,
    gripSnap: 0.98,
    bumpSteer: 0.95,
    roll: 0.06,
    sink: 0.055,
    bump: 0.032,
    dust: 0.7,
    speedScale: 0.74,
    driftEase: 1.58,
    pacejkaB: 2.9,
    pacejkaC: 1.22,
    pacejkaE: 0.18,
    color: COLORS.mud,
    ribbon: COLORS.ribbonMud,
  },
};

/**
 * Global driving feel — the exaggeration dials.
 *
 * AM3 on purpose: "We didn't want to make it totally realistic because if we
 * did that, most players would find themselves going totally out of control
 * around every corner." Sprint 73 added GTA IV weight; Sprint 75c adds the
 * IV *fun formula* — exaggerate readable physics, do not clone handling.dat.
 *
 * Sources (IV, not V):
 * - GTAMods handling.dat: m_fTractionCurveMax/Min, m_fTractionBias,
 *   m_nDriveBias, m_fDriveInertia, m_fHandBrakeForce
 *   https://gtamods.com/wiki/Handling.dat
 * - Grand Theft Wiki Handling.cfg/GTAIV: IV is algorithms + multipliers, not
 *   a full sim; CurveMax = peak; CurveMin = sliding floor; traction bias
 *   front/rear sets over/understeer personality
 *   https://www.grandtheftwiki.com/Handling.cfg/GTAIV
 * - Traxion: exaggerated body roll, class personality (Comet ≠ Blista),
 *   IV less forgiving than V, load the suspension before the corner
 *   https://traxion.gg/how-grand-theft-auto-iv-broke-the-open-world-mould-for-vehicle-physics/
 * - The Drive / Clarity Potion: V added grip and muted weight; IV is looser,
 *   more roll, delayed yaw ("drunk car" = high yaw inertia + delayed Mz)
 * - GTA Wiki Drifting: IV is the closest the series got to a holdable drift
 *
 * Rival bar, not parity. Arcade rally chassis. IV not V.
 */
export const HANDLING = {
  /** Tire substeps for the player. Four keeps 240 Hz tire relaxation stable. */
  substeps: 4,
  /** Opponents run half the tire resolution — the pack is the perf budget. */
  aiSubsteps: 2,
  brakeTorqueFront: 3400,
  brakeTorqueRear: 2300,
  /**
   * Rear lock — arcade e-brake must dump rear µ hard so the tail snaps out
   * into a power slide (initiation), not a gentle scrub.
   */
  handbrakeTorque: 6400,
  /** Slip ratio where longitudinal force peaks. Brake modulation aims here. */
  peakKappa: 0.11,
  /**
   * Countersteer authority. Opposite lock during a slide must feel like a
   * switch, not a suggestion — this is what turns the slide into a tool.
   */
  counterAuthority: 2.55,
  /**
   * How hard throttle pushes the slide wider on loose ground (and pulls it
   * straight on hard ground). Scales with the surface driftEase spread, so
   * one dial covers "throttle steers you" across all seven surfaces.
   */
  throttleSlide: 1.62,
  /**
   * Bump + steering-away amplifier. Research: two wheels on a bump plus
   * steering away from it can end you. Amplify it, do not hide it.
   */
  bumpSteerAmplify: 1.4,
  /**
   * Ribbon roughness felt as yaw/lateral disturbance, per m/s of speed.
   * Raise for a rougher, more nervous stage; lower for a rail.
   */
  bumpYawGain: 0.028,
  /**
   * Grade (rad) below which a stopped car may hold on stiction. Above it,
   * gravity wins and the car rolls back down the hill.
   */
  stictionSlope: 0.05,
  /**
   * Base ceiling on lateral velocity so a slide is dramatic but never a spin.
   * Scaled per surface by slideHold in vehicle.js (SLIDE_CAP_MIN/MAX).
   */
  /** Arcade power-slide ceiling — big attitude, long carry, snappy pitch-in. */
  maxSlideVel: 20.4,
  maxSlideVelHandbrake: 29.5,
  /**
   * Handbrake power-slide knobs (arcade initiation → sustain):
   * enter = hb fraction to treat as sliding;
   * bleedMul = lateral slip decay while e-brake held (lower = longer slide);
   * yawKick = rotation shove when hb + steer (initiation snap);
   * powerMul = throttle widens the slide while e-brake is held (power oversteer).
   */
  handbrakeEnter: 0.028,
  handbrakeBleedMul: 0.024,
  handbrakeYawKick: 3.72,
  handbrakePowerMul: 2.48,
  /** Power-slide sustain without e-brake (throttle + steer sideways). */
  driftBleedMul: 0.034,
  /** Lateral grip scale at full slide angle (lower = slipperier / bigger attitude). */
  slideGripMul: 0.20,
  /**
   * Extra rear µ dump while e-brake is held (0 = none, 1 = almost no rear grip).
   * This is the mechanical "lock the rears" feel of a rally handbrake turn.
   */
  handbrakeRearMu: 0.08,
  /**
   * Throttle + steer pitch-in on loose ground (no e-brake). Higher = easier
   * to light the rear with power alone — classic arcade power slide.
   */
  powerSlidePitch: 1.82,
  /**
   * Sprint 31 — expert trail-brake rotation. Brake + steer on loose surfaces
   * transfers weight forward and rotates the nose into the corner.
   */
  trailBrakeYaw: 0.58,
  /**
   * Sprint 31 — bonus countersteer authority when catching a slide at the limit.
   * Scales yawFollow when opposite lock is active.
   */
  expertCounterMul: 1.28,
  /**
   * GTA IV weight (Sprint 73 + 75c). Brake unloads the rear → oversteer;
   * throttle unloads the front → push. Same inputs, different car at speed.
   */
  weightTransferMul: 2.28,
  /** Bicycle understeer gradient. Higher = high-speed push, still tight in hairpins. */
  speedUndersteer: 0.00275,
  /** Lift-off oversteer mid-corner (GTA IV signature — close throttle, the tail comes). */
  liftOffYaw: 0.62,
  /** Extra yaw past the grip cap that still arrives (mushy breakaway, not a rail). */
  limitMush: 0.52,
  /** Visible chassis lean from lateral g — Traxion: IV exaggerates body roll. */
  bodyRollMul: 2.15,
  bodyRollMax: 0.155,
  /** Pitch from filtered long accel (rad per m/s²). Brake dive / throttle squat. */
  brakeDive: 0.0064,
  accelSquat: 0.0042,
  /**
   * RAGE / GTA IV yaw from tire forces (SAE bicycle Mz), not kinematic rWant.
   * Hairpins stay on the arcade bicycle; speed blends in tire-moment mass.
   */
  tireYawBlend: 0.62,
  /**
   * GTA analog: fTractionCurveMin / fTractionCurveMax gap
   * (handling.dat Wc- / Wc+). Scales muSlide so once you break away you
   * STAY sliding until you catch it. <1 = IV looser; 1 = V glued.
   */
  tractionMinMul: 0.86,
  /**
   * GTA analog: fLowSpeedTractionLossMult (handling.meta name; IV got the
   * same wheelspin from a low CurveMin). Small — hairpins must stay snappy.
   */
  lowSpeedTractionLoss: 0.18,
  /**
   * GTA analog: m_fDriveInertia (Ti). Physical scale: 1 = stock wheel I,
   * >1 heavier hubs / slower spin-up. IV's dat encodes the inverse
   * (1.0 = lightest); we do not copy that encoding.
   */
  driveInertia: 1.08,
  /**
   * Sprint 28 — dead-stop launch. Multiplies drive torque at 0 km/h and fades
   * linearly to 1.0 by launchFadeKmh so corners keep the same mid-speed balance.
   */
  launchBoost: 1.38,
  launchFadeKmh: 78,
  /**
   * Chassis stability — follow the axle-plane deck, filter only ribbon noise.
   * Player and AI share the planted hull; rivals still use cheap road probes.
   */
  roadChatterScale: 0.04,
  deckFollowRate: 55,
  /** Direct deck plant rate (1/s) — replaces spring bobble for the player. */
  groundPlantRate: 46,
  groundSpringHz: 28,
  groundSpringZeta: 1.22,
  /** Landing-squash follow rate (1/s). Accel/brake no longer pitch the mesh. */
  squatSmoothRate: 14,
  /**
   * Arcade automatic — tuned for fast rally fun, not economy cruising.
   * Hold gears near redline on throttle; drop early under brake / kick-down.
   */
  auto: {
    /** Fraction of redline for WOT upshift (hold the pull). */
    upWot: 0.955,
    /** Light-throttle upshift (fraction of redline). */
    upCoast: 0.68,
    /** Kick-down when throttle is pinned and RPM is below this. */
    kickDownRpm: 4800,
    /** Brake-downshift floor at light brake (rises with pedal). */
    brakeDownMin: 5000,
    /** Brake-downshift floor at full brake / handbrake. */
    brakeDownMax: 6400,
    /** Coasting downshift RPM (throttle shut, no brake). */
    coastDownRpm: 3400,
    /** Min seconds between shifts (brake path uses the short cool). */
    coolUp: 0.09,
    coolDown: 0.055,
    coolBrake: 0.04,
  },
};

/**
 * Jump model per Yoshio Fujimoto, the Safari rally driver who advised the
 * Saturn team: lift off just before the crest, brake so the nose drops, land
 * flat. Flat-out jumping is dangerous.
 *
 * The causal chain we implement: lifting unloads the launch (less vertical
 * throw), braking spins the wheels down and the reaction torque drops the
 * nose, and a chassis whose pitch matches the descent path lands on all four
 * wheels with almost no scrub. Nose-high arrivals land tail-first, scrub, and
 * leave the car unsettled for the next crest.
 */
export const JUMP = {
  /** Seconds of lift + brake before the lip that count as full technique. */
  techniqueWindow: 0.38,
  /**
   * Fraction of launch velocity kept by a perfectly executed lift.
   * Good technique lands flatter/lower; flat-out throws higher and arrives wrong.
   */
  liftLaunchCut: 0.62,
  /** Flat-out launch bonus (multiplies raw before technique cut). */
  flatOutLaunchBoost: 1.08,
  /** Nose-down attitude (rad) a full lift-and-brake buys you at the lip. */
  liftNoseDrop: 0.2,
  /**
   * Apex height multiplier (h ∝ vy²). Sprint 73: a bit more hang so a lip
   * reads as a throw, not a skip — still far under the old floaty 1.0.
   */
  launchHeightScale: 0.28,
  /**
   * Extra apex cut for AI / lowDetail pack only (h ∝ vy²). 0.2 = one-fifth of
   * the shared launchHeightScale flight — rivals were still lofting like rockets.
   */
  aiLaunchHeightScale: 0.2,
  /** Ballistic launch ceiling (m/s) after launchHeightScale. */
  maxLaunchVy: 12,
  /**
   * Floor only for real lips — was 1.8 and forced a hop on every crest.
   * Tiny transitions can leave with near-zero vertical and still glide.
   */
  minLaunchVy: 0.08,
  /** Road-following vertical gain on ramps — speed × sin(pitch) × this. */
  rampVyScale: 0.62,
  /** How much stored ramp climb energy joins the ballistic leave (0–1). */
  throwBlend: 0.42,
  /**
   * Suspension stores energy on the ramp; the lip releases it into launch speed.
   * Scales with approach speed so fast lips pop higher than crawls.
   */
  springBurst: 2.55,
  springCompressRate: 3.8,
  springReleaseRate: 10,
  /** Throttle/brake weight transfer into compress while climbing a lip. */
  springThrottle: 0.48,
  springBrake: 0.7,
  springPitch: 3.2,
  /**
   * Attitude (rad, + = nose up) the driver commands in mid-air. Holding
   * throttle keeps the wheels driving and the nose up; braking spins them
   * down and the reaction torque tips the nose over.
   */
  airPitchUp: 0.24,
  airPitchDown: 0.22,
  airPitchRate: 4.6,
  airPitchMax: 0.42,
  /** In-air pitch inertia — lower = snappier rotation, higher = floaty tumble risk. */
  airPitchInertia: 1.7,
  airPitchDamp: 2.35,
  /**
   * Nose-high aero lift. Keep modest so flight stays a parabola — large values
   * flatten the apex into a floaty hang then a late drop (reads as a hop).
   */
  aeroFloat: 0.11,
  /** Pitch/path mismatch (rad) that counts as a fully botched arrival. */
  mismatchFull: 0.3,
  /**
   * Speed kept on a flat landing vs a fully mismatched one.
   *
   * THIS IS THE PAIR THAT DECIDES WHETHER TECHNIQUE PAYS. Lifting and braking
   * into a lip costs real speed on the approach, so a botched arrival has to
   * cost MORE than that or the taught line is a trap and flat-out wins — which
   * is the opposite of what the research asks for. Landing tail-first at speed
   * therefore drags off nearly a fifth of it in one hit, on top of the grip the
   * unsettled pool takes away afterwards. Widen the gap to make the technique
   * matter more; narrow it to make crests more forgiving.
   */
  flatScrub: 0.998,
  worstScrub: 0.72,
  /** Yaw kick (rad/s) a fully botched landing throws at you. */
  landUpsetYaw: 0.55,
  /**
   * "Teetering on the edge of control": each bad landing tops up an unsettled
   * pool that bleeds grip and adds yaw noise. It decays over this many
   * seconds, so a JUMP SEQUENCE compounds where a single jump forgives.
   */
  balanceDecay: 2.8,
  /**
   * Grip lost at a full unsettled pool. Enough to feel, not enough to spin.
   * This is the other half of the technique payoff and the part that makes a
   * jump SEQUENCE bite: the corner after a botched crest is where you actually
   * pay for it, because the pool is still draining when you get there.
   */
  balanceGripLoss: 0.2,
  /**
   * RAGE-style rigid-body air (GTA IV/V vehicle, not ped Euphoria).
   * Variation is state at the lip — speed, attitude, compress, line — never RNG.
   */
  lipGrain: 0.045,
  inheritPitch: 0.55,
  airRollMax: 0.2,
  airRollDamp: 1.85,
  landBounce: 0.16,
  landBounceImpact: 6.2,
};

/**
 * Chassis templates — AM3 picked these because they were real WRC cars that
 * had never raced each other (Celica vs Delta), plus the hidden 2WD Stratos.
 */
const CHASSIS = {
  mass: 1260,
  yawInertia: 2480,
  pitchInertia: 860,
  rollInertia: 640,
  wheelbase: 2.55,
  trackFront: 1.51,
  trackRear: 1.51,
  /** Real-world overall length (m) — GLB fit target; 1 unit = 1 m in track space. */
  lengthM: 4.37,
  cgHeight: 0.41,
  wheelRadius: 0.32,
  restLength: 0.34,
  travel: 0.16,
  spring: 36000,
  damper: 5200,
  damperBump: 5600,
  damperRebound: 4400,
  antiRollFront: 6200,
  antiRollRear: 4400,
  maxSteer: 0.48,
  /** Weighted rack — still quick in hairpins, heavy at speed (GTA IV). */
  steerSpeed: 88,
  steerReturn: 102,
  /** High-speed mute — the nose pushes above 150 km/h instead of snapping. */
  steerFalloff: 0.014,
  yawGain: 1.18,
  /**
   * GTA analog: m_fTractionBias (Wh). 0.5 = equal axles. Lower = more rear
   * grip = planted Sultan 4WD. Higher = more front grip = Comet oversteer.
   */
  tractionBiasFront: 0.46,
  /**
   * Sprint 28 — Group A launch. peakPowerKw scales the torque map in vehicle.js.
   * Dead-stop pull uses launchBoost + a fatter low-RPM curve + shorter 1st.
   */
  peakPowerKw: 272,
  redline: 7500,
  idleRpm: 950,
  /**
   * Index 0 is NEUTRAL (ratio 0), then four forward gears — the Saturn box.
   * Sprint 28: shorter 1–2 for hard launches; 4th (~0.95) still meets maxSpeed.
   */
  gears: [0, 3.55, 2.08, 1.4, 0.95],
  topGear: 4,
  finalDrive: 4.35,
  drivetrain: "4wd",
  torqueSplitFront: 0.5,
  engineBrake: 0.34,
  /** Sprint 28: less aero wall so top-end keeps pulling after the launch. */
  aeroDrag: 0.33,
  downforce: 0.16,
  /** Soft ceiling (m/s × surface.speedScale). Celica cruises ~250 on tarmac. */
  maxSpeedKmh: 250,
  driftMul: 1.0,
};

export const CARS = {
  celica: {
    ...CHASSIS,
    id: "celica",
    name: "CELICA GT-FOUR",
    short: "CELICA",
    blurb: "4WD  ·  planted power-slide — learn the stage",
    driftMul: 1.0,
    engineName: "3S-GTE turbo",
    turbo: true,
  },
  delta: {
    ...CHASSIS,
    id: "delta",
    name: "DELTA HF",
    short: "DELTA",
    blurb: "4WD  ·  snappy Integrale — rotate and go",
    lengthM: 3.85,
    yawInertia: 1780,
    maxSteer: 0.46,
    steerSpeed: 112,
    steerReturn: 94,
    yawGain: 1.28,
    tractionBiasFront: 0.50,
    /** A hair under Celica top — same punch, still catchable in hairpins. */
    maxSpeedKmh: 246,
    driftMul: 1.08,
    engineName: "2.0 16v turbo",
    turbo: true,
  },
  stratos: {
    ...CHASSIS,
    id: "stratos",
    name: "STRATOS HF",
    short: "STRATOS",
    blurb: "RWD  ·  fastest, loosest — hold it with throttle",
    mass: 980,
    yawInertia: 1420,
    lengthM: 3.71,
    wheelbase: 2.18,
    drivetrain: "2wd",
    torqueSplitFront: 0,
    maxSteer: 0.48,
    steerSpeed: 122,
    steerReturn: 90,
    steerFalloff: 0.009,
    yawGain: 1.32,
    tractionBiasFront: 0.56,
    driveInertia: 0.92,
    /** Sprint 28: stays the fastest car (~265), still surface-limited. */
    maxSpeedKmh: 265,
    peakPowerKw: 288,
    driftMul: 1.16,
    /** Starter car — unlocked with Celica / Delta from SELECT CAR. */
    locked: false,
    idleRpm: 1100,
    redline: 7800,
    /** Taller box than the 4WDs; shorter 1st for launch. */
    gears: [0, 3.25, 1.95, 1.35, 0.92],
    engineName: "Dino 2.4 V6",
    turbo: false,
  },
};

/** Castrol Celica GT-Four ST205-inspired chassis (default player car). */
export const CELICA = CARS.celica;

export const CAMERA = {
  chaseDistance: 7.8,
  chaseHeight: 2.08,
  lookAhead: 13,
  stiffness: 28,
  fov: 60,
  /**
   * Extra FOV at speed — Model 2 “the world rushes in,” IV chase-cam mass UI.
   * Punch ≈ speed(m/s) × speedFov, capped by maxFovPunch (~18° flat-out).
   */
  speedFov: 0.30,
  maxFovPunch: 18,
  /** World-up lean from chassis roll (IV chase leans with the car). */
  rollFollow: 0.48,
  /** How hard chase yaw tracks the car — high = no “camera late” lag. */
  yawStiffness: 36,
  /**
   * Chase look blends toward velocity in a slide so the road you are sliding
   * toward stays in frame while the car sits at an angle (arcade poster).
   */
  slideLook: 0.62,
  /** Metres of camera offset to the outside of a power slide. */
  slideCamOut: 0.95,
  /**
   * Seconds for a C-key pose ease. Short enough to feel instant, long enough
   * to read as a move instead of a cut. From-pose rides with the car.
   */
  viewBlendTime: 0.22,
  /** Chase follow while settled — snappy, no float. */
  viewBlendStiffness: 26,
  /** Seat lock once POV blend finishes (hard copy, this is a fallback). */
  povBlendStiffness: 42,
  /** FOV / near ease while settled. During a C-key blend they track the pose. */
  fovBlendStiffness: 18,
  /** Metres from POV eye before the cabin attaches. */
  povAttachDist: 1.35,
  /** Pull back this far before restoring the exterior body when leaving POV. */
  povDetachDist: 1.6,
  /**
   * Extra frames the rearview may reuse its last image after seating.
   * Never used when the RT is empty — that path captures immediately.
   */
  mirrorDeferFrames: 1,
  /** C cycles POV → medium chase → far. Default race view is medium. */
  defaultMode: 1,
  views: [
    {
      id: "pov",
      label: "POV",
      /** Fallback — per-car rig from celica.getPovRig() overrides these. */
      eyeX: -0.36,
      eyeY: 1.12,
      eyeZ: -0.12,
      lookY: 1.02,
      lookZ: 3.4,
      fov: 76,
      stiffness: 42,
      near: 0.05,
    },
    {
      id: "medium",
      label: "MEDIUM",
      /** Default chase — 50% further back than 3.98 m so the rear bumper stays in frame. */
      back: 5.97,
      height: 1.80,
      lookAhead: 8.2,
      lookY: 0.5,
      fov: 62,
      /** Mild speed squat — keeps pavement in frame without burying the roof. */
      speedDropMax: 0.16,
      stiffness: 24,
      near: 0.22,
    },
    {
      id: "far",
      label: "FAR",
      /** Higher / wider for pack readability — leave alone for Sprint 19 speed pass. */
      back: 13.6,
      height: 4.05,
      lookAhead: 19,
      lookY: 0.62,
      fov: 54,
      stiffness: 18,
      near: 0.28,
    },
  ],
};

/**
 * Arcade championship, per the research brief: ONE LAP per course, 14 computer
 * opponents, you start 15th, and the clock is extended at checkpoints. Six
 * checkpoints are split unevenly across the first three courses (1 / 2 / 3 —
 * see js/tracks/courses.js). The split follows stage LENGTH, not stage count:
 * a checkpoint buys back time proportional to how much driving is left, which
 * lands at roughly one per 35-40 s of lap.
 * Finishing position ROLLS OVER into the next course. Nothing hard-fails a run:
 * walls and rivals glance, there is no off-course elimination.
 * Lakeside unlocks only from 1st after Mountain. Practice is two laps.
 */
export const CHAMPIONSHIP = {
  opponents: 14,
  /**
   * A full 14-car pack on every stage, as shipped. Tight stages get a longer
   * grid pitch instead of fewer cars so the field still thins out into a
   * believable running order before the first corner.
   */
  opponentsByCourse: {
    desert: 14,
    forest: 14,
    mountain: 14,
    lakeside: 14,
  },
  startPosition: 15,
  /** One checkpoint buys back roughly a third of a stage. */
  checkpointBonus: 25,
  gridSpacing: 10,
  gridSpacingByCourse: {
    forest: 13,
    mountain: 13,
    lakeside: 12,
  },
  practiceOpponents: 1,
  practiceLaps: 2,
  /**
   * Starting clock per stage, in seconds. DIFFICULTY DIAL: raise to forgive.
   *
   * Calibrated against two measured reference points per stage, not guesswork:
   *
   *  1. A theoretical optimum from the layout itself (corner-radius-limited
   *     speed, then a brake pass, then an accel pass, on the same per-surface mu
   *     the tire model uses): Desert 84 s, Forest 91 s, Mountain 96 s,
   *     Lakeside 66 s. No human hits this; it is the floor.
   *  2. Actual driven laps by the AI field in the real physics. Front-runner /
   *     back-marker: Desert 106/130 s, Forest 105/134 s, Mountain 122/155 s,
   *     Lakeside 81/105 s.
   *
   * Total clock available is stageTime + checkpoints * checkpointBonus, so:
   * Desert 125 s, Forest 136 s, Mountain 153 s, Lakeside 102 s. The front of the
   * field clears that with 19-31 s in hand, and the very back of the field does
   * not clear it at all — driving at back-marker pace should genuinely time out,
   * which is the point of a rally clock. If the pack could not beat the clock the
   * championship would make no sense; if everyone could, it would not be a rally.
   *
   * STILL NEEDS A HUMAN LAP. A real player sits somewhere between the two
   * references and nobody has driven these in a browser yet, so treat these as a
   * safe starting point that errs generous rather than as final balance.
   */
  stageTime: {
    desert: 108,
    forest: 68,
    mountain: 86,
    lakeside: 56,
  },
};

/**
 * Opponent pace and personality.
 *
 * Goal from the brief: rivals should read as drivers, not as a train. They get
 * surface-aware pace, believable slides, occasional small mistakes, and a
 * rubber band tight enough to stay invisible. They must be beatable, and they
 * must never punt the player off the road.
 */
export const AI = {
  /**
   * Sprint 26: pack must outpace a throttle-only player. Floor/ceiling raised so
   * holding accelerate without steering cannot casually take 1st on every stage.
   */
  skillFloor: 0.9,
  skillCeiling: 1.05,
  /** Corner-entry braking bias. Higher = more trail-braking, later apex. */
  trailBrake: 0.55,
  /** Seconds between a rival's chances to make a small mistake. */
  mistakeInterval: 8.5,
  /** Peak size of a mistake: a late brake, a wide line, a scruffy exit. */
  mistakeSize: 0.22,
  /**
   * Catch-up authority, as a fraction of throttle. Still invisible — only when
   * a rival is behind the player after a mistake.
   */
  rubberBand: 0.09,
  /** Metres of gap at which the rubber band reaches full (still tiny) effect. */
  rubberBandRange: 200,
  /** Pro line: tighter apex on tarmac, wider on loose surfaces. */
  proLineTarmac: 1.18,
  proLineLoose: 0.82,
  /** Extra look-ahead for braking points (metres). */
  proLookNear: 2,
  proLookFar: 6,
  /** Extra skill per stage so Forest/Mountain/Lakeside rivals keep pace with the player. */
  skillByCourse: {
    desert: 0.02,
    forest: 0.04,
    mountain: 0.07,
    lakeside: 0.1,
  },
  /**
   * Rivals yield harder to the player than to each other. AM3 championship has
   * no crash-out, so a rival must never be the reason a run ends.
   */
  playerRespect: 1.85,
  /**
   * Drift discipline. A rival that stays flat on the throttle while sideways
   * keeps its own slide alive, scrubs all its speed away, and laps at a fraction
   * of the pace a player manages — it looks less like a driver and more like a
   * dog chasing its tail. These three make them LIFT when the angle gets away
   * from them, which is what a real driver does and what makes the save read as
   * driving rather than luck.
   *
   * driftTarget: slide angle (rad) a rival is happy to carry on the throttle.
   *   About 17°, a usable rally drift, so they still look committed.
   * driftPanic: extra angle (rad) beyond the target at which they are fully off
   *   the throttle and just gathering it up.
   * driftMinThrottle: they never lift ALL the way, so a slide still gets driven
   *   out rather than dying in the middle of the road.
   */
  driftTarget: 0.28,
  driftPanic: 0.45,
  driftMinThrottle: 0.22,
  /**
   * Corner-speed margin. Sprint 26: rivals lean closer to the limit so a clean
   * AI lap beats a no-steer throttle hold.
   */
  cornerMargin: 0.98,
};

/** Co-driver look-ahead (Kenneth Ibrahim-style pace notes). Sprint 8: act-on timing. */
export const PACE = {
  /** Minimum metres to scan ahead at low speed. */
  look: 72,
  /** Cap so hairpins do not call corners half a lap early. */
  lookMax: 190,
  /** Seconds of warning at speed — game.js uses max(look, speed * leadSeconds). */
  leadSeconds: 2.85,
  /** Seconds between shouted calls. */
  speakGap: 2.0,
  /** Minimum metres before the same corner can be called again at speed. */
  recallMetres: 14,
  /** Metres of re-call gap added per m/s of road speed. */
  recallSpeedScale: 0.32,
  /** Delay before medium/easy calls fire (ms). Hard calls are instant. */
  speakDelayMs: 28,
  hardSpeakDelayMs: 0,
};
