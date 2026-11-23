// Air Strings — app bootstrap and main loop.

import { StringSynth } from './audio.js';
import { HandTracker, openCamera } from './tracking.js';
import { HandGestures, PointerGestures } from './gestures.js';
import { StringBank, roundRect } from './strings.js';
import { Interaction } from './interaction.js';
import { UI } from './ui.js';

const params = new URLSearchParams(location.search);
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const synth = new StringSynth();
const bank = new StringBank();
const tracker = new HandTracker();
const hands = new HandGestures();
const mouse = new PointerGestures(canvas);

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
};

let ui; // assigned below
const interaction = new Interaction({
  bank, synth,
  onEvent(ev) {
    if (ev.type === 'pluck' || ev.type === 'strum') {
      if (!app.plucked) app.strumTipUntil = performance.now() + 6000;
      app.plucked = true;
      if (ev.type === 'strum') app.strummed = true;
    } else if (ev.type === 'tooShort') ui.toast('Too short. Drag a longer string.');
    else if (ev.type === 'tooMany') ui.toast('That’s plenty of strings! Undo or clear some.');
  },
});

ui = new UI({
  onUndo() { if (bank.undo()) ui.toast('Removed last string'); },
  onClear() { interaction.reset(); const n = bank.clear(); if (n) ui.toast(`Cleared ${n} string${n > 1 ? 's' : ''}`); },
  onScale(s) {
    bank.setScale(s);
    ui.setScale(s);
    ui.toast({ off: 'Snap off: exact pitch from length', chromatic: 'Snap: chromatic', pentatonic: 'Snap: E major pentatonic' }[s]);
  },
  onVolume(v) { synth.setVolume(v); },
});
ui.setScale(bank.scale);

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
    }
  }
  app.pointers = pointers;

  interaction.update(pointers, W, H, now);
  bank.update(dt);
  ui.setCoach(coach(now));
  ui.setSoundPaused(app.started && synth.needsUnlock);
  render(pointers);
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
      ? 'Pinch thumb and index in empty space, drag, and let go to draw a string.'
      : 'Drag in empty space to draw a string.' };
  }
  if (!app.plucked) {
    return { step: 2, text: hand
      ? 'Now pinch the string, pull it sideways, and let go to play it.'
      : 'Now drag the string sideways and let go to play it.' };
  }
  if (!app.strummed && now < app.strumTipUntil) {
    return { step: 3, text: hand
      ? 'Swipe your fingertip fast across strings to strum. Draw more for more notes.'
      : 'Flick fast across strings to strum. Draw more for more notes.' };
  }
  return null;
}

// ---------------- Render ----------------
function render(pointers) {
  const { W, H, dpr } = app;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  bank.draw(ctx);
  for (const p of interaction.previews) drawPreview(p);
  for (const p of pointers) drawPointer(p);
}

function drawPreview(p) {
  ctx.save();
  ctx.setLineDash([8, 8]);
  ctx.lineCap = 'round';
  ctx.strokeStyle = p.ok ? 'rgba(220, 200, 255, 0.9)' : 'rgba(255, 140, 150, 0.7)';
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
    ctx.fillStyle = '#e9ddff';
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
  ctx.restore();
}

// Debug handle (used for automated checks; harmless otherwise).
window.airStrings = { app, bank, synth, interaction, tracker, start };
