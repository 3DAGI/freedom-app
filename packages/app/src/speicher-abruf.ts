/**
 * Fehlende Blob-Stuecke bei Speicherknoten abrufen (Schritt 8.9b), ohne DOM.
 *
 * Findet die App auf den Relays nicht genug Stuecke, fragt sie Speicherknoten
 * (Angebote mit `storage`, hoechstens 24 Stunden alt) versiegelt an – von
 * einem frischen Sitzungsschluessel je Download, mit der Rechenarbeit, die der
 * Knoten verlangt. Die Knoten veroeffentlichen ihre gespeicherten Stuecke
 * erneut (8.9a); die App liest sie danach wie gewohnt vom Relay und prueft sie
 * gegen das Manifest. Bezahlung folgt mit 8.9c.
 */
import {
  KIND_PROVIDER_CAPABILITIES, LocalSigner, baueStueckAbruf, generateKeypair, parseCapabilities,
  type NostrEvent,
} from "@freedomstack/protocol";

export interface SpeicherKnoten {
  pk: string;
  powBits: number;
}

/** Hoechstens so viele Knoten je Download – jeder bekommt je fehlendem Stueck einen Abruf. */
export const MAX_KNOTEN = 4;

/** Speicherknoten aus Angeboten: frisch (24 h), mit Speicher-Rolle, je Schluessel das neueste. */
export function speicherKnoten(angebote: readonly NostrEvent[], jetzt = Math.floor(Date.now() / 1000), max = MAX_KNOTEN): SpeicherKnoten[] {
  const neueste = new Map<string, { at: number; k: SpeicherKnoten }>();
  for (const ev of angebote) {
    if (ev.kind !== KIND_PROVIDER_CAPABILITIES || jetzt - ev.created_at > 86_400) continue;
    try {
      const c = parseCapabilities(ev);
      if (!c.storage || c.pubkey !== ev.pubkey) continue;
      const alt = neueste.get(ev.pubkey);
      if (!alt || ev.created_at > alt.at) neueste.set(ev.pubkey, { at: ev.created_at, k: { pk: ev.pubkey, powBits: c.powBits ?? 0 } });
    } catch { /* fremdes Unfug-Angebot */ }
  }
  return [...neueste.values()].sort((a, b) => b.at - a.at).slice(0, max).map((x) => x.k);
}

/**
 * Je Knoten und fehlendem Stueck einen versiegelten Abruf senden. Gibt die
 * Zahl der gesendeten Abrufe zurueck.
 */
export async function frageKnotenAn(p: {
  pool: { publish: (ev: NostrEvent) => Promise<unknown> };
  knoten: readonly SpeicherKnoten[];
  blobId: string;
  fehlend: readonly number[];
}): Promise<number> {
  const sitzung = new LocalSigner(generateKeypair().sk);
  let n = 0;
  for (const k of p.knoten) {
    for (const index of p.fehlend) {
      const { wrap } = await baueStueckAbruf({ sitzung, knotenPk: k.pk, blobId: p.blobId, index, powBits: k.powBits });
      await p.pool.publish(wrap);
      n++;
    }
  }
  return n;
}
