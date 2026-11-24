// Air Theremin — boot, frame loop and rendering.

import { ThereminSynth, VOICES } from './theremin-synth.js';
import { HandTracker, openCamera } from './tracking.js';
import { HandGestures, PointerGestures } from './gestures.js';
import {
  layoutFor, ThereminState, scaleNotes, midiToAxis, axisToScreen,
  THEREMIN_SCALES, RANGES, VOLUME_FLOOR,
} from './theremin-map.js';
import { midiToFreq, noteName } from './pitch.js';
import { SONGS, TEMPOS, buildSong, lessonRange, Lesson, demoFrame, streakMilestone, COUNT_IN_BEATS } from './lessons.js';
import { drawRibbon, ribbonGeometry } from './lesson-view.js';
import { FX, drawStreak } from './fx.js';
import { createSongPicker, suggestedSong } from './song-picker.js';
import { SignWatcher, drawSignRings, signsEnabled, setSignsEnabled } from './hand-signs.js';
import { FaceTracker, FaceControls, drawFaceBadge } from './face.js';

// Right after an update a browser can pair a cached older page with newer
// scripts, so a missing element gets a stand-in instead of stopping the app.
const stubs = new Map();
const $ = (id) => document.getElementById(id)
  || stubs.get(id) || stubs.set(id, document.createElement('div')).get(id);
const params = new URLSearchParams(location.search);
const video = $('video');
const canvas = $('canvas');
const ctx = canvas.getContext('2d');

const synth = new ThereminSynth();
const tracker = new HandTracker();
const hands = new HandGestures();
const mouse = new PointerGestures(canvas);
const state = new ThereminState();
const signs = new SignWatcher();
const faceTracker = new FaceTracker();
const faceCtl = new FaceControls();
const FACE_MIN_FPS = 15; // below this (and well below where it was), Face turns itself off

const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const settings = {
  assist: store.get('theremin.assist', 'gentle'),
  voice: store.get('theremin.voice', 'classic'),
  scale: store.get('theremin.scale', 'pentatonic'),
  range: store.get('theremin.range', 'mid'),
};
if (!['off', 'gentle', 'snap'].includes(settings.assist)) settings.assist = 'gentle';
if (!VOICES[settings.voice]) settings.voice = 'classic';
if (!THEREMIN_SCALES[settings.scale]) settings.scale = 'pentatonic';
if (!RANGES[settings.range]) settings.range = 'mid';

// Minimum pitch glide per assist mode; with hands it also stretches to the
// camera's frame interval so slides are smooth instead of stepping.
const GLIDE = { off: 0.02, gentle: 0.025, snap: 0.045 };
const PRESS_DWELL_MS = 140; // pinch must be held on a button this long to press it

// Song lessons (see lessons.js): step 1 "learn" waits for you, step 2 "play" runs in time.
const lesson = {
  active: false,
  songIdx: Math.min(SONGS.length - 1, Math.max(0, parseInt(store.get('theremin.song', '0'), 10) || 0)),
  mode: 'learn',
  tempo: store.get('theremin.tempo', 'slow'),
  song: null, range: null, run: null, view: null,
  lastT: 0, cardShown: false,
  demo: null, // 'Listen': { pos } while the app plays the song itself
};
const fx = new FX();
let fxT = 0;
const streak = { last: 0, upT: 0 }; // the streak counter's pop and milestones
let lastCountIn = 0; // count-in clicks
if (!TEMPOS[lesson.tempo]) lesson.tempo = 'slow';

const app = {
  mouseMode: params.get('mouse') === '1',
  started: false,
  cameraOn: false,
  trackerReady: false,
  W: 0, H: 0, dpr: 1,
  layout: null,
  toolbarRect: null,
  roles: { pitch: null, volume: null },
  reading: null,
  trail: [],
  everPlayed: false,
  everVolume: false,
  handCount: 0,
  detectFps: 0,
  detectInterval: 33,
  lastDetectT: 0,
  delegate: '',
  notes: [],
  presses: new Map(), // pointer id -> { btn, t0, done }
  signsOn: signsEnabled(),
  signRings: [],
  fistMute: false, // a held fist silences the instrument
  face: { on: false, loading: false, baseFps: 0, slowSecs: 0, wasCal: true },
};

// ---------------- Controls ----------------
const ASSIST_LABEL = { off: 'Off', gentle: 'Gentle', snap: 'Snap' };
// What the instrument actually plays with: a lesson fixes the scale and
// snapping, and fits the range to its song.
function playSettings() {
  return lesson.active ? { ...settings, assist: 'snap', scale: 'major', customRange: lesson.range } : settings;
}
const currentRange = () => (lesson.active ? lesson.range : RANGES[settings.range]);
function refreshNotes() { const s = playSettings(), r = currentRange(); app.notes = scaleNotes(s.scale, r.low, r.high); }
function setAssist(a) { settings.assist = a; store.set('theremin.assist', a); $('assistVal').textContent = ASSIST_LABEL[a]; }
function setVoice(v) { settings.voice = v; store.set('theremin.voice', v); synth.setVoice(v); $('voiceVal').textContent = VOICES[v].label; }
function setScale(s) { settings.scale = s; store.set('theremin.scale', s); $('scaleVal').textContent = THEREMIN_SCALES[s].label; refreshNotes(); }
function setRange(r) { settings.range = r; store.set('theremin.range', r); $('rangeVal').textContent = RANGES[r].label; refreshNotes(); }
const cycle = (list, cur) => list[(list.indexOf(cur) + 1) % list.length];
const cycleAssist = () => setAssist(cycle(['off', 'gentle', 'snap'], settings.assist));
const cycleVoice = () => setVoice(cycle(Object.keys(VOICES), settings.voice));
const cycleScale = () => setScale(cycle(Object.keys(THEREMIN_SCALES), settings.scale));
const cycleRange = () => setRange(cycle(Object.keys(RANGES), settings.range));
$('assistBtn').addEventListener('click', cycleAssist);
$('voiceBtn').addEventListener('click', cycleVoice);
$('scaleBtn').addEventListener('click', cycleScale);
$('rangeBtn').addEventListener('click', cycleRange);

