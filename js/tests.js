import {
  E2, E5, L_MIN, L_MAX, lengthToFrequency, rawFrequency, snapFrequency,
  noteName, freqToMidi, midiToFreq, lengthFraction, pitchForLength, centsOff, SCALES, SCALE_ROOT,
} from './pitch.js';
import { StringBank } from './strings.js';
import { Interaction, TUNING } from './interaction.js';
import { HandGestures, videoToScreen, PINCH_ON, PINCH_OFF } from './gestures.js';
import * as TH from './theremin-map.js';

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
