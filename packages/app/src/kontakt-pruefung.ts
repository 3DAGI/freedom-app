/**
 * Geprüfte Kontakte (Sammlung Neuordnung, B-4), ohne DOM.
 *
 * Wer den Sicherheitscode (`sicherheitscode()`) mit einem Kontakt verglichen
 * hat, merkt ihn hier als geprüft – je Schlüssel mit dem Zeitpunkt. Wechselt
 * der Kontakt den Schlüssel, ist der neue ungeprüft. Die Liste verrät, mit
 * wem man sich getroffen hat, deshalb liegt sie im Tresor (`geheim`); sie
 * gehört in die Sicherung, damit ein neues Gerät sie kennt.
 */
export const LS_GEPRUEFT = "freedom.kontakte.geprueft";
/** Mehr merkt sich die App nicht – älteste fallen zuerst weg. */
export const MAX_GEPRUEFT = 5000;

const HEX64 = /^[0-9a-f]{64}$/;

interface Speicher {
  getItem(k: string): string | null;
  setItem(k: string, v: string): Promise<void> | void;
}

/** Alle geprüften Kontakte – Unlesbares fällt weg, statt die Liste zu sperren. */
export function gepruefteKontakte(s: Pick<Speicher, "getItem">): Map<string, number> {
  let roh: unknown = {};
  try { roh = JSON.parse(s.getItem(LS_GEPRUEFT) ?? "{}"); } catch { /* leer */ }
  const out = new Map<string, number>();
  if (!roh || typeof roh !== "object" || Array.isArray(roh)) return out;
  for (const [pk, zeit] of Object.entries(roh as Record<string, unknown>)) {
    if (HEX64.test(pk) && Number.isSafeInteger(zeit) && (zeit as number) > 0) out.set(pk, zeit as number);
  }
  return out;
}

/** Wann dieser Schlüssel geprüft wurde – oder undefined. */
export function geprueftAm(s: Pick<Speicher, "getItem">, pk: string): number | undefined {
  return gepruefteKontakte(s).get(pk);
}

/** Als geprüft merken (nach dem Vergleich). */
export async function merkeGeprueft(s: Speicher, pk: string, jetzt = Math.floor(Date.now() / 1000)): Promise<void> {
  if (!HEX64.test(pk)) throw new Error("kontakt-pruefung: Schlüssel ungültig"); // kein UI-Text
  const alle = gepruefteKontakte(s);
  alle.delete(pk);
  alle.set(pk, jetzt);
  const behalten = [...alle].sort((a, b) => a[1] - b[1]).slice(-MAX_GEPRUEFT);
  await s.setItem(LS_GEPRUEFT, JSON.stringify(Object.fromEntries(behalten)));
}
