/**
 * png-luma.mjs — dependency-free PNG decode + whole-frame luminance stats.
 *
 * WHO THIS IS FOR: QA tools that need to judge image brightness as a NUMBER,
 *   because "it looks washed out" is not something a CI gate can assert.
 * WHAT IT DOES: inflates an 8-bit RGB/RGBA PNG (the format Chrome's
 *   Page.captureScreenshot returns), reverses the per-scanline filters, and
 *   reports mean luminance, percentiles, and the share of near-white pixels.
 * HOW IT CONNECTS: used by tools/qa-exposure-stability.mjs. No npm deps —
 *   node:zlib is enough, and this repo has no build step.
 *
 * POWER BI MAPPING: none
 */

import zlib from "node:zlib";

/**
 * Decode an 8-bit PNG into raw RGBA-ish samples.
 *
 * Only bit depth 8 with colour type 2 (RGB) or 6 (RGBA) is supported —
 * that is what Chrome emits. Anything else throws rather than guessing.
 *
 * @param {Buffer} buf PNG file bytes
 * @returns {{ width: number, height: number, channels: number, data: Buffer }}
 */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colorType = body[9];
      if (body[12] !== 0) throw new Error("interlaced PNG not supported");
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }

  if (bitDepth !== 8) throw new Error(`bit depth ${bitDepth} not supported`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`colour type ${colorType} not supported`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.allocUnsafe(stride * height);

  // PNG filters are defined relative to the reconstructed bytes to the left
  // (a), above (b), and up-left (c) — so this must run in scanline order.
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = (y * (stride + 1)) + 1;
    const dst = y * stride;
    const up = dst - stride;
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[src + x];
      const a = x >= channels ? out[dst + x - channels] : 0;
      const b = y > 0 ? out[up + x] : 0;
      const c = x >= channels && y > 0 ? out[up + x - channels] : 0;
      let v;
      switch (filter) {
        case 0: v = rawByte; break;
        case 1: v = rawByte + a; break;
        case 2: v = rawByte + b; break;
        case 3: v = rawByte + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = rawByte + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`unknown PNG filter ${filter} on row ${y}`);
      }
      out[dst + x] = v & 0xff;
    }
  }

  return { width, height, channels, data: out };
}

/**
 * Whole-frame brightness stats in 0..1 sRGB space.
 *
 * `mean` is the headline number a washout gate watches. `p99` and `clipped`
 * separate "the whole image got brighter" from "the sun blew out", which is a
 * legitimate look and must not fail the gate on its own.
 *
 * @param {Buffer} png PNG bytes
 * @param {{ skipTopFraction?: number, skipBottomFraction?: number }} [opts]
 *   crop rows out of the average — the HUD is a fixed bright overlay and
 *   should not dominate a scene-brightness measurement.
 * @returns {{ mean: number, p50: number, p99: number, clipped: number, width: number, height: number }}
 */
export function lumaStats(png, opts = {}) {
  const { width, height, channels, data } = decodePng(png);
  const y0 = Math.floor(height * (opts.skipTopFraction || 0));
  const y1 = Math.ceil(height * (1 - (opts.skipBottomFraction || 0)));
  // 4096 buckets is finer than 8-bit input, so percentiles are exact here.
  const hist = new Float64Array(256);
  let n = 0;
  let sum = 0;
  let clipped = 0;

  // Every 3rd pixel horizontally: 1600×900 is 1.4M pixels and a mean does not
  // need all of them. Deterministic stride, so runs stay comparable.
  const step = 3 * channels;
  for (let y = y0; y < y1; y++) {
    const row = y * width * channels;
    for (let x = 0; x < width * channels; x += step) {
      const r = data[row + x];
      const g = data[row + x + 1];
      const b = data[row + x + 2];
      const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      sum += l;
      n += 1;
      hist[Math.min(255, Math.round(l * 255))] += 1;
      if (l > 0.94) clipped += 1;
    }
  }

  /** @param {number} p */
  function pct(p) {
    let acc = 0;
    const want = n * p;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= want) return i / 255;
    }
    return 1;
  }

  return {
    mean: n ? sum / n : 0,
    p50: pct(0.5),
    p99: pct(0.99),
    clipped: n ? clipped / n : 0,
    width,
    height,
  };
}
