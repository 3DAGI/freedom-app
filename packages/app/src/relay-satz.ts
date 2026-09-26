/**
 * Eigener Relay-Satz der App (Schritt 5.4a), ohne DOM.
 *
 * Bis 5.4 hing die App an drei fest verdrahteten Relays. Jetzt hat jeder
 * Nutzer einen festen Satz aus der Startliste (NIP-65, Kind 10002, und als
 * Posteingang Kind 10050), dazu je Sitzung wechselnd weitere. Welcher Satz
 * gilt, entscheidet die veroeffentlichte Liste – so behalten alle Geraete
 * einer Identitaet denselben. Die App merkt ihn sich nur, damit der Pool
 * beim naechsten Start gleich richtig aufgebaut ist.
 */
import {
  KIND_DM_RELAYS, KIND_RELAY_LIST, buildDmRelayList, buildRelayList, eigenerRelaySatz, isPlausibleRelayUrl,
  normalizeRelayUrl, sitzungsRelays, startUrls,
  type NostrEvent, type OutboxPool, type UnsignedEvent,
} from "@freedomstack/protocol";

/** Oeffentlich wie die Liste selbst – kein Geheimnis, darum nicht im Tresor. */
export const LS_EIGENE_RELAYS = "freedom.relays.eigene";
/** So viele Relays muessen antworten, bevor „keine Liste gefunden“ als „gibt es nicht“ gilt. */
export const MIN_ANTWORTEN = 2;

/** Der gemerkte Satz – leer, wenn es noch keinen gibt oder der Speicher klemmt. */
export function ladeEigeneRelays(s: Pick<Storage, "getItem">): string[] {
  try {
    const a = JSON.parse(s.getItem(LS_EIGENE_RELAYS) ?? "[]") as unknown;
    return Array.isArray(a) ? a.filter((u): u is string => typeof u === "string" && isPlausibleRelayUrl(u).ok).slice(0, 8) : [];
  } catch {
    return [];
  }
}

/**
 * Relays dieser Sitzung: eigener Satz, wechselnd weitere aus der Startliste
 * und die gemerkten Funde. Beim allerersten Start (noch kein Satz) die ganze
 * Startliste – dort liegt eine vielleicht schon veroeffentlichte Liste.
 */
export function poolRelays(p: { eigene: readonly string[]; gemerkt: readonly string[]; zufall?: () => number }): string[] {
  const basis = p.eigene.length ? sitzungsRelays({ eigene: p.eigene, zufall: p.zufall }) : startUrls();
  return [...new Set([...basis, ...p.gemerkt.map(normalizeRelayUrl)])];
}

/**
 * Eigene Listen lesen, den Satz bestimmen, fehlende oder veraltete Listen
 * veroeffentlichen (`weit`: an Pool und ganze Startliste). null, wenn zu
 * wenige Relays antworteten oder das Veroeffentlichen scheiterte – dann beim
 * naechsten Mal wieder, ohne einen neuen Satz zu wuerfeln.
 */
export async function eigeneListenAbgleichen(p: {
  pool: Pick<OutboxPool, "queryMitBericht">;
  pk: string;
  signiere: (ev: UnsignedEvent) => Promise<NostrEvent>;
  weit: (ev: NostrEvent) => Promise<boolean>;
  speicher: Pick<Storage, "setItem">;
  zufall?: () => number;
}): Promise<string[] | null> {
  const { events, antworten } = await p.pool.queryMitBericht({ kinds: [KIND_RELAY_LIST, KIND_DM_RELAYS], authors: [p.pk], limit: 10 });
  if (antworten.length < MIN_ANTWORTEN) return null;
  const neueste = (kind: number) => events.filter((e) => e.kind === kind && e.pubkey === p.pk).sort((a, b) => b.created_at - a.created_at)[0];
  const satz = eigenerRelaySatz({ liste: neueste(KIND_RELAY_LIST), posteingang: neueste(KIND_DM_RELAYS), zufall: p.zufall });
  // Erst die NIP-65-Liste: Steht sie, gilt sie beim naechsten Mal – auch wenn der Posteingang hier noch scheitert.
  if (satz.liste && !(await p.weit(await p.signiere(buildRelayList(p.pk, satz.eigene.map((url) => ({ url }))))))) return null;
  if (satz.posteingang && !(await p.weit(await p.signiere(buildDmRelayList(p.pk, satz.eigene))))) return null;
  try {
    p.speicher.setItem(LS_EIGENE_RELAYS, JSON.stringify(satz.eigene));
  } catch {
    /* ohne Speicher: naechster Start mit der ganzen Startliste */
  }
  return satz.eigene;
}
