// Face control: Google's MediaPipe Face Landmarker reads your expression
// (52 "blendshape" scores such as jawOpen and browInnerUp) and FaceControls
// turns them into smooth musical controls, measured from your own resting
// face: mouth open (brighter), lips in an "oo" (darker, hollow), eyebrows
// raised (an octave up) and head tilt (vibrato).

import { loadVision } from './tracking.js';

const FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export const CAL_MS = 1000;        // learn the resting face for this long
export const MOUTH_RANGE = 0.4;    // jawOpen above resting that counts as fully open
export const OO_RANGE = 0.45;      // pucker/funnel above resting that counts as a full "oo"
export const BROW_ON = 0.22;       // eyebrows this far above resting: octave up
export const BROW_OFF = 0.12;      // ...and back below this: octave off
export const TILT_START = 6;       // degrees of head tilt before vibrato starts
export const TILT_FULL = 25;       // degrees for the deepest vibrato
export const LOST_MS = 300;        // no face this long: controls relax to neutral
const SMOOTH_SEC = 0.06;

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** One Face Landmarker result -> { face:false } or { face:true, jaw, pucker, brow, roll }. */
export function parseFace(res) {
  const b = res?.faceBlendshapes?.[0];
  if (!b || !b.categories) return { face: false };
  const s = {};
  for (const c of b.categories) s[c.categoryName] = c.score;
  const g = (n) => s[n] ?? 0;
  const m = res.facialTransformationMatrixes?.[0]?.data;
  // Roll (head tilt toward a shoulder) from the face's rotation matrix.
  const roll = m && m.length >= 16 ? (Math.atan2(m[1], m[0]) * 180) / Math.PI : 0;
  return {
    face: true,
    jaw: g('jawOpen'),
    pucker: Math.max(g('mouthPucker'), g('mouthFunnel')),
    brow: (g('browInnerUp') + (g('browOuterUpLeft') + g('browOuterUpRight')) / 2) / 2,
    roll,
  };
}

/** Turns face readings into smooth controls, relative to your resting face. */
export class FaceControls {
  constructor() { this.reset(); }

  reset() {
    this.cal = { t0: null, n: 0, jaw: 0, pucker: 0, brow: 0, roll: 0 };
    this.base = null;
    this.mouth = 0;   // 0 closed .. 1 wide open
    this.oo = 0;      // 0 .. 1 lips pushed into an "oo"
    this.brows = false;
    this.tilt = 0;    // 0 .. 1 vibrato depth from head tilt
    this.present = false;
    this.lastSeen = -Infinity;
    this.lastT = null;
    this.target = { mouth: 0, oo: 0, tilt: 0 };
  }

  get calibrating() { return !this.base; }
  calProgress(now) { return this.base ? 1 : this.cal.t0 == null ? 0 : clamp01((now - this.cal.t0) / CAL_MS); }

  /** @param sample null (no new camera frame), { face:false } or parseFace output */
  update(sample, now) {
    if (sample && sample.face) {
      this.present = true;
      this.lastSeen = now;
      if (!this.base) {
        const c = this.cal;
        if (c.t0 == null) c.t0 = now;
        c.n++; c.jaw += sample.jaw; c.pucker += sample.pucker; c.brow += sample.brow; c.roll += sample.roll;
        if (now - c.t0 >= CAL_MS && c.n >= 3) {
          this.base = { jaw: c.jaw / c.n, pucker: c.pucker / c.n, brow: c.brow / c.n, roll: c.roll / c.n };
        }
      } else {
        const b = this.base;
        this.target.mouth = clamp01((sample.jaw - b.jaw) / MOUTH_RANGE);
        this.target.oo = clamp01((sample.pucker - b.pucker) / OO_RANGE);
        const lift = sample.brow - b.brow;
        if (!this.brows && lift > BROW_ON) this.brows = true;
        else if (this.brows && lift < BROW_OFF) this.brows = false;
        const deg = Math.abs(sample.roll - b.roll);
        this.target.tilt = clamp01((deg - TILT_START) / (TILT_FULL - TILT_START));
      }
    } else if (sample && !sample.face && this.base == null && this.cal.t0 != null && now - this.lastSeen > LOST_MS) {
      this.cal = { t0: null, n: 0, jaw: 0, pucker: 0, brow: 0, roll: 0 }; // face left mid-calibration: start over
    }
    if (now - this.lastSeen > LOST_MS) {
      this.present = false;
      this.brows = false;
      this.target = { mouth: 0, oo: 0, tilt: 0 };
    }
    const dt = this.lastT == null ? 0 : Math.max(0, (now - this.lastT) / 1000);
    this.lastT = now;
    const k = 1 - Math.exp(-dt / SMOOTH_SEC);
    this.mouth += (this.target.mouth - this.mouth) * k;
    this.oo += (this.target.oo - this.oo) * k;
    this.tilt += (this.target.tilt - this.tilt) * k;
    return this;
  }
}

