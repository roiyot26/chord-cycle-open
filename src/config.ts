import { DEFAULT_PRESET_ID, getPreset } from "./chords/presets";
import { DEFAULT_SETTINGS, type EngineSettings } from "./audio/engine";
import { DEFAULT_SELECTOR_OPTIONS, type SelectorOptions } from "./chords/wheel";
import { isValidChordSymbol } from "./chords/voicing";

export interface AppConfig {
  presetId: string;
  slots: string[];
  engine: EngineSettings;
  selector: SelectorOptions;
}

const STORAGE_KEY = "chord-cycle:config";

export function defaultConfig(): AppConfig {
  return {
    presetId: DEFAULT_PRESET_ID,
    slots: [...getPreset(DEFAULT_PRESET_ID).slots],
    engine: { ...DEFAULT_SETTINGS },
    selector: { ...DEFAULT_SELECTOR_OPTIONS },
  };
}

function coerce(raw: unknown): AppConfig | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Partial<AppConfig>;
  const slots = Array.isArray(obj.slots)
    ? obj.slots.filter((s): s is string => typeof s === "string" && isValidChordSymbol(s))
    : [];
  if (slots.length < 2) return null;
  const base = defaultConfig();
  return {
    presetId: typeof obj.presetId === "string" ? obj.presetId : "custom",
    slots: slots.slice(0, 16),
    engine: { ...base.engine, ...(obj.engine ?? {}) },
    selector: { ...base.selector, ...(obj.selector ?? {}) },
  };
}

/** URL-safe base64 of the UTF-8 JSON, so wheels can be shared as a link. */
function encode(config: AppConfig): string {
  const json = JSON.stringify(config);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decode(token: string): AppConfig | null {
  try {
    const padded = token.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return coerce(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

/** URL hash wins over localStorage, so a shared link always shows its own wheel. */
export function loadConfig(): AppConfig {
  const hash = window.location.hash.replace(/^#w=/, "");
  if (hash && hash !== window.location.hash) {
    const fromUrl = decode(hash);
    if (fromUrl) return fromUrl;
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = coerce(JSON.parse(stored));
      if (parsed) return parsed;
    }
  } catch {
    // Private mode, or a config written by an older build. Defaults are fine.
  }
  return defaultConfig();
}

export function saveConfig(config: AppConfig): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Non-fatal: the app works fine without persistence.
  }
}

export function shareUrl(config: AppConfig): string {
  const url = new URL(window.location.href);
  url.hash = `w=${encode(config)}`;
  return url.toString();
}
