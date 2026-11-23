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

Keyboard: **Z** undo · **C** clear · **H** help.

**Pitch:** frequency is inversely proportional to length, measured as a
fraction of the screen diagonal, so it works the same at any window size.
A string 8% of the diagonal plays E5, and 64% plays E2. Halve a string and it
goes up an octave. **Snap** rounds notes to the chromatic scale or E major
pentatonic (E F# G# B C#), or leave it off for exact, slide-able pitch.

If a pinch pulls a string too far, it slips out of your fingers and plucks at
full volume, just like a real one.

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
hysteresis, video mirroring, and simulated hand gestures (drawing, plucking,
strumming, cooldowns).

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
