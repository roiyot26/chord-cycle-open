import assert from "node:assert/strict";
import test from "node:test";

import { HandFeatureExtractor, type Landmark } from "../src/tracking/gestures";
import { WedgeSelector, hitTest } from "../src/chords/wheel";

/**
 * Builds a plausible 21-point hand.
 *
 * Landmarks are laid out radially from the wrist along each finger's own axis, at
 * a length driven by `curl`, which is what the real hand does as it closes. It is
 * not anatomically exact, but it reproduces the two properties the app reads:
 * the palm centroid's position and the fingertip-to-wrist ratio.
 */
function makeHand(cx: number, cy: number, options: { curl?: number; scale?: number; pinch?: boolean } = {}): Landmark[] {
  const { curl = 0, scale = 0.12, pinch = false } = options;
  const lm: Landmark[] = new Array(21);
  const at = (dx: number, dy: number): Landmark => ({ x: cx + dx * scale, y: cy + dy * scale, z: 0 });

  lm[0] = at(0, 0.55); // wrist, below the palm

  // MCP knuckles sit at a fixed spot; only the joints beyond them fold in.
  // `knuckle` is the palm length the extractor normalizes by, so the finger
  // lengths below are set to give realistic tip/palm ratios when fully open:
  // roughly 1.75 for index and ring, 1.9 for middle, 1.45 for the pinky.
  const knuckle = 0.55;
  const fingers: Array<{ mcp: number; angle: number; length: number }> = [
    { mcp: 5, angle: -0.42, length: knuckle * 1.75 },
    { mcp: 9, angle: -0.05, length: knuckle * 1.9 },
    { mcp: 13, angle: 0.3, length: knuckle * 1.75 },
    { mcp: 17, angle: 0.62, length: knuckle * 1.45 },
  ];

  for (const { mcp, angle, length } of fingers) {
    const ux = Math.sin(angle);
    const uy = -Math.cos(angle);
    lm[mcp] = at(ux * knuckle, 0.55 + uy * knuckle);
    const reach = length * (1 - 0.55 * curl);
    for (let joint = 1; joint <= 3; joint++) {
      const t = knuckle + ((reach - knuckle) * joint) / 3;
      lm[mcp + joint] = at(ux * t, 0.55 + uy * t);
    }
  }

  // Thumb, angled off to the side; pinching folds it onto the index tip.
  const indexTip = lm[8];
  for (let i = 1; i <= 4; i++) {
    const t = i / 4;
    lm[i] = pinch
      ? { x: lm[0].x + (indexTip.x - lm[0].x) * t, y: lm[0].y + (indexTip.y - lm[0].y) * t, z: 0 }
      : at(-0.85 * t, 0.55 - 0.35 * t);
  }

  return lm;
}

/** The palm centroid the extractor computes, for positioning assertions. */
function palmOf(lm: Landmark[]): { x: number; y: number } {
  const idx = [0, 5, 9, 13, 17];
  return {
    x: idx.reduce((s, i) => s + lm[i].x, 0) / idx.length,
    y: idx.reduce((s, i) => s + lm[i].y, 0) / idx.length,
  };
}

/** Runs the extractor long enough for its filters to settle. */
function settle(extractor: HandFeatureExtractor, lm: Landmark[], startMs = 0, frames = 40) {
  let out = null;
  for (let i = 0; i < frames; i++) out = extractor.extract(lm, startMs + i * (1000 / 60));
  assert.ok(out);
  return out;
}

test("openness spans the range from fist to open palm", () => {
  const open = settle(new HandFeatureExtractor(), makeHand(0.5, 0.5, { curl: 0 }));
  const fist = settle(new HandFeatureExtractor(), makeHand(0.5, 0.5, { curl: 1 }));

  assert.ok(open.openness > 0.75, `open palm read ${open.openness.toFixed(2)}`);
  assert.ok(fist.openness < 0.15, `fist read ${fist.openness.toFixed(2)}`);
});

test("openness is invariant to how close the hand is to the camera", () => {
  const near = settle(new HandFeatureExtractor(), makeHand(0.5, 0.5, { curl: 0.4, scale: 0.22 }));
  const far = settle(new HandFeatureExtractor(), makeHand(0.5, 0.5, { curl: 0.4, scale: 0.08 }));
  assert.ok(
    Math.abs(near.openness - far.openness) < 0.05,
    `depth changed openness: ${near.openness.toFixed(3)} vs ${far.openness.toFixed(3)}`,
  );
});

