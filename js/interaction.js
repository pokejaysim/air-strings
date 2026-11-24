// Interaction rules. There are no modes: what you do decides what happens.
//   Pinch ON a string, pull, release           -> pluck it
//   Pinch in EMPTY space, hold a beat, drag     -> draw a new string
//   Swipe a fingertip fast across strings       -> strum
// With a mouse, pressing = pinching, and a fast flick across strings from
// empty space strums instead of drawing.
//
// Telling strums and draws apart (hands): fast swipes often bring thumb and
// index together for a moment, which looks like a pinch. So:
//   1. A pinch that starts while the hand is already moving fast is ignored
//      (it's part of a strum). Strumming continues through it.
//   2. A draw "arms" only after the pinch is held for ARM_MS; a ring around
//      the pinch shows it filling up.
//   3. Releasing too soon, or a line made too fast, is discarded.
//   4. If a pinch-drag whips across strings, they're strummed and the line
//      is cancelled.
// Works on the unified pointer model from gestures.js.

import { pitchForLength, lengthFraction } from './pitch.js';

export const MIN_STRING_FRAC = 0.05; // shorter than 5% of the diagonal is ignored
export const MAX_STRINGS = 12;
const STRUM_COOLDOWN_MS = 110;

// Speeds are in screen diagonals per second.
export const TUNING = {
  hand: {
    pinchStartMaxSpeed: 0.55, // pinch beginning faster than this = part of a swipe
    armMs: 150,               // hold the pinch this long before a draw starts
    minDrawMs: 280,           // whole pinch shorter than this never makes a string
    maxDrawSpeed: 1.8,        // average speed above this = flick, not a draw
    strumSpeed: 0.5,          // open-hand swipe faster than this strums
    strumWhileDrawingSpeed: 0.9,
  },
  mouse: {
    pinchStartMaxSpeed: Infinity, // a click is always deliberate
    armMs: 0,
    minDrawMs: 60,
    maxDrawSpeed: 3.0,
    strumSpeed: 0.7,
    strumWhileDrawingSpeed: 0.7,
  },
};

const DRAWISH = new Set(['pendingDraw', 'drawing']);

export class Interaction {
  constructor({ bank, synth, onEvent = () => {} }) {
    this.bank = bank;
    this.synth = synth;
    this.onEvent = onEvent;
    this.state = new Map(); // pointer id -> state
    this.previews = [];
    // Hooks for lessons:
    this.allowDraw = true;   // false: pinching empty space draws nothing
    this.customAdd = null;   // (line, source) => void: decides what a finished draw becomes
    this.previewHook = null; // (preview) => void: may relabel the line being drawn
  }

  /** Abandon anything in progress (e.g. after Clear). */
  reset() {
    for (const st of this.state.values()) {
      if (st.grab) st.grab.string.pull = null;
      st.action = 'idle'; st.grab = null;
    }
  }

  /** Pinching within this distance of a string grabs it instead of drawing. */
  grabRadius(diag, source) {
    return source === 'hand' ? Math.max(34, 0.05 * diag) : Math.max(24, 0.03 * diag);
  }

  /** For rendering feedback: what a pointer is doing, and draw-arming progress 0..1. */
  pointerStatus(id) {
    const st = this.state.get(id);
    if (!st) return { action: 'idle', arm: 0 };
    let arm = 0;
    if (st.action === 'pendingDraw') arm = st.armMs > 0 ? Math.min(1, (st.now - st.t0) / st.armMs) : 1;
    else if (st.action === 'drawing') arm = 1;
    return { action: st.action, arm };
  }

