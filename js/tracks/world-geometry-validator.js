/**
 * WorldGeometryValidator — post-build geometry integrity for rally stages.
 *
 * WHO THIS IS FOR: QA, debug overlays, Cursor after stage edits.
 * WHAT IT DOES: Detects floating/buried road samples, props in exclusion /
 *   tunnel volumes, and reports severity. Does not auto-fix geometry.
 * HOW IT CONNECTS: Track after buildAsync; ?worldvalidate=1 or tools/qa.
 *
 * POWER BI MAPPING: none
 *
 * Rules: docs/WORLD_GEOMETRY_RULES.md
 */

import { shoulderPadForScenery } from "./track-clearance.js?v=2";
import { buildTunnelVolumes, tunnelExclusionHalf } from "./tunnel-volume.js?v=3";
import { TerrainConfig } from "./world-config.js?v=1";

/**
 * @typedef {{
 *   severity: 'error'|'warn'|'ok',
 *   code: string,
 *   message: string,
 *   dist?: number,
 *   x?: number,
 *   y?: number,
 *   z?: number,
 * }} GeomIssue
 */

/**
 * @typedef {{
 *   ok: boolean,
 *   errors: GeomIssue[],
 *   warnings: GeomIssue[],
 *   stats: object,
 * }} GeomReport
 */

/**
 * @param {import('./track.js').Track|object} track
 * @param {{ scenery?: string, sampleStep?: number, floatTol?: number, buryTol?: number }} [opts]
 * @returns {GeomReport}
 */
