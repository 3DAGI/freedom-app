/**
 * OpenTimestamps-Kalender (Schritt 5.10b, B-17b1): stempeln und nachreichen.
 *
 * Kalender nach K5 A (06.10.2026): alice und bob (OpenTimestamps) und finney
 * (Eternity Wall) – zwei Betreiber; ein Stempel gilt erst mit mindestens zwei
 * Antworten. Gefragt wird nur, wer in `OTS_KALENDER` steht – auch wenn ein
 * Beweis eine andere Adresse nennt (a.pool sammelt nur für alice).
 *
 * Was ein Kalender sieht (K2 A): IP und Zeitpunkt, nie einen Wert – an jeden
 * Wert hängt `buendele()` eine Zufallszahl, hinaus geht nur die Spitze. Mit
 * Tor sieht er nur den Ausgang.
 *
 * Die Anfragen sind „einfach“ nach CORS (nur `Accept`, kein Content-Type):
 * Die Kalender erlauben jede Herkunft, beantworten aber keinen Preflight.
 * Antworten sind Fremddaten – begrenzt gelesen, Fehler nur als Kennung.
 */
import { bytesToHex } from "@noble/hashes/utils.js";
import { OtsFehler, attestierungenVon, buendele, fuegeEin, leseOtsZeitstempel, schreibeOtsZeitstempel, type OtsDatei, type OtsZeitstempel } from "./ots.js";

export const OTS_KALENDER: readonly string[] = [
  "https://alice.btc.calendar.opentimestamps.org",
  "https://bob.btc.calendar.opentimestamps.org",
  "https://finney.calendar.eternitywall.com",
];

export const OTS_KALENDER_GRENZEN = {
  /** So viele Antworten braucht ein Stempel (K5 A). */
  mindestens: 2,
  /** Größe einer Antwort (wie die Referenz). */
  antwortBytes: 10_000,
  /** Zeit je Anfrage. */
  zeitMs: 15_000,
  /** Nachfragen je Beweis und Durchgang. */
  nachfragen: 8,
} as const;

export type OtsHolen = (url: string, init: RequestInit) => Promise<Response>;
const holenStandard: OtsHolen = (url, init) => fetch(url, init);

interface KalenderOptionen {
  holen?: OtsHolen;
  kalender?: readonly string[];
}

const ohneSchraegstrich = (u: string) => u.replace(/\/$/, "");

/** Die Adresse aus `kalender`, die ein Beweis nennt – sonst keine. */
function bekannt(adresse: string, kalender: readonly string[]): string | undefined {
  return kalender.find((k) => ohneSchraegstrich(k) === ohneSchraegstrich(adresse));
}

async function leseHoechstens(r: Response, max: number): Promise<Uint8Array | undefined> {
  if (Number(r.headers.get("content-length") ?? 0) > max) return undefined;
  if (!r.body) return undefined;
  const leser = r.body.getReader();
  const stuecke: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await leser.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      void leser.cancel().catch(() => undefined);
      return undefined;
    }
    stuecke.push(value);
  }
  const alles = new Uint8Array(n);
  let i = 0;
  for (const s of stuecke) {
    alles.set(s, i);
    i += s.byteLength;
  }
  return alles;
}

/**
 * Eine Anfrage ohne Zugangsdaten, Weiterleitung und Verweis, mit Frist:
 * Status und (bei 200) höchstens `max` Bytes; `undefined`, wenn nichts
 * Brauchbares kam. Auch für die Explorer (`ots-bitcoin.ts`).
 */
export async function holeHoechstens(holen: OtsHolen, url: string, extra: RequestInit, max: number): Promise<{ status: number; bytes?: Uint8Array } | undefined> {
  try {
    const r = await holen(url, {
      ...extra,
      redirect: "error",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      signal: AbortSignal.timeout(OTS_KALENDER_GRENZEN.zeitMs),
    });
    if (r.redirected || r.type === "opaqueredirect") return undefined;
    if (r.status !== 200) {
      void r.body?.cancel().catch(() => undefined);
      return { status: r.status };
    }
    const bytes = await leseHoechstens(r, max);
    return bytes ? { status: 200, bytes } : undefined;
  } catch {
    return undefined;
  }
}

const frage = (holen: OtsHolen, url: string, extra: RequestInit) =>
  holeHoechstens(holen, url, { ...extra, headers: { Accept: "application/vnd.opentimestamps.v1" } }, OTS_KALENDER_GRENZEN.antwortBytes);

export interface OtsStempel {
  /** Je Wert ein Beweis, alle mit denselben Versprechen der Kalender. */
  dateien: OtsDatei[];
  /** Kalender, die geantwortet haben. */
  kalender: string[];
}

