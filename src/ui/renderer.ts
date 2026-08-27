import { HAND_CONNECTIONS, type HandFeatures } from "../tracking/gestures";
import { DEAD_ZONE, slotCenterAngle } from "../chords/wheel";

const TAU = Math.PI * 2;
const ACCENT = "#5ad9f0";

export interface RenderState {
  slots: string[];
  selected: number;
  hovered: number;
  openness: number;
  chordName: string;
  hand: HandFeatures | null;
  pointer: { x: number; y: number } | null;
  latched: boolean;
  tracking: boolean;
  usingCamera: boolean;
}

export interface WheelLayout {
  cx: number;
  cy: number;
  radius: number;
}

/**
 * Maps normalized landmark coordinates onto canvas pixels.
 *
 * The preview is mirrored so the app behaves like a mirror rather than like
 * looking at someone else, which means the x axis has to be flipped here too —
 * miss this and the overlay drifts the wrong way from the hand.
 */
export class VideoMapper {
  private dx = 0;
  private dy = 0;
  private dw = 1;
  private dh = 1;

  update(videoWidth: number, videoHeight: number, canvasWidth: number, canvasHeight: number): void {
    if (videoWidth <= 0 || videoHeight <= 0) return;
    const scale = Math.max(canvasWidth / videoWidth, canvasHeight / videoHeight);
    this.dw = videoWidth * scale;
    this.dh = videoHeight * scale;
    this.dx = (canvasWidth - this.dw) / 2;
    this.dy = (canvasHeight - this.dh) / 2;
  }

  toCanvas(nx: number, ny: number): { x: number; y: number } {
    return { x: this.dx + (1 - nx) * this.dw, y: this.dy + ny * this.dh };
  }

