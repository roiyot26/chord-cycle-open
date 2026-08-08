import { Chord, Note } from "tonal";

export interface Voicing {
  /** MIDI note numbers for the chord body. */
  notes: number[];
  /** MIDI note number for the bass. */
  bass: number;
  /** Pitch classes actually sounded, for display. */
  noteNames: string[];
}

const BODY_LOW = 52; // E3
const BODY_HIGH = 79; // G5
const BODY_CENTER = 64; // E4 — where voicings drift back to when unconstrained
const BASS_LOW = 33; // A1
const BASS_HIGH = 48; // C3

/** A chord tone: its pitch class, and how the chord spells it. */
export interface ChordTone {
  chroma: number;
  name: string;
}

/**
 * Chord tones, root first. Empty if the symbol does not parse.
 *
 * The spelling is carried alongside the pitch class so the display can say
 * "A C# E" rather than respelling it out of MIDI as "A Db E".
 */
export function chordTones(symbol: string): ChordTone[] {
  const chord = Chord.get(symbol);
  if (chord.empty || chord.notes.length === 0) return [];
  const tones: ChordTone[] = [];
  for (const name of chord.notes) {
    const chroma = Note.chroma(name);
    if (chroma !== undefined && !tones.some((t) => t.chroma === chroma)) tones.push({ chroma, name });
  }
  return tones;
}

/** Pitch classes (0–11) of a chord symbol, root first. Empty if unparseable. */
export function chordChromas(symbol: string): number[] {
  return chordTones(symbol).map((t) => t.chroma);
}

export function isValidChordSymbol(symbol: string): boolean {
  return chordTones(symbol).length > 0;
}

/**
 * Places each pitch class at the octave that moves least from the previous
 * voicing. Without this every chord lands in root position at a fixed octave and
 * the result sounds like a MIDI file demo rather than someone playing keys.
 */
export function voiceLead(symbol: string, previous: number[] | null): Voicing | null {
  const tones = chordTones(symbol);
  if (tones.length === 0) return null;

  const anchors = previous && previous.length > 0 ? previous : [BODY_CENTER];
  const placed: Array<{ midi: number; name: string }> = [];

  for (const tone of tones) {
    let best = -1;
    let bestCost = Infinity;
    for (let midi = BODY_LOW; midi <= BODY_HIGH; midi++) {
      if (midi % 12 !== tone.chroma) continue;
      let nearest = Infinity;
      for (const a of anchors) nearest = Math.min(nearest, Math.abs(midi - a));
      // The center term is a gentle spring: it keeps long progressions from
      // ratcheting toward one end of the range one small step at a time.
      const cost = nearest + 0.12 * Math.abs(midi - BODY_CENTER);
      if (cost < bestCost) {
        bestCost = cost;
        best = midi;
      }
    }
    if (best >= 0 && !placed.some((p) => p.midi === best)) placed.push({ midi: best, name: tone.name });
  }

  if (placed.length === 0) return null;
  placed.sort((a, b) => a.midi - b.midi);

  const rootChroma = tones[0].chroma;
  let bass = BASS_LOW + ((((rootChroma - BASS_LOW) % 12) + 12) % 12);
  if (bass > BASS_HIGH) bass -= 12;

  return {
    notes: placed.map((p) => p.midi),
    bass,
    noteNames: placed.map((p) => spell(p.name, p.midi)),
  };
}

/**
 * Attaches the octave number to a pitch-class name. The obvious `midi / 12`
 * arithmetic is off by one for enharmonic spellings that cross the octave
 * boundary — Cb4 and B3 are the same key — so the octave is verified rather
 * than assumed.
 */
function spell(name: string, midi: number): string {
  const estimate = Math.floor(midi / 12) - 1;
  for (const octave of [estimate, estimate + 1, estimate - 1]) {
    if (Note.midi(`${name}${octave}`) === midi) return `${name}${octave}`;
  }
  return Note.fromMidi(midi);
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
