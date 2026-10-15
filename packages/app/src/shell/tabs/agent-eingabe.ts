/**
 * Agent › Eingabe: Werkzeug-Knöpfe mit Preisen, leerer Zustand, Bild anhängen.
 *
 * Aus tabs/agent.ts verschoben (C-5d) – wörtlich, ohne Logikänderung.
 */
import { type ToolPrice } from "@freedomstack/protocol";
import { t } from "../../i18n.js";
import { knopfPreis } from "../../preis-anzeige.js";
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
    // Beide Einheiten am Knopf (Regel 4.4b), die Erklaerung im Tooltip; ohne Kurs nur sats (C-32)
    el.textContent = preis ? knopfPreis(preis.msat, kurs) : t("agent.preisUnbekannt");
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
      zeigeWerkzeugAuswahl();
    });
  });
}

/**
 * Gewählte Werkzeuge als Chips in der Eingabe (C-49a) – die Werkzeuge selbst stehen mit Preis im „+“-Menü.
 * Das „×“ klickt den Knopf im Menü, so bleibt `selectedTools` an einer Stelle.
 */
function zeigeWerkzeugAuswahl(): void {
  const box = document.getElementById("werkzeug-auswahl");
  if (!box) return;
  box.replaceChildren(...[...document.querySelectorAll<HTMLElement>(".tool-chip.active")].map((chip) => {
    const name = chip.querySelector("[data-i18n]")?.textContent ?? chip.dataset.name ?? "";
    const b = el("button", undefined, "werkzeug-gewaehlt");
    b.type = "button";
    b.setAttribute("aria-label", t("agent.werkzeugWeg", { name }));
    b.append(el("span", name), el("span", "×", "werkzeug-weg"));
    b.addEventListener("click", () => chip.click());
    return b;
  }));
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


/**
 * „Stufe und Bezahlung“ (C-49b): Stufe, Gebot mit Einheit, „privat“ und „über Funk“ in einem Popover an der
 * Eingabe – am Handy als Blatt von unten. Die Felder selbst und ihre Logik bleiben, wie sie waren.
 */
export function setupOptionen(): void {
  const knopf = document.getElementById("ai-optionen-btn");
  const box = document.getElementById("ai-optionen");
  if (!knopf || !box) return;
  const setze = (auf: boolean) => {
    box.classList.toggle("hidden", !auf);
    knopf.setAttribute("aria-expanded", String(auf));
    if (auf) box.querySelector<HTMLElement>("select, input")?.focus();
  };
  knopf.addEventListener("click", (e) => {
    e.stopPropagation();
    setze(box.classList.contains("hidden"));
  });
  box.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", () => { if (!box.classList.contains("hidden")) setze(false); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !box.classList.contains("hidden")) { setze(false); knopf.focus(); }
  });
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

  // Seit C-49a „+“ für Anhänge und Werkzeuge – mit aria-expanded, Escape schließt
  const setze = (auf: boolean) => {
    menu.classList.toggle("hidden", !auf);
    btn.setAttribute("aria-expanded", String(auf));
  };
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    setze(menu.classList.contains("hidden"));
  });
  document.addEventListener("click", () => setze(false));
  // Im Menü bleibt es offen – mehrere Werkzeuge nacheinander; ein Anhang schließt es selbst
  menu.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.classList.contains("hidden")) { setze(false); btn.focus(); }
  });

  menu.querySelectorAll("button[data-attach]").forEach((b) => {
    b.addEventListener("click", () => {
      const type = (b as HTMLElement).dataset.attach!;
      setze(false);
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
