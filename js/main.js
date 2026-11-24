// Air Strings — app bootstrap and main loop.

import { StringSynth } from './audio.js';
import { HandTracker, openCamera } from './tracking.js';
import { HandGestures, PointerGestures } from './gestures.js';
import { StringBank, roundRect } from './strings.js';
import { Interaction } from './interaction.js';
import { UI } from './ui.js';
import { createStringLessons } from './string-lesson-main.js';
import { SignWatcher, drawSignRings, signsEnabled, setSignsEnabled } from './hand-signs.js';
import { FaceSession, drawFaceBadge } from './face.js';

const params = new URLSearchParams(location.search);
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const synth = new StringSynth();
const bank = new StringBank();
const tracker = new HandTracker();
const hands = new HandGestures();
const mouse = new PointerGestures(canvas);
const signs = new SignWatcher();
const face = new FaceSession();

const app = {
  mouseMode: params.get('mouse') === '1',
  cameraOn: false,
  trackerReady: false,
  W: 0, H: 0, dpr: 1,
  pointers: [],
  handCount: 0,
  detectFps: 0,
  plucked: false,       // has the user played a string yet?
  strummed: false,
  strumTipUntil: 0,     // show the strum tip briefly after the first pluck
  signsOn: signsEnabled(),
  signRings: [],
};

let ui, lessons; // assigned below
const interaction = new Interaction({
  bank, synth,
  onEvent(ev) {
    if (lessons) lessons.onEvent(ev);
    if (ev.type === 'pluck' || ev.type === 'strum') {
      if (!app.plucked) app.strumTipUntil = performance.now() + 6000;
      app.plucked = true;
      if (ev.type === 'strum') app.strummed = true;
      app.lastPlayT = performance.now(); // a wave across strings is a strum, not a goodbye
    } else if (ev.type === 'tooQuick') {
      // Only explain while they're still learning; otherwise it's likely a strum.
      if (bank.strings.length === 0 && !app.mouseMode && !lessons.active) ui.toast('Hold the pinch for a moment, then drag, to draw.', 2600);
    } else if (ev.type === 'tooShort') ui.toast('Too short. Drag a longer string.');
    else if (ev.type === 'tooMany') ui.toast('That’s plenty of strings! Undo or clear some.');
  },
});

ui = new UI({
  // Undo, Clear and Snap belong to free play; a lesson manages its own strings.
  onUndo() { if (lessons.active) return; undoOne(); },
  onClear() { if (lessons.active) return; clearStrings(); },
  onScale(s) { setScale(s); },
  onVolume(v) { synth.setVolume(v); },
});
ui.setScale(bank.scale);
function setScale(s) {
  if (lessons.active) return;
  bank.setScale(s);
  ui.setScale(s);
  ui.toast({ off: 'Snap off: exact pitch from length', chromatic: 'Snap: chromatic', pentatonic: 'Snap: E major pentatonic' }[s]);
}
// Clearing can be undone for a few seconds (a wave or two fists clears too).
const RESTORE_MS = 8000;
let cleared = null; // { strings, until }
const canRestore = () => !!cleared && performance.now() < cleared.until && bank.strings.length === 0;
function clearStrings(how = '') {
  interaction.reset();
  const n = bank.strings.length;
  if (!n) return;
  cleared = { strings: bank.strings.slice(), until: performance.now() + RESTORE_MS };
  bank.clear();
  ui.toast(`${how}Cleared ${n} string${n > 1 ? 's' : ''}. Undo brings ${n > 1 ? 'them' : 'it'} back.`, 2600);
}
function undoOne() {
  if (canRestore()) {
    bank.strings = cleared.strings; cleared = null;
    ui.toast('Strings back');
  } else if (bank.undo()) ui.toast('Removed last string');
}
lessons = createStringLessons({ app, bank, interaction, ui });

if (app.mouseMode) {
  document.getElementById('startNote').textContent = 'Mouse mode: no camera needed. Drag in empty space to draw strings.';
  document.getElementById('startMouse').hidden = true;
}

// ---------------- Boot ----------------
async function start(forceMouse) {
  if (forceMouse) app.mouseMode = true;
  try {
    const m = await synth.start();
    if (m === 'buffer') console.info('Using buffer-based synthesis');
  } catch (err) {
    console.error(err);
    ui.toast('Audio could not start: ' + err.message, 4000);
  }
  app.started = true;
  ui.showApp();
  ui.setMouseMode(app.mouseMode);
  if (app.mouseMode) ui.setStatus('Mouse mode', 'live');
  else await startCamera();
}

