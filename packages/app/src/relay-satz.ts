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
  KIND_DM_RELAYS, KIND_RELAY_LIST, buildDmRelayList, buildRelayList, eigenerRelaySatz, isPlausibleRelayUrl, isUsableDmRelay,
  normalizeRelayUrl, sitzungsRelays, startUrls,
  type NostrEvent, type OutboxPool, type UnsignedEvent,
} from "@freedomstack/protocol";
import { t } from "./i18n.js";
import { relayUrlGrund } from "./protokoll-texte.js";

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

/** Höchstens so viele eigene Relays (wie `ladeEigeneRelays`). */
export const MAX_EIGENE = 8;

/** Taugt eine Adresse für den eigenen Satz? Plausibel und verschlüsselt (`wss://`; `ws://` nur für .onion), kein lokaler Host. */
export function taugtFuerSatz(adresse: string): boolean {
  if (!isPlausibleRelayUrl(adresse).ok) return false;
  const u = normalizeRelayUrl(adresse);
  return isUsableDmRelay(u) || (u.startsWith("ws://") && new URL(u).hostname.endsWith(".onion"));
}

/**
 * Eigenen Satz aus einer Eingabe (Settings, 5.4b2): Adressen durch Komma oder
 * Leerraum, jede plausibel und verschlüsselt (`wss://`; `ws://` nur für
 * .onion, dort verschlüsselt Tor), kein lokaler Host, ohne Doppelte, eine bis
 * `MAX_EIGENE`, mindestens eine taugt als Posteingang. Sonst ein Fehler zum
 * Anzeigen (per textContent).
 */
export function pruefeRelayEingabe(text: string): { relays: string[] } | { fehler: string } {
  const teile = text.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  if (teile.length === 0) return { fehler: t("ein.relayMindestens") };
  const relays: string[] = [];
  for (const [i, adresse] of teile.entries()) {
    const p = isPlausibleRelayUrl(adresse);
    if (!p.ok) return { fehler: t("ein.relayAdresse", { n: i + 1, grund: relayUrlGrund(p) }) };
    const u = normalizeRelayUrl(adresse);
    if (!taugtFuerSatz(u)) {
      return { fehler: t("ein.relayNurWss", { n: i + 1 }) };
    }
    if (!relays.includes(u)) relays.push(u);
  }
  if (relays.length > MAX_EIGENE) return { fehler: t("ein.relayHoechstens", { n: MAX_EIGENE }) };
  if (!relays.some(isUsableDmRelay)) return { fehler: t("ein.relayPosteingang") };
  return { relays };
}

/**
 * Den eigenen Satz ändern (5.4b2): NIP-65-Liste und Posteingang (Kind 10050)
 * neu veröffentlichen – weit, dort sucht sie jeder –, erst dann merken. Die
 * veröffentlichte Liste gilt für alle Geräte (5.4a). false, wenn eine Liste
 * nirgends ankam; dann bleibt der alte Satz.
 */
export async function setzeEigeneRelays(p: {
  relays: readonly string[];
  pk: string;
  signiere: (ev: UnsignedEvent) => Promise<NostrEvent>;
  weit: (ev: NostrEvent) => Promise<boolean>;
  speicher: Pick<Storage, "setItem">;
  /** Zeitstempel der neuen Listen (Sekunden) – eine ersetzbare Liste gilt nur, wenn sie neuer ist. */
  jetzt?: number;
}): Promise<boolean> {
  if (!(await p.weit(await p.signiere(buildRelayList(p.pk, p.relays.map((url) => ({ url })), p.jetzt))))) return false;
  if (!(await p.weit(await p.signiere(buildDmRelayList(p.pk, [...p.relays], p.jetzt))))) return false;
  p.speicher.setItem(LS_EIGENE_RELAYS, JSON.stringify(p.relays));
  return true;
}

