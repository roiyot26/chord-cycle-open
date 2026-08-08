import assert from "node:assert/strict";
import test from "node:test";

import { DEAD_ZONE, WedgeSelector, hitTest, pointerAngle, type WheelHit } from "../src/chords/wheel";

const R = 100;

/** Hit test a point `angleDeg` clockwise from 12 o'clock, `r` radii from center. */
function hitAt(angleDeg: number, count = 8, r = 0.6): WheelHit {
  const a = (angleDeg * Math.PI) / 180;
  return hitTest(Math.sin(a) * r * R, -Math.cos(a) * r * R, R, count);
}

test("pointerAngle measures clockwise from 12 o'clock", () => {
  const deg = (dx: number, dy: number) => Math.round((pointerAngle(dx, dy) * 180) / Math.PI);
  assert.equal(deg(0, -1), 0); // up
  assert.equal(deg(1, 0), 90); // right
  assert.equal(deg(0, 1), 180); // down
  assert.equal(deg(-1, 0), 270); // left
});

test("slot 0 is centered at 12 o'clock and slots run clockwise", () => {
  for (let i = 0; i < 8; i++) {
    assert.equal(hitAt(i * 45).index, i);
  }
});

test("odd slot counts still center slot 0 at the top", () => {
  assert.equal(hitAt(0, 7).index, 0);
  assert.equal(hitAt(360 / 7, 7).index, 1);
  assert.equal(hitAt(-360 / 7, 7).index, 6);
});

test("the dead zone and the far field select nothing", () => {
  assert.equal(hitAt(0, 8, DEAD_ZONE * 0.5).index, -1);
  assert.equal(hitAt(0, 8, 3).index, -1);
});

test("centrality peaks on the wedge center line and vanishes at the boundary", () => {
  assert.ok(hitAt(0).centrality > 0.99);
  const edge = hitAt(22.4);
  assert.ok(edge.centrality < 0.05, `expected near-zero centrality, got ${edge.centrality}`);
});

test("selector commits only after the dwell time", () => {
  const selector = new WedgeSelector({ edgeMargin: 0.2, dwellMs: 90, minHoldMs: 120 });
  assert.equal(selector.update(hitAt(0), 0), -1, "should not commit on first sight");
  assert.equal(selector.update(hitAt(0), 50), -1, "should not commit before the dwell elapses");
  assert.equal(selector.update(hitAt(0), 100), 0, "should commit once dwelled");
});

test("selector ignores a wedge the pointer has only just entered", () => {
  const selector = new WedgeSelector({ edgeMargin: 0.3, dwellMs: 0, minHoldMs: 0 });
  selector.update(hitAt(0), 0);
  assert.equal(selector.selected, 0);

  // 24° is just past the boundary into slot 1, but still inside the edge band.
  const grazing = hitAt(24);
  assert.equal(grazing.index, 1, "hit test should report the neighbour");
  assert.equal(selector.update(grazing, 100), 0, "selection should not follow a graze");
  assert.equal(selector.update(hitAt(45), 200), 1, "a decisive move should commit");
});

test("selector will not change faster than minHoldMs", () => {
  const selector = new WedgeSelector({ edgeMargin: 0, dwellMs: 0, minHoldMs: 200 });
  selector.update(hitAt(0), 1000);
  assert.equal(selector.selected, 0);
  selector.update(hitAt(45), 1100);
  assert.equal(selector.selected, 0, "held back by the cooldown");
  selector.update(hitAt(45), 1300);
  assert.equal(selector.selected, 1, "committed once the cooldown expired");
});

test("the dead zone holds the current selection rather than dropping it", () => {
  const selector = new WedgeSelector({ edgeMargin: 0, dwellMs: 0, minHoldMs: 0 });
  selector.update(hitAt(90), 0);
  assert.equal(selector.selected, 2);
  assert.equal(selector.update(hitAt(90, 8, DEAD_ZONE * 0.4), 50), 2);
});

test("jitter across a boundary does not machine-gun the chord", () => {
  const selector = new WedgeSelector({ edgeMargin: 0.22, dwellMs: 90, minHoldMs: 120 });
  let now = 0;
  selector.update(hitAt(0), now);
  selector.update(hitAt(0), (now += 200));
  assert.equal(selector.selected, 0);

  // A hand held on the 22.5° boundary, wobbling ±3° at 60 fps for a second.
  let changes = 0;
  for (let i = 0; i < 60; i++) {
    const before: number = selector.selected;
    selector.update(hitAt(22.5 + (i % 2 === 0 ? 3 : -3)), (now += 1000 / 60));
    if (selector.selected !== before) changes++;
  }
  assert.equal(changes, 0, `boundary wobble should not switch chords, saw ${changes} changes`);
});

test("a hand sweeping the wheel produces each slot in order, exactly once", () => {
  const selector = new WedgeSelector({ edgeMargin: 0.2, dwellMs: 60, minHoldMs: 80 });
  const seen: number[] = [];
  let now = 0;

  // 4°/frame at 60 fps — a deliberate sweep, sampled the way the app samples it.
  for (let deg = 0; deg < 360; deg += 4) {
    const committed = selector.update(hitAt(deg), now);
    now += 1000 / 60;
    if (committed >= 0 && seen[seen.length - 1] !== committed) seen.push(committed);
  }

  assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6, 7], "every wedge should fire once, in order");
});
