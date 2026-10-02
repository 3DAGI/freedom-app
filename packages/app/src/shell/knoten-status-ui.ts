/**
 * Status meines Knotens (Sammlung B-11b, Entscheidung L6 A – nur lesen): In
 * der Karte „Mein Knoten“ fragt „Status abfragen“ den gekoppelten Knoten
 * versiegelt mit Nachweis (`baueStatusAuftrag()`, frischer Sitzungsschlüssel)
 * – über den Weg aus B-9c2 (`wegZumKnoten()`), mit Haken also nur über sein
 * Relay. Gezeigt wird nur, was `leseKnotenStatus()` durchlässt, als Text.
 * Nur auf Knopfdruck, nie beim Start. Eigenes Modul: `mein-knoten.ts` hält
 * den Kopplungscode und schickt nichts hinaus.
 */
import {
  KIND_DVM_KNOTEN_STATUS, LocalSigner, baueStatusAuftrag, generateKeypair, leseKnotenStatus, type Kopplung, type KnotenStatus,
} from "@freedomstack/protocol";
import { t } from "../i18n.js";
import { HALTEN_MAX_POW, ablehnungsGrund } from "../knoten-halten.js";
import { STATUS_TAKT_MS, STATUS_ZEIT_MS, statusZeilen } from "../knoten-status-ansicht.js";
import { fehlerText } from "../protokoll-texte.js";
import { aktuellerKurs } from "./marktkurs.js";
import { meineKopplung } from "./mein-knoten.js";
import { angebotVon } from "./state.js";
import { warteAufKnoten, wegZumKnoten } from "./knoten-weg-ui.js";
import { el } from "./ui.js";

/** Zeilen in die Anzeige – nur als Text. */
function zeige(ziel: HTMLElement, zeilen: string[]): void {
  ziel.replaceChildren(...zeilen.map((z) => el("div", z)));
}

/** Rechenarbeit für den Umschlag, wie sie das Angebot des Knotens verlangt – höchstens `HALTEN_MAX_POW`. */
export async function powFuerKnoten(knoten: string): Promise<number> {
  const angebot = await angebotVon(knoten).catch(() => undefined);
  return angebot?.powBits !== undefined && angebot.powBits <= HALTEN_MAX_POW ? angebot.powBits : 0;
}

/**
 * Den Status meines Knotens einmal versiegelt erfragen – auch für den Haken
 * „Wecken“ (B-12d2, sein VAPID-Schlüssel). Zurück der gelesene Status oder ein
 * Satz, warum es keinen gibt (nur als Text zeigen).
 */
export async function frageKnotenStatus(k: Kopplung): Promise<{ status: KnotenStatus } | { grund: string }> {
  const powBits = await powFuerKnoten(k.knoten);
  const sitzung = new LocalSigner(generateKeypair().sk);
  // Alles über meinen Knoten (B-9c2): mit Haken nur über sein Relay – ohne Relay geht nichts hinaus
  const weg = await wegZumKnoten(k.knoten, sitzung);
  if (!weg) return { grund: t("set.knotenOhneRelay") };
  let antwort: Awaited<ReturnType<typeof warteAufKnoten>>;
  try {
    const { wrap, requestId } = await baueStatusAuftrag({ sitzung, kopplung: k, powBits });
    await weg.publish(wrap);
    antwort = await warteAufKnoten(weg, sitzung, requestId, KIND_DVM_KNOTEN_STATUS + 1000, STATUS_ZEIT_MS, STATUS_TAKT_MS);
  } finally {
    weg.schliesse();
  }
  if (!antwort) return { grund: t("set.statusSchweigt") };
  if ("abgelehnt" in antwort) return { grund: t("set.statusAbgelehnt", { grund: ablehnungsGrund(antwort.abgelehnt) }) };
  const s = leseKnotenStatus(antwort.ergebnis);
  return s ? { status: s } : { grund: t("set.statusUnlesbar") };
}

/** „Status abfragen“: einmal fragen, die Antwort als Zeilen zeigen. */
export async function zeigeKnotenStatus(): Promise<void> {
  const k = meineKopplung();
  const ziel = document.getElementById("knoten-status-anzeige");
  const knopf = document.getElementById("knoten-status-holen") as HTMLButtonElement | null;
  if (!k || !ziel || !knopf) return;
  knopf.disabled = true;
  zeige(ziel, [t("set.statusFragt")]);
  try {
    const r = await frageKnotenStatus(k);
    zeige(ziel, "status" in r ? statusZeilen(r.status, aktuellerKurs()) : [r.grund]);
  } catch (e) {
    zeige(ziel, [t("set.statusFehler", { fehler: fehlerText(e) })]);
  } finally {
    knopf.disabled = false;
  }
}

/** Knopf in der Karte „Mein Knoten“ (einmal beim Start) – gefragt wird erst beim Klick. */
export function wireKnotenStatus(): void {
  document.getElementById("knoten-status-holen")?.addEventListener("click", () => void zeigeKnotenStatus());
}