  update(pointers, W, H, nowMs) {
    const diag = Math.hypot(W, H);
    this.previews = [];
    const live = new Set();

    for (const p of pointers) {
      live.add(p.id);
      let st = this.state.get(p.id);
      if (!st) { st = { action: 'idle', prevTip: null, prevT: 0, speed: 0 }; this.state.set(p.id, st); }
      st.now = nowMs;

      // A hand pinching over an on-screen button presses it.
      if (p.pinchStarted && p.source === 'hand') {
        const el = document.elementFromPoint(p.x, p.y);
        const btn = el && el.closest('button:not([disabled])');
        // Only the app's own buttons can be pressed by a pinch (never links:
        // an off-target pinch shouldn't navigate away mid-performance).
        if (btn && btn.closest('.toolbar, .hint, .banner, .sound-banner, .lesson-card')) { btn.click(); st.action = 'ui'; }
      }

      if (st.action === 'ui') {
        if (!p.pinching) st.action = 'idle';
      } else {
        this.handle(p, st, W, H, diag, nowMs);
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

  handle(p, st, W, H, diag, now) {
    const T = TUNING[p.source] || TUNING.mouse;
    const grabRadius = this.grabRadius(diag, p.source);
    this.trackSpeed(p, st, now, diag);

    // --- Pinch starts: grab a nearby string, or get ready to draw ---
    if (p.pinchStarted) {
      if (st.grab) st.grab.string.pull = null;
      st.grab = null;
      if (st.speed > T.pinchStartMaxSpeed) {
        st.action = 'ignoredPinch'; // fingers touched mid-swipe: keep strumming
      } else {
        const s = this.bank.nearest(p.x, p.y, grabRadius);
        if (s) {
          const { t } = s.project(p.x, p.y);
          st.action = 'grabbing';
          st.grab = { string: s };
          s.pull = { t: clampT(t), disp: 0 };
        } else if (!this.allowDraw) {
          st.action = 'ignoredPinch'; // drawing is off: the pinch can still strum
        } else {
          st.action = 'pendingDraw';
          st.start = { x: p.x, y: p.y };
          st.t0 = now;
          st.armMs = T.armMs;
        }
      }
    }

    if (st.action === 'grabbing') this.handleGrab(p, st, diag, W, now);
    if (st.action === 'pendingDraw') {
      if (!p.pinching || p.lost) {
        st.action = 'idle'; // let go before the draw armed
        if (!p.lost) this.onEvent({ type: 'tooQuick' });
      } else if (now - st.t0 >= st.armMs) {
        st.action = 'drawing';
      }
    }
    if (st.action === 'drawing') this.handleDraw(p, st, W, H, now, T);
    if ((st.action === 'spent' || st.action === 'strummed' || st.action === 'ignoredPinch') && !p.pinching) {
      st.action = 'idle';
    }

    // Hover highlight: the string a pinch here would grab.
    if (st.action === 'idle' && !p.hidden) {
      const s = this.bank.nearest(p.x, p.y, grabRadius);
      if (s) s.hover = 1;
    }

    this.handleStrum(p, st, W, diag, now, T);
  }

  /**
   * Smoothed hand speed in diagonals per second. Uses the palm for hands:
   * closing a pinch moves the fingertip on its own, which mustn't look like a swipe.
   */
  trackSpeed(p, st, now, diag) {
    const x = p.palmX ?? p.tipX, y = p.palmY ?? p.tipY;
    if (st.spX === undefined) { st.spX = x; st.spY = y; st.spT = now; st.speed = 0; return; }
    const d = Math.hypot(x - st.spX, y - st.spY);
    if (d > 0.5) {
      const dt = Math.max(1, now - st.spT) / 1000;
      const inst = d / dt / diag;
      st.speed = dt > 0.2 ? inst * 0.5 : st.speed * 0.4 + inst * 0.6;
      st.spX = x; st.spY = y; st.spT = now;
    } else if (now - st.spT > 50) {
      st.speed *= 0.5; // holding still (hand detections arrive every ~33 ms)
    }
  }

  handleGrab(p, st, diag, W, now) {
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

  handleDraw(p, st, W, H, now, T) {
    if (p.lost) { st.action = 'idle'; return; } // tracking lost mid-draw: cancel
    const frac = lengthFraction(st.start.x, st.start.y, p.x, p.y, W, H);
    if (p.pinching) {
      const pv = {
        ax: st.start.x, ay: st.start.y, bx: p.x, by: p.y,
        ok: frac >= MIN_STRING_FRAC,
        note: pitchForLength(Math.max(frac, 1e-4), this.bank.scale).note,
      };
      if (this.previewHook) this.previewHook(pv);
      this.previews.push(pv);
      return;
    }
    // Released
    st.action = 'idle';
    const secs = Math.max(0.001, (now - st.t0) / 1000);
    if (secs * 1000 < T.minDrawMs || frac / secs > T.maxDrawSpeed) {
      this.onEvent({ type: 'tooQuick' });
      return;
    }
    if (this.customAdd) { this.customAdd({ ax: st.start.x, ay: st.start.y, bx: p.x, by: p.y }, p.source); return; }
    if (frac < MIN_STRING_FRAC) {
      if (frac > 0.01) this.onEvent({ type: 'tooShort' });
      return;
    }
    if (this.bank.strings.length >= MAX_STRINGS) { this.onEvent({ type: 'tooMany' }); return; }
    const s = this.bank.add(st.start.x, st.start.y, p.x, p.y, W, H);
    s.glow = 1;
    this.onEvent({ type: 'added', string: s });
  }

  handleStrum(p, st, W, diag, now, T) {
    // Hands strum with the fingertip whenever they aren't plucking; a pinch
    // that's only pending/drawing still strums (and gets cancelled by it).
    // The mouse strums by flicking from empty space.
    const a = st.action;
    const canStrum = p.source === 'hand'
      ? ((a === 'idle' && !p.pinching) || a === 'ignoredPinch' || a === 'strummed' || DRAWISH.has(a))
      : (DRAWISH.has(a) || a === 'strummed' || a === 'ignoredPinch');
    const tip = { x: p.tipX, y: p.tipY };
    // On a mouse press the previous position is stale (cursor jumped), so skip that frame.
    const skipFrame = p.pinchStarted && p.source !== 'hand';
    if (st.prevTip && canStrum && !skipFrame) {
      const dx = tip.x - st.prevTip.x, dy = tip.y - st.prevTip.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.5) {
        const dt = Math.max(1, now - st.prevT) / 1000;
        const speed = dist / dt / diag;
        const threshold = DRAWISH.has(a) ? T.strumWhileDrawingSpeed : T.strumSpeed;
        // For hands, ignore jumps after tracking hiccups (long gaps / teleports).
        const plausible = p.source !== 'hand' || (dt < 0.15 && dist < 0.35 * diag);
        if (speed > threshold && plausible) {
          let hit = false;
          for (const s of this.bank.strings) {
            const pa = s.project(st.prevTip.x, st.prevTip.y), pb = s.project(tip.x, tip.y);
            // Crossed the line? (Landing exactly on it counts once, when leaving.)
            const crossed = (pa.d <= 0 && pb.d > 0) || (pa.d >= 0 && pb.d < 0);
            if (!crossed) continue;
            const u = pa.d / (pa.d - pb.d);
            const t = pa.t + (pb.t - pa.t) * u;
            if (t < 0.02 || t > 0.98) continue;
            hit = true;
            if (now - s.lastPluck < STRUM_COOLDOWN_MS) continue;
            const amp = Math.min(1, 0.2 + (speed - threshold) / 1.8);
            this.pluck(s, t, amp, Math.sign(pb.d) * Math.min(0.06 * diag, 0.25 * s.length) * amp, W, now, 'strum');
          }
          if (hit && DRAWISH.has(st.action)) st.action = 'strummed'; // it was a strum, not a draw
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
