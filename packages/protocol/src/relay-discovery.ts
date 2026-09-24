/**
 * Relay-Entdeckung: das Netz trägt sich selbst, statt geliehen zu sein.
 *
 * DAS PROBLEM, DAS DAS LÖST
 * Der Client hatte vier fest verdrahtete Relays — `relay.damus.io`, `nos.lol`,
 * `relay.nostr.band`, `nostr.mom`. Alle vier gehören Fremden, die dem Projekt
 * nichts schulden. Filtern sie die Job-Kinds (5050, 6050, 38010), ist das Netz
 * nicht beschädigt, sondern tot.
 *
 * Der Provider-Daemon KONNTE zwar einen eigenen Relay betreiben
 * (`RELAY_ENABLED=1`), kündigte ihn aber nirgends an — kein Client hätte ihn je
 * benutzt. Damit war die Zensurresistenz des Systems an vier fremde
 * Serverbetreiber delegiert.
 *
 * WIE ES JETZT LÄUFT
 * Provider kündigen ihren Relay in einem signierten Event an (NIP-65-ähnlich,
 * kind 10002). Clients starten mit den bekannten Relays, entdecken darüber die
 * Relays des Netzes und behalten die, die tatsächlich antworten. Die fest
 * verdrahtete Liste ist damit ein STARTPUNKT, kein Fundament.
 *
 * WARUM ENTDECKTE RELAYS GEPRÜFT WERDEN
 * Jeder kann eine beliebige URL ankündigen. Ein bösartiger Betreiber könnte
 * tausende tote Adressen streuen, um den Pool zu verstopfen, oder eine Adresse
 * im lokalen Netz des Opfers nennen. Deshalb wird jede entdeckte Adresse auf
 * Form und Erreichbarkeit geprüft, die Anzahl begrenzt, und bevorzugt, wer
 * bereits durch Arbeit aufgefallen ist.
 */
import { NostrEvent, UnsignedEvent, buildEvent } from "./event.js";
import { Relay } from "./outbox.js";

/** Relay-Liste eines Teilnehmers (NIP-65). */
export const KIND_RELAY_LIST = 10002;

export interface RelayAnnouncement {
  pubkey: string;
  /** URLs, auf denen dieser Teilnehmer erreichbar ist. */
  relays: { url: string; read: boolean; write: boolean }[];
  createdAt: number;
}

/**
 * Kündigt die eigenen Relays an.
 *
 * Ein Provider, der selbst einen Relay betreibt, macht ihn damit auffindbar —
 * das ist der Unterschied zwischen „das Netz könnte sich selbst tragen" und
 * „das Netz trägt sich selbst".
 */
export function buildRelayList(
  pubkey: string,
  relays: { url: string; read?: boolean; write?: boolean }[],
  createdAt?: number,
): UnsignedEvent {
  const tags = relays.map((r) => {
    const marker = r.read === false ? "write" : r.write === false ? "read" : "";
    return marker ? ["r", r.url, marker] : ["r", r.url];
  });
  return buildEvent(pubkey, KIND_RELAY_LIST, tags, "", createdAt);
}

export function parseRelayList(ev: NostrEvent): RelayAnnouncement {
  if (ev.kind !== KIND_RELAY_LIST) throw new Error(`keine Relay-Liste: kind ${ev.kind}`);
  const relays = ev.tags
    .filter((t) => t[0] === "r" && typeof t[1] === "string")
    .map((t) => ({
      url: t[1],
      read: t[2] !== "write",
      write: t[2] !== "read",
    }));
  return { pubkey: ev.pubkey, relays, createdAt: ev.created_at };
}

/**
 * Prüft eine angekündigte Relay-Adresse.
 *
 * Bewusst streng: Eine Liste, in die jeder alles schreiben kann, ist ein
 * Einfallstor. Adressen im privaten Netz sind der interessanteste Angriff —
 * ein Client, der `ws://192.168.1.1` in seinen Pool nimmt, klopft am Router
 * seines eigenen Nutzers an.
 */
export function isPlausibleRelayUrl(raw: string): { ok: boolean; reason: string } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "keine gültige URL" };
  }
  if (u.protocol !== "wss:" && u.protocol !== "ws:") {
    return { ok: false, reason: `Schema ${u.protocol} ist kein Relay-Schema` };
  }
  if (u.username || u.password) {
    return { ok: false, reason: "URLs mit Zugangsdaten sind nicht erlaubt" };
  }

  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return { ok: false, reason: "zeigt auf das lokale System" };
  }
  // IP-Literale in privaten Bereichen: derselbe Angriff wie bei SSRF.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const p = host.split(".").map(Number);
    const [a, b] = p;
    const privat =
      a === 10 || a === 127 || a === 0 || a >= 224 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127);
    if (privat) return { ok: false, reason: `${host} liegt in einem privaten Bereich` };
  }
  if (host.includes(":") || host === "::1") {
    return { ok: false, reason: "IPv6-Literale werden nicht angenommen" };
  }
  if (raw.length > 200) return { ok: false, reason: "URL unplausibel lang" };
  return { ok: true, reason: "plausibel" };
}

