// Theremin voice: two oscillators -> tone filter -> level -> shared AudioCore
// chain (reverb, limiter, iOS handling). Pitch and level glide smoothly with
// setTargetAtTime so hand jitter never clicks.

import { AudioCore } from './audio-core.js';

export const VOICES = {
  classic: {
    label: 'Classic',
    // Mostly sine with a little 2nd/3rd harmonic: the "singing saw" theremin tone.
    harmonics: [0, 1, 0.22, 0.1, 0.04, 0.02],
    detune: 0, mix2: 0,
    filter: 4200, q: 0.4, track: 0, // filter doesn't follow pitch
    gain: 0.42, reverb: 0.22,
  },
  soft: {
    label: 'Soft',
    type: 'triangle',
    detune: 4, mix2: 0.35, type2: 'sine',
    filter: 1500, q: 0.6, track: 1.5, // brighter as you go up
    gain: 0.5, reverb: 0.3,
  },
  scifi: {
    label: 'Sci-fi',
    type: 'sawtooth',
    detune: 9, mix2: 0.7, type2: 'square',
    filter: 900, q: 9, track: 2.2,
    gain: 0.28, reverb: 0.35,
  },
};

export class ThereminSynth extends AudioCore {
  constructor() {
    super({ volume: 0.8, reverb: VOICES.classic.reverb });
    this.voiceName = 'classic';
    this.sounding = false;
    this.lastFreq = 261.63;
    this.log = []; // [{t, freq, level}] samples for debugging
  }

  async setup(ctx, input) {
    this.osc1 = ctx.createOscillator();
    this.osc2 = ctx.createOscillator();
    this.mix1 = ctx.createGain();
    this.mix2 = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.level = ctx.createGain();
    this.level.gain.value = 0;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.wave = new Float32Array(this.analyser.fftSize);

    this.osc1.connect(this.mix1).connect(this.filter);
    this.osc2.connect(this.mix2).connect(this.filter);
    this.filter.connect(this.level).connect(input);
    this.level.connect(this.analyser);
    this.osc1.frequency.value = this.osc2.frequency.value = this.lastFreq;
    this.applyVoice(this.voiceName, true);
    this.osc1.start();
    this.osc2.start();
    return 'oscillator';
  }

  setVoice(name) {
    if (!VOICES[name]) return;
    this.voiceName = name;
    if (this.ctx) this.applyVoice(name, false);
  }

  applyVoice(name, immediate) {
    const v = VOICES[name], ctx = this.ctx, t = ctx.currentTime;
    if (v.harmonics) {
      const real = new Float32Array(v.harmonics.length);
      const imag = Float32Array.from(v.harmonics);
      this.osc1.setPeriodicWave(ctx.createPeriodicWave(real, imag));
    } else {
      this.osc1.type = v.type;
    }
    this.osc2.type = v.type2 || 'sine';
    this.osc2.detune.setValueAtTime(v.detune, t);
    const ramp = (param, value) => immediate ? param.setValueAtTime(value, t) : param.setTargetAtTime(value, t, 0.05);
    ramp(this.mix1.gain, 1 - (v.mix2 || 0) * 0.5);
    ramp(this.mix2.gain, v.mix2 || 0);
    ramp(this.filter.Q, v.q);
    this.setReverb(v.reverb);
    this.updateFilter(this.lastFreq, immediate);
  }

  updateFilter(freq, immediate) {
    const v = VOICES[this.voiceName];
    const cutoff = Math.min(16000, v.filter + v.track * freq);
    const t = this.ctx.currentTime;
    if (immediate) this.filter.frequency.setValueAtTime(cutoff, t);
    else this.filter.frequency.setTargetAtTime(cutoff, t, 0.03);
  }

  /**
   * Call every frame.
   * @param {object} s { sounding, freq, level (0..1) }
   * @param {number} glide seconds (time constant) for pitch changes
   */
  update({ sounding, freq, level }, glide = 0.02) {
    if (!this.ctx || !this.running) return false;
    const t = this.ctx.currentTime;
    const v = VOICES[this.voiceName];
    const target = sounding ? level * v.gain : 0;
    if (sounding && freq > 0) {
      if (!this.sounding) {
        // Note starts: jump straight to the pitch (no swoop from the last one).
        this.osc1.frequency.cancelScheduledValues(t);
        this.osc2.frequency.cancelScheduledValues(t);
        this.osc1.frequency.setValueAtTime(freq, t);
        this.osc2.frequency.setValueAtTime(freq, t);
      } else {
        this.osc1.frequency.setTargetAtTime(freq, t, glide);
        this.osc2.frequency.setTargetAtTime(freq, t, glide);
      }
      this.lastFreq = freq;
      this.updateFilter(freq, false);
    }
    // Fast-ish attack, slightly slower release so lifting a hand fades out.
    this.level.gain.setTargetAtTime(target, t, target > this.level.gain.value ? 0.025 : 0.08);
    this.sounding = sounding;
    this.log.push({ t: performance.now(), freq, level: sounding ? level : 0 });
    if (this.log.length > 120) this.log.shift();
    return true;
  }

  /** Latest output waveform (for drawing), or null. */
  waveform() {
    if (!this.analyser) return null;
    this.analyser.getFloatTimeDomainData(this.wave);
    return this.wave;
  }
}
