export interface WheelPreset {
  id: string;
  name: string;
  /** Chord symbols, slot 0 at 12 o'clock, running clockwise. */
  slots: string[];
  note?: string;
}

export const PRESETS: WheelPreset[] = [
  {
    id: "diatonic-c",
    name: "Diatonic — C major",
    slots: ["C", "Dm", "Em", "F", "G", "Am", "Bdim"],
    note: "Seven wide wedges. Every combination works, so it is the easiest place to start.",
  },
  {
    id: "pop-c",
    name: "Pop / singer-songwriter — C",
    slots: ["C", "G", "Am", "F", "Em", "Dm", "Csus4", "Fmaj7"],
  },
  {
    id: "neo-soul-e",
    name: "Neo-soul — E",
    slots: ["Emaj7", "C#m9", "F#m7", "B7sus4", "Amaj7", "G#m7", "C#7b9", "F#9"],
  },
  {
    id: "jae-wheel",
    name: "Reference wheel (B)",
    slots: ["B", "Em6", "A9", "D#7", "G#m", "A", "B7", "Emaj7", "E6", "G", "F#7sus4"],
    note: "Transcribed off the reference clip. One of its twelve labels was obscured, so this wheel has eleven slots.",
  },
  {
    id: "circle-of-fifths",
    name: "Circle of fifths (major)",
    slots: ["C", "G", "D", "A", "E", "B", "F#", "C#", "G#", "D#", "A#", "F"],
    note: "Twelve slots means 30° per wedge — accurate but twitchy. Expert mode.",
  },
  {
    id: "circle-of-fifths-minor",
    name: "Circle of fifths (relative minors)",
    slots: ["Am", "Em", "Bm", "F#m", "C#m", "G#m", "D#m", "A#m", "Fm", "Cm", "Gm", "Dm"],
  },
  {
    id: "ii-v-i",
    name: "ii–V–I workout (C)",
    slots: ["Dm7", "G7", "Cmaj7", "Em7b5", "A7", "Dm9", "G13", "Cmaj9"],
  },
];

export const DEFAULT_PRESET_ID = "diatonic-c";

export function getPreset(id: string): WheelPreset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}
