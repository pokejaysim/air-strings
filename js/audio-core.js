// Shared Web Audio plumbing for every instrument on the site:
//   - creating the AudioContext inside the user's tap (autoplay rules)
//   - iOS: "playback" audio session (silent switch), resume on any tap, never
//     block startup on resume()
//   - master volume -> small generated room reverb -> limiter -> speakers
// Instruments extend AudioCore and build their voices in setup(ctx, input).

export class AudioCore {
  constructor({ volume = 0.8, reverb = 0.18 } = {}) {
    this.ctx = null;
    this.volume = volume;
    this.reverbAmount = reverb;
    this.silentEl = null;
    this.mode = 'none';
  }

  /** True when audio was started but the browser has paused it (iOS does this a lot). */
  get needsUnlock() {
    return !!this.ctx && this.ctx.state !== 'running' && this.ctx.state !== 'closed';
  }

  get running() { return !!this.ctx && this.ctx.state === 'running'; }

  /** A short metronome click (count-ins). `accent` marks the first beat. */
  tick(accent = false) {
    if (!this.running || !this.master) return false;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = accent ? 1760 : 1318.5;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.12);
    return true;
  }

  /**
   * Try to (re)start audio. Only works reliably inside a real user gesture
   * (tap, click, key) on iOS; elsewhere it's a harmless no-op.
   */
  unlock() {
    if (!this.ctx) return;
    if (this.silentEl && this.silentEl.paused && !document.hidden) this.silentEl.play().catch(() => {});
    if (this.ctx.state !== 'running' && this.ctx.state !== 'closed') this.ctx.resume().catch(() => {});
  }

  /** Must be called from a user gesture (autoplay rules). */
  async start() {
    if (this.ctx) { this.unlock(); return this.mode; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('Web Audio is not supported in this browser.');
    // iOS: ask for "playback" audio so the ring/silent switch doesn't mute us.
    const hasSessionApi = preferPlaybackSession();
    const ctx = new Ctx({ latencyHint: 'interactive' });
    this.ctx = ctx;
    // Everything below up to the first await runs inside the user's tap.
    if (!hasSessionApi && isIOS()) this.silentEl = startSilentLoop();
    const resumed = ctx.resume().catch(() => {});
    this.installUnlockListeners();

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;

    // Gentle room reverb from a generated impulse response.
    this.wet = ctx.createGain();
    this.wet.gain.value = this.reverbAmount;
    const verb = ctx.createConvolver();
    verb.buffer = makeImpulse(ctx, 1.6);
    const dry = ctx.createGain();
    dry.gain.value = 1;

    // Brick-wall-ish limiter so loud moments don't clip.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 4;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.2;

    this.master.connect(dry).connect(limiter);
    this.master.connect(verb).connect(this.wet).connect(limiter);
    limiter.connect(ctx.destination);
    this.output = limiter;
    this.input = this.master;

    this.mode = (await this.setup(ctx, this.input)) || 'ready';
    // Don't block on resume(): on iOS it can stay pending for as long as audio
    // is interrupted (e.g. while the camera permission prompt is showing).
    await Promise.race([resumed, new Promise((r) => setTimeout(r, 300))]);
    return this.mode;
  }

  /** Override: build the instrument's nodes, connected into `input`. Return a mode label. */
  async setup(ctx, input) { return 'ready'; }

  installUnlockListeners() {
    const unlock = () => this.unlock();
    // iOS counts touchend/click (not touchstart) as a user gesture.
    for (const type of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) {
      window.addEventListener(type, unlock, { capture: true, passive: true });
    }
    window.addEventListener('pageshow', unlock);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.silentEl?.pause();
      else this.unlock();
    });
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  setReverb(v) {
    this.reverbAmount = v;
    if (this.wet) this.wet.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }
}

export function isIOS() {
  const ua = navigator.userAgent || '';
  return /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Audio Session API (Safari 16.4+): treat us like a music app, not UI sounds. */
function preferPlaybackSession() {
  try {
    if (navigator.audioSession) {
      navigator.audioSession.type = 'playback';
      return true;
    }
  } catch { /* not supported */ }
  return false;
}

/**
 * Older iOS: playing a (silent) HTML media element moves the page into the
 * "playback" audio category, so Web Audio is heard even on silent mode.
 * Must be started inside a user gesture.
 */
function startSilentLoop() {
  const rate = 8000, n = rate / 4; // 0.25 s of 16-bit mono silence
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true);
  v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  const el = document.createElement('audio');
  el.src = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  el.loop = true;
  el.preload = 'auto';
  el.setAttribute('playsinline', '');
  el.setAttribute('x-webkit-airplay', 'deny');
  el.disableRemotePlayback = true;
  el.play().catch(() => {});
  return el;
}

export function makeImpulse(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) * (i < 40 ? i / 40 : 1);
    }
  }
  return ir;
}