// ---------------- Lessons ----------------
const bestStars = (id) => Math.min(3, Math.max(0, parseInt(store.get('theremin.stars.' + id, '0'), 10) || 0));
const starText = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
/** Stars earned across every song, shown on the Learn button in free play. */
function refreshLearnBadge() {
  const total = SONGS.reduce((t, d) => t + bestStars(d.id), 0);
  $('learnStars').textContent = total ? `★ ${total}` : '';
}
function refreshLessonLabels() {
  refreshLearnBadge();
  const def = SONGS[lesson.songIdx], best = bestStars(def.id);
  $('songKey').innerHTML = `Song ${lesson.songIdx + 1}/${SONGS.length}` + (best ? ` <span class="won">${'★'.repeat(best)}</span>` : '');
  $('songVal').textContent = def.short || def.title;
  $('stepVal').textContent = lesson.mode === 'learn' ? '1 · Learn' : '2 · Play';
  $('speedVal').textContent = TEMPOS[lesson.tempo].label;
  $('listenVal').textContent = lesson.demo ? 'Stop' : 'Hear it';
  $('listenBtn').classList.toggle('on', !!lesson.demo);
}
/** Listen first: the app plays the song on the ribbon, then hands it back for your turn. */
function startDemo() {
  if (!lesson.active) return;
  loadLesson();
  lesson.demo = { pos: -1, lastT: performance.now() };
  refreshLessonLabels();
}
function stopDemo(finished) {
  if (!lesson.demo) return;
  loadLesson(); // a fresh run for their turn
  say(finished ? 'Your turn!' : 'Stopped. Your turn!', 2200);
}
const toggleDemo = () => (lesson.demo ? stopDemo(false) : startDemo());
/** (Re)start the current song in the current step. */
function loadLesson() {
  lesson.demo = null;
  lesson.song = buildSong(SONGS[lesson.songIdx]);
  lesson.range = lessonRange(lesson.song);
  lesson.run = new Lesson(lesson.song, { mode: lesson.mode, bpm: TEMPOS[lesson.tempo].bpm });
  lesson.view = lesson.run.view();
  streak.last = 0;
  lesson.lastT = performance.now();
  lesson.cardShown = false;
  $('lessonCard').hidden = true;
  refreshNotes();
  refreshLessonLabels();
}
function introToast() {
  say(`Song ${lesson.songIdx + 1}: ${lesson.song.title} — ${lesson.song.teaches}. Tap Listen to hear it first.`, 4200);
}
function enterLesson() {
  lesson.active = true;
  lesson.mode = 'learn';
  document.body.classList.add('lesson');
  $('hint').hidden = true;
  loadLesson();
  picker.open(); // start by choosing a song (picking one introduces it)
}
function exitLesson() {
  lesson.active = false;
  lesson.msg = null;
  lesson.demo = null;
  picker.close();
  document.body.classList.remove('lesson');
  $('lessonCard').hidden = true;
  refreshNotes();
}
function setLessonSong(i) {
  lesson.songIdx = (i + SONGS.length) % SONGS.length;
  store.set('theremin.song', String(lesson.songIdx));
  lesson.mode = 'learn';
  loadLesson();
  introToast();
}
function setLessonMode(m) {
  lesson.mode = m;
  loadLesson();
  say(m === 'learn' ? 'Step 1: find each note. The song waits for you.' : 'Step 2: play in time. Stay on the ribbon as it moves.', 2600);
}
function setLessonTempo(t) {
  lesson.tempo = t; store.set('theremin.tempo', t);
  loadLesson();
}
function finishLesson() {
  lesson.cardShown = true;
  const res = lesson.run.result(), def = SONGS[lesson.songIdx];
  const card = (stars, title, msg, primary, secondary) => {
    $('lessonStars').innerHTML = stars == null ? '' : '★'.repeat(stars) + `<span class="off">${'★'.repeat(3 - stars)}</span>`;
    $('lessonTitle').textContent = title;
    $('lessonMsg').textContent = msg;
    $('lessonPrimary').textContent = primary[0]; $('lessonPrimary').onclick = primary[1];
    $('lessonSecondary').textContent = secondary[0]; $('lessonSecondary').onclick = secondary[1];
    $('lessonCard').hidden = false;
  };
  if (lesson.mode === 'learn') {
    card(null, 'You found every note!', `That was ${def.title}. Now play it in time: the ribbon keeps moving, so stay with it.`,
      ['Play in time', () => setLessonMode('play')], ['Go again', () => setLessonMode('learn')]);
    return;
  }
  if (res.stars > bestStars(def.id)) store.set('theremin.stars.' + def.id, String(res.stars));
  if (res.stars === 3) fx.confetti(app.W, app.H);
  refreshLessonLabels();
  const title = res.hits === res.total ? 'Perfect!' : ['Keep at it', 'Good start', 'Nicely played', 'Excellent!'][res.stars];
  const msg = `You hit ${res.hits} of ${res.total} notes at ${TEMPOS[lesson.tempo].label.toLowerCase()} speed. Best streak ${res.maxCombo}.`;
  const again = ['Play again', () => setLessonMode('play')];
  if (res.stars >= 2) card(res.stars, title, msg, ['Next song', () => setLessonSong(lesson.songIdx + 1)], again);
  else card(res.stars, title, msg, ['Try again', () => setLessonMode('play')], ['Back to step 1', () => setLessonMode('learn')]);
}
const picker = createSongPicker({
  songs: SONGS,
  scores: () => SONGS.map((d) => [{ label: '', stars: bestStars(d.id) }]),
  current: () => lesson.songIdx,
  onPick: (i) => setLessonSong(i),
  onOpen: () => { $('lessonCard').hidden = true; loadLesson(); }, // nothing plays on underneath
  onClose: () => { lesson.lastT = performance.now(); },
});
refreshLearnBadge();
$('learnBtn').addEventListener('click', enterLesson);
$('exitLessonBtn').addEventListener('click', exitLesson);
$('songBtn').addEventListener('click', () => picker.open());
$('stepBtn').addEventListener('click', () => setLessonMode(lesson.mode === 'learn' ? 'play' : 'learn'));
$('listenBtn').addEventListener('click', toggleDemo);
$('speedBtn').addEventListener('click', () => setLessonTempo(cycle(Object.keys(TEMPOS), lesson.tempo)));
for (const b of document.querySelectorAll('.toolbar button, .toolbar a')) {
  b.addEventListener('click', () => { b.classList.remove('pressed'); void b.offsetWidth; b.classList.add('pressed'); });
}
$('volume').addEventListener('input', (e) => synth.setVolume(parseFloat(e.target.value)));
$('help').addEventListener('click', () => { $('hint').hidden = !$('hint').hidden; });
$('hintOk').addEventListener('click', () => { $('hint').hidden = true; });
$('soundBanner').addEventListener('click', () => synth.unlock());
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k === 'l') lesson.active ? exitLesson() : enterLesson();
  else if (k === 'p' && lesson.active) toggleDemo();
  else if (lesson.active && 'avsr'.includes(k)) return; // free-play controls are parked during a lesson
  else if (k === 'a') cycleAssist();
  else if (k === 'v') cycleVoice();
  else if (k === 's') cycleScale();
  else if (k === 'r') cycleRange();
  else if (k === 'f') setFace(!app.face.on);
  else if (k === 'h' || k === '?') $('hint').hidden = !$('hint').hidden;
  else if (k === 'escape') { if (!$('hint').hidden) $('hint').hidden = true; else if (lesson.active) exitLesson(); }
  else return;
  e.preventDefault();
});
setAssist(settings.assist); setVoice(settings.voice); setScale(settings.scale); setRange(settings.range);

