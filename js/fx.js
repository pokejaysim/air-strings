// Little celebrations: sparks when you hit a note, a ring that spreads out,
// and confetti for three stars. One particle list, drawn in one pass with
// additive blending (no blur filters, which are slow on phones).

export const MAX_PARTICLES = 260;

export class FX {
  constructor() {
    this.p = [];
    this.rnd = Math.random;
  }

  get count() { return this.p.length; }

  _add(q) {
    if (this.p.length >= MAX_PARTICLES) this.p.shift(); // oldest go first
    this.p.push(q);
  }

  /** Sparks flying out from (x, y). `power` 0..1 scales how many and how far. */
  burst(x, y, hue, power = 1) {
    const n = Math.round(8 + 14 * power);
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2, v = (60 + 200 * this.rnd()) * (0.6 + 0.6 * power);
      this._add({ kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, hue: hue + (this.rnd() - 0.5) * 30, life: 0.45 + 0.35 * this.rnd(), age: 0, size: 1.5 + 2 * this.rnd() });
    }
    this._add({ kind: 'ring', x, y, hue, life: 0.5, age: 0, size: 14, grow: 70 * (0.7 + power) });
  }

  /** Confetti falling from the top of a W x H screen. */
  confetti(W, H, n = 140) {
    for (let i = 0; i < n; i++) {
      this._add({
        kind: 'confetti', x: this.rnd() * W, y: -10 - this.rnd() * H * 0.3,
        vx: (this.rnd() - 0.5) * 90, vy: 170 + 190 * this.rnd(),
        hue: Math.floor(this.rnd() * 360), life: 2.6 + this.rnd(), age: 0,
        size: 6 + 5 * this.rnd(), spin: (this.rnd() - 0.5) * 12, rot: this.rnd() * 6,
      });
    }
  }

  update(dt) {
    dt = Math.min(0.1, Math.max(0, dt));
    for (const q of this.p) {
      q.age += dt;
      if (q.kind === 'spark') { q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.9; q.vy = q.vy * 0.9 + 260 * dt; }
      else if (q.kind === 'confetti') { q.x += q.vx * dt + Math.sin(q.age * 3 + q.rot) * 0.6; q.y += q.vy * dt; q.rot += q.spin * dt; }
    }
    this.p = this.p.filter((q) => q.age < q.life);
  }

  draw(ctx) {
    if (!this.p.length) return;
    ctx.save();
    for (const q of this.p) {
      const k = 1 - q.age / q.life;
      if (q.kind === 'ring') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.beginPath();
        ctx.arc(q.x, q.y, q.size + q.grow * (1 - k), 0, Math.PI * 2);
        ctx.strokeStyle = `hsla(${q.hue}, 100%, 70%, ${0.8 * k})`;
        ctx.lineWidth = 1 + 4 * k;
        ctx.stroke();
      } else if (q.kind === 'spark') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `hsla(${q.hue}, 100%, ${65 + 25 * k}%, ${k})`;
        ctx.beginPath();
        ctx.arc(q.x, q.y, q.size * (0.5 + 0.5 * k), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = Math.min(1, k * 2);
        ctx.fillStyle = `hsl(${q.hue}, 90%, 62%)`;
        ctx.translate(q.x, q.y); ctx.rotate(q.rot);
        ctx.fillRect(-q.size / 2, -q.size / 4, q.size, q.size / 2);
        ctx.restore();
      }
    }
    ctx.restore();
  }
}
