/**
 * Synthesizes a plausible hall impulse response instead of shipping a WAV.
 * Exponentially-decaying noise is not a real room, but through a pad at a modest
 * wet level it is indistinguishable from one, and it costs no bytes.
 */
export function createImpulseResponse(ctx: BaseAudioContext, seconds = 2.6, decay = 2.4): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // A short fade-in avoids the click of a hard impulse at sample zero.
      const attack = Math.min(1, i / (ctx.sampleRate * 0.01));
      data[i] = (Math.random() * 2 - 1) * attack * Math.pow(1 - t, decay);
    }
  }
  return buffer;
}
