// Air Strings audio: Karplus-Strong voices (AudioWorklet, with a buffer
// fallback) on top of the shared AudioCore chain.

import { AudioCore } from './audio-core.js';

export class StringSynth extends AudioCore {
  constructor() {
    super({ volume: 0.8, reverb: 0.18 });
    this.node = null;
    this.log = []; // recent plucks, handy for debugging
    this.dropped = 0; // plucks lost while audio was paused
    this.mod = { sustain: 1, octave: false }; // set by Face control
  }

  async setup(ctx, input) {
    try {
      if (!ctx.audioWorklet) throw new Error('no AudioWorklet');
      await ctx.audioWorklet.addModule(new URL('./ks-worklet.js', import.meta.url));
      this.node = new AudioWorkletNode(ctx, 'karplus-strong', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
      });
      this.node.connect(input);
      return 'worklet';
    } catch (err) {
      console.warn('AudioWorklet unavailable, using buffer synthesis:', err);
      return 'buffer';
    }
  }

  /**
   * @param {object} p freq (Hz), amp (0..1), position (0..1 along string),
   *   pan (-1..1), stringId
   */
  pluck({ freq, amp = 0.7, position = 0.5, pan = 0, stringId = null }) {
    if (!this.ctx) return false;
    if (this.ctx.state !== 'running') {
      // Paused by the browser. Try to resume (works if this came from a tap);
      // otherwise the UI shows a "tap to turn sound on" banner.
      this.unlock();
      this.dropped++;
      return false;
    }
    const a = Math.max(0.05, Math.min(1, amp));
    if (this.mod.octave) freq *= 2;
    const msg = {
      type: 'pluck', freq, stringId, pan, sustain: this.mod.sustain,
      position: Math.min(position, 1 - position),
      amp: 0.12 + 0.55 * a,
      brightness: 0.35 + 0.6 * a,
    };
    this.log.push({ t: performance.now(), freq, amp: a, stringId });
    if (this.log.length > 50) this.log.shift();
    if (this.mode === 'worklet') {
      this.node.port.postMessage(msg);
    } else if (this.mode === 'buffer') {
      this.playBuffer(msg);
    }
    return true;
  }

  stopAll() {
    if (this.node) this.node.port.postMessage({ type: 'stopAll' });
  }

  // Fallback: render the same algorithm into a buffer on the main thread.
  playBuffer(msg) {
    const ctx = this.ctx;
    const buffer = renderKarplusStrong(ctx.sampleRate, msg, 3.5);
    const src = ctx.createBufferSource();
    src.buffer = buffer.toAudioBuffer(ctx);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) { pan.pan.value = msg.pan; src.connect(pan).connect(this.input); }
    else src.connect(this.input);
    src.start();
  }
}

/** Offline Karplus-Strong (used only when AudioWorklet is unavailable). */
export function renderKarplusStrong(sr, { freq, amp, position, brightness }, seconds) {
  const rho = 0.5 - 0.3 * Math.min(1, Math.max(0, (freq - 110) / 550));
  const delay = Math.max(2, sr / freq - rho);
  const size = Math.ceil(delay) + 4;
  const buf = new Float32Array(size);
  const n = Math.ceil(delay);
  let lp = 0;
  const a = 0.15 + 0.85 * brightness;
  const noise = new Float32Array(n);
  for (let i = 0; i < n; i++) { lp += a * ((Math.random() * 2 - 1) - lp); noise[i] = lp; }
  const comb = Math.max(1, Math.round(n * Math.max(0.05, position)));
  let peak = 1e-6;
  for (let i = 0; i < n; i++) {
    buf[i] = noise[i] - (i >= comb ? noise[i - comb] * 0.9 : 0);
    peak = Math.max(peak, Math.abs(buf[i]));
  }
  for (let i = 0; i < n; i++) buf[i] *= amp / peak;
  const t60 = 2.2 + 2.6 * Math.min(1, 110 / freq);
  const gain = Math.pow(10, -3 / (freq * t60));
  const len = Math.floor(sr * seconds);
  const out = new Float32Array(len);
  let w = n % size, last = 0;
  for (let i = 0; i < len; i++) {
    let rp = w - delay;
    while (rp < 0) rp += size;
    const i0 = Math.floor(rp), f = rp - i0;
    const s = buf[i0] + (buf[(i0 + 1) % size] - buf[i0]) * f;
    buf[w] = gain * ((1 - rho) * s + rho * last);
    last = s;
    w = (w + 1) % size;
    out[i] = s;
  }
  return {
    data: out,
    toAudioBuffer(ctx) {
      const b = ctx.createBuffer(1, len, sr);
      b.getChannelData(0).set(out);
      return b;
    },
  };
}

