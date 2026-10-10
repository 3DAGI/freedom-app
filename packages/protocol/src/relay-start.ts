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
 * - **Outbox beim Lesen (5.4b):** Was Kontakte schreiben, liest die App dort,
 *   wo sie es laut ihrer NIP-65-Liste hinschreiben (`outboxPlan()`).
 */
import { verifyEvent, type NostrEvent } from "./event.js";
import { isUsableDmRelay, parseDmRelayList } from "./private-dm.js";
import { KIND_RELAY_LIST, isPlausibleRelayUrl, normalizeRelayUrl, parseRelayList } from "./relay-discovery.js";

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

/** So viele Schreib-Relays je Autor fragt die App, wenn es geht (NIP-65 empfiehlt wenige). */
export const OUTBOX_JE_AUTOR = 3;
/** So viele fremde Relays öffnet eine Abfrage höchstens – der Rest liest im Pool. */
export const OUTBOX_MAX_RELAYS = 8;

/**
 * Outbox beim Lesen (5.4b): an welchen Relays nach den Events welcher Autoren
 * fragen. Je Autor zählen die Schreib-Relays seiner neuesten gültigen
 * NIP-65-Liste. Autoren ohne Liste fehlen – für sie fragt der Aufrufer wie
 * bisher im Pool. Fremde Listen werden geprüft (Signatur, Autor): Sonst könnte
 * jeder die Leser eines Kontakts umleiten.
 *
 * Gewählt wird gierig (seit A-24, Vergleich `docs/OUTBOX-VERGLEICH.md`): erst
 * bekommt jeder Autor ein Relay, dann ein zweites, bis `jeAutor` – immer das
 * Relay, das die meisten Autoren dieser Stufe erreicht, höchstens `maxRelays`.
 * Relays des Pools (`imPool`) fragt der Pool: Sie zählen für ihre Autoren mit
 * und belegen keinen Platz. Ein gewähltes Relay fragt nach allen Autoren, die
 * dort schreiben. Fremde Relays nur über `wss://` (A-25; `ws://…onion` nur mit
 * `onion`), keine aus `aussetzen` (A-26, gerade nicht erreichbar).
 */
export function outboxPlan(
  listen: readonly NostrEvent[], autoren: readonly string[],
  p: { jeAutor?: number; maxRelays?: number; imPool?: readonly string[]; onion?: boolean; aussetzen?: Iterable<string> } = {},
): Map<string, string[]> {
  const gesucht = new Set(autoren);
  const neueste = new Map<string, NostrEvent>();
  for (const ev of listen) {
    if (ev.kind !== KIND_RELAY_LIST || !gesucht.has(ev.pubkey)) continue;
    const alt = neueste.get(ev.pubkey);
    if (alt && alt.created_at >= ev.created_at) continue;
    if (verifyEvent(ev)) neueste.set(ev.pubkey, ev);
  }
  const ziel = p.jeAutor ?? OUTBOX_JE_AUTOR;
  const max = p.maxRelays ?? OUTBOX_MAX_RELAYS;
  const pool = new Set((p.imPool ?? []).map(normalizeRelayUrl));
  const aus = new Set([...(p.aussetzen ?? [])].map(normalizeRelayUrl));
  const erlaubt = (url: string) => !aus.has(url) && (url.startsWith("wss://") || (p.onion === true && /^ws:\/\/[^/:]+\.onion(?:[:/]|$)/.test(url)));
  /** Wie viele Relays je Autor schon gefragt werden (Pool und Plan). */
  const hat = new Map<string, number>();
  const kandidaten = new Map<string, string[]>();
  for (const [autor, liste] of neueste) {
    let imPool = 0;
    for (const url of schreibRelays(liste)) {
      if (pool.has(url)) imPool++;
      else if (erlaubt(url)) kandidaten.set(url, [...(kandidaten.get(url) ?? []), autor]);
    }
    hat.set(autor, imPool);
  }
  const plan = new Map<string, string[]>();
  for (let stufe = 1; stufe <= ziel; stufe++) {
    while (plan.size < max) {
      let bestes: string | undefined;
      let zahl = 0;
      for (const [url, as] of kandidaten) {
        if (plan.has(url)) continue;
        const n = as.filter((a) => (hat.get(a) ?? 0) < stufe).length;
        const b = bestes === undefined ? undefined : kandidaten.get(bestes)!;
        // Mehr Autoren dieser Stufe, dann mehr Autoren überhaupt, dann die Adresse – ohne Zufall
        if (n > zahl || (n === zahl && n > 0 && b !== undefined && (as.length > b.length || (as.length === b.length && url < bestes!)))) {
          bestes = url;
          zahl = n;
        }
      }
      if (bestes === undefined) break;
      const as = kandidaten.get(bestes)!;
      plan.set(bestes, as);
      for (const a of as) hat.set(a, (hat.get(a) ?? 0) + 1);
    }
  }
  return plan;
}
