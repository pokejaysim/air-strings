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
    this.tone = 0.5;
    this.target = 0;          // last level target we scheduled (don't read gain.value back)
    this.targetLevel = 0;
    this.silentSince = 0;     // ctx time when the target last went to 0
    this.last = { freq: 0, level: 0, tone: 0.5, sounding: false }; // for debugging/tests
    this.face = null;         // { mouth, oo } while face control is on
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
    if (!this.ctx) return;
    if (this.target > 0.001) {
      // Duck for a moment so the waveform swap doesn't click.
      const t = this.ctx.currentTime;
      this.level.gain.setTargetAtTime(0, t, 0.008);
      setTimeout(() => {
        this.applyVoice(name, false);
        const v = VOICES[name];
        this.level.gain.setTargetAtTime(this.targetLevel * v.gain, this.ctx.currentTime, 0.02);
        this.target = this.targetLevel * v.gain;
      }, 35);
    } else {
      this.applyVoice(name, false);
    }
  }

  /** Fade out immediately (page hidden, etc.). */
  silence() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.level.gain.cancelScheduledValues(t);
    this.level.gain.setTargetAtTime(0, t, 0.02);
    this.target = 0;
    this.sounding = false;
    this.silentSince = t;
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
    if (this.face) {
      // Face control: a resonant "wah" that follows the note. Mouth closed sits
      // just above the note (dark, "mm"); wide open reaches past its 8th
      // harmonic. An "oo" pulls it lower and more hollow.
      const { cutoff, q } = faceFilter(freq, this.face.mouth, this.face.oo);
      const t = this.ctx.currentTime;
      if (immediate) { this.filter.frequency.setValueAtTime(cutoff, t); this.filter.Q.setValueAtTime(q, t); }
      else { this.filter.frequency.setTargetAtTime(cutoff, t, 0.03); this.filter.Q.setTargetAtTime(q, t, 0.05); }
      return;
    }
    // Tone (0 dark .. 1 bright) from the pitch hand's other direction.
    const toneMul = 0.45 + 1.3 * this.tone;
    const cutoff = Math.min(16000, (v.filter + v.track * freq) * toneMul);
    const t = this.ctx.currentTime;
    if (immediate) this.filter.frequency.setValueAtTime(cutoff, t);
    else this.filter.frequency.setTargetAtTime(cutoff, t, 0.03);
  }

  /**
   * Call every frame; only schedules audio changes when something changed.
   * @param {object} s { sounding, pitchPresent, freq, level (0..1), tone (0..1) }
   * @param {number} glide time constant (s) for pitch changes
   * @param {number} release time constant (s) for the level falling
   */
  update({ sounding, pitchPresent, freq, level, tone = 0.5, face = null }, glide = 0.02, release = 0.08) {
    if (!this.ctx || !this.running) return false;
    const t = this.ctx.currentTime;
    const v = VOICES[this.voiceName];
    const lvl = sounding ? level : 0;
    const target = lvl * v.gain;
    const freqChanged = freq > 0 && Math.abs(freq - this.lastFreq) > 0.01;
    const toneChanged = Math.abs(tone - this.tone) > 0.005;
    const levelChanged = Math.abs(target - this.target) > 1e-4;
    const faceToggled = !face !== !this.face;
    const faceChanged = faceToggled || (face && (Math.abs(face.mouth - this.face.mouth) > 0.01 || Math.abs(face.oo - this.face.oo) > 0.01));
    if (!freqChanged && !toneChanged && !levelChanged && !faceChanged && sounding === this.sounding) return true;
    if (faceChanged) {
      this.face = face ? { mouth: face.mouth, oo: face.oo } : null;
      if (faceToggled && !face) this.filter.Q.setTargetAtTime(v.q, t, 0.05); // back to the voice's own filter
    }

    if (pitchPresent && freq > 0 && freqChanged) {
      // Keep gliding even while silent, so re-articulating with the volume
      // hand doesn't jump. Only hard-set the pitch when it has been silent a while.
      const longSilent = this.target <= 1e-4 && t - this.silentSince > 0.35;
      if (sounding && !this.sounding && longSilent) {
        for (const o of [this.osc1, this.osc2]) { o.frequency.cancelScheduledValues(t); o.frequency.setValueAtTime(freq, t); }
      } else {
        this.osc1.frequency.setTargetAtTime(freq, t, glide);
        this.osc2.frequency.setTargetAtTime(freq, t, glide);
      }
      this.lastFreq = freq;
    }
    if (toneChanged || freqChanged || faceChanged) {
      this.tone = tone;
      this.updateFilter(this.lastFreq, false);
    }
    if (levelChanged) {
      // Fast-ish attack, slower release so lifting a hand fades out.
      this.level.gain.setTargetAtTime(target, t, target > this.target ? 0.025 : release);
      if (target <= 1e-4 && this.target > 1e-4) this.silentSince = t;
      this.target = target;
    }
    this.targetLevel = lvl;
    this.sounding = sounding;
    this.last = { freq: this.lastFreq, level: lvl, tone: this.tone, sounding };
    return true;
  }

  /** Latest output waveform (for drawing), or null. */
  waveform() {
    if (!this.analyser) return null;
    this.analyser.getFloatTimeDomainData(this.wave);
    return this.wave;
  }
}

/** The face "wah" filter for a note: { cutoff (Hz), q }. Exported for tests. */
export function faceFilter(freq, mouth, oo) {
  const f = Math.max(40, freq || 262);
  const open = Math.pow(Math.min(1, Math.max(0, mouth)), 1.3);
  const round = Math.min(1, Math.max(0, oo));
  const cutoff = Math.min(14000, Math.max(120, f * (1.1 + 9 * open) * (1 - 0.5 * round)));
  return { cutoff, q: 5 + 3 * round };
}