  get destRect(): [number, number, number, number] {
    return [this.dx, this.dy, this.dw, this.dh];
  }
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly mapper = new VideoMapper();
  /** Eased per-slot highlight, so wedges glow in and out instead of snapping. */
  private glow: number[] = [];
  private lastDrawAt: number | null = null;
  private layout: WheelLayout = { cx: 0, cy: 0, radius: 1 };

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
  }

  resize(): WheelLayout {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.layout = {
      cx: w / 2,
      cy: h / 2,
      radius: Math.min(w, h) * 0.36,
    };
    return this.layout;
  }

  get wheelLayout(): WheelLayout {
    return this.layout;
  }

  /** Canvas-pixel position of a landmark-space point. */
  project(nx: number, ny: number): { x: number; y: number } {
    return this.mapper.toCanvas(nx, ny);
  }

  canvasPointFromClient(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = this.canvas.width / Math.max(rect.width, 1);
    return {
      x: (clientX - rect.left) * dpr,
      y: (clientY - rect.top) * dpr,
    };
  }

  syncVideo(video: HTMLVideoElement): void {
    this.mapper.update(video.videoWidth, video.videoHeight, this.canvas.width, this.canvas.height);
  }

  draw(video: HTMLVideoElement, state: RenderState): void {
    const { ctx } = this;
    const { width: w, height: h } = this.canvas;
    const { cx, cy, radius } = this.layout;

    ctx.save();
    ctx.fillStyle = "#0b0d12";
    ctx.fillRect(0, 0, w, h);

    if (state.usingCamera && video.readyState >= 2) {
      const [dx, dy, dw, dh] = this.mapper.destRect;
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, w - dx - dw, dy, dw, dh);
      ctx.restore();
    }

    const count = state.slots.length;
    if (this.glow.length !== count) this.glow = new Array(count).fill(0);
    const now = performance.now();
    const dt = this.lastDrawAt === null ? 1 / 60 : Math.min((now - this.lastDrawAt) / 1000, 0.1);
    this.lastDrawAt = now;
    const ease = 1 - Math.exp(-dt / 0.06);
    for (let i = 0; i < count; i++) {
      const target = i === state.selected ? state.openness : i === state.hovered ? 0.22 : 0;
      this.glow[i] += (target - this.glow[i]) * ease;
    }

    this.drawWheel(state, count, cx, cy, radius);
    if (state.hand && state.usingCamera) this.drawHand(state.hand);
    if (state.pointer && state.tracking) this.drawPointer(state.pointer, state.selected >= 0);

    ctx.restore();
  }

  private drawWheel(state: RenderState, count: number, cx: number, cy: number, radius: number): void {
    const { ctx } = this;
    if (count === 0) return;
    const wedge = TAU / count;
    const toCanvasAngle = (a: number) => a - Math.PI / 2;

    for (let i = 0; i < count; i++) {
      const glow = this.glow[i];
      if (glow > 0.01) {
        const start = toCanvasAngle(slotCenterAngle(i, count) - wedge / 2);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, start, start + wedge);
        ctx.closePath();
        ctx.fillStyle = `rgba(90, 217, 240, ${0.1 + 0.62 * glow})`;
        ctx.fill();
      }
    }

    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1;
    for (let i = 0; i < count; i++) {
      const a = toCanvasAngle(slotCenterAngle(i, count) - wedge / 2);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * radius * DEAD_ZONE, cy + Math.sin(a) * radius * DEAD_ZONE);
      ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
      ctx.stroke();
    }

    const fontSize = Math.max(11, Math.round(radius * (count > 9 ? 0.085 : 0.105)));
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < count; i++) {
      const a = toCanvasAngle(slotCenterAngle(i, count));
      const lx = cx + Math.cos(a) * radius * 0.72;
      const ly = cy + Math.sin(a) * radius * 0.72;
      const active = i === state.selected;
      ctx.font = `${active ? 700 : 500} ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillStyle = active ? "#ffffff" : `rgba(255,255,255,${0.55 + 0.35 * this.glow[i]})`;
      ctx.shadowColor = "rgba(0,0,0,0.65)";
      ctx.shadowBlur = 6;
      ctx.fillText(state.slots[i], lx, ly);
      ctx.shadowBlur = 0;
    }

    const hubR = radius * DEAD_ZONE;
    ctx.beginPath();
    ctx.arc(cx, cy, hubR, 0, TAU);
    const hubGlow = 0.22 + 0.55 * state.openness;
    ctx.fillStyle = state.latched ? `rgba(90,217,240,${0.35 + 0.4 * state.openness})` : `rgba(14,17,24,${0.72 + 0.1 * state.openness})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(90,217,240,${hubGlow})`;
    ctx.lineWidth = 1.5 + 2 * state.openness;
    ctx.stroke();

    const name = state.chordName || "·";
    const hubSize = Math.max(13, Math.round(radius * (0.11 + 0.08 * state.openness)));
    ctx.font = `700 ${hubSize}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = `rgba(238,242,247,${0.45 + 0.55 * Math.max(state.openness, state.selected >= 0 ? 0.35 : 0)})`;
    ctx.shadowColor = "rgba(0,0,0,0.7)";
    ctx.shadowBlur = 8;
    ctx.fillText(name, cx, cy);
    ctx.shadowBlur = 0;
  }

  private drawHand(hand: HandFeatures): void {
    const { ctx } = this;
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 2;
    for (const [a, b] of HAND_CONNECTIONS) {
      const p = this.mapper.toCanvas(hand.landmarks[a].x, hand.landmarks[a].y);
      const q = this.mapper.toCanvas(hand.landmarks[b].x, hand.landmarks[b].y);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    for (const lm of hand.landmarks) {
      const p = this.mapper.toCanvas(lm.x, lm.y);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, TAU);
      ctx.fill();
    }
  }

  private drawPointer(pointer: { x: number; y: number }, active: boolean): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, 9, 0, TAU);
    ctx.fillStyle = active ? ACCENT : "rgba(255,255,255,0.6)";
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
