/**
 * Private Antworten lesen (Schritt 3.2).
 *
 * Der Provider schickt Ergebnis (Kind 6xxx) und Rueckmeldung (7000) als Kern im
 * Umschlag an den Sitzungsschluessel. Hier werden solche Umschlaege mit dem
 * passenden Sitzungsschluessel geoeffnet und – wenn sie sich auf eine der
 * gesuchten Anfragen beziehen – wie offene Events zurueckgegeben. So bleibt
 * der Rest der App (Warten, Failover, `parseJobResult()`) unveraendert, und
 * offene Antworten aelterer Knoten gelten weiter.
 */
import { type NostrEvent, getTag, isDvmResult, openPrivateJobResponse } from "@freedomstack/protocol";
import type { KiSitzungen } from "./ki-sitzung.js";

/** Geoeffnete Umschlaege merken – bei jeder Abfrage neu zu entschluesseln kostet unnoetig. */
export type AntwortCache = Map<string, NostrEvent | null>;

export async function oeffneAntworten(
  umschlaege: readonly NostrEvent[],
  sitzungen: KiSitzungen,
  ids: ReadonlySet<string>,
  cache: AntwortCache = new Map(),
): Promise<{ ergebnisse: NostrEvent[]; rueckmeldungen: NostrEvent[] }> {
  const ergebnisse: NostrEvent[] = [];
  const rueckmeldungen: NostrEvent[] = [];
  for (const w of umschlaege) {
    let ev = cache.get(w.id);
    if (ev === undefined) {
      const signer = sitzungen.mitPubkey(getTag(w, "p") ?? "");
      const r = signer ? await openPrivateJobResponse(w, signer) : null;
      // Ohne Signatur – die Echtheit belegt das Siegel des Providers.
      ev = r?.ok ? { ...r.response, sig: "" } : null;
      cache.set(w.id, ev);
    }
    if (!ev || !ids.has(getTag(ev, "e") ?? "")) continue;
    (isDvmResult(ev.kind) ? ergebnisse : rueckmeldungen).push(ev);
  }
  // Neueste zuerst – wie Relays offene Events liefern.
  const neu = (a: NostrEvent, b: NostrEvent): number => b.created_at - a.created_at;
  return { ergebnisse: ergebnisse.sort(neu), rueckmeldungen: rueckmeldungen.sort(neu) };
}
