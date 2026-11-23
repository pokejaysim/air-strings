// DOM wiring: toolbar, keyboard shortcuts, toasts, hints, status.

const $ = (id) => document.getElementById(id);
const HINT_KEY = 'airstrings.hintSeen.v1';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

export class UI {
  constructor({ onMode, onUndo, onClear, onScale, onVolume }) {
    this.handlers = { onMode, onUndo, onClear, onScale, onVolume };
    this.toastTimer = null;

    $('modeDraw').addEventListener('click', () => onMode('draw'));
    $('modePlay').addEventListener('click', () => onMode('play'));
    $('undo').addEventListener('click', () => onUndo());
    $('clear').addEventListener('click', () => onClear());
    $('help').addEventListener('click', () => this.toggleHint());
    $('hintOk').addEventListener('click', () => this.hideHint());
    for (const b of document.querySelectorAll('[data-scale]')) {
      b.addEventListener('click', () => onScale(b.dataset.scale));
    }
    $('volume').addEventListener('input', (e) => onVolume(parseFloat(e.target.value)));
    for (const b of document.querySelectorAll('.toolbar button')) {
      b.addEventListener('click', () => { b.classList.remove('pressed'); void b.offsetWidth; b.classList.add('pressed'); });
    }

    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.target.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === 'm') { onMode('toggle'); e.preventDefault(); }
      else if (k === 'z') { onUndo(); e.preventDefault(); }
      else if (k === 'c') { onClear(); e.preventDefault(); }
      else if (k === 'h' || k === '?') { this.toggleHint(); e.preventDefault(); }
      else if (k === 'escape') this.hideHint();
    });
  }

  showApp() {
    $('start').hidden = true;
    $('toolbar').hidden = false;
    $('status').hidden = false;
  }

  setMode(mode) {
    $('modeDraw').classList.toggle('active', mode === 'draw');
    $('modePlay').classList.toggle('active', mode === 'play');
    document.body.classList.toggle('mode-draw', mode === 'draw');
    document.body.classList.toggle('mode-play', mode === 'play');
  }

  setScale(scale) {
    for (const b of document.querySelectorAll('[data-scale]')) b.classList.toggle('active', b.dataset.scale === scale);
  }

  setMouseMode(on) { document.body.classList.toggle('mouse-mode', on); }

  setStatus(text, kind = '') {
    $('statusText').textContent = text;
    $('status').className = 'status' + (kind ? ' ' + kind : '');
  }

  setSoundPaused(paused) {
    if (this.soundPaused === paused) return;
    this.soundPaused = paused;
    $('soundBanner').hidden = !paused;
  }

  setEmpty(text) {
    $('empty').hidden = !text;
    $('empty').textContent = text || '';
  }

  toast(text, ms = 1800) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  maybeShowHint() { if (!store.get(HINT_KEY)) $('hint').hidden = false; }
  toggleHint() { $('hint').hidden ? ($('hint').hidden = false) : this.hideHint(); }
  hideHint() { $('hint').hidden = true; store.set(HINT_KEY, '1'); }

  showCameraError(message, onRetry) {
    $('camErrorText').textContent = message;
    $('camError').hidden = false;
    $('retryCam').onclick = () => { $('camError').hidden = true; onRetry(); };
    $('dismissErr').onclick = () => { $('camError').hidden = true; };
  }
  hideCameraError() { $('camError').hidden = true; }
}
