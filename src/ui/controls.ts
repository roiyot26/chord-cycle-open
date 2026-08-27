import { PRESETS, getPreset } from "../chords/presets";
import { isValidChordSymbol } from "../chords/voicing";
import { defaultConfig, shareUrl, type AppConfig } from "../config";

const MAX_SLOTS = 16;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

/**
 * The settings panel. It owns no state of its own — every edit is applied to the
 * config and handed back, so there is a single source of truth.
 */
export class Controls {
  private readonly presetSelect = el<HTMLSelectElement>("preset-select");
  private readonly presetNote = el<HTMLParagraphElement>("preset-note");
  private readonly slotList = el<HTMLDivElement>("slots");
  private readonly panel = el<HTMLElement>("panel");
  private readonly toggle = el<HTMLButtonElement>("panel-toggle");

  constructor(
    private config: AppConfig,
    private readonly onChange: (config: AppConfig) => void,
  ) {
    for (const preset of PRESETS) {
      this.presetSelect.append(new Option(preset.name, preset.id));
    }
    this.presetSelect.append(new Option("Custom", "custom"));

    this.toggle.addEventListener("click", () => {
      const open = this.panel.hidden;
      this.panel.hidden = !open;
      this.toggle.setAttribute("aria-expanded", String(open));
      window.dispatchEvent(new Event("resize"));
    });

    this.presetSelect.addEventListener("change", () => {
      const id = this.presetSelect.value;
      if (id === "custom") return;
      const preset = getPreset(id);
      this.commit({ ...this.config, presetId: id, slots: [...preset.slots] });
      this.renderSlots();
      this.renderPreset();
    });

    el<HTMLButtonElement>("add-slot").addEventListener("click", () => {
      if (this.config.slots.length >= MAX_SLOTS) return;
      this.commit({ ...this.config, presetId: "custom", slots: [...this.config.slots, "C"] });
      this.renderSlots();
      this.renderPreset();
    });

    el<HTMLButtonElement>("copy-link").addEventListener("click", async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const url = shareUrl(this.config);
      window.history.replaceState(null, "", url);
      try {
        await navigator.clipboard.writeText(url);
        button.textContent = "Copied";
      } catch {
        // Clipboard access can be denied; the URL bar now holds the link anyway.
        button.textContent = "Link is in the URL bar";
      }
      setTimeout(() => (button.textContent = "Copy share link"), 1800);
    });

    el<HTMLButtonElement>("reset-config").addEventListener("click", () => {
      this.commit(defaultConfig());
      this.syncInputs();
      this.renderSlots();
      this.renderPreset();
    });

    this.bindRange("s-master", (v) => ({ ...this.config, engine: { ...this.config.engine, masterGain: v } }));
    this.bindRange("s-reverb", (v) => ({ ...this.config, engine: { ...this.config.engine, reverbMix: v } }));
    this.bindRange("s-bright", (v) => ({ ...this.config, engine: { ...this.config.engine, brightness: v } }));
    this.bindRange("s-detune", (v) => ({ ...this.config, engine: { ...this.config.engine, detuneCents: v } }));

    el<HTMLInputElement>("s-bass").addEventListener("change", (event) => {
      const checked = (event.currentTarget as HTMLInputElement).checked;
      this.commit({ ...this.config, engine: { ...this.config.engine, bassEnabled: checked } });
    });

    this.syncInputs();
    this.renderSlots();
    this.renderPreset();
  }

  private bindRange(id: string, build: (value: number) => AppConfig): void {
    el<HTMLInputElement>(id).addEventListener("input", (event) => {
      this.commit(build(Number((event.currentTarget as HTMLInputElement).value)));
    });
  }

  private commit(next: AppConfig): void {
    this.config = next;
    this.onChange(next);
  }

  private syncInputs(): void {
    const { engine } = this.config;
    el<HTMLInputElement>("s-master").value = String(engine.masterGain);
    el<HTMLInputElement>("s-reverb").value = String(engine.reverbMix);
    el<HTMLInputElement>("s-bright").value = String(engine.brightness);
    el<HTMLInputElement>("s-detune").value = String(engine.detuneCents);
    el<HTMLInputElement>("s-bass").checked = engine.bassEnabled;
    this.presetSelect.value = PRESETS.some((p) => p.id === this.config.presetId) ? this.config.presetId : "custom";
  }

  private renderPreset(): void {
    const preset = PRESETS.find((p) => p.id === this.config.presetId);
    this.presetNote.textContent = preset?.note ?? "";
    this.presetSelect.value = preset ? preset.id : "custom";
  }

  private renderSlots(): void {
    this.slotList.replaceChildren();
    this.config.slots.forEach((symbol, index) => {
      const row = document.createElement("div");
      row.className = "slot";

      const label = document.createElement("span");
      label.className = "slot-index";
      label.textContent = String(index + 1);

      const input = document.createElement("input");
      input.type = "text";
      input.value = symbol;
      input.spellcheck = false;
      input.setAttribute("aria-label", `Chord for slot ${index + 1}`);
      input.addEventListener("input", () => {
        const value = input.value.trim();
        const valid = isValidChordSymbol(value);
        input.classList.toggle("invalid", !valid);
        // Keep the last playable symbol rather than muting the slot mid-typing.
        if (!valid) return;
        const slots = [...this.config.slots];
        slots[index] = value;
        this.commit({ ...this.config, presetId: "custom", slots });
        this.renderPreset();
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.title = "Remove slot";
      remove.addEventListener("click", () => {
        if (this.config.slots.length <= 2) return;
        const slots = this.config.slots.filter((_, i) => i !== index);
        this.commit({ ...this.config, presetId: "custom", slots });
        this.renderSlots();
        this.renderPreset();
      });

      row.append(label, input, remove);
      this.slotList.append(row);
    });
  }
}