export function validateWorldGeometry(track, opts = {}) {
  /** @type {GeomIssue[]} */
  const errors = [];
  /** @type {GeomIssue[]} */
  const warnings = [];

  const points = track.points || [];
  const scenery = opts.scenery || track._def?.scenery || "forest";
  const step = Math.max(1, opts.sampleStep | 0 || TerrainConfig.sampleStep);
  const floatTol = opts.floatTol != null ? opts.floatTol : TerrainConfig.floatTol;
  const buryTol = opts.buryTol != null ? opts.buryTol : TerrainConfig.buryTol;

  if (!points.length) {
    errors.push({
      severity: "error",
      code: "NO_SPLINE",
      message: "Track has no spline points",
    });
    return { ok: false, errors, warnings, stats: { samples: 0 } };
  }

  const volumes = buildTunnelVolumes(points);
  let floatRoad = 0;
  let buryRoad = 0;
  let tunnelOk = 0;
  let samples = 0;

  const groundFn =
    typeof track._groundHeight === "function"
      ? (x, z) => track._groundHeight(x, z, scenery)
      : null;

  for (let i = 0; i < points.length; i += step) {
    const p = points[i];
    samples++;
    if (!groundFn) continue;
    // Skip jump air samples — ribbon is intentionally above terrain.
    if (p.jump || p.jumpKind === "gap" || p.jumpKind === "crest" || p.jumpKind === "ramp") {
      continue;
    }
    // Also skip neighbours of a gap — ramp/land samples can still read as float.
    let nearJump = false;
    for (let j = Math.max(0, i - 3); j <= Math.min(points.length - 1, i + 3); j++) {
      const jk = points[j].jumpKind;
      if (jk === "gap" || jk === "crest") {
        nearJump = true;
        break;
      }
    }
    if (nearJump) continue;

    const gy = groundFn
      ? (() => {
          // Conform check must use THIS sample's deck — XZ nearest-road can
          // pick a folded lower/higher arm and false-fail climb stages.
          const nearHint = {
            dist: 0,
            roadY: p.y,
            roadW: p.width || 12,
            tunnel: !!p.tunnel,
            side: 0,
            along: p.dist,
            minOver: -(p.width || 12) * 0.5,
            overlapBed: null,
          };
          return track._groundHeight(p.x, p.z, scenery, nearHint);
        })()
      : null;
    if (gy == null || !Number.isFinite(gy)) {
      warnings.push({
        severity: "warn",
        code: "NO_GROUND",
        message: `No ground sample at dist ${p.dist.toFixed(0)}`,
        dist: p.dist,
        x: p.x,
        z: p.z,
      });
      continue;
    }

    const delta = p.y - gy;
    if (p.tunnel) {
      tunnelOk++;
      // Inside tunnel: terrain may be ridge above or carved — large delta OK.
      continue;
    }

    if (delta > floatTol) {
      floatRoad++;
      if (floatRoad <= 12) {
        errors.push({
          severity: "error",
          code: "FLOATING_ROAD",
          message: `Road float ${delta.toFixed(2)} m at dist ${p.dist.toFixed(0)}`,
          dist: p.dist,
          x: p.x,
          y: p.y,
          z: p.z,
        });
      }
    } else if (delta < -buryTol) {
      buryRoad++;
      if (buryRoad <= 12) {
        errors.push({
          severity: "error",
          code: "BURIED_ROAD",
          message: `Road buried ${(-delta).toFixed(2)} m at dist ${p.dist.toFixed(0)}`,
          dist: p.dist,
          x: p.x,
          y: p.y,
          z: p.z,
        });
      }
    }
  }

  // Prop / instance lateral samples — check keep-clear vs tunnel volumes.
  // We do not walk every InstancedMesh matrix (expensive); we re-check corridor
  // consistency: exclusion half-width must be >= shoulder pad convention.
  const pad = shoulderPadForScenery(scenery);
  if (pad < 6) {
    warnings.push({
      severity: "warn",
      code: "NARROW_CLEARANCE",
      message: `Shoulder pad ${pad} m is unusually narrow for ${scenery}`,
    });
  }

  for (const vol of volumes) {
    const half = tunnelExclusionHalf(vol);
    if (half < (vol.width || 10) * 0.5 + 2) {
      errors.push({
        severity: "error",
        code: "TUNNEL_MARGIN",
        message: `Tunnel ${vol.id} exclusion half ${half.toFixed(1)} too tight`,
        dist: vol.dist0,
      });
    }
    // Mouth aperture intrusion — sample ground at entrance/exit drive cone.
    // Catches Mountain land folding into the bore that FLOATING_ROAD skips
    // (tunnel samples are intentionally ignored for ridge stages).
    if (groundFn && points.length) {
      for (const target of [vol.entranceDist, vol.exitDist]) {
        let p = null;
        let ad = 1e9;
        for (let i = 0; i < points.length; i++) {
          const d = Math.abs(points[i].dist - target);
          if (d < ad) {
            ad = d;
            p = points[i];
          }
        }
        if (!p || p.nx == null) continue;
        const fx = Math.sin(p.heading);
        const fz = Math.cos(p.heading);
        const outward = target === vol.entranceDist ? -1 : 1;
        const probeLat = Math.min(half * 0.55, (p.width || 10) * 0.35);
        for (const side of [-1, 1]) {
          for (const along of [4, 12]) {
            const x = p.x + p.nx * side * probeLat + fx * outward * along;
            const z = p.z + p.nz * side * probeLat + fz * outward * along;
            const nearHint = {
              dist: probeLat,
              roadY: p.y,
              roadW: p.width || 12,
              tunnel: true,
              side,
              along: p.dist + outward * along,
              minOver: probeLat - (p.width || 12) * 0.5,
              overlapBed: null,
            };
            const gy =
              typeof track._groundHeight === "function"
                ? track._groundHeight(x, z, scenery, nearHint)
                : null;
            if (gy == null || !Number.isFinite(gy)) continue;
            const rise = gy - p.y;
            // Drive cone must stay near deck — anything > ~1.4 m walls the aperture.
            if (rise > 1.4) {
              errors.push({
                severity: "error",
                code: "TUNNEL_APERTURE",
                message: `Tunnel ${vol.id} aperture intrusion +${rise.toFixed(2)} m at dist ${target.toFixed(0)}`,
                dist: target,
                x,
                y: gy,
                z,
              });
            }
          }
        }
      }
    }
  }

  // Disconnected / zero-length
  if (track.length != null && track.length < 200) {
    warnings.push({
      severity: "warn",
      code: "SHORT_STAGE",
      message: `Stage length ${track.length.toFixed(0)} m is very short`,
    });
  }

  const stats = {
    samples,
    floatRoad,
    buryRoad,
    tunnelVolumes: volumes.length,
    tunnelSamplesSkipped: tunnelOk,
    length: track.length || 0,
    scenery,
  };

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats,
  };
}