// Never leave a tone droning in a hidden tab.
document.addEventListener('visibilitychange', () => { if (document.hidden) synth.silence(); });
window.addEventListener('pagehide', () => synth.silence());

let toastTimer;
/** Lesson messages show in the coach line (highlighted), clear of the ribbon. */
function say(text, ms = 2600) { lesson.msg = { text, until: performance.now() + ms }; }
function toast(text, ms = 1600) {
  const t = $('toast');
  t.textContent = text; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function setStatus(text, kind = '') {
  $('statusText').textContent = text;
  $('status').className = 'status' + (kind ? ' ' + kind : '');
}
let coachKey = '';
function setCoach(c) {
  const key = c ? c.step + c.text : '';
  if (key === coachKey) return;
  coachKey = key;
  $('coach').hidden = !c;
  if (!c) return;
  $('coach').classList.toggle('msg', !!c.msg);
  $('coachStep').textContent = c.step; $('coachText').textContent = c.text;
  if (c.quiet) return; // lesson text changes with every note: don't re-animate
  const el = $('coach'); el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
}
let soundPaused = null;
function setSoundPaused(p) {
  if (p === soundPaused) return;
  soundPaused = p; $('soundBanner').hidden = !p;
}

if (app.mouseMode) {
  $('startNote').textContent = 'Mouse/touch mode: no camera needed. Press and drag on the right side to play.';
  $('startMouse').hidden = true;
}

// ---------------- Boot ----------------
async function start(forceMouse) {
  if (app.started) return;
  if (forceMouse) app.mouseMode = true;
  try { await synth.start(); } catch (err) { console.error(err); toast('Audio could not start: ' + err.message, 4000); }
  synth.setVoice(settings.voice);
  app.started = true;
  $('start').hidden = true;
  $('toolbar').hidden = false;
  $('status').hidden = false;
  document.body.classList.toggle('mouse-mode', app.mouseMode);
  resize();
  if (app.mouseMode) setStatus('Mouse/touch mode', 'live');
  else await startCamera();
}

async function startCamera() {
  setStatus('Asking for camera…', 'warn');
  try {
    await openCamera(video);
    synth.unlock();
    app.cameraOn = true; app.mouseMode = false;
    document.body.classList.remove('mouse-mode');
    $('camError').hidden = true;
  } catch (err) {
    console.warn(err);
    app.mouseMode = true;
    document.body.classList.add('mouse-mode');
    setStatus('Mouse/touch mode (no camera)', 'warn');
    showCamError(err.userMessage || err.message);
    return;
  }
  if (!app.trackerReady) {
    try {
      app.delegate = await tracker.init((s) => setStatus(s, 'warn'));
      app.trackerReady = true;
    } catch (err) {
      console.error(err);
      showCamError('The hand-tracking model could not load (' + (err.message || err) + '). Check your connection and try again.');
      app.mouseMode = true;
      document.body.classList.add('mouse-mode');
      return;
    }
  }
  setStatus('Show your hands to the camera', 'live');
}
function showCamError(msg) {
  $('camErrorText').textContent = msg;
  $('camError').hidden = false;
  $('retryCam').onclick = () => { $('camError').hidden = true; startCamera(); };
  $('dismissErr').onclick = () => { $('camError').hidden = true; };
}

$('startBtn').addEventListener('click', () => { $('startBtn').disabled = true; start(false); });
$('startMouse').addEventListener('click', () => start(true));

// ---------------- Layout ----------------
function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  app.W = window.innerWidth; app.H = window.innerHeight; app.dpr = dpr;
  canvas.width = Math.round(app.W * dpr);
  canvas.height = Math.round(app.H * dpr);
  const tb = $('toolbar');
  const rect = tb.hidden ? null : tb.getBoundingClientRect();
  app.toolbarRect = rect;
  const portrait = app.W < app.H;
  // In portrait the highest notes sit at the top: keep them clear of the toolbar.
  const top = rect ? rect.bottom + (portrait ? 34 : 10) : 16;
  app.layout = layoutFor(app.W, app.H, { top, bottom: 56 });
  for (const el of document.querySelectorAll('.axis-word')) el.textContent = app.layout.landscape ? 'left–right' : 'up–down';
  for (const el of document.querySelectorAll('.tone-word')) el.textContent = app.layout.landscape ? 'up' : 'right';
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));
// The toolbar can wrap differently as labels change; keep the play area in sync.
if (window.ResizeObserver) new ResizeObserver(() => resize()).observe($('toolbar'));
resize();

