/**
 * Web of Trust aus signierten Attestierungen.
 *
 * Nach jedem abgeschlossenen Swap/Job attestieren beide Seiten einander
 * (kind 38002). Aus diesen Attestierungen entsteht ein Vertrauensgraph.
 *
 * Zweck: Sybil-Schutz fuer Rewards. Ein Angreifer kann beliebig viele Keys
 * erzeugen, aber keine Attestierungen von etablierten Teilnehmern erschleichen.
 * Das Gewicht faellt mit der Distanz zum Vertrauensanker.
 */
import { NostrEvent, getTag } from "./event.js";
import { KIND_SWAP_ATTESTATION } from "./kinds.js";

export interface TrustEdge {
  from: string;
  to: string;
  success: boolean;
}

/** Extrahiert Vertrauenskanten aus Attestierungs-Events. */
export function extractEdges(events: NostrEvent[]): TrustEdge[] {
  const out: TrustEdge[] = [];
  for (const ev of events) {
    if (ev.kind !== KIND_SWAP_ATTESTATION) continue;
    const to = getTag(ev, "p");
    const result = getTag(ev, "result");
    if (!to) continue;
    out.push({ from: ev.pubkey, to, success: result !== "fail" });
  }
  return out;
}

export interface WotOptions {
  /** Vertrauensanker (eigene Kontakte / bekannte gute Teilnehmer). */
  roots: string[];
  /** Maximale Tiefe der Vertrauenskette. Default 3. */
  maxDepth?: number;
  /** Abschlag pro Hop. Default 0.5. */
  decay?: number;
}

/**
 * Berechnet Vertrauensgewichte per BFS von den Ankern aus.
 * Anker = 1.0, ein Hop = decay, zwei Hops = decay^2 ...
 * Fehlgeschlagene Attestierungen zaehlen nicht als Vertrauen.
 */
export function computeTrust(edges: TrustEdge[], opts: WotOptions): Map<string, number> {
  const maxDepth = opts.maxDepth ?? 3;
  const decay = opts.decay ?? 0.5;

  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!e.success) continue;
    if (!adj.has(e.from)) adj.set(e.from, new Set());
    adj.get(e.from)!.add(e.to);
  }

  const trust = new Map<string, number>();
  for (const r of opts.roots) trust.set(r, 1.0);

  let frontier = [...opts.roots];
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const weight = Math.pow(decay, depth);
    const next: string[] = [];
    for (const node of frontier) {
      for (const peer of adj.get(node) ?? []) {
        if (trust.has(peer)) continue; // kuerzester Pfad gewinnt
        trust.set(peer, weight);
        next.push(peer);
      }
    }
    frontier = next;
  }
  return trust;
}

/** Vertrauensgewicht eines Teilnehmers (0, wenn unbekannt). */
export function trustOf(trust: Map<string, number>, pubkey: string): number {
  return trust.get(pubkey) ?? 0;
}
