# Morning report: overnight improvements (2026-11-23)

Everything below is live at https://pokejaysim.github.io/air-strings/
(theremin: `/theremin.html`, tests: `/tests.html`, 93/93 passing on the live
site). If the page looks old, reload once: GitHub Pages caches for about ten
minutes.

All seven items on your list shipped, plus three extras. Nothing was tested
with real hands, a real webcam, an iPhone or ears. See the last section.

## What shipped

| # | What | Commit |
|---|------|--------|
| 1 | **Air Strings step 3 · In time.** A four-beat count-in (it waits for your hand), then notes travel along each string to a line across the harp. Pluck as each touches the line: within 0.12 s is *perfect*, within 0.3 s is *good*. A Speed button picks Slow, Medium or Fast. | `0d1ed38` |
| 2 | **Listen** button (or <kbd>P</kbd>) on both instruments. The app plays the song itself while the strings light up or the ribbon moves, then hands back with "Your turn!". | `ffc57e5` |
| – | **Fix found while checking item 2 live:** right after an update, a browser can pair the cached old page with the new scripts. Air Strings then failed to start. Scripts now tolerate a missing button. | `d675518` |
| 3 | **Song picker.** Learn, or tapping the song name, opens a list of every song: what it teaches, stars earned (*Pace* and *In time* for Air Strings), and the first unstarred song marked *Next up*. Songs are big buttons, so a pinch can pick one. | `1da0e6e` |
| 4 | **Five more songs** (10 total), easiest first: Hot Cross Buns, Mary Had a Little Lamb, **When the Saints Go Marching In**, **Jingle Bells** (chorus), **London Bridge**, **Lightly Row**, Baa Baa Black Sheep, Twinkle, **Old MacDonald Had a Farm**, Ode to Joy. | `fd02881` |
| 5 | **Visual polish.** In lessons each note name has its own colour (C red, D orange, E yellow, F green, G blue, A violet), on the strings, the next-notes strip, the outlines and the travelling notes. Right notes throw sparks on both instruments. The theremin's note glows while you're on it. Three stars bring confetti. | `c0fa914` |
| 6 | **Streak counter** in timed play on both instruments. It pops as it grows, turns gold at 10, and cheers at 10/25/50/100. The best streak shows on the result card. | `34ba311` |
| 7 | **Phone overlap fix.** Lesson messages now take over the coach line at the bottom, highlighted in gold, instead of popping up over the next-notes strip and the top string. On a phone held sideways the lesson coach is smaller and hugs the bottom edge, and the "stretch to here" label no longer runs off the screen. | `1f6f06a` |
| + | **Count-in click** on the theremin too. Both instruments now share one clean metronome click. | `339be08` |
| + | **Stars on the Learn button** ("Learn ★ 9"), so progress shows from free play. The theremin hides it on a narrow phone to keep one toolbar row. | `ea55552` |

## Tried and dropped, or changed along the way

- **Step 3's first layout on wide screens** put the now-line high, so notes appeared only a beat or two ahead. When there's room, the harp now moves down so notes fall about four beats.
- **Songs that don't fit the harp:** Frère Jacques, Row Row Row Your Boat, Yankee Doodle and the middle of Au Clair de la Lune all need notes outside C4–A4. I left them out rather than change the tunes.
- **Note colours on the theremin ribbon:** not done. Its guides and zones use a low-to-high colour gradient, and mixing the two schemes looked confusing.
- **Correcting step 3 for camera lag:** not done. It can't be tuned without real hands. See below.

## Decisions I made for you

- **Step order:** the Step button cycles Build → Play at your pace → In time → back to Build (this last step clears the harp, as before).
- **Speeds:** step 3 runs a bit slower than the theremin (50, 66, 84 bpm against 60, 80, 100), because a pluck takes longer than a slide.
- **Scoring in step 3:** a stray pluck costs half a note, so strumming everything nonstop earns at most one star.
- **Stars:** step 3 stars are saved separately from step 2 stars. The song label shows the better of the two; the picker shows both.
- **Lesson flow:** Learn now opens the song picker first. The result card's "Next song" still goes straight to the next one.
- **Song order and melodies:** the order is my judgement (number of different notes, leaps, rhythm). I wrote the new melodies from memory: **please listen to each once** to check they sound right. Jingle Bells is the chorus only.
- **Your saved song** may now point at a different song, because the list was reordered. Stars are saved by song, so none were lost.
- **Short screens:** on a phone held sideways, during step 3 the coach line hides so the strings get the room. The status pill hides during lessons.
- **Narrow phones:** in lessons the "?" help button steps aside so the five lesson buttons fit on one row.

## Please test with real hands (webcam and iPhone)

The in-app browser ran at only one or two frames a second for most of the
night. So timing and animation were checked with unit tests, by jumping the
song clock forward, and with simulated hands, not by watching them run smoothly.

1. **Step 3 timing with the camera.** Is plucking on the line fair, or do notes feel late? There is no correction for camera lag yet. If it feels consistently late, the fix is a small offset; tell me roughly how late.
2. **Step 3 on an iPhone held sideways.** The strings are short there. Can you see notes coming early enough, and swipe one string without catching its neighbour?
3. **Listen:** does each song sound right, especially the five new ones? On the theremin, is the sung demo pleasant?
4. **Count-in clicks:** are they audible on the iPhone, and not too loud?
5. **Song picker by pinch:** can you pick a song with a pinch from a normal playing distance?
6. **Sparks and confetti:** do they stay smooth on the iPhone while hand tracking runs?
7. **Theremin on a phone held sideways:** the compact message line covers part of the note-name row at the bottom of the pitch zone. Is that acceptable?
