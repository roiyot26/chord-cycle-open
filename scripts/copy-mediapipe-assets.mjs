// Copies the MediaPipe WASM runtime out of node_modules and into public/ so the
// app never has to reach a CDN at runtime.
import { cp, mkdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "node_modules/@mediapipe/tasks-vision/wasm");
const dest = resolve(root, "public/mediapipe/wasm");

try {
  await access(src);
} catch {
  console.error("[copy-mediapipe-assets] node_modules/@mediapipe/tasks-vision/wasm missing — run `npm install` first.");
  process.exit(1);
}

await mkdir(dirname(dest), { recursive: true });
await cp(src, dest, { recursive: true });
console.log(`[copy-mediapipe-assets] wasm runtime -> ${dest}`);
