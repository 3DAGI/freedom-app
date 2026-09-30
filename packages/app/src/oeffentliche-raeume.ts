/**
 * Offene Räume, denen man beigetreten ist (Sammlung Neuordnung, B-7), ohne DOM.
 *
 * Bis B-7 stand in `freedom.spaces` nur die Kennung eines Raums
 * („werkstatt-ab12cd“), und die App nahm als Gründer, wer die neueste
 * Definition dazu schrieb – jeder konnte einen fremden Raum übernehmen. Jetzt
 * steht dort die Adresse (`34700:<gründer>:space:<kennung>`, `raumAdresse()`):
 * Nur die Definition des Gründers zählt (`raumZustandFuer()`), Rollen und
 * Rechte kommen von ihm.
 *
 * Alte Einträge und Beitritte mit bloßer Kennung bindet `bindeKennung()` an
 * einen Gründer, sobald der Raum das erste Mal geladen ist – nur, wenn das
 * eindeutig ist (`gruenderZurKennung()`); sonst braucht es die ganze Adresse.
 */
import { leseRaumAdresse, raumAdresse } from "@freedomstack/protocol";

export const LS_RAEUME = "freedom.spaces";
/** Mehr offene Räume merkt sich die App nicht. */
export const MAX_RAEUME = 200;

const KENNUNG = /^[A-Za-z0-9._-]{1,64}$/;

interface Speicher {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

/** Gemerkte Räume: Adressen und – von vor B-7 – bloße Kennungen; Unlesbares fällt weg. */
export function raumEintraege(s: Pick<Speicher, "getItem">): string[] {
  let roh: unknown = [];
  try { roh = JSON.parse(s.getItem(LS_RAEUME) ?? "[]"); } catch { /* leer */ }
  if (!Array.isArray(roh)) return [];
  return [...new Set(roh.filter((e): e is string => typeof e === "string" && kennungVon(e) !== null))].slice(0, MAX_RAEUME);
}

/** Die Kennung eines Eintrags (für das Tag `space`) – aus der Adresse oder der bloßen Kennung. */
export function kennungVon(eintrag: string): string | null {
  const a = leseRaumAdresse(eintrag);
  if (a) return a.spaceId;
  return KENNUNG.test(eintrag) ? eintrag : null;
}

/** Ist der Eintrag schon an einen Gründer gebunden? */
export function istAdresse(eintrag: string): boolean {
  return leseRaumAdresse(eintrag) !== null;
}

function schreibe(s: Speicher, eintraege: string[]): void {
  s.setItem(LS_RAEUME, JSON.stringify([...new Set(eintraege)].slice(0, MAX_RAEUME)));
}

/**
 * Beitreten mit dem, was jemand eingibt oder scannt: die Adresse des Raums
 * oder – wie bisher – seine Kennung. Eine Adresse ersetzt eine gemerkte
 * bloße Kennung desselben Raums. `null`, wenn es keins von beiden ist.
 */
export function beitreten(s: Speicher, eingabe: string): string | null {
  const e = eingabe.trim();
  const kennung = kennungVon(e);
  if (!kennung) return null;
  const alle = raumEintraege(s);
  schreibe(s, istAdresse(e) ? [...alle.filter((x) => x !== kennung), e] : alle.includes(e) ? alle : [...alle, e]);
  return e;
}

/**
 * Eine bloße Kennung an ihren Gründer binden (nach `gruenderZurKennung()`):
 * Der Eintrag wird zur Adresse, an seiner Stelle in der Liste. Gibt die
 * Adresse zurück.
 */
export function bindeKennung(s: Speicher, kennung: string, besitzer: string): string {
  const adresse = raumAdresse(besitzer, kennung);
  const alle = raumEintraege(s);
  const i = alle.indexOf(kennung);
  if (i >= 0) alle[i] = adresse;
  schreibe(s, i >= 0 ? alle.filter((x, j) => x !== adresse || j === i) : [...alle, adresse]);
  return adresse;
}
