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
};
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
    this.hands = new Map(); // pointer id -> { name, t0, lastSeen, fired, firedT }
    this.coolUntil = 0;
  }

  reset() { this.hands.clear(); }

  /** The sign a pointer is showing right now, or null. */
  signOf(p) {
    if (p.source !== 'hand' || p.lost || !p.gesture || !this.signs[p.gesture]) return null;
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
    for (const p of pointers) {
      if (p.source !== 'hand') continue;
      seen.add(p.id);
      const name = this.signOf(p);
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
    return { rings, fired, held };
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
    ctx.font = '24px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(r.emoji, 0, 2);
    ctx.restore();
  }
}
