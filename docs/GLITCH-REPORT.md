# Glitch report — road integrity

**Date:** 2026-08-27T18:51:34.854Z
**Department:** Glitch / QA — stay on the road.
**Contract:** The car never glitches on the painted lane and never teleports.

## Automated drive

| Course | Samples | Dist (m) | Speed max | Glitch hits | Teleports | Buried | NaN | Verdict |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| desert | 304 | 1497.9 | 56.5 | 3 | 0 | 0 | 0 | **PASS** |

### desert incidents

- `buried` t=21.767 progress=918.9589182306989 {"kind":"buried","t":21.767,"x":246.2194596901953,"y":3.836154304635379,"z":810.7633045807743,"progress":918.9589182306989,"floor":3.947999999999998,"prevY":3.9339999999999984}
- `buried` t=24.167 progress=1026.397471490146 {"kind":"buried","t":24.167,"x":347.10391049099906,"y":7.132076788860589,"z":847.8692166079874,"progress":1026.397471490146,"floor":7.194485096335595,"prevY":7.325033325114058}
- `buried` t=24.183 progress=1027.1414459075452 {"kind":"buried","t":24.183,"x":347.7963241193666,"y":7.23301169403691,"z":848.1414480163158,"progress":1027.1414459075452,"floor":7.343999999999997,"prevY":7.3299999999999965}
| forest | 304 | 1309.0 | 55.3 | 1 | 0 | 0 | 0 | **PASS** |

### forest incidents

- `buried` t=9.25 progress=263.80023578514226 {"kind":"buried","t":9.25,"x":79.20604648055487,"y":5.311130547354655,"z":238.41812987453918,"progress":263.80023578514226,"floor":5.431433593304994,"prevY":5.4460000000000015}
| mountain | 304 | 914.5 | 44.9 | 0 | 0 | 0 | 0 | **PASS** |

## Static gates

Ribbon lock, along-track continuity in `Track.query`, live `_guardDrive`, phone quality start.

**Proof:** `node tools/qa-sprint75-glitch.mjs`
