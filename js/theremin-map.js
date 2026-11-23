// Pure theremin math: screen layout, which hand does what, hand position ->
// pitch, volume and tone, pitch "assist", and the small amount of
// frame-to-frame state that makes it feel steady (ThereminState).
// No DOM, no audio — imported by tests.

import { midiToFreq, freqToMidi, noteName, clamp } from './pitch.js';

export const THEREMIN_SCALES = {
  pentatonic: { label: 'Pentatonic', steps: [0, 2, 4, 7, 9] },
  major: { label: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
  minor: { label: 'Minor pent.', steps: [0, 3, 5, 7, 10] },
  chromatic: { label: 'Chromatic', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
};
export const RANGES = {
  low: { label: 'Low', low: 36, high: 60 },   // C2–C4
  mid: { label: 'Mid', low: 48, high: 72 },   // C3–C5
  high: { label: 'High', low: 60, high: 84 }, // C4–C6
};
export const ROOT = 0;        // C
export const MIDI_LOW = 48;   // default range C3..C5
export const MIDI_HIGH = 72;
export const AXIS_EDGE = 0.05;     // dead margin at each end of the pitch axis
export const VOLUME_FLOOR = 0.12;  // bottom 12% of the volume zone is silence
export const ONE_HAND_LEVEL = 0.7; // steady volume when only the pitch hand is up
export const VOLUME_MEMORY_MS = 1500; // a volume hand that vanishes keeps its level this long
export const NEW_HAND_DWELL_MS = 120; // a hand must be seen this long before it can sound
export const SNAP_HYSTERESIS = 0.15;  // stay on a snapped note until 65% of the way to the next
export const VIBRATO_LP_HZ = 2;       // assist acts on movement slower than this; faster wobble passes through
export const VIBRATO_DEADBAND = 0.04; // semitones of jitter ignored in the wobble path

/** Fraction of the width a lone hand must cross the border by before switching zone. */
export const zoneMargin = (layout) => (layout.landscape ? 0.05 : 0.14) * layout.W;

/**
 * Screen layout. Landscape: volume zone on the left (38%), pitch zone on the
 * right, pitch runs left -> right. Portrait: two halves, pitch runs bottom -> top.
 * `top`/`bottom` reserve space for the toolbar and status bar.
 */
export function layoutFor(W, H, { top = 0, bottom = 0 } = {}) {
  const landscape = W >= H;
  const split = landscape ? W * 0.38 : W * 0.5;
  const y0 = top, h = Math.max(1, H - top - bottom);
  return {
    W, H, landscape, split,
    axis: landscape ? 'x' : 'y',
    volume: { x: 0, y: y0, w: split, h },
    pitch: { x: split, y: y0, w: W - split, h },
  };
}

/** Position along the pitch axis, 0 (lowest) .. 1 (highest). */
export function pitchAxisPos(x, y, layout) {
  const z = layout.pitch;
  return layout.axis === 'x' ? (x - z.x) / z.w : 1 - (y - z.y) / z.h;
}

/** Position across the pitch axis, 0..1: the pitch hand's "tone" control (top / right = brighter). */
export function toneAxisPos(x, y, layout) {
  const z = layout.pitch;
  return clamp(layout.axis === 'x' ? 1 - (y - z.y) / z.h : (x - z.x) / z.w, 0, 1);
}

/** Axis position -> screen coordinate along the axis (for drawing). */
export function axisToScreen(u, layout) {
  const z = layout.pitch;
  return layout.axis === 'x' ? z.x + u * z.w : z.y + (1 - u) * z.h;
}

/** Axis position -> continuous MIDI note, with dead margins at the ends. */
export function axisToMidi(u, low = MIDI_LOW, high = MIDI_HIGH) {
  const t = clamp((u - AXIS_EDGE) / (1 - 2 * AXIS_EDGE), 0, 1);
  return low + t * (high - low);
}

/** Continuous MIDI note -> axis position (inverse of axisToMidi). */
export function midiToAxis(m, low = MIDI_LOW, high = MIDI_HIGH) {
  return AXIS_EDGE + ((m - low) / (high - low)) * (1 - 2 * AXIS_EDGE);
}

/** All scale notes (MIDI) in [low, high], ascending. */
export function scaleNotes(scaleName, low = MIDI_LOW, high = MIDI_HIGH, root = ROOT) {
  const steps = (THEREMIN_SCALES[scaleName] || THEREMIN_SCALES.chromatic).steps;
  const out = [];
  for (let n = Math.ceil(low); n <= high; n++) {
    if (steps.includes((((n - root) % 12) + 12) % 12)) out.push(n);
  }
  return out;
}

/**
 * Pitch assist. Within each gap between neighbouring scale notes n1..n2:
 *   off    -> unchanged (true theremin)
 *   gentle -> u - strength*sin(2πu)/2π: continuous and monotonic, but flat
 *             (sticky) around each note and quick in between
 *   snap   -> nearest note (see snapWithHysteresis for the stateful version)
 */
export const GENTLE_STRENGTH = 0.85;
export function applyAssist(m, mode, notes) {
  if (mode === 'off' || !notes.length) return m;
  if (m <= notes[0]) return notes[0];
  if (m >= notes[notes.length - 1]) return notes[notes.length - 1];
  let i = 0;
  while (i < notes.length - 2 && m > notes[i + 1]) i++;
  const n1 = notes[i], n2 = notes[i + 1];
  const u = (m - n1) / (n2 - n1);
  let v;
  if (mode === 'snap') v = u < 0.5 ? 0 : 1;
  else v = u - (GENTLE_STRENGTH * Math.sin(2 * Math.PI * u)) / (2 * Math.PI);
  return n1 + v * (n2 - n1);
}

/** Snap that stays on the current note until the hand is clearly past the midpoint. */
export function snapWithHysteresis(m, notes, prevNote, hyst = SNAP_HYSTERESIS) {
  const nearest = applyAssist(m, 'snap', notes);
  if (prevNote == null || nearest === prevNote || !notes.includes(prevNote)) return nearest;
  const gap = Math.abs(nearest - prevNote);
  return Math.abs(m - prevNote) > gap * (0.5 + hyst) ? nearest : prevNote;
}

/** Volume-zone height (0 bottom .. 1 top) -> level 0..1, with a silent floor and a perceptual curve. */
export function volumeFromHeight(h) {
  const t = clamp((h - VOLUME_FLOOR) / (1 - VOLUME_FLOOR - 0.04), 0, 1);
  return Math.pow(t, 1.6);
}

/** Height of a point within the volume zone, 0 bottom .. 1 top. */
export function volumeHeight(y, layout) {
  const z = layout.volume;
  return clamp(1 - (y - z.y) / z.h, 0, 1);
}

/**
 * Decide which point controls pitch and which controls volume.
 *  - Roles are sticky: two known hands keep their roles unless they cross
 *    over by a clear margin.
 *  - The pitch hand must be on the pitch side (with hysteresis); two hands
 *    both on the volume side play nothing.
 *  - A lone hand's side decides, with a wide margin in portrait (forearms
 *    drift sideways when moving up and down).
 * @param points [{id, x, y}]
 * @param prev   previous roles {pitchId, volumeId}
 */
export function assignRoles(points, layout, prev = {}) {
  const margin = zoneMargin(layout);
  const onPitchSide = (p) => {
    if (prev.pitchId === p.id) return p.x > layout.split - margin;
    if (prev.volumeId === p.id) return p.x > layout.split + margin;
    return p.x > layout.split;
  };
  if (points.length === 0) return { pitch: null, volume: null };
  if (points.length === 1) {
    const p = points[0];
    return onPitchSide(p) ? { pitch: p, volume: null } : { pitch: null, volume: p };
  }
  // Two (or more): consider the two most recently relevant points.
  let [a, b] = [...points].sort((p, q) => q.x - p.x).slice(0, 2); // a = rightmost
  const prevP = points.find((p) => p.id === prev.pitchId);
  const prevV = points.find((p) => p.id === prev.volumeId);
  if (prevP && prevV && prevP !== prevV) {
    // Keep roles unless the pitch hand is now clearly left of the volume hand.
    const crossed = prevP.x < prevV.x - margin;
    [a, b] = crossed ? [prevV, prevP] : [prevP, prevV];
  }
  const pitch = onPitchSide(a) ? a : null;
  return { pitch, volume: b };
}

/**
 * Frame-to-frame theremin state: roles, volume memory, new-hand dwell,
 * the vibrato split and snap hysteresis. Feed it the playing points each
 * frame; it returns everything the synth and renderer need.
 */
export class ThereminState {
  constructor() { this.reset(); }

  reset() {
    this.prevRoles = {};
    this.firstSeen = new Map();
    this.volMem = { level: 0, t: -Infinity };
    this.lp = null;          // low-passed raw pitch (MIDI)
    this.lastT = null;
    this.snapNote = null;
    this.pitchId = null;
  }

  /**
   * @param points [{id, x, y, source, firstSeen?}] — already excludes hands at the toolbar
   * @param settings {assist, scale, range}
   * @param now ms
   */
  step(points, layout, settings, now) {
    const range = RANGES[settings.range] || RANGES.mid;
    // A brand-new hand must be seen briefly before it can play (passing hands are ignored).
    const live = new Set();
    const ready = points.filter((p) => {
      live.add(p.id);
      if (!this.firstSeen.has(p.id)) this.firstSeen.set(p.id, p.firstSeen ?? now);
      return p.source !== 'hand' || now - this.firstSeen.get(p.id) >= NEW_HAND_DWELL_MS;
    });
    for (const id of this.firstSeen.keys()) if (!live.has(id)) this.firstSeen.delete(id);

    const roles = assignRoles(ready, layout, this.prevRoles);
    this.prevRoles = { pitchId: roles.pitch?.id, volumeId: roles.volume?.id };

    // Volume: the volume hand's height, or its remembered level if it just left
    // (so dropping it out of frame stays silent), else the one-hand level.
    let level, remembered = false;
    if (roles.volume) {
      level = volumeFromHeight(volumeHeight(roles.volume.y, layout));
      this.volMem = { level, t: now };
    } else if (now - this.volMem.t < VOLUME_MEMORY_MS) {
      level = this.volMem.level; remembered = true;
    } else {
      level = ONE_HAND_LEVEL;
    }

    const dt = this.lastT == null ? 0.016 : Math.min(0.2, Math.max(0.001, (now - this.lastT) / 1000));
    this.lastT = now;

    if (!roles.pitch) {
      this.lp = null; this.snapNote = null; this.pitchId = null;
      return {
        roles, sounding: false, pitchPresent: false, midi: null, rawMidi: null, freq: 0, note: '', cents: 0,
        level: 0, levelPreview: roles.volume ? level : 0, volumeOnly: !!roles.volume, tone: 0.5,
        hands: roles.volume ? 1 : 0, remembered, range,
      };
    }

    const rawMidi = axisToMidi(pitchAxisPos(roles.pitch.x, roles.pitch.y, layout), range.low, range.high);
    if (this.pitchId !== roles.pitch.id || this.lp == null) { this.lp = rawMidi; this.snapNote = null; }
    this.pitchId = roles.pitch.id;
    // Split slow movement (which assist pulls toward notes) from fast wobble (vibrato, passed through).
    const a = 1 - Math.exp(-dt * 2 * Math.PI * VIBRATO_LP_HZ);
    this.lp += a * (rawMidi - this.lp);
    const notes = scaleNotes(settings.scale, range.low, range.high);
    let midi;
    if (settings.assist === 'off') {
      midi = rawMidi;
    } else {
      let centre;
      if (settings.assist === 'snap') { centre = snapWithHysteresis(this.lp, notes, this.snapNote); this.snapNote = centre; }
      else centre = applyAssist(this.lp, 'gentle', notes);
      const dev = rawMidi - this.lp;
      const wobble = Math.sign(dev) * Math.max(0, Math.abs(dev) - VIBRATO_DEADBAND);
      midi = centre + wobble;
    }
    const freq = midiToFreq(midi);
    const nearest = Math.round(midi);
    return {
      roles, sounding: level > 0.001, pitchPresent: true, midi, rawMidi, freq, note: noteName(freq),
      cents: Math.round((midi - nearest) * 100), level, levelPreview: level,
      tone: toneAxisPos(roles.pitch.x, roles.pitch.y, layout),
      hands: roles.volume ? 2 : 1, remembered, range,
    };
  }
}

/** Stateless one-shot reading (no memory, no dwell): handy for tests and previews. */
export function readTheremin(roles, layout, { assist = 'gentle', scale = 'pentatonic', range = 'mid' } = {}) {
  const r = RANGES[range] || RANGES.mid;
  const hands = (roles.pitch ? 1 : 0) + (roles.volume ? 1 : 0);
  if (!roles.pitch) {
    return { sounding: false, midi: null, rawMidi: null, freq: 0, note: '', cents: 0, level: 0, hands,
      volumeOnly: !!roles.volume, levelPreview: roles.volume ? volumeFromHeight(volumeHeight(roles.volume.y, layout)) : 0 };
  }
  const rawMidi = axisToMidi(pitchAxisPos(roles.pitch.x, roles.pitch.y, layout), r.low, r.high);
  const midi = applyAssist(rawMidi, assist, scaleNotes(scale, r.low, r.high));
  const level = roles.volume ? volumeFromHeight(volumeHeight(roles.volume.y, layout)) : ONE_HAND_LEVEL;
  const freq = midiToFreq(midi);
  return { sounding: level > 0.001, midi, rawMidi, freq, note: noteName(freq),
    cents: Math.round((midi - Math.round(midi)) * 100), level, hands };
}

export { midiToFreq, freqToMidi, noteName };
