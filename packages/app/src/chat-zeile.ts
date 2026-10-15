/**
 * Zeile der Chat-Liste (C-52a, Oberflächen-Review 15.10.2026) – ohne DOM. Bis jetzt stand dort nur der Name;
 * wer wissen wollte, was zuletzt kam und wann, musste die Unterhaltung öffnen.
 *
 * Die Vorschau lebt nur im Speicher dieser Sitzung (`merkeVorschau()`): Sie entsteht aus dem, was die App ohnehin
 * öffnet (Abgleich des Posteingangs, Senden, geöffneter Verlauf) – nie auf dem Gerät gespeichert, auch nicht im
 * Tresor; mit dem Neuladen (Sperren, Identität wechseln) ist sie weg. Nachrichten mit Ablauf (NIP-40) verschwinden
 * aus der Vorschau, sobald sie abgelaufen sind.
 */
import { parseDmBody } from "./shell-logic.js";
import { gebietsschema, t } from "./i18n.js";

export interface Vorschau {
  /** Kurzer Text ohne Zeilenumbrüche; bei Anhängen ohne Text deren Art. */
  text: string;
  vonMir: boolean;
  /** Sekunden (Nachricht). */
  zeit: number;
  /** Ablauf nach NIP-40 (Sekunden), falls gesetzt. */
  ablauf?: number;
}

const VORSCHAU_ZEICHEN = 80;
const vorschauen = new Map<string, Vorschau>();

/** Der sichtbare Text einer Nachricht in einer Zeile – Anhänge ohne Text als ihre Art, nie die Adresse. */
export function vorschauText(inhalt: string): string {
  const { text, attachments } = parseDmBody(inhalt);
  const zeichen = Array.from(text.replace(/\s+/g, " ").trim());
  if (zeichen.length > 0) return zeichen.length > VORSCHAU_ZEICHEN ? `${zeichen.slice(0, VORSCHAU_ZEICHEN - 1).join("")}…` : zeichen.join("");
  if (attachments.length === 0) return "";
  if (attachments.every((a) => (a.mime ?? "").startsWith("audio/"))) return t("chatZeile.sprachnachricht");
  if (attachments.every((a) => (a.mime ?? "").startsWith("image/"))) return t("chatZeile.bild");
  return t("chatZeile.anhang", { n: attachments.length });
}

/** Die neueste Nachricht einer Unterhaltung merken – eine ältere ersetzt eine neuere nie. */
export function merkeVorschau(cid: string, nachricht: { inhalt: string; vonMir: boolean; zeit: number; ablauf?: number }): void {
  const alt = vorschauen.get(cid);
  if (alt && alt.zeit > nachricht.zeit) return;
  const text = vorschauText(nachricht.inhalt);
  if (!text) return;
  vorschauen.set(cid, { text, vonMir: nachricht.vonMir, zeit: nachricht.zeit, ...(nachricht.ablauf ? { ablauf: nachricht.ablauf } : {}) });
}

/** Vorschau zum Anzeigen; abgelaufene (NIP-40) gibt es nicht mehr. */
export function vorschauVon(cid: string, jetzt = Math.floor(Date.now() / 1000)): Vorschau | undefined {
  const v = vorschauen.get(cid);
  if (v?.ablauf !== undefined && v.ablauf <= jetzt) {
    vorschauen.delete(cid);
    return undefined;
  }
  return v;
}

/** Vorschau als Zeile: eigene Nachrichten mit „Du:“. */
export function vorschauZeile(v: Vorschau): string {
  return v.vonMir ? t("chatZeile.du", { text: v.text }) : v.text;
}

/**
 * Zeit in der Zeile wie in Messengern: heute die Uhrzeit, gestern „gestern“, in den letzten sechs Tagen der
 * Wochentag, sonst das Datum (mit Jahr nur, wenn es nicht dieses ist). 0 oder ungültig: leer.
 */
export function zeitKurz(sekunden: number, jetzt: Date = new Date()): string {
  if (!Number.isFinite(sekunden) || sekunden <= 0) return "";
  const d = new Date(sekunden * 1000);
  const ort = gebietsschema();
  const tag = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const tage = Math.round((tag(jetzt) - tag(d)) / 86_400_000);
  if (tage <= 0) return d.toLocaleTimeString(ort, { hour: "2-digit", minute: "2-digit" });
  if (tage === 1) return t("chatZeile.gestern");
  if (tage < 7) return d.toLocaleDateString(ort, { weekday: "short" });
  return d.toLocaleDateString(ort, d.getFullYear() === jetzt.getFullYear()
    ? { day: "2-digit", month: "2-digit" } : { day: "2-digit", month: "2-digit", year: "2-digit" });
}
