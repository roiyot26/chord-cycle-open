import "./styles.css";

import { AudioEngine } from "./audio/engine";
import { voiceLead } from "./chords/voicing";
import { WedgeSelector, hitTest } from "./chords/wheel";
import { fromHand, fromPointer, idleControl, type ControlSource } from "./control";
import { loadConfig, saveConfig, type AppConfig } from "./config";
import { HandFeatureExtractor, type HandFeatures } from "./tracking/gestures";
import { HandTracker, selectHand } from "./tracking/handTracker";
import { Controls } from "./ui/controls";
import { Renderer, type RenderState } from "./ui/renderer";

const video = document.getElementById("video") as HTMLVideoElement;
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const handsButton = document.getElementById("hands-button") as HTMLButtonElement;
const handsStatus = document.getElementById("hands-status") as HTMLSpanElement;

let config: AppConfig = loadConfig();

const engine = new AudioEngine();
const tracker = new HandTracker();
const features = new HandFeatureExtractor();
const selector = new WedgeSelector({ ...config.selector });
const renderer = new Renderer(canvas);

let latched = false;
let pinchWasDown = false;
let playingSlot = -1;
let playingSymbol = "";
let cameraOn = false;
let cameraBusy = false;

const TRACKING_GRACE_MS = 260;
let lastHand: HandFeatures | null = null;
let lastHandAt = -Infinity;

let pointerPresent = false;
let pointerPinch = false;
let pointerClient = { x: 0, y: 0 };

new Controls(config, (next) => {
  const slotsChanged = next.slots.join("|") !== config.slots.join("|");
  config = next;
  saveConfig(config);
  engine.updateSettings(config.engine);
  selector.setOptions(config.selector);
  if (slotsChanged) {
    selector.reset();
    engine.releaseChord();
    playingSlot = -1;
    playingSymbol = "";
    latched = false;
  }
});

function ensureAudio(): void {
  if (engine.running) return;
  engine
    .start()
    .then(() => engine.updateSettings(config.engine))
    .catch(() => {
      handsStatus.textContent = "no audio";
    });
}

function canvasPoint(clientX: number, clientY: number): { x: number; y: number } {
  return renderer.canvasPointFromClient(clientX, clientY);
}

canvas.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);
  pointerPresent = true;
  pointerPinch = true;
  pointerClient = { x: event.clientX, y: event.clientY };
  ensureAudio();
});

canvas.addEventListener("pointermove", (event) => {
  pointerClient = { x: event.clientX, y: event.clientY };
  if (event.pointerType === "mouse" && event.buttons === 0) {
    pointerPresent = true;
    return;
  }
  if (event.pointerType === "mouse" || canvas.hasPointerCapture(event.pointerId)) {
    pointerPresent = true;
  }
});

canvas.addEventListener("pointerup", (event) => {
  pointerPinch = false;
  pointerClient = { x: event.clientX, y: event.clientY };
  if (event.pointerType !== "mouse") pointerPresent = false;
});

canvas.addEventListener("pointercancel", () => {
  pointerPinch = false;
  pointerPresent = false;
});

canvas.addEventListener("pointerleave", (event) => {
  if (event.pointerType === "mouse" && event.buttons === 0) pointerPresent = false;
});

canvas.addEventListener("contextmenu", (event) => event.preventDefault());

async function startCamera(): Promise<void> {
  if (cameraOn || cameraBusy) return;
  cameraBusy = true;
  handsButton.disabled = true;
  handsStatus.textContent = "";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    await new Promise<void>((resolve) => {
      if (video.videoWidth > 0) resolve();
      else video.addEventListener("loadedmetadata", () => resolve(), { once: true });
    });
    await tracker.init(1);
    cameraOn = true;
    handsButton.textContent = "Hands on";
    handsButton.setAttribute("aria-pressed", "true");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    handsStatus.textContent =
      message.includes("Permission") || message.includes("denied")
        ? "Camera blocked. Touch still plays."
        : "Camera failed. Touch still plays.";
  } finally {
    cameraBusy = false;
    handsButton.disabled = false;
  }
}

handsButton.addEventListener("click", () => {
  ensureAudio();
  void startCamera();
});

window.addEventListener("resize", () => {
  renderer.resize();
  renderer.syncVideo(video);
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) engine.setExpression(0);
});

function updateChord(slot: number): void {
  if (slot < 0) return;
  const symbol = config.slots[slot];
  if (!symbol || (slot === playingSlot && symbol === playingSymbol)) return;

  const voicing = voiceLead(symbol, engine.previousNotes);
  if (!voicing) return;

  engine.playChord(voicing);
  playingSlot = slot;
  playingSymbol = symbol;
}

function pointerControl(): ControlSource {
  if (!pointerPresent) return idleControl();
  const p = canvasPoint(pointerClient.x, pointerClient.y);
  return fromPointer(p.x, p.y, renderer.wheelLayout, pointerPinch, true);
}

function cameraControl(nowMs: number): { control: ControlSource; hand: HandFeatures | null } {
  if (!cameraOn || !tracker.ready) return { control: idleControl(), hand: null };

  const hands = tracker.detect(video, nowMs);
  const tracked = selectHand(hands, "Right");
  let hand: HandFeatures | null = null;
  let fresh = false;

  if (tracked) {
    hand = features.extract(tracked.landmarks, nowMs);
    if (hand) {
      fresh = true;
      lastHand = hand;
      lastHandAt = nowMs;
    }
  } else if (nowMs - lastHandAt < TRACKING_GRACE_MS) {
    hand = lastHand;
  } else {
    lastHand = null;
    features.reset();
  }

  if (!hand) return { control: idleControl(), hand: null };
  const control = fromHand(hand, (nx, ny) => renderer.project(nx, ny), renderer.wheelLayout);
  if (!fresh) control.pinch = pinchWasDown;
  return { control, hand };
}

function frame(nowMs: number): void {
  renderer.resize();
  renderer.syncVideo(video);

  const cam = cameraControl(nowMs);
  const pointer = pointerControl();
  const usingCamera = cam.control.present;
  const control = usingCamera ? cam.control : pointer;

  let hovered = -1;
  if (control.present) {
    if (control.pinch && !pinchWasDown) latched = !latched;
    pinchWasDown = control.pinch;

    const { cx, cy, radius } = renderer.wheelLayout;
    const hit = hitTest(control.x - cx, control.y - cy, radius, config.slots.length);
    hovered = hit.index;
    const committed = latched ? selector.selected : selector.update(hit, nowMs);
    updateChord(committed);
    engine.setExpression(control.openness);
  } else {
    pinchWasDown = false;
    engine.setExpression(0);
  }

  const state: RenderState = {
    slots: config.slots,
    selected: selector.selected,
    hovered,
    openness: control.present ? control.openness : 0,
    chordName: playingSymbol,
    hand: cam.hand,
    pointer: control.present ? { x: control.x, y: control.y } : null,
    latched,
    tracking: control.present,
    usingCamera,
  };
  renderer.draw(video, state);
}

function loop(): void {
  const step = (now: number) => {
    frame(now);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

renderer.resize();
loop();
