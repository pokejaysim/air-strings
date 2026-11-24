// Song lessons for Air Strings (pure logic, no DOM or audio — imported by tests).
//
// A lesson has two steps:
//   build — you draw the strings the song needs. Each one has a "slot": a
//           dashed outline of exactly the right length for its note, laid out
//           like a small harp, so you see and feel that longer = lower.
//   play  — the string to pluck next lights up, and the song waits for you.

import { E2, L_MAX, midiToFreq, freqToMidi, rawFrequency, noteName } from './pitch.js';
import { starsFor } from './lessons.js';

/** The harp: C4 to A4. Every lesson song fits on these six strings. */
export const HARP_NOTES = [60, 62, 64, 65, 67, 69];
/** After a right pluck, brushing a neighbouring string this soon isn't counted as a mistake. */
export const STRUM_GRACE_MS = 180;

/** String length (fraction of the screen diagonal) that plays a MIDI note exactly. */
export const lengthForMidi = (midi) => (L_MAX * E2) / midiToFreq(midi);

const WHITE = [0, 2, 4, 5, 7, 9, 11];
/** The natural note (no sharps) nearest to what a string of this length plays. */
export function whiteNoteForLength(frac) {
  const m = freqToMidi(rawFrequency(Math.max(frac, 1e-4)));
  let best = Math.round(m), bestD = Infinity;
  for (let n = Math.floor(m) - 2; n <= Math.ceil(m) + 2; n++) {
    if (WHITE.includes(((n % 12) + 12) % 12) && Math.abs(n - m) < bestD) { bestD = Math.abs(n - m); best = n; }
  }
  return best;
}

/**
 * Where each harp string goes. Wide screens: strings hang down from a line,
 * low notes on the left. Tall screens: strings lie flat, low notes at the
 * bottom. Lengths are true to pitch (C is the longest); on a very small
 * screen they all shrink by the same factor `k`.
 * Each slot: { midi, name, ax, ay (the end to start from), bx, by, len, k }.
 */
export function harpSlots(W, H, { top = 120, bottom = 124 } = {}) {
  const diag = Math.hypot(W, H), n = HARP_NOTES.length;
  const longest = lengthForMidi(HARP_NOTES[0]) * diag;
  const make = (midi, ax, ay, bx, by, k) => ({
    midi, name: noteName(midiToFreq(midi)).replace(/-?\d+$/, ''), ax, ay, bx, by, len: Math.hypot(bx - ax, by - ay), k,
  });
  if (W >= H) {
    const k = Math.min(1, Math.max(60, H - top - bottom) / longest);
    const margin = Math.max(56, W * 0.12), step = (W - 2 * margin) / (n - 1);
    return HARP_NOTES.map((midi, i) => {
      const x = margin + i * step;
      return make(midi, x, top, x, top + lengthForMidi(midi) * diag * k, k);
    });
  }
  const margin = Math.max(28, W * 0.1);
  const k = Math.min(1, (W - 2 * margin) / longest);
  const left = (W - longest * k) / 2; // centre the harp; strings share a left edge
  const step = (H - top - bottom) / (n - 1);
  return HARP_NOTES.map((midi, i) => {
    const y = H - bottom - i * step;
    return make(midi, left, y, left + lengthForMidi(midi) * diag * k, y, k);
  });
}

const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);

/** The slot a drawn line fills: both ends within `tol` of the slot's ends (either way round). */
export function matchSlot(line, slots, tol) {
  let best = null, bestD = tol;
  for (const s of slots) {
    const fwd = Math.max(dist(line.ax, line.ay, s.ax, s.ay), dist(line.bx, line.by, s.bx, s.by));
    const rev = Math.max(dist(line.ax, line.ay, s.bx, s.by), dist(line.bx, line.by, s.ax, s.ay));
    const d = Math.min(fwd, rev);
    if (d <= bestD) { bestD = d; best = s; }
  }
  return best;
}

/** Why a line didn't fill the slot: 'away' | 'short' | 'long' | 'crooked'. */
export function drawFeedback(line, slot, tol) {
  const ends = [[line.ax, line.ay], [line.bx, line.by]];
  const nearEnd = ends.some(([x, y]) => Math.min(dist(x, y, slot.ax, slot.ay), dist(x, y, slot.bx, slot.by)) <= tol * 1.5);
  if (!nearEnd) return 'away';
  const len = dist(line.ax, line.ay, line.bx, line.by);
  if (len < slot.len - tol * 0.6) return 'short';
  if (len > slot.len + tol * 0.6) return 'long';
  return 'crooked';
}

/** Playing a song at your own pace: each right string moves it on. */
export class StringSongRun {
  constructor(song) {
    this.song = song;
    this.index = 0;
    this.wrong = 0;
    this.done = false;
    this.lastRightT = -Infinity;
  }

  get target() { return this.done ? null : this.song.notes[this.index]; }
  get next() { return this.done ? null : this.song.notes[this.index + 1] || null; }

  /** A string sounded. Returns 'right', 'wrong' or 'ignored'. */
  pluck(midi, nowMs) {
    if (this.done) return 'ignored';
    if (midi === this.target.midi) {
      this.index++;
      this.lastRightT = nowMs;
      if (this.index >= this.song.notes.length) this.done = true;
      return 'right';
    }
    if (nowMs - this.lastRightT < STRUM_GRACE_MS) return 'ignored'; // brushed a neighbour
    this.wrong++;
    return 'wrong';
  }

  result() {
    const total = this.song.notes.length;
    const accuracy = total / (total + this.wrong);
    return { total, wrong: this.wrong, accuracy, stars: this.done ? starsFor(accuracy) : 0 };
  }
}

