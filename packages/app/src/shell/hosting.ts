/**
 * Hosting-Anteil (Schritt 5.3): Wer die App ausliefert, bekommt 1 % jeder
 * KI-Zahlung über diese Auslieferung (Entscheidung 4.0). Die Adressen stehen
 * in `freedom-spiegel.json` neben freedom.html – die App liest sie von ihrer
 * eigenen Herkunft, dort ablegen kann nur der Betreiber des Spiegels. Fehlt die
 * Datei (lokal geöffnet, ohne Netz, Platzhalter), bleibt der Anteil beim
 * Provider.
 */
import { SPIEGEL_DATEI, leseSpiegelDatei, type Zahlziel } from "@freedomstack/protocol";

let ziel: Promise<Zahlziel | undefined> | null = null;

/** Einmal je Sitzung von der eigenen Herkunft gelesen. */
export function hostingZahlziel(): Promise<Zahlziel | undefined> {
  ziel ??= (async () => {
    if (!/^https?:$/.test(location.protocol)) return undefined;
    try {
      const r = await fetch(new URL(SPIEGEL_DATEI, location.href), { cache: "no-store", signal: AbortSignal.timeout(5000) });
      return r.ok ? leseSpiegelDatei(await r.json()) ?? undefined : undefined;
    } catch {
      return undefined;
    }
  })();
  return ziel;
}
