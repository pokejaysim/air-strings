import {
  E2, E5, L_MIN, L_MAX, lengthToFrequency, rawFrequency, snapFrequency,
  noteName, freqToMidi, midiToFreq, lengthFraction, pitchForLength, centsOff, SCALES, SCALE_ROOT, noteHue,
} from './pitch.js';
import { FX, MAX_PARTICLES } from './fx.js';
import { StringBank } from './strings.js';
import { Interaction, TUNING } from './interaction.js';
import { HandGestures, videoToScreen, PINCH_ON, PINCH_OFF } from './gestures.js';
import * as TH from './theremin-map.js';
import { SONGS, TEMPOS, buildSong, lessonRange, Lesson, noteToMidi, starsFor, GATE_SEC, COUNT_IN_BEATS, noteAt, demoFrame, streakMilestone } from './lessons.js';
import { ribbonGeometry } from './lesson-view.js';
import { suggestedSong } from './song-picker.js';
import { parseHands } from './tracking.js';
import { parseFace, FaceControls, CAL_MS, MOUTH_RANGE, BROW_ON, BROW_OFF, LOST_MS, TILT_START, TILT_FULL } from './face.js';
import { faceFilter, vibratoCents, VIBRATO_MAX_CENTS } from './theremin-synth.js';
import { StringSynth } from './audio.js';
import { FaceSession } from './face.js';
import { SignWatcher, SIGNS, GAP_MS, SHOW_AFTER_MS, COOLDOWN_MS, MIN_SCORE, fingerStates, shapeOf, isOpenPalm, WAVE_TURNS, WAVE_STALL_MS } from './hand-signs.js';
import { HARP_NOTES, lengthForMidi, whiteNoteForLength, harpSlots, matchSlot, drawFeedback, StringSongRun, StringTimedRun, timedGeometry, STRING_TEMPOS, PERFECT_SEC, WINDOW_SEC } from './string-lessons.js';

const results = [];
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
function test(name, fn) {
  try {
    const ok = fn();
    results.push({ name, ok: ok !== false, msg: ok === false ? 'assertion returned false' : '' });
  } catch (e) {
    results.push({ name, ok: false, msg: e.message });
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

test('Halving a string raises it exactly one octave', () => {
  for (const L of [0.2, 0.3, 0.5]) {
    const f = lengthToFrequency(L), f2 = lengthToFrequency(L / 2);
    assert(near(f2, 2 * f), `L=${L}: ${f2} != 2*${f}`);
  }
});
test('Doubling a string lowers it exactly one octave', () => {
  const f = lengthToFrequency(0.15), f2 = lengthToFrequency(0.3);
  assert(near(f2, f / 2), `${f2} != ${f}/2`);
});
test('Frequency is inversely proportional to length', () => {
  assert(near(rawFrequency(0.1) * 0.1, rawFrequency(0.37) * 0.37), 'f*L not constant');
});
test('L_MIN plays E5, L_MAX plays E2', () => {
  assert(near(lengthToFrequency(L_MIN), E5), 'L_MIN');
  assert(near(lengthToFrequency(L_MAX), E2), 'L_MAX');
});
test('Range is clamped to E2..E5', () => {
  assert(near(lengthToFrequency(0.001), E5), 'too short should clamp to E5');
  assert(near(lengthToFrequency(5), E2), 'too long should clamp to E2');
  assert(near(lengthToFrequency(0), E5), 'zero length should not crash');
});
test('Longer strings are never higher', () => {
  let prev = Infinity;
  for (let L = 0.01; L < 1; L += 0.01) {
    const f = lengthToFrequency(L);
    assert(f <= prev + 1e-9, `non-monotonic at ${L}`);
    prev = f;
  }
});
test('Note names', () => {
  assert(noteName(440) === 'A4', noteName(440));
  assert(noteName(E2) === 'E2', noteName(E2));
  assert(noteName(E5) === 'E5', noteName(E5));
  assert(noteName(261.63) === 'C4', noteName(261.63));
  assert(noteName(277.18) === 'C#4', noteName(277.18));
});
test('MIDI conversions round-trip', () => {
  for (const m of [40, 57, 69, 76]) assert(near(freqToMidi(midiToFreq(m)), m), String(m));
});
test('Snap "off" leaves the frequency alone', () => {
  assert(snapFrequency(300, 'off') === 300, 'changed');
});
test('Chromatic snap lands on a whole semitone', () => {
  for (let f = E2; f < E5; f *= 1.037) {
    const m = freqToMidi(snapFrequency(f, 'chromatic'));
    assert(near(m, Math.round(m), 1e-9), `${f} -> midi ${m}`);
    assert(Math.abs(m - freqToMidi(f)) <= 0.5 + 1e-9, `${f} moved more than a semitone/2`);
  }
});
test('Pentatonic snap only produces E major pentatonic notes', () => {
  const allowed = new Set(['E', 'F#', 'G#', 'B', 'C#']);
  for (let f = E2; f < E5; f *= 1.021) {
    const name = noteName(snapFrequency(f, 'pentatonic')).replace(/\d+$/, '');
    assert(allowed.has(name), `${f.toFixed(1)} -> ${name}`);
  }
  assert(SCALES.pentatonic.length === 5 && SCALE_ROOT === 4, 'scale definition');
});
test('Snapped notes stay inside E2..E5', () => {
  for (const f of [E2, E2 * 0.99, E5, E5 * 1.01]) {
    const s = snapFrequency(f, 'pentatonic');
    assert(s >= E2 - 1e-6 && s <= E5 + 1e-6, `${f} -> ${s}`);
  }
});
test('Length fraction is resolution independent', () => {
  const a = lengthFraction(0, 0, 300, 400, 1200, 900); // 500 / 1500
  const b = lengthFraction(0, 0, 600, 800, 2400, 1800);
  assert(near(a, 1 / 3) && near(a, b), `${a} vs ${b}`);
});
test('pitchForLength gives label and cents', () => {
  const p = pitchForLength(L_MIN * 2, 'chromatic'); // E4
  assert(p.note === 'E4', p.note);
  assert(p.cents === 0, String(p.cents));
  assert(Math.abs(centsOff(445)) < 50, 'cents range');
});

// ---- Interaction (simulated hands at 30 fps, no camera needed) ----
const W = 1200, H = 900; // diagonal 1500
function rig() {
  const plucks = [];
  const bank = new StringBank();
  const synth = { pluck: (p) => { plucks.push(p); return true; } };
  const ix = new Interaction({ bank, synth });
  let t = 1000;
  const hand = (x, y, pinching, extra = {}, source = 'hand') => ({
    id: source + ':1', source, x, y, tipX: x, tipY: y, thumbX: x, thumbY: y,
    ...(source === 'hand' ? { palmX: x, palmY: y + 120 } : {}),
    pinching, pinchStarted: false, pinchEnded: false, lost: false, ...extra,
  });
  // Feed a gesture: list of [x, y, pinching]; derives started/ended flags.
  const run = (pts, dtMs = 33, source = 'hand') => {
    let was = false;
    for (const [x, y, pinch] of pts) {
      t += dtMs;
      ix.update([hand(x, y, pinch, { pinchStarted: pinch && !was, pinchEnded: !pinch && was }, source)], W, H, t);
      was = pinch;
    }
  };
  const line = (x0, y0, x1, y1, n, pinch) => Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, pinch]);
  return { bank, ix, plucks, run, line, wait: (ms) => { t += ms; } };
}

test('Hand pinch-drag-release draws a string of the dragged length', () => {
  const r = rig();
  r.run([[100, 100, false], ...r.line(100, 100, 700, 100, 10, true), [700, 100, false]]);
  assert(r.bank.strings.length === 1, `strings: ${r.bank.strings.length}`);
  assert(near(r.bank.strings[0].lengthFrac, 600 / 1500, 1e-3), `frac ${r.bank.strings[0].lengthFrac}`);
});
test('Too-short strings are ignored', () => {
  const r = rig();
  r.run([[100, 100, false], ...r.line(100, 100, 130, 100, 3, true), [130, 100, false]]);
  assert(r.bank.strings.length === 0, 'short string was added');
});
test('Losing the hand mid-draw cancels the string', () => {
  const r = rig();
  r.run([[100, 100, false], ...r.line(100, 100, 500, 100, 5, true)]);
  r.ix.update([{ id: 'hand:Right', source: 'hand', x: 500, y: 100, tipX: 500, tipY: 100, pinching: false, pinchStarted: false, pinchEnded: true, lost: true }], W, H, 99999);
  assert(r.bank.strings.length === 0, 'string added after tracking loss');
});
test('Pinch-pull-release plucks; a bigger pull is louder', () => {
  const r = rig();
  r.bank.add(200, 400, 1000, 400, W, H);
  r.run([[600, 402, false], ...r.line(600, 402, 600, 430, 4, true), [600, 430, false]]);
  r.run([[600, 400, false], ...r.line(600, 400, 600, 500, 6, true), [600, 500, false]]);
  assert(r.plucks.length === 2, `plucks: ${r.plucks.length}`);
  assert(r.plucks[1].amp > r.plucks[0].amp, `amps ${r.plucks[0].amp} !< ${r.plucks[1].amp}`);
  assert(near(r.plucks[0].freq, r.bank.strings[0].freq), 'wrong pitch');
});
test('A fast fingertip swipe strums every string it crosses', () => {
  const r = rig();
  for (const y of [300, 400, 500]) r.bank.add(300, y, 900, y, W, H);
  r.run(r.line(600, 200, 600, 620, 6, false)); // 70 px per 33 ms frame, about 1.4 diagonals/s
  assert(r.plucks.length === 3, `strums: ${r.plucks.length}`);
});
test('A slow fingertip crossing does not strum', () => {
  const r = rig();
  r.bank.add(300, 400, 900, 400, W, H);
  r.run(r.line(600, 380, 600, 420, 20, false)); // 2 px per frame
  assert(r.plucks.length === 0, `strums: ${r.plucks.length}`);
});
test('Holding still, then swiping, still strums on the first frame', () => {
  const r = rig();
  r.bank.add(300, 400, 900, 400, W, H);
  r.run([[600, 360, false], [600, 360, false], [600, 360, false]], 400);
  r.run([[600, 440, false]], 33);
  assert(r.plucks.length === 1, `strums: ${r.plucks.length}`);
});
test('Strum cooldown stops one swipe from double-triggering', () => {
  const r = rig();
  r.bank.add(300, 400, 900, 400, W, H);
  r.run([[600, 340, false], [600, 460, false], [600, 340, false]], 33); // back and forth in 66 ms
  assert(r.plucks.length === 1, `strums: ${r.plucks.length}`);
});
test('No modes: pinching ON a string plucks it and does not draw a new one', () => {
  const r = rig();
  r.bank.add(200, 400, 1000, 400, W, H);
  r.run([[600, 410, false], ...r.line(600, 410, 600, 480, 5, true), [600, 480, false]]);
  assert(r.plucks.length === 1, `plucks: ${r.plucks.length}`);
  assert(r.bank.strings.length === 1, `strings: ${r.bank.strings.length}`);
});
test('No modes: pinching in EMPTY space draws, even with strings on screen', () => {
  const r = rig();
  r.bank.add(200, 400, 1000, 400, W, H);
  r.run([[200, 700, false], ...r.line(200, 700, 800, 700, 8, true), [800, 700, false]]);
  assert(r.bank.strings.length === 2, `strings: ${r.bank.strings.length}`);
  assert(r.plucks.length === 0, `plucks: ${r.plucks.length}`);
});
test('Mouse: a fast flick across strings strums and does not draw', () => {
  const r = rig();
  for (const y of [300, 400, 500]) r.bank.add(300, y, 900, y, W, H);
  r.run([...r.line(600, 200, 600, 620, 4, true), [600, 620, false]], 16, 'mouse');
  assert(r.plucks.length === 3, `strums: ${r.plucks.length}`);
  assert(r.bank.strings.length === 3, `strings: ${r.bank.strings.length}`);
});
test('Mouse: a normal drag across a string draws without strumming', () => {
  const r = rig();
  r.bank.add(300, 400, 900, 400, W, H);
  r.run([...r.line(600, 250, 640, 560, 40, true), [640, 560, false]], 16, 'mouse'); // ~0.5 diag/s
  assert(r.plucks.length === 0, `strums: ${r.plucks.length}`);
  assert(r.bank.strings.length === 2, `strings: ${r.bank.strings.length}`);
});

