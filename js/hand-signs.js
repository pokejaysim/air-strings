// Hand signs: hold a shape (fist, thumbs up...) for a moment to do something.
// The Gesture Recognizer labels each hand's shape every camera frame; this
// turns those labels into deliberate actions. A sign only counts once it has
// been held, so a hand passing through a fist while playing does nothing.
// Shared by Air Strings and the Air Theremin.

export const SIGNS = {
  Closed_Fist: { hold: 300, emoji: '✊', label: 'Fist' },
  Thumb_Up: { hold: 800, emoji: '👍', label: 'Thumbs up' },
  Thumb_Down: { hold: 800, emoji: '👎', label: 'Thumbs down' },
  Victory: { hold: 1000, emoji: '✌️', label: 'Victory' },
  ILoveYou: { hold: 800, emoji: '🤟', label: 'I love you' },
  // Read from finger positions (Google's model doesn't know these):
  Rock_Horns: { hold: 700, emoji: '🤘', label: 'Rock horns' },
  Call_Me: { hold: 700, emoji: '🤙', label: 'Call me' },
  Three_Fingers: { hold: 900, emoji: '3️⃣', label: 'Three fingers' },
  // Two hands at once:
  Both_Thumbs_Up: { hold: 600, emoji: '👍👍', label: 'Both thumbs up', pair: 'Thumb_Up' },
  Both_Fists: { hold: 500, emoji: '✊✊', label: 'Both fists', pair: 'Closed_Fist' },
  // A motion, not a held shape: open palm waved side to side.
  Wave: { emoji: '👋', label: 'Wave', motion: true },
};
/** Signs we read from finger positions; on the theremin only a hand that isn't playing a note can make them. */
export const FINGER_SIGNS = ['Rock_Horns', 'Call_Me', 'Three_Fingers'];

// ---- Shapes from finger positions ----
// A finger is up when its tip is clearly farther from the wrist than its
// middle joint, and down when clearly nearer (measured on Google's test
// photos: up is 1.3 or more, curled 0.76 or less). The thumb is out when its
// tip is far from the middle knuckle (out 0.98+, tucked 0.18 or less, in
// hand widths). In between counts as unsure, which never makes a sign.
export const FINGER_UP = 1.15, FINGER_DOWN = 0.95, THUMB_OUT = 0.65, THUMB_IN = 0.45;
const FINGERS = { index: [8, 6], middle: [12, 10], ring: [16, 14], pinky: [20, 18] };

/** { thumb: 'out'|'in'|null, index/middle/ring/pinky: 'up'|'down'|null } from 21 landmarks. */
export function fingerStates(L, vw = 1, vh = 1) {
  const P = (i) => [L[i].x * vw, L[i].y * vh];
  const d = (a, b) => { const [ax, ay] = P(a), [bx, by] = P(b); return Math.hypot(ax - bx, ay - by); };
  const palm = Math.max(1e-6, d(0, 9), d(5, 17) * 1.25);
  const f = {};
  for (const [name, [tip, pip]] of Object.entries(FINGERS)) {
    const r = d(tip, 0) / Math.max(1e-6, d(pip, 0));
    f[name] = r > FINGER_UP ? 'up' : r < FINGER_DOWN ? 'down' : null;
  }
  const t = d(4, 9) / palm;
  f.thumb = t > THUMB_OUT ? 'out' : t < THUMB_IN ? 'in' : null;
  return f;
}

/** The sign a hand shows: one we read from its fingers, else the model's label. */
export function shapeOf(f, modelName = null) {
  if (f) {
    const { thumb, index, middle, ring, pinky } = f;
    if (index === 'up' && pinky === 'up' && middle === 'down' && ring === 'down') {
      if (thumb === 'in') return 'Rock_Horns';
      if (thumb === 'out') return 'ILoveYou';
    }
    if (thumb === 'out' && pinky === 'up' && index === 'down' && middle === 'down' && ring === 'down') return 'Call_Me';
    if (index === 'up' && middle === 'up' && ring === 'up' && pinky === 'down') return 'Three_Fingers';
  }
  return modelName;
}
/** An open hand: the model says so, or all four fingers are up. */
export function isOpenPalm(f, modelName = null) {
  if (modelName === 'Open_Palm') return true;
  return !!f && f.index === 'up' && f.middle === 'up' && f.ring === 'up' && f.pinky === 'up';
}

