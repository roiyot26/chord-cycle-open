import { OneEuroFilter, OneEuroPoint } from "./oneEuro";

/** A normalized landmark as MediaPipe reports it: x/y in [0,1] of the input image. */
export interface Landmark {
  x: number;
  y: number;
  z: number;
}

// MediaPipe hand landmark indices.
export const WRIST = 0;
export const THUMB_TIP = 4;
export const INDEX_MCP = 5;
export const INDEX_TIP = 8;
export const MIDDLE_MCP = 9;
export const MIDDLE_TIP = 12;
export const RING_MCP = 13;
export const RING_TIP = 16;
export const PINKY_MCP = 17;
export const PINKY_TIP = 20;

const PALM_POINTS = [WRIST, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP];
const FINGER_TIPS = [INDEX_TIP, MIDDLE_TIP, RING_TIP, PINKY_TIP];

/**
 * Openness calibration, expressed as (mean fingertip→wrist distance / palm length).
 * Normalizing by palm length is what makes this depth-invariant — the raw pixel
 * distance changes as you move toward the camera, the ratio does not.
 *
 * The bounds come from typical hand proportions: fully spread, the four
 * fingertips average roughly 1.7 palm lengths from the wrist; curled into a fist
 * they fall inside the knuckles, under 0.9. Hand shapes vary, so these are the
 * numbers to nudge if the meter never reaches the ends of its travel.
 */
export const OPEN_CLOSED = 0.9;
export const OPEN_FULL = 1.7;

/** Pinch is considered closed below this thumb-tip→index-tip / palm-length ratio. */
const PINCH_ON = 0.32;
const PINCH_OFF = 0.42;

export interface HandFeatures {
  /** Palm centroid in normalized input-image coordinates. */
  palm: { x: number; y: number };
  /** Palm length (wrist → middle MCP) in normalized units — the hand's scale. */
  scale: number;
  /** 0 = fist, 1 = fully spread. */
  openness: number;
  /** True while thumb and index are touching (hysteretic). */
  pinched: boolean;
  /** Smoothed landmarks, for drawing. */
  landmarks: Landmark[];
}

function dist(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Turns a stream of raw landmark frames into stable control signals. One instance
 * per tracked hand — it carries filter state, so do not share it between hands.
 */
export class HandFeatureExtractor {
  private readonly palmFilter = new OneEuroPoint(1.0, 0.015);
  private readonly opennessFilter = new OneEuroFilter(1.6, 0.01);
  private readonly landmarkFilters = Array.from({ length: 21 }, () => new OneEuroPoint(1.6, 0.03));
  private pinched = false;

  reset(): void {
    this.palmFilter.reset();
    this.opennessFilter.reset();
    for (const f of this.landmarkFilters) f.reset();
    this.pinched = false;
  }

  extract(raw: Landmark[], timestampMs: number): HandFeatures | null {
    if (raw.length < 21) return null;

    const scale = dist(raw[WRIST], raw[MIDDLE_MCP]);
    // A degenerate scale means the detection is garbage; better to drop the frame
    // than to divide by it and emit a wild control value.
    if (scale < 1e-4) return null;

    let px = 0;
    let py = 0;
    for (const i of PALM_POINTS) {
      px += raw[i].x;
      py += raw[i].y;
    }
    const palm = this.palmFilter.filter(px / PALM_POINTS.length, py / PALM_POINTS.length, timestampMs);

    let spread = 0;
    for (const tip of FINGER_TIPS) spread += dist(raw[tip], raw[WRIST]);
    spread /= FINGER_TIPS.length * scale;
    const openness = clamp01(
      (this.opennessFilter.filter(spread, timestampMs) - OPEN_CLOSED) / (OPEN_FULL - OPEN_CLOSED),
    );

    // Schmitt trigger, so a pinch resting near the threshold does not chatter.
    const pinchRatio = dist(raw[THUMB_TIP], raw[INDEX_TIP]) / scale;
    if (this.pinched ? pinchRatio > PINCH_OFF : pinchRatio < PINCH_ON) this.pinched = !this.pinched;

    const landmarks = raw.map((lm, i) => {
      const p = this.landmarkFilters[i].filter(lm.x, lm.y, timestampMs);
      return { x: p.x, y: p.y, z: lm.z };
    });

    return { palm, scale, openness, pinched: this.pinched, landmarks };
  }
}

/** Landmark pairs to draw as bones. */
export const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];
