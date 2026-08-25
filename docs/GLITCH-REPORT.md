# Glitch report — road integrity

**Date:** 2026-08-25T14:03:20.102Z
**Department:** Glitch / QA — stay on the road.
**Contract:** The car never glitches on the painted lane and never teleports.

## Automated drive

| Course | Samples | Dist (m) | Speed max | Glitch hits | Teleports | Buried | NaN | Verdict |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| desert | 32 | 43.8 | 24.2 | 0 | 0 | 0 | 0 | **PASS** |
| forest | 32 | 53.1 | 27.4 | 0 | 0 | 0 | 0 | **PASS** |
| mountain | 32 | 66.0 | 31.6 | 0 | 0 | 0 | 0 | **PASS** |

## Static gates

Ribbon lock, along-track continuity in `Track.query`, live `_guardDrive`, phone quality start.

**Proof:** `node tools/qa-sprint75-glitch.mjs`
