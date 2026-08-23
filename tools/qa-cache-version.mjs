/**
 * Shared cache-bust version for QA gates (main.js → game.js chain).
 * @param {string} mainSrc
 * @param {string} indexSrc
 * @returns {{ gameV: string, mainV: string, ok: boolean }}
 */
export function readCacheVersions(mainSrc, indexSrc) {
  const gameV = (mainSrc.match(/game\.js\?v=(\d+)/) || [])[1] || "";
  const mainV = (indexSrc.match(/main\.js\?v=(\d+)/) || [])[1] || "";
  return { gameV, mainV, ok: !!(gameV && mainV && gameV === mainV) };
}
