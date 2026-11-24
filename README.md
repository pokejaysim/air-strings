# Air Strings

Draw guitar strings in the air with your hand, then pluck them. Your webcam
tracks your hand; each string's length sets its note, like a real string:
short strings ring high, long strings ring low.

**Live:** https://pokejaysim.github.io/air-strings/

No install, no build step, no audio files. Everything runs in the browser, and
the camera video never leaves your device.

## How to play

There are no modes to switch. What you do decides what happens:

| | With your hand | With a mouse / touch |
|---|---|---|
| **Draw a string** | Pinch thumb + index in empty space, hold until the ring fills (a split second), drag, let go | Click-drag in empty space, release |
| **Pluck** | Pinch a string, pull it sideways, let go. Pull further = louder | Drag a string sideways, release |
| **Strum** | Swipe your index fingertip quickly across strings (no pinch). Faster = louder | Flick fast across strings, starting from empty space |
| **Press a toolbar button** | Pinch over it | Click it |

A pinch within reach of a string grabs it (the string lights up when you're
close enough); anywhere else, it starts a new string.

Strums never draw lines: fingers that touch mid-swipe are ignored, drawing
needs a short held pinch first (a ring fills to show it), lines made in a
quick flick are discarded, and a pinch-drag that whips across strings strums
them instead of drawing. The thresholds live in `TUNING` in
`js/interaction.js`. A short coaching line at
the bottom walks first-time players through draw, pluck, then strum.

Keyboard: **Z** undo · **C** clear · **L** learn a song · **H** help.

**Pitch:** frequency is inversely proportional to length, measured as a
fraction of the screen diagonal, so it works the same at any window size.
A string 8% of the diagonal plays E5, and 64% plays E2. Halve a string and it
goes up an octave. **Snap** rounds notes to the chromatic scale or E major
pentatonic (E F# G# B C#), or leave it off for exact, slide-able pitch.

If a pinch pulls a string too far, it slips out of your fingers and plucks at
full volume, just like a real one.

### Learn a song

Press **Learn** (or tap the song name in a lesson) to open the song list: every
song with what it teaches and the stars you've earned, at your own pace and in
time. The first song without a star is marked *Next up*. Then you're taught the
tune on a small harp you build yourself (the same ten songs as the theremin,
easiest first; every one fits on six strings, C to A).

1. **Step 1 · Build.** Each string the song needs has a dashed outline of
   exactly the right length for its note. Pinch the glowing dot, stretch to
   the ring and let go. The label counts down through the notes as the line
   gets longer (…E4, D4, C ✓), and the coach says how each string compares
   with the last ("shorter than C, so it sounds higher"). A line that misses
   is thrown away with a hint (too short, too long, wrong place).
2. **Step 2 · Play.** The string to pluck next lights up, the next few notes
   are shown under the toolbar, and the song waits for you. Stars are for
   accuracy: wrong strings count as slips, though brushing a neighbour right
   after a correct pluck is forgiven.
3. **Step 3 · In time.** After a four-beat count-in (it waits for your hand),
   notes travel along each string to a line across the harp: pluck as each one
   touches it. Within 0.12 s is *perfect*, within 0.3 s is *good*. Stray
   plucks cost half a note, so strumming everything doesn't win. Speeds are
   Slow 50, Medium 66 and Fast 84 bpm, a little slower than the theremin's
   because a pluck takes longer than a slide.

In lessons every note name has its own colour (C red, D orange, E yellow,
F green, G blue, A violet), on the strings, the next-notes strip and the notes
that travel in step 3. Right notes throw sparks; three stars bring confetti.

**Listen** (or <kbd>P</kbd>) plays the song for you first, at the chosen speed:
each string lights and sounds in turn (in step 1, before the strings exist,
you still hear the notes). When it ends, the song is reset for your turn.

The harp has six strings, C4 to A4, and is kept between songs, so each song
only asks for the strings you don't have yet (Hot Cross Buns needs C, D, E;
Mary Had a Little Lamb then adds G). Pressing **Step** during the build
draws the remaining strings for you; pressing it while playing clears the
harp to build again. Your own free-play strings are put away during a lesson
and come back when you exit.

## Air Theremin

**Live:** https://pokejaysim.github.io/air-strings/theremin.html

A second instrument in the same app, played without touching anything:

| | With your hands | With a mouse / touch |
|---|---|---|
| **Pitch** | Hold one hand up on the **right** side; move it left–right (landscape) or up–down (portrait). Wobble it for vibrato | Press and drag on the right side |
| **Volume** | Other hand on the **left**: higher is louder, drop to the bottom for silence. One hand alone plays at a steady volume | A second finger on the left (touchscreen) |
| **Tone** | Move the pitch hand up (landscape) or right (portrait) for a brighter sound | Same, with the pointer |
| **Controls** | Pinch **and hold** a toolbar button for a moment | Tap / click |

- **Assist:** *Off* is a true theremin. *Gentle* (default) pulls you toward the
  scale but keeps slides and vibrato. *Snap* always lands on a note.
- **Voice:** Classic, Soft or Sci-fi. **Scale:** Pentatonic, Major, Minor
  pentatonic or Chromatic (all in C). **Range:** Low C2–C4, Mid C3–C5, High C4–C6.
- Keyboard: **A** assist · **V** voice · **S** scale · **R** range · **L** learn a song · **H** help.
- On a phone, prop it up and step back so both hands fit. Landscape gives the
  most room.