// ---- Strum vs draw (the "my strums make lines" problem) ----
test('Strum with fingers touching mid-swipe: strums, draws nothing', () => {
  const r = rig();
  for (const y of [300, 400, 500]) r.bank.add(300, y, 900, y, W, H);
  // Open hand swiping down fast; fingers close for a few frames in the middle.
  const pts = r.line(600, 150, 600, 650, 10, false);
  for (const i of [4, 5, 6, 7]) pts[i][2] = true;
  r.run(pts);
  assert(r.plucks.length === 3, `strums: ${r.plucks.length}`);
  assert(r.bank.strings.length === 3, `stray strings drawn: ${r.bank.strings.length - 3}`);
});
test('Fingers closing mid-swipe in empty space draw nothing', () => {
  const r = rig();
  const pts = r.line(100, 600, 1100, 600, 10, false); // fast sideways swipe, no strings around
  for (const i of [3, 4, 5, 6, 7, 8]) pts[i][2] = true;
  r.run(pts);
  assert(r.bank.strings.length === 0, `stray strings: ${r.bank.strings.length}`);
});
test('Fingers closing mid-swipe near a string do not grab it', () => {
  const r = rig();
  r.bank.add(300, 400, 900, 400, W, H);
  const pts = r.line(600, 250, 600, 560, 6, false);
  pts[3][2] = true; pts[4][2] = true; // pinch right as the hand passes the string
  r.run(pts);
  assert(r.plucks.length === 1, `expected 1 strum, got ${r.plucks.length}`);
  assert(!r.bank.strings[0].pull, 'string should not be held');
});
test('A quick pinch-flick from rest (no hold) does not draw', () => {
  const r = rig();
  r.run([[200, 700, false], [200, 700, false], ...r.line(200, 700, 900, 700, 4, true), [900, 700, false]]);
  assert(r.bank.strings.length === 0, `strings: ${r.bank.strings.length}`);
});
test('A deliberate pinch-hold-drag still draws', () => {
  const r = rig();
  const hold = Array.from({ length: 6 }, () => [200, 700, true]); // ~200 ms hold
  r.run([[200, 700, false], ...hold, ...r.line(200, 700, 800, 700, 12, true), [800, 700, false]]);
  assert(r.bank.strings.length === 1, `strings: ${r.bank.strings.length}`);
  assert(near(r.bank.strings[0].lengthFrac, 600 / 1500, 1e-3), 'string starts where the pinch began');
});
test('A pinch-drag that whips across strings strums them instead of drawing', () => {
  const r = rig();
  for (const y of [400, 500]) r.bank.add(300, y, 900, y, W, H);
  const hold = Array.from({ length: 6 }, () => [600, 250, true]);
  r.run([[600, 250, false], ...hold, ...r.line(600, 250, 600, 650, 3, true), [600, 650, false]]);
  assert(r.plucks.length === 2, `strums: ${r.plucks.length}`);
  assert(r.bank.strings.length === 2, `stray strings: ${r.bank.strings.length - 2}`);
});
test('Closing a pinch moves the fingertip, but that alone is not a swipe', () => {
  const r = rig();
  // Palm still; index tip snaps 60 px toward the thumb as the pinch closes.
  const t0 = 1000;
  const mk = (tipY, pinching, started) => ({ id: 'hand:1', source: 'hand', x: 300, y: 600, tipX: 300, tipY: tipY,
    palmX: 300, palmY: 720, pinching, pinchStarted: started, pinchEnded: false, lost: false });
  r.ix.update([mk(540, false, false)], W, H, t0);
  r.ix.update([mk(540, false, false)], W, H, t0 + 33);
  r.ix.update([mk(600, true, true)], W, H, t0 + 66);
  assert(r.ix.pointerStatus('hand:1').action === 'pendingDraw', r.ix.pointerStatus('hand:1').action);
});
test('Tuning: hands need a held pinch, mouse clicks are immediate', () => {
  assert(TUNING.hand.armMs > 0 && TUNING.mouse.armMs === 0, 'arm times');
  assert(TUNING.hand.pinchStartMaxSpeed < TUNING.hand.strumSpeed * 2, 'fast pinch starts are ignored');
});

test('Longer strings play lower than shorter ones', () => {
  const r = rig();
  const a = r.bank.add(100, 100, 1000, 100, W, H), b = r.bank.add(100, 300, 400, 300, W, H);
  assert(a.freq < b.freq, `${a.freq} !< ${b.freq}`);
});

// ---- Hand landmarks -> pointers ----
function fakeHand(thumbIndexGap) {
  // Palm: wrist (0) at y=0.7, middle MCP (9) at y=0.5 => palm length 0.2 of video height.
  const L = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  L[0] = { x: 0.5, y: 0.7, z: 0 };
  L[5] = { x: 0.46, y: 0.5, z: 0 };
  L[9] = { x: 0.5, y: 0.5, z: 0 };
  L[17] = { x: 0.56, y: 0.52, z: 0 };
  L[4] = { x: 0.4, y: 0.4, z: 0 };
  L[8] = { x: 0.4, y: 0.4 - thumbIndexGap, z: 0 };
  return [{ landmarks: L, handedness: 'Right', score: 0.99 }];
}
test('Pinch detection uses hysteresis (no flicker near the threshold)', () => {
  const g = new HandGestures();
  const video = { videoWidth: 1280, videoHeight: 720 };
  let t = 0;
  const step = (ratio) => g.update(fakeHand(ratio * 0.2), video, 1280, 720, (t += 33))[0];
  const mid = (PINCH_ON + PINCH_OFF) / 2;
  assert(!step(0.8).pinching, 'open hand should not pinch');
  assert(!step(mid).pinching, 'between thresholds from open: still not pinching');
  const blip = step(PINCH_ON * 0.6);
  assert(!blip.pinching, 'a single closed frame (motion blur) should not pinch');
  const p = step(PINCH_ON * 0.6);
  assert(p.pinching && p.pinchStarted, 'two closed frames in a row should start a pinch');
  assert(step(mid).pinching, 'between thresholds while pinched: stays pinched');
  const r = step(PINCH_OFF * 1.4);
  assert(!r.pinching && r.pinchEnded, 'opening past PINCH_OFF should release');
});
test('Video is mirrored onto the screen', () => {
  const left = videoToScreen(0.1, 0.5, 1280, 720, 1280, 720);
  assert(left.x > 1000, `x=${left.x} (a hand on the camera's left appears on screen right)`);
  const cover = videoToScreen(0.5, 0.5, 1280, 720, 800, 800);
  assert(near(cover.x, 400) && near(cover.y, 400), 'center maps to center under object-fit: cover');
});
test('Hand that leaves the frame emits a final lost pointer', () => {
  const g = new HandGestures();
  const video = { videoWidth: 1280, videoHeight: 720 };
  g.update(fakeHand(0.01), video, 1280, 720, 0);
  g.update(fakeHand(0.01), video, 1280, 720, 33);
  const out = g.update([], video, 1280, 720, 500);
  assert(out.length === 1 && out[0].lost && out[0].pinchEnded, JSON.stringify(out[0]));
  assert(g.update([], video, 1280, 720, 600).length === 0, 'hand should be forgotten');
});