test("openness falls monotonically as the hand closes, and uses its full travel", () => {
  const curls = [0, 0.25, 0.5, 0.75, 1];
  const values = curls.map((curl) => settle(new HandFeatureExtractor(), makeHand(0.5, 0.5, { curl })).openness);

  for (let i = 1; i < values.length; i++) {
    assert.ok(values[i] <= values[i - 1], `curl ${curls[i]} raised openness to ${values[i].toFixed(3)}`);
  }
  // The ends of the range clamp by design; the interior must still be responsive,
  // or the control has a dead spot in the middle of its travel.
  assert.ok(values[1] > values[2] && values[2] > values[3], `flat interior: ${values.map((v) => v.toFixed(2))}`);
  assert.ok(values[0] > 0.9, `open palm should reach the top of the range, got ${values[0].toFixed(2)}`);
  assert.ok(values[4] < 0.1, `fist should reach the bottom of the range, got ${values[4].toFixed(2)}`);
});

test("pinch is detected and does not chatter on an open hand", () => {
  const pinched = settle(new HandFeatureExtractor(), makeHand(0.5, 0.5, { pinch: true }));
  assert.equal(pinched.pinched, true);
  const relaxed = settle(new HandFeatureExtractor(), makeHand(0.5, 0.5, { pinch: false }));
  assert.equal(relaxed.pinched, false);
});

test("a one-frame pinch glitch does not register", () => {
  const extractor = new HandFeatureExtractor();
  const open = makeHand(0.5, 0.5, { pinch: false });
  const glitch = makeHand(0.5, 0.5, { pinch: true });

  let now = 0;
  const step = (lm: typeof open) => {
    const out = extractor.extract(lm, now);
    now += 1000 / 60;
    return out;
  };

  for (let i = 0; i < 30; i++) step(open);
  // A single bad frame — thumb momentarily occluded — must not latch anything.
  assert.equal(step(glitch)?.pinched, false);
  for (let i = 0; i < 5; i++) assert.equal(step(open)?.pinched, false);

  // A deliberate pinch, held, still registers.
  let held = false;
  for (let i = 0; i < 30; i++) held = step(glitch)?.pinched ?? false;
  assert.equal(held, true, "a sustained pinch should still be detected");
});

test("a degenerate detection is dropped rather than emitted as a wild value", () => {
  const extractor = new HandFeatureExtractor();
  const collapsed: Landmark[] = new Array(21).fill(null).map(() => ({ x: 0.5, y: 0.5, z: 0 }));
  assert.equal(extractor.extract(collapsed, 0), null);
  assert.equal(extractor.extract(makeHand(0.5, 0.5).slice(0, 12), 16), null);
});

test("landmarks smooth toward a step change instead of snapping to it", () => {
  const extractor = new HandFeatureExtractor();
  settle(extractor, makeHand(0.3, 0.5));
  const jumped = extractor.extract(makeHand(0.7, 0.5), 40 * (1000 / 60));
  assert.ok(jumped);
  assert.ok(
    jumped.palm.x < 0.6,
    `a single frame should not fully absorb a 0.4 jump, landed at ${jumped.palm.x.toFixed(3)}`,
  );
});

test("moving the hand around the wheel selects each chord in turn", () => {
  // Wheel geometry as the renderer lays it out, in normalized coordinates.
  const center = { x: 0.5, y: 0.5 };
  const radius = 0.3;
  const slots = ["C", "Dm", "Em", "F", "G", "Am", "Bdim"];

  const extractor = new HandFeatureExtractor();
  const selector = new WedgeSelector({ edgeMargin: 0.2, dwellMs: 60, minHoldMs: 80 });
  const played: number[] = [];
  let now = 0;

  for (let slot = 0; slot < slots.length; slot++) {
    const angle = (slot * 2 * Math.PI) / slots.length;
    const target = {
      x: center.x + Math.sin(angle) * radius * 0.65,
      y: center.y - Math.cos(angle) * radius * 0.65,
    };
    // Hold each position long enough for the filters to catch up and commit.
    for (let frame = 0; frame < 30; frame++) {
      const hand = extractor.extract(makeHand(target.x, target.y - 0.55 * 0.12), now);
      now += 1000 / 60;
      if (!hand) continue;
      const hit = hitTest(hand.palm.x - center.x, hand.palm.y - center.y, radius, slots.length);
      const committed = selector.update(hit, now);
      if (committed >= 0 && played[played.length - 1] !== committed) played.push(committed);
    }
  }

  assert.deepEqual(
    played.map((i) => slots[i]),
    slots,
    "sweeping the wheel should play every chord once, in wheel order",
  );
});

test("palm centroid tracks where the hand actually is", () => {
  const extractor = new HandFeatureExtractor();
  const lm = makeHand(0.62, 0.38);
  const settled = settle(extractor, lm, 0, 120);
  const expected = palmOf(lm);
  assert.ok(Math.abs(settled.palm.x - expected.x) < 0.01);
  assert.ok(Math.abs(settled.palm.y - expected.y) < 0.01);
});
