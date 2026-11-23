// Virtual strings: geometry, pull/vibration physics, and rendering.

import { pitchForLength, lengthFraction, E2 } from './pitch.js';

const MODES = 6;
let nextId = 1;

export class AirString {
  constructor({ ax, ay, bx, by, lengthFrac, scale }) {
    this.id = nextId++;
    this.ax = ax; this.ay = ay; this.bx = bx; this.by = by;
    this.lengthFrac = lengthFrac;
    this.modes = new Float32Array(MODES); // mode amplitudes in px
    this.phase = 0;
    this.vibAge = 0;
    this.pull = null; // { t, disp } while grabbed
    this.glow = 0; // flash after a pluck
    this.hover = 0;
    this.lastPluck = -Infinity;
    this.retune(scale);
  }

  retune(scale) {
    const p = pitchForLength(this.lengthFrac, scale);
    this.freq = p.freq; this.note = p.note; this.cents = p.cents;
    const x = Math.min(1, Math.max(0, Math.log2(this.freq / E2) / 3)); // 0 = E2, 1 = E5
    this.hue = 265 - 235 * x; // low = violet, high = amber
    this.visFreq = 3.5 + 5.5 * x; // a visible wobble rate, not the audio rate
    this.decay = 1.3 - 0.6 * x;
  }

  get length() { return Math.hypot(this.bx - this.ax, this.by - this.ay); }
  get dir() { const L = this.length || 1; return { x: (this.bx - this.ax) / L, y: (this.by - this.ay) / L }; }
  get normal() { const d = this.dir; return { x: -d.y, y: d.x }; }

  /** t = 0..1 along the string (unclamped), d = signed perpendicular distance. */
  project(px, py) {
    const L = this.length || 1, d = this.dir;
    const rx = px - this.ax, ry = py - this.ay;
    return { t: (rx * d.x + ry * d.y) / L, d: rx * -d.y + ry * d.x };
  }

  /** Distance from a point to the string segment. */
  distanceTo(px, py) {
    const { t, d } = this.project(px, py);
    if (t >= 0 && t <= 1) return Math.abs(d);
    const ex = t < 0 ? this.ax : this.bx, ey = t < 0 ? this.ay : this.by;
    return Math.hypot(px - ex, py - ey);
  }

  /** Set the initial shape of a pluck: a triangle of height h at position p. */
  excite(p, h) {
    p = Math.min(0.95, Math.max(0.05, p));
    for (let k = 1; k <= MODES; k++) {
      this.modes[k - 1] = (2 * h * Math.sin(k * Math.PI * p)) / (k * k * Math.PI * Math.PI * p * (1 - p));
    }
    this.vibAge = 0;
    this.glow = 1;
  }

  update(dt) {
    this.vibAge += dt;
    this.glow = Math.max(0, this.glow - dt * 1.6);
    this.hover = Math.max(0, this.hover - dt * 6);
  }

  /** Perpendicular displacement at position s (0..1). */
  displacement(s) {
    if (this.pull) {
      const { t, disp } = this.pull;
      return s <= t ? disp * (s / t) : disp * ((1 - s) / (1 - t));
    }
    const env = Math.exp(-this.vibAge / this.decay);
    if (env < 0.003) return 0;
    let y = 0;
    const w = 2 * Math.PI * this.visFreq * this.vibAge;
    for (let k = 1; k <= MODES; k++) y += this.modes[k - 1] * Math.sin(k * Math.PI * s) * Math.cos(w * k);
    return y * env;
  }

  isMoving() { return !!this.pull || Math.exp(-this.vibAge / this.decay) > 0.003; }

  draw(ctx) {
    const segs = this.isMoving() ? 56 : 1;
    const n = this.normal;
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const s = i / segs;
      const y = this.displacement(s);
      pts.push(this.ax + (this.bx - this.ax) * s + n.x * y, this.ay + (this.by - this.ay) * s + n.y * y);
    }
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    };
    const h = this.hue, g = Math.max(this.glow, this.hover * 0.6);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'lighter';
    path();
    ctx.strokeStyle = `hsla(${h}, 95%, 60%, ${0.10 + 0.25 * g})`;
    ctx.lineWidth = 16 + 14 * g;
    ctx.stroke();
    ctx.strokeStyle = `hsla(${h}, 95%, 62%, ${0.35 + 0.3 * g})`;
    ctx.lineWidth = 5 + 3 * g;
    ctx.stroke();
    ctx.strokeStyle = `hsla(${h}, 100%, ${82 + 12 * g}%, 0.95)`;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    // Pegs
    for (const [x, y] of [[this.ax, this.ay], [this.bx, this.by]]) {
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${h}, 90%, 85%, 0.95)`;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.strokeStyle = `hsla(${h}, 90%, 70%, 0.45)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
    drawLabel(ctx, this, g);
  }
}

function drawLabel(ctx, s, g) {
  const mx = (s.ax + s.bx) / 2, my = (s.ay + s.by) / 2;
  let n = s.normal;
  if (n.y > 0) n = { x: -n.x, y: -n.y }; // keep labels above the string
  const off = 26 + (s.pull ? Math.abs(s.pull.disp) * 0.5 : 0);
  const x = mx + n.x * off, y = my + n.y * off;
  ctx.save();
  ctx.font = '600 14px ui-rounded, system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const text = s.note;
  const w = ctx.measureText(text).width + 16;
  ctx.fillStyle = `rgba(8, 10, 18, ${0.55 + 0.2 * g})`;
  roundRect(ctx, x - w / 2, y - 12, w, 24, 12);
  ctx.fill();
  ctx.strokeStyle = `hsla(${s.hue}, 90%, 70%, ${0.5 + 0.5 * g})`;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = `hsl(${s.hue}, 100%, ${86 + 10 * g}%)`;
  ctx.fillText(text, x, y + 0.5);
  ctx.restore();
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class StringBank {
  constructor() { this.strings = []; this.scale = 'pentatonic'; }

  add(ax, ay, bx, by, W, H) {
    const s = new AirString({ ax, ay, bx, by, lengthFrac: lengthFraction(ax, ay, bx, by, W, H), scale: this.scale });
    this.strings.push(s);
    return s;
  }
  undo() { return this.strings.pop() || null; }
  clear() { const n = this.strings.length; this.strings = []; return n; }

  setScale(scale) {
    this.scale = scale;
    for (const s of this.strings) s.retune(scale);
  }

  /** Keep strings in place (relative to the window) when it resizes. Pitch is unchanged. */
  resize(oldW, oldH, W, H) {
    if (!oldW || !oldH) return;
    const sx = W / oldW, sy = H / oldH;
    for (const s of this.strings) { s.ax *= sx; s.bx *= sx; s.ay *= sy; s.by *= sy; }
  }

  nearest(x, y, radius, { margin = 0.04 } = {}) {
    let best = null, bestD = radius;
    for (const s of this.strings) {
      const { t } = s.project(x, y);
      if (t < -margin || t > 1 + margin) continue;
      const d = s.distanceTo(x, y);
      if (d <= bestD) { bestD = d; best = s; }
    }
    return best;
  }

  update(dt) { for (const s of this.strings) s.update(dt); }
  draw(ctx) { for (const s of this.strings) s.draw(ctx); }
}