Feel details: hands are tracked by position (not MediaPipe's left/right label),
roles are sticky, a volume hand that drops out of frame keeps its level for
1.5 s, a hand passing through must be seen briefly before it sounds, and a
hand reaching into the toolbar stops playing.

### Learn a song

Press **Learn** (or tap the song name in a lesson) to pick from the song list,
which shows what each song teaches and your best stars. Public-domain songs,
easiest first: Hot Cross Buns, Mary Had a Little Lamb, When the Saints Go
Marching In, Jingle Bells, London Bridge, Lightly Row, Baa Baa Black Sheep,
Twinkle Twinkle Little Star, Old MacDonald Had a Farm and Ode to Joy.

1. **Step 1 · Learn.** The song's notes appear as a ribbon of blocks. The song
   only moves while you are on the right note, so take as long as you need.
   An arrow and the coach line show which way to move (higher or lower), and
   the words of the song follow along.
2. **Step 2 · Play.** After a four-beat count-in the ribbon moves in time.
   A note counts if you stayed on it for a fair share of its length (there is
   a short grace period to get there). Hitting 90% of the notes earns three
   stars, 70% two, 40% one; your best is kept per song.

**Listen** (or <kbd>P</kbd>) plays the song for you first: the ribbon moves
in time and the marker rides each note while the theremin sings it. When it
ends, the song is reset for your turn.

During a lesson the range is fitted to the song so its notes sit far apart,
the scale is C major, notes snap, and the volume dips for a moment between
notes so repeated notes ("Baa, baa") sound separate. **Speed** is Slow (60
bpm), Medium (80) or Fast (100).

## Run locally

The camera only works over HTTPS or on `localhost`, so opening `index.html`
directly from disk won't work. Serve the folder instead:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

### Mouse test mode

Add `?mouse=1` (e.g. http://localhost:8000/?mouse=1) to skip the camera and
play with a mouse or touchscreen. The app also falls back to mouse mode on its
own if the camera is denied or missing. Mouse input goes through the same
interaction code as hands, so it's a quick way to test changes.

### Tests

Open http://localhost:8000/tests.html. It checks the pitch math (halving
length raises an octave, clamping, scale snapping, note names), pinch
hysteresis, video mirroring, simulated hand gestures (drawing, plucking,
strumming, cooldowns), the theremin's mapping, assist, roles and
volume memory, and the song lessons on both instruments (waiting, timing,
scoring, the harp layout and slot matching). The theremin also has mouse mode: `theremin.html?mouse=1`.

## How it works

| File | Role |
|---|---|
| `js/tracking.js` | MediaPipe Tasks Vision Hand Landmarker (pinned `@mediapipe/tasks-vision@1.2.2`, GPU with CPU fallback), webcam setup and friendly errors |
| `js/one-euro.js` | One Euro filter to smooth fingertip jitter without adding lag |
| `js/gestures.js` | Turns landmarks (or the mouse) into "pointers": pinch point, fingertip, pinch state with hysteresis |
| `js/interaction.js` | Draw / pinch-pull-release / strum rules |
| `js/strings.js` | String geometry, pull shape, damped standing-wave vibration, glow rendering |
| `js/pitch.js` | Pure functions: length → frequency, scale snapping, note names |
| `js/audio.js`, `js/ks-worklet.js` | Karplus-Strong plucked-string synthesis in an AudioWorklet (buffer fallback), small generated reverb, limiter |
| `js/ui.js`, `js/main.js` | Toolbar, hints, status, boot flow and render loop |
| `js/audio-core.js` | Shared Web Audio setup for both instruments: iOS audio session, tap-to-resume, reverb, limiter |
| `js/theremin-map.js` | Theremin logic (pure, tested): layout, hand roles, pitch/volume/tone mapping, Assist, vibrato split, volume memory |
| `js/theremin-synth.js` | Theremin voice: two oscillators, tone filter, smooth glides, three voices |
| `js/theremin-main.js` | Theremin page: boot, frame loop, pinch-and-hold controls, drawing |
| `js/lessons.js` | Song lessons (pure, tested): the songs, the theremin's learn and play steps, scoring |
| `js/string-lessons.js` | Air Strings lessons (pure, tested): harp layout, slot matching, playing a song string by string |
| `js/fx.js` | Sparks when you hit a note, and confetti for three stars (one particle list, additive blending, capped). |
| `js/song-picker.js` | The song list shared by both instruments: songs, what they teach, stars earned, *Next up*. |
| `js/string-lesson-main.js` | Air Strings lessons on the page: controls, coaching, drawing |
| `js/lesson-view.js` | Draws the lesson ribbon |

The synth excites a delay line one period long with a burst of filtered noise,
shaped by where you plucked (plucking near the middle mutes even harmonics), and
feeds it back through a gentle low-pass, which is what makes it sound like a
string rather than a beep.

## Browser support

Recent Chrome, Edge and Safari (desktop), plus Safari on iPhone and iPad.
Firefox works but hand tracking may be slower. Audio starts after you tap
**Tap to start**, as browsers require.

**iPhone / iPad:** Safari pauses web audio after the camera permission prompt,
app switching, locking the screen, calls or Siri, and only lets it restart
after a real tap (a hand pinch doesn't count). When that happens, a
"Sound paused" banner appears; tap anywhere to bring sound back. The app asks
iOS for playback audio, so it should play even with the ring/silent switch
on silent.

## License

MIT