/** The Face Landmarker itself. Runs on every other camera frame to spare the phone. */
export class FaceTracker {
  constructor() {
    this.landmarker = null;
    this.delegate = null;
    this.lastVideoTime = -1;
    this.frames = 0;
  }

  async init(onStatus = () => {}) {
    if (this.landmarker) return this.delegate;
    onStatus('Loading face tracker…');
    const { lib, fileset } = await loadVision();
    let lastErr = null;
    for (const delegate of ['GPU', 'CPU']) {
      try {
        this.landmarker = await lib.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        });
        this.delegate = delegate;
        return delegate;
      } catch (err) {
        console.warn(`FaceLandmarker (${delegate}) failed:`, err);
        lastErr = err;
      }
    }
    throw lastErr;
  }

  /** null when there's nothing new to read, else parseFace output. */
  detect(video, nowMs) {
    if (!this.landmarker || video.readyState < 2) return null;
    if (video.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = video.currentTime;
    if (this.frames++ % 2) return null; // every other camera frame
    return parseFace(this.landmarker.detectForVideo(video, nowMs));
  }
}

/**
 * A little face that mirrors yours: mouth opens and rounds, eyebrows lift
 * (with an "8va" light), head tilts. While calibrating, a ring fills.
 */
export function drawFaceBadge(ctx, x, y, fc, now) {
  ctx.save();
  ctx.translate(x, y);
  const r = 26;
  ctx.beginPath();
  ctx.arc(0, 0, r + 6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(8,10,18,0.72)';
  ctx.fill();
  if (fc.calibrating) {
    ctx.beginPath();
    ctx.arc(0, 0, r + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * fc.calProgress(now));
    ctx.strokeStyle = '#7df0c0'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.stroke();
  }
  ctx.rotate(((fc.tilt * TILT_FULL) * Math.PI) / 180 * 0.6);
  const on = fc.present;
  const ink = on ? '#e6f8ff' : 'rgba(230,248,255,0.35)';
  ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
  // Eyes
  for (const ex of [-9, 9]) { ctx.beginPath(); ctx.arc(ex, -5, 2.6, 0, Math.PI * 2); ctx.fill(); }
  // Eyebrows
  const by = fc.brows ? -17 : -12;
  ctx.strokeStyle = fc.brows ? '#ffd76a' : ink;
  for (const ex of [-9, 9]) { ctx.beginPath(); ctx.moveTo(ex - 5, by); ctx.lineTo(ex + 5, by); ctx.stroke(); }
  // Mouth: opens with the jaw, narrows into an "oo"
  const w = 10 * (1 - 0.55 * fc.oo), h = 1.5 + 9 * fc.mouth;
  ctx.beginPath();
  ctx.ellipse(0, 11, w, h, 0, 0, Math.PI * 2);
  ctx.fillStyle = on ? `hsla(${190 + 60 * fc.mouth}, 90%, ${55 + 20 * fc.mouth}%, 0.95)` : 'rgba(230,248,255,0.25)';
  ctx.fill();
  ctx.restore();
  // Labels under the face
  ctx.save();
  ctx.font = '800 10px ui-rounded, system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(8,10,18,0.72)';
  const label = fc.calibrating ? (fc.present ? 'RELAX…' : 'FACE?') : !fc.present ? 'NO FACE' : fc.brows ? '8VA ↑' : 'FACE';
  const tw = ctx.measureText(label).width + 12;
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - tw / 2, y + r + 10, tw, 16, 8) : ctx.rect(x - tw / 2, y + r + 10, tw, 16); ctx.fill();
  ctx.fillStyle = fc.brows && !fc.calibrating ? '#ffd76a' : 'rgba(238,241,248,0.8)';
  ctx.fillText(label, x, y + r + 18.5);
  ctx.restore();
}
