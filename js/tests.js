import {
  E2, E5, L_MIN, L_MAX, lengthToFrequency, rawFrequency, snapFrequency,
  noteName, freqToMidi, midiToFreq, lengthFraction, pitchForLength, centsOff, SCALES, SCALE_ROOT,
} from './pitch.js';
import { StringBank } from './strings.js';
import { Interaction, TUNING } from './interaction.js';
import { HandGestures, videoToScreen, PINCH_ON, PINCH_OFF } from './gestures.js';
import * as TH from './theremin-map.js';
import { SONGS, TEMPOS, buildSong, lessonRange, Lesson, noteToMidi, starsFor, GATE_SEC, COUNT_IN_BEATS } from './lessons.js';
import { ribbonGeometry } from './lesson-view.js';
import { HARP_NOTES, lengthForMidi, whiteNoteForLength, harpSlots, matchSlot, drawFeedback, StringSongRun } from './string-lessons.js';

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
