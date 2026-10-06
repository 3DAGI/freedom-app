/**
 * Mandate von Kontakten gegen Bitcoin prüfen (Schritt 5.10b, B-17b3b, K4 A),
 * ohne DOM. Nur bei Bedarf: Gibt es für einen alten Schlüssel mehr als einen
 * Nachfolger (in den Mandaten oder gemerkt), holt die App die NIP-03-Beweise
 * (Kind 1040) zu diesen Mandaten und prüft sie gegen zwei Explorer – sonst
 * fragt niemand. Das Ergebnis (geprüfte Blockzeit je Mandat) entscheidet in
 * `merkeMandate()`; eine Höhe allein zählt nie.
 */
import {
  type GemerkteMandate, type NostrEvent, type OtsZeitstempel, type Verankerung, KIND_ROTATION_MANDATE,
  leseOtsBeweis, parseRotationMandate,
} from "@freedomstack/protocol";

export const MANDAT_ANKER_GRENZEN = {
  /** Beweise je Durchgang gegen Bitcoin prüfen (je zwei Explorer, je Höhe vier Anfragen). */
  pruefungen: 4,
} as const;

/** Mandate zu alten Schlüsseln mit mehr als einem Nachfolger – nur dort lohnt der Anker. */
export function streitigeMandate(events: readonly NostrEvent[], gemerkt: GemerkteMandate): NostrEvent[] {
  const je = new Map<string, { nachfolger: Set<string>; mandate: NostrEvent[] }>();
  for (const ev of events) {
    if (ev.kind !== KIND_ROTATION_MANDATE) continue;
    let m;
    try { m = parseRotationMandate(ev); } catch { continue; }
    const e = je.get(m.oldPubkey) ?? { nachfolger: new Set(gemerkt[m.oldPubkey] ? [gemerkt[m.oldPubkey]!.neu] : []), mandate: [] };
    e.nachfolger.add(m.newPubkey);
    e.mandate.push(ev);
    je.set(m.oldPubkey, e);
  }
  return [...je.values()].filter((e) => e.nachfolger.size > 1).flatMap((e) => e.mandate);
}

/**
 * Geprüfte Blockzeit je Mandat aus Kind 1040: nur Beweise, die genau eines
 * der Mandate beweisen (Kennung und Art), je Mandat der mit der niedrigsten
 * Höhe, höchstens `MANDAT_ANKER_GRENZEN.pruefungen` neue Prüfungen. `gedaechtnis`
 * (je Beweis-Kennung) hält Ergebnisse, die sich nicht mehr ändern – „keine
 * Aussage“ (Explorer fehlen oder uneinig) wird beim nächsten Mal neu gefragt.
 */
export async function ankerZeiten(
  mandate: readonly NostrEvent[], beweise: readonly NostrEvent[],
  pruefe: (z: OtsZeitstempel) => Promise<Verankerung>, gedaechtnis: Map<string, number | null> = new Map(),
): Promise<Map<string, number>> {
  const ids = new Set(mandate.map((m) => m.id));
  const bester = new Map<string, { ev: NostrEvent; hoehe: number; z: OtsZeitstempel }>();
  for (const ev of beweise) {
    let b;
    try { b = leseOtsBeweis(ev); } catch { continue; }
    if (!ids.has(b.eventId) || b.kind !== KIND_ROTATION_MANDATE) continue;
    const bisher = bester.get(b.eventId);
    if (!bisher || b.hoehe < bisher.hoehe) bester.set(b.eventId, { ev, hoehe: b.hoehe, z: b.datei.zeitstempel });
  }
  const zeiten = new Map<string, number>();
  let neu = 0;
  for (const [mandatId, { ev, z }] of bester) {
    if (!gedaechtnis.has(ev.id)) {
      if (neu >= MANDAT_ANKER_GRENZEN.pruefungen) continue;
      neu++;
      const r = await pruefe(z).catch((): Verankerung => ({ ok: false, fall: "nicht-erreichbar" }));
      if (r.ok) gedaechtnis.set(ev.id, r.zeit);
      else if (r.fall === "falsche-wurzel" || r.fall === "keine-bitcoin") gedaechtnis.set(ev.id, null);
    }
    const zeit = gedaechtnis.get(ev.id);
    if (typeof zeit === "number") zeiten.set(mandatId, zeit);
  }
  return zeiten;
}