// ---- Waving ----
export const WAVE_SWING = 0.35;  // each swing at least this many hand-sizes
export const WAVE_TURNS = 3;     // direction changes needed (left-right-left-right)
export const WAVE_STALL_MS = 700; // too long without a turn: start over
export const MIN_SCORE = 0.55;  // how sure the model must be
export const GAP_MS = 180;      // the label may flicker this long without restarting the hold
export const SHOW_AFTER_MS = 120; // don't flash a ring for a one-frame label
export const COOLDOWN_MS = 900; // after one action, wait before the next
export const POP_MS = 550;      // the emoji pops this long after an action

const STORE_KEY = 'handSigns';
/** Hand signs on/off, shared by both instruments (on unless turned off). */
export function signsEnabled() {
  try { return localStorage.getItem(STORE_KEY) !== 'off'; } catch { return true; }
}
export function setSignsEnabled(on) {
  try { localStorage.setItem(STORE_KEY, on ? 'on' : 'off'); } catch { /* private mode */ }
}

export class SignWatcher {
  constructor({ signs = SIGNS, cooldown = COOLDOWN_MS } = {}) {
    this.signs = signs;
    this.cooldown = cooldown;
    this.hands = new Map(); // pointer id (or 'pair') -> { name, t0, lastSeen, fired, firedT }
    this.waves = new Map(); // pointer id -> { dir, ext, turns, lastTurn, done }
    this.coolUntil = 0;
  }

  reset() { this.hands.clear(); this.waves.clear(); }

  /** The sign a pointer is showing right now, or null. */
  signOf(p) {
    if (p.source !== 'hand' || p.lost || !p.gesture || !this.signs[p.gesture]) return null;
    if (this.signs[p.gesture].pair || this.signs[p.gesture].motion) return null;
    if ((p.gestureScore ?? 1) < MIN_SCORE) return null;
    if (p.pinching) return null; // busy drawing or plucking
    if (p.gesture === 'Closed_Fist' && p.fist === false) return null; // labelled fist, but the finger isn't curled
    return p.gesture;
  }

  /**
   * @param pointers this frame's pointers (from HandGestures)
   * @param can (name, pointer) => whether that sign does anything right now
   * @returns { rings, fired, held }
   *   rings: [{ id, name, emoji, x, y, progress, pop }] to draw (pop: 0..1 after firing)
   *   fired: [{ id, name, x, y }] actions to run this frame
   *   held:  Set of sign names that have fired and are still being held
   */
  update(pointers, now, can = () => true) {
    const rings = [], fired = [], held = new Set(), seen = new Set();
    // Two hands making the same sign at once become one two-hand sign.
    const hands = pointers.filter((p) => p.source === 'hand' && !p.lost);
    const paired = new Set();
    let pairPtr = null;
    for (const [pairName, def] of Object.entries(this.signs)) {
      if (!def.pair || pairPtr) continue;
      const both = hands.filter((p) => this.signOf(p) === def.pair);
      if (both.length < 2 || !can(pairName, both[0])) continue;
      const [a, b] = both;
      pairPtr = {
        id: 'pair', source: 'hand', pair: pairName, pinching: false,
        palmX: ((a.palmX ?? a.x) + (b.palmX ?? b.x)) / 2,
        palmY: Math.min(a.palmY ?? a.y, b.palmY ?? b.y),
        handSize: Math.max(a.handSize || 100, b.handSize || 100),
      };
      paired.add(a.id); paired.add(b.id);
    }
    const list = pairPtr ? [...hands.filter((p) => !paired.has(p.id)), pairPtr] : pointers;
    for (const id of paired) this.hands.delete(id);
    for (const p of list) {
      if (p.source !== 'hand') continue;
      seen.add(p.id);
      this.watchWave(p, now, can, rings, fired);
      const name = p.pair || this.signOf(p);
      let st = this.hands.get(p.id);
      if (name && can(name, p)) {
        if (!st || st.name !== name) {
          st = { name, t0: now, lastSeen: now, fired: false, firedT: 0 };
          this.hands.set(p.id, st);
        }
        st.lastSeen = now;
      } else if (st && now - st.lastSeen > GAP_MS) {
        this.hands.delete(p.id);
        st = null;
      }
      if (!st) continue;
      const def = this.signs[st.name];
      const x = p.palmX ?? p.x, y = (p.palmY ?? p.y) - (p.handSize || 100) * 0.95;
      if (!st.fired && now - st.t0 >= def.hold && now >= this.coolUntil) {
        st.fired = true;
        st.firedT = now;
        this.coolUntil = now + this.cooldown;
        fired.push({ id: p.id, name: st.name, x, y });
      }
      if (st.fired) {
        if (now - st.lastSeen <= GAP_MS) held.add(st.name);
        const age = now - st.firedT;
        if (age < POP_MS) rings.push({ id: p.id, name: st.name, emoji: def.emoji, x, y, progress: 1, pop: age / POP_MS });
      } else if (now - st.t0 >= SHOW_AFTER_MS && st.lastSeen === now) {
        rings.push({ id: p.id, name: st.name, emoji: def.emoji, x, y, progress: Math.min(1, (now - st.t0) / def.hold), pop: 0 });
      }
    }
    for (const id of this.hands.keys()) if (!seen.has(id)) this.hands.delete(id);
    for (const id of this.waves.keys()) if (!seen.has(id)) this.waves.delete(id);
    return { rings, fired, held };
  }

