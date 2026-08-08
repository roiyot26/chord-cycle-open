// Downloads the hand-landmark model into public/models/. It is ~7.8 MB, so it is
// gitignored rather than committed. The app falls back to the Google CDN if this
// file is absent, so this step is only needed for fully offline development.
import { mkdir, stat, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dest = resolve(root, "public/models/hand_landmarker.task");

try {
  const info = await stat(dest);
  if (info.size > 1_000_000) {
    console.log("[fetch-model] already present, skipping.");
    process.exit(0);
  }
} catch {
  // not there yet — fall through and download
}

console.log("[fetch-model] downloading hand_landmarker.task …");
const res = await fetch(MODEL_URL);
if (!res.ok) {
  console.error(`[fetch-model] download failed: ${res.status} ${res.statusText}`);
  process.exit(1);
}
await mkdir(dirname(dest), { recursive: true });
await writeFile(dest, Buffer.from(await res.arrayBuffer()));
console.log(`[fetch-model] -> ${dest}`);