// ---- Theremin ----
test('Theremin: pitch axis spans C3..C5 with dead margins at the ends', () => {
  assert(TH.axisToMidi(0) === 48 && TH.axisToMidi(TH.AXIS_EDGE) === 48, 'low end');
  assert(TH.axisToMidi(1) === 72 && TH.axisToMidi(1 - TH.AXIS_EDGE) === 72, 'high end');
  assert(near(TH.axisToMidi(0.5), 60), 'middle is C4');
  for (const m of [48, 55.5, 60, 71]) assert(near(TH.axisToMidi(TH.midiToAxis(m)), m), `round trip ${m}`);
});
test('Theremin: scale notes', () => {
  assert(TH.scaleNotes('chromatic').length === 25, 'chromatic 2 octaves');
  assert(TH.scaleNotes('pentatonic').join() === '48,50,52,55,57,60,62,64,67,69,72', TH.scaleNotes('pentatonic').join());
  assert(TH.scaleNotes('major').every((n) => [0, 2, 4, 5, 7, 9, 11].includes(n % 12)), 'major');
  assert(TH.scaleNotes('minor').every((n) => [0, 3, 5, 7, 10].includes(n % 12)), 'minor pent');
});
test('Theremin: assist Off leaves pitch untouched', () => {
  const notes = TH.scaleNotes('pentatonic');
  for (const m of [49.3, 58.7, 70.1]) assert(TH.applyAssist(m, 'off', notes) === m, String(m));
});
test('Theremin: assist Snap always lands on a scale note', () => {
  const notes = TH.scaleNotes('major');
  for (let m = 48; m <= 72; m += 0.137) assert(notes.includes(TH.applyAssist(m, 'snap', notes)), `${m}`);
});
test('Theremin: assist Gentle is continuous, monotonic and sticky near notes', () => {
  const notes = TH.scaleNotes('pentatonic');
  let prev = -Infinity, maxJump = 0;
  for (let m = 48; m <= 72; m += 0.005) {
    const g = TH.applyAssist(m, 'gentle', notes);
    assert(g >= prev - 1e-9, `went backwards at ${m}`);
    if (prev > -Infinity) maxJump = Math.max(maxJump, g - prev);
    prev = g;
  }
  assert(maxJump < 0.05, `jumpy: ${maxJump}`);
  for (const n of notes) assert(TH.applyAssist(n, 'gentle', notes) === n || near(TH.applyAssist(n, 'gentle', notes), n), `note ${n} moves`);
  // 0.4 semitone off a note is pulled most of the way back
  const pulled = TH.applyAssist(60.4, 'gentle', notes);
  assert(pulled - 60 < 0.15, `not sticky: ${pulled}`);
});
test('Theremin: volume has a silent floor and reaches full at the top', () => {
  assert(TH.volumeFromHeight(0) === 0 && TH.volumeFromHeight(TH.VOLUME_FLOOR) === 0, 'floor');
  assert(TH.volumeFromHeight(1) === 1, 'top');
  let prev = 0;
  for (let h = 0; h <= 1; h += 0.01) { const v = TH.volumeFromHeight(h); assert(v >= prev, 'monotonic'); prev = v; }
});
test('Theremin: layout follows orientation', () => {
  const land = TH.layoutFor(1200, 700), port = TH.layoutFor(390, 844);
  assert(land.axis === 'x' && land.pitch.x > land.volume.x, 'landscape: pitch on the right, left-right axis');
  assert(port.axis === 'y' && port.split === 195, 'portrait: halves, up-down axis');
  // Portrait: higher on screen = higher pitch
  assert(TH.pitchAxisPos(300, 100, port) > TH.pitchAxisPos(300, 700, port), 'portrait up is higher');
  // Landscape: further right = higher pitch
  assert(TH.pitchAxisPos(1100, 300, land) > TH.pitchAxisPos(600, 300, land), 'landscape right is higher');
});
test('Theremin: two hands -> right one is pitch, left one is volume', () => {
  const L = TH.layoutFor(1200, 700);
  const r = TH.assignRoles([{ id: 'a', x: 300, y: 200 }, { id: 'b', x: 900, y: 400 }], L);
  assert(r.pitch.id === 'b' && r.volume.id === 'a', JSON.stringify(r));
});
test('Theremin: one hand plays at steady volume; on the volume side alone it is silent', () => {
  const L = TH.layoutFor(1200, 700);
  const one = TH.readTheremin(TH.assignRoles([{ id: 'a', x: 900, y: 300 }], L), L);
  assert(one.sounding && one.level === TH.ONE_HAND_LEVEL, JSON.stringify(one));
  const vol = TH.readTheremin(TH.assignRoles([{ id: 'a', x: 200, y: 100 }], L), L);
  assert(!vol.sounding && vol.volumeOnly, JSON.stringify(vol));
});
test('Theremin: volume hand at the bottom silences, at the top is loud', () => {
  const L = TH.layoutFor(1200, 700);
  const pts = (vy) => [{ id: 'v', x: 200, y: vy }, { id: 'p', x: 900, y: 300 }];
  assert(!TH.readTheremin(TH.assignRoles(pts(695), L), L).sounding, 'bottom should be silent');
  assert(TH.readTheremin(TH.assignRoles(pts(5), L), L).level > 0.95, 'top should be loud');
});
test('Theremin: a lone hand near the zone border does not flicker between roles', () => {
  const L = TH.layoutFor(1200, 700);
  let prev = {};
  const roleAt = (x) => {
    const r = TH.assignRoles([{ id: 'a', x, y: 300 }], L, prev);
    prev = { pitchId: r.pitch?.id, volumeId: r.volume?.id };
    return r.pitch ? 'pitch' : 'volume';
  };
  assert(roleAt(L.split + 30) === 'pitch', 'start in pitch');
  assert(roleAt(L.split - 10) === 'pitch', 'small step over the border keeps pitch');
  assert(roleAt(L.split - 80) === 'volume', 'clearly over the border switches');
  assert(roleAt(L.split + 10) === 'volume', 'and stays volume near the border');
});
test('Theremin: reading reports note name and frequency', () => {
  const L = TH.layoutFor(1200, 700);
  const x = TH.axisToScreen(TH.midiToAxis(57), L); // A3
  const r = TH.readTheremin(TH.assignRoles([{ id: 'a', x, y: 300 }], L), L, { assist: 'snap', scale: 'pentatonic' });
  assert(r.note === 'A3' && near(r.freq, 220, 1e-6), `${r.note} ${r.freq}`);
});

// ---- Theremin: review fixes ----
const thSettings = (o = {}) => ({ assist: 'gentle', scale: 'pentatonic', range: 'mid', ...o });
const hp = (id, x, y, firstSeen = -1e9) => ({ id, x, y, source: 'hand', firstSeen });
test('Theremin: dropping the volume hand out of frame stays silent (no 70% surprise)', () => {
  const L = TH.layoutFor(1200, 700), S = new TH.ThereminState();
  let t = 0;
  const pitchP = hp('p', 900, 300);
  // Volume hand at the bottom (silent), then it leaves the frame.
  let r;
  for (let i = 0; i < 5; i++) r = S.step([hp('v', 200, 690), pitchP], L, thSettings(), (t += 33));
  assert(!r.sounding, 'should be silent with the volume hand at the bottom');
  for (let i = 0; i < 20; i++) r = S.step([pitchP], L, thSettings(), (t += 33)); // ~660 ms later
  assert(!r.sounding, `came back at ${r.level}`);
  for (let i = 0; i < 40; i++) r = S.step([pitchP], L, thSettings(), (t += 33)); // > 1.5 s
  assert(r.sounding && r.level === TH.ONE_HAND_LEVEL, 'after a while one hand plays at steady volume');
});
test('Theremin: a hand passing through the frame does not sound straight away', () => {
  const L = TH.layoutFor(1200, 700), S = new TH.ThereminState();
  const r1 = S.step([hp('n', 900, 300, 1000)], L, thSettings(), 1000 + 40);
  assert(!r1.sounding, 'sounded after 40 ms');
  const r2 = S.step([hp('n', 900, 300, 1000)], L, thSettings(), 1000 + 200);
  assert(r2.sounding, 'should sound once it has been seen a moment');
});
test('Theremin: two hands near each other do not swap roles unless they clearly cross', () => {
  const L = TH.layoutFor(1200, 700);
  let roles = TH.assignRoles([hp('a', 420, 300), hp('b', 520, 300)], L);
  assert(roles.pitch.id === 'b', 'right hand starts as pitch');
  const prev = { pitchId: 'b', volumeId: 'a' };
  roles = TH.assignRoles([hp('a', 500, 300), hp('b', 480, 300)], L, prev); // small overlap
  assert(roles.pitch.id === 'b' && roles.volume.id === 'a', 'small overlap swapped roles');
  roles = TH.assignRoles([hp('a', 800, 300), hp('b', 480, 300)], L, prev); // clear cross
  assert(roles.pitch.id === 'a', 'clear crossing should swap');
});
test('Theremin: two hands both on the volume side play nothing', () => {
  const L = TH.layoutFor(1200, 700);
  const roles = TH.assignRoles([hp('a', 100, 300), hp('b', 300, 300)], L);
  assert(!roles.pitch, 'a hand on the volume side became the pitch hand');
});
test('Theremin: in portrait a lone pitch hand can drift sideways without cutting out', () => {
  const L = TH.layoutFor(390, 844);
  let prev = { pitchId: 'a' };
  const r = TH.assignRoles([hp('a', L.split - 0.1 * 390, 400)], L, prev); // 10% over the line
  assert(r.pitch && r.pitch.id === 'a', 'lost the pitch role');
});
test('Theremin: Snap does not trill when the hand jitters near a midpoint', () => {
  const notes = TH.scaleNotes('chromatic');
  let cur = null;
  const outs = new Set();
  for (const m of [60.48, 60.53, 60.47, 60.55, 60.5, 60.46, 60.54]) { cur = TH.snapWithHysteresis(m, notes, cur); outs.add(cur); }
  assert(outs.size === 1, `trilled between ${[...outs]}`);
  assert(TH.snapWithHysteresis(60.7, notes, 60) === 61, 'clear move should change note');
});
test('Theremin: vibrato passes through Gentle assist', () => {
  const L = TH.layoutFor(1200, 700), S = new TH.ThereminState();
  const r = TH.RANGES.mid;
  const xFor = (m) => TH.axisToScreen(TH.midiToAxis(m, r.low, r.high), L);
  let t = 0, lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 90; i++) {
    t += 33;
    const m = 60 + 0.3 * Math.sin(2 * Math.PI * 6 * (t / 1000)); // ±0.3 semitone at 6 Hz around C4
    const out = S.step([hp('p', xFor(m), 300)], L, thSettings(), t);
    if (i > 30) { lo = Math.min(lo, out.midi); hi = Math.max(hi, out.midi); }
  }
  assert(hi - lo > 0.3, `vibrato depth only ${(hi - lo).toFixed(2)} semitones`);
  assert(Math.abs((hi + lo) / 2 - 60) < 0.15, 'stays centred on the note');
});
test('Theremin: Range moves the octaves', () => {
  assert(TH.axisToMidi(0.5, TH.RANGES.low.low, TH.RANGES.low.high) === 48, 'low range middle is C3');
  assert(TH.axisToMidi(1, TH.RANGES.high.low, TH.RANGES.high.high) === 84, 'high range top is C6');
  const L = TH.layoutFor(1200, 700), S = new TH.ThereminState();
  const out = S.step([hp('p', L.pitch.x + L.pitch.w / 2, 300)], L, thSettings({ range: 'high', assist: 'off' }), 5000);
  assert(near(out.midi, 72), `high range centre ${out.midi}`);
});
test('Theremin: the pitch hand\'s other direction sets tone', () => {
  const land = TH.layoutFor(1200, 700), port = TH.layoutFor(390, 844);
  assert(TH.toneAxisPos(900, 10, land) > TH.toneAxisPos(900, 690, land), 'landscape: up is brighter');
  assert(TH.toneAxisPos(380, 400, port) > TH.toneAxisPos(200, 400, port), 'portrait: right is brighter');
});
test('Hands keep their identity when MediaPipe flips Left/Right labels', () => {
  const g = new HandGestures();
  const video = { videoWidth: 1280, videoHeight: 720 };
  const handAt = (x, label) => {
    const L = fakeHand(0.5)[0].landmarks.map((p) => ({ ...p, x: p.x + x - 0.5 }));
    return { landmarks: L, handedness: label, score: 1 };
  };
  const a = g.update([handAt(0.3, 'Left'), handAt(0.7, 'Right')], video, 1280, 720, 0);
  const ids = Object.fromEntries(a.map((p) => [Math.round(p.palmX), p.id]));
  // Next frame the labels are swapped, positions barely changed.
  const b = g.update([handAt(0.301, 'Right'), handAt(0.701, 'Left')], video, 1280, 720, 33);
  for (const p of b) {
    const before = Object.entries(ids).find(([x]) => Math.abs(+x - p.palmX) < 10);
    assert(before && before[1] === p.id, `hand at ${Math.round(p.palmX)} changed id`);
  }
  assert(b.length === 2, `ghost hands: ${b.length}`);
});

