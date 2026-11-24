# Hand signs and Face control (2026-11-24)

Live at https://pokejaysim.github.io/air-strings/ (theremin: `/theremin.html`,
tests: `/tests.html`). If the page looks old, reload once: GitHub Pages caches
for about ten minutes.

## What shipped

| Step | What | Commit |
|---|---|---|
| 1 | **New hand model.** Hands are now tracked by Google's Gesture Recognizer instead of the plain Hand Landmarker. It gives the same 21 points (so drawing, plucking and the theremin work as before) plus a label for the hand's shape. If it can't load, the app falls back to the old model. | `2d4bb85` |
| 2 | **Hand signs** on both instruments: ✊ mute, 👍 yes, 👎 back, ✌️ switch instrument, 🤟 confetti. Hold the sign until the ring above your hand fills. Can be turned off in the help panel. | `f05bb53` |
| 3 | **Face control on the theremin.** The 🙂 button (or F) learns your resting face for a second. Then mouth open gives a brighter "wah", lips in an "oo" a darker hollow sound, and raised eyebrows an octave up (free play only). A little face badge mirrors yours. | `e80310e` |
| 4 | **Head tilt for vibrato** on the theremin, and **Face control for Air Strings**: mouth open lets notes ring up to 2.5× longer, eyebrows play an octave up (free play only). | `c063ae4` |

## Update: six more hand signs (`b62ac74`)

| Sign | Air Strings | Air Theremin |
|---|---|---|
| 🤘 Rock horns | Next Snap scale (free play) | Next voice (free play) |
| 🤙 Call me | Face on/off | Face on/off |
| Three fingers up | Listen / stop (lesson) | Listen / stop (lesson); next range (free play) |
| 👋 Wave | Clears the strings (free play); back to free play (lesson) | Back to free play (lesson) |
| 👍👍 Both thumbs up | Play in time (lesson) | Step 2, play in time (lesson) |
| ✊✊ Both fists | Clears the strings (free play); stops Listen (lesson) | Stops Listen |

- **How they're detected:** Google's model only knows seven shapes, and the
  two we don't use (open palm, pointing up) are how you play. So rock horns,
  call me and three fingers are read from finger positions. On Google's test
  photos, a raised fingertip sits at least 1.3× farther from the wrist than its
  middle joint, and a curled one at most 0.76×. The app calls a finger up
  above 1.15 and down below 0.95, and makes no sign in between.
- **Wave:** an open palm moving side to side, with three changes of direction
  and each swing at least a third of a hand wide. One long wave counts once.
- **Safety:**
  - Clearing strings can now be undone for 8 seconds (Undo, Z or 👎). This
    also covers the Clear button.
  - A wave that strums strings doesn't count, so wave beside or above them.
  - On the theremin, the new finger signs and waves only count from a hand
    that isn't playing a note.
- **Checked:** 116/116 tests pass. In the app, I folded fingers in the hand
  model's output from a real open-palm photo to make rock horns, call me and
  three fingers. I moved the photo side to side for the wave and used two
  photos side by side for the two-hand signs. Every action fired, including
  undo after a wave, the strum guard, and the playing-hand rule on the
  theremin.
- **Please try with real hands:**
  - Does 🤘 read reliably? A loose thumb may make it read as 🤟.
  - Is three fingers comfortable?
  - Does a real wave goodbye register, and does fast strumming ever count as a wave?

## How each was checked

- **Tests:** 110/110 pass, including 17 new ones covering hand-sign holds, flicker, cooldown, fist against pinch, face calibration, eyebrow on/off, tilt, the wah filter and the slow-device auto-off.
- **Real models on real photos:** the Gesture Recognizer correctly labelled Google's own test photos (fist 0.90, thumbs up 0.73, victory 0.78, pointing up 0.83). The Face Landmarker read all 52 expression scores from Google's test portrait.
- **End to end in the app:** I fed those photos in as a fake camera. Hand signs were checked one by one:
  - a fist muted a ringing string, and on the theremin silenced it only while held;
  - thumbs down removed a string, and restarted a lesson song;
  - thumbs up picked the song, and pressed "Play in time";
  - victory switched instruments;
  - "I love you" threw confetti.
- **Face, end to end:** the face calibrated from the photo. I couldn't change the photo's expression, so I added offsets to the live readings to check mouth, "oo", eyebrows and tilt.
- **Speed:** with the browser running freely, hand tracking ran at 33 fps, and 28–29 fps with Face on.
- **Layout:** checked at desktop, sideways phone (844×390) and portrait phone (390×844).

## Decisions I made

- **Which signs:** open palm and pointing up are left out, because those are how you play.
- **When a ring appears:** only when the sign would do something. A fist on Air Strings shows only while strings are ringing, and thumbs up only in a lesson with a card or the song list open. This keeps rings from popping up while you play.
- **Fist against pinch:** a fist used to count as a pinch, because thumb and index finger are close. Now a fist never starts a pinch, but only when the model says "fist" *and* the index fingertip is curled into its knuckle. A pinch with your other fingers curled still draws. A pinch already under way is never dropped.
- **Thumbs up on a result card** presses whatever the big button says (Next song, Play in time, Try again).
- **Eyebrow octave is free-play only**, so lessons stay on their notes. Mouth tone and tilt vibrato still work in lessons.
- **The theremin's mouth control:** while Face is on, the mouth takes over tone from the hand, using its own resonant filter. The normal tone filter barely changes a near-sine voice, so a mouth mapped to it would have felt like nothing.
- **Where the 🙂 button lives:**
  - in the toolbar on wide screens;
  - in the help panel on phones;
  - Air Strings' toolbar is fuller, so there it moves to the help panel below 1010 px wide, which keeps the toolbar on one row.
- **Auto-off:** Face switches itself off after 3 seconds below 15 fps. It only does this if the speed dropped by more than a fifth after Face came on, so a phone that was already slow isn't blamed on Face.

## Please test with your real hands and face

1. **Sign reliability.** Do the signs register at your playing distance and lighting? Does a fist ever fire while you're just playing? Does a pinch ever stop working?
2. **Fist on the theremin.** If you play with a loose fist, it will silence the theremin. Is that a problem for how you hold your hand?
3. **Mouth "wah" by ear**, especially on the Classic voice. Is it too strong or too weak, and is the resonance ever harsh? Sci-fi shows it most.
4. **Eyebrows.** Does the octave come on when you mean it, and stay off when you're concentrating?
5. **Head-tilt vibrato.** Does it start too easily (6° of tilt), and is full depth (25°) about right?
6. **iPhone speed with Face on.** Does the hand tracking stay smooth, or does Face switch itself off?
7. **Victory to switch instruments.** Is it easy to trigger by accident? The new page asks for the camera again.
