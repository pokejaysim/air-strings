// Karplus-Strong plucked-string synthesis, running on the audio thread.
// Each pluck allocates a voice: a delay line one period long, filled with a
// shaped noise burst, fed back through an averaging low-pass filter.

const MAX_VOICES = 24;

class Voice {
  constructor(sr, msg) {
    const { freq, amp = 0.8, position = 0.5, brightness = 0.6, pan = 0, sustain = 1 } = msg;
    // Loop filter y = (1-rho)*s + rho*last delays the loop by rho samples.
    // Lighter filtering on high notes keeps them from dying too fast.
    this.rho = 0.5 - 0.3 * Math.min(1, Math.max(0, (freq - 110) / 550));
    this.delay = Math.max(2, sr / freq - this.rho);
    this.size = Math.ceil(this.delay) + 4;
    this.buf = new Float32Array(this.size);
    this.write = 0;
    this.last = 0;
    this.age = 0;
    this.maxAge = sr * 9;
    this.quiet = 0;

    // Per-period loop gain so low and high notes ring for a similar time.
    const t60 = (2.2 + 2.6 * Math.min(1, 110 / freq)) * sustain;
    this.gain = Math.pow(10, -3 / (freq * t60));

    // Excitation: noise, low-passed for softer plucks, then a comb at the
    // pluck position (plucking near the middle removes even harmonics).
    const n = Math.ceil(this.delay);
    const noise = new Float32Array(n);
    let lp = 0;
    const a = 0.15 + 0.85 * brightness;
    for (let i = 0; i < n; i++) {
      lp += a * ((Math.random() * 2 - 1) - lp);
      noise[i] = lp;
    }
    const combDelay = Math.max(1, Math.round(n * Math.min(0.5, Math.max(0.05, position))));
    let mean = 0;
    for (let i = 0; i < n; i++) {
      const v = noise[i] - (i >= combDelay ? noise[i - combDelay] : 0) * 0.9;
      this.buf[i] = v;
      mean += v;
    }
    mean /= n;
    let peak = 1e-6;
    for (let i = 0; i < n; i++) { this.buf[i] -= mean; peak = Math.max(peak, Math.abs(this.buf[i])); }
    const norm = amp / peak;
    for (let i = 0; i < n; i++) this.buf[i] *= norm;
    this.write = n % this.size;

    // Equal-power pan.
    const p = (Math.max(-1, Math.min(1, pan)) + 1) * Math.PI / 4;
    this.l = Math.cos(p);
    this.r = Math.sin(p);
    this.done = false;
  }

  render(outL, outR, frames) {
    const { buf, size, delay, gain, rho } = this;
    const keep = 1 - rho;
    let w = this.write, last = this.last, energy = 0;
    for (let i = 0; i < frames; i++) {
      let rp = w - delay;
      while (rp < 0) rp += size;
      const i0 = Math.floor(rp);
      const frac = rp - i0;
      const s0 = buf[i0];
      const s1 = buf[(i0 + 1) % size];
      const s = s0 + (s1 - s0) * frac;
      buf[w] = gain * (keep * s + rho * last);
      last = s;
      w = (w + 1) % size;
      outL[i] += s * this.l;
      outR[i] += s * this.r;
      energy = Math.max(energy, Math.abs(s));
    }
    this.write = w;
    this.last = last;
    this.age += frames;
    this.quiet = energy < 1e-4 ? this.quiet + frames : 0;
    if (this.age > this.maxAge || this.quiet > 4096) this.done = true;
  }
}

class KarplusStrongProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.voices = [];
    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'pluck') {
        // Re-plucking a string damps its previous voice, like a real string.
        if (msg.stringId != null) {
          for (const v of this.voices) {
            if (v.stringId === msg.stringId) { v.gain = Math.min(v.gain, 0.7); v.maxAge = v.age + sampleRate * 0.05; }
          }
        }
        const v = new Voice(sampleRate, msg);
        v.stringId = msg.stringId;
        this.voices.push(v);
        if (this.voices.length > MAX_VOICES) this.voices.shift();
      } else if (msg.type === 'stopAll') {
        this.voices = [];
      }
    };
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0], R = out[1] || out[0];
    L.fill(0);
    if (R !== L) R.fill(0);
    for (const v of this.voices) v.render(L, R, L.length);
    if (this.voices.some((v) => v.done)) this.voices = this.voices.filter((v) => !v.done);
    return true;
  }
}

registerProcessor('karplus-strong', KarplusStrongProcessor);
