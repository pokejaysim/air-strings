// Turns raw hand landmarks (or the mouse) into "pointers":
//   { id, source, x, y (pinch point), tipX, tipY (index tip), pinching,
//     pinchStarted, pinchEnded, lost, handSize }
// The rest of the app only ever sees pointers, so mouse mode exercises the
// exact same interaction code as real hands.

import { OneEuro2D } from './one-euro.js';

const THUMB_TIP = 4, INDEX_TIP = 8, WRIST = 0, INDEX_MCP = 5, MIDDLE_MCP = 9, PINKY_MCP = 17;

// Pinch distance relative to hand size, with hysteresis.
export const PINCH_ON = 0.32;
export const PINCH_OFF = 0.48;
const LOST_AFTER_MS = 220;

/** Maps normalized video coords to mirrored screen coords for object-fit: cover. */
export function videoToScreen(nx, ny, vw, vh, W, H) {
  const scale = Math.max(W / vw, H / vh);
  return {
    x: W / 2 + ((1 - nx) * vw - vw / 2) * scale,
    y: H / 2 + (ny * vh - vh / 2) * scale,
  };
}

class HandState {
  constructor(id) {
    this.id = id;
    const filt = { minCutoff: 1.4, beta: 0.012, dCutoff: 1.0 };
    this.thumb = new OneEuro2D(filt);
    this.index = new OneEuro2D(filt);
    this.pinching = false;
    this.lastSeen = 0;
    this.pinchRatio = 1;
    this.handSize = 100;
  }
}

export class HandGestures {
  constructor() {
    this.hands = new Map();
  }

  /**
   * @param detections output of HandTracker.detect (may be null = no new frame)
   * @returns pointer list for this frame
   */
  update(detections, video, W, H, nowMs) {
    const t = nowMs / 1000;
    const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
    const seen = new Set();
    const pointers = [];

    if (detections) {
      // Assign stable ids: prefer handedness, avoid two hands sharing one id.
      const used = new Set();
      for (const det of detections) {
        let id = det.handedness;
        if (used.has(id)) id = id + '-2';
        used.add(id);
        seen.add(id);
        let st = this.hands.get(id);
        if (!st) { st = new HandState(id); this.hands.set(id, st); }
        st.lastSeen = nowMs;
        st.missing = false;

        const L = det.landmarks;
        const sp = (i) => videoToScreen(L[i].x, L[i].y, vw, vh, W, H);
        const wrist = sp(WRIST), mid = sp(MIDDLE_MCP), imcp = sp(INDEX_MCP), pmcp = sp(PINKY_MCP);
        // Hand size: palm length and palm width, whichever is larger (robust to rotation).
        const size = Math.max(Math.hypot(mid.x - wrist.x, mid.y - wrist.y), Math.hypot(pmcp.x - imcp.x, pmcp.y - imcp.y) * 1.25);
        st.handSize = st.handSize * 0.8 + size * 0.2;

        const th = sp(THUMB_TIP), ix = sp(INDEX_TIP);
        st.thumbPos = st.thumb.filter(th.x, th.y, t);
        st.indexPos = st.index.filter(ix.x, ix.y, t);

        // Use raw tips for the pinch decision (less lag), smoothed for position.
        st.pinchRatio = Math.hypot(th.x - ix.x, th.y - ix.y) / Math.max(20, st.handSize);
        const was = st.pinching;
        if (!was && st.pinchRatio < PINCH_ON) st.pinching = true;
        else if (was && st.pinchRatio > PINCH_OFF) st.pinching = false;
        st.started = !was && st.pinching;
        st.ended = was && !st.pinching;
      }
    }

    for (const [id, st] of this.hands) {
      const missingMs = nowMs - st.lastSeen;
      if (!seen.has(id) && detections) {
        // No new detection for this hand this frame.
        st.started = false;
        st.ended = false;
      }
      if (missingMs > LOST_AFTER_MS) {
        // Hand left the frame: emit one final "lost" pointer, then forget it.
        pointers.push(this.toPointer(st, { lost: true }));
        this.hands.delete(id);
        continue;
      }
      if (!st.indexPos) continue;
      pointers.push(this.toPointer(st));
      st.started = false;
      st.ended = false;
    }
    return pointers;
  }

  toPointer(st, { lost = false } = {}) {
    const th = st.thumbPos, ix = st.indexPos;
    return {
      id: 'hand:' + st.id,
      source: 'hand',
      x: (th.x + ix.x) / 2,
      y: (th.y + ix.y) / 2,
      tipX: ix.x,
      tipY: ix.y,
      thumbX: th.x,
      thumbY: th.y,
      pinching: lost ? false : st.pinching,
      pinchStarted: !lost && !!st.started,
      pinchEnded: lost ? st.pinching : !!st.ended,
      lost,
      pinchRatio: st.pinchRatio,
      handSize: st.handSize,
    };
  }
}

/** Mouse / touch: pressing = pinching. */
export class PointerGestures {
  constructor(el) {
    this.state = new Map();
    this.events = [];
    const on = (type, fn) => el.addEventListener(type, fn, { passive: false });
    on('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      el.setPointerCapture?.(e.pointerId);
      const prev = this.state.get(e.pointerId);
      const s = { x: e.clientX, y: e.clientY, downX: e.clientX, downY: e.clientY, down: true, started: true, ended: false, hidden: false };
      this.state.set(e.pointerId, s);
      e.preventDefault();
    });
    on('pointermove', (e) => {
      let s = this.state.get(e.pointerId);
      if (!s) { if (e.pointerType !== 'mouse') return; s = { down: false }; this.state.set(e.pointerId, s); }
      // Use coalesced events for fast strums so we don't miss crossings.
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      const last = evs.length ? evs[evs.length - 1] : e;
      s.x = last.clientX; s.y = last.clientY;
    });
    const up = (e) => {
      const s = this.state.get(e.pointerId);
      if (!s) return;
      if (s.down) { s.down = false; s.ended = true; s.x = e.clientX; s.y = e.clientY; }
      if (e.pointerType !== 'mouse') s.remove = true;
    };
    on('pointerup', up);
    on('pointercancel', up);
    el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { const s = this.state.get(e.pointerId); if (s && !s.down) s.hidden = true; } });
    el.addEventListener('pointerenter', (e) => { const s = this.state.get(e.pointerId); if (s) s.hidden = false; });
  }

  update() {
    const out = [];
    for (const [id, s] of this.state) {
      if (s.x === undefined) continue;
      const base = { id: 'ptr:' + id, source: 'mouse', lost: false };
      if (s.started) {
        // Press frame: report where the press happened, even if the pointer
        // has already moved. A release in the same frame waits for the next one.
        const x = s.downX, y = s.downY;
        out.push({ ...base, x, y, tipX: x, tipY: y, pinching: true, pinchStarted: true, pinchEnded: false, hidden: false });
        s.started = false;
        continue;
      }
      out.push({
        ...base,
        x: s.x, y: s.y, tipX: s.x, tipY: s.y,
        pinching: s.down, pinchStarted: false, pinchEnded: !!s.ended,
        hidden: !!s.hidden && !s.down,
      });
      s.ended = false;
      if (s.remove) this.state.delete(id);
    }
    return out;
  }
}
