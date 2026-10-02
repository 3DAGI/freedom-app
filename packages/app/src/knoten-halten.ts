/**
 * Halten bei meinem Knoten (Sammlung B-9b2, Entscheidung L4 A): Nach einem
 * verschlüsselten Upload (Repo-Bundle, Chat-Anhang) bittet die App den
 * gekoppelten Knoten, den Blob dauerhaft zu halten – versiegelt, mit
 * Besitzer-Nachweis, an genau dieses Manifest (`baueHalteAuftrag()`).
 * Hier nur, was ohne DOM geht: die Einstellung und wie die Antwort zu lesen ist.
 */
import type { HalteAntwort } from "@freedomstack/protocol";

/** Haken „Meine Dateien bei meinem Knoten halten“ – „0“ heißt aus. Kein Geheimnis, nur eine Einstellung. */
export const LS_HALTEN = "freedom.knoten.halten";

/** Standard an: Wer seinen Knoten koppelt, will seine Dateien dort halten. */
export function haltenAn(ls: Pick<Storage, "getItem">): boolean {
  return ls.getItem(LS_HALTEN) !== "0";
}

/** So lange wartet die App auf die Antwort – der Knoten holt die Stücke erst von den Relays. */
export const HALTEN_ZEIT_MS = 90_000;
/** So oft sieht sie nach (Takt der Abfrage, nur während des Wartens). */
export const HALTEN_TAKT_MS = 3_000;
/** Höchstens so viel Rechenarbeit für den Umschlag – dieselbe Grenze wie bei KI-Anfragen (`MAX_POW_APP`). */
export const HALTEN_MAX_POW = 16;

export type HalteErgebnis = { art: "alle" | "teilweise" | "keins"; gehalten: number; gesamt: number };

/** Was die Antwort heißt – „alle“ nur, wenn der Knoten jedes Stück hält. */
export function halteErgebnis(a: HalteAntwort): HalteErgebnis {
  const art = a.gehalten >= a.gesamt ? "alle" : a.gehalten > 0 ? "teilweise" : "keins";
  return { art, gehalten: a.gehalten, gesamt: a.gesamt };
}

/** Rückmeldung des Knotens (7000, „error: …“) ohne Vorsilbe, gekürzt – nur als Text zeigen. */
export function ablehnungsGrund(content: string): string {
  return content.replace(/^error:\s*/, "").slice(0, 120);
}
