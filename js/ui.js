// DOM wiring: toolbar, keyboard shortcuts, toasts, hints, status.

const $ = (id) => document.getElementById(id);

export class UI {
  constructor({ onUndo, onClear, onScale, onVolume }) {
    this.handlers = { onUndo, onClear, onScale, onVolume };
    this.toastTimer = null;

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
      if (k === 'z') { onUndo(); e.preventDefault(); }
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

  /** Bottom coaching line: { step, text } or null to hide. */
  setCoach(coach) {
    const key = coach ? coach.step + coach.text : '';
    if (key === this.coachKey) return;
    this.coachKey = key;
    $('coach').hidden = !coach;
    if (!coach) return;
    $('coachStep').textContent = coach.step;
    $('coachText').textContent = coach.text;
    if (coach.quiet) return; // lesson text changes often: don't re-animate
    // Restart the entrance animation for each new step.
    const el = $('coach'); el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  }

  get hintOpen() { return !$('hint').hidden; }

  toast(text, ms = 1800) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  toggleHint() { $('hint').hidden ? ($('hint').hidden = false) : this.hideHint(); }
  hideHint() { $('hint').hidden = true; }

  showCameraError(message, onRetry) {
    $('camErrorText').textContent = message;
    $('camError').hidden = false;
    $('retryCam').onclick = () => { $('camError').hidden = true; onRetry(); };
    $('dismissErr').onclick = () => { $('camError').hidden = true; };
  }
  hideCameraError() { $('camError').hidden = true; }
}
