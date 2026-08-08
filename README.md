# chord-cycle-open

A chord wheel you play with your hands, in the browser. Point at a wedge to pick
the chord; open your hand to swell, close it to fade out.

No install, no plugins, no MIDI hardware — a webcam and a browser tab.

```
npm install
npm run setup    # copies the MediaPipe runtime, downloads the hand model
npm run dev
```

Then open the printed URL and allow camera access. `getUserMedia` needs a secure
context, so use `localhost` or HTTPS.

## How it plays

| Gesture | What it does |
| --- | --- |
| Move your hand around the wheel | Picks the chord under your palm |
| Open / close your hand | Swells and fades the chord (the `% OPEN` meter) |
| Rest your hand near the middle | Holds the current chord — the dead zone selects nothing |
| Pinch thumb to index | Latches the chord so you can move freely; pinch again to release |

The **Wheel** panel picks a preset, edits any slot to an arbitrary chord symbol,
and copies a share link. Slot edits accept anything [tonal](https://github.com/tonaljs/tonal)
can parse — `Cmaj7`, `F#7sus4`, `Em7b5`, `A13`.

## How it works

```
camera ─▶ HandLandmarker ─▶ One Euro filter ─▶ palm angle ─▶ WedgeSelector ─▶ voice leading ─▶ Web Audio
                                            └▶ hand openness ────────────────────────────────▶ expression gain
```

- **`src/tracking/`** — MediaPipe Tasks Vision wrapper, One Euro filtering, and
  the landmark → control-signal math (palm centroid, openness, pinch).
- **`src/chords/`** — wheel geometry and hit testing, the hysteretic selector,
  chord-symbol parsing, and voice leading.
- **`src/audio/`** — the Web Audio graph: detuned saw/triangle voices, a lowpass
  driven by openness, and a synthesized convolution reverb.
- **`src/ui/`** — canvas renderer and the settings panel.

Four decisions carry most of the feel:

**Palm centroid, not fingertip.** The pointer is the mean of the wrist and the
four knuckles. A fingertip is far noisier and moves when you open your hand,
which would couple the two controls together.

**One Euro filter, not an EMA.** Any fixed smoothing constant is either jittery
at rest or laggy in motion. One Euro adapts its cutoff to hand speed and gets
both.

**Hysteresis on selection.** A new wedge has to be entered decisively
(`edgeMargin`), held briefly (`dwellMs`), and respect a change-rate floor
(`minHoldMs`). Without all three, a hand resting on a boundary machine-guns
chords. All three are exposed under **Feel** in the panel.

**Voice leading.** Each chord is placed at the octave that moves least from the
previous one, instead of stacking root position at a fixed octave. It is the
difference between "MIDI demo" and something that sounds played.

## Tuning

`OPEN_CLOSED` / `OPEN_FULL` in `src/tracking/gestures.ts` calibrate the openness
range as a ratio of fingertip-to-wrist distance over palm length. The defaults
suit typical hand proportions; if the meter never reaches 0% or 100%, these are
the numbers to nudge.

## Development

```
npm test        # unit tests: wheel geometry, selector hysteresis, gestures, voicing
npm run build   # typecheck + production bundle
```

The tests drive the real gesture and wheel modules with synthetic landmark
sequences, so the control path — hand pose in, chord sequence out — is covered
without a camera.

## Not built yet

- A left-hand layer (filter, register, arpeggiator, strum) — the reference this
  was modeled on labels its wheel `RIGHT HAND — CHORDS`.
- Sampled instruments and Web MIDI output.
- Inner/outer rings, so radius picks triad vs. extended voicing.
- Recording to WAV.