/**
 * Format a report for console / overlay.
 * @param {GeomReport} report
 * @returns {string}
 */
export function formatGeomReport(report) {
  const lines = [
    `WorldGeometry: ${report.ok ? "GREEN" : "RED"}`,
    `  length=${(report.stats.length || 0).toFixed?.(0) ?? report.stats.length} samples=${report.stats.samples} tunnels=${report.stats.tunnelVolumes}`,
    `  floatingRoadHits=${report.stats.floatRoad} buriedRoadHits=${report.stats.buryRoad}`,
  ];
  for (const e of report.errors.slice(0, 20)) {
    lines.push(`  RED [${e.code}] ${e.message}`);
  }
  for (const w of report.warnings.slice(0, 12)) {
    lines.push(`  YELLOW [${w.code}] ${w.message}`);
  }
  if (report.ok && !report.warnings.length) lines.push("  GREEN all checks passed");
  return lines.join("\n");
}

/**
 * Attach report on track and optionally log.
 * @param {object} track
 * @param {object} [opts]
 * @returns {GeomReport}
 */
export function runWorldGeometryValidation(track, opts = {}) {
  const report = validateWorldGeometry(track, opts);
  track._geomReport = report;
  const wantLog =
    opts.log ||
    (typeof location !== "undefined" &&
      /[?&]worldvalidate=1(?:&|$)/.test(location.search));
  if (wantLog && typeof console !== "undefined") {
    console.info(formatGeomReport(report));
  }
  if (wantLog && typeof document !== "undefined") {
    paintWorldValidateBadge(report, track);
  }
  return report;
}

/**
 * On-screen GREEN/RED badge for ?worldvalidate=1 (in-game proof).
 * @param {GeomReport} report
 * @param {object} track
 */
function paintWorldValidateBadge(report, track) {
  let el = document.getElementById("world-validate-badge");
  if (!el) return;
  el.hidden = false;
  el.hidden = false;
  Object.assign(el.style, {
    position: "fixed",
    left: "8px",
    bottom: "8px",
    zIndex: "92",
    margin: "0",
    padding: "8px 10px",
    font: "11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace",
    pointerEvents: "none",
    whiteSpace: "pre",
    maxWidth: "min(420px, 94vw)",
    display: "block",
  });
  const scenery = report.stats.scenery || track._def?.scenery || "?";
  const id = track._def?.id || scenery;
  el.style.borderColor = report.ok ? "rgba(80, 220, 120, 0.55)" : "rgba(255, 80, 80, 0.65)";
  el.style.color = report.ok ? "#e8ffe8" : "#ffe8e8";
  el.style.background = report.ok ? "rgba(0, 20, 8, 0.82)" : "rgba(40, 0, 0, 0.85)";
  el.style.border = "1px solid " + (report.ok ? "rgba(80, 220, 120, 0.55)" : "rgba(255, 80, 80, 0.65)");
  el.style.borderRadius = "4px";
  el.textContent =
    formatGeomReport(report) +
    `\n  stage=${id}` +
    (report.ok ? "\n  Pass 1 geometry gate: GREEN" : "\n  Pass 1 geometry gate: RED — fix generators");
}
