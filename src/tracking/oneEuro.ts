/**
 * One Euro filter (Casiez, Roussel & Vogel, CHI 2012).
 *
 * An EMA is the obvious choice for smoothing landmarks and it is the wrong one:
 * whatever constant you pick is either too jittery when the hand is still or too
 * laggy when it moves. One Euro adapts its cutoff to the observed speed, so it
 * damps hard at rest and gets out of the way during fast motion — exactly the
 * tradeoff a pointing task wants.
 */

class LowPass {
  private prev: number | null = null;

  filter(x: number, alpha: number): number {
    const y = this.prev === null ? x : alpha * x + (1 - alpha) * this.prev;
    this.prev = y;
    return y;
  }

  reset(): void {
    this.prev = null;
  }
}

export class OneEuroFilter {
  private readonly x = new LowPass();
  private readonly dx = new LowPass();
  private lastTimeMs: number | null = null;
  private lastRaw: number | null = null;

  constructor(
    /** Cutoff at zero speed, in Hz. Lower = smoother but laggier at rest. */
    private minCutoff = 1.2,
    /** Speed coefficient. Higher = snappier during fast motion. */
    private beta = 0.02,
    /** Cutoff for the derivative estimate, in Hz. */
    private dCutoff = 1.0,
  ) {}

  private static alpha(cutoffHz: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoffHz);
    return 1 / (1 + tau / dt);
  }

  filter(value: number, timestampMs: number): number {
    const dt =
      this.lastTimeMs === null ? 1 / 60 : Math.min(Math.max((timestampMs - this.lastTimeMs) / 1000, 1e-4), 0.25);
    this.lastTimeMs = timestampMs;

    const rawDerivative = this.lastRaw === null ? 0 : (value - this.lastRaw) / dt;
    this.lastRaw = value;

    const speed = this.dx.filter(rawDerivative, OneEuroFilter.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(speed);
    return this.x.filter(value, OneEuroFilter.alpha(cutoff, dt));
  }

  reset(): void {
    this.x.reset();
    this.dx.reset();
    this.lastTimeMs = null;
    this.lastRaw = null;
  }
}

/** Two independent One Euro filters, for filtering a point. */
export class OneEuroPoint {
  private readonly fx: OneEuroFilter;
  private readonly fy: OneEuroFilter;

  constructor(minCutoff?: number, beta?: number, dCutoff?: number) {
    this.fx = new OneEuroFilter(minCutoff, beta, dCutoff);
    this.fy = new OneEuroFilter(minCutoff, beta, dCutoff);
  }

  filter(x: number, y: number, timestampMs: number): { x: number; y: number } {
    return { x: this.fx.filter(x, timestampMs), y: this.fy.filter(y, timestampMs) };
  }

  reset(): void {
    this.fx.reset();
    this.fy.reset();
  }
}