// ---- lessons ----
const song = (id) => buildSong(SONGS.find((s) => s.id === id));
const playAt = (midi) => ({ pitchPresent: true, sounding: true, midi });
const noHand = { pitchPresent: false, sounding: false, midi: null };
/** Run a timed lesson with a player who plays pickNote(lesson) each frame. */
function runTimed(lesson, pick, dt = 1 / 60) {
  let guard = 0;
  while (!lesson.done && guard++ < 100000) lesson.step(pick(lesson), dt);
  return lesson.result();
}
/** The note that is due at a given beat (first note during the count-in). */
function noteAtBeat(s, beat) {
  let n = s.notes[0];
  for (const x of s.notes) if (x.start <= beat) n = x;
  return n;
}
test('Lessons: note names and song parsing', () => {
  assert(noteToMidi('C4') === 60 && noteToMidi('A4') === 69 && noteToMidi('F#3') === 54, 'note names');
  const s = song('buns');
  assert(s.notes.length === 17, `Hot Cross Buns has ${s.notes.length} notes`);
  assert(s.totalBeats === 16, `Hot Cross Buns is ${s.totalBeats} beats`);
  assert(s.notes[2].beats === 2 && s.notes[3].start === 4, 'long note timing');
  assert(s.notes[6].beats === 0.5, 'short notes');
});
test('Lessons: every song fits C major and its own range', () => {
  for (const def of SONGS) {
    const s = buildSong(def), r = lessonRange(s);
    const scale = TH.scaleNotes('major', r.low, r.high);
    for (const n of s.notes) assert(scale.includes(n.midi), `${def.id}: ${n.name} is not in the scale`);
    assert(r.high - r.low >= 12, `${def.id}: range too narrow`);
    assert(s.min - r.low >= 3 && r.high - s.max >= 3, `${def.id}: notes too close to the edge`);
    assert(s.notes.every((n) => s.phrases[n.phrase]), `${def.id}: note without a phrase`);
  }
});
test('Lessons: the theremin plays in the song\'s range and snaps to its notes', () => {
  const s = song('sheep'), range = lessonRange(s);
  const L = TH.layoutFor(1200, 700), S = new TH.ThereminState();
  const set = thSettings({ assist: 'snap', scale: 'major', customRange: range });
  let t = 0;
  for (const n of [60, 67, 69, 62]) {
    const x = TH.axisToScreen(TH.midiToAxis(n + 0.2, range.low, range.high), L);
    let out;
    for (let i = 0; i < 40; i++) out = S.step([hp('p', x, 300)], L, set, (t += 33));
    assert(out.midi === n, `hand near ${n} plays ${out.midi}`);
    assert(out.range.low === range.low && out.range.high === range.high, 'range passed through');
  }
});
test('Lessons (learn): the song only moves while you are on the note', () => {
  const l = new Lesson(song('buns'), { mode: 'learn', bpm: 60 });
  for (let i = 0; i < 200; i++) l.step(playAt(60), 1 / 60); // wrong note (C, target is E)
  assert(l.pos === 0 && l.index === 0, 'moved while on the wrong note');
  assert(l.view().direction === 1, 'should point up toward E');
  for (let i = 0; i < 200; i++) l.step(noHand, 1 / 60);
  assert(l.pos === 0 && l.view().direction === 0, 'moved with no hand up');
  for (let i = 0; i < 30; i++) l.step(playAt(64), 1 / 60); // half a beat on E
  assert(l.index === 0 && near(l.pos, 0.5, 1e-6), `halfway through the note: pos ${l.pos}`);
  for (let i = 0; i < 31; i++) l.step(playAt(64), 1 / 60);
  assert(l.index === 1 && l.pos === 1, `should be waiting at note 2: index ${l.index} pos ${l.pos}`);
  assert(l.view().direction === -1, 'now points down toward D');
  for (let i = 0; i < 200; i++) l.step(playAt(64), 1 / 60); // still on E: must wait
  assert(l.index === 1 && l.pos === 1, 'did not wait for the next note');
});
test('Lessons (learn): finding every note in turn finishes the song', () => {
  for (const def of SONGS) {
    const l = new Lesson(buildSong(def), { mode: 'learn', bpm: 80 });
    const res = runTimed(l, (x) => playAt(x.target.midi + 0.3));
    assert(l.done && res.hits === res.total && res.stars === 3, `${def.id}: ${res.hits}/${res.total}`);
  }
});
test('Lessons (play): the count-in waits for a hand', () => {
  const l = new Lesson(song('buns'), { mode: 'play', bpm: 60 });
  for (let i = 0; i < 300; i++) l.step(noHand, 1 / 60);
  assert(l.pos === -COUNT_IN_BEATS && !l.view().started, 'started without a hand');
  l.step(playAt(64), 0.5);
  assert(l.view().started && l.view().countIn === 4, `count-in shows ${l.view().countIn}`);
  for (let i = 0; i < 300; i++) l.step(noHand, 1 / 60); // keeps going once started
  assert(l.pos > 0, 'stopped when the hand left');
});
test('Lessons (play): a player on the ribbon gets three stars', () => {
  for (const tempo of Object.keys(TEMPOS)) {
    for (const def of SONGS) {
      const s = buildSong(def);
      const res = runTimed(new Lesson(s, { mode: 'play', bpm: TEMPOS[tempo].bpm }), (l) => playAt(noteAtBeat(s, l.pos).midi));
      assert(res.hits === res.total && res.stars === 3, `${def.id} ${tempo}: ${res.hits}/${res.total}`);
    }
  }
});
test('Lessons (play): arriving a little late still counts', () => {
  // Camera lag plus travel time: the player is always 150 ms behind the song.
  const s = song('sheep'), bpm = 80, lagBeats = 0.15 * (bpm / 60);
  const res = runTimed(new Lesson(s, { mode: 'play', bpm }), (l) => playAt(noteAtBeat(s, l.pos - lagBeats).midi));
  assert(res.stars === 3, `150 ms late scored ${res.hits}/${res.total}`);
});
test('Lessons (play): wrong notes and silence score nothing', () => {
  const s = song('mary');
  const wrong = runTimed(new Lesson(s, { mode: 'play', bpm: 100 }), (l) => playAt(noteAtBeat(s, l.pos).midi + 2));
  assert(wrong.hits === 0 && wrong.stars === 0, `wrong notes scored ${wrong.hits}`);
  const quiet = new Lesson(s, { mode: 'play', bpm: 100 });
  quiet.step(playAt(64), 0.01);
  const res = runTimed(quiet, (l) => ({ pitchPresent: true, sounding: false, midi: noteAtBeat(s, l.pos).midi }));
  assert(res.hits === 0, `silent playing scored ${res.hits}`);
  assert(starsFor(0.95) === 3 && starsFor(0.75) === 2 && starsFor(0.5) === 1 && starsFor(0.2) === 0, 'star thresholds');
});
test('Lessons (play): holding one note only hits the notes it matches', () => {
  const s = song('buns'); // seven of its notes are C
  const res = runTimed(new Lesson(s, { mode: 'play', bpm: 60 }), () => playAt(60));
  assert(res.hits === 7, `holding C hit ${res.hits} notes, expected 7`);
});
test('Lessons: volume dips briefly between notes so repeats sound separate', () => {
  const s = song('sheep'); // starts C C
  const l = new Lesson(s, { mode: 'learn', bpm: 60 });
  let v, dipped = 0;
  for (let i = 0; i < 70; i++) { v = l.step(playAt(60), 1 / 60); if (v.index === 1 && v.gate === 0) dipped++; }
  assert(v.index === 1, 'should be on the second C');
  assert(dipped >= 3 && dipped <= Math.ceil(GATE_SEC * 60) + 1, `dip lasted ${dipped} frames`);
  assert(v.gate === 1, 'volume should be back');
});
test('Lessons: the ribbon shows a few beats ahead in both orientations', () => {
  for (const [W, H] of [[1180, 720], [844, 390], [390, 844]]) {
    const L = TH.layoutFor(W, H, { top: 70, bottom: 56 }), g = ribbonGeometry(L);
    assert(g.ppb >= 40, `${W}x${H}: only ${g.ppb.toFixed(0)} px per beat`);
    assert(g.look >= 2.5 && g.look <= 4, `${W}x${H}: looks ${g.look.toFixed(1)} beats ahead`);
    const p = L.pitch;
    if (L.landscape) assert(g.nowC > p.y && g.nowC < p.y + p.h, 'now-line inside the zone');
    else assert(g.nowC >= p.x && g.nowC < p.x + p.w, 'now-line inside the zone');
  }
});

