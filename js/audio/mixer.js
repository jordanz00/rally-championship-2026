/**
 * Rally mixer — Wwise-style bus architecture (Sprint 37).
 *
 * WHO THIS IS FOR: RallyAudio engine.js.
 * WHAT IT DOES: master → music / sfx / navigator buses; per-bus gain; reverb send
 *   on SFX; navigator isolated from engine ducking.
 * HOW IT CONNECTS: constructed in RallyAudio.unlock().
 */

import { ReverbZones } from "./reverb-zones.js?v=1";

const MASTER = 0.58;

/**
 * @param {AudioContext} ctx
 */
export function createRallyMixer(ctx) {
  const master = ctx.createGain();
  master.gain.value = MASTER;

  const musicBus = ctx.createGain();
  musicBus.gain.value = 1;
  const sfxBus = ctx.createGain();
  sfxBus.gain.value = 1;
  const navBus = ctx.createGain();
  navBus.gain.value = 1;

  master.connect(ctx.destination);
  musicBus.connect(master);
  sfxBus.connect(master);

  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 70;
  hp.Q.value = 0.7;

  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 7600;
  lp.Q.value = 0.65;

  const airCut = ctx.createBiquadFilter();
  airCut.type = "peaking";
  airCut.frequency.value = 4200;
  airCut.Q.value = 0.9;
  airCut.gain.value = -3.5;

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 10;
  comp.ratio.value = 2.4;
  comp.attack.value = 0.01;
  comp.release.value = 0.18;

  const sfxMaster = ctx.createGain();
  sfxMaster.gain.value = 1;

  hp.connect(lp);
  lp.connect(airCut);
  airCut.connect(comp);
  comp.connect(sfxMaster);
  sfxMaster.connect(sfxBus);

  const reverb = new ReverbZones(ctx, hp);

  return {
    master,
    musicBus,
    sfxBus,
    navBus,
    sfxIn: hp,
    sfxMaster,
    hp,
    comp,
    reverb,
    setSfxVolume(v) {
      sfxMaster.gain.setTargetAtTime(v, ctx.currentTime, 0.04);
    },
    setMusicVolume(v) {
      musicBus.gain.setTargetAtTime(v, ctx.currentTime, 0.04);
    },
  };
}
