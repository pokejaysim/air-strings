// Air Theremin — boot, frame loop and rendering.

import { ThereminSynth, VOICES } from './theremin-synth.js';
import { HandTracker, openCamera } from './tracking.js';
import { HandGestures, PointerGestures } from './gestures.js';
import {
  layoutFor, assignRoles, readTheremin, scaleNotes, midiToAxis, axisToScreen,
  pitchAxisPos, volumeHeight, THEREMIN_SCALES, VOLUME_FLOOR, MIDI_LOW, MIDI_HIGH,
} from './theremin-map.js';
import { midiToFreq, noteName } from './pitch.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const video = $('video');
const canvas = $('canvas');
const ctx = canvas.getContext('2d');

const synth = new ThereminSynth();
const tracker = new HandTracker();
const hands = new HandGestures();
const mouse = new PointerGestures(canvas);

const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const settings = {
  assist: store.get('theremin.assist', 'gentle'),
  voice: store.get('theremin.voice', 'classic'),
  scale: store.get('theremin.scale', 'pentatonic'),
};
if (!['off', 'gentle', 'snap'].includes(settings.assist)) settings.assist = 'gentle';
if (!VOICES[settings.voice]) settings.voice = 'classic';
if (!THEREMIN_SCALES[settings.scale]) settings.scale = 'pentatonic';

const GLIDE = { off: 0.012, gentle: 0.02, snap: 0.045 };

const app = {
  mouseMode: params.get('mouse') === '1',
  started: false,
  cameraOn: false,
  trackerReady: false,
  W: 0, H: 0, dpr: 1,
  layout: null,
  roles: { pitch: null, volume: null },
  prevRoles: {},
  reading: null,
  trail: [],
  everPlayed: false,
  everVolume: false,
  bothSince: 0,
  handCount: 0,
  detectFps: 0,
  delegate: '',
};

// ---------------- Controls ----------------
const ASSIST_LABEL = { off: 'Off', gentle: 'Gentle', snap: 'Snap' };
function setAssist(a) {
  settings.assist = a; store.set('theremin.assist', a);
  $('assistVal').textContent = ASSIST_LABEL[a];
}
function setVoice(v) {
  settings.voice = v; store.set('theremin.voice', v);
  synth.setVoice(v);
  $('voiceVal').textContent = VOICES[v].label;
}
function setScale(s) {
  settings.scale = s; store.set('theremin.scale', s);
  $('scaleVal').textContent = THEREMIN_SCALES[s].label;
}
const cycle = (list, cur) => list[(list.indexOf(cur) + 1) % list.length];

const cycleAssist = () => setAssist(cycle(['off', 'gentle', 'snap'], settings.assist));
const cycleVoice = () => setVoice(cycle(Object.keys(VOICES), settings.voice));
const cycleScale = () => setScale(cycle(Object.keys(THEREMIN_SCALES), settings.scale));
$('assistBtn').addEventListener('click', cycleAssist);
$('voiceBtn').addEventListener('click', cycleVoice);
$('scaleBtn').addEventListener('click', cycleScale);
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
  if (k === 'a') cycleAssist();
  else if (k === 'v') cycleVoice();
  else if (k === 's') cycleScale();
  else if (k === 'h' || k === '?') $('hint').hidden = !$('hint').hidden;
  else if (k === 'escape') $('hint').hidden = true;
  else return;
  e.preventDefault();
});
setAssist(settings.assist); setVoice(settings.voice); setScale(settings.scale);

let toastTimer;
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
  $('coachStep').textContent = c.step; $('coachText').textContent = c.text;
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
  const top = tb.hidden ? 16 : tb.getBoundingClientRect().bottom + 10;
  app.layout = layoutFor(app.W, app.H, { top, bottom: 56 });
  for (const el of document.querySelectorAll('.axis-word')) el.textContent = app.layout.landscape ? 'left–right' : 'up–down';
}
window.addEventListener('resize', resize);
// The toolbar can wrap differently as labels change; keep the play area in sync.
if (window.ResizeObserver) new ResizeObserver(() => resize()).observe($('toolbar'));
window.addEventListener('orientationchange', () => setTimeout(resize, 200));
resize();

// ---------------- Loop ----------------
let lastT = performance.now();
let detectCount = 0, detectWindow = performance.now();

