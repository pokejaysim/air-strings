// Song lessons for the theremin: a few public-domain tunes, and the pure
// logic that walks a player through one. No DOM, no audio — imported by tests.
//
// A lesson has two steps:
//   learn — the song only moves while you are on the right note, so you can
//           take as long as you like to find each one.
//   play  — the song moves in time; each note counts if you were on it for
//           a fair share of its length (see HIT_FRACTION).

const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "C4" -> 60, "A4" -> 69, "F#3" -> 54. */
export function noteToMidi(name) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error('Bad note: ' + name);
  return 12 * (parseInt(m[3], 10) + 1) + NOTE_INDEX[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

// Each phrase is [words, notes]. A note is NAME or NAME:BEATS (default 1 beat).
// All tunes are traditional / public domain, use only C D E F G A (C4–A4,
// so they fit the Air Strings harp), and are ordered from easiest to hardest.
export const SONGS = [
  {
    id: 'buns', title: 'Hot Cross Buns', short: 'Hot Cross Buns',
    teaches: 'three notes side by side: E, D and C',
    phrases: [
      ['Hot cross buns,', 'E4 D4 C4:2'],
      ['hot cross buns,', 'E4 D4 C4:2'],
      ['one a penny, two a penny,', 'C4:.5 C4:.5 C4:.5 C4:.5 D4:.5 D4:.5 D4:.5 D4:.5'],
      ['hot cross buns.', 'E4 D4 C4:2'],
    ],
  },
  {
    id: 'mary', title: 'Mary Had a Little Lamb', short: 'Mary’s Lamb',
    teaches: 'stepping up and down, then one skip up to G',
    phrases: [
      ['Mary had a little lamb,', 'E4 D4 C4 D4 E4 E4 E4:2'],
      ['little lamb,', 'D4 D4 D4:2'],
      ['little lamb.', 'E4 G4 G4:2'],
      ['Mary had a little lamb, its', 'E4 D4 C4 D4 E4 E4 E4 E4'],
      ['fleece was white as snow.', 'D4 D4 E4 D4 C4:2'],
    ],
  },
  {
    id: 'saints', title: 'When the Saints Go Marching In', short: 'The Saints',
    teaches: 'a skip from C up to E, then long notes to hold and count',
    phrases: [
      ['Oh when the saints', 'C4 E4 F4 G4:4'],
      ['go marching in,', 'C4 E4 F4 G4:4'],
      ['oh when the saints go marching in,', 'C4 E4 F4 G4:2 E4:2 C4:2 E4:2 D4:4'],
      ['oh Lord, I want to be in that number,', 'E4 E4 D4 C4:3 C4 E4 G4:2 G4 F4:3'],
      ['when the saints go marching in.', 'E4 F4 G4:2 E4:2 C4:2 D4:2 C4:4'],
    ],
  },
  {
    id: 'jingle', title: 'Jingle Bells', short: 'Jingle Bells',
    teaches: 'lots of repeated Es, and a drop from G down to C',
    phrases: [
      ['Jingle bells, jingle bells,', 'E4 E4 E4:2 E4 E4 E4:2'],
      ['jingle all the way!', 'E4 G4 C4:1.5 D4:.5 E4:4'],
      ['Oh what fun it is to ride', 'F4 F4 F4:1.5 F4:.5 F4 E4 E4 E4:.5 E4:.5'],
      ['in a one-horse open sleigh, hey!', 'E4 D4 D4 E4 D4:2 G4:2'],
      ['Jingle bells, jingle bells,', 'E4 E4 E4:2 E4 E4 E4:2'],
      ['jingle all the way!', 'E4 G4 C4:1.5 D4:.5 E4:4'],
      ['Oh what fun it is to ride', 'F4 F4 F4:1.5 F4:.5 F4 E4 E4 E4:.5 E4:.5'],
      ['in a one-horse open sleigh!', 'G4 G4 F4 D4 C4:4'],
    ],
  },
  {
    id: 'london', title: 'London Bridge', short: 'London Bridge',
    teaches: 'a quick short note on top (A), then little steps down',
    phrases: [
      ['London Bridge is falling down,', 'G4:1.5 A4:.5 G4 F4 E4 F4 G4:2'],
      ['falling down,', 'D4 E4 F4:2'],
      ['falling down.', 'E4 F4 G4:2'],
      ['London Bridge is falling down,', 'G4:1.5 A4:.5 G4 F4 E4 F4 G4:2'],
      ['my fair lady.', 'D4:2 G4:2 E4 C4:3'],
    ],
  },
  {
    id: 'lightly', title: 'Lightly Row', short: 'Lightly Row',
    teaches: 'skipping down in thirds: G to E, F to D',
    phrases: [
      ['Lightly row, lightly row,', 'G4 E4 E4:2 F4 D4 D4:2'],
      ['o’er the glassy waves we go;', 'C4 D4 E4 F4 G4 G4 G4:2'],
      ['smoothly glide, smoothly glide,', 'G4 E4 E4:2 F4 D4 D4:2'],
      ['on the silent tide.', 'C4 E4 G4 G4 C4:4'],
      ['Let the winds and waters be', 'D4 D4 D4 D4 D4 E4 F4:2'],
      ['mingled with our melody;', 'E4 E4 E4 E4 E4 F4 G4:2'],
      ['sing and float, sing and float,', 'G4 E4 E4:2 F4 D4 D4:2'],
      ['in our little boat.', 'C4 E4 G4 G4 C4:4'],
    ],
  },
  {
    id: 'sheep', title: 'Baa Baa Black Sheep', short: 'Black Sheep',
    teaches: 'a big jump from C up to G, then walking back down',
    phrases: [
      ['Baa, baa, black sheep,', 'C4 C4 G4 G4'],
      ['have you any wool?', 'A4:.5 A4:.5 A4:.5 A4:.5 G4:2'],
      ['Yes sir, yes sir,', 'F4 F4 E4 E4'],
      ['three bags full.', 'D4 D4 C4:2'],
      ['One for the master,', 'G4 G4:.5 G4:.5 F4 F4'],
      ['one for the dame,', 'E4 E4:.5 E4:.5 D4:2'],
      ['one for the little boy who', 'G4 G4:.5 G4:.5 F4:.5 F4:.5 F4:.5 F4:.5'],
      ['lives down the lane.', 'E4 E4:.5 E4:.5 D4:2'],
    ],
  },
  {
    id: 'twinkle', title: 'Twinkle, Twinkle, Little Star', short: 'Twinkle',
    teaches: 'the same jump, with a longer walk down',
    phrases: [
      ['Twinkle, twinkle, little star,', 'C4 C4 G4 G4 A4 A4 G4:2'],
      ['how I wonder what you are.', 'F4 F4 E4 E4 D4 D4 C4:2'],
      ['Up above the world so high,', 'G4 G4 F4 F4 E4 E4 D4:2'],
      ['like a diamond in the sky.', 'G4 G4 F4 F4 E4 E4 D4:2'],
      ['Twinkle, twinkle, little star,', 'C4 C4 G4 G4 A4 A4 G4:2'],
      ['how I wonder what you are.', 'F4 F4 E4 E4 D4 D4 C4:2'],
    ],
  },
  {
    id: 'macdonald', title: 'Old MacDonald Had a Farm', short: 'Old MacDonald',
    teaches: 'leaps between C and F, and quick runs of the same note',
    phrases: [
      ['Old MacDonald had a farm,', 'F4 F4 F4 C4 D4 D4 C4:2'],
      ['E-I-E-I-O!', 'A4 A4 G4 G4 F4:3'],
      ['And on that farm he had a cow,', 'C4 F4 F4 F4 C4 D4 D4 C4:2'],
      ['E-I-E-I-O!', 'A4 A4 G4 G4 F4:3'],
      ['With a moo moo here and a moo moo there,', 'C4:.5 C4:.5 F4 F4 F4 C4:.5 C4:.5 F4 F4 F4:2'],
      ['here a moo, there a moo, everywhere a moo moo,', 'F4:.5 F4:.5 F4 F4:.5 F4:.5 F4 F4:.5 F4:.5 F4:.5 F4:.5 F4 F4'],
      ['Old MacDonald had a farm,', 'F4 F4 F4 C4 D4 D4 C4:2'],
      ['E-I-E-I-O!', 'A4 A4 G4 G4 F4:4'],
    ],
  },
  {
    id: 'ode', title: 'Ode to Joy', short: 'Ode to Joy',
    teaches: 'smooth steps, and a quick short note near the end of each line',
    phrases: [
      ['Ode to Joy · line 1', 'E4 E4 F4 G4 G4 F4 E4 D4'],
      ['Ode to Joy · line 2', 'C4 C4 D4 E4 E4:1.5 D4:.5 D4:2'],
      ['Ode to Joy · line 3', 'E4 E4 F4 G4 G4 F4 E4 D4'],
      ['Ode to Joy · line 4', 'C4 C4 D4 E4 D4:1.5 C4:.5 C4:2'],
    ],
  },
];

export const TEMPOS = {
  slow: { label: 'Slow', bpm: 60 },
  medium: { label: 'Medium', bpm: 80 },
  fast: { label: 'Fast', bpm: 100 },
};

export const ON_PITCH_TOL = 0.6;   // semitones either side of the target that count
export const COUNT_IN_BEATS = 4;   // lead-in before a timed run
export const GATE_SEC = 0.07;      // short dip in volume between notes, so repeats sound separate
export const HIT_FRACTION = 0.4;   // share of a note (after the grace time) you must be on for it to count
export const MAX_GRACE_SEC = 0.3;  // time allowed to travel to a note before it is judged

/** Expand a song into a flat list of timed notes. */
export function buildSong(song) {
  const notes = [];
  let beat = 0;
  song.phrases.forEach(([, str], phrase) => {
    for (const tok of str.trim().split(/\s+/)) {
      const [name, len] = tok.split(':');
      const beats = len ? parseFloat(len) : 1;
      notes.push({ midi: noteToMidi(name), name: name.replace(/-?\d$/, ''), start: beat, beats, phrase });
      beat += beats;
    }
  });
  const midis = notes.map((n) => n.midi);
  return {
    id: song.id, title: song.title, short: song.short || song.title, teaches: song.teaches || '',
    phrases: song.phrases.map((p) => p[0]), notes, totalBeats: beat,
    min: Math.min(...midis), max: Math.max(...midis),
  };
}

/** A pitch range fitted to the song, so its notes sit far apart and are easy to hit. */
export function lessonRange(song, pad = 3, minSpan = 12) {
  let low = song.min - pad, high = song.max + pad;
  const extra = minSpan - (high - low);
  if (extra > 0) { low -= Math.ceil(extra / 2); high += Math.floor(extra / 2); }
  return { low, high, label: 'Song' };
}

/** Stars for a timed run, from the share of notes hit. */
export function starsFor(ratio) {
  return ratio >= 0.9 ? 3 : ratio >= 0.7 ? 2 : ratio >= 0.4 ? 1 : 0;
}

export class Lesson {
  constructor(song, { mode = 'learn', bpm = 60 } = {}) {
    this.song = song;
    this.mode = mode === 'play' ? 'play' : 'learn';
    this.bpm = bpm;
    this.reset();
  }

  reset() {
    this.pos = this.mode === 'play' ? -COUNT_IN_BEATS : 0; // song position, in beats
    this.index = 0;          // note being played (or about to be)
    this.started = false;    // a timed run waits for a hand before counting in
    this.done = false;
    this.gateLeft = 0;
    this.onPitch = false;
    this.direction = 0;      // +1: target is higher than the player, -1: lower
    this.on = this.song.notes.map(() => 0);     // seconds spent on each note
    this.hit = this.song.notes.map(() => null); // true / false once a note has passed
    this.combo = 0;          // notes hit in a row (timed play)
    this.maxCombo = 0;
  }

  get target() { return this.done ? null : this.song.notes[this.index]; }

  grace(note) { return Math.min(MAX_GRACE_SEC, 0.45 * note.beats * (60 / this.bpm)); }

  /**
   * Advance by dt seconds.
   * @param reading { pitchPresent, sounding, midi } from ThereminState.step
   */
  step(reading, dt) {
    const bps = this.bpm / 60;
    const present = !!(reading && reading.pitchPresent && reading.midi != null);
    const playing = present && !!reading.sounding;
    this.gateLeft = Math.max(0, this.gateLeft - dt);
    let note = this.target;
    if (!note) return this.view();

    const diff = present ? note.midi - reading.midi : 0;
    this.onPitch = playing && Math.abs(diff) <= ON_PITCH_TOL;
    this.direction = !present || Math.abs(diff) <= ON_PITCH_TOL ? 0 : Math.sign(diff);
    const before = this.index;

    if (this.mode === 'learn') {
      // The song only moves while you're on the note.
      if (this.onPitch) {
        this.started = true;
        this.pos += dt * bps;
        this.on[this.index] += dt;
        if (this.pos >= note.start + note.beats - 1e-9) {
          this.hit[this.index] = true;
          this.index++;
          if (this.index >= this.song.notes.length) this.done = true;
          else this.pos = this.song.notes[this.index].start;
        }
      }
    } else {
      if (!this.started) {
        if (!present) return this.view();
        this.started = true;
      }
      this.pos += dt * bps;
      if (this.pos >= note.start && this.onPitch && (this.pos - note.start) / bps >= this.grace(note)) {
        this.on[this.index] += dt;
      }
      while (note && this.pos >= note.start + note.beats) {
        const judged = Math.max(0.05, note.beats / bps - this.grace(note));
        this.hit[this.index] = this.on[this.index] / judged >= HIT_FRACTION;
        this.combo = this.hit[this.index] ? this.combo + 1 : 0;
        this.maxCombo = Math.max(this.maxCombo, this.combo);
        this.index++;
        if (this.index >= this.song.notes.length) { this.done = true; note = null; }
        else note = this.song.notes[this.index];
      }
    }
    if (this.index !== before && !this.done) this.gateLeft = GATE_SEC;
    return this.view();
  }

  view() {
    return {
      mode: this.mode, pos: this.pos, index: this.index, target: this.target, total: this.song.notes.length,
      onPitch: this.onPitch && !this.done, direction: this.done ? 0 : this.direction,
      gate: this.gateLeft > 0 ? 0 : 1, started: this.started, done: this.done,
      countIn: this.mode === 'play' && this.started && this.pos < 0 ? Math.ceil(-this.pos) : 0,
      hit: this.hit, combo: this.combo,
    };
  }

  result() {
    const total = this.song.notes.length;
    const hits = this.hit.filter((h) => h === true).length;
    const ratio = total ? hits / total : 0;
    return { hits, total, ratio, maxCombo: this.maxCombo, stars: this.mode === 'learn' ? (this.done ? 3 : 0) : starsFor(ratio) };
  }
}

/** Index of the note sounding at song position `pos` (beats), or -1 between/outside notes. */
export function noteAt(song, pos) {
  for (let i = 0; i < song.notes.length; i++) {
    const n = song.notes[i];
    if (pos < n.start) return -1;
    if (pos < n.start + n.beats) return i;
  }
  return -1;
}

/**
 * "Listen first": the song played for you, as a lesson view (for the ribbon)
 * and a perfect reading (for the synth). `pos` starts at -1 (one beat lead-in).
 */
export function demoFrame(song, pos, bpm) {
  const i = noteAt(song, pos);
  const n = i >= 0 ? song.notes[i] : null;
  const next = pos < 0 ? 0 : song.notes.findIndex((m) => m.start >= pos);
  const index = i >= 0 ? i : next < 0 ? song.notes.length : next;
  const sinceStart = n ? (pos - n.start) * (60 / bpm) : 1;
  const gate = n && i > 0 && sinceStart < GATE_SEC ? 0 : 1;
  return {
    view: {
      mode: 'play', pos, index, target: song.notes[index] || null, total: song.notes.length,
      onPitch: !!n, direction: 0, gate, started: true, done: false,
      countIn: pos < 0 ? Math.ceil(-pos) : 0,
      hit: song.notes.map((_, k) => (k < index ? true : null)),
    },
    midi: n ? n.midi : null,
    done: pos >= song.totalBeats + 0.3,
  };
}

/** Streak lengths worth celebrating. */
export const STREAK_MILESTONES = [10, 25, 50, 100];
/** The milestone a streak just reached going from `prev` to `cur`, or 0. */
export function streakMilestone(prev, cur) {
  let hit = 0;
  for (const m of STREAK_MILESTONES) if (prev < m && cur >= m) hit = m;
  return hit;
}