/** Is a point inside (or just below) the toolbar? */
function nearToolbar(x, y, pad = 18) {
  const r = app.toolbarRect;
  return !!r && x > r.left - pad && x < r.right + pad && y < r.bottom + pad && y > r.top - pad;
}

// ---------------- Loop ----------------
let detectCount = 0, detectWindow = performance.now();

function frame(now) {
  if (window.innerWidth !== app.W || window.innerHeight !== app.H) resize();
  const L = app.layout;

  // Mouse / touch: only pressed pointers play.
  const ptrs = mouse.update().filter((p) => p.pinching);
  let handPtrs = [];
  let newDetection = false;
  if (app.cameraOn && app.trackerReady && !app.mouseMode) {
    let det = null;
    try { det = tracker.detect(video, now); } catch (err) { console.warn('detect failed', err); }
    if (det) {
      detectCount++; app.handCount = det.length; newDetection = true;
      if (app.lastDetectT) app.detectInterval = app.detectInterval * 0.8 + Math.min(120, now - app.lastDetectT) * 0.2;
      app.lastDetectT = now;
    }
    handPtrs = hands.update(det, video, app.W, app.H, now).filter((p) => !p.lost);
    if (now - detectWindow > 1000) {
      app.detectFps = Math.round((detectCount * 1000) / (now - detectWindow));
      detectCount = 0; detectWindow = now;
      const n = app.handCount;
      setStatus(n ? `Tracking ${n} hand${n > 1 ? 's' : ''} · ${app.detectFps} fps · ${app.delegate}` : 'Show your hands to the camera', 'live');
      guardFaceSpeed();
    }
    handlePinchPresses(handPtrs, now);
  }
  app.handPtrs = handPtrs;
  watchSigns(handPtrs, now);

  // Playing points. Hands use the palm (steady while pinching). A hand that is
  // reaching into the toolbar doesn't play (its role is simply paused).
  const points = [];
  for (const p of handPtrs) {
    p.atToolbar = nearToolbar(p.x, p.y) || nearToolbar(p.tipX, p.tipY);
    if (!p.atToolbar) points.push({ id: p.id, x: p.palmX ?? p.x, y: p.palmY ?? p.y, source: 'hand', firstSeen: p.firstSeen });
  }
  for (const p of ptrs) points.push({ id: p.id, x: p.x, y: p.y, source: 'mouse' });

  const eff = playSettings();
  app.eff = eff;
  const r = state.step(points, L, eff, now);
  app.reading = r;
  app.roles = r.roles;

  // Lesson: move the song along, and dip the volume for a moment between
  // notes so repeated notes sound like separate notes.
  let gate = 1;
  let heard = r; // what the synth plays: you, or the song itself while listening
  if (lesson.active && picker.isOpen) {
    lesson.lastT = now; // the song waits under the picker
  } else if (lesson.active && lesson.demo) {
    const d = lesson.demo;
    d.pos += Math.min(0.1, Math.max(0, (now - d.lastT) / 1000)) * (TEMPOS[lesson.tempo].bpm / 60);
    d.lastT = now;
    const f = demoFrame(lesson.song, d.pos, TEMPOS[lesson.tempo].bpm);
    lesson.view = f.view;
    gate = f.view.gate;
    d.reading = f.midi == null ? { ...r, sounding: false, pitchPresent: false, midi: null }
      : { ...r, sounding: true, pitchPresent: true, midi: f.midi, freq: midiToFreq(f.midi), level: 0.75, tone: 0.45 };
    heard = d.reading;
    if (f.done) stopDemo(true);
  } else if (lesson.active && lesson.run) {
    const dt = Math.min(0.1, Math.max(0, (now - lesson.lastT) / 1000));
    lesson.lastT = now;
    const before = lesson.view ? lesson.view.index : 0;
    lesson.view = lesson.run.step(r, dt);
    gate = lesson.view.gate;
    // Sparks for every note you just got, where it crossed the now-line.
    for (let i = before; i < lesson.view.index; i++) if (lesson.view.hit[i]) sparkleNote(lesson.song.notes[i].midi);
    const c = lesson.view.combo || 0;
    if (c > streak.last) {
      streak.upT = now;
      const m = lesson.mode === 'play' && streakMilestone(streak.last, c);
      if (m) { const [x, y] = streakPos(); fx.burst(x, y, 45, 1); say(`${m} in a row!`, 1600); }
    }
    streak.last = c;
    if (lesson.view.done && !lesson.cardShown) finishLesson();
  }
  const face = app.cameraOn && !app.mouseMode ? readFace(now) : null;
  if (face && !lesson.demo) {
    heard = { ...heard, face };
    if (face.octave && heard.freq) heard.freq *= 2;
  }
  app.faceOut = face;
  if (app.fistMute) heard = { ...heard, sounding: false };
  const handGlide = app.cameraOn && !app.mouseMode ? (app.detectInterval / 1000) * 0.6 : 0;
  const glide = Math.max(GLIDE[eff.assist], handGlide);
  if (gate < 1) synth.update({ ...heard, level: heard.level * gate }, glide, 0.02);
  else synth.update(heard, glide);

  if (r.sounding) {
    app.everPlayed = true;
    if (r.roles.volume) app.everVolume = true;
    if (newDetection || ptrs.length) {
      const c = axisToScreen(midiToAxis(r.midi, r.range.low, r.range.high), L);
      const hp = r.roles.pitch;
      app.trail.push({ x: L.axis === 'x' ? c : hp.x, y: L.axis === 'x' ? hp.y : c, hue: hueFor(r.midi, r.range), a: r.level, t: now });
    }
  }
  let drop = 0;
  while (drop < app.trail.length && (now - app.trail[drop].t > 900)) drop++;
  if (drop) app.trail.splice(0, drop);
  if (app.trail.length > 60) app.trail.splice(0, app.trail.length - 60);

  // Click each beat of the count-in (the first one higher), so you hear the tempo.
  const ci = lesson.active && lesson.view ? lesson.view.countIn || 0 : 0;
  if (ci && ci !== lastCountIn) synth.tick(ci === (lesson.demo ? 1 : COUNT_IN_BEATS));
  lastCountIn = ci;

  setSoundPaused(app.started && synth.needsUnlock);
  setCoach(lesson.active ? lessonCoach() : coach());
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------- Face control ----------------
// Mouth open = brighter "wah", lips in an "oo" = darker, eyebrows up = an
// octave higher (free play only, so lessons stay on their notes).
async function setFace(on) {
  const f = app.face;
  if (on === f.on || f.loading) return;
  if (on && (!app.cameraOn || app.mouseMode)) { toast('Face control needs the camera.', 2200); return; }
  if (on) {
    f.loading = true;
    $('faceVal').textContent = '…'; $('faceVal2').textContent = '…';
    try {
      await faceTracker.init((s) => setStatus(s, 'warn'));
    } catch (err) {
      console.error(err);
      f.loading = false;
      refreshFaceLabels();
      toast('The face tracker could not load. Check your connection and try again.', 3000);
      return;
    }
    f.loading = false;
    faceCtl.reset();
    f.on = true; f.wasCal = true; f.slowSecs = 0; f.baseFps = app.detectFps;
    (lesson.active ? say : toast)('Relax your face for a moment…', 1600);
  } else {
    f.on = false;
  }
  refreshFaceLabels();
}
function refreshFaceLabels() {
  const v = app.face.on ? 'On' : 'Off';
  $('faceVal').textContent = v; $('faceVal2').textContent = v;
  $('faceBtn').classList.toggle('on', app.face.on);
  $('faceBtn').setAttribute('aria-pressed', String(app.face.on));
  $('faceBtn').title = `Face control is ${v.toLowerCase()}: mouth for tone, eyebrows for an octave (F)`;
}
$('faceBtn').addEventListener('click', () => setFace(!app.face.on));
$('faceBtn2').addEventListener('click', () => setFace(!app.face.on));
/** Read the face this frame; returns the face part of what the synth should play, or null. */
function readFace(now) {
  const f = app.face;
  if (!f.on) return null;
  let sample = null;
  try { sample = faceTracker.detect(video, now); } catch (err) { console.warn('face detect failed', err); }
  faceCtl.update(sample, now);
  if (f.wasCal && !faceCtl.calibrating) {
    (lesson.active ? say : toast)(lesson.active
      ? 'Face on: open your mouth for a brighter sound.'
      : 'Face on: open your mouth for a brighter sound, raise your eyebrows for an octave up.', 3200);
  }
  f.wasCal = faceCtl.calibrating;
  if (faceCtl.calibrating || !faceCtl.present) return null;
  return { mouth: faceCtl.mouth, oo: faceCtl.oo, octave: faceCtl.brows && !lesson.active };
}
/** Once a second: if hand tracking slows right down with Face on, turn Face off. */
function guardFaceSpeed() {
  const f = app.face;
  if (!f.on) return;
  const slow = app.detectFps < FACE_MIN_FPS && app.detectFps < f.baseFps * 0.8;
  f.slowSecs = slow ? f.slowSecs + 1 : 0;
  if (f.slowSecs >= 3) {
    setFace(false);
    toast('Face control turned off: hand tracking got too slow on this device.', 3600);
  }
}

// ---------------- Hand signs ----------------
// Hold a shape for a moment: a fist silences (while held), thumbs up says yes,
// thumbs down restarts a lesson song, victory switches instrument, "I love you"
// throws confetti.
function lessonSign(name, dry = false) {
  if (!lesson.active) return false;
  if (name === 'Thumb_Up') {
    if (!$('lessonCard').hidden) { if (!dry) $('lessonPrimary').click(); return true; }
    if (picker.isOpen) {
      if (!dry) { const i = suggestedSong(SONGS.map((d) => [{ stars: bestStars(d.id) }]), lesson.songIdx); picker.close(); setLessonSong(i); }
      return true;
    }
    return false;
  }
  if (name === 'Thumb_Down') {
    if (picker.isOpen) return false;
    if (!dry) { loadLesson(); say('Starting the song again.', 1800); }
    return true;
  }
  return false;
}
function canSign(name) {
  if (!app.started || !$('hint').hidden) return false;
  if (name === 'Closed_Fist') return app.fistMute || !!(app.reading && app.reading.sounding);
  if (name === 'Thumb_Up' || name === 'Thumb_Down') return lessonSign(name, true);
  return true; // Victory, ILoveYou
}
function runSign(name) {
  if (name === 'Thumb_Up' || name === 'Thumb_Down') lessonSign(name);
  else if (name === 'Victory') {
    toast('Off to Air Strings…', 1200);
    setTimeout(() => { location.href = 'index.html'; }, 450);
  } else if (name === 'ILoveYou') fx.confetti(app.W, app.H);
  // Closed_Fist works while held: see watchSigns.
}
function watchSigns(handPtrs, now) {
  if (!app.signsOn || app.mouseMode) { app.signRings = []; app.fistMute = false; return; }
  const r = signs.update(handPtrs, now, canSign);
  app.signRings = r.rings;
  const mute = r.held.has('Closed_Fist');
  if (mute && !app.fistMute) (lesson.active ? say : toast)('✊ Silenced. Open your hand to play.', 1400);
  app.fistMute = mute;
  for (const f of r.fired) runSign(f.name);
}
function setSigns(on) {
  app.signsOn = on;
  setSignsEnabled(on);
  signs.reset();
  $('signsVal').textContent = on ? 'On' : 'Off';
}
$('signsBtn').addEventListener('click', () => setSigns(!app.signsOn));
setSigns(app.signsOn);

/**
 * Pinch-to-press for hands: the pinch has to stay on the same button for a
 * moment (so a pinch while playing high notes doesn't press anything), and
 * only buttons count — links would leave the page mid-performance.
 */
function handlePinchPresses(handPtrs, now) {
  const live = new Set();
  for (const p of handPtrs) {
    live.add(p.id);
    if (!p.pinching) { app.presses.delete(p.id); continue; }
    const el = document.elementFromPoint(p.x, p.y);
    const btn = el && el.closest('button:not([disabled])');
    const ok = btn && btn.closest('.toolbar, .hint, .banner, .lesson-card, .song-picker');
    let pr = app.presses.get(p.id);
    if (p.pinchStarted || !pr) { pr = { btn: ok ? btn : null, t0: now, done: false }; app.presses.set(p.id, pr); }
    if (!ok || btn !== pr.btn) { pr.btn = null; continue; } // drifted off: no press
    pr.btn.classList.add('arming');
    if (!pr.done && now - pr.t0 >= PRESS_DWELL_MS) { pr.done = true; pr.btn.classList.remove('arming'); pr.btn.click(); }
  }
  for (const [id, pr] of app.presses) if (!live.has(id)) app.presses.delete(id);
  for (const b of document.querySelectorAll('.arming')) {
    if (![...app.presses.values()].some((pr) => pr.btn === b && !pr.done)) b.classList.remove('arming');
  }
}

function coach() {
  if (!app.started || !$('hint').hidden) return null;
  const hand = !app.mouseMode;
  const dir = app.layout.landscape ? 'left–right' : 'up–down';
  const { pitch, volume } = app.roles;
  if (!pitch && volume && !app.reading.remembered) {
    return { step: 1, text: hand ? 'That hand sets volume. Bring a hand into the right side to play notes.' : 'That’s the volume side. Press on the right side to play notes.' };
  }
  if (!app.everPlayed) {
    return { step: 1, text: hand ? `Hold one hand up on the right side and move it ${dir} to play.` : `Press and drag on the right side, ${dir}, to play.` };
  }
  if (!app.everVolume) {
    return { step: 2, text: hand ? 'Now raise your other hand on the left: higher is louder, drop it to go silent.' : 'On a touchscreen, add a second finger on the left for volume. Higher is louder.' };
  }
  return null;
}

/** Coaching for a lesson: the words being sung, and where to move next. */
function lessonCoach() {
  const v = lesson.view;
  if (!app.started || !$('hint').hidden || picker.isOpen) return null;
  if (lesson.msg && performance.now() < lesson.msg.until && !lesson.cardShown) return { step: '✦', text: lesson.msg.text, quiet: true, msg: true };
  if (!v || v.done || !v.target) return null;
  if (lesson.demo) return { step: '♪', text: `Listen: ${lesson.song.phrases[v.target.phrase]}`, quiet: true };
  const words = lesson.song.phrases[v.target.phrase];
  const r = app.reading || {};
  const n = v.target.name;
  const land = app.layout.landscape;
  let tip = '';
  if (!r.pitchPresent) tip = app.mouseMode ? 'press on the right side to begin' : 'hold a hand up on the right to begin';
  else if (!r.sounding) tip = 'raise your volume hand to hear it';
  else if (v.mode === 'play') tip = v.countIn ? `get ready on ${n}` : '';
  else if (v.onPitch) tip = `that’s ${n}, hold it`;
  else if (v.direction > 0) tip = `find ${n}: move ${land ? 'right →' : 'up ↑'} (higher)`;
  else if (v.direction < 0) tip = `find ${n}: move ${land ? 'left ←' : 'down ↓'} (lower)`;
  return { step: v.index + 1, text: tip ? `${words} · ${tip}` : words, quiet: true };
}

/** Where the streak counter sits: the top of the volume side, clear of the ribbon. */
function streakPos() {
  const v = app.layout.volume;
  return [v.x + v.w / 2, v.y + 64];
}
function sparkleNote(midi) {
  const L = app.layout, range = lesson.range;
  if (!L || !range) return;
  const g = ribbonGeometry(L);
  const c = axisToScreen(midiToAxis(midi, range.low, range.high), L);
  const [x, y] = g.land ? [c, g.nowC] : [g.nowC, c];
  fx.burst(x, y, hueFor(midi, range), lesson.mode === 'play' ? 0.8 : 0.5);
}

// ---------------- Render ----------------
const hueFor = (midi, range) => 200 - 170 * Math.min(1, Math.max(0, (midi - range.low) / (range.high - range.low)));

function render() {
  const { W, H, dpr } = app;
  const L = app.layout;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!app.started) return;
  const r = app.reading || { range: currentRange() };

  drawWaveform(r);   // background layer
  drawZones(L, r);
  drawGuides(L, r);
  if (lesson.active && lesson.view) drawRibbon(ctx, L, lesson.range, lesson.song, lesson.view, lesson.demo ? lesson.demo.reading : r, hueFor);
  drawTrail();
  drawHands(L, r);
  const now = performance.now();
  const v = lesson.view;
  if (lesson.active && !lesson.demo && v && v.mode === 'play' && v.started && !v.countIn && v.combo >= 2) {
    const [sx, sy] = streakPos();
    drawStreak(ctx, sx, sy, v.combo, now - streak.upT);
  }
  fx.update((now - (fxT || now)) / 1000);
  fxT = now;
  fx.draw(ctx);
  drawSignRings(ctx, app.signRings);
  if (app.face.on) { const [fx2, fy2] = faceBadgePos(); drawFaceBadge(ctx, fx2, fy2, faceCtl, now); }
}
/** The face badge sits near the top of the volume side (below the streak counter in a lesson). */
function faceBadgePos() {
  const v = app.layout.volume;
  return [Math.max(48, v.x + v.w / 2), v.y + (lesson.active ? 150 : 70)];
}