/** Vereinheitlicht URLs, damit dieselbe Adresse nicht doppelt im Pool landet. */
export function normalizeRelayUrl(raw: string): string {
  try {
    const u = new URL(raw);
    // Abschließender Schrägstrich und Standard-Ports sind bedeutungslos.
    const port =
      (u.protocol === "wss:" && u.port === "443") || (u.protocol === "ws:" && u.port === "80")
        ? ""
        : u.port;
    return `${u.protocol}//${u.hostname.toLowerCase()}${port ? ":" + port : ""}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return raw;
  }
}

export interface DiscoveryOptions {
  /** Wie viele entdeckte Relays höchstens übernommen werden. */
  maxDiscovered?: number;
  /** Pubkeys, die durch Arbeit aufgefallen sind — deren Relays zuerst. */
  trustedPubkeys?: Set<string>;
  /** Bereits bekannte Adressen, die nicht erneut vorgeschlagen werden. */
  known?: Iterable<string>;
}

export interface DiscoveredRelay {
  url: string;
  /** Wie viele Teilnehmer diese Adresse angekündigt haben. */
  announcedBy: number;
  /** Davon Teilnehmer mit nachgewiesener Arbeit. */
  announcedByTrusted: number;
  score: number;
}

/**
 * Wertet Relay-Ankündigungen aus.
 *
 * Sortiert nach Verbreitung und Vertrauen, nicht nach Reihenfolge: Eine
 * Adresse, die zwanzig arbeitende Provider nennen, ist wahrscheinlich echt.
 * Eine, die ein einzelner unbekannter Schlüssel nennt, ist es vielleicht nicht.
 */
export function discoverRelays(
  events: NostrEvent[],
  opts: DiscoveryOptions = {},
): { relays: DiscoveredRelay[]; rejected: { url: string; reason: string }[] } {
  const max = opts.maxDiscovered ?? 12;
  const trusted = opts.trustedPubkeys ?? new Set<string>();
  const bekannt = new Set([...(opts.known ?? [])].map(normalizeRelayUrl));

  const byUrl = new Map<string, { pubkeys: Set<string>; trusted: Set<string> }>();
  const rejected: { url: string; reason: string }[] = [];
  const abgelehnt = new Set<string>();

  for (const ev of events) {
    let ann: RelayAnnouncement;
    try {
      ann = parseRelayList(ev);
    } catch {
      continue;
    }
    for (const r of ann.relays) {
      if (!r.write) continue; // nur Adressen, auf die man schreiben kann
      const url = normalizeRelayUrl(r.url);
      if (bekannt.has(url)) continue;

      const check = isPlausibleRelayUrl(url);
      if (!check.ok) {
        if (!abgelehnt.has(url)) {
          abgelehnt.add(url);
          rejected.push({ url, reason: check.reason });
        }
        continue;
      }
      const e = byUrl.get(url) ?? { pubkeys: new Set<string>(), trusted: new Set<string>() };
      e.pubkeys.add(ann.pubkey);
      if (trusted.has(ann.pubkey)) e.trusted.add(ann.pubkey);
      byUrl.set(url, e);
    }
  }

  const relays: DiscoveredRelay[] = [...byUrl.entries()]
    .map(([url, e]) => ({
      url,
      announcedBy: e.pubkeys.size,
      announcedByTrusted: e.trusted.size,
      // Vertrauen wiegt schwerer als bloße Anzahl: Anzahl lässt sich mit
      // Wegwerf-Schlüsseln erzeugen, nachgewiesene Arbeit nicht.
      score: e.trusted.size * 10 + e.pubkeys.size,
    }))
    .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url))
    .slice(0, max);

  return { relays, rejected };
}

export interface HealthResult {
  url: string;
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

/**
 * Prüft, ob ein Relay tatsächlich antwortet.
 *
 * Eine angekündigte Adresse ist eine Behauptung. In den Pool kommt nur, was
 * eine Abfrage beantwortet — sonst verstopfen tote Adressen jeden Publish mit
 * Zeitüberschreitungen.
 */
export async function checkRelayHealth(
  relay: Relay,
  timeoutMs = 6000,
): Promise<HealthResult> {
  const start = Date.now();
  try {
    await Promise.race([
      relay.query({ kinds: [1], limit: 1 }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("Zeitüberschreitung")), timeoutMs)),
    ]);
    return { url: relay.url, ok: true, latencyMs: Date.now() - start };
  } catch (e) {
    return { url: relay.url, ok: false, error: (e as Error).message };
  }
}

/**
 * Baut die endgültige Relay-Liste: bekannte Startpunkte plus geprüfte Funde.
 *
 * Die Startliste wird NIE ganz verworfen, auch wenn entdeckte Relays besser
 * aussehen. Sonst könnte ein Angreifer, der genug Ankündigungen streut, einen
 * Client vollständig auf eigene Server umlenken und ihm eine erfundene Sicht
 * des Netzes zeigen.
 */
export async function buildRelaySet(args: {
  seedUrls: string[];
  discovered: DiscoveredRelay[];
  makeRelay: (url: string) => Relay;
  maxTotal?: number;
  checkHealth?: boolean;
}): Promise<{ urls: string[]; healthy: HealthResult[]; skipped: HealthResult[] }> {
  const maxTotal = args.maxTotal ?? 8;
  const seeds = args.seedUrls.map(normalizeRelayUrl);
  const healthy: HealthResult[] = [];
  const skipped: HealthResult[] = [];

  const kandidaten = args.discovered
    .map((d) => d.url)
    .filter((u) => !seeds.includes(u))
    .slice(0, maxTotal);

  if (args.checkHealth !== false) {
    const ergebnisse = await Promise.all(
      kandidaten.map((u) => checkRelayHealth(args.makeRelay(u))),
    );
    for (const r of ergebnisse) (r.ok ? healthy : skipped).push(r);
  } else {
    for (const u of kandidaten) healthy.push({ url: u, ok: true });
  }

  const geprueft = healthy
    .sort((a, b) => (a.latencyMs ?? 0) - (b.latencyMs ?? 0))
    .map((h) => h.url);

  // Startpunkte bleiben immer drin.
  const urls = [...seeds, ...geprueft].slice(0, Math.max(seeds.length, maxTotal));
  return { urls, healthy, skipped };
}


// ------------------------------------------------------------- Tor

/**
 * Zwiebeladressen: der groesste verbleibende Metadatenabfluss.
 *
 * Jedes Relay sieht die IP-Adresse jedes Clients. Fuer die Zielgruppe ist das
 * die Information, die uebrig bleibt, nachdem Inhalt und Absender verborgen
 * sind — und sie reicht oft aus.
 *
 * Vollstaendiges Zwiebelrouting ueber mehrere Relay-Spruenge ist ein eigenes
 * Forschungsthema. Was heute geht und viel bringt: Relays mit
 * `.onion`-Adressen bevorzugen, wenn der Nutzer Tor benutzt. Das kostet
 * nichts ausser einer Erkennung.
 */
export function isOnion(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return /\.onion$/i.test(host);
  } catch {
    return false;
  }
}

export interface TorPreference {
  /** Nur Zwiebeladressen benutzen. */
  onionOnly: boolean;
  /** Zwiebeladressen bevorzugen, aber andere zulassen. */
  preferOnion: boolean;
}

export interface TorSortResult {
  relays: string[];
  onionCount: number;
  message: string;
}

/**
 * Relays nach Tor-Vorliebe ordnen.
 *
 * `onionOnly` ist die strenge Einstellung und kann dazu fuehren, dass gar
 * keine Relays uebrig bleiben. Das wird gesagt statt stillschweigend
 * hingenommen — ein Client ohne Relays sieht fuer den Nutzer aus wie ein
 * kaputtes Programm.
 */
export function sortByTorPreference(
  relays: string[],
  pref: TorPreference,
): TorSortResult {
  const onion = relays.filter(isOnion);
  const klar = relays.filter((r) => !isOnion(r));

  if (pref.onionOnly) {
    return {
      relays: onion,
      onionCount: onion.length,
      message: onion.length === 0
        ? "Keine Zwiebeladressen bekannt. Mit dieser Einstellung gibt es keine Verbindung — " +
          "entweder eine .onion-Adresse eintragen oder die Einstellung lockern."
        : `${onion.length} Zwiebeladresse(n). Deine IP bleibt den Relays verborgen.`,
    };
  }

  if (pref.preferOnion) {
    return {
      relays: [...onion, ...klar],
      onionCount: onion.length,
      message: onion.length > 0
        ? `${onion.length} Zwiebeladresse(n) zuerst, ${klar.length} weitere als Rueckfall.`
        : "Keine Zwiebeladressen bekannt — es wird ueber die normalen Relays verbunden, " +
          "die deine IP sehen.",
    };
  }

  return {
    relays,
    onionCount: onion.length,
    message: `${relays.length} Relays, davon ${onion.length} ueber Tor erreichbar.`,
  };
}

export function torInfo(): string {
  return [
    "Ohne Tor sieht jedes Relay deine IP-Adresse.",
    "",
    "Das ist der groesste verbleibende Abfluss: Inhalt und Absender sind",
    "verborgen, der Ort nicht. Fuer viele reicht das; fuer manche nicht.",
    "",
    "Mit Tor und .onion-Relays bleibt auch der Ort verborgen — dafuer wird",
    "die Verbindung deutlich langsamer.",
    "",
    "Was das NICHT loest: Wer alle Relays gleichzeitig beobachtet, kann ueber",
    "Zeitmuster Vermutungen anstellen. Dagegen hilft nur ein Mixnetz.",
  ].join("\n");
}
