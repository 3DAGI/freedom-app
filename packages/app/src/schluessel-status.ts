/**
 * Schluesselwechsel der Kontakte (Schritt 8.6a), ohne DOM.
 *
 * Die App prueft fuer ihre Kontakte Mandate (38067) und Widerrufe (38068),
 * merkt sich je Kontakt das ERSTE Mandat, das sie sieht (Entscheidung MENSCH
 * 26.09.2026 – ein Dieb kann sein Mandat zurueckdatieren), und leitet daraus
 * den Stand ab: gueltig, abgeloest, widerrufen (gestohlen) oder streitig.
 * Das Gedaechtnis liegt im Tresor-Speicher und geht mit in die Sicherung.
 */
import {
  type GemerkteMandate, type KeyState, type NostrEvent, merkeMandate, resolveKey, trustEvent,
} from "@freedomstack/protocol";

export const LS_MANDATE = "freedom.mandate";
const HEX64 = /^[0-9a-f]{64}$/;

/** Gemerkte Mandate streng lesen. */
export function leseGemerkt(roh: string | null): GemerkteMandate {
  try {
    const x = JSON.parse(roh ?? "{}") as unknown;
    if (!x || typeof x !== "object" || Array.isArray(x)) return {};
    const out: GemerkteMandate = {};
    for (const [alt, v] of Object.entries(x as Record<string, unknown>)) {
      const e = v as { neu?: unknown; gesehen?: unknown } | null;
      if (HEX64.test(alt) && e && typeof e.neu === "string" && HEX64.test(e.neu) && Number.isSafeInteger(e.gesehen)) {
        out[alt] = { neu: e.neu, gesehen: e.gesehen as number };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Stand je Kontakt aus Mandaten und Widerrufen; merkt neue Mandate.
 * `events`: Mandate der Kontakte (authors) und Widerrufe, die sie nennen (#p).
 */
export function pruefeKontakte(
  kontakte: readonly string[], events: readonly NostrEvent[], bekannt: GemerkteMandate, jetzt = Math.floor(Date.now() / 1000),
): { gemerkt: GemerkteMandate; geaendert: boolean; stand: Map<string, KeyState> } {
  const { gemerkt, neu } = merkeMandate(bekannt, events, jetzt);
  const stand = new Map<string, KeyState>();
  for (const k of kontakte) stand.set(k, resolveKey(k, [...events], { gemerkt, nowSecs: jetzt }));
  return { gemerkt, geaendert: neu, stand };
}

/** Warnt die Ansicht vor diesem Kontakt? */
export function warnt(s: KeyState | undefined): boolean {
  return !!s && s.status !== "gueltig";
}

/** Nachricht eines widerrufenen Kontakts nach dem Diebstahl: nicht glauben. */
export function nachDiebstahl(ev: Pick<NostrEvent, "created_at" | "pubkey">, s: KeyState | undefined): boolean {
  return !!s && ev.pubkey === s.pubkey && !trustEvent(ev as NostrEvent, s).trust;
}
