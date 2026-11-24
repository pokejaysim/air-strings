// Hand tracking with MediaPipe (pinned version, official CDN + models).
// We use the Gesture Recognizer: the same 21 hand points as the plain Hand
// Landmarker, plus a label for the hand's shape (fist, thumbs up...). If it
// can't load, we fall back to the plain Hand Landmarker (no gesture labels).

export const MP_VERSION = '1.2.2';
export const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const GESTURE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';
const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

let visionPromise = null;
/** The MediaPipe library and its WebAssembly files, loaded once and shared. */
export function loadVision() {
  if (!visionPromise) {
    visionPromise = (async () => {
      const lib = await import(`${MP_BASE}/vision_bundle.mjs`);
      const fileset = await lib.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
      return { lib, fileset };
    })();
    visionPromise.catch(() => { visionPromise = null; });
  }
  return visionPromise;
}

/** Turn one MediaPipe result into our hand list. Exported for tests. */
export function parseHands(res) {
  const hands = [];
  const marks = res?.landmarks || [];
  for (let i = 0; i < marks.length; i++) {
    const cat = res.handedness?.[i]?.[0] || res.handednesses?.[i]?.[0];
    const g = res.gestures?.[i]?.[0];
    hands.push({
      landmarks: marks[i],
      handedness: cat?.categoryName || `hand${i}`,
      score: cat?.score ?? 1,
      gesture: g && g.categoryName && g.categoryName !== 'None' ? { name: g.categoryName, score: g.score ?? 0 } : null,
    });
  }
  return hands;
}

export class HandTracker {
  constructor() {
    this.landmarker = null;
    this.delegate = null;
    this.gestures = false; // true when the Gesture Recognizer loaded
    this.lastVideoTime = -1;
  }

  async init(onStatus = () => {}) {
    onStatus('Loading hand tracker…');
    const { lib, fileset } = await loadVision();
    const options = (model, delegate) => ({
      baseOptions: { modelAssetPath: model, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    const attempts = [
      ['GestureRecognizer', GESTURE_MODEL_URL, 'GPU'],
      ['GestureRecognizer', GESTURE_MODEL_URL, 'CPU'],
      ['HandLandmarker', HAND_MODEL_URL, 'GPU'],
      ['HandLandmarker', HAND_MODEL_URL, 'CPU'],
    ];
    let lastErr = null;
    for (const [kind, url, delegate] of attempts) {
      try {
        if (lastErr) onStatus(delegate === 'CPU' ? 'GPU unavailable, using CPU…' : 'Loading the simpler hand tracker…');
        this.landmarker = await lib[kind].createFromOptions(fileset, options(url, delegate));
        this.kind = kind;
        this.gestures = kind === 'GestureRecognizer';
        this.delegate = delegate;
        return delegate;
      } catch (err) {
        console.warn(`${kind} (${delegate}) failed:`, err);
        lastErr = err;
      }
    }
    throw lastErr;
  }

  /**
   * Returns null when there is no new video frame, otherwise an array of
   * { landmarks: [{x,y,z}] (normalized video coords), handedness, score,
   *   gesture: { name, score } | null }.
   */
  detect(video, nowMs) {
    if (!this.landmarker || video.readyState < 2) return null;
    if (video.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = video.currentTime;
    const res = this.gestures
      ? this.landmarker.recognizeForVideo(video, nowMs)
      : this.landmarker.detectForVideo(video, nowMs);
    return parseHands(res);
  }
}

/** Open the webcam. Throws an Error with a friendly .userMessage on failure. */
export async function openCamera(video) {
  if (!window.isSecureContext) {
    throw friendly('insecure', 'The camera only works over HTTPS or on localhost. Open the GitHub Pages link or run a local server.');
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw friendly('unsupported', 'This browser cannot access a camera.');
  }
  // Retrying: release any camera we already hold before asking again.
  if (video.srcObject) {
    for (const t of video.srcObject.getTracks()) t.stop();
    video.srcObject = null;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
      audio: false,
    });
  } catch (err) {
    const map = {
      NotAllowedError: 'Camera permission was denied. Allow camera access in your browser’s site settings (the icon in the address bar) and reload.',
      SecurityError: 'Camera permission was denied. Allow camera access in your browser’s site settings and reload.',
      NotFoundError: 'No camera was found. Plug one in and reload.',
      OverconstrainedError: 'Your camera does not support the requested settings.',
      NotReadableError: 'The camera is in use by another app. Close it and reload.',
    };
    throw friendly(err.name, map[err.name] || `Could not open the camera (${err.name || err.message}).`);
  }
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  if (!video.videoWidth) await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }));
  return stream;
}

function friendly(code, userMessage) {
  const e = new Error(userMessage);
  e.code = code;
  e.userMessage = userMessage;
  return e;
}