async function startCamera() {
  ui.setStatus('Asking for camera…', 'warn');
  try {
    await openCamera(video);
    // The camera prompt can pause audio on iOS; try to bring it back.
    synth.unlock();
    app.cameraOn = true;
    app.mouseMode = false;
    ui.setMouseMode(false);
    ui.hideCameraError();
  } catch (err) {
    console.warn(err);
    app.mouseMode = true;
    ui.setMouseMode(true);
    ui.setStatus('Mouse mode (no camera)', 'warn');
    ui.showCameraError(err.userMessage || err.message, startCamera);
    return;
  }
  if (!app.trackerReady) {
    try {
      const delegate = await tracker.init((s) => ui.setStatus(s, 'warn'));
      app.trackerReady = true;
      app.delegate = delegate;
    } catch (err) {
      console.error(err);
      ui.setStatus('Hand tracker failed to load', 'warn');
      ui.showCameraError('The hand-tracking model could not load (' + (err.message || err) + '). Check your connection and try again.', startCamera);
      app.mouseMode = true;
      ui.setMouseMode(true);
      return;
    }
  }
  ui.setStatus('Show your hand to the camera', 'live');
}

document.getElementById('soundBanner').addEventListener('click', () => synth.unlock());

const startBtn = document.getElementById('startBtn');
startBtn.addEventListener('click', () => { startBtn.disabled = true; start(false); });
document.getElementById('startMouse').addEventListener('click', () => start(true));

// ---------------- Layout ----------------
function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = window.innerWidth, H = window.innerHeight;
  bank.resize(app.W, app.H, W, H);
  app.W = W; app.H = H; app.dpr = dpr;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  if (lessons) lessons.resize();
}
window.addEventListener('resize', resize);
resize();

// ---------------- Loop ----------------
let lastT = performance.now();
let detectCount = 0, detectWindow = performance.now();

