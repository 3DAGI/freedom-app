/**
 * Leistungs-Events (kind 38010).
 *
 * Jede abrechenbare Aktion erzeugt ein signiertes Leistungs-Event: wer, was,
 * welcher Betrag, welche Chain. Daraus entstehen Reputation, Abzeichen
 * (`quests.ts`) und die Karte, wo Kapazität fehlt – öffentlich prüfbar,
 * off-chain. Geld hängt daran nicht: Saisons mit Pool-Regeln (38012) und
 * Ausschüttungsnachweise (38011) fielen mit dem Gebührenmodell A+ (5.1.4d).
 *
 * Bewusst als Nostr-Event modelliert (Buzz-Muster: neue Funktion = neue Kind),
 * damit die Events auf jedem Relay liegen koennen und kein Server noetig ist.
 */
import { UnsignedEvent, NostrEvent, buildEvent, getTag } from "./event.js";
import { KIND_PERFORMANCE } from "./kinds.js";

export type WorkType = "message" | "ai_job" | "liquidity" | "relay";
export type Chain = "lightning" | "solana" | "polygon" | "ton";

export interface PerformanceParams {
  /** Wer die Leistung erbracht hat. */
  workerPubkey: string;
  workType: WorkType;
  /** Verrechnungseinheit: Anzahl Nachrichten, Jobs, msats Liquiditaet ... */
  units: number;
  /** Erloes/Volumen in Millisatoshi (fuer Fee-Berechnung). */
  volumeMsat: number;
  chain: Chain;
  /** Referenz auf den Beleg (z. B. Zap-Receipt-ID oder Job-Result-ID). */
  proofEventId?: string;
  /** Season-Kennung. */
  seasonId: string;
}

export function buildPerformanceEvent(p: PerformanceParams, createdAt?: number): UnsignedEvent {
  const tags: string[][] = [
    ["d", `${p.seasonId}:${p.workerPubkey}:${p.proofEventId ?? String(createdAt ?? "")}`],
    ["season", p.seasonId],
    ["worker", p.workerPubkey],
    ["work_type", p.workType],
    ["units", String(p.units)],
    ["volume_msat", String(p.volumeMsat)],
    ["chain", p.chain],
  ];
  if (p.proofEventId) tags.push(["proof", p.proofEventId]);
  return buildEvent(p.workerPubkey, KIND_PERFORMANCE, tags, "", createdAt);
}

export interface ParsedPerformance {
  workerPubkey: string;
  seasonId: string;
  workType: WorkType;
  units: number;
  volumeMsat: number;
  chain: Chain;
  proofEventId?: string;
  eventId: string;
  createdAt: number;
}

export function parsePerformance(ev: NostrEvent): ParsedPerformance {
  if (ev.kind !== KIND_PERFORMANCE) throw new Error(`kein Performance-Kind: ${ev.kind}`);
  const req = (n: string): string => {
    const v = getTag(ev, n);
    if (v === undefined) throw new Error(`fehlendes Tag: ${n}`);
    return v;
  };
  const worker = req("worker");
  // Selbstbezeugung: Der Autor muss der Worker sein, sonst faelschbar.
  if (worker !== ev.pubkey) throw new Error("worker-Tag stimmt nicht mit Autor ueberein");
  return {
    workerPubkey: worker,
    seasonId: req("season"),
    workType: req("work_type") as WorkType,
    units: Number(req("units")),
    volumeMsat: Number(req("volume_msat")),
    chain: req("chain") as Chain,
    proofEventId: getTag(ev, "proof"),
    eventId: ev.id,
    createdAt: ev.created_at,
  };
}