// Glow without shadowBlur (slow on phones): a wide faint stroke under a thin bright one.
function glowStroke(color, faint, width) {
  ctx.strokeStyle = faint; ctx.lineWidth = width + 8; ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
}

function drawZones(L, r) {
  const v = L.volume, p = L.pitch;
  ctx.save();
  ctx.fillStyle = 'rgba(120, 224, 255, 0.035)';
  ctx.fillRect(v.x, v.y, v.w, v.h);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.setLineDash([6, 8]);
  ctx.beginPath(); ctx.moveTo(L.split, v.y); ctx.lineTo(L.split, v.y + v.h); ctx.stroke();
  ctx.setLineDash([]);
  const floorY = v.y + v.h * (1 - VOLUME_FLOOR);
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.beginPath(); ctx.moveTo(v.x + 12, floorY); ctx.lineTo(v.x + v.w - 28, floorY); ctx.stroke();
  ctx.font = '700 11px ui-rounded, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(238,241,248,0.5)';
  ctx.fillText('VOLUME', v.x + v.w / 2, v.y + 16);
  ctx.fillText('silent', v.x + v.w / 2, floorY + 16);
  ctx.fillText('PITCH', p.x + p.w / 2, p.y + 16);
  ctx.font = '600 10px ui-rounded, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(238,241,248,0.35)';
  if (L.landscape) { ctx.textAlign = 'right'; ctx.fillText('brighter ↑', p.x + p.w - 8, p.y + 16); }
  else { ctx.textAlign = 'left'; ctx.fillText('brighter →', p.x + 8, p.y + 30); }
  // Volume meter along the divider
  const level = r.sounding ? r.level : (r.levelPreview || 0);
  const mx = L.split - 16, mTop = v.y + 34, mBot = floorY;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(mx, mBot); ctx.lineTo(mx, mTop); ctx.stroke();
  if (level > 0.001) {
    ctx.beginPath(); ctx.moveTo(mx, mBot); ctx.lineTo(mx, mBot - (mBot - mTop) * level);
    glowStroke('#9fe8ff', 'rgba(120,224,255,0.18)', 6);
  }
  ctx.restore();
}