function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  const { W, H } = app;

  let pointers = mouse.update();
  if (app.cameraOn && app.trackerReady && !app.mouseMode) {
    let detections = null;
    try { detections = tracker.detect(video, now); } catch (err) { console.warn('detect failed', err); }
    if (detections) {
      detectCount++;
      app.handCount = detections.length;
    }
    pointers = pointers.concat(hands.update(detections, video, W, H, now));
    if (now - detectWindow > 1000) {
      app.detectFps = Math.round((detectCount * 1000) / (now - detectWindow));
      detectCount = 0; detectWindow = now;
      const n = app.handCount;
      ui.setStatus(n ? `Tracking ${n} hand${n > 1 ? 's' : ''} · ${app.detectFps} fps · ${app.delegate}` : 'Show your hand to the camera', 'live');
      if (face.guard(app.detectFps)) { refreshFaceLabels(); ui.toast('Face control turned off: hand tracking got too slow on this device.', 3600); }
    }
    readFace(now);
  }
  app.pointers = pointers;
  watchSigns(pointers, now);

  interaction.update(pointers, W, H, now);
  bank.update(dt, synth.mod.sustain);
  lessons.frame();
  ui.setCoach(lessons.active ? lessons.coach() : coach(now));
  ui.setSoundPaused(app.started && synth.needsUnlock);
  render(pointers, now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Step-by-step coaching: draw -> pluck -> strum, then get out of the way.
function coach(now) {
  if (!app.started || ui.hintOpen) return null;
  if (app.pointers.some((p) => p.pinching)) return null; // don't talk while they're doing it
  const hand = !app.mouseMode;
  if (bank.strings.length === 0) {
    return { step: 1, text: hand
      ? 'Pinch in empty space and hold until the ring fills, then drag and let go to draw a string.'
      : 'Drag in empty space to draw a string.' };
  }
  if (!app.plucked) {
    return { step: 2, text: hand
      ? 'Now pinch the string, pull it sideways, and let go to play it.'
      : 'Now drag the string sideways and let go to play it.' };
  }
  if (!app.strummed && now < app.strumTipUntil) {
    return { step: 3, text: hand
      ? 'Swipe an open hand fast across strings to strum (no pinch). Draw more for more notes.'
      : 'Flick fast across strings to strum. Draw more for more notes.' };
  }
  return null;
}

// ---------------- Hand signs ----------------
// Hold a shape for a moment: fist mutes, thumbs up says yes, thumbs down goes
// back, victory switches instrument, "I love you" throws confetti.
const SCALES = ['off', 'chromatic', 'pentatonic'];
function canSign(name) {
  if (!app.started || ui.hintOpen) return false;
  const free = !lessons.active;
  switch (name) {
    case 'Closed_Fist': return bank.ringing;
    case 'Thumb_Up': return lessons.sign(name, true);
    case 'Thumb_Down': return free ? bank.strings.length > 0 || canRestore() : lessons.sign(name, true);
    case 'Rock_Horns': return free; // next Snap scale
    case 'Call_Me': return true; // Face on/off
    case 'Three_Fingers': return lessons.sign(name, true); // Listen
    case 'Wave': // goodbye: leave the lesson, or clear the strings (not if that hand was strumming)
      if (performance.now() - (app.lastPlayT || 0) < 1200) return false;
      return free ? bank.strings.length > 0 : lessons.sign(name, true);
    case 'Both_Thumbs_Up': return lessons.sign(name, true);
    case 'Both_Fists': return free ? bank.strings.length > 0 : lessons.sign(name, true);
    default: return true; // Victory, ILoveYou
  }
}
function runSign(name) {
  const free = !lessons.active;
  if (name === 'Closed_Fist') { synth.stopAll(); bank.damp(); }
  else if (name === 'Thumb_Up' || name === 'Three_Fingers' || name === 'Both_Thumbs_Up') lessons.sign(name);
  else if (name === 'Thumb_Down') {
    if (!free) lessons.sign(name);
    else undoOne();
  } else if (name === 'Rock_Horns') setScale(SCALES[(SCALES.indexOf(bank.scale) + 1) % SCALES.length]);
  else if (name === 'Call_Me') setFace(!face.on);
  else if (name === 'Wave') { if (free) clearStrings('👋 '); else { lessons.sign(name); ui.toast('👋 Back to free play'); } }
  else if (name === 'Both_Fists') {
    if (free) { synth.stopAll(); clearStrings('✊✊ '); } else lessons.sign(name);
  } else if (name === 'Victory') {
    ui.toast('Off to the theremin…', 1200);
    setTimeout(() => { location.href = 'theremin.html'; }, 450);
  } else if (name === 'ILoveYou') lessons.confetti();
}
function watchSigns(pointers, now) {
  if (!app.signsOn || app.mouseMode) { app.signRings = []; return; }
  const r = signs.update(pointers, now, canSign);
  app.signRings = r.rings;
  for (const f of r.fired) runSign(f.name);
}
function setSigns(on) {
  app.signsOn = on;
  setSignsEnabled(on);
  signs.reset();
  const v = document.getElementById('signsVal');
  if (v) v.textContent = on ? 'On' : 'Off';
}
document.getElementById('signsBtn')?.addEventListener('click', () => setSigns(!app.signsOn));
setSigns(app.signsOn);

// ---------------- Face control ----------------
// Mouth open = notes ring longer; eyebrows up = an octave higher (free play only).
const FACE_MAX_SUSTAIN = 2.5;
async function setFace(on) {
  if (on && (!app.cameraOn || app.mouseMode)) { ui.toast('Face control needs the camera.', 2200); return; }
  if (on && !face.on) document.getElementById('faceVal2').textContent = '…';
  const r = await face.set(on, { detectFps: app.detectFps, onStatus: (s) => ui.setStatus(s, 'warn') });
  if (r === 'failed') ui.toast('The face tracker could not load. Check your connection and try again.', 3000);
  else if (r === 'on') ui.toast('Relax your face for a moment…', 1600);
  refreshFaceLabels();
}
function refreshFaceLabels() {
  const v = face.on ? 'On' : 'Off', b = document.getElementById('faceBtn');
  document.getElementById('faceVal2').textContent = v;
  if (b) {
    b.classList.toggle('on', face.on);
    b.setAttribute('aria-pressed', String(face.on));
    b.title = `Face control is ${v.toLowerCase()}: mouth for longer notes, eyebrows for an octave (F)`;
  }
  if (!face.on) synth.mod = { sustain: 1, octave: false };
}
function readFace(now) {
  if (!face.on) return;
  const { active, justReady } = face.read(video, now);
  if (justReady) ui.toast(lessons.active
    ? 'Face on: open your mouth to let notes ring longer.'
    : 'Face on: open your mouth to let notes ring longer, raise your eyebrows for an octave up.', 3200);
  const c = face.ctl;
  synth.mod = active
    ? { sustain: 1 + (FACE_MAX_SUSTAIN - 1) * c.mouth, octave: c.brows && !lessons.active }
    : { sustain: 1, octave: false };
}
document.getElementById('faceBtn')?.addEventListener('click', () => setFace(!face.on));
document.getElementById('faceBtn2')?.addEventListener('click', () => setFace(!face.on));
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.tagName === 'INPUT' || !app.started) return;
  if (e.key.toLowerCase() === 'f') { setFace(!face.on); e.preventDefault(); }
});
/** The face badge sits bottom-right, just above the coach line. */
function faceBadgePos() {
  const c = document.getElementById('coach');
  const top = c && !c.hidden ? c.getBoundingClientRect().top : app.H - 16;
  return [app.W - 52, Math.min(app.H - 74, top - 64)];
}

