import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from "@mediapipe/tasks-vision";
import type { Landmark } from "./gestures";

const LOCAL_MODEL = "models/hand_landmarker.task";
const CDN_MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export type Handedness = "Left" | "Right";

export interface TrackedHand {
  /**
   * The user's actual hand, already corrected for the mirrored preview.
   *
   * MediaPipe assigns handedness as if the input were a selfie-mirrored image,
   * but getUserMedia hands us the raw, unmirrored frame — so its label is
   * inverted relative to reality. We flip it back here, once, rather than
   * leaving every call site to get it wrong.
   */
  hand: Handedness;
  score: number;
  landmarks: Landmark[];
}

async function resolveModelUrl(): Promise<string> {
  try {
    const res = await fetch(LOCAL_MODEL, { method: "HEAD" });
    if (res.ok) return LOCAL_MODEL;
  } catch {
    // fall through to the CDN
  }
  return CDN_MODEL;
}

export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private lastTimestampMs = -1;

  async init(numHands = 1): Promise<void> {
    const [fileset, modelAssetPath] = await Promise.all([
      FilesetResolver.forVisionTasks("mediapipe/wasm"),
      resolveModelUrl(),
    ]);

    this.landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  }

  get ready(): boolean {
    return this.landmarker !== null;
  }

  detect(video: HTMLVideoElement, timestampMs: number): TrackedHand[] {
    if (!this.landmarker) return [];
    // The VIDEO running mode requires strictly increasing timestamps and throws
    // otherwise, which is easy to trip when frame callbacks land out of order.
    if (timestampMs <= this.lastTimestampMs) timestampMs = this.lastTimestampMs + 1;
    this.lastTimestampMs = timestampMs;

    let result: HandLandmarkerResult;
    try {
      result = this.landmarker.detectForVideo(video, timestampMs);
    } catch {
      return [];
    }

    return result.landmarks.map((landmarks, i) => {
      const category = result.handedness[i]?.[0];
      const raw = category?.categoryName === "Left" ? "Left" : "Right";
      return {
        hand: raw === "Left" ? "Right" : "Left",
        score: category?.score ?? 0,
        landmarks: landmarks as Landmark[],
      };
    });
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}

/**
 * Picks the hand to play with. With a single hand on camera we just use it —
 * insisting on a handedness label only makes the app feel broken when the label
 * is wrong. The preference matters only when both hands are visible.
 */
export function selectHand(hands: TrackedHand[], prefer: Handedness): TrackedHand | null {
  if (hands.length === 0) return null;
  if (hands.length === 1) return hands[0];
  return hands.find((h) => h.hand === prefer) ?? hands[0];
}