function drawGuides(L, r) {
  const range = currentRange();
  const eff = playSettings();
  const p = L.pitch;
  ctx.save();
  ctx.font = '600 11px ui-rounded, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cur = r.sounding ? Math.round(r.midi) : null;
  for (const n of app.notes) {
    const c = axisToScreen(midiToAxis(n, range.low, range.high), L);
    const name = noteName(midiToFreq(n));
    const isC = n % 12 === 0;
    const sharp = name.includes('#');
    const active = cur === n && (eff.assist !== 'off' || Math.abs(r.midi - n) < 0.15);
    ctx.strokeStyle = active ? `hsla(${hueFor(n, range)}, 95%, 70%, 0.9)` : `rgba(255,255,255,${isC ? 0.22 : sharp ? 0.06 : 0.11})`;
    ctx.lineWidth = active ? 2 : 1;
    ctx.beginPath();
    if (L.axis === 'x') { ctx.moveTo(c, p.y + 28); ctx.lineTo(c, p.y + p.h - 20); }
    else { ctx.moveTo(p.x, c); ctx.lineTo(p.x + p.w - 34, c); }
    ctx.stroke();
    if (!sharp || eff.scale !== 'chromatic') {
      // Labels on a dark pill so the waveform behind never hides them.
      const lx = L.axis === 'x' ? c : p.x + p.w - 18;
      const ly = L.axis === 'x' ? p.y + p.h - 10 : c;
      ctx.fillStyle = 'rgba(8,10,18,0.6)';
      ctx.fillRect(lx - 13, ly - 7, 26, 14);
      ctx.fillStyle = active ? `hsl(${hueFor(n, range)}, 100%, 85%)` : `rgba(238,241,248,${isC ? 0.8 : 0.5})`;
      ctx.fillText(name, lx, ly);
    }
  }
  ctx.restore();
}