// ---------------- Render ----------------
function render(pointers, now) {
  const { W, H, dpr } = app;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  lessons.drawUnder(ctx, now);
  bank.draw(ctx);
  for (const p of interaction.previews) drawPreview(p);
  lessons.drawOver(ctx, now);
  for (const p of pointers) drawPointer(p);
  drawSignRings(ctx, app.signRings);
  if (face.on) { const [x, y] = faceBadgePos(); drawFaceBadge(ctx, x, y, face.ctl, now); }
}

function drawPreview(p) {
  ctx.save();
  ctx.setLineDash([8, 8]);
  ctx.lineCap = 'round';
  ctx.strokeStyle = p.match ? 'rgba(125, 255, 176, 0.95)' : p.ok ? 'rgba(220, 200, 255, 0.9)' : 'rgba(255, 140, 150, 0.7)';
  ctx.lineWidth = 2.5;
  ctx.shadowColor = 'rgba(180,140,255,0.8)';
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(p.ax, p.ay);
  ctx.lineTo(p.bx, p.by);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#e9ddff';
  ctx.beginPath(); ctx.arc(p.ax, p.ay, 5, 0, Math.PI * 2); ctx.fill();
  if (p.ok) {
    ctx.font = '600 13px ui-rounded, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const x = (p.ax + p.bx) / 2, y = (p.ay + p.by) / 2 - 24;
    const w = ctx.measureText(p.note).width + 14;
    ctx.fillStyle = 'rgba(8,10,18,0.7)';
    roundRect(ctx, x - w / 2, y - 11, w, 22, 11); ctx.fill();
    ctx.fillStyle = p.match ? '#b9ffd6' : '#e9ddff';
    ctx.fillText(p.note, x, y + 0.5);
  }
  ctx.restore();
}

function drawPointer(p) {
  if (p.hidden || p.lost) return;
  ctx.save();
  const on = p.pinching;
  const col = on ? '#5be3a1' : '#ffffff';
  if (p.source === 'hand') {
    // Line between thumb and index tips, tightening into a ring when pinched.
    ctx.strokeStyle = on ? 'rgba(91,227,161,0.9)' : 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(p.thumbX, p.thumbY); ctx.lineTo(p.tipX, p.tipY); ctx.stroke();
    for (const [x, y, r] of [[p.thumbX, p.thumbY, 6], [p.tipX, p.tipY, 7]]) {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = col; ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1;
    }
  }
  ctx.beginPath();
  ctx.arc(p.x, p.y, on ? 12 : 9, 0, Math.PI * 2);
  ctx.strokeStyle = col;
  ctx.lineWidth = 2;
  ctx.shadowColor = col; ctx.shadowBlur = on ? 14 : 6;
  ctx.stroke();
  if (on) { ctx.fillStyle = 'rgba(91,227,161,0.25)'; ctx.fill(); }
  ctx.shadowBlur = 0;
  if (on && p.source === 'hand') {
    // Draw feedback: a ring fills while a pinch in empty space arms a draw.
    const { action, arm } = interaction.pointerStatus(p.id);
    if (action === 'pendingDraw' || action === 'drawing') {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 20, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * arm);
      ctx.strokeStyle = '#cdb4ff';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.stroke();
    } else if (action === 'ignoredPinch' || action === 'strummed') {
      // Fingers touched mid-swipe: treated as a strum, not a draw.
      ctx.beginPath();
      ctx.arc(p.x, p.y, 20, 0, Math.PI * 2);
      ctx.setLineDash([3, 5]);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
  ctx.restore();
}

// Debug handle (used for automated checks; harmless otherwise).
window.airStrings = { app, bank, synth, interaction, tracker, start, lessons, signs, setSigns, face, setFace };
