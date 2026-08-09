import "./styles.css";

import { AudioEngine } from "./audio/engine";
import { voiceLead } from "./chords/voicing";
import { WedgeSelector, hitTest } from "./chords/wheel";
import { loadConfig, saveConfig, type AppConfig } from "./config";
import { HandFeatureExtractor, type HandFeatures } from "./tracking/gestures";
import { HandTracker, selectHand } from "./tracking/handTracker";
import { Controls } from "./ui/controls";
import { Renderer, type RenderState } from "./ui/renderer";

const video = document.getElementById("video") as HTMLVideoElement;
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const startOverlay = document.getElementById("start-overlay") as HTMLDivElement;
const startButton = document.getElementById("start-button") as HTMLButtonElement;
const startStatus = document.getElementById("start-status") as HTMLParagraphElement;
const hudChord = document.getElementById("hud-chord") as HTMLSpanElement;
const hudOpen = document.getElementById("hud-open") as HTMLSpanElement;
const hudNotes = document.getElementById("hud-notes") as HTMLSpanElement;

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

/**
 * How long to coast on the last good reading when the tracker loses the hand.
 * Detection drops the odd frame even under good light, and cutting the sound on
 * every miss turns a held chord into a stutter. Long enough to bridge a dropout,
 * short enough that actually removing your hand still fades things out.
 */
const TRACKING_GRACE_MS = 260;
let lastHand: HandFeatures | null = null;
let lastHandAt = -Infinity;

new Controls(config, (next) => {
  const slotsChanged = next.slots.join("|") !== config.slots.join("|");
  config = next;
  saveConfig(config);
  engine.updateSettings(config.engine);
  selector.setOptions(config.selector);
  if (slotsChanged) {
    // The old index means nothing against a new wheel, so drop the sounding chord
    // rather than letting it hang on a slot that may no longer exist.
    selector.reset();
    engine.releaseChord();
    playingSlot = -1;
    playingSymbol = "";
    latched = false;
  }
});

function setStatus(message: string, isError = false): void {
  startStatus.textContent = message;
  startStatus.classList.toggle("error", isError);
}

async function startCamera(): Promise<void> {
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
}

async function start(): Promise<void> {
  startButton.disabled = true;
  try {
    setStatus("Requesting camera…");
    await startCamera();
    setStatus("Loading hand tracking model…");
    await tracker.init(1);
  } catch (error) {
    startButton.disabled = false;
    const message = error instanceof Error ? error.message : String(error);
    setStatus(
      message.includes("Permission") || message.includes("denied")
        ? "Camera permission denied. Allow it in your browser and try again."
        : `Could not start: ${message}`,
      true,
    );
    return;
  }

  startOverlay.hidden = true;
  loop();

  // Audio comes up alongside the render loop rather than gating it. On a machine
  // with no output device resume() can hang indefinitely, and a silent app that
  // still tracks your hand beats a frozen splash screen.
  engine
    .start()
    .then(() => engine.updateSettings(config.engine))
    .catch(() => {
      hudChord.textContent = "no audio";
    });
}

startButton.addEventListener("click", () => void start());

window.addEventListener("resize", () => {
  renderer.resize();
  renderer.syncVideo(video);
});

document.addEventListener("visibilitychange", () => {
  // Muting on tab-away avoids a chord droning on in a background tab.
  if (document.hidden) engine.setExpression(0);
});

/** Applies a committed slot selection to the audio engine. */
function updateChord(slot: number): void {
  if (slot < 0) return;
  const symbol = config.slots[slot];
  if (!symbol || (slot === playingSlot && symbol === playingSymbol)) return;

  const voicing = voiceLead(symbol, engine.previousNotes);
  if (!voicing) return;

  engine.playChord(voicing);
  playingSlot = slot;
  playingSymbol = symbol;
  hudChord.textContent = symbol;
  hudNotes.textContent = voicing.noteNames.join(" ");
}

function frame(nowMs: number): void {
  renderer.resize();
  renderer.syncVideo(video);

  const hands = tracker.ready ? tracker.detect(video, nowMs) : [];
  const tracked = selectHand(hands, "Right");

  let hand: HandFeatures | null = null;
  let hovered = -1;
  let pointer: { x: number; y: number } | null = null;
  let openness = 0;

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

  if (hand) {
    openness = hand.openness;

    // Latching only reacts to live readings. Replaying a coasted frame's pinch
    // state would let a single dropout toggle the latch behind the player's back.
    if (fresh) {
      if (hand.pinched && !pinchWasDown) latched = !latched;
      pinchWasDown = hand.pinched;
    }

    const { cx, cy, radius } = renderer.wheelLayout;
    const p = renderer.project(hand.palm.x, hand.palm.y);
    pointer = p;

    const hit = hitTest(p.x - cx, p.y - cy, radius, config.slots.length);
    hovered = hit.index;
    const committed = latched ? selector.selected : selector.update(hit, nowMs);
    updateChord(committed);
    engine.setExpression(openness);
  } else {
    // No hand on camera: fade out but keep the selection, so picking back up
    // resumes the same chord instead of starting from nothing.
    engine.setExpression(0);
  }

  hudOpen.textContent = `${Math.round(openness * 100)}%`;

  const state: RenderState = {
    slots: config.slots,
    selected: selector.selected,
    hovered,
    openness,
    hand,
    pointer,
    latched,
    tracking: hand !== null,
  };
  renderer.draw(video, state);
}

function loop(): void {
  // requestVideoFrameCallback fires once per decoded camera frame, so the
  // landmarker never burns a pass on a frame it has already seen. rAF would run
  // at display rate and reprocess duplicates on a 60 Hz screen with a 30 fps cam.
  if ("requestVideoFrameCallback" in video) {
    const step = (now: number) => {
      frame(now);
      video.requestVideoFrameCallback(step);
    };
    video.requestVideoFrameCallback(step);
  } else {
    const step = (now: number) => {
      frame(now);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

renderer.resize();
setStatus("");
