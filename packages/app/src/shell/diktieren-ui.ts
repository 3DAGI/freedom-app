/**
 * Diktieren im Agenten (Sammlung B-38c2, SP-W1 A, SP-W5 A, `docs/SPRACHE-ENTWURF.md`): Mikrofon-Knopf neben „Senden“ –
 * nur mit einem Weg für Text aus Sprache (seit B-38c3 auch ein Server auf diesem Rechner, sonst der eigene Knoten). Erst der Klick fragt das Mikrofon an (dieselbe Aufnahme wie Sprachnachrichten,
 * `SprachAufnahme`); beenden, die Grenze, eine Seite im Hintergrund – danach ist es aus. Den Text schreibt der eigene
 * Knoten (`textAusSprache()` in der Sprache der App), die App setzt ihn ins Eingabefeld; gesendet wird erst mit „Senden“.
 * Die Aufnahme bleibt nur im Speicher.
 */
import { getLang, t } from "../i18n.js";
import { fehlerText } from "../protokoll-texte.js";
import { SPRACH_GRENZEN, SprachAufnahme, type SprachErgebnis, dauerText } from "../sprachnachricht.js";
import { textAusSprache, textAusSpracheMoeglich } from "./sprache-text-ui.js";
import { browserUmgebung } from "./sprachnachricht-ui.js";
import { toast } from "./ui.js";

let aufnahme: SprachAufnahme | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
let schreibt = false;

const knopf = () => document.getElementById("ai-diktieren") as HTMLButtonElement | null;
const stand = () => document.getElementById("ai-diktat-stand");

/** Den Knopf nur mit einem Weg (Server auf diesem Rechner, gekoppelter Knoten) und Mikrofon – beim Start und bei jedem Wechsel zum Agenten. */
export function zeigeDiktieren(): void {
  const k = knopf();
  if (k) k.hidden = !textAusSpracheMoeglich() || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined";
}

export function wireDiktieren(): void {
  const k = knopf();
  if (!k) return;
  zeigeDiktieren();
  k.onclick = () => void umschalten();
  // Im Hintergrund nimmt die App nicht weiter auf: beenden, der Text kommt trotzdem
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && aufnahme?.stand === "nimmt-auf") void beende();
  });
  window.addEventListener("pagehide", () => void aufnahme?.brichAb());
}

async function umschalten(): Promise<void> {
  const k = knopf(), s = stand();
  if (!k || !s || schreibt) return;
  if (aufnahme?.stand === "nimmt-auf") return beende();
  if (aufnahme && aufnahme.stand !== "bereit") return;
  // Endet sie von selbst (Grenze, Mikrofon weg), schreibt der Knoten trotzdem mit
  aufnahme = new SprachAufnahme(browserUmgebung(), (e) => {
    zuruecksetzen();
    void schreibe(e);
  });
  s.hidden = false;
  s.textContent = t("komm.sprachFrage");
  try {
    await aufnahme.starte();
  } catch (e) {
    zuruecksetzen();
    toast(t("komm.sprachKeinMikrofon", { fehler: fehlerText(e) }), true);
    return;
  }
  if (aufnahme.stand !== "nimmt-auf") return zuruecksetzen();
  k.setAttribute("aria-pressed", "true");
  k.classList.add("nimmt-auf");
  k.title = t("agent.diktatBeenden");
  k.setAttribute("aria-label", t("agent.diktatBeenden"));
  const zeige = () => {
    s.textContent = t("agent.diktatLaeuft", { zeit: dauerText(aufnahme?.sekunden ?? 0), grenze: dauerText(SPRACH_GRENZEN.sekunden) });
  };
  zeige();
  ticker = setInterval(zeige, 500);
}

async function beende(): Promise<void> {
  const a = aufnahme;
  if (!a) return;
  const e = await a.beende();
  zuruecksetzen();
  await schreibe(e);
}

function zuruecksetzen(): void {
  if (ticker) clearInterval(ticker);
  ticker = null;
  const k = knopf(), s = stand();
  if (k) {
    k.setAttribute("aria-pressed", "false");
    k.classList.remove("nimmt-auf");
    k.title = t("agent.diktieren");
    k.setAttribute("aria-label", t("agent.diktieren"));
  }
  if (s) {
    s.textContent = "";
    s.hidden = true;
  }
}

/** Den Text vom eigenen Knoten ins Eingabefeld – angehängt an das, was dort schon steht. */
async function schreibe(e: SprachErgebnis | null): Promise<void> {
  if (!e) return toast(t("agent.diktatLeer"), true);
  const k = knopf(), s = stand();
  schreibt = true;
  if (k) k.disabled = true;
  if (s) {
    s.hidden = false;
    s.textContent = t("komm.alsTextLaeuft");
  }
  try {
    const r = await textAusSprache(new Uint8Array(await e.datei.arrayBuffer()), getLang());
    if (!("text" in r)) return toast(r.grund, true);
    if (!r.text) return toast(t("komm.alsTextStille"), true);
    const feld = document.getElementById("ai-prompt") as HTMLTextAreaElement | null;
    if (!feld) return;
    feld.value = feld.value.trim() ? `${feld.value.trimEnd()} ${r.text}` : r.text;
    feld.dispatchEvent(new Event("input", { bubbles: true }));
    feld.focus();
  } catch (err) {
    toast(t("komm.alsTextFehler", { fehler: fehlerText(err) }), true);
  } finally {
    schreibt = false;
    if (k) k.disabled = false;
    zuruecksetzen();
  }
}
