/**
 * Ein Lauf auf meinem Knoten (VKe, Entwurf `docs/VIBECODEN-ENTWURF.md`, VK6): was die Projekte-Seite zeigt – ohne DOM.
 * Schritte kommen als versiegelte Rückmeldungen (7000, `partial`) in beliebiger Reihenfolge (`docs/PROTOCOL.md` §34):
 * geordnet wird nach `nr`, `befehl` vor `ausgabe`; ein Schritt wartet, solange zu seiner `nr` ein `befehl` mit
 * `wartet` und noch keine `ausgabe` vorliegt. Gezeigt wird nur Text (`textContent`) – Befehle, Ausgaben und Gedanken
 * kommen vom Modell des Knotens.
 */
import type { CodeAntwort, CodeEnde, CodeModus, CodeSchritt } from "@freedomstack/protocol";
import { t } from "./i18n.js";

/** So lange wartet die Seite höchstens auf das Ende – der Knoten bricht nach 60 min selbst ab (`grenze`). */
export const LAUF_ZEIT_MS = 65 * 60_000;

export interface SchrittAnzeige {
  nr: number;
  gedanke: string;
  befehl: string;
  /** Ein `befehl` mit `wartet` kam – bis zur `ausgabe` oder einer Antwort von hier. */
  wartet: boolean;
  /** Hier schon beantwortet (`freigabe`), die Antwort des Knotens steht noch aus. */
  beantwortet?: "ja" | "nein";
  ausgabe?: { text: string; code: number; gekuerzt: boolean };
}

export interface LaufStand {
  /** Id des Auftrags – nennt den Lauf in `freigabe` und `stopp`. */
  lauf: string;
  projekt: string;
  modus: CodeModus;
  text: string;
  schritte: SchrittAnzeige[];
  ende?: Extract<CodeAntwort, { aktion: "auftrag" }>;
  /** Der Knoten lehnte den Auftrag ab oder schwieg – ein Satz für die Seite. */
  fehler?: string;
}

export function neuerLauf(lauf: string, projekt: string, modus: CodeModus, text: string): LaufStand {
  return { lauf, projekt, modus, text, schritte: [] };
}

/** Einen Schritt übernehmen; false, wenn er nichts ändert (derselbe Umschlag zweimal). */
export function nimmSchritt(stand: LaufStand, s: CodeSchritt): boolean {
  let z = stand.schritte.find((x) => x.nr === s.nr);
  if (!z) {
    z = { nr: s.nr, gedanke: "", befehl: "", wartet: false };
    stand.schritte.push(z);
    stand.schritte.sort((a, b) => a.nr - b.nr);
  }
  const vorher = JSON.stringify(z);
  if (s.art === "befehl") {
    if (s.gedanke) z.gedanke = s.gedanke;
    z.befehl = s.befehl;
    if (s.wartet) z.wartet = true;
  } else {
    z.ausgabe = { text: s.ausgabe, code: s.code, gekuerzt: s.gekuerzt };
  }
  return JSON.stringify(z) !== vorher;
}

/** Wartet dieser Schritt auf meine Antwort? */
export function wartetAufMich(z: SchrittAnzeige, stand: Pick<LaufStand, "ende">): boolean {
  return z.wartet && !z.ausgabe && !z.beantwortet && !stand.ende;
}

export const CODE_ENDE_TEXT: Record<CodeEnde, string> = {
  fertig: "set.laufFertig",
  grenze: "set.laufGrenze",
  gestoppt: "set.laufGestoppt",
  abgelehnt: "set.laufAbgelehnt",
  fehler: "set.laufFehler",
};

/** Wie der Lauf endete – aus der Kennung, nie aus Text des Knotens. */
export function endeText(e: Pick<Extract<CodeAntwort, { aktion: "auftrag" }>, "ende" | "schritte">): string {
  return t(CODE_ENDE_TEXT[e.ende], { n: e.schritte });
}

/** Rückgabewert einer Ausgabe – „Zeit um“ für −1. */
export function codeText(code: number): string {
  return code === -1 ? t("set.laufZeitUm") : t("set.laufCode", { code });
}