// ---- string lessons ----
test('String lessons: a string of the right length plays its note', () => {
  for (const m of HARP_NOTES) {
    const f = pitchForLength(lengthForMidi(m), 'off').freq;
    assert(near(f, midiToFreq(m), 1e-6), `note ${m}: ${f}`);
    assert(whiteNoteForLength(lengthForMidi(m)) === m, `label for ${m}`);
  }
  assert(near(lengthForMidi(72), lengthForMidi(60) / 2), 'half the length is an octave up');
  for (let L = 0.1; L < 0.3; L += 0.003) {
    assert(![1, 3, 6, 8, 10].includes(whiteNoteForLength(L) % 12), `length ${L} labelled as a sharp`);
  }
});
test('String lessons: every song fits on the six harp strings', () => {
  for (const def of SONGS) for (const n of buildSong(def).notes) assert(HARP_NOTES.includes(n.midi), `${def.id} needs ${n.name}`);
});
test('String lessons: the harp fits the screen, longest string lowest', () => {
  for (const [W, H] of [[1180, 720], [844, 390], [390, 844], [800, 820]]) {
    const top = 130, bottom = 124, slots = harpSlots(W, H, { top, bottom });
    assert(slots.length === 6, 'six slots');
    const tol = Math.max(30, 0.04 * Math.hypot(W, H));
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      for (const [x, y] of [[s.ax, s.ay], [s.bx, s.by]]) {
        assert(x >= 20 && x <= W - 20 && y >= top - 1 && y <= H - bottom + 1, `${W}x${H}: ${s.name} off screen (${x.toFixed(0)}, ${y.toFixed(0)})`);
      }
      if (i) {
        const p = slots[i - 1];
        assert(s.len < p.len, `${W}x${H}: ${s.name} should be shorter than ${p.name}`);
        // Lengths keep the true pitch ratio even when the harp is shrunk to fit.
        assert(near(p.len / s.len, midiToFreq(s.midi) / midiToFreq(p.midi), 1e-6), 'length ratio = pitch ratio');
        assert(Math.hypot(s.ax - p.ax, s.ay - p.ay) > 2 * tol, `${W}x${H}: ${s.name} too close to ${p.name}`);
      }
    }
  }
  const wide = harpSlots(1180, 720), tall = harpSlots(390, 844);
  assert(wide[0].ax < wide[5].ax && wide[0].ay === wide[0].ay && wide[0].bx === wide[0].ax, 'wide: upright strings, low notes on the left');
  assert(tall[0].ay > tall[5].ay && tall[0].by === tall[0].ay, 'tall: flat strings, low notes at the bottom');
});
test('String lessons: a traced line fills its slot, a sloppy one does not', () => {
  const slots = harpSlots(1180, 720), tol = 40, c = slots[0], d = slots[1];
  const line = (s, da = 0, db = 0) => ({ ax: s.ax + da, ay: s.ay + da, bx: s.bx + db, by: s.by - db });
  assert(matchSlot(line(c), slots, tol) === c, 'exact trace');
  assert(matchSlot(line(c, 15, -20), slots, tol) === c, 'a little off is fine');
  assert(matchSlot({ ax: c.bx, ay: c.by, bx: c.ax, by: c.ay }, slots, tol) === c, 'drawn backwards');
  assert(matchSlot(line(d, 10, 10), slots, tol) === d, 'another slot');
  const half = { ax: c.ax, ay: c.ay, bx: c.ax, by: c.ay + c.len / 2 };
  assert(matchSlot(half, slots, tol) === null, 'half length must not match');
  assert(matchSlot(line(c), slots.slice(1), tol) === null, 'slot already filled');
  assert(drawFeedback(half, c, tol) === 'short', 'too short');
  assert(drawFeedback({ ax: c.ax, ay: c.ay, bx: c.ax, by: c.ay + c.len * 1.5 }, c, tol) === 'long', 'too long');
  assert(drawFeedback({ ax: c.ax + 300, ay: c.ay + 200, bx: c.ax + 300, by: c.ay + 400 }, c, tol) === 'away', 'somewhere else');
  assert(drawFeedback({ ax: c.ax, ay: c.ay, bx: c.ax + c.len * 0.7, by: c.ay + c.len * 0.7 }, c, tol) === 'crooked', 'right length, wrong direction');
});
test('String lessons: tuned strings keep their note', () => {
  const bank = new StringBank();
  const s = bank.addTuned(100, 100, 100, 300, 1180, 720, 67);
  assert(near(s.freq, midiToFreq(67)) && s.note === 'G4', `tuned string is ${s.note}`);
  bank.setScale('pentatonic'); bank.setScale('off');
  assert(near(s.freq, midiToFreq(67)), 'changed by Snap');
  bank.resize(1180, 720, 390, 844);
  assert(near(s.freq, midiToFreq(67)), 'changed by resize');
});
test('String lessons (play): right strings move the song on, wrong ones are counted', () => {
  const s = song('buns'), run = new StringSongRun(s);
  assert(run.target.midi === 64 && run.next.midi === 62, 'starts on E, then D');
  assert(run.pluck(60, 0) === 'wrong' && run.index === 0, 'wrong string should not advance');
  assert(run.pluck(64, 1000) === 'right' && run.index === 1, 'right string advances');
  assert(run.pluck(65, 1050) === 'ignored' && run.wrong === 1, 'brushing a neighbour just after is forgiven');
  assert(run.pluck(65, 2000) === 'wrong' && run.wrong === 2, 'a later wrong string counts');
  let t = 3000;
  while (!run.done) run.pluck(run.target.midi, (t += 400));
  const res = run.result();
  assert(res.total === 17 && res.wrong === 2, `${res.total} notes, ${res.wrong} slips`);
  assert(res.stars === 2, `17 right, 2 slips = ${res.stars} stars`);
  assert(run.pluck(60, t + 500) === 'ignored', 'nothing counts after the end');
});
test('String lessons (play): one strum across E, D, C plays three notes', () => {
  const run = new StringSongRun(song('buns'));
  assert(['right', 'right', 'right'].join() === [run.pluck(64, 0), run.pluck(62, 20), run.pluck(60, 40)].join(), 'strum in order');
  assert(run.index === 3 && run.wrong === 0, 'three notes, no slips');
  const clean = new StringSongRun(song('mary'));
  let t = 0;
  while (!clean.done) clean.pluck(clean.target.midi, (t += 300));
  assert(clean.result().stars === 3, 'a clean run earns three stars');
});
test('Songs: ten or more, unique, each says what it teaches, and every note fits the six-string harp', () => {
  assert(SONGS.length >= 10, `${SONGS.length} songs`);
  assert(new Set(SONGS.map((d) => d.id)).size === SONGS.length, 'duplicate song id');
  for (const def of SONGS) {
    const s = buildSong(def);
    assert(def.teaches && def.short && def.title, `${def.id}: missing text`);
    assert(s.notes.length >= 15 && s.totalBeats >= 12, `${def.id}: only ${s.notes.length} notes`);
    assert(s.notes.every((n) => n.beats > 0 && [60, 62, 64, 65, 67, 69].includes(n.midi)), `${def.id}: a note off the harp`);
  }
  assert(SONGS[0].id === 'buns', 'the easiest song comes first');
});
test('Lesson strings: every note name has its own colour, the same in every octave', () => {
  const hues = [60, 62, 64, 65, 67, 69].map(noteHue);
  assert(new Set(hues).size === 6, `hues ${hues}`);
  for (let i = 1; i < hues.length; i++) assert(Math.abs(hues[i] - hues[i - 1]) >= 12, 'neighbouring notes look different');
  assert(noteHue(48) === noteHue(60) && noteHue(72) === noteHue(60), 'C is C in any octave');
  const bank = new StringBank();
  assert(bank.addTuned(0, 0, 0, 300, 1180, 720, 67).hue === noteHue(67), 'a tuned string takes its note colour');
  assert(bank.add(0, 0, 0, 300, 1180, 720).hue !== undefined, 'free strings still get a colour');
});
test('Effects: sparks and confetti fade out, and never pile up past the cap', () => {
  const fx = new FX();
  fx.burst(100, 100, 0, 1);
  assert(fx.count > 10, `burst made ${fx.count}`);
  for (let i = 0; i < 20; i++) fx.update(0.1);
  assert(fx.count === 0, `${fx.count} left after 2 s`);
  for (let i = 0; i < 10; i++) fx.confetti(800, 600);
  assert(fx.count <= MAX_PARTICLES, `${fx.count} particles`);
  for (let i = 0; i < 50; i++) fx.update(0.1);
  assert(fx.count === 0, 'confetti cleared after 5 s');
});
test('Song picker suggests the first song without a star, else stays put', () => {
  const sc = (...st) => st.map((n) => [{ label: 'a', stars: n }, { label: 'b', stars: 0 }]);
  assert(suggestedSong(sc(0, 0, 0), 2) === 0, 'nothing played: song 1');
  assert(suggestedSong(sc(3, 1, 0, 0), 0) === 2, 'first starless song');
  assert(suggestedSong(sc(3, 2, 1), 1) === 1, 'all starred: the current song');
});
test('Streaks: the theremin counts notes hit in a row, and milestones fire once', () => {
  const s = song('mary'), run = new Lesson(s, { mode: 'play', bpm: 80 });
  const dt = 1 / 60;
  let t = -COUNT_IN_BEATS, maxSeen = 0;
  for (let k = 0; k < 4000 && !run.done; k++) {
    t = run.pos;
    const i = Math.max(0, s.notes.findIndex((n) => t >= n.start && t < n.start + n.beats));
    const miss = i === 10; // drop one note in the middle
    const v = run.step({ pitchPresent: true, sounding: true, midi: miss ? s.notes[i].midi + 3 : s.notes[i].midi }, dt);
    maxSeen = Math.max(maxSeen, v.combo);
  }
  const r = run.result();
  assert(run.done && r.hits === s.notes.length - 1, `${r.hits}/${s.notes.length}`);
  assert(r.maxCombo === s.notes.length - 11 && maxSeen === r.maxCombo, `best streak ${r.maxCombo}, saw ${maxSeen}`);
  assert(streakMilestone(9, 10) === 10 && streakMilestone(10, 11) === 0 && streakMilestone(3, 4) === 0, 'milestone at 10 only once');
  assert(streakMilestone(24, 26) === 25 && streakMilestone(0, 60) === 50, 'jumps past a milestone still count');
});
test('Listen first: the demo walks through every note in order, on the beat, and then ends', () => {
  for (const id of SONGS.map((d) => d.id)) {
    const s = song(id);
    assert(noteAt(s, -0.5) === -1 && noteAt(s, 0) === 0 && noteAt(s, s.totalBeats) === -1, `${id}: edges`);
    const seen = [];
    let gated = 0;
    for (let pos = -1; pos < s.totalBeats + 1; pos += 0.02) {
      const f = demoFrame(s, pos, 80);
      if (f.midi != null && seen[seen.length - 1] !== f.view.index) seen.push(f.view.index);
      if (f.midi != null) assert(f.midi === s.notes[f.view.index].midi, `${id}: plays the shown note`);
      if (f.view.gate === 0) gated++;
      if (pos < 0) assert(f.view.countIn === 1 && f.midi == null, 'one-beat lead-in, silent');
      if (f.done) { assert(pos >= s.totalBeats, 'ends after the last note'); break; }
    }
    assert(seen.length === s.notes.length && seen.every((v, k) => v === k), `${id}: ${seen.length}/${s.notes.length} notes in order`);
    assert(gated > 0, `${id}: a short dip between notes so repeats are heard`);
  }
});
test('String lessons (in time): nothing moves until the run starts, then a 4-beat count-in', () => {
  const run = new StringTimedRun(song('buns'), { bpm: 60 });
  assert(!run.started && run.pluck(64, 0) === 'ignored', 'plucks before the start are ignored');
  run.start(1000);
  assert(near(run.pos(1000), -4) && near(run.pos(5000), 0), `pos ${run.pos(1000)} → ${run.pos(5000)}`);
  assert(run.timeOf(0) === 5000 && run.timeOf(1) === 6000, 'notes land on the beat after the count-in');
});
test('String lessons (in time): plucks on the beat are perfect at every speed', () => {
  for (const { bpm } of Object.values(STRING_TEMPOS)) {
    for (const id of SONGS.map((d) => d.id)) {
      const s = song(id), run = new StringTimedRun(s, { bpm });
      run.start(0);
      s.notes.forEach((n, i) => run.pluck(n.midi, run.timeOf(i) + 40));
      const r = run.result();
      assert(run.done && r.perfect === s.notes.length && r.stars === 3, `${id} @${bpm}: ${r.perfect}/${s.notes.length}`);
      assert(r.maxCombo === s.notes.length, `${id} combo ${r.maxCombo}`);
    }
  }
});
test('String lessons (in time): late is good, too late is a miss, and repeats match the nearest note', () => {
  const s = song('buns'), run = new StringTimedRun(s, { bpm: 60 });
  run.start(0);
  assert(run.pluck(64, run.timeOf(0) + (PERFECT_SEC + 0.08) * 1000) === 'good', 'a bit late is good');
  run.update(run.timeOf(1) + (WINDOW_SEC + 0.05) * 1000);
  assert(run.grade[1] === 'miss' && run.combo === 0, 'D never played is a miss and breaks the combo');
  // "one a penny": eight half-beat C/D notes. A pluck near note 7 (the 2nd C) must not take note 6.
  const c2 = 7;
  assert(s.notes[6].midi === 60 && s.notes[c2].midi === 60, 'notes 6 and 7 are both C');
  run.pluck(60, run.timeOf(6));
  assert(run.pluck(60, run.timeOf(c2) - 30) === 'perfect' && run.grade[c2] === 'perfect', 'second C matched');
});
test('String lessons (in time): strumming everything nonstop does not earn stars', () => {
  const s = song('twinkle'), run = new StringTimedRun(s, { bpm: 50 });
  run.start(0);
  const end = run.timeOf(s.notes.length - 1) + 1000;
  for (let t = 0; t < end; t += 250) for (const m of [60, 62, 64, 65, 67, 69]) run.pluck(m, t + m - 60);
  run.update(end + 2000);
  const r = run.result();
  assert(run.done && r.stars <= 1, `spam strum got ${r.stars} stars (${r.hits} hits, ${r.wrong} wrong)`);
});
test('String lessons (in time): a wrong string mid-song breaks the combo; a neighbour brushed right after does not', () => {
  const s = song('mary'), run = new StringTimedRun(s, { bpm: 60 });
  run.start(0);
  run.pluck(64, run.timeOf(0));
  assert(run.pluck(65, run.timeOf(0) + 60) === 'ignored' && run.combo === 1, 'brushed neighbour forgiven');
  run.pluck(62, run.timeOf(1));
  assert(run.pluck(69, run.timeOf(1) + 500) === 'wrong' && run.combo === 0 && run.wrong === 1, 'stray A breaks the combo');
});
test('String lessons (in time): the now-line crosses every string and leaves room to see notes coming', () => {
  for (const [W, H, top, bottom] of [[1440, 900, 112, 124], [1280, 760, 108, 124], [844, 390, 115, 124], [390, 844, 141, 176]]) {
    const slots = harpSlots(W, H, { top, bottom });
    const g = timedGeometry(slots, W, H, { farTop: top - 48 });
    const along = g.wide ? g.now - slots[0].ay : g.now - slots[0].ax;
    assert(slots.every((s) => along > 20 && along < s.len - 10), `${W}x${H}: line ${along.toFixed(0)}px along`);
    assert(g.look >= 2 && g.ppb >= 30, `${W}x${H}: ${g.look.toFixed(1)} beats ahead at ${g.ppb.toFixed(0)} px/beat`);
  }
});
test('String lessons: with drawing off, a pinch in empty space draws nothing but strings still play', () => {
  const bank = new StringBank(), plucks = [];
  const ix = new Interaction({ bank, synth: { pluck: (o) => plucks.push(o) }, onEvent: () => {} });
  const s = bank.addTuned(600, 200, 600, 480, 1180, 720, 60);
  ix.allowDraw = false;
  let t = 0;
  const ptr = (x, y, pinching, extra = {}) => ({ id: 'ptr:1', source: 'mouse', x, y, tipX: x, tipY: y, pinching, pinchStarted: false, pinchEnded: false, lost: false, ...extra });
  ix.update([ptr(200, 300, true, { pinchStarted: true })], 1180, 720, (t += 16));
  for (let i = 1; i <= 20; i++) ix.update([ptr(200 + i * 8, 300, true)], 1180, 720, (t += 16)); // slow drag in empty space
  ix.update([ptr(360, 300, false, { pinchEnded: true })], 1180, 720, (t += 16));
  assert(bank.strings.length === 1, 'drew a string while drawing was off');
  // Drag the string sideways and let go: it plucks.
  ix.update([ptr(600, 340, true, { pinchStarted: true })], 1180, 720, (t += 16));
  for (let i = 1; i <= 6; i++) ix.update([ptr(600 + i * 5, 340, true)], 1180, 720, (t += 16));
  ix.update([ptr(630, 340, false, { pinchEnded: true })], 1180, 720, (t += 16));
  assert(plucks.length === 1 && near(plucks[0].freq, midiToFreq(60)), `plucks: ${plucks.length}`);
});
test('String lessons: a finished draw is handed to the lesson, not added freely', () => {
  const bank = new StringBank(), got = [];
  const ix = new Interaction({ bank, synth: { pluck() {} }, onEvent: () => {} });
  ix.customAdd = (line, source) => got.push({ line, source });
  let labelled = 0;
  ix.previewHook = (pv) => { pv.note = 'C ✓'; labelled++; };
  let t = 0;
  const ptr = (x, y, pinching, extra = {}) => ({ id: 'ptr:1', source: 'mouse', x, y, tipX: x, tipY: y, pinching, pinchStarted: false, pinchEnded: false, lost: false, ...extra });
  ix.update([ptr(200, 200, true, { pinchStarted: true })], 1180, 720, (t += 16));
  for (let i = 1; i <= 25; i++) ix.update([ptr(200, 200 + i * 8, true)], 1180, 720, (t += 16));
  assert(ix.previews.length === 1 && ix.previews[0].note === 'C ✓' && labelled > 5, 'preview relabelled by the lesson');
  ix.update([ptr(200, 400, false, { pinchEnded: true })], 1180, 720, (t += 16));
  assert(bank.strings.length === 0, 'string was added without asking the lesson');
  assert(got.length === 1 && got[0].line.ay === 200 && got[0].line.by === 400 && got[0].source === 'mouse', 'lesson got the line');
});

