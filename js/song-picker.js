// The song picker: every lesson song on one screen, with what it teaches and
// the stars you've earned. Shared by Air Strings and the Air Theremin.
// Every choice is a big button, so a pinch can press it.

const stars = (n) => '★'.repeat(n) + `<span class="off">${'★'.repeat(3 - n)}</span>`;
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Index of the song to suggest: the first one without a star, else the current one. */
export function suggestedSong(scores, current) {
  const i = scores.findIndex((s) => s.every((r) => r.stars === 0));
  return i < 0 ? current : i;
}

/**
 * @param songs   the SONGS list
 * @param scores  () => per song, a list of { label, stars } (one per kind of score)
 * @param current () => index of the song now loaded
 * @param onPick  (index) => void
 * @param onOpen / onClose  optional hooks (pause the lesson, etc.)
 */
export function createSongPicker({ songs, scores, current, onPick, onOpen = () => {}, onClose = () => {} }) {
  let el = document.getElementById('songPicker');
  if (!el) {
    el = document.createElement('section');
    el.id = 'songPicker';
    document.body.appendChild(el);
  }
  el.className = 'song-picker';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Pick a song');

  function render() {
    const all = scores(), cur = current(), next = suggestedSong(all, cur);
    const earned = all.reduce((t, s) => t + s.reduce((u, r) => u + r.stars, 0), 0);
    const possible = all.reduce((t, s) => t + s.length * 3, 0);
    el.innerHTML = `
      <div class="panel">
        <header>
          <h2>Pick a song</h2>
          <span class="total" title="Stars earned">★ ${earned}/${possible}</span>
          <button class="close" data-close>Close</button>
        </header>
        <div class="songs">
          ${songs.map((s, i) => `
            <button class="song${i === cur ? ' current' : ''}" data-song="${i}">
              <span class="num">${i + 1}</span>
              <span class="info">
                <span class="title"><span class="full">${esc(s.title)}</span><span class="short">${esc(s.short || s.title)}</span>${i === next && i !== cur ? ' <em class="tag">Next up</em>' : ''}${i === cur ? ' <em class="tag now">Now</em>' : ''}</span>
                <span class="teaches">${esc(s.teaches || '')}</span>
              </span>
              <span class="scores">${all[i].map((r) => `<span class="score">${r.label ? `<span class="lbl">${esc(r.label)}</span>` : ''}<span class="st">${stars(r.stars)}</span></span>`).join('')}</span>
            </button>`).join('')}
        </div>
      </div>`;
  }

  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b && b.dataset.song != null) { close(); onPick(parseInt(b.dataset.song, 10)); }
    else if (b && b.hasAttribute('data-close')) close();
    else if (e.target === el) close(); // tap outside the panel
  });
  window.addEventListener('keydown', (e) => {
    if (!el.hidden && e.key === 'Escape') { close(); e.stopPropagation(); }
  }, true);

  function open() {
    render();
    el.hidden = false;
    const t = document.getElementById('toast');
    if (t) t.classList.remove('show'); // a message shouldn't sit on top of the list
    onOpen();
  }
  function close() { if (el.hidden) return; el.hidden = true; onClose(); }
  return { open, close, get isOpen() { return !el.hidden; }, el };
}
