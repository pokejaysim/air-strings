// MediaPipe Hand Landmarker wrapper (pinned version, official CDN + model).

export const MP_VERSION = '1.2.2';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export class HandTracker {
  constructor() {
    this.landmarker = null;
    this.delegate = null;
    this.lastVideoTime = -1;
  }

  async init(onStatus = () => {}) {
    onStatus('Loading hand tracker…');
    const { FilesetResolver, HandLandmarker } = await import(`${MP_BASE}/vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, options('GPU'));
      this.delegate = 'GPU';
    } catch (err) {
      console.warn('GPU delegate failed, falling back to CPU:', err);
      onStatus('GPU unavailable, using CPU…');
      this.landmarker = await HandLandmarker.createFromOptions(fileset, options('CPU'));
      this.delegate = 'CPU';
    }
    return this.delegate;
  }

  /**
   * Returns null when there is no new video frame, otherwise an array of
   * { landmarks: [{x,y,z}] (normalized video coords), handedness, score }.
   */
  detect(video, nowMs) {
    if (!this.landmarker || video.readyState < 2) return null;
    if (video.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = video.currentTime;
    const res = this.landmarker.detectForVideo(video, nowMs);
    const hands = [];
    for (let i = 0; i < res.landmarks.length; i++) {
      const cat = res.handedness?.[i]?.[0] || res.handednesses?.[i]?.[0];
      hands.push({
        landmarks: res.landmarks[i],
        handedness: cat?.categoryName || `hand${i}`,
        score: cat?.score ?? 1,
      });
    }
    return hands;
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