// ---- tracker results ----
test('Tracker: Gesture Recognizer results carry the hand shape', () => {
  const pts = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const hands = parseHands({
    landmarks: [pts, pts],
    handedness: [[{ categoryName: 'Left', score: 0.9 }], [{ categoryName: 'Right', score: 0.8 }]],
    gestures: [[{ categoryName: 'Closed_Fist', score: 0.77 }], [{ categoryName: 'None', score: 0.6 }]],
  });
  assert(hands.length === 2 && hands[0].landmarks === pts, 'two hands with landmarks');
  assert(hands[0].handedness === 'Left' && hands[1].handedness === 'Right', 'handedness');
  assert(hands[0].gesture.name === 'Closed_Fist' && near(hands[0].gesture.score, 0.77), 'fist kept');
  assert(hands[1].gesture === null, '"None" means no gesture');
});
test('Tracker: plain Hand Landmarker results still work (no gestures)', () => {
  const pts = Array.from({ length: 21 }, () => ({ x: 0.1, y: 0.2, z: 0 }));
  const hands = parseHands({ landmarks: [pts], handednesses: [[{ categoryName: 'Right', score: 0.95 }]] });
  assert(hands.length === 1 && hands[0].handedness === 'Right' && hands[0].gesture === null, JSON.stringify(hands[0].gesture));
  assert(parseHands({ landmarks: [] }).length === 0 && parseHands(null).length === 0, 'empty results');
});

