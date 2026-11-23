// One Euro filter (Casiez et al. 2012): low jitter when still, low lag when moving.

class LowPass {
  constructor() { this.y = null; }
  filter(x, alpha) {
    this.y = this.y === null ? x : this.y + alpha * (x - this.y);
    return this.y;
  }
}

const alphaFor = (cutoff, dt) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

export class OneEuro {
  constructor({ minCutoff = 1.2, beta = 0.01, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = new LowPass();
    this.dx = new LowPass();
    this.lastT = null;
    this.lastX = null;
  }
  reset() { this.x = new LowPass(); this.dx = new LowPass(); this.lastT = null; this.lastX = null; }
  filter(value, tSeconds) {
    if (this.lastT === null) {
      this.lastT = tSeconds; this.lastX = value;
      return this.x.filter(value, 1);
    }
    const dt = Math.max(1e-3, tSeconds - this.lastT);
    this.lastT = tSeconds;
    const deriv = (value - this.lastX) / dt;
    this.lastX = value;
    const edx = this.dx.filter(deriv, alphaFor(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.x.filter(value, alphaFor(cutoff, dt));
  }
}

/** Convenience: filters a 2D point. */
export class OneEuro2D {
  constructor(opts) { this.fx = new OneEuro(opts); this.fy = new OneEuro(opts); }
  reset() { this.fx.reset(); this.fy.reset(); }
  filter(x, y, t) { return { x: this.fx.filter(x, t), y: this.fy.filter(y, t) }; }
}
