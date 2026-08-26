# Glitch report — road integrity

**Date:** 2026-08-26T19:56:33.384Z
**Department:** Glitch / QA — stay on the road.
**Contract:** The car never glitches on the painted lane and never teleports.

## Automated drive

| Course | Samples | Dist (m) | Speed max | Glitch hits | Teleports | Buried | NaN | Verdict |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| desert | 32 | 45.1 | 24.6 | 0 | 0 | 0 | 0 | **PASS** |
| forest | 32 | 51.8 | 27.1 | 0 | 0 | 0 | 0 | **PASS** |
| mountain | 32 | 64.9 | 31.4 | 0 | 0 | 0 | 0 | **PASS** |

## Static gates

Ribbon lock, along-track continuity in `Track.query`, live `_guardDrive`, phone quality start.

**Proof:** `node tools/qa-sprint75-glitch.mjs`
