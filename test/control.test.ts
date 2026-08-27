import assert from "node:assert/strict";
import test from "node:test";

import { fromPointer, idleControl } from "../src/control";

const layout = { cx: 100, cy: 100, radius: 80 };

test("idle control is absent and silent", () => {
  const c = idleControl();
  assert.equal(c.present, false);
  assert.equal(c.openness, 0);
  assert.equal(c.pinch, false);
});

test("pointer at the hub is present with zero openness", () => {
  const c = fromPointer(100, 100, layout, false, true);
  assert.equal(c.present, true);
  assert.ok(c.openness < 0.02);
  assert.equal(c.pinch, false);
});

test("pointer at the rim is full openness", () => {
  const c = fromPointer(100, 20, layout, false, true);
  assert.ok(c.openness > 0.98, `got ${c.openness}`);
});

test("pointer beyond the rim clamps to 1", () => {
  const c = fromPointer(100, -200, layout, true, true);
  assert.equal(c.openness, 1);
  assert.equal(c.pinch, true);
});

test("absent pointer reports zero openness even if coords are on the rim", () => {
  const c = fromPointer(100, 20, layout, false, false);
  assert.equal(c.present, false);
  assert.equal(c.openness, 0);
});

test("12 o'clock pointer has angle near 0", () => {
  const c = fromPointer(100, 20, layout, false, true);
  assert.ok(c.angle < 0.15 || c.angle > Math.PI * 2 - 0.15, `got ${c.angle}`);
});
