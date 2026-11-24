// Air Strings lessons: wiring, coaching and drawing. The rules live in
// string-lessons.js (pure, tested); this file connects them to the page.

import { SONGS, buildSong } from './lessons.js';
import { harpSlots, matchSlot, drawFeedback, whiteNoteForLength, StringSongRun } from './string-lessons.js';
import { lengthFraction, midiToFreq, noteName } from './pitch.js';
import { roundRect } from './strings.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const letter = (midi) => noteName(midiToFreq(midi)).replace(/-?\d+$/, '');

export function createStringLessons({ app, bank, interaction, ui }) {
  const L = {
    active: false,
    songIdx: Math.min(SONGS.length - 1, Math.max(0, parseInt(store.get('strings.song', '0'), 10) || 0)),
    step: 'build',          // 'build' | 'play'
    song: null,
    run: null,
    harp: new Map(),        // midi -> AirString; kept between songs, so each song adds to it
    slots: [],
    freeStrings: null,      // the player's own strings, put away during a lesson
    freeSize: null,
    cardShown: false,
    lastHintT: 0,
  };

  // ---------- helpers ----------
  const tol = (source) => {
    const diag = Math.hypot(app.W, app.H);
    return source === 'hand' ? Math.max(30, 0.04 * diag) : Math.max(22, 0.025 * diag);
  };
  const slotFor = (midi) => L.slots.find((s) => s.midi === midi);
  const needed = () => [...new Set(L.song.notes.map((n) => n.midi))].sort((a, b) => a - b);
  const missing = () => needed().filter((m) => !L.harp.has(m));
  const missingSlots = () => missing().map(slotFor).filter(Boolean);
  const bestStars = (id) => Math.min(3, Math.max(0, parseInt(store.get('strings.stars.' + id, '0'), 10) || 0));

  function computeSlots() {
    const tb = $('toolbar').getBoundingClientRect();
    const wide = app.W >= app.H;
    // Leave room for the "next notes" strip under the toolbar and the coach at the bottom.
    L.slots = harpSlots(app.W, app.H, { top: tb.bottom + (wide ? 58 : 86), bottom: wide ? 124 : 176 });
  }
  /** Put every harp string on its slot (after a resize, or when coming back to lessons). */
  function placeHarp() {
    for (const [midi, s] of L.harp) {
      const sl = slotFor(midi);
      if (sl) { s.ax = sl.ax; s.ay = sl.ay; s.bx = sl.bx; s.by = sl.by; }
    }
  }
  function addString(midi, demo) {
    const sl = slotFor(midi);
    const s = bank.addTuned(sl.ax, sl.ay, sl.bx, sl.by, app.W, app.H, midi);
    L.harp.set(midi, s);
    s.glow = 1;
    // Let them hear the note they just made.
    if (demo) interaction.pluck(s, 0.35, 0.55, Math.min(14, sl.len * 0.08), app.W, performance.now(), 'demo');
    return s;
  }
  function refreshLabels() {
    const def = SONGS[L.songIdx], best = bestStars(def.id);
    $('songKey').innerHTML = `Song ${L.songIdx + 1}/${SONGS.length}` + (best ? ` <span class="won">${'★'.repeat(best)}</span>` : '');
    $('songVal').textContent = def.short || def.title;
    $('stepVal').textContent = L.step === 'build' ? '1 · Build' : '2 · Play';
  }

  // ---------- flow ----------
  function setStep(step) {
    L.step = step;
    interaction.allowDraw = step === 'build';
    L.run = step === 'play' ? new StringSongRun(L.song) : null;
    L.cardShown = false;
    $('lessonCard').hidden = true;
    refreshLabels();
  }
  function loadSong() {
    L.song = buildSong(SONGS[L.songIdx]);
    const miss = missing();
    if (miss.length) {
      setStep('build');
      const names = miss.map(letter).join(', ');
      ui.toast(`Song ${L.songIdx + 1}: ${L.song.title}. ${L.harp.size ? 'Add' : 'First draw'} the string${miss.length > 1 ? 's' : ''} it needs: ${names}.`, 3800);
    } else {
      setStep('play');
      ui.toast(`Song ${L.songIdx + 1}: ${L.song.title}. Your harp already has every string it needs.`, 3200);
    }
  }
  function enter() {
    if (L.active) return;
    L.active = true;
    document.body.classList.add('lesson');
    ui.hideHint();
    interaction.reset();
    L.freeStrings = bank.strings;
    L.freeSize = { W: app.W, H: app.H };
    bank.strings = [...L.harp.values()];
    interaction.customAdd = onDraw;
    interaction.previewHook = onPreview;
    computeSlots();
    placeHarp();
    loadSong();
  }
  function exit() {
    if (!L.active) return;
    L.active = false;
    document.body.classList.remove('lesson');
    $('lessonCard').hidden = true;
    $('toast').classList.remove('show'); // a lesson message shouldn't linger over free play
    interaction.reset();
    interaction.customAdd = null;
    interaction.previewHook = null;
    interaction.allowDraw = true;
    // Bring back the player's own strings (scaled if the window changed meanwhile).
    const free = L.freeStrings || [];
    if (L.freeSize && (L.freeSize.W !== app.W || L.freeSize.H !== app.H) && L.freeSize.W && L.freeSize.H) {
      const sx = app.W / L.freeSize.W, sy = app.H / L.freeSize.H;
      for (const s of free) { s.ax *= sx; s.bx *= sx; s.ay *= sy; s.by *= sy; }
    }
    bank.strings = free;
    L.freeStrings = null;
  }
  function setSong(i) {
    L.songIdx = (i + SONGS.length) % SONGS.length;
    store.set('strings.song', String(L.songIdx));
    loadSong();
  }
  /** The Step button: from building, finish the harp for them; from playing, start the harp over. */
  function toggleStep() {
    if (L.step === 'build') {
      const miss = missing();
      for (const m of miss) addString(m, false);
      setStep('play');
      ui.toast(miss.length ? 'Built the rest for you. Pluck the glowing string.' : 'Pluck the glowing string.', 2600);
    } else {
      interaction.reset();
      bank.strings = [];
      L.harp.clear();
      setStep('build');
      ui.toast('Harp cleared. Draw the strings again.', 2400);
    }
  }

  /** A finished draw during the build step: it either fills a slot or is thrown away. */
  function onDraw(line, source) {
    if (L.step !== 'build') return;
    const slots = missingSlots();
    const t = tol(source);
    const slot = matchSlot(line, slots, t);
    if (slot) {
      addString(slot.midi, true);
      if (!missing().length) {
        setStep('play');
        ui.toast('Your harp is ready! Now pluck the glowing string.', 3000);
      }
      return;
    }
    const want = slots[0];
    if (!want) return;
    const msg = {
      away: 'Start on the glowing dot and stretch to the ring.',
      short: `Too short: that would sound higher than ${want.name}. Stretch all the way to the ring.`,
      long: `Too long: that would sound lower than ${want.name}. Let go at the ring.`,
      crooked: 'Right length! Follow the dashed line to the ring.',
    }[drawFeedback(line, want, t)];
    ui.toast(msg, 2800);
  }

  /** While drawing: show the note this length would play, and a tick once it fills a slot. */
  function onPreview(pv) {
    if (L.step !== 'build') return;
    const slots = missingSlots();
    const slot = matchSlot(pv, slots, tol(app.mouseMode ? 'mouse' : 'hand'));
    if (slot) { pv.note = `${slot.name} ✓`; pv.match = true; return; }
    const k = (L.slots[0] && L.slots[0].k) || 1;
    const frac = lengthFraction(pv.ax, pv.ay, pv.bx, pv.by, app.W, app.H) / k;
    pv.note = noteName(midiToFreq(whiteNoteForLength(frac))); // with its octave, so "higher" is visible
  }

  function finish() {
    L.cardShown = true;
    const res = L.run.result(), def = SONGS[L.songIdx];
    if (res.stars > bestStars(def.id)) store.set('strings.stars.' + def.id, String(res.stars));
    refreshLabels();
    $('lessonStars').innerHTML = '★'.repeat(res.stars) + `<span class="off">${'★'.repeat(3 - res.stars)}</span>`;
    $('lessonTitle').textContent = res.wrong === 0 ? 'Perfect!' : ['Keep at it', 'Good start', 'Nicely played', 'Excellent!'][res.stars];
    $('lessonMsg').textContent = `You played ${def.title}: ${res.total} notes with ${res.wrong === 0 ? 'no slips' : res.wrong === 1 ? '1 slip' : res.wrong + ' slips'}.`;
    const again = ['Play again', () => setStep('play')];
    const next = ['Next song', () => setSong(L.songIdx + 1)];
    const [primary, secondary] = res.stars >= 2 ? [next, again] : [again, next];
    $('lessonPrimary').textContent = primary[0]; $('lessonPrimary').onclick = primary[1];
    $('lessonSecondary').textContent = secondary[0]; $('lessonSecondary').onclick = secondary[1];
    $('lessonCard').hidden = false;
  }

  /** Called for every interaction event (plucks, strums, ...). */
  function onEvent(ev) {
    if (!L.active || L.step !== 'play' || !L.run || L.run.done) return;
    if (ev.type !== 'pluck' && ev.type !== 'strum') return;
    const midi = ev.string.fixedMidi;
    const want = L.run.target;
    const now = performance.now();
    const res = L.run.pluck(midi, now);
    if (res === 'wrong' && now - L.lastHintT > 2500) {
      L.lastHintT = now;
      ui.toast(`That was ${letter(midi)}. The glowing string is ${want.name}.`, 2000);
    }
    if (L.run.done) finish();
  }

  // ---------- per-frame ----------
  function frame() {
    if (!L.active || L.step !== 'play' || !L.run || L.run.done) return;
    const s = L.harp.get(L.run.target.midi);
    if (s) s.hover = 1; // keep the string to pluck lit
  }

  function coach() {
    if (!L.active || !app.started || ui.hintOpen || !L.song || L.cardShown) return null;
    const hand = !app.mouseMode;
    if (L.step === 'build') {
      const miss = missing();
      if (!miss.length) return null;
      const m = miss[0], name = letter(m);
      const built = needed().length - miss.length;
      // Compare with a string they can already see, so length = pitch sinks in.
      const lower = [...L.harp.keys()].filter((x) => x < m).sort((a, b) => b - a)[0];
      const higher = [...L.harp.keys()].filter((x) => x > m).sort((a, b) => a - b)[0];
      const why = lower != null ? ` It’s shorter than ${letter(lower)}, so it sounds higher.`
        : higher != null ? ` It’s longer than ${letter(higher)}, so it sounds lower.`
          : ' Longer strings sound lower.';
      const how = hand
        ? `Draw the ${name} string: pinch the glowing dot, hold, stretch to the ring, let go.`
        : `Draw the ${name} string: drag from the glowing dot to the ring.`;
      return { step: built + 1, text: how + why, quiet: true };
    }
    const t = L.run && L.run.target;
    if (!t) return null;
    const words = L.song.phrases[t.phrase];
    const nx = L.run.next;
    return { step: L.run.index + 1, text: `${words} · pluck ${t.name}${nx ? `, then ${nx.name}` : ''}`, quiet: true };
  }

  // ---------- drawing ----------
  /** Under the strings: the slots still to draw, or a halo on the string to pluck. */
  function drawUnder(ctx, now) {
    if (!L.active || !L.song) return;
    const pulse = 0.5 + 0.5 * Math.sin(now / 260);
    ctx.save();
    ctx.lineCap = 'round';
    if (L.step === 'build') {
      const slots = missingSlots();
      const ring = tol(app.mouseMode ? 'mouse' : 'hand') * 0.6;
      ctx.font = '700 13px ui-rounded, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      slots.forEach((s, i) => {
        const cur = i === 0;
        ctx.setLineDash([8, 9]);
        ctx.strokeStyle = cur ? `rgba(125,255,176,${0.6 + 0.3 * pulse})` : 'rgba(255,255,255,0.2)';
        ctx.lineWidth = cur ? 3 : 2;
        ctx.beginPath(); ctx.moveTo(s.ax, s.ay); ctx.lineTo(s.bx, s.by); ctx.stroke();
        ctx.setLineDash([]);
        // Note name beside the middle of the slot.
        const wide = Math.abs(s.bx - s.ax) < Math.abs(s.by - s.ay);
        const lx = (s.ax + s.bx) / 2 + (wide ? 24 : 0), ly = (s.ay + s.by) / 2 - (wide ? 0 : 22);
        ctx.fillStyle = 'rgba(8,10,18,0.7)';
        roundRect(ctx, lx - 13, ly - 11, 26, 22, 11); ctx.fill();
        ctx.fillStyle = cur ? '#b9ffd6' : 'rgba(238,241,248,0.55)';
        ctx.fillText(s.name, lx, ly + 0.5);
        if (!cur) return;
        // Start dot and finish ring.
        ctx.beginPath(); ctx.arc(s.ax, s.ay, 9 + 4 * pulse, 0, Math.PI * 2);
        ctx.fillStyle = '#7dffb0'; ctx.fill();
        ctx.beginPath(); ctx.arc(s.bx, s.by, ring, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(125,255,176,${0.55 + 0.4 * pulse})`; ctx.lineWidth = 2.5; ctx.stroke();
        ctx.font = '600 11px ui-rounded, system-ui, sans-serif';
        ctx.fillStyle = 'rgba(214,255,232,0.9)';
        const sx = wide ? -1 : 0, sy = wide ? 0 : 1; // put the words clear of the line
        ctx.textAlign = wide ? 'right' : 'center';
        ctx.fillText('start here', s.ax + sx * 18, s.ay + sy * 24);
        ctx.fillText('stretch to here', s.bx + sx * (ring + 8), s.by + sy * (ring + 12));
        ctx.font = '700 13px ui-rounded, system-ui, sans-serif';
        ctx.textAlign = 'center';
      });
    } else if (L.run && !L.run.done) {
      const s = L.harp.get(L.run.target.midi);
      if (s) {
        ctx.strokeStyle = `rgba(125,255,176,${0.14 + 0.14 * pulse})`;
        ctx.lineWidth = 40;
        ctx.beginPath(); ctx.moveTo(s.ax, s.ay); ctx.lineTo(s.bx, s.by); ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** Over everything: the next few notes of the song, under the toolbar. */
  function drawOver(ctx) {
    if (!L.active || L.step !== 'play' || !L.run || L.run.done) return;
    const notes = L.song.notes.slice(L.run.index, L.run.index + 6);
    const tb = $('toolbar').getBoundingClientRect();
    const y = tb.bottom + 26, gap = 34;
    let x = app.W / 2 - ((notes.length - 1) * gap) / 2;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    notes.forEach((n, i) => {
      const cur = i === 0;
      // A small gap marks the start of a new line of the song.
      if (i && n.phrase !== notes[i - 1].phrase) x += 10;
      const r = cur ? 16 : 12;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = cur ? '#7dffb0' : 'rgba(14,16,26,0.85)';
      ctx.fill();
      if (!cur) { ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1; ctx.stroke(); }
      ctx.font = `${cur ? 800 : 600} ${cur ? 15 : 12}px ui-rounded, system-ui, sans-serif`;
      ctx.fillStyle = cur ? '#0b1a12' : `rgba(238,241,248,${0.85 - i * 0.1})`;
      ctx.fillText(n.name, x, y + 0.5);
      x += gap;
    });
    ctx.restore();
  }

  function resize() {
    if (!L.active) return;
    computeSlots();
    placeHarp();
  }

  // ---------- controls ----------
  $('learnBtn').addEventListener('click', enter);
  $('exitLessonBtn').addEventListener('click', exit);
  $('songBtn').addEventListener('click', () => setSong(L.songIdx + 1));
  $('stepBtn').addEventListener('click', toggleStep);
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.tagName === 'INPUT' || !app.started) return;
    const k = e.key.toLowerCase();
    if (k === 'l') { L.active ? exit() : enter(); e.preventDefault(); }
    else if (k === 'escape' && L.active && !ui.hintOpen) exit();
  });
  // The toolbar changes size between free play and lessons: keep the harp clear of it.
  if (window.ResizeObserver) new ResizeObserver(() => resize()).observe($('toolbar'));

  return {
    state: L,
    get active() { return L.active; },
    enter, exit, setSong, setStep, toggleStep, onEvent, frame, coach, drawUnder, drawOver, resize,
  };
}