/** Speeds for playing strings in time. Slower than the theremin's: a pluck takes longer than a slide. */
export const STRING_TEMPOS = {
  slow: { label: 'Slow', bpm: 50 },
  medium: { label: 'Medium', bpm: 66 },
  fast: { label: 'Fast', bpm: 84 },
};
export const TIMED_COUNT_IN = 4;  // beats before the first note
export const PERFECT_SEC = 0.12;  // this close to the beat is "perfect"
export const WINDOW_SEC = 0.3;    // this close still counts ("good")

/**
 * Playing a song in time: notes arrive on the beat whether or not you're
 * ready, and each pluck is judged by how close it lands to a note's start.
 * Times are in ms from performance.now(); the run starts when start() is called.
 */
export class StringTimedRun {
  constructor(song, { bpm = 50, countIn = TIMED_COUNT_IN } = {}) {
    this.song = song;
    this.bpm = bpm;
    this.countIn = countIn;
    this.beatMs = 60000 / bpm;
    this.t0 = null;            // ms when the count-in started
    this.grade = song.notes.map(() => null); // 'perfect' | 'good' | 'miss'
    this.wrong = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.done = false;
    this.lastRightT = -Infinity;
    this.events = [];          // recent judgements, for drawing: {i, grade, t}
  }

  get started() { return this.t0 != null; }
  start(nowMs) { if (this.t0 == null) this.t0 = nowMs; }

  /** Song position in beats (negative during the count-in). */
  pos(nowMs) { return this.t0 == null ? -this.countIn : (nowMs - this.t0) / this.beatMs - this.countIn; }
  /** When note i should be played, in ms. */
  timeOf(i) { return this.t0 + (this.countIn + this.song.notes[i].start) * this.beatMs; }
  /** The first note not yet judged (the one to play next). */
  get index() { const i = this.grade.indexOf(null); return i < 0 ? this.song.notes.length : i; }
  get target() { return this.done ? null : this.song.notes[this.index] || null; }

  _judge(i, grade, nowMs) {
    this.grade[i] = grade;
    this.events.push({ i, grade, t: nowMs });
    if (this.events.length > 12) this.events.shift();
    if (grade === 'miss') this.combo = 0;
    else { this.combo++; this.maxCombo = Math.max(this.maxCombo, this.combo); }
    if (!this.grade.includes(null)) this.done = true;
  }

  /** Mark notes whose window has passed as missed. Call every frame. */
  update(nowMs) {
    if (this.t0 == null || this.done) return;
    for (let i = 0; i < this.song.notes.length; i++) {
      if (this.grade[i] !== null) continue;
      if (nowMs - this.timeOf(i) > WINDOW_SEC * 1000) this._judge(i, 'miss', nowMs);
      else break; // notes are in time order
    }
  }

  /** A string sounded. Returns 'perfect' | 'good' | 'wrong' | 'ignored'. */
  pluck(midi, nowMs) {
    if (this.t0 == null || this.done) return 'ignored';
    this.update(nowMs);
    let best = -1, bestD = Infinity;
    for (let i = 0; i < this.song.notes.length; i++) {
      if (this.grade[i] !== null || this.song.notes[i].midi !== midi) continue;
      const d = Math.abs(nowMs - this.timeOf(i));
      if (d > WINDOW_SEC * 1000) { if (this.timeOf(i) > nowMs) break; continue; }
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best >= 0) {
      // Any earlier note still waiting was skipped over: it's a miss.
      for (let i = 0; i < best; i++) if (this.grade[i] === null) this._judge(i, 'miss', nowMs);
      const g = bestD <= PERFECT_SEC * 1000 ? 'perfect' : 'good';
      this._judge(best, g, nowMs);
      this.lastRightT = nowMs;
      return g;
    }
    if (nowMs - this.lastRightT < STRUM_GRACE_MS) return 'ignored'; // brushed a neighbour
    this.wrong++;
    this.combo = 0;
    return 'wrong';
  }

  result() {
    const total = this.song.notes.length;
    const perfect = this.grade.filter((g) => g === 'perfect').length;
    const good = this.grade.filter((g) => g === 'good').length;
    const hits = perfect + good;
    // Good counts a bit less than perfect; stray plucks cost half a note each,
    // so strumming everything all the time doesn't win.
    const score = total ? (perfect + 0.8 * good) / (total + 0.5 * this.wrong) : 0;
    return { total, hits, perfect, good, wrong: this.wrong, maxCombo: this.maxCombo, ratio: score, stars: this.done ? starsFor(score) : 0 };
  }
}

/**
 * Where notes travel when playing in time. Wide screens: notes fall straight
 * down each upright string to a now-line across them. Tall screens: notes
 * slide in from the right along each flat string to an upright now-line.
 * `far` is where notes appear (the toolbar edge on wide screens), `now` is
 * where they should be plucked; both are y (wide) or x (tall).
 */
export function timedGeometry(slots, W, H, { farTop = 70 } = {}) {
  const wide = W >= H;
  const shortest = Math.min(...slots.map((s) => s.len));
  let now, far;
  if (wide) {
    now = slots[0].ay + shortest * 0.85;
    far = Math.min(farTop, slots[0].ay - 10);
  } else {
    now = slots[0].ax + shortest * 0.55;
    far = W - 14;
  }
  const dist = Math.abs(now - far);
  const look = Math.min(4, Math.max(2, dist / 52)); // beats visible ahead
  return { wide, now, far, look, ppb: dist / look, dir: wide ? -1 : 1 };
}
