/**
 * Über welche Relays die Wallet-Verbindung (NWC) läuft (Schritt 6.3), ohne DOM.
 *
 * Die Relays nennt die Wallet in ihrer Verbindung – die App kann nur unter
 * ihnen wählen. Mit der Einstellung „nur eigenes oder .onion“ nimmt sie nur
 * das eigene Relay (vom Nutzer angegeben) und .onion-Relays; nennt die
 * Verbindung keines, verbindet sie nicht, statt still über ein fremdes zu gehen.
 * Beides ist nicht geheim und bleibt in localStorage (außerhalb der Sicherung,
 * wie alles unter `freedom.nwc.`).
 */
import { parseNwcUri, waehleNwcRelays } from "@freedomstack/protocol";

export const LS_NWC_NUR_PRIVAT = "freedom.nwc.nurPrivat";
export const LS_NWC_EIGENES_RELAY = "freedom.nwc.eigenesRelay";

type Speicher = Pick<Storage, "getItem">;

export function nwcRelayEinstellung(s: Speicher): { nurPrivat: boolean; eigenes?: string } {
  const eigenes = s.getItem(LS_NWC_EIGENES_RELAY)?.trim();
  return { nurPrivat: s.getItem(LS_NWC_NUR_PRIVAT) === "1", ...(eigenes ? { eigenes } : {}) };
}

/** Läuft die gespeicherte Wallet-Verbindung (auch) über ein fremdes Relay? Ohne Verbindung: nein. */
export function nwcUeberFremdesRelay(uri: string | null, s: Speicher): boolean {
  if (!uri) return false;
  try {
    const w = waehleNwcRelays(parseNwcUri(uri).relays, nwcRelayEinstellung(s));
    return "relays" in w && w.fremd;
  } catch {
    return false;
  }
}
