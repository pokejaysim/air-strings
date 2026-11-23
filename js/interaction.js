// Interaction rules: drawing strings, pinch-pull-release plucks, and strums.
// Works on the unified pointer model from gestures.js.

import { pitchForLength, lengthFraction } from './pitch.js';

export const MIN_STRING_FRAC = 0.05; // shorter than 5% of the diagonal is ignored
export const MAX_STRINGS = 12;
const STRUM_COOLDOWN_MS = 110;

export class Interaction {
  constructor({ bank, synth, onEvent = () => {} }) {
    this.bank = bank;
    this.synth = synth;
    this.onEvent = onEvent;
    this.mode = 'draw';
    this.state = new Map(); // pointer id -> state
    this.previews = [];
  }

  setMode(mode) {
    this.mode = mode;
    // Abandon anything in progress.
    for (const st of this.state.values()) {
      if (st.grab) { st.grab.string.pull = null; }
      st.action = 'idle'; st.grab = null;
    }
  }

  update(pointers, W, H, nowMs) {
    const diag = Math.hypot(W, H);
    this.previews = [];
    const live = new Set();

    for (const p of pointers) {
      live.add(p.id);
      let st = this.state.get(p.id);
      if (!st) { st = { action: 'idle', prevTip: null, prevT: 0 }; this.state.set(p.id, st); }

      // A hand pinching over an on-screen button presses it.
      if (p.pinchStarted && p.source === 'hand') {
        const el = document.elementFromPoint(p.x, p.y);
        const btn = el && el.closest('button:not([disabled])');
        if (btn) { btn.click(); st.action = 'ui'; }
      }

      if (st.action === 'ui') {
        if (!p.pinching) st.action = 'idle';
      } else if (this.mode === 'draw') {
        this.handleDraw(p, st, W, H, diag);
      } else {
        this.handlePlay(p, st, W, H, diag, nowMs);
      }

      if (p.lost) this.state.delete(p.id);
    }

    for (const [id, st] of this.state) {
      if (!live.has(id)) {
        if (st.grab) st.grab.string.pull = null;
        this.state.delete(id);
      }
    }
  }

  handleDraw(p, st, W, H, diag) {
    if (p.pinchStarted) {
      st.action = 'drawing';
      st.start = { x: p.x, y: p.y };
    }
    if (st.action !== 'drawing') return;
    if (p.lost) { st.action = 'idle'; return; } // tracking lost mid-draw: cancel
    const frac = lengthFraction(st.start.x, st.start.y, p.x, p.y, W, H);
    if (p.pinching) {
      this.previews.push({
        ax: st.start.x, ay: st.start.y, bx: p.x, by: p.y,
        ok: frac >= MIN_STRING_FRAC,
        note: pitchForLength(Math.max(frac, 1e-4), this.bank.scale).note,
      });
      return;
    }
    // Released
    st.action = 'idle';
    if (frac < MIN_STRING_FRAC) {
      if (frac > 0.01) this.onEvent({ type: 'tooShort' });
      return;
    }
    if (this.bank.strings.length >= MAX_STRINGS) { this.onEvent({ type: 'tooMany' }); return; }
    const s = this.bank.add(st.start.x, st.start.y, p.x, p.y, W, H);
    s.glow = 1;
    this.onEvent({ type: 'added', string: s });
  }

  handlePlay(p, st, W, H, diag, now) {
    const grabRadius = Math.max(26, 0.035 * diag);

    // --- Pinch-pull-release ---
    if (p.pinchStarted && st.action === 'idle') {
      const s = this.bank.nearest(p.x, p.y, grabRadius);
      if (s) {
        const { t } = s.project(p.x, p.y);
        st.action = 'grabbing';
        st.grab = { string: s };
        s.pull = { t: clampT(t), disp: 0 };
      } else if (p.source === 'mouse') {
        st.action = 'strumming';
      } else {
        st.action = 'pinchIdle';
      }
    }

    if (st.action === 'grabbing') {
      const s = st.grab.string;
      if (!this.bank.strings.includes(s)) { st.action = 'idle'; st.grab = null; return; }
      const { t, d } = s.project(p.x, p.y);
      const maxPull = Math.min(0.09 * diag, 0.32 * s.length);
      const slipped = Math.abs(d) > maxPull * 1.4;
      s.pull = { t: clampT(t), disp: Math.max(-maxPull, Math.min(maxPull, d)) };
      if (!p.pinching || slipped) {
        const amp = Math.abs(s.pull.disp) / maxPull;
        const pt = s.pull.t, disp = s.pull.disp;
        s.pull = null;
        if (amp > 0.03) this.pluck(s, pt, slipped ? 1 : amp, disp, W, now, 'pluck');
        st.grab = null;
        st.action = p.pinching ? 'spent' : 'idle'; // slipped: wait for release
      }
    }
    if ((st.action === 'spent' || st.action === 'pinchIdle') && !p.pinching) st.action = 'idle';
    if (st.action === 'strumming' && !p.pinching) st.action = 'idle';

    // Hover highlight for the string you'd grab.
    if (st.action === 'idle' && !p.hidden) {
      const s = this.bank.nearest(p.x, p.y, grabRadius);
      if (s) s.hover = 1;
    }

    // --- Strum: fast fingertip crossing ---
    const canStrum = p.source === 'hand' ? (st.action === 'idle' && !p.pinching) : st.action === 'strumming';
    const tip = { x: p.tipX, y: p.tipY };
    if (st.prevTip && canStrum && !p.pinchStarted) {
      const dx = tip.x - st.prevTip.x, dy = tip.y - st.prevTip.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.5) {
        const dt = Math.max(1, now - st.prevT) / 1000;
        const speed = dist / dt / diag; // diagonals per second
        const threshold = p.source === 'hand' ? 0.5 : 0.35;
        // For hands, ignore jumps after tracking hiccups (long gaps / teleports).
        const plausible = p.source !== 'hand' || (dt < 0.15 && dist < 0.35 * diag);
        if (speed > threshold && plausible) {
          for (const s of this.bank.strings) {
            const a = s.project(st.prevTip.x, st.prevTip.y), b = s.project(tip.x, tip.y);
            if (a.d * b.d >= 0) continue; // didn't cross the line
            const u = a.d / (a.d - b.d);
            const t = a.t + (b.t - a.t) * u;
            if (t < 0.02 || t > 0.98) continue;
            if (now - s.lastPluck < STRUM_COOLDOWN_MS) continue;
            const amp = Math.min(1, 0.2 + (speed - threshold) / 1.8);
            this.pluck(s, t, amp, Math.sign(b.d) * Math.min(0.06 * diag, 0.25 * s.length) * amp, W, now, 'strum');
          }
        }
      }
    }
    if (!st.prevTip || Math.hypot(tip.x - st.prevTip.x, tip.y - st.prevTip.y) > 0.5 || !canStrum) {
      st.prevTip = tip;
      st.prevT = now;
    } else {
      // Holding still: don't let the reference time go stale, or the first
      // frame of a sudden swipe would look slow.
      st.prevT = Math.max(st.prevT, now - 50);
    }
  }

  pluck(s, t, amp, disp, W, now, kind) {
    s.lastPluck = now;
    s.excite(t, disp);
    const mx = (s.ax + s.bx) / 2;
    this.synth.pluck({ freq: s.freq, amp, position: t, pan: ((mx / W) * 2 - 1) * 0.7, stringId: s.id });
    this.onEvent({ type: kind, string: s, amp });
  }
}

const clampT = (t) => Math.min(0.94, Math.max(0.06, t));