function frame(now) {
  lastT = now;
  if (window.innerWidth !== app.W || window.innerHeight !== app.H) resize();
  const L = app.layout;

  // Mouse / touch: only pressed pointers play.
  const ptrs = mouse.update().filter((p) => p.pinching);
  let handPtrs = [];
  if (app.cameraOn && app.trackerReady && !app.mouseMode) {
    let det = null;
    try { det = tracker.detect(video, now); } catch (err) { console.warn('detect failed', err); }
    if (det) { detectCount++; app.handCount = det.length; }
    handPtrs = hands.update(det, video, app.W, app.H, now).filter((p) => !p.lost);
    if (now - detectWindow > 1000) {
      app.detectFps = Math.round((detectCount * 1000) / (now - detectWindow));
      detectCount = 0; detectWindow = now;
      const n = app.handCount;
      setStatus(n ? `Tracking ${n} hand${n > 1 ? 's' : ''} · ${app.detectFps} fps · ${app.delegate}` : 'Show your hands to the camera', 'live');
    }
    // A pinch over a toolbar button presses it.
    for (const p of handPtrs) {
      if (!p.pinchStarted) continue;
      const el = document.elementFromPoint(p.x, p.y);
      const btn = el && el.closest('button:not([disabled]), a[href]');
      if (btn && btn.closest('.toolbar, .hint, .banner, .sound-banner')) btn.click();
    }
  }
  app.handPtrs = handPtrs;

  // Playing points: hands use the palm (steady while pinching); hands raised
  // up into the toolbar don't play.
  const points = [
    ...handPtrs.map((p) => ({ id: p.id, x: p.palmX ?? p.x, y: p.palmY ?? p.y, source: 'hand' })),
    ...ptrs.map((p) => ({ id: p.id, x: p.x, y: p.y, source: 'mouse' })),
  ].filter((p) => p.y >= L.pitch.y - 4);

  app.roles = assignRoles(points, L, app.prevRoles);
  app.prevRoles = { pitchId: app.roles.pitch?.id, volumeId: app.roles.volume?.id };
  const r = readTheremin(app.roles, L, settings);
  app.reading = r;
  synth.update(r, GLIDE[settings.assist]);

  if (r.sounding) {
    app.everPlayed = true;
    if (app.roles.volume) app.everVolume = true;
    const c = axisToScreen(midiToAxis(r.midi), L);
    const hp = app.roles.pitch;
    app.trail.push({ x: L.axis === 'x' ? c : hp.x, y: L.axis === 'x' ? hp.y : c, hue: hueFor(r.midi), a: r.level, t: now });
  }
  while (app.trail.length && (now - app.trail[0].t > 900 || app.trail.length > 90)) app.trail.shift();
  if (app.roles.pitch && app.roles.volume) { if (!app.bothSince) app.bothSince = now; } else app.bothSince = 0;

  setSoundPaused(app.started && synth.needsUnlock);
  setCoach(coach(now));
  render(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function coach(now) {
  if (!app.started || !$('hint').hidden) return null;
  const hand = !app.mouseMode;
  const L = app.layout;
  const dir = L.landscape ? 'left–right' : 'up–down';
  const { pitch, volume } = app.roles;
  if (!pitch && volume) {
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

// ---------------- Render ----------------
const hueFor = (midi) => 200 - 170 * ((midi - MIDI_LOW) / (MIDI_HIGH - MIDI_LOW)) + (midi < MIDI_LOW ? 0 : 0);

function render(now) {
  const { W, H, dpr } = app;
  const L = app.layout;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!app.started) return;
  const r = app.reading || {};

  drawZones(L, r);
  drawGuides(L, r);
  drawWaveform(L, r);
  drawTrail();
  drawHands(L, r);
}

function drawZones(L, r) {
  const v = L.volume, p = L.pitch;
  ctx.save();
  // Volume zone tint + divider
  ctx.fillStyle = 'rgba(120, 224, 255, 0.035)';
  ctx.fillRect(v.x, v.y, v.w, v.h);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.setLineDash([6, 8]);
  ctx.beginPath(); ctx.moveTo(L.split, v.y); ctx.lineTo(L.split, v.y + v.h); ctx.stroke();
  ctx.setLineDash([]);
  // Silence floor
  const floorY = v.y + v.h * (1 - VOLUME_FLOOR);
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.beginPath(); ctx.moveTo(v.x + 12, floorY); ctx.lineTo(v.x + v.w - 12, floorY); ctx.stroke();
  ctx.font = '600 11px ui-rounded, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(238,241,248,0.45)';
  ctx.textAlign = 'center';
  ctx.fillText('VOLUME', v.x + v.w / 2, v.y + 18);
  ctx.fillText('silent', v.x + v.w / 2, floorY + 16);
  ctx.fillText('PITCH', p.x + p.w / 2, p.y + 18);
  // Volume meter along the divider
  const level = r.sounding ? r.level : (r.levelPreview || 0);
  const mx = L.split - 16, mTop = v.y + 34, mBot = floorY;
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(mx, mBot); ctx.lineTo(mx, mTop); ctx.stroke();
  if (level > 0.001) {
    const grad = ctx.createLinearGradient(0, mBot, 0, mTop);
    grad.addColorStop(0, '#78e0ff'); grad.addColorStop(1, '#d7c4ff');
    ctx.strokeStyle = grad;
    ctx.shadowColor = '#78e0ff'; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.moveTo(mx, mBot); ctx.lineTo(mx, mBot - (mBot - mTop) * level); ctx.stroke();
  }
  ctx.restore();
}

function drawGuides(L, r) {
  const notes = scaleNotes(settings.scale);
  const p = L.pitch;
  ctx.save();
  ctx.font = '600 11px ui-rounded, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cur = r.sounding ? Math.round(r.midi) : null;
  for (const n of notes) {
    const c = axisToScreen(midiToAxis(n), L);
    const name = noteName(midiToFreq(n));
    const isC = n % 12 === 0;
    const sharp = name.includes('#');
    const active = cur === n && (settings.assist !== 'off' || Math.abs(r.midi - n) < 0.15);
    ctx.strokeStyle = active ? `hsla(${hueFor(n)}, 95%, 70%, 0.9)` : `rgba(255,255,255,${isC ? 0.22 : sharp ? 0.06 : 0.11})`;
    ctx.lineWidth = active ? 2 : 1;
    ctx.beginPath();
    if (L.axis === 'x') { ctx.moveTo(c, p.y + 30); ctx.lineTo(c, p.y + p.h); }
    else { ctx.moveTo(p.x, c); ctx.lineTo(p.x + p.w - 34, c); }
    ctx.stroke();
    if (!sharp || settings.scale !== 'chromatic') {
      ctx.fillStyle = active ? `hsl(${hueFor(n)}, 100%, 85%)` : `rgba(238,241,248,${isC ? 0.75 : 0.45})`;
      if (L.axis === 'x') ctx.fillText(name, c, p.y + p.h - 10);
      else { ctx.textAlign = 'right'; ctx.fillText(name, p.x + p.w - 6, c); ctx.textAlign = 'center'; }
    }
  }
  ctx.restore();
}

function drawTrail() {
  const tr = app.trail;
  if (tr.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 1; i < tr.length; i++) {
    const a = tr[i - 1], b = tr[i];
    const k = i / tr.length;
    ctx.strokeStyle = `hsla(${b.hue}, 95%, 65%, ${0.6 * k * (0.3 + 0.7 * b.a)})`;
    ctx.lineWidth = 2 + 10 * k * b.a;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.restore();
}

function drawWaveform(L, r) {
  const wave = synth.waveform();
  if (!wave) return;
  const { W, H } = app;
  const y0 = H - 92, amp = 46;
  // Show ~3 cycles of the current note so the shape is readable.
  const freq = r.sounding ? r.freq : 220;
  const sr = synth.ctx.sampleRate;
  const n = Math.min(wave.length, Math.max(64, Math.round((sr / freq) * 3)));
  // Start at an upward zero crossing so the trace holds still.
  let s0 = 0;
  for (let i = 1; i < wave.length - n; i++) { if (wave[i - 1] < 0 && wave[i] >= 0) { s0 = i; break; } }
  ctx.save();
  ctx.strokeStyle = r.sounding ? `hsla(${hueFor(r.midi)}, 95%, 70%, 0.85)` : 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 2;
  ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = r.sounding ? 12 : 0;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = 24 + (i / (n - 1)) * (W - 48);
    const y = y0 - wave[s0 + i] * amp * 2.2;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawHands(L, r) {
  ctx.save();
  // Fingertip/thumb markers for every tracked hand (so you see what the app sees).
  for (const p of app.handPtrs || []) {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(p.thumbX, p.thumbY); ctx.lineTo(p.tipX, p.tipY); ctx.stroke();
    for (const [x, y] of [[p.thumbX, p.thumbY], [p.tipX, p.tipY]]) {
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fill();
    }
  }
  const { pitch, volume } = app.roles;
  if (volume) {
    ctx.beginPath(); ctx.arc(volume.x, volume.y, 16, 0, Math.PI * 2);
    ctx.strokeStyle = '#78e0ff'; ctx.lineWidth = 2.5; ctx.shadowColor = '#78e0ff'; ctx.shadowBlur = 12; ctx.stroke();
    ctx.shadowBlur = 0;
    label(`${Math.round((r.sounding ? r.level : r.levelPreview || 0) * 100)}%`, volume.x, volume.y - 30, '#bff0ff');
  }
  if (pitch && r.midi != null) {
    const hue = hueFor(r.midi);
    // Where the sound actually is (after assist) vs where the hand is.
    const c = axisToScreen(midiToAxis(r.midi), L);
    ctx.strokeStyle = `hsla(${hue}, 95%, 70%, 0.8)`;
    ctx.lineWidth = 3; ctx.shadowColor = `hsl(${hue}, 95%, 65%)`; ctx.shadowBlur = 16;
    ctx.beginPath();
    if (L.axis === 'x') { ctx.moveTo(c, pitch.y - 40); ctx.lineTo(c, pitch.y + 40); }
    else { ctx.moveTo(pitch.x - 40, c); ctx.lineTo(pitch.x + 40, c); }
    ctx.stroke();
    ctx.beginPath(); ctx.arc(pitch.x, pitch.y, 18, 0, Math.PI * 2);
    ctx.lineWidth = 2.5; ctx.stroke();
    ctx.shadowBlur = 0;
    const cents = settings.assist === 'off' && r.cents ? ` ${r.cents > 0 ? '+' : ''}${r.cents}¢` : '';
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
window.theremin = { app, synth, settings, start, setAssist, setVoice, setScale };
