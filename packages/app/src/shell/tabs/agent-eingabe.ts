/**
 * Agent › Eingabe: Werkzeug-Knöpfe mit Preisen, leerer Zustand, Bild anhängen.
 *
 * Aus tabs/agent.ts verschoben (C-5d) – wörtlich, ohne Logikänderung.
 */
import { type ToolPrice } from "@freedomstack/protocol";
import { t } from "../../i18n.js";
import { ausMsat } from "../../preis-anzeige.js";
import { werkzeugPreise, werkzeugPreisText } from "../../werkzeug-preise.js";
import { aktuellerKurs } from "../marktkurs.js";
import { $, el } from "../ui.js";

/**
 * Preis an jedem Werkzeug-Knopf (8.7): Richtpreis beim Start, danach der
 * guenstigste angebotene – in sats und SOL, per textContent.
 */
export function zeigeWerkzeugPreise(angebote: ReadonlyArray<{ tools?: ToolPrice[] }> = []): void {
  const preise = werkzeugPreise(angebote);
  const kurs = aktuellerKurs();
  document.querySelectorAll<HTMLElement>(".tool-chip").forEach((chip) => {
    const preis = preise.get(Number(chip.dataset.tool));
    chip.title = werkzeugPreisText(preis, kurs);
    let el = chip.querySelector<HTMLElement>(".tool-preis");
    if (!el) {
      el = document.createElement("span");
      el.className = "tool-preis";
      chip.append(el);
    }
    // Beide Einheiten am Knopf (Regel 4.4b), die Erklaerung im Tooltip
    el.textContent = preis ? ausMsat(preis.msat, kurs) : t("agent.preisUnbekannt");
  });
}

export function setupToolChips(): void {
  zeigeWerkzeugPreise();
  document.querySelectorAll(".tool-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const el = chip as HTMLElement;
      const kind = Number(el.dataset.tool);
      const name = el.dataset.name!;
      el.classList.toggle("active");
      if (el.classList.contains("active")) {
        selectedTools.push({ kind, name, input: "" });
      } else {
        selectedTools = selectedTools.filter((t) => t.kind !== kind);
      }
      // video-optionen zeigen wenn video-chip aktiv
      const videoActive = selectedTools.some((t) => t.name === "video_gen");
      const opts = document.getElementById("video-opts");
      if (opts) opts.classList.toggle("hidden", !videoActive);
    });
  });
}

/** Empty-State: Beispiel-Prompts klickbar; Empty ausblenden sobald Verlauf da. */
export function setupEmptyState(): void {
  document.querySelectorAll(".ai-example").forEach((b) => {
    b.addEventListener("click", () => {
      const prompt = t((b as HTMLElement).dataset.promptKey ?? "");
      ($("#ai-prompt") as HTMLTextAreaElement).value = prompt;
      ($("#ai-prompt") as HTMLTextAreaElement).focus();
    });
  });
}
export function hideEmptyState(): void {
  const e = document.getElementById("ai-empty");
  if (e) e.style.display = "none";
}


/** Angehaengte Datei (multimodal). */
export let attachment: { type: string; name: string; dataUrl: string } | null = null;
/** Angeforderte Tools fuer den naechsten Job. */
export let selectedTools: Array<{ kind: number; name: string; input: string }> = [];

export function setupAttach(): void {
  const btn = $("#attach-btn");
  const menu = $("#attach-menu");
  const input = $("#attach-input") as HTMLInputElement;
  const status = $("#attach-status");

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("hidden");
  });
  document.addEventListener("click", () => menu.classList.add("hidden"));

  menu.querySelectorAll("button[data-attach]").forEach((b) => {
    b.addEventListener("click", () => {
      const type = (b as HTMLElement).dataset.attach!;
      menu.classList.add("hidden");
      const accept =
        type === "image" ? "image/*" :
        type === "audio" ? "audio/*" :
        type === "video" ? "video/*" :
        type === "camera" ? "image/*" : "*/*";
      input.accept = accept;
      if (type === "camera") input.setAttribute("capture", "environment");
      else input.removeAttribute("capture");
      input.dataset.atype = type;
      input.click();
    });
  });

  input.addEventListener("change", () => {
    const f = input.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      attachment = { type: input.dataset.atype ?? "file", name: f.name, dataUrl: String(reader.result) };
      status.textContent = t("agent.angehaengt", { name: f.name });
      status.className = "mono-sm ok";
      if (attachment.type === "image" || attachment.type === "camera") {
        // Als DOM (C-6d): Dateiname als Text, die Vorschau als Eigenschaft
        const bild = el("img", undefined, "attach-thumb");
        bild.src = attachment.dataUrl;
        bild.alt = "";
        status.replaceChildren(`${f.name} `, bild);
      }
    };
    reader.readAsDataURL(f);
    input.value = "";
  });
}