  /** An open palm waved side to side: counts direction changes of big enough swings. */
  watchWave(p, now, can, rings, fired) {
    if (!this.signs.Wave) return;
    const open = p.openPalm && !p.pinching && !p.pair;
    let w = this.waves.get(p.id);
    if (!open || (w && now - w.lastTurn > WAVE_STALL_MS)) { this.waves.delete(p.id); if (!open) return; w = null; }
    const x = p.palmX ?? p.x, swing = WAVE_SWING * (p.handSize || 100);
    if (!w) { w = { dir: 0, ext: x, turns: 0, lastTurn: now, done: false }; this.waves.set(p.id, w); }
    // Keep following the hand even after it has said goodbye, so one long
    // wave counts once: it re-arms only after the hand stops or closes.
    if (w.dir === 0) {
      if (Math.abs(x - w.ext) > swing) { w.dir = Math.sign(x - w.ext); w.ext = x; w.lastTurn = now; }
    } else if ((x - w.ext) * w.dir > 0) {
      w.ext = x; // still going the same way
    } else if (Math.abs(x - w.ext) > swing) {
      w.turns++; w.dir = -w.dir; w.ext = x; w.lastTurn = now;
    }
    if (w.done || w.turns < 1 || !can('Wave', p)) return;
    const ry = (p.palmY ?? p.y) - (p.handSize || 100) * 0.95;
    if (w.turns >= WAVE_TURNS && now >= this.coolUntil) {
      w.done = true;
      this.coolUntil = now + this.cooldown;
      fired.push({ id: p.id, name: 'Wave', x, y: ry });
      rings.push({ id: p.id, name: 'Wave', emoji: this.signs.Wave.emoji, x, y: ry, progress: 1, pop: 0.05 });
    } else {
      rings.push({ id: p.id, name: 'Wave', emoji: this.signs.Wave.emoji, x, y: ry, progress: Math.min(1, w.turns / WAVE_TURNS), pop: 0 });
    }
  }
}

/** Draw the hold rings: the emoji in a bubble, with a ring that fills; it pops when done. */
export function drawSignRings(ctx, rings) {
  for (const r of rings) {
    const pop = r.pop || 0;
    const scale = pop ? 1 + 0.5 * Math.sin(Math.min(1, pop) * Math.PI) : 0.9 + 0.1 * r.progress;
    const alpha = pop ? 1 - pop * pop : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(r.x, r.y);
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.arc(0, 0, 24, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8,10,18,0.72)';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 24, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * r.progress);
    ctx.strokeStyle = pop ? '#ffd76a' : '#7df0c0';
    ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.shadowBlur = 0;
    const two = String(r.name).startsWith('Both_'); // two emoji side by side
    ctx.font = `${two ? 16 : 24}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(r.emoji, 0, 2);
    ctx.restore();
  }
}
