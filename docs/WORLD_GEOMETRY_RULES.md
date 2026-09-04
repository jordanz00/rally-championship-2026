# World geometry rules

**Status:** Binding for stage generation / validation.  
**Quality contract:** [`QUALITY_STANDARD.md`](QUALITY_STANDARD.md) (higher priority than feature vibes).  
**Code:** `js/tracks/world-config.js` (tolerances) · `world-geometry-validator.js` · `track-clearance.js` · `tunnel-volume.js` · `stage-data-validate.js` · `track-definition.js`  
**Gate:** `node tools/qa-validate.mjs` · Debug: `?worldvalidate=1`

---

## Architecture principle

```
HUMAN-DESIGNED TrackDefinition (segments + purpose)
        ↓
   compile → pieces (straight / curve / jump)
        ↓
   Track._buildSpline → road + terrain conform + scenery
```

- **Racing line is authored** (segments with gameplay purpose).  
- **Environment is procedural** (trees/rocks) inside clearance rules.  
- Do **not** generate final racing lines from random spline noise.  
- Do **not** float a road ribbon over unrelated terrain — terrain conforms to the road (existing `_groundHeight` trench + skirts).

---

## Validation severities

| Color | Severity | Meaning |
|---|---|---|
| **RED** | error | Must fix before calling the stage “structurally excellent” |
| **YELLOW** | warn | Investigate; may be intentional (jumps, tunnels) |
| **GREEN** | ok | No errors |

---

## Rules

### Road / terrain

| Code | Rule |
|---|---|
| `FLOATING_ROAD` | Road sample Y − ground Y > **2.8 m** (non-jump, non-tunnel) → RED |
| `BURIED_ROAD` | Ground Y − road Y > **1.6 m** → RED |
| `NO_GROUND` | Missing ground sample → YELLOW |
| Jump air | Crest/gap samples skipped (intentional float) |
| Tunnel bore | Tunnel samples skipped for float/bury (ridge carve owns height) |

### Clearance corridor

```
exclusionHalf = roadHalf + shoulder (3.2) + scenery safety pad
```

Planting must start at `halfWidth + shoulderPad(scenery) + random spread`.  
Nothing unmarked may sit inside the road + shoulder + safety corridor.

Applies to: trees, rocks, bushes, buildings, fences, signs, props, debris.

### Tunnels (`TunnelVolume`)

A tunnel is a **volume**, not a decoration mesh through solid terrain.

| Step | Requirement |
|---|---|
| Mark | Contiguous `tunnel: true` pieces → volume (dist0–dist1, width, height, margin) |
| Terrain | Ridge / cut via existing `_tunnelCutHeight` / mouth floors |
| Props | No exterior plants on `point.tunnel` samples |
| Interior | Portal + lining + collision + lamps |
| Exit | Blend into terrain; no tris through the bore |

`TUNNEL_MARGIN` too tight → RED (`TUNNEL_MARGIN`).

### Props

| Issue | Detection (current / future) |
|---|---|
| Floating prop | Future: mesh AABB bottom vs ground + tol |
| Buried prop | Future: bottom ≪ ground |
| Prop ↔ road | Lateral offset &lt; exclusion → reject at plant time |
| Prop ↔ tunnel | Skip plant when `p.tunnel` |

### Stage quality (design — not auto-RED)

Every stage must use shared TrackDefinition / clearance / tunnel / validator tech ([`ALL_STAGES_AAA_STANDARD.md`](ALL_STAGES_AAA_STANDARD.md)). Intentional rhythm and landmarks — not random spline noise.

---

## Running validation

```js
import { runWorldGeometryValidation } from "./world-geometry-validator.js";
runWorldGeometryValidation(track, { log: true });
```

Or load a stage with `?worldvalidate=1`.

QA harness: `node tools/qa-world-geometry.mjs` (Mountain compile + sample validate).

---

## Do not

- Patch individual “tree #394 in road” forever — fix clearance.  
- Add more random props to hide floating roads.  
- Leave Desert/Forest/Lakeside on weaker track tech while Mountain advances alone.  
- Treat bridges as floating spans (Sprint 524) — use elevated open sections only.