// ---- hand signs ----
const signPtr = (gesture, extra = {}) => ({ id: 'hand:h1', source: 'hand', x: 300, y: 300, palmX: 300, palmY: 320, handSize: 100, pinching: false, lost: false, gesture, gestureScore: 0.9, fist: gesture === 'Closed_Fist', ...extra });
test('Hand signs: a fist fires once, only after it is held', () => {
  const w = new SignWatcher();
  let t = 1000, fired = [], held;
  const run = (ms, p = signPtr('Closed_Fist')) => { for (let e = 0; e < ms; e += 33) { const r = w.update([p], (t += 33)); fired.push(...r.fired); held = r.held; } };
  run(SIGNS.Closed_Fist.hold - 80);
  assert(fired.length === 0, 'fired too early');
  run(150);
  assert(fired.length === 1 && fired[0].name === 'Closed_Fist', `fired ${fired.length}`);
  assert(held.has('Closed_Fist'), 'still held');
  run(2000);
  assert(fired.length === 1, 'holding longer must not fire again');
  run(GAP_MS + 100, signPtr(null));
  assert(!held.has('Closed_Fist'), 'released');
});
test('Hand signs: a brief flicker keeps the hold; a real change restarts it', () => {
  const w = new SignWatcher();
  let t = 0, fired = [];
  const f = (p) => fired.push(...w.update([p], (t += 33)).fired);
  for (let i = 0; i < 12; i++) f(signPtr('Thumb_Up'));      // ~400 ms
  for (let i = 0; i < 3; i++) f(signPtr(null));             // ~100 ms dropout, under GAP_MS
  for (let i = 0; i < 14; i++) f(signPtr('Thumb_Up'));      // ~460 ms more: total > 800
  assert(fired.length === 1 && fired[0].name === 'Thumb_Up', 'flicker should not restart the hold');
  const w2 = new SignWatcher(); fired = []; t = 0;
  const g = (p) => fired.push(...w2.update([p], (t += 33)).fired);
  for (let i = 0; i < 20; i++) g(signPtr('Thumb_Up'));     // 660 ms
  for (let i = 0; i < 20; i++) g(signPtr('Thumb_Down'));   // switch: restarts
  assert(fired.length === 0, 'switching sign must restart the hold');
});
test('Hand signs: pinching, unsure, unwanted or mouse pointers never sign', () => {
  const w = new SignWatcher();
  let t = 0, fired = [];
  const f = (p, can) => fired.push(...w.update([p], (t += 33), can).fired);
  for (let i = 0; i < 60; i++) f(signPtr('Closed_Fist', { pinching: true }));
  for (let i = 0; i < 60; i++) f(signPtr('Victory', { gestureScore: MIN_SCORE - 0.1 }));
  for (let i = 0; i < 60; i++) f(signPtr('Thumb_Up'), () => false);
  for (let i = 0; i < 60; i++) f(signPtr('Closed_Fist', { fist: false }));
  for (let i = 0; i < 60; i++) f(signPtr('Victory', { source: 'mouse' }));
  for (let i = 0; i < 60; i++) f(signPtr('Pointing_Up'));
  for (let i = 0; i < 60; i++) f(signPtr('Open_Palm'));
  assert(fired.length === 0, JSON.stringify(fired));
});
test('Hand signs: rings wait a moment, fill up, then pop', () => {
  const w = new SignWatcher();
  let r = w.update([signPtr('Victory')], 0);
  assert(r.rings.length === 0, 'no ring on the first frame');
  r = w.update([signPtr('Victory')], SHOW_AFTER_MS + 10);
  assert(r.rings.length === 1 && r.rings[0].emoji === SIGNS.Victory.emoji && r.rings[0].progress > 0 && r.rings[0].progress < 0.3, JSON.stringify(r.rings));
  assert(r.rings[0].y < 320, 'ring sits above the hand');
  r = w.update([signPtr('Victory')], SIGNS.Victory.hold + 5);
  assert(r.fired.length === 1 && r.rings[0].progress === 1, 'fires when full');
  r = w.update([signPtr('Victory')], SIGNS.Victory.hold + 300);
  assert(r.rings.length === 1 && r.rings[0].pop > 0.4, 'pops');
  r = w.update([signPtr('Victory')], SIGNS.Victory.hold + 2000);
  assert(r.rings.length === 0, 'then goes away');
});
test('Hand signs: one action at a time (a short cooldown)', () => {
  const w = new SignWatcher();
  const a = signPtr('ILoveYou'), b = signPtr('ILoveYou', { id: 'hand:h2', x: 700, palmX: 700 });
  let t = 0, fired = [];
  for (let i = 0; i < 40; i++) fired.push(...w.update([a, b], (t += 33)).fired);
  assert(fired.length === 1, `both hands fired: ${fired.length}`);
  assert(COOLDOWN_MS < 1500, 'cooldown stays short');
});
test('A fist never starts a pinch, but a pinch with curled fingers still does', () => {
  const video = { videoWidth: 1280, videoHeight: 720 };
  const hand = (curled, gesture) => {
    const L = fakeHand(0.01)[0].landmarks.map((p) => ({ ...p }));
    if (curled) { L[8] = { x: 0.465, y: 0.47, z: 0 }; L[4] = { x: 0.47, y: 0.475, z: 0 }; }
    return [{ landmarks: L, handedness: 'Right', score: 0.99, gesture }];
  };
  const fist = { name: 'Closed_Fist', score: 0.9 };
  let g = new HandGestures(), t = 0, p;
  for (let i = 0; i < 5; i++) p = g.update(hand(true, fist), video, 1280, 720, (t += 33))[0];
  assert(!p.pinching && p.fist && p.gesture === 'Closed_Fist', `fist pinched: ${JSON.stringify({ pinching: p.pinching, fist: p.fist })}`);
  g = new HandGestures(); t = 0;
  for (let i = 0; i < 5; i++) p = g.update(hand(true, null), video, 1280, 720, (t += 33))[0];
  assert(p.pinching && !p.fist, 'the same hand with no fist label is a pinch');
  g = new HandGestures(); t = 0;
  for (let i = 0; i < 5; i++) p = g.update(hand(false, fist), video, 1280, 720, (t += 33))[0];
  assert(p.pinching && !p.fist, 'labelled fist but index finger long: still a pinch');
  // Already pinching (drawing), then the label says fist: the pinch carries on.
  g = new HandGestures(); t = 0;
  for (let i = 0; i < 5; i++) p = g.update(hand(true, null), video, 1280, 720, (t += 33))[0];
  for (let i = 0; i < 5; i++) p = g.update(hand(true, fist), video, 1280, 720, (t += 33))[0];
  assert(p.pinching, 'a fist label mid-draw must not drop the string');
});

// ---- more hand signs ----
/** A plausible hand: each finger 'up' or 'down', thumb 'out' or 'in'. */
function shapedHand({ thumb = 'in', index = 'down', middle = 'down', ring = 'down', pinky = 'down' } = {}) {
  const L = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  L[0] = { x: 0.5, y: 0.8, z: 0 };
  const cols = { index: [5, 0.44], middle: [9, 0.48], ring: [13, 0.52], pinky: [17, 0.56] };
  const st = { index, middle, ring, pinky };
  for (const [name, [mcp, x]] of Object.entries(cols)) {
    L[mcp] = { x, y: 0.6, z: 0 };
    const up = st[name] === 'up';
    L[mcp + 1] = { x, y: up ? 0.5 : 0.52, z: 0 };        // PIP
    L[mcp + 2] = { x, y: up ? 0.44 : 0.58, z: 0 };       // DIP
    L[mcp + 3] = { x, y: up ? 0.38 : 0.62, z: 0 };       // tip
  }
  L[9] = { x: 0.5, y: 0.6, z: 0 };
  L[1] = { x: 0.44, y: 0.72, z: 0 }; L[2] = { x: 0.4, y: 0.68, z: 0 };
  L[3] = thumb === 'out' ? { x: 0.36, y: 0.64, z: 0 } : { x: 0.45, y: 0.64, z: 0 };
  L[4] = thumb === 'out' ? { x: 0.3, y: 0.6, z: 0 } : { x: 0.49, y: 0.62, z: 0 };
  return L;
}
test('Finger signs: shapes read from finger positions', () => {
  const sh = (o, model = null) => shapeOf(fingerStates(shapedHand(o)), model);
  assert(sh({ index: 'up', pinky: 'up', thumb: 'in' }) === 'Rock_Horns', 'rock horns');
  assert(sh({ index: 'up', pinky: 'up', thumb: 'out' }) === 'ILoveYou', 'I love you (thumb out)');
  assert(sh({ pinky: 'up', thumb: 'out' }) === 'Call_Me', 'call me');
  assert(sh({ index: 'up', middle: 'up', ring: 'up' }) === 'Three_Fingers', 'three fingers');
  assert(sh({ index: 'up', middle: 'up', ring: 'up', thumb: 'out' }) === 'Three_Fingers', 'three fingers, thumb either way');
  assert(sh({ thumb: 'out' }, 'Thumb_Up') === 'Thumb_Up', 'model label kept for thumbs up');
  assert(sh({ index: 'up', middle: 'up' }, 'Victory') === 'Victory', 'victory kept');
  assert(sh({ index: 'up', middle: 'up', ring: 'up', pinky: 'up', thumb: 'out' }, 'Open_Palm') === 'Open_Palm', 'open palm is no sign');
  assert(isOpenPalm(fingerStates(shapedHand({ index: 'up', middle: 'up', ring: 'up', pinky: 'up', thumb: 'out' }))), 'open palm from fingers');
  assert(!isOpenPalm(fingerStates(shapedHand({ index: 'up', middle: 'up', ring: 'up' }))), 'three fingers is not open');
  // A half-bent finger is "unsure": no finger sign from it.
  const L = shapedHand({ index: 'up', pinky: 'up' });
  L[20] = { x: 0.56, y: 0.47, z: 0 }; // tip only a little past its middle joint
  const f = fingerStates(L);
  assert(f.pinky === null && shapeOf(f, null) === null, `half-bent pinky: ${f.pinky}`);
});
test('Finger signs reach the pointer through the gesture layer', () => {
  const g = new HandGestures(), video = { videoWidth: 1280, videoHeight: 720 };
  const det = (o, gesture = null) => [{ landmarks: shapedHand(o), handedness: 'Right', score: 1, gesture }];
  let p = g.update(det({ index: 'up', pinky: 'up' }), video, 1280, 720, 0)[0];
  assert(p.gesture === 'Rock_Horns' && p.gestureScore >= MIN_SCORE, JSON.stringify([p.gesture, p.gestureScore]));
  p = g.update(det({ index: 'up', middle: 'up', ring: 'up', pinky: 'up', thumb: 'out' }, { name: 'Open_Palm', score: 0.8 }), video, 1280, 720, 33)[0];
  assert(p.openPalm && p.gesture === 'Open_Palm', 'open palm flagged');
});
const wavePtr = (x, extra = {}) => ({ id: 'hand:w', source: 'hand', x, y: 300, palmX: x, palmY: 320, handSize: 100, pinching: false, lost: false, gesture: 'Open_Palm', gestureScore: 0.8, openPalm: true, ...extra });
const waveRun = (w, amp, { period = 400, ms = 2400, extra = {}, can } = {}) => {
  const fired = []; let ringMax = 0;
  for (let t = 0; t <= ms; t += 33) {
    const r = w.update([wavePtr(500 + amp * Math.sin((t / period) * 2 * Math.PI), extra)], t, can);
    fired.push(...r.fired.map((f) => f.name));
    for (const g of r.rings) if (g.name === 'Wave') ringMax = Math.max(ringMax, g.progress);
  }
  return { fired: fired.filter((n) => n === 'Wave'), ringMax };
};
test('Wave: an open palm waved side to side says goodbye, once', () => {
  const r = waveRun(new SignWatcher(), 60);
  assert(r.fired.length === 1 && r.fired[0] === 'Wave', JSON.stringify(r.fired));
  assert(r.ringMax === 1, 'the ring fills as you wave');
  // Stop, hold still, then wave again: a second goodbye.
  const w = new SignWatcher(); let t = 0, n = 0;
  const go = (ms, amp) => { for (let e = 0; e < ms; e += 33) { t += 33; n += w.update([wavePtr(500 + amp * Math.sin((t / 400) * 2 * Math.PI))], t).fired.filter((f) => f.name === 'Wave').length; } };
  go(2000, 60); go(WAVE_STALL_MS + 400, 0); go(2000, 60);
  assert(n === 2, `waves after a pause: ${n}`);
});
test('Wave: small wobbles, a pinch, a fist or a slow drift are not a wave', () => {
  assert(waveRun(new SignWatcher(), 12).fired.length === 0, 'wobble (vibrato) is too small');
  assert(waveRun(new SignWatcher(), 60, { extra: { pinching: true } }).fired.length === 0, 'pinching');
  assert(waveRun(new SignWatcher(), 60, { extra: { openPalm: false, gesture: 'Closed_Fist' } }).fired.length === 0, 'not an open hand');
  assert(waveRun(new SignWatcher(), 60, { period: WAVE_STALL_MS * 4 }).fired.length === 0, 'too slow to be a wave');
  assert(waveRun(new SignWatcher(), 60, { can: (n) => n !== 'Wave' }).fired.length === 0, 'not wanted right now');
  assert(WAVE_TURNS >= 3, 'needs a real back-and-forth');
});
test('Two hands: both thumbs up is one sign, not two', () => {
  const w = new SignWatcher();
  const a = signPtr('Thumb_Up', { id: 'hand:a', palmX: 300 }), b = signPtr('Thumb_Up', { id: 'hand:b', palmX: 700 });
  let t = 0; const fired = []; let ring = null;
  for (let i = 0; i < 40; i++) { const r = w.update([a, b], (t += 33)); fired.push(...r.fired.map((f) => f.name)); ring = r.rings[0] || ring; }
  assert(fired.length === 1 && fired[0] === 'Both_Thumbs_Up', JSON.stringify(fired));
  assert(ring && ring.x === 500 && ring.emoji === SIGNS.Both_Thumbs_Up.emoji, 'one ring between the hands');
});
test('Two hands: when the pair means nothing right now, each hand can still sign', () => {
  const w = new SignWatcher();
  const a = signPtr('Closed_Fist', { id: 'hand:a', palmX: 300 }), b = signPtr('Closed_Fist', { id: 'hand:b', palmX: 700 });
  let t = 0; const fired = [];
  for (let i = 0; i < 40; i++) fired.push(...w.update([a, b], (t += 33), (n) => n !== 'Both_Fists').fired.map((f) => f.name));
  assert(fired.includes('Closed_Fist') && !fired.includes('Both_Fists'), JSON.stringify(fired));
  const w2 = new SignWatcher(); t = 0; const fired2 = [];
  for (let i = 0; i < 40; i++) fired2.push(...w2.update([a, b], (t += 33)).fired.map((f) => f.name));
  assert(fired2.length === 1 && fired2[0] === 'Both_Fists', JSON.stringify(fired2));
});