/**
 * Werte stempeln: bündeln, die Spitze an jeden Kalender, die Antworten
 * zusammenführen. Eine Antwort zählt nur, wenn sie das Versprechen genau
 * dieses Kalenders trägt; unter `mindestens` Antworten → `zu-wenige-kalender`.
 */
export async function stempele(
  digests: Uint8Array[],
  opt: KalenderOptionen & { nonce?: () => Uint8Array } = {},
): Promise<OtsStempel> {
  const holen = opt.holen ?? holenStandard;
  const kalender = opt.kalender ?? OTS_KALENDER;
  const { spitze, dateien } = buendele(digests, opt.nonce ?? (() => globalThis.crypto.getRandomValues(new Uint8Array(16))));
  const antworten = await Promise.all(kalender.map(async (k) => {
    const r = await frage(holen, `${ohneSchraegstrich(k)}/digest`, { method: "POST", body: Uint8Array.from(spitze.nachricht) });
    if (r?.status !== 200 || !r.bytes) return undefined;
    let z: OtsZeitstempel;
    try { z = leseOtsZeitstempel(r.bytes, spitze.nachricht); } catch { return undefined; }
    const versprochen = attestierungenVon(z).some(({ attestierung: a }) => a.art === "ausstehend" && bekannt(a.kalender, [k]) !== undefined);
    return versprochen ? { k, z } : undefined;
  }));
  const gut = antworten.filter((a): a is { k: string; z: OtsZeitstempel } => a !== undefined);
  if (gut.length < OTS_KALENDER_GRENZEN.mindestens) throw new OtsFehler("zu-wenige-kalender");
  for (const a of gut) fuegeEin(spitze, a.z);
  return { dateien, kalender: gut.map((a) => a.k) };
}

export interface OtsNachreichung {
  /** Etwas kam hinzu – den Beweis neu speichern. */
  neu: boolean;
  /** Bitcoin-Höhen, die der Beweis jetzt nennt (aufsteigend). */
  bitcoin: number[];
  /** Kalender, die noch warten (404). */
  wartend: string[];
}

/**
 * Ausstehende Versprechen nachfragen (GET /timestamp/<Wert>) und die
 * Antworten an ihrer Stelle einfügen – nur bei Kalendern aus der Liste,
 * höchstens `nachfragen` je Durchgang. Nennt der Beweis schon Bitcoin, wird
 * nicht gefragt. Ein 404 heißt „noch nicht“ (der Kalender wartet auf
 * Bestätigungen), keine Antwort heißt: beim nächsten Mal wieder.
 */
export async function reicheNach(z: OtsZeitstempel, opt: KalenderOptionen = {}): Promise<OtsNachreichung> {
  const holen = opt.holen ?? holenStandard;
  const kalender = opt.kalender ?? OTS_KALENDER;
  const hoehen = () => [...new Set(attestierungenVon(z).flatMap(({ attestierung: a }) => (a.art === "bitcoin" ? [a.hoehe] : [])))].sort((a, b) => a - b);
  if (hoehen().length > 0) return { neu: false, bitcoin: hoehen(), wartend: [] };
  const offen: { knoten: OtsZeitstempel; kalender: string }[] = [];
  const gesehen = new Set<OtsZeitstempel>();
  const geh = (k: OtsZeitstempel) => {
    if (gesehen.has(k)) return;
    gesehen.add(k);
    for (const a of k.attestierungen) {
      const name = a.art === "ausstehend" ? bekannt(a.kalender, kalender) : undefined;
      if (name && !offen.some((o) => o.knoten === k && o.kalender === name)) offen.push({ knoten: k, kalender: name });
    }
    for (const w of k.zweige) geh(w.weiter);
  };
  geh(z);
  const vorher = bytesToHex(schreibeOtsZeitstempel(z));
  const wartend: string[] = [];
  const antworten = await Promise.all(offen.slice(0, OTS_KALENDER_GRENZEN.nachfragen).map(async (o) => {
    const r = await frage(holen, `${ohneSchraegstrich(o.kalender)}/timestamp/${bytesToHex(o.knoten.nachricht)}`, { method: "GET" });
    if (r?.status === 404) wartend.push(o.kalender);
    if (r?.status !== 200 || !r.bytes) return undefined;
    try { return { knoten: o.knoten, z: leseOtsZeitstempel(r.bytes, o.knoten.nachricht) }; } catch { return undefined; }
  }));
  for (const a of antworten) if (a) fuegeEin(a.knoten, a.z);
  return { neu: bytesToHex(schreibeOtsZeitstempel(z)) !== vorher, bitcoin: hoehen(), wartend: [...new Set(wartend)].sort() };
}
