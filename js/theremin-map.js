// Pure theremin math: screen layout, which hand does what, hand position ->
// pitch and volume, and pitch "assist" (pulling toward scale notes).
// No DOM, no audio — imported by tests.

import { midiToFreq, freqToMidi, noteName, clamp } from './pitch.js';

export const THEREMIN_SCALES = {
  chromatic: { label: 'Chromatic', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  major: { label: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
  pentatonic: { label: 'Pentatonic', steps: [0, 2, 4, 7, 9] },
  minor: { label: 'Minor pent.', steps: [0, 3, 5, 7, 10] },
};
export const ROOT = 0;        // C
export const MIDI_LOW = 48;   // C3
export const MIDI_HIGH = 72;  // C5 (two octaves)
export const AXIS_EDGE = 0.05; // dead margin at each end of the pitch axis
export const VOLUME_FLOOR = 0.12; // bottom 12% of the volume zone is silence
export const ONE_HAND_LEVEL = 0.7; // steady volume when only the pitch hand is up
export const ZONE_HYSTERESIS = 0.04; // fraction of width before a lone hand switches zone

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

/** Position along the pitch axis, 0 (lowest) .. 1 (highest), before edge margins. */
export function pitchAxisPos(x, y, layout) {
  const z = layout.pitch;
  return layout.axis === 'x' ? (x - z.x) / z.w : 1 - (y - z.y) / z.h;
}

/** Inverse of pitchAxisPos for drawing: axis position -> screen coordinate along the axis. */
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
 *   snap   -> nearest note (the synth glides between them)
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
 * Decide which point (hand or finger) controls pitch and which controls volume.
 * Two points: the one further right plays pitch, the other sets volume.
 * One point: its zone decides, with hysteresis so it doesn't flip at the border.
 * @param points [{id, x, y}]
 * @param prev   previous roles {pitchId, volumeId}
 */
export function assignRoles(points, layout, prev = {}) {
  if (points.length === 0) return { pitch: null, volume: null };
  if (points.length >= 2) {
    const [a, b] = [...points].sort((p, q) => q.x - p.x); // rightmost first
    return { pitch: a, volume: b };
  }
  const p = points[0];
  const margin = ZONE_HYSTERESIS * layout.W;
  let inPitch;
  if (prev.pitchId === p.id) inPitch = p.x > layout.split - margin;
  else if (prev.volumeId === p.id) inPitch = p.x > layout.split + margin;
  else inPitch = p.x > layout.split;
  return inPitch ? { pitch: p, volume: null } : { pitch: null, volume: p };
}

/**
 * Everything the synth and renderer need for one frame.
 * @returns {{sounding, midi, rawMidi, freq, note, cents, level, hands}}
 */
export function readTheremin(roles, layout, { assist = 'gentle', scale = 'pentatonic' } = {}) {
  const hands = (roles.pitch ? 1 : 0) + (roles.volume ? 1 : 0);
  if (!roles.pitch) {
    return { sounding: false, midi: null, rawMidi: null, freq: 0, note: '', cents: 0, level: 0, hands,
      volumeOnly: !!roles.volume, levelPreview: roles.volume ? volumeFromHeight(volumeHeight(roles.volume.y, layout)) : 0 };
  }
  const rawMidi = axisToMidi(pitchAxisPos(roles.pitch.x, roles.pitch.y, layout));
  const midi = applyAssist(rawMidi, assist, scaleNotes(scale));
  const level = roles.volume ? volumeFromHeight(volumeHeight(roles.volume.y, layout)) : ONE_HAND_LEVEL;
  const freq = midiToFreq(midi);
  const nearest = Math.round(midi);
  return {
    sounding: level > 0.001, midi, rawMidi, freq, note: noteName(freq),
    cents: Math.round((midi - nearest) * 100), level, hands,
  };
}

export { midiToFreq, freqToMidi, noteName };
