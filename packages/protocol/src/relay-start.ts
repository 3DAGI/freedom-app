/**
 * Startliste und eigener Relay-Satz (Schritt 5.4).
 *
 * Bis 5.4 hing die App an drei fest verdrahteten Relays – fiel einer aus
 * (relay.nostr.band war beim Bau dieses Schritts nicht erreichbar), fehlte ein
 * Drittel. Jetzt:
 *
 * - **Startliste:** mindestens acht Relays verschiedener Betreiber, geprueft
 *   per NIP-11 (26.09.2026). .onion-Adressen kommen nur geprueft dazu – bis
 *   dahin keine (ehrlich statt geraten).
 * - **Eigener Satz:** Jeder Nutzer bekommt beim ersten Start ein paar Relays
 *   aus der Startliste, zufaellig – so verteilt sich die Last auf die
 *   Betreiber, und keiner sieht alle. Diesen Satz veroeffentlicht die App als
 *   NIP-65-Liste (Kind 10002) und als Posteingang (Kind 10050); er bleibt
 *   stabil, sonst faenden Kontakte den Posteingang nicht mehr.
 * - **Rotierend:** Dazu kommen je Sitzung weitere Relays der Startliste in
 *   wechselnder Auswahl – fuer das Finden der Listen anderer und als Reserve.
 */
import type { NostrEvent } from "./event.js";
import { isUsableDmRelay, parseDmRelayList } from "./private-dm.js";
import { isPlausibleRelayUrl, normalizeRelayUrl, parseRelayList } from "./relay-discovery.js";

export interface StartRelay {
  url: string;
  /** Wer ihn betreibt – verschiedene Betreiber, sonst hilft Vielfalt nichts. */
  betreiber: string;
}

/** Geprueft per NIP-11 am 26.09.2026: erreichbar, dauerhafte Speicherung, verschiedene Betreiber. */
export const STARTRELAYS: readonly StartRelay[] = [
  { url: "wss://relay.damus.io", betreiber: "Damus" },
  { url: "wss://nos.lol", betreiber: "nos.lol" },
  { url: "wss://relay.primal.net", betreiber: "Primal" },
  { url: "wss://nostr.mom", betreiber: "nostr.mom" },
  { url: "wss://nostr.oxtr.dev", betreiber: "0xtr" },
  { url: "wss://offchain.pub", betreiber: "offchain.pub" },
  { url: "wss://nostr-pub.wellorder.net", betreiber: "Wellorder" },
  { url: "wss://nostr.bitcoiner.social", betreiber: "bitcoiner.social" },
];

/** So viele Relays bekommt ein neuer Nutzer als festen Satz. */
export const EIGENE_ANZAHL = 4;
/**
 * So viele weitere Relays kommen je Sitzung dazu (wechselnd). Mit acht
 * Startrelays sind es sieben je Sitzung: Zwei Nutzer teilen so immer
 * mindestens sechs, auch ohne die Listen des anderen zu lesen.
 */
export const ROTIERENDE_ANZAHL = 3;

function mische<T>(liste: readonly T[], zufall: () => number): T[] {
  const a = [...liste];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(zufall() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Der feste Relay-Satz eines Nutzers. Neu: `EIGENE_ANZAHL` zufaellige aus der
 * Startliste. Wer schon Relays benutzt hat (`bisher`, etwa seine alte
 * Posteingangs-Liste), behaelt die noch plausiblen – Kontakte schicken
 * dorthin – und bekommt zwei neue dazu.
 */
export function waehleEigeneRelays(p: { bisher?: readonly string[]; start?: readonly StartRelay[]; zufall?: () => number } = {}): string[] {
  const start = (p.start ?? STARTRELAYS).map((s) => normalizeRelayUrl(s.url));
  const zufall = p.zufall ?? Math.random;
  const bisher = [...new Set((p.bisher ?? []).map(normalizeRelayUrl).filter((u) => isPlausibleRelayUrl(u).ok))];
  const neu = mische(start.filter((u) => !bisher.includes(u)), zufall);
  return bisher.length ? [...bisher, ...neu.slice(0, 2)] : neu.slice(0, EIGENE_ANZAHL);
}

/** Relays dieser Sitzung: der eigene Satz vorn, dann wechselnd weitere aus der Startliste. */
export function sitzungsRelays(p: { eigene: readonly string[]; start?: readonly StartRelay[]; zufall?: () => number; anzahl?: number }): string[] {
  const eigene = p.eigene.map(normalizeRelayUrl);
  const rest = (p.start ?? STARTRELAYS).map((s) => normalizeRelayUrl(s.url)).filter((u) => !eigene.includes(u));
  return [...new Set([...eigene, ...mische(rest, p.zufall ?? Math.random).slice(0, p.anzahl ?? ROTIERENDE_ANZAHL)])];
}

/** Alle Adressen der Startliste. */
export function startUrls(start: readonly StartRelay[] = STARTRELAYS): string[] {
  return start.map((s) => s.url);
}

/** Muss die eigene Liste neu veroeffentlicht werden? (andere Menge als zuletzt) */
export function listeVeraltet(veroeffentlicht: readonly string[] | undefined, eigene: readonly string[]): boolean {
  if (!veroeffentlicht) return true;
  const a = new Set(veroeffentlicht.map(normalizeRelayUrl));
  const b = new Set(eigene.map(normalizeRelayUrl));
  return a.size !== b.size || [...b].some((u) => !a.has(u));
}

/** Schreib-Relays aus einer NIP-65-Liste – nur plausible, ohne Doppelte. */
export function schreibRelays(liste: NostrEvent | undefined): string[] {
  if (!liste) return [];
  try {
    const urls = parseRelayList(liste).relays.filter((r) => r.write).map((r) => normalizeRelayUrl(r.url));
    return [...new Set(urls.filter((u) => isPlausibleRelayUrl(u).ok))].slice(0, 8);
  } catch {
    return [];
  }
}

export interface RelaySatz {
  /** Der feste Satz: wohin man schreibt und wo der Posteingang liegt. */
  eigene: string[];
  /** Eigene NIP-65-Liste (Kind 10002) fehlt – veroeffentlichen. */
  liste: boolean;
  /** Posteingang (Kind 10050) fehlt oder weicht ab – veroeffentlichen. */
  posteingang: boolean;
}

/**
 * Den eigenen Satz aus den zuletzt veroeffentlichten Listen bestimmen. Die
 * NIP-65-Liste gilt – so behalten alle Geraete derselben Identitaet denselben
 * Satz, statt ihn sich gegenseitig zu ueberschreiben. Ohne sie bleibt ein
 * alter Posteingang (Kind 10050) erhalten, sonst ein neuer, zufaelliger Satz.
 */
export function eigenerRelaySatz(p: { liste?: NostrEvent; posteingang?: NostrEvent; start?: readonly StartRelay[]; zufall?: () => number }): RelaySatz {
  const ausListe = schreibRelays(p.liste);
  const alterPosteingang = parseDmRelayList(p.posteingang);
  const eigene = ausListe.length ? ausListe : waehleEigeneRelays({ bisher: alterPosteingang, start: p.start, zufall: p.zufall });
  const posteingangSoll = [...new Set(eigene.filter(isUsableDmRelay))].slice(0, 5);
  return {
    eigene,
    liste: ausListe.length === 0,
    posteingang: posteingangSoll.length > 0 && listeVeraltet(alterPosteingang.length ? alterPosteingang : undefined, posteingangSoll),
  };
}
