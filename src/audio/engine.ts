import { midiToFreq, type Voicing } from "../chords/voicing";
import { createImpulseResponse } from "./reverb";

/**
 * Scheduling lookahead. Web Audio events stamped with a bare `currentTime` can
 * land in the past by the time the graph processes them, which shows up as
 * clicks; a couple of frames of slack costs nothing perceptually.
 */
const LOOKAHEAD = 0.02;

const ATTACK = 0.055;
const RELEASE = 0.42;
/** Time constant for tracking the openness control. Long enough to smooth
 *  landmark noise, short enough that a fast squeeze still reads as a swell. */
const EXPRESSION_TAU = 0.06;

interface Voice {
  oscillators: OscillatorNode[];
  /** The detuned half of each pair, tracked so the detune control can retarget them. */
  detuned: OscillatorNode[];
  gain: GainNode;
  filter: BiquadFilterNode;
}

export interface EngineSettings {
  masterGain: number;
  reverbMix: number;
  /** Filter cutoff at full openness, in Hz. */
  brightness: number;
  detuneCents: number;
  bassEnabled: boolean;
}

export const DEFAULT_SETTINGS: EngineSettings = {
  masterGain: 0.55,
  reverbMix: 0.32,
  brightness: 4200,
  detuneCents: 7,
  bassEnabled: true,
};

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private expression!: GainNode;
  private dry!: GainNode;
  private wet!: GainNode;
  private convolver!: ConvolverNode;
  private voice: Voice | null = null;
  private settings: EngineSettings = { ...DEFAULT_SETTINGS };
  private currentVoicing: Voicing | null = null;

  get running(): boolean {
    return this.ctx !== null && this.ctx.state === "running";
  }

  get previousNotes(): number[] | null {
    return this.currentVoicing?.notes ?? null;
  }

  /** Must be called from a user gesture — browsers refuse to start audio otherwise. */
  async start(): Promise<void> {
    if (this.ctx) {
      await this.ctx.resume();
      return;
    }

    const ctx = new AudioContext({ latencyHint: "interactive" });
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.settings.masterGain;

    this.expression = ctx.createGain();
    this.expression.gain.value = 0;

    this.convolver = ctx.createConvolver();
    this.convolver.buffer = createImpulseResponse(ctx);

    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.setReverbMix(this.settings.reverbMix);

    // expression -> {dry, wet -> convolver} -> master -> out
    this.expression.connect(this.dry);
    this.expression.connect(this.wet);
    this.wet.connect(this.convolver);
    this.dry.connect(this.master);
    this.convolver.connect(this.master);
    this.master.connect(ctx.destination);

    await ctx.resume();
  }

  async suspend(): Promise<void> {
    this.releaseChord();
    await this.ctx?.suspend();
  }

  updateSettings(patch: Partial<EngineSettings>): void {
    this.settings = { ...this.settings, ...patch };
    if (!this.ctx) return;
    const t = this.ctx.currentTime + LOOKAHEAD;
    this.master.gain.setTargetAtTime(this.settings.masterGain, t, 0.03);
    this.setReverbMix(this.settings.reverbMix);
    for (const osc of this.voice?.detuned ?? []) {
      osc.detune.setTargetAtTime(this.settings.detuneCents, t, 0.05);
    }
  }

  private setReverbMix(mix: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + LOOKAHEAD;
    // Equal-power crossfade, so the perceived level holds steady across the sweep.
    this.dry.gain.setTargetAtTime(Math.cos((mix * Math.PI) / 2), t, 0.05);
    this.wet.gain.setTargetAtTime(Math.sin((mix * Math.PI) / 2), t, 0.05);
  }

  /**
   * Expression is a continuous parameter, deliberately decoupled from note
   * triggering: squeezing to a fist has to fade the chord out, not retrigger it.
   */
  setExpression(value01: number): void {
    if (!this.ctx || !this.voice) return;
    const t = this.ctx.currentTime + LOOKAHEAD;
    // Squared response — a linear map makes the bottom of the range feel dead,
    // because loudness is roughly logarithmic.
    this.expression.gain.setTargetAtTime(value01 * value01, t, EXPRESSION_TAU);
    const cutoff = 320 + this.settings.brightness * (0.25 + 0.75 * value01);
    this.voice.filter.frequency.setTargetAtTime(cutoff, t, EXPRESSION_TAU);
  }

  playChord(voicing: Voicing): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime + LOOKAHEAD;

    this.releaseVoice(this.voice, now);
    this.currentVoicing = voicing;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(1, now + ATTACK);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.6;
    filter.frequency.setValueAtTime(this.settings.brightness, now);

    gain.connect(filter);
    filter.connect(this.expression);

    const oscillators: OscillatorNode[] = [];
    const detuned: OscillatorNode[] = [];
    const midi = this.settings.bassEnabled ? [...voicing.notes, voicing.bass] : voicing.notes;
    // Normalize by voice count so a 5-note chord is not twice as loud as a triad.
    const perVoice = 0.9 / Math.sqrt(midi.length * 2);

    for (const note of midi) {
      const isBass = this.settings.bassEnabled && note === voicing.bass;
      const level = isBass ? perVoice * 1.15 : perVoice;
      for (const pair of [0, 1]) {
        const osc = ctx.createOscillator();
        osc.type = isBass ? "triangle" : "sawtooth";
        osc.frequency.setValueAtTime(midiToFreq(note), now);
        osc.detune.setValueAtTime(pair === 0 ? 0 : this.settings.detuneCents, now);

        const level0 = ctx.createGain();
        level0.gain.value = level * (pair === 0 ? 1 : 0.7);
        osc.connect(level0);
        level0.connect(gain);
        osc.start(now);
        oscillators.push(osc);
        if (pair === 1) detuned.push(osc);
      }
    }

    this.voice = { oscillators, detuned, gain, filter };
  }

  releaseChord(): void {
    if (!this.ctx) return;
    this.releaseVoice(this.voice, this.ctx.currentTime + LOOKAHEAD);
    this.voice = null;
    this.currentVoicing = null;
  }

  private releaseVoice(voice: Voice | null, at: number): void {
    if (!voice) return;
    voice.gain.gain.cancelScheduledValues(at);
    voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), at);
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, at + RELEASE);
    for (const osc of voice.oscillators) {
      osc.stop(at + RELEASE + 0.05);
      // Freeing the subgraph promptly keeps a long session from accumulating
      // hundreds of dead nodes.
      osc.onended = () => osc.disconnect();
    }
    setTimeout(
      () => {
        voice.gain.disconnect();
        voice.filter.disconnect();
      },
      (RELEASE + 0.2) * 1000,
    );
  }
}