function drawTrail() {
  const tr = app.trail;
  if (tr.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 1; i < tr.length; i++) {
    const a = tr[i - 1], b = tr[i];
    const k = i / tr.length;
    ctx.strokeStyle = `hsla(${b.hue}, 95%, 65%, ${0.55 * k * (0.3 + 0.7 * b.a)})`;
    ctx.lineWidth = 2 + 9 * k * b.a;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.restore();
}

function drawWaveform(r) {
  const wave = synth.waveform();
  if (!wave) return;
  const { W, H } = app;
  const y0 = H - 96, amp = 44;
  const freq = r.sounding ? r.freq : 220;
  const sr = synth.ctx.sampleRate;
  const n = Math.min(wave.length - 1, Math.max(64, Math.round((sr / freq) * 3)));
  // Start at an upward zero crossing so the trace holds still.
  let s0 = 0;
  for (let i = 1; i < wave.length - n; i++) { if (wave[i - 1] < 0 && wave[i] >= 0) { s0 = i; break; } }
  const steps = Math.min(n, 240); // decimate: a few hundred points is plenty
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let j = 0; j <= steps; j++) {
    const i = Math.round((j / steps) * (n - 1));
    const x = 24 + (j / steps) * (W - 48);
    const y = y0 - wave[s0 + i] * amp * 2.2;
    j ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  if (r.sounding) {
    const hue = hueFor(r.midi, r.range);
    glowStroke(`hsla(${hue}, 95%, 72%, 0.55)`, `hsla(${hue}, 95%, 60%, 0.08)`, 2);
  } else {
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 2; ctx.stroke();
  }
  ctx.restore();
}

function drawHands(L, r) {
  ctx.save();
  // Fingertip/thumb markers for every tracked hand (so you see what the app sees).
  for (const p of app.handPtrs || []) {
    const col = p.atToolbar ? 'rgba(255,220,140,0.9)' : 'rgba(255,255,255,0.7)';
    ctx.strokeStyle = p.atToolbar ? 'rgba(255,220,140,0.6)' : 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(p.thumbX, p.thumbY); ctx.lineTo(p.tipX, p.tipY); ctx.stroke();
    ctx.fillStyle = col;
    for (const [x, y] of [[p.thumbX, p.thumbY], [p.tipX, p.tipY]]) { ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); }
  }
  const { pitch, volume } = r.roles || {};
  if (volume) {
    ctx.beginPath(); ctx.arc(volume.x, volume.y, 16, 0, Math.PI * 2);
    glowStroke('#78e0ff', 'rgba(120,224,255,0.15)', 2.5);
    label(`${Math.round((r.sounding ? r.level : r.levelPreview || 0) * 100)}%`, volume.x, volume.y - 30, '#bff0ff');
  }
  if (pitch && r.midi != null) {
    const hue = hueFor(r.midi, r.range);
    const c = axisToScreen(midiToAxis(r.midi, r.range.low, r.range.high), L);
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (L.axis === 'x') { ctx.moveTo(c, pitch.y - 40); ctx.lineTo(c, pitch.y + 40); }
    else { ctx.moveTo(pitch.x - 40, c); ctx.lineTo(pitch.x + 40, c); }
    glowStroke(`hsla(${hue}, 95%, 72%, 0.9)`, `hsla(${hue}, 95%, 60%, 0.15)`, 3);
    ctx.beginPath(); ctx.arc(pitch.x, pitch.y, 18, 0, Math.PI * 2);
    glowStroke(`hsla(${hue}, 95%, 72%, 0.9)`, `hsla(${hue}, 95%, 60%, 0.12)`, 2.5);
    const cents = playSettings().assist === 'off' && r.cents ? ` ${r.cents > 0 ? '+' : ''}${r.cents}¢` : '';
    label(r.note + cents, pitch.x, pitch.y - 36, `hsl(${hue}, 100%, 88%)`, 16);
  }
  ctx.restore();
}

function label(text, x, y, color, size = 13) {
  ctx.save();
  ctx.font = `700 ${size}px ui-rounded, system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 16, h = size + 12;
  ctx.fillStyle = 'rgba(8,10,18,0.72)';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2); else ctx.rect(x - w / 2, y - h / 2, w, h);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(text, x, y + 0.5);
  ctx.restore();
}

// Debug handle (used for automated checks; harmless otherwise).
window.theremin = {
  app, synth, settings, tracker, state, start, setAssist, setVoice, setScale, setRange,
  lesson, picker, enterLesson, exitLesson, setLessonSong, setLessonMode, setLessonTempo, startDemo, stopDemo,
  signs, setSigns, setFace, faceCtl, faceTracker,
};
