/**
 * Sample bank — decode recorded SFX to AudioBuffers.
 *
 * WHO THIS IS FOR: powertrain, skid, and one-shot voices.
 * WHAT IT DOES: fetches MP3 beds, decodes them, and optionally bakes a
 *   short end→start crossfade so BufferSource loops do not click.
 * HOW IT CONNECTS: RallyAudio modules call loadSample() after unlock.
 *
 * See assets/sfx/ATTRIBUTION.txt for licenses.
 */

/**
 * Decode MP3/WAV bytes. Copies the buffer because decodeAudioData detaches it.
 * @param {AudioContext} ctx
 * @param {ArrayBuffer} data
 * @returns {Promise<AudioBuffer>}
 */
export function decodeAudio(ctx, data) {
  const copy = data.slice(0);
  try {
    const p = ctx.decodeAudioData(copy);
    if (p && typeof p.then === "function") return p;
  } catch {
    /* older WebKit wants the callback form */
  }
  return new Promise((resolve, reject) => {
    ctx.decodeAudioData(data.slice(0), resolve, reject);
  });
}

/**
 * Mix the last `fadeSec` onto the start and drop that tail so a full-buffer
 * loop is continuous.
 * @param {AudioContext} ctx
 * @param {AudioBuffer} src
 * @param {number} fadeSec
 * @returns {AudioBuffer}
 */
export function bakeLoop(ctx, src, fadeSec) {
  const sr = src.sampleRate;
  const fade = Math.min(Math.floor(fadeSec * sr), Math.floor(src.length / 6));
  if (fade < 64) return src;
  const outLen = src.length - fade;
  const out = ctx.createBuffer(src.numberOfChannels, outLen, sr);
  for (let ch = 0; ch < src.numberOfChannels; ch++) {
    const a = src.getChannelData(ch);
    const b = out.getChannelData(ch);
    for (let i = 0; i < outLen; i++) {
      if (i < fade) {
        const t = i / fade;
        b[i] = a[i] * t + a[src.length - fade + i] * (1 - t);
      } else {
        b[i] = a[i];
      }
    }
  }
  return out;
}

/**
 * Fetch one sample. Failed loads log and return null so the race still runs.
 * @param {AudioContext} ctx
 * @param {string} url
 * @param {number} [loopFade]
 * @returns {Promise<AudioBuffer|null>}
 */
export async function loadSample(ctx, url, loopFade = 0) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("sfx fetch " + url);
    const decoded = await decodeAudio(ctx, await res.arrayBuffer());
    return loopFade > 0 ? bakeLoop(ctx, decoded, loopFade) : decoded;
  } catch (err) {
    console.warn("SFX sample failed", url, err);
    return null;
  }
}

/**
 * Play a one-shot buffer through dest with a short gain envelope.
 * @param {AudioContext} ctx
 * @param {AudioNode} dest
 * @param {AudioBuffer|null} buf
 * @param {{gain?:number, rate?:number, when?:number, dur?:number}} [opt]
 */
export function playHit(ctx, dest, buf, opt = {}) {
  if (!buf) return;
  const when = opt.when || ctx.currentTime;
  const rate = opt.rate || 1;
  const peak = opt.gain || 0.4;
  const dur = opt.dur || buf.duration / rate;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), when + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  src.connect(g);
  g.connect(dest);
  src.start(when);
  src.stop(when + dur + 0.04);
}
