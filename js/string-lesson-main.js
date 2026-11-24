// Air Strings lessons: wiring, coaching and drawing. The rules live in
// string-lessons.js (pure, tested); this file connects them to the page.

import { SONGS, buildSong, streakMilestone } from './lessons.js';
import { harpSlots, matchSlot, drawFeedback, whiteNoteForLength, StringSongRun, StringTimedRun, STRING_TEMPOS, timedGeometry } from './string-lessons.js';
import { lengthFraction, midiToFreq, noteName, noteHue } from './pitch.js';
import { FX, drawStreak } from './fx.js';
import { roundRect } from './strings.js';
import { createSongPicker, suggestedSong } from './song-picker.js';

// Right after an update a browser can pair a cached older page with newer
// scripts, so a missing element gets a stand-in instead of stopping the app.
const stubs = new Map();
const $ = (id) => document.getElementById(id)
  || stubs.get(id) || stubs.set(id, document.createElement('div')).get(id);
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const letter = (midi) => noteName(midiToFreq(midi)).replace(/-?\d+$/, '');

export function createStringLessons({ app, bank, interaction, ui }) {
  const L = {
    active: false,
    songIdx: Math.min(SONGS.length - 1, Math.max(0, parseInt(store.get('strings.song', '0'), 10) || 0)),
    step: 'build',          // 'build' | 'play' | 'time'
    tempo: STRING_TEMPOS[store.get('strings.tempo', 'slow')] ? store.get('strings.tempo', 'slow') : 'slow',
    lastBeat: null,         // for the count-in ticks
    demo: null,             // 'Listen': a run the app plays by itself
    fxT: 0,
    msg: null,              // a short message shown in the coach line
    streak: { last: 0, upT: 0 }, // for the streak counter's pop and milestones
    song: null,
    run: null,
    harp: new Map(),        // midi -> AirString; kept between songs, so each song adds to it
    slots: [],
    freeStrings: null,      // the player's own strings, put away during a lesson
    freeSize: null,
    cardShown: false,
    lastHintT: 0,
  };

  const fx = new FX();
  /**
   * Lesson messages go in the coach line at the bottom (highlighted for a
   * moment) rather than a pop-up near the top, where they used to cover the
   * next-notes strip and the top string on a phone.
   */
  const say = (text, ms = 2600) => { L.msg = { text, until: performance.now() + ms }; };

  // ---------- helpers ----------
  const tol = (source) => {
    const diag = Math.hypot(app.W, app.H);
    return source === 'hand' ? Math.max(30, 0.04 * diag) : Math.max(22, 0.025 * diag);
  };
  const slotFor = (midi) => L.slots.find((s) => s.midi === midi);
  const needed = () => [...new Set(L.song.notes.map((n) => n.midi))].sort((a, b) => a - b);
  const missing = () => needed().filter((m) => !L.harp.has(m));
  const missingSlots = () => missing().map(slotFor).filter(Boolean);
  const readStars = (key) => Math.min(3, Math.max(0, parseInt(store.get(key, '0'), 10) || 0));
  const paceStars = (id) => readStars('strings.stars.' + id);
  const timeStars = (id) => readStars('strings.time.' + id);
  const bestStars = (id) => Math.max(paceStars(id), timeStars(id));
  const STEP_LABEL = { build: '1 · Build', play: '2 · Play', time: '3 · In time' };

  const shortTimed = () => L.step === 'time' && app.W >= app.H && app.H < 500;
  function computeSlots() {
    const tb = $('toolbar').getBoundingClientRect();
    const wide = app.W >= app.H;
    // Leave room for the "next notes" strip under the toolbar and the coach at the bottom.
    const top = tb.bottom + (wide ? 58 : 86);
    // A short screen playing in time gives the coach's room to the strings.
    const bottom = wide ? (shortTimed() ? 30 : 124) : 176;
    L.slots = harpSlots(app.W, app.H, { top, bottom });
    if (wide && L.step === 'time') {
      // Playing in time, notes fall onto the strings from above: if there's
      // room, lower the harp so they can be seen coming from further away.
      const slack = app.H - bottom - Math.max(...L.slots.map((sl) => sl.by));
      if (slack > 20) L.slots = harpSlots(app.W, app.H, { top: top + Math.min(slack, app.H * 0.22), bottom });
    }
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
    if (demo) { fx.burst(sl.ax, sl.ay, s.hue, 0.5); fx.burst(sl.bx, sl.by, s.hue, 0.5); }
    // Let them hear the note they just made.
    if (demo) interaction.pluck(s, 0.35, 0.55, Math.min(14, sl.len * 0.08), app.W, performance.now(), 'demo');
    return s;
  }
  /** Stars earned across every song, shown on the Learn button in free play. */
  function refreshLearnBadge() {
    const total = SONGS.reduce((t, d) => t + paceStars(d.id) + timeStars(d.id), 0);
    $('learnStars').textContent = total ? `★ ${total}` : '';
  }
  function refreshLabels() {
    refreshLearnBadge();
    const def = SONGS[L.songIdx], best = bestStars(def.id);
    $('songKey').innerHTML = `Song ${L.songIdx + 1}/${SONGS.length}` + (best ? ` <span class="won">${'★'.repeat(best)}</span>` : '');
    $('songVal').textContent = def.short || def.title;
    $('stepVal').textContent = STEP_LABEL[L.step];
    $('speedVal').textContent = STRING_TEMPOS[L.tempo].label;
    $('listenVal').textContent = L.demo ? 'Stop' : 'Hear it';
    $('listenBtn').classList.toggle('on', !!L.demo);
    document.body.classList.toggle('lesson-time', L.active && L.step === 'time');
  }

  // ---------- flow ----------
  function setStep(step) {
    stopDemo(true);
    L.step = step;
    interaction.allowDraw = step === 'build';
    L.run = step === 'play' ? new StringSongRun(L.song)
      : step === 'time' ? new StringTimedRun(L.song, { bpm: STRING_TEMPOS[L.tempo].bpm }) : null;
    L.lastBeat = null;
    L.streak = { last: 0, upT: 0 };
    computeSlots();
    placeHarp();
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
      say(`Song ${L.songIdx + 1}: ${L.song.title}. ${L.harp.size ? 'Add' : 'First draw'} the string${miss.length > 1 ? 's' : ''} it needs: ${names}. Tap Listen to hear it first.`, 4200);
    } else {
      setStep('play');
      say(`Song ${L.songIdx + 1}: ${L.song.title}. Your harp already has every string it needs. Tap Listen to hear it first.`, 3800);
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
    $('toast').classList.remove('show'); // picking a song introduces it
    picker.open(); // start by choosing a song
  }
  function exit() {
    if (!L.active) return;
    stopDemo(true);
    picker.close();
    L.msg = null;
    L.active = false;
    document.body.classList.remove('lesson', 'lesson-time');
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
  /** The Step button: build -> play at your own pace -> play in time -> start the harp over. */
  function toggleStep() {
    if (L.step === 'build') {
      const miss = missing();
      for (const m of miss) addString(m, false);
      setStep('play');
      say(miss.length ? 'Built the rest for you. Pluck the glowing string.' : 'Pluck the glowing string.', 2600);
    } else if (L.step === 'play') {
      startTimed();
    } else {
      interaction.reset();
      bank.strings = [];
      L.harp.clear();
      setStep('build');
      say('Harp cleared. Draw the strings again.', 2400);
    }
  }

  // ---------- listen first ----------
  /** The app plays the song itself, lighting each string, so you hear how it goes. */
  function startDemo() {
    if (!L.active || !L.song) return;
    stopDemo(true);
    $('lessonCard').hidden = true;
    L.cardShown = false;
    L.demo = new StringTimedRun(L.song, { bpm: STRING_TEMPOS[L.tempo].bpm, countIn: 1 });
    L.demo.start(performance.now());
    refreshLabels();
  }
  /** quiet: switching step/song (no message). Otherwise the song is reset for their turn. */
  function stopDemo(quiet) {
    if (!L.demo) return;
    const finished = L.demo.done;
    L.demo = null;
    refreshLabels();
    if (quiet) return;
    setStep(L.step); // a fresh run for them to try
    if (L.step === 'build') say(finished ? 'Now build the strings it needs.' : 'Stopped.', 2200);
    else say(finished ? 'Your turn!' : 'Stopped. Your turn!', 2200);
  }
  const toggleDemo = () => (L.demo ? stopDemo(false) : startDemo());
  function demoFrame(now) {
    const d = L.demo;
    // Play each note as its time comes.
    while (!d.done && now >= d.timeOf(d.index)) {
      const i = d.index, n = L.song.notes[i];
      d.pluck(n.midi, d.timeOf(i));
      const s = L.harp.get(n.midi);
      if (s) { interaction.pluck(s, 0.5, 0.6, Math.min(14, s.length * 0.08), app.W, now, 'demo'); sparkle(n.midi, 0.35); }
      else interaction.synth.pluck({ freq: midiToFreq(n.midi), amp: 0.6, position: 0.4, pan: 0, stringId: 'demo' + n.midi });
    }
    // Light the string about to play.
    const t = d.target;
    if (t) { const s = L.harp.get(t.midi); if (s) s.hover = 1; }
    if (d.done && now - d.timeOf(L.song.notes.length - 1) > L.song.notes[L.song.notes.length - 1].beats * d.beatMs + 400) stopDemo(false);
  }

  /** Where a string crosses the now-line when playing in time (else its middle). */
  function hitPoint(midi) {
    const sl = slotFor(midi);
    if (!sl) return null;
    if (L.step !== 'time') return [(sl.ax + sl.bx) / 2, (sl.ay + sl.by) / 2];
    const g = timedGeometry(L.slots, app.W, app.H, { farTop: $('toolbar').getBoundingClientRect().bottom + 10 });
    return g.wide ? [sl.ax, g.now] : [g.now, sl.ay];
  }
  /** Where the streak counter sits: top left, clear of the strings and the notes coming in. */
  function streakPos() {
    const tb = $('toolbar').getBoundingClientRect();
    return [Math.max(44, Math.min(70, app.W * 0.07)), tb.bottom + 44];
  }
  /** Notice the streak growing (pop), hitting a milestone (cheer) or breaking. */
  function trackStreak(run, now) {
    const st = L.streak, c = run.combo;
    if (c > st.last) {
      st.upT = now;
      const m = streakMilestone(st.last, c);
      if (m) {
        const [x, y] = streakPos();
        fx.burst(x, y, 45, 1);
        say(`${m} in a row!`, 1600);
      }
    }
    st.last = c;
  }
  function sparkle(midi, power) {
    const p = hitPoint(midi);
    if (p) fx.burst(p[0], p[1], noteHue(midi), power);
  }

  function startTimed() {
    setStep('time');
    say(`In time at ${STRING_TEMPOS[L.tempo].label.toLowerCase()} speed: pluck each string as its note reaches the line.`, 3200);
  }
  function setTempo(t) {
    L.tempo = STRING_TEMPOS[t] ? t : 'slow';
    store.set('strings.tempo', L.tempo);
    if (L.step === 'time') setStep('time'); else refreshLabels();
  }
  function cycleTempo() {
    const keys = Object.keys(STRING_TEMPOS);
    setTempo(keys[(keys.indexOf(L.tempo) + 1) % keys.length]);
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
        say('Your harp is ready! Now pluck the glowing string.', 3000);
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
    say(msg, 2800);
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
    const timed = L.step === 'time';
    const key = (timed ? 'strings.time.' : 'strings.stars.') + def.id;
    if (res.stars > readStars(key)) store.set(key, String(res.stars));
    if (res.stars === 3) fx.confetti(app.W, app.H);
    refreshLabels();
    $('lessonStars').innerHTML = '★'.repeat(res.stars) + `<span class="off">${'★'.repeat(3 - res.stars)}</span>`;
    const slips = res.wrong === 0 ? 'no slips' : res.wrong === 1 ? '1 slip' : res.wrong + ' slips';
    const next = ['Next song', () => setSong(L.songIdx + 1)];
    let primary, secondary;
    if (timed) {
      const flawless = res.perfect + res.good === res.total && res.wrong === 0;
      $('lessonTitle').textContent = flawless && res.perfect === res.total ? 'Perfect timing!' : ['Keep at it', 'Good start', 'Nicely played', 'Excellent!'][res.stars];
      $('lessonMsg').textContent = `${def.title} at ${STRING_TEMPOS[L.tempo].label.toLowerCase()} speed: ${res.hits} of ${res.total} notes in time (${res.perfect} perfect), ${slips}. Best streak ${res.maxCombo}.`;
      const again = ['Play again', () => setStep('time')];
      const slower = L.tempo !== 'slow' ? ['Slower', () => setTempo(Object.keys(STRING_TEMPOS)[Object.keys(STRING_TEMPOS).indexOf(L.tempo) - 1])]
        : ['Practise at my pace', () => setStep('play')];
      const faster = L.tempo !== 'fast' ? ['Faster', () => setTempo(Object.keys(STRING_TEMPOS)[Object.keys(STRING_TEMPOS).indexOf(L.tempo) + 1])] : again;
      [primary, secondary] = res.stars === 3 ? [next, faster] : res.stars === 2 ? [next, again] : [again, slower];
    } else {
      $('lessonTitle').textContent = res.wrong === 0 ? 'Perfect!' : ['Keep at it', 'Good start', 'Nicely played', 'Excellent!'][res.stars];
      $('lessonMsg').textContent = `You played ${def.title}: ${res.total} notes with ${slips}.` + (res.stars >= 2 ? ' Now try it in time?' : '');
      const again = ['Play again', () => setStep('play')];
      const inTime = ['Play in time', startTimed];
      [primary, secondary] = res.stars >= 2 ? [inTime, next] : [again, inTime];
    }
    $('lessonPrimary').textContent = primary[0]; $('lessonPrimary').onclick = primary[1];
    $('lessonSecondary').textContent = secondary[0]; $('lessonSecondary').onclick = secondary[1];
    $('lessonCard').hidden = false;
  }

  /** Called for every interaction event (plucks, strums, ...). */
  function onEvent(ev) {
    if (!L.active || L.demo || L.step === 'build' || !L.run || L.run.done) return;
    if (ev.type !== 'pluck' && ev.type !== 'strum') return;
    const midi = ev.string.fixedMidi;
    const now = performance.now();
    if (L.step === 'time') {
      const g = L.run.pluck(midi, now);
      if (g === 'perfect' || g === 'good') sparkle(midi, g === 'perfect' ? 1 : 0.55);
      trackStreak(L.run, now);
      if (L.run.done) finish();
      return;
    }
    const want = L.run.target;
    const res = L.run.pluck(midi, now);
    if (res === 'right') sparkle(midi, 0.7);
    if (res === 'wrong' && now - L.lastHintT > 2500) {
      L.lastHintT = now;
      say(`That was ${letter(midi)}. The glowing string is ${want.name}.`, 2000);
    }
    if (L.run.done) finish();
  }

  // ---------- per-frame ----------
  function frame() {
    if (picker.isOpen) return;
    if (L.active && L.demo) { demoFrame(performance.now()); return; }
    if (!L.active || !L.run || L.run.done || L.step === 'build') return;
    if (L.step === 'play') {
      const s = L.harp.get(L.run.target.midi);
      if (s) s.hover = 1; // keep the string to pluck lit
      return;
    }
    const now = performance.now();
    const run = L.run;
    if (!run.started) {
      // Wait for a hand (or the mouse) before counting in, and not under a card or help.
      const ready = app.mouseMode || app.pointers.some((p) => p.source === 'hand' && !p.lost);
      if (ready && !L.cardShown && !ui.hintOpen) run.start(now);
      else return;
    }
    // Count-in ticks, and a softer tick on each beat after.
    const beat = Math.floor(run.pos(now));
    if (beat !== L.lastBeat) {
      L.lastBeat = beat;
      if (beat < 0) interaction.synth.tick(beat === -run.countIn);
    }
    run.update(now);
    trackStreak(run, now);
    // Light each string a moment before its note arrives.
    const pos = run.pos(now);
    for (let i = run.index; i < L.song.notes.length; i++) {
      const n = L.song.notes[i];
      if (n.start - pos > 0.6) break;
      if (run.grade[i] === null) { const s = L.harp.get(n.midi); if (s) s.hover = 1; }
    }
    if (run.done) finish();
  }

  function coach() {
    if (!L.active || !app.started || ui.hintOpen || !L.song || L.cardShown || picker.isOpen) return null;
    const hand = !app.mouseMode;
    if (L.msg && performance.now() < L.msg.until) {
      if (shortTimed() && L.run && L.run.started) return null; // the strings need that room
      return { step: '✦', text: L.msg.text, quiet: true, msg: true };
    }
    if (L.demo) {
      if (shortTimed()) return null; // the strings need that room
      const t = L.demo.target;
      return { step: '♪', text: t ? `Listen: ${L.song.phrases[t.phrase]}` : 'Listen…', quiet: true };
    }
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
    if (L.step === 'time') {
      const run = L.run;
      if (!run || run.done) return null;
      if (shortTimed() && run.started) return null;
      if (!run.started) return { step: '3', text: hand ? 'Hold a hand up to start the count-in.' : 'Get ready…', quiet: true };
      const pos = run.pos(performance.now());
      if (pos < 0) return { step: '3', text: 'Pluck each string as its note touches the line.', quiet: true };
      const t = run.target;
      return t ? { step: run.index + 1, text: L.song.phrases[t.phrase], quiet: true } : null;
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
    if (L.step === 'build' && !L.demo) {
      const slots = missingSlots();
      const ring = tol(app.mouseMode ? 'mouse' : 'hand') * 0.6;
      ctx.font = '700 13px ui-rounded, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      slots.forEach((s, i) => {
        const cur = i === 0;
        ctx.setLineDash([8, 9]);
        const hue = noteHue(s.midi);
        ctx.strokeStyle = cur ? `hsla(${hue}, 95%, 66%, ${0.65 + 0.3 * pulse})` : `hsla(${hue}, 60%, 70%, 0.22)`;
        ctx.lineWidth = cur ? 3 : 2;
        ctx.beginPath(); ctx.moveTo(s.ax, s.ay); ctx.lineTo(s.bx, s.by); ctx.stroke();
        ctx.setLineDash([]);
        // Note name beside the middle of the slot.
        const wide = Math.abs(s.bx - s.ax) < Math.abs(s.by - s.ay);
        const lx = (s.ax + s.bx) / 2 + (wide ? 24 : 0), ly = (s.ay + s.by) / 2 - (wide ? 0 : 22);
        ctx.fillStyle = 'rgba(8,10,18,0.7)';
        roundRect(ctx, lx - 13, ly - 11, 26, 22, 11); ctx.fill();
        ctx.fillStyle = cur ? `hsl(${hue}, 100%, 80%)` : 'rgba(238,241,248,0.55)';
        ctx.fillText(s.name, lx, ly + 0.5);
        if (!cur) return;
        // Start dot and finish ring.
        ctx.beginPath(); ctx.arc(s.ax, s.ay, 9 + 4 * pulse, 0, Math.PI * 2);
        ctx.fillStyle = '#7dffb0'; ctx.fill();
        ctx.beginPath(); ctx.arc(s.bx, s.by, ring, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(125,255,176,${0.55 + 0.4 * pulse})`; ctx.lineWidth = 2.5; ctx.stroke();
        ctx.font = '600 11px ui-rounded, system-ui, sans-serif';
        ctx.fillStyle = 'rgba(214,255,232,0.9)';
        // Put the words clear of the line: to its left, unless that runs off the screen.
        const side = wide && s.ax < 130 ? 1 : -1;
        const sx = wide ? side : 0, sy = wide ? 0 : 1;
        ctx.textAlign = wide ? (side < 0 ? 'right' : 'left') : 'center';
        ctx.fillText('start here', s.ax + sx * 18, s.ay + sy * 24);
        ctx.fillText('stretch to here', s.bx + sx * (ring + 8), s.by + sy * (ring + 12));
        ctx.font = '700 13px ui-rounded, system-ui, sans-serif';
        ctx.textAlign = 'center';
      });
    } else if (L.step === 'play' && L.run && !L.run.done && !L.demo) {
      const s = L.harp.get(L.run.target.midi);
      if (s) {
        ctx.strokeStyle = `hsla(${s.hue}, 95%, 62%, ${0.14 + 0.16 * pulse})`;
        ctx.lineWidth = 40;
        ctx.beginPath(); ctx.moveTo(s.ax, s.ay); ctx.lineTo(s.bx, s.by); ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** Over everything: the next few notes of the song, under the toolbar. */
  function drawOver(ctx, now) {
    now = now ?? performance.now();
    drawLesson(ctx, now);
    fx.update((now - (L.fxT || now)) / 1000);
    L.fxT = now;
    fx.draw(ctx);
  }
  function drawLesson(ctx, now) {
    if (L.active && L.demo && L.step === 'time') { drawTimed(ctx, now, L.demo); return; }
    if (L.active && L.step === 'time' && L.run && !L.demo) { drawTimed(ctx, now, L.run); return; }
    const run = L.demo || (L.step === 'play' ? L.run : null);
    if (!L.active || !run || run.done) return;
    const notes = L.song.notes.slice(run.index, run.index + 6);
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
      const r = cur ? 16 : 12, hue = noteHue(n.midi);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = cur ? `hsl(${hue}, 95%, 66%)` : 'rgba(14,16,26,0.85)';
      ctx.fill();
      ctx.strokeStyle = cur ? 'rgba(255,255,255,0.9)' : `hsla(${hue}, 90%, 66%, ${0.75 - i * 0.08})`;
      ctx.lineWidth = cur ? 2 : 1.5;
      ctx.stroke();
      ctx.font = `${cur ? 800 : 600} ${cur ? 15 : 12}px ui-rounded, system-ui, sans-serif`;
      ctx.fillStyle = cur ? '#0b0d14' : `rgba(238,241,248,${0.85 - i * 0.1})`;
      ctx.fillText(n.name, x, y + 0.5);
      x += gap;
    });
    ctx.restore();
  }

  /** Playing in time: notes travel along each string to the now-line. */
  function drawTimed(ctx, now, run) {
    const song = L.song;
    const slots = L.slots.filter((s) => L.harp.has(s.midi));
    if (!slots.length) return;
    const tb = $('toolbar').getBoundingClientRect();
    const g = timedGeometry(L.slots, app.W, app.H, { farTop: tb.bottom + 10 });
    const pos = run.pos(now);
    const at = (slot, c) => (g.wide ? [slot.ax, c] : [c, slot.ay]);
    const cOf = (beat) => g.now + g.dir * (beat - pos) * g.ppb;
    ctx.save();
    ctx.lineCap = 'round';
    // The now-line across every string, with a ring where each string crosses it.
    const first = slots[0], last = slots[slots.length - 1];
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (g.wide) { ctx.moveTo(Math.min(first.ax, last.ax) - 34, g.now); ctx.lineTo(Math.max(first.ax, last.ax) + 34, g.now); }
    else { ctx.moveTo(g.now, Math.max(first.ay, last.ay) + 30); ctx.lineTo(g.now, Math.min(first.ay, last.ay) - 30); }
    ctx.stroke();
    for (const sl of slots) {
      const s = L.harp.get(sl.midi), [x, y] = at(sl, g.now);
      ctx.beginPath(); ctx.arc(x, y, 15, 0, Math.PI * 2);
      ctx.strokeStyle = `hsla(${s.hue}, 95%, 70%, ${0.45 + 0.5 * s.hover})`;
      ctx.lineWidth = 2 + 2 * s.hover;
      ctx.stroke();
    }
    // Notes: clipped so they appear from under the toolbar edge, not over it.
    ctx.save();
    ctx.beginPath();
    if (g.wide) ctx.rect(0, g.far, app.W, app.H - g.far); else ctx.rect(0, 0, g.far, app.H);
    ctx.clip();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 13px ui-rounded, system-ui, sans-serif';
    for (let i = 0; i < song.notes.length; i++) {
      const n = song.notes[i];
      if (n.start > pos + g.look + 0.5) break;
      const grade = run.grade[i];
      if (grade === 'perfect' || grade === 'good') continue; // burst away when played
      const sl = slotFor(n.midi), s = L.harp.get(n.midi);
      if (!sl || !s) continue;
      const head = cOf(n.start), tail = cOf(n.start + n.beats);
      const past = grade === 'miss';
      const fade = past ? Math.max(0, 1 - (pos - n.start) / 1.2) : 1;
      if (fade <= 0) continue;
      const len = Math.max(0, Math.abs(tail - head) - 8);
      const [hx, hy] = at(sl, head);
      ctx.globalAlpha = fade;
      // Tail: how long the note lasts.
      if (len > 14) {
        const [tx, ty] = at(sl, head + g.dir * len);
        ctx.strokeStyle = `hsla(${s.hue}, 90%, 62%, ${past ? 0.25 : 0.4})`;
        ctx.lineWidth = 12;
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(tx, ty); ctx.stroke();
      }
      // Head: the moment to pluck.
      ctx.beginPath(); ctx.arc(hx, hy, 13, 0, Math.PI * 2);
      ctx.fillStyle = past ? 'rgba(120,120,130,0.7)' : `hsl(${s.hue}, 95%, 66%)`;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = 'rgba(8,10,18,0.9)';
      ctx.fillText(n.name, hx, hy + 0.5);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    // How each note went, floating up from where it was judged.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const ev of run.events) {
      const age = (now - ev.t) / 700;
      if (age > 1) continue;
      const sl = slotFor(song.notes[ev.i].midi);
      if (!sl) continue;
      const [x, y] = at(sl, g.now);
      const label = run === L.demo ? '' : { perfect: 'Perfect', good: 'Good', miss: 'Miss' }[ev.grade];
      ctx.globalAlpha = 1 - age;
      ctx.font = '800 14px ui-rounded, system-ui, sans-serif';
      ctx.fillStyle = ev.grade === 'perfect' ? '#7dffb0' : ev.grade === 'good' ? '#cfe9ff' : '#ff8a96';
      const lift = 22 + 26 * age;
      ctx.fillText(label, g.wide ? x : x, g.wide ? y + lift : y - lift);
      ctx.globalAlpha = 1;
    }
    // Streak.
    if (run !== L.demo && run.started && pos >= 0 && run.combo >= 2) {
      const [sx, sy] = streakPos();
      drawStreak(ctx, sx, sy, run.combo, now - L.streak.upT);
    }
    // Count-in.
    if (run.started && pos < 0 && !run.done) {
      ctx.font = '800 84px ui-rounded, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(String(Math.ceil(-pos)), app.W / 2, app.H * 0.42);
    }
    // Progress along the top.
    const done = run.done ? 1 : run.index / song.notes.length;
    const bw = Math.min(360, app.W - 48), bx = (app.W - bw) / 2, by = tb.bottom + 6;
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(bx, by, bw, 3);
    ctx.fillStyle = 'rgba(125,255,176,0.8)'; ctx.fillRect(bx, by, bw * done, 3);
    ctx.restore();
  }

  function resize() {
    if (!L.active) return;
    computeSlots();
    placeHarp();
  }

  // ---------- song picker ----------
  const pickerScores = () => SONGS.map((d) => [{ label: 'Pace', stars: paceStars(d.id) }, { label: 'In time', stars: timeStars(d.id) }]);
  const picker = createSongPicker({
    songs: SONGS,
    scores: () => pickerScores(),
    current: () => L.songIdx,
    onPick: (i) => setSong(i),
    onOpen: () => {
      // Nothing should play on under the picker.
      stopDemo(true);
      $('lessonCard').hidden = true;
      if (L.step === 'time') setStep('time');
    },
  });

  // ---------- hand signs ----------
  /**
   * Thumbs up says yes to the big button (or picks the song under the picker);
   * thumbs down restarts the song. With dry = true, only says whether it would act.
   */
  function sign(name, dry = false) {
    if (!L.active || ui.hintOpen) return false;
    const card = !$('lessonCard').hidden;
    if (name === 'Thumb_Up') {
      if (card) { if (!dry) $('lessonPrimary').click(); return true; }
      if (picker.isOpen) {
        if (!dry) { const i = suggestedSong(pickerScores(), L.songIdx); picker.close(); setSong(i); }
        return true;
      }
      return false;
    }
    if (name === 'Thumb_Down') {
      if (picker.isOpen || L.step === 'build') return false;
      if (!dry) { setStep(L.step); say('Starting the song again.', 1800); }
      return true;
    }
    return false;
  }

  // ---------- controls ----------
  refreshLearnBadge();
  $('learnBtn').addEventListener('click', enter);
  $('exitLessonBtn').addEventListener('click', exit);
  $('songBtn').addEventListener('click', () => picker.open());
  $('stepBtn').addEventListener('click', toggleStep);
  $('speedBtn').addEventListener('click', cycleTempo);
  $('listenBtn').addEventListener('click', toggleDemo);
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.tagName === 'INPUT' || !app.started) return;
    const k = e.key.toLowerCase();
    if (k === 'l') { L.active ? exit() : enter(); e.preventDefault(); }
    else if (k === 'p' && L.active) { toggleDemo(); e.preventDefault(); }
    else if (k === 'escape' && L.active && !ui.hintOpen) exit();
  });
  // The toolbar changes size between free play and lessons: keep the harp clear of it.
  if (window.ResizeObserver) new ResizeObserver(() => resize()).observe($('toolbar'));

  return {
    state: L,
    get active() { return L.active; },
    picker, enter, exit, setSong, setStep, setTempo, startTimed, startDemo, stopDemo, toggleStep, onEvent, frame, coach, drawUnder, drawOver, resize, sign,
    confetti: () => fx.confetti(app.W, app.H),
  };
}
