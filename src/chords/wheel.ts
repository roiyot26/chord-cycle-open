const TAU = Math.PI * 2;

/**
 * Fraction of the wheel radius that counts as the neutral center. Resting your
 * hand near the middle should select nothing — without a dead zone the selection
 * flails wildly as the pointer crosses the origin.
 */
export const DEAD_ZONE = 0.18;
/** Beyond this the hand is considered off the wheel entirely. */
export const OUTER_LIMIT = 1.25;

export interface WheelHit {
  /** Slot under the pointer, or -1 for dead zone / off-wheel. */
  index: number;
  /** Distance from center, in units of wheel radius. */
  radius: number;
  /** Clockwise angle from 12 o'clock, in radians. */
  angle: number;
  /** How far into the wedge the pointer is: 0 at a boundary, 1 at the center line. */
  centrality: number;
}

/** Clockwise angle from 12 o'clock, normalized to [0, 2π). */
export function pointerAngle(dx: number, dy: number): number {
  return (Math.atan2(dx, -dy) + TAU) % TAU;
}

export function slotCenterAngle(index: number, count: number): number {
  return (index * TAU) / count;
}

export function hitTest(dx: number, dy: number, radius: number, count: number): WheelHit {
  const r = Math.hypot(dx, dy) / radius;
  const angle = pointerAngle(dx, dy);
  if (count <= 0 || r < DEAD_ZONE || r > OUTER_LIMIT) {
    return { index: -1, radius: r, angle, centrality: 0 };
  }
  const wedge = TAU / count;
  const index = Math.floor((angle + wedge / 2) / wedge) % count;
  // Signed offset from the wedge's center line, wrapped into [-wedge/2, wedge/2].
  let offset = angle - index * wedge;
  if (offset > Math.PI) offset -= TAU;
  if (offset < -Math.PI) offset += TAU;
  return { index, radius: r, angle, centrality: 1 - Math.abs(offset) / (wedge / 2) };
}

export interface SelectorOptions {
  /** Fraction of a half-wedge the pointer must clear before a new slot is eligible. */
  edgeMargin: number;
  /** How long the pointer must stay on a new slot before it commits, in ms. */
  dwellMs: number;
  /** Floor on how often the selection may change, in ms. */
  minHoldMs: number;
}

export const DEFAULT_SELECTOR_OPTIONS: SelectorOptions = {
  edgeMargin: 0.22,
  dwellMs: 90,
  minHoldMs: 120,
};

/**
 * Commits wheel hits to a stable selection.
 *
 * Raw hit-testing machine-guns chords whenever the hand hovers on a boundary, so
 * a new slot has to earn the switch three ways: be meaningfully inside its wedge,
 * hold for a beat, and respect a floor on the change rate.
 */
export class WedgeSelector {
  private current = -1;
  private candidate = -1;
  private candidateSince = 0;
  private lastChangeAt = -Infinity;

  constructor(private options: SelectorOptions = DEFAULT_SELECTOR_OPTIONS) {}

  setOptions(options: Partial<SelectorOptions>): void {
    this.options = { ...this.options, ...options };
  }

  get selected(): number {
    return this.current;
  }

  reset(): void {
    this.current = -1;
    this.candidate = -1;
    this.lastChangeAt = -Infinity;
  }

  /** Returns the committed slot index, or -1 for none. */
  update(hit: WheelHit, nowMs: number): number {
    if (hit.index < 0) {
      // Dead zone or off-wheel: hold whatever is selected rather than dropping it.
      // Letting your hand rest in the middle should be a rest, not a reset — the
      // sound is gated by openness, and releasing the chord here would also mean
      // re-attacking it every time the pointer crossed the origin.
      this.candidate = -1;
      return this.current;
    }

    if (hit.index === this.current) {
      this.candidate = -1;
      return this.current;
    }

    if (hit.centrality < this.options.edgeMargin) {
      // Still in the boundary band — not a real move yet.
      this.candidate = -1;
      return this.current;
    }

    if (hit.index !== this.candidate) {
      this.candidate = hit.index;
      this.candidateSince = nowMs;
    }

    const dwelled = nowMs - this.candidateSince >= this.options.dwellMs;
    const cooledDown = nowMs - this.lastChangeAt >= this.options.minHoldMs;
    if (dwelled && cooledDown) {
      this.current = hit.index;
      this.lastChangeAt = nowMs;
      this.candidate = -1;
    }
    return this.current;
  }
}
