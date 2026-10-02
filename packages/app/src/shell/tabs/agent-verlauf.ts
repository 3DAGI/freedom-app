/**
 * Agent › Verlauf: Aufgaben und Nachrichten nur auf diesem Gerät (im Tresor),
 * rechte Spalte mit Werkzeugen und Kosten der Sitzung.
 *
 * Aus tabs/agent.ts verschoben (C-5d) – wörtlich, ohne Logikänderung.
 */
import { t } from "../../i18n.js";
import { geheim } from "../tresor.js";
import { $, el, haekchenEl } from "../ui.js";
import { addAiMessage } from "./agent-anzeige.js";

// -------------------------------------------------- Agent: lokaler Verlauf

interface AgentVerlauf {
  id: string;
  title: string;
  at: number;
  messages: { role: "user" | "ai"; text: string; meta?: string; model?: string }[];
}

export let aktuellerVerlauf: AgentVerlauf | null = null;
let verlaufWiederherstellen = false;

function ladeVerlaeufe(): AgentVerlauf[] {
  try {
    return JSON.parse(geheim.getItem("freedom.agentHistory") ?? "[]") as AgentVerlauf[];
  } catch {
    return [];
  }
}

function speichereVerlaeufe(v: AgentVerlauf[]): void {
  // Obergrenze: Ein unbegrenzter Verlauf fuellt den Speicher, und der ist im
  // Browser knapp — bei Ueberlauf verliert die App ganz andere Daten.
  geheim.setItem("freedom.agentHistory", JSON.stringify(v.slice(0, 40)))
    .catch(() => { /* Speicher voll oder gesperrt — Verlauf ist verzichtbar */ });
}

/** Wird von addAiMessage aufgerufen. Beim Wiederherstellen nicht erneut speichern. */
export function merkeNachricht(role: "user" | "ai", text: string, meta: string, model?: string): void {
  if (verlaufWiederherstellen) return;
  const alle = ladeVerlaeufe();
  if (!aktuellerVerlauf) {
    if (role !== "user") return;
    aktuellerVerlauf = {
      id: String(Date.now()),
      title: text.replace(/\s+/g, " ").trim().slice(0, 60) || t("agent.aufgabe"),
      at: Math.floor(Date.now() / 1000),
      messages: [],
    };
    alle.unshift(aktuellerVerlauf);
  }
  aktuellerVerlauf.messages.push({ role, text: text.slice(0, 20_000), meta, model });
  const i = alle.findIndex((x) => x.id === aktuellerVerlauf!.id);
  if (i >= 0) alle[i] = aktuellerVerlauf;
  speichereVerlaeufe(alle);
  zeigeVerlaeufe();
}

export function zeigeVerlaeufe(): void {
  const box = document.getElementById("agent-history");
  if (!box) return;
  const alle = ladeVerlaeufe();
  if (alle.length === 0) {
    const leer = el("p", t("agent.keineAufgaben"), "muted");
    leer.classList.add("mono-sm", "history-empty");
    box.replaceChildren(leer);
    return;
  }
  // Als DOM (C-6d): Titel stammen aus eigenen Fragen – nur als Text
  const heute = new Date().toDateString();
  let letzteGruppe = "";
  box.replaceChildren(...alle.flatMap((v) => {
    const d = new Date(v.at * 1000);
    const gruppe = t(d.toDateString() === heute ? "agent.heute" : "agent.frueher");
    const kopf = gruppe !== letzteGruppe ? [el("div", gruppe, "history-group")] : [];
    letzteGruppe = gruppe;
    const b = el("button", undefined, "history-item");
    b.type = "button";
    if (aktuellerVerlauf?.id === v.id) b.classList.add("active");
    b.dataset.hid = v.id;
    b.append(el("span", v.title, "history-title"), el("span", t("agent.nachrichten", { n: v.messages.length }), "history-sub"));
    b.addEventListener("click", () => oeffneVerlauf(v.id));
    return [...kopf, b];
  }));
}

function oeffneVerlauf(id: string): void {
  const v = ladeVerlaeufe().find((x) => x.id === id);
  if (!v) return;
  aktuellerVerlauf = v;
  const thread = document.getElementById("ai-thread");
  thread?.replaceChildren();
  verlaufWiederherstellen = true;
  try {
    for (const m of v.messages) addAiMessage(m.role, m.text, m.meta ?? "", m.model);
  } finally {
    verlaufWiederherstellen = false;
  }
  zeigeVerlaeufe();
}

export function neueAufgabe(): void {
  aktuellerVerlauf = null;
  const thread = document.getElementById("ai-thread");
  const leer = document.getElementById("ai-empty");
  if (thread) thread.replaceChildren(...(leer ? [leer] : []));
  if (leer) leer.style.display = "";
  zeigeVerlaeufe();
  (document.getElementById("ai-prompt") as HTMLTextAreaElement | null)?.focus();
}

/** Rechte Spalte: was der Agent in dieser Sitzung benutzt hat. Nur echte Daten. */
export function aktualisiereAgentPanel(
  tools: { name: string; costMsat: number }[],
  sessionTotalMsat?: number,
): void {
  const box = document.getElementById("agent-tools");
  if (box && tools.length > 0) {
    box.classList.remove("muted");
    // Als DOM (C-6d): Werkzeugnamen kommen vom Provider – nur als Text
    box.replaceChildren(...tools.map((x) => {
      const zeile = el("div", undefined, "panel-row");
      const haken = el("span", undefined, "panel-check");
      haken.append(haekchenEl());
      zeile.append(haken, el("span", x.name, "panel-name"), el("span", `${Math.floor(x.costMsat / 1000)} sat`, "panel-meta"));
      return zeile;
    }));
  }
  const c = document.getElementById("agent-cost");
  if (c && sessionTotalMsat !== undefined) {
    c.classList.remove("muted");
    const zeile = el("div", undefined, "panel-row");
    zeile.append(el("span", t("agent.dieseSitzung"), "panel-name"), el("span", `${Math.floor(sessionTotalMsat / 1000)} sat`, "panel-meta"));
    c.replaceChildren(zeile);
  }
}
