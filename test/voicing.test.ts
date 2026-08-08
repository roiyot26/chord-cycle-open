import assert from "node:assert/strict";
import test from "node:test";

import { chordChromas, isValidChordSymbol, midiToFreq, voiceLead } from "../src/chords/voicing";

test("parses the chord vocabulary the presets rely on", () => {
  assert.deepEqual(chordChromas("C"), [0, 4, 7]);
  assert.deepEqual(chordChromas("Am"), [9, 0, 4]);
  assert.deepEqual(chordChromas("F#7sus4"), [6, 11, 1, 4]);
  assert.deepEqual(chordChromas("Emaj7"), [4, 8, 11, 3]);
  assert.ok(isValidChordSymbol("Dm7"));
  assert.ok(isValidChordSymbol("Em7b5"));
  assert.ok(!isValidChordSymbol("not-a-chord"));
  assert.ok(!isValidChordSymbol(""));
});

test("every preset symbol is playable", async () => {
  const { PRESETS } = await import("../src/chords/presets");
  for (const preset of PRESETS) {
    assert.ok(preset.slots.length >= 2, `${preset.id} needs at least two slots`);
    for (const symbol of preset.slots) {
      assert.ok(isValidChordSymbol(symbol), `${preset.id}: "${symbol}" does not parse`);
      assert.ok(voiceLead(symbol, null), `${preset.id}: "${symbol}" produced no voicing`);
    }
  }
});

test("a voicing lands in a playable register with the root in the bass", () => {
  const v = voiceLead("Cmaj7", null);
  assert.ok(v);
  assert.equal(v.notes.length, 4);
  for (const note of v.notes) {
    assert.ok(note >= 52 && note <= 79, `${note} outside the body range`);
  }
  assert.equal(v.bass % 12, 0, "bass should be a C");
  assert.ok(v.bass >= 33 && v.bass <= 48);
  assert.ok(v.notes.every((n) => n > v.bass), "the bass should sit below the body");
});

test("voice leading moves less than root position would", () => {
  // C -> G in root position is a 7-semitone leap in every voice.
  const from = voiceLead("C", null);
  assert.ok(from);
  const to = voiceLead("G", from.notes);
  assert.ok(to);

  const movement = to.notes.reduce(
    (sum, note) => sum + Math.min(...from.notes.map((p) => Math.abs(note - p))),
    0,
  );
  assert.ok(movement <= 6, `total movement ${movement} semitones is too much for C -> G`);
});

test("a long progression does not drift out of register", () => {
  const cycle = ["C", "G", "D", "A", "E", "B", "F#", "C#", "G#", "D#", "A#", "F"];
  let previous: number[] | null = null;
  for (let lap = 0; lap < 4; lap++) {
    for (const symbol of cycle) {
      const v = voiceLead(symbol, previous);
      assert.ok(v, `${symbol} failed`);
      for (const note of v.notes) {
        assert.ok(note >= 52 && note <= 79, `${symbol} drifted to ${note}`);
      }
      previous = v.notes;
    }
  }
});

test("unparseable symbols yield no voicing rather than throwing", () => {
  assert.equal(voiceLead("wat", null), null);
  assert.equal(voiceLead("", [60]), null);
});

test("notes are spelled the way the chord spells them", () => {
  const a = voiceLead("A", null);
  assert.ok(a);
  assert.deepEqual(
    a.noteNames.map((n) => n.replace(/\d+$/, "")).sort(),
    ["A", "C#", "E"],
    "an A chord has a C#, not a Db",
  );

  const eb = voiceLead("Ebm", null);
  assert.ok(eb);
  assert.deepEqual(eb.noteNames.map((n) => n.replace(/\d+$/, "")).sort(), ["Bb", "Eb", "Gb"]);
});

test("note names round-trip to the MIDI numbers they label", async () => {
  const { Note } = await import("tonal");
  for (const symbol of ["A", "Ebm", "F#7sus4", "Cb", "B#dim", "Emaj7", "Bbmaj9"]) {
    const v = voiceLead(symbol, null);
    assert.ok(v, `${symbol} produced no voicing`);
    v.noteNames.forEach((name, i) => {
      assert.equal(Note.midi(name), v.notes[i], `${symbol}: "${name}" is not MIDI ${v.notes[i]}`);
    });
  }
});

test("midiToFreq is anchored at A440", () => {
  assert.equal(midiToFreq(69), 440);
  assert.ok(Math.abs(midiToFreq(60) - 261.6256) < 0.001);
  assert.ok(Math.abs(midiToFreq(81) - 880) < 1e-9);
});
