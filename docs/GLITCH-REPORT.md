# Glitch report — road integrity

**Date:** 2026-09-01T16:35:37.094Z
**Department:** Glitch / QA — stay on the road.
**Contract:** The car never glitches on the painted lane and never teleports.

## Automated drive

| Course | Samples | Dist (m) | Speed max | Glitch hits | Teleports | Buried | NaN | Verdict |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| desert | 304 | 1453.4 | 55.5 | 0 | 0 | 0 | 0 | **PASS** |
| forest | 304 | 1164.2 | 48.8 | 0 | 0 | 0 | 0 | **PASS** |
| mountain | 304 | 914.4 | 44.5 | 0 | 0 | 0 | 0 | **PASS** |

## Static gates

Ribbon lock, along-track continuity in `Track.query`, live `_guardDrive`, phone quality start.

**Proof:** `node tools/qa-sprint75-glitch.mjs`
