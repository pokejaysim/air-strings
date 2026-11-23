// Pure pitch math: string length -> frequency, scale snapping, note names.
// No DOM, no audio — safe to import from tests.

export const E2 = 440 * Math.pow(2, (40 - 69) / 12); // 82.41 Hz, MIDI 40
export const E5 = 440 * Math.pow(2, (76 - 69) / 12); // 659.26 Hz, MIDI 76
export const MIDI_MIN = 40;
export const MIDI_MAX = 76;

// A string whose length is L_MIN of the screen diagonal plays E5.
// Frequency is inversely proportional to length, so 8x longer plays E2.
export const L_MIN = 0.08;
export const L_MAX = L_MIN * (E5 / E2); // 0.64 of the diagonal

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const SCALES = {
  off: null,
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  pentatonic: [0, 2, 4, 7, 9], // major pentatonic
};
export const SCALE_ROOT = 4; // E

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Length as a fraction of the viewport diagonal (resolution independent). */
export function lengthFraction(ax, ay, bx, by, width, height) {
  const diag = Math.hypot(width, height);
  if (!(diag > 0)) return 0;
  return Math.hypot(bx - ax, by - ay) / diag;
}

/** Ideal-string frequency for a length fraction, without clamping. */
export function rawFrequency(lengthFrac) {
  return (E5 * L_MIN) / lengthFrac;
}

/** Frequency for a length fraction, clamped to E2..E5. */
export function lengthToFrequency(lengthFrac) {
  if (!(lengthFrac > 0)) return E5;
  return clamp(rawFrequency(lengthFrac), E2, E5);
}

export function freqToMidi(freq) {
  return 69 + 12 * Math.log2(freq / 440);
}

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const pitchClass = (n) => ((n % 12) + 12) % 12;

/** Snap a frequency to the nearest note in the scale ('off' returns it unchanged). */
export function snapFrequency(freq, scaleName = 'off', root = SCALE_ROOT) {
  const scale = SCALES[scaleName];
  if (!scale) return freq;
  const m = freqToMidi(freq);
  let best = null;
  let bestDist = Infinity;
  for (let n = Math.floor(m) - 7; n <= Math.ceil(m) + 7; n++) {
    if (n < MIDI_MIN || n > MIDI_MAX) continue;
    if (!scale.includes(pitchClass(n - root))) continue;
    const d = Math.abs(n - m);
    if (d < bestDist) { bestDist = d; best = n; }
  }
  if (best === null) best = clamp(Math.round(m), MIDI_MIN, MIDI_MAX);
  return midiToFreq(best);
}

/** Nearest note name, e.g. 440 -> "A4". */
export function noteName(freq) {
  const n = Math.round(freqToMidi(freq));
  return NOTE_NAMES[pitchClass(n)] + (Math.floor(n / 12) - 1);
}

/** Cents away from the nearest equal-tempered note (-50..50). */
export function centsOff(freq) {
  const m = freqToMidi(freq);
  return Math.round((m - Math.round(m)) * 100);
}

/** Everything a string needs to know about its pitch. */
export function pitchForLength(lengthFrac, scaleName = 'off') {
  const freq = snapFrequency(lengthToFrequency(lengthFrac), scaleName);
  return { freq, note: noteName(freq), cents: centsOff(freq) };
}
