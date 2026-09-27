/**
 * Ehrlicher Modus der Web-App (Schritt 6.2): Laeuft dieser Browser ueber Tor?
 *
 * Eine Web-App kann Tor weder herstellen noch fragen. Sie kann aber
 * versuchen, ein .onion-Relay zu erreichen: Das gelingt nur, wenn der Browser
 * ueber Tor laeuft (Tor Browser). Gaengige Browser loesen .onion-Namen gar
 * nicht erst auf (RFC 7686) – der Versuch scheitert auf dem Geraet. Scheitert
 * er, kann auch nur das Relay aus sein; der Bericht sagt darum „wohl nicht“.
 *
 * Geprueft werden nur .onion-Adressen, die die App schon kennt (entdeckte
 * Relays, eigener Satz) oder die der Nutzer zum Pruefen eintraegt – mit
 * Zeitlimit, hoechstens drei, erst wenn der Datenschutzbericht gebraucht wird.
 * Das Ergebnis ersetzt im Bericht die Aussage „ip“ (`ipFaktFuer`, privacy-facts.ts).
 */
import { isOnion, isPlausibleRelayUrl, normalizeRelayUrl, type OnionPruefung } from "@freedomstack/protocol";

/** Ein Weg ueber Tor zu einem Onion-Dienst braucht einige Sekunden – mehr bekommt er nicht. */
export const ONION_ZEITLIMIT_MS = 10_000;
export const ONION_HOECHSTENS = 3;
/** Vom Nutzer eingetragenes .onion-Relay – nur fuer diese Pruefung, oeffentlich wie jede Relay-Adresse. */
export const LS_ONION_PRUEFRELAY = "freedom.onion.pruefrelay";

/** Das Noetigste von einem WebSocket – im Test ersetzbar. */
export interface Sonde {
  onopen: ((ev: never) => unknown) | null;
  onerror: ((ev: never) => unknown) | null;
  onclose: ((ev: never) => unknown) | null;
  close(): void;
}
export type SondenFabrik = (url: string) => Sonde;

/** Ist das eine brauchbare .onion-Relay-Adresse? (normalisiert, sonst null) */
export function onionRelay(roh: unknown): string | null {
  if (typeof roh !== "string" || !isOnion(roh) || !isPlausibleRelayUrl(roh).ok) return null;
  return normalizeRelayUrl(roh);
}

/** Die .onion-Relays zum Pruefen: eingetragenes zuerst, ohne Doppelte, hoechstens drei. */
export function onionKandidaten(eingetragen: string | null, bekannt: readonly unknown[]): string[] {
  const out = new Set<string>();
  for (const u of [eingetragen, ...bekannt]) {
    const o = onionRelay(u);
    if (o) out.add(o);
  }
  return [...out].slice(0, ONION_HOECHSTENS);
}

/**
 * Alle Kandidaten gleichzeitig versuchen: Oeffnet sich einer, laeuft der
 * Browser ueber Tor. Scheitern alle oder laeuft die Zeit ab: nicht erreichbar.
 * Ohne Kandidaten gibt es nichts zu pruefen.
 */
export function pruefeOnion(urls: readonly string[], fabrik: SondenFabrik, zeitlimitMs = ONION_ZEITLIMIT_MS): Promise<OnionPruefung> {
  if (urls.length === 0) return Promise.resolve("keine-onion");
  return new Promise((fertig) => {
    const sonden: Sonde[] = [];
    let offen = urls.length;
    let ende = false;
    const schluss = (r: OnionPruefung) => {
      if (ende) return;
      ende = true;
      clearTimeout(uhr);
      for (const s of sonden) {
        s.onopen = s.onerror = s.onclose = null;
        try {
          s.close();
        } catch { /* schon zu */ }
      }
      fertig(r);
    };
    const uhr = setTimeout(() => schluss("nicht-erreichbar"), zeitlimitMs);
    for (const url of urls) {
      let gescheitert = false;
      const scheitert = () => {
        if (gescheitert) return;
        gescheitert = true;
        if (--offen === 0) schluss("nicht-erreichbar");
      };
      let s: Sonde;
      try {
        // Ein Browser ohne Tor wirft hier mitunter sofort (gemischte Inhalte, gesperrte Adresse).
        s = fabrik(url);
      } catch {
        scheitert();
        continue;
      }
      sonden.push(s);
      s.onopen = () => schluss("erreichbar");
      s.onerror = scheitert;
      s.onclose = scheitert;
    }
  });
}