// ---- face control ----
const faceRes = (scores, rollDeg = 0) => {
  const a = (rollDeg * Math.PI) / 180;
  const m = [Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return { faceBlendshapes: [{ categories: Object.entries(scores).map(([categoryName, score]) => ({ categoryName, score })) }], facialTransformationMatrixes: [{ data: m }] };
};
test('Face: blendshapes are read into jaw, "oo", brows and head roll', () => {
  assert(parseFace({ faceBlendshapes: [] }).face === false && parseFace(null).face === false, 'no face');
  const f = parseFace(faceRes({ jawOpen: 0.6, mouthPucker: 0.2, mouthFunnel: 0.5, browInnerUp: 0.4, browOuterUpLeft: 0.2, browOuterUpRight: 0.4 }, 12));
  assert(f.face && near(f.jaw, 0.6) && near(f.pucker, 0.5), JSON.stringify(f));
  assert(near(f.brow, (0.4 + 0.3) / 2), `brow ${f.brow}`);
  assert(near(f.roll, 12, 1e-6), `roll ${f.roll}`);
});
const faceSample = (jaw = 0.05, pucker = 0.05, brow = 0.1, roll = 0) => ({ face: true, jaw, pucker, brow, roll });
test('Face: learns your resting face first, then measures from it', () => {
  const fc = new FaceControls();
  let t = 0;
  for (; t < CAL_MS - 100; t += 33) fc.update(faceSample(0.15, 0.1, 0.2), t);
  assert(fc.calibrating && fc.calProgress(t) > 0.8 && fc.calProgress(t) < 1, 'still learning');
  for (; t < CAL_MS + 100; t += 33) fc.update(faceSample(0.15, 0.1, 0.2), t);
  assert(!fc.calibrating, 'calibrated');
  for (let i = 0; i < 30; i++) fc.update(faceSample(0.15, 0.1, 0.2), (t += 33));
  assert(fc.mouth < 0.02 && fc.oo < 0.02 && !fc.brows, 'resting face is neutral even with a slightly open mouth');
  for (let i = 0; i < 30; i++) fc.update(faceSample(0.15 + MOUTH_RANGE, 0.1, 0.2), (t += 33));
  assert(fc.mouth > 0.95, `wide open: ${fc.mouth}`);
  for (let i = 0; i < 30; i++) fc.update(faceSample(0.15 + MOUTH_RANGE / 2, 0.1, 0.2), (t += 33));
  assert(Math.abs(fc.mouth - 0.5) < 0.05, `half open: ${fc.mouth}`);
});
test('Face: eyebrow octave has hysteresis, and a lost face relaxes', () => {
  const fc = new FaceControls();
  let t = 0;
  for (; t <= CAL_MS + 50; t += 33) fc.update(faceSample(0.05, 0.05, 0.1), t);
  const mid = 0.1 + (BROW_ON + BROW_OFF) / 2;
  fc.update(faceSample(0.05, 0.05, mid), (t += 33));
  assert(!fc.brows, 'between thresholds from down: stays off');
  fc.update(faceSample(0.05, 0.05, 0.1 + BROW_ON + 0.05), (t += 33));
  assert(fc.brows, 'raised: octave on');
  fc.update(faceSample(0.05, 0.05, mid), (t += 33));
  assert(fc.brows, 'between thresholds from up: stays on');
  fc.update(faceSample(0.05, 0.05, 0.1), (t += 33));
  assert(!fc.brows, 'lowered: octave off');
  for (let i = 0; i < 20; i++) fc.update(faceSample(0.05 + MOUTH_RANGE, 0.05, 0.1 + BROW_ON + 0.1), (t += 33));
  assert(fc.brows && fc.mouth > 0.9, 'open and raised');
  for (let i = 0; i < 30; i++) fc.update({ face: false }, (t += 33));
  assert(!fc.present && !fc.brows && fc.mouth < 0.05, `relaxed after losing the face: ${fc.mouth}`);
  assert(!fc.calibrating, 'keeps the calibration');
});
test('Face: walking away mid-calibration starts it over', () => {
  const fc = new FaceControls();
  let t = 0;
  for (; t < CAL_MS / 2; t += 33) fc.update(faceSample(), t);
  for (let i = 0; i < 20; i++) fc.update({ face: false }, (t += 33));
  assert(fc.calibrating && fc.calProgress(t) === 0, 'restarted');
  for (let i = 0; i < 10; i++) fc.update(faceSample(), (t += 33));
  assert(fc.calibrating, 'needs a full second again');
});
test('Face: head tilt beyond a few degrees sets the vibrato depth', () => {
  const fc = new FaceControls();
  let t = 0;
  for (; t <= CAL_MS + 50; t += 33) fc.update(faceSample(0.05, 0.05, 0.1, 2), t);
  for (let i = 0; i < 30; i++) fc.update(faceSample(0.05, 0.05, 0.1, 2 + TILT_START - 1), (t += 33));
  assert(fc.tilt < 0.02, 'small tilts do nothing');
  for (let i = 0; i < 30; i++) fc.update(faceSample(0.05, 0.05, 0.1, 2 - TILT_FULL - 5), (t += 33));
  assert(fc.tilt > 0.95, `either side counts: ${fc.tilt}`);
});
test('Face vibrato: none when level, gentle for a small tilt, full when tilted right over', () => {
  assert(vibratoCents(0) === 0, 'level head');
  assert(vibratoCents(0.3) < VIBRATO_MAX_CENTS * 0.15, `small tilt ${vibratoCents(0.3)}`);
  assert(near(vibratoCents(1), VIBRATO_MAX_CENTS) && near(vibratoCents(2), VIBRATO_MAX_CENTS), 'full and clamped');
});
test('Face on Air Strings: plucks ring longer and can jump an octave', () => {
  const synth = new StringSynth();
  const sent = [];
  synth.ctx = { state: 'running' }; synth.mode = 'worklet'; synth.node = { port: { postMessage: (m) => sent.push(m) } };
  synth.pluck({ freq: 220, amp: 0.7 });
  synth.mod = { sustain: 2.5, octave: true };
  synth.pluck({ freq: 220, amp: 0.7 });
  assert(sent[0].sustain === 1 && near(sent[0].freq, 220), JSON.stringify(sent[0]));
  assert(sent[1].sustain === 2.5 && near(sent[1].freq, 440), JSON.stringify(sent[1]));
  const bank = new StringBank();
  const a = bank.add(100, 100, 100, 500, 1000, 800), b = bank.add(300, 100, 300, 500, 1000, 800);
  a.excite(0.5, 20); b.excite(0.5, 20);
  a.update(1); b.update(1, 2.5);
  assert(b.vibAge < a.vibAge && near(b.vibAge * 2.5, a.vibAge), 'the string shows it ringing longer too');
});
test('Face session: switches itself off only after 3 slow seconds', () => {
  const fs = new FaceSession();
  fs.on = true; fs.baseFps = 30;
  assert(!fs.guard(12) && !fs.guard(12), 'two slow seconds: still on');
  assert(!fs.guard(28), 'recovered: counter resets');
  assert(!fs.guard(12) && !fs.guard(12) && fs.guard(12) && !fs.on, 'three in a row: off');
  const slowPhone = new FaceSession();
  slowPhone.on = true; slowPhone.baseFps = 13;
  assert(!slowPhone.guard(12) && !slowPhone.guard(12) && !slowPhone.guard(12) && slowPhone.on, 'a phone that was already slow is not blamed on Face');
});
test('Face wah: closed sits near the note, open is far brighter, "oo" is darker', () => {
  const c = faceFilter(262, 0, 0), o = faceFilter(262, 1, 0), oo = faceFilter(262, 1, 1);
  assert(c.cutoff > 262 && c.cutoff < 262 * 1.3, `closed ${c.cutoff}`);
  assert(o.cutoff > 262 * 8, `open ${o.cutoff}`);
  assert(oo.cutoff < o.cutoff * 0.6 && oo.q > o.q, 'oo darker and more hollow');
  assert(faceFilter(523, 0.5, 0).cutoff > faceFilter(262, 0.5, 0).cutoff * 1.9, 'follows the note');
  assert(faceFilter(5000, 1, 0).cutoff <= 14000 && faceFilter(20, 0, 0).cutoff >= 120, 'clamped');
});

// ---- render ----
const passed = results.filter((r) => r.ok).length;
const allOk = passed === results.length;
const out = document.getElementById('results');
out.innerHTML = results.map((r) =>
  `<li class="${r.ok ? 'pass' : 'fail'}"><span>${r.ok ? 'PASS' : 'FAIL'}</span> ${r.name}${r.msg ? ` — <code>${r.msg}</code>` : ''}</li>`
).join('');
document.getElementById('summary').textContent = `${passed}/${results.length} passed`;
document.getElementById('summary').className = allOk ? 'pass' : 'fail';
document.title = `${allOk ? 'PASS' : 'FAIL'} · Air Strings tests`;
window.testResults = { passed, total: results.length, allOk, results };
