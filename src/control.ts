import { pointerAngle } from "./chords/wheel";
import type { HandFeatures } from "./tracking/gestures";
import type { WheelLayout } from "./ui/renderer";

export interface ControlSource {
  /** Clockwise radians from 12 o'clock. */
  angle: number;
  /** 0 at the hub, 1 at the rim (clamped). */
  openness: number;
  pinch: boolean;
  present: boolean;
  /** Canvas-pixel position, for drawing. */
  x: number;
  y: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Pointer on the wheel: position is palm, distance from center is openness. */
export function fromPointer(
  x: number,
  y: number,
  layout: WheelLayout,
  pinch: boolean,
  present: boolean,
): ControlSource {
  const dx = x - layout.cx;
  const dy = y - layout.cy;
  const r = layout.radius > 0 ? Math.hypot(dx, dy) / layout.radius : 0;
  return {
    angle: pointerAngle(dx, dy),
    openness: present ? clamp01(r) : 0,
    pinch,
    present,
    x,
    y,
  };
}

/** Camera hand mapped through the same ControlSource. */
export function fromHand(
  hand: HandFeatures,
  project: (nx: number, ny: number) => { x: number; y: number },
  layout: WheelLayout,
): ControlSource {
  const p = project(hand.palm.x, hand.palm.y);
  const dx = p.x - layout.cx;
  const dy = p.y - layout.cy;
  return {
    angle: pointerAngle(dx, dy),
    openness: hand.openness,
    pinch: hand.pinched,
    present: true,
    x: p.x,
    y: p.y,
  };
}

export function idleControl(): ControlSource {
  return { angle: 0, openness: 0, pinch: false, present: false, x: 0, y: 0 };
}
