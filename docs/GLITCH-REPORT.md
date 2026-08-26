# Glitch report — road integrity

**Date:** 2026-08-26T17:16:08.362Z
**Department:** Glitch / QA — stay on the road.
**Contract:** The car never glitches on the painted lane and never teleports.

## Automated drive

| Course | Samples | Dist (m) | Speed max | Glitch hits | Teleports | Buried | NaN | Verdict |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| desert | 32 | 42.6 | 23.9 | 0 | 0 | 0 | 0 | **PASS** |
| forest | 32 | 51.3 | 27.0 | 0 | 0 | 0 | 0 | **PASS** |
| mountain | 32 | 65.5 | 31.5 | 0 | 0 | 0 | 0 | **PASS** |

## Static gates

Ribbon lock, along-track continuity in `Track.query`, live `_guardDrive`, phone quality start.

**Proof:** `node tools/qa-sprint75-glitch.mjs`
