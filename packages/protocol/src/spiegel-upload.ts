/**
 * Spiegel hochladen (Schritt 5.3b): die Teile, die sich ohne Konto prüfen lassen.
 *
 * - Torrent (BEP 3) mit der ausliefernden Seite als Webseed (BEP 19) – laden
 *   geht so auch ohne Seeder; der Magnet-Link nennt die .torrent-Datei (`xs`),
 *   weil ein Webseed allein keine Metadaten liefert.
 * - IPFS-Adresse (CID) wie `ipfs add --cid-version=1`: Stücke zu 256 KiB als
 *   rohe Blätter, darüber UnixFS-Knoten (dag-pb) mit höchstens 174 Verweisen.
 *   Wer den CID nachrechnet, braucht dem Pinning-Dienst nicht zu glauben.
 * - Blossom (BUD-02, seit 5.3c): Anmeldung als Kind 24242 nur für diesen
 *   Upload (`x` = Prüfsumme, zehn Minuten); übernommen wird nur eine
 *   Beschreibung mit derselben Prüfsumme.
 * - Das Ergebnis eines Laufs (`spiegel-ergebnis.json`) gilt nur für die Datei
 *   mit derselben Prüfsumme; Quellen nur in der Form aus `leseQuellen()`.
 *
 * Hochgeladen wird in `scripts/mirror/spiegeln.mts` (CI, `pages.yml`).
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { sha1 } from "@noble/hashes/legacy.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { base32nopad, base64 } from "@scure/base";
import type { NostrEvent, UnsignedEvent } from "./event.js";
import { leseQuellen, type Quelle, type QuellenArt } from "./spiegel.js";

const utf8 = new TextEncoder();

function verbinde(teile: Uint8Array[]): Uint8Array {
  const aus = new Uint8Array(teile.reduce((n, t) => n + t.length, 0));
  let i = 0;
  for (const t of teile) { aus.set(t, i); i += t.length; }
  return aus;
}

// ── Torrent ──────────────────────────────────────────────────────────────

const TORRENT_STUECK = 262_144;

/** Reihenfolge nach UTF-8-Bytes (BEP 3) – ohne Buffer, der Baustein läuft auch im Browser. */
function nachBytes(a: string, b: string): number {
  const x = utf8.encode(a), y = utf8.encode(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}

type BWert = number | string | Uint8Array | BWert[] | { [k: string]: BWert };

/** Bencode (BEP 3) – Schlüssel nach Bytes sortiert, Zahlen nur ganz. */
function bencode(v: BWert): Uint8Array {
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new Error("bencode: nur ganze Zahlen");
    return utf8.encode(`i${v}e`);
  }
  if (typeof v === "string") v = utf8.encode(v);
  if (v instanceof Uint8Array) return verbinde([utf8.encode(`${v.length}:`), v]);
  if (Array.isArray(v)) return verbinde([utf8.encode("l"), ...v.map(bencode), utf8.encode("e")]);
  const schluessel = Object.keys(v).sort(nachBytes);
  return verbinde([utf8.encode("d"), ...schluessel.flatMap((k) => [bencode(k), bencode((v as Record<string, BWert>)[k])]), utf8.encode("e")]);
}

/**
 * .torrent für eine einzelne Datei, `url-list` = Webseeds (nur https, BEP 19:
 * die URL zeigt direkt auf die Datei). Ohne Zeitstempel und Programmnamen –
 * jeder, der dieselbe Datei und Adresse nimmt, bekommt dieselbe Datei.
 */
export function baueTorrent(datei: Uint8Array, name: string, webseeds: string[]): { torrent: Uint8Array; infohash: string; magnet: string } {
  if (datei.length === 0) throw new Error("torrent: leere Datei");
  if (!/^[\w.-]+$/.test(name)) throw new Error("torrent: ungültiger Dateiname");
  for (const w of webseeds) if (!/^https:\/\/[^\s"<>]+$/.test(w)) throw new Error("torrent: Webseed nur über https");
  const stuecke: Uint8Array[] = [];
  for (let i = 0; i < datei.length; i += TORRENT_STUECK) stuecke.push(sha1(datei.subarray(i, i + TORRENT_STUECK)));
  const info = { length: datei.length, name, "piece length": TORRENT_STUECK, pieces: verbinde(stuecke) };
  const infohash = bytesToHex(sha1(bencode(info)));
  const torrent = bencode({ info, ...(webseeds.length ? { "url-list": webseeds } : {}) });
  const ws = webseeds.map((w) => `&ws=${encodeURIComponent(w)}`).join("");
  const xs = webseeds.length ? `&xs=${encodeURIComponent(webseeds[0].replace(/[^/]*$/, `${name.replace(/\.[^.]*$/, "")}.torrent`))}` : "";
  return { torrent, infohash, magnet: `magnet:?xt=urn:btih:${infohash}&dn=${encodeURIComponent(name)}&xl=${datei.length}${ws}${xs}` };
}

// ── IPFS ─────────────────────────────────────────────────────────────────

const IPFS_STUECK = 262_144;
const IPFS_MAX_VERWEISE = 174;
const RAW = 0x55;
const DAG_PB = 0x70;

function varint(n: number): Uint8Array {
  const aus: number[] = [];
  while (n >= 0x80) { aus.push((n % 0x80) | 0x80); n = Math.floor(n / 0x80); }
  aus.push(n);
  return Uint8Array.from(aus);
}
const feld = (nr: number, inhalt: Uint8Array) => verbinde([varint((nr << 3) | 2), varint(inhalt.length), inhalt]);
const zahlFeld = (nr: number, n: number) => verbinde([varint(nr << 3), varint(n)]);
const cidBytes = (codec: number, block: Uint8Array) => verbinde([varint(1), varint(codec), Uint8Array.of(0x12, 0x20), sha256(block)]);

interface Knoten { cid: Uint8Array; groesse: number; tsize: number }

/** UnixFS-Dateiknoten: Verweise zuerst (dag-pb), dann Daten (Typ Datei, Größe, Blockgrößen). */
function dateiKnoten(kinder: Knoten[]): Knoten {
  const daten = verbinde([zahlFeld(1, 2), zahlFeld(3, kinder.reduce((n, k) => n + k.groesse, 0)), ...kinder.map((k) => zahlFeld(4, k.groesse))]);
  const block = verbinde([...kinder.map((k) => feld(2, verbinde([feld(1, k.cid), feld(2, new Uint8Array()), zahlFeld(3, k.tsize)]))), feld(1, daten)]);
  return { cid: cidBytes(DAG_PB, block), groesse: kinder.reduce((n, k) => n + k.groesse, 0), tsize: block.length + kinder.reduce((n, k) => n + k.tsize, 0) };
}

/**
 * CIDv1 (base32) wie `ipfs add --cid-version=1` (rohe Blätter, 256 KiB,
 * ausgeglichener Baum mit höchstens 174 Verweisen je Knoten). Eine Datei bis
 * zu einem Stück ist ihr eigenes Blatt.
 */
export function ipfsCid(datei: Uint8Array, opt: { stueck?: number; maxVerweise?: number } = {}): string {
  const stueck = opt.stueck ?? IPFS_STUECK;
  const max = opt.maxVerweise ?? IPFS_MAX_VERWEISE;
  let ebene: Knoten[] = [];
  for (let i = 0; i === 0 || i < datei.length; i += stueck) {
    const blatt = datei.subarray(i, i + stueck);
    ebene.push({ cid: cidBytes(RAW, blatt), groesse: blatt.length, tsize: blatt.length });
  }
  if (ebene.length === 1) return "b" + base32nopad.encode(ebene[0].cid).toLowerCase();
  do {
    const naechste: Knoten[] = [];
    for (let i = 0; i < ebene.length; i += max) naechste.push(dateiKnoten(ebene.slice(i, i + max)));
    ebene = naechste;
  } while (ebene.length > 1);
  return "b" + base32nopad.encode(ebene[0].cid).toLowerCase();
}

// ── Blossom ──────────────────────────────────────────────────────────────

/** Anmeldung für genau einen Upload (BUD-02): Kind 24242, `x` = Prüfsumme, zehn Minuten gültig. */
export function blossomAuth(sha: string, pubkey: string, jetzt: number): UnsignedEvent {
  if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error("blossom: Prüfsumme als Hex");
  return { pubkey, created_at: jetzt, kind: 24242, content: "freedom.html spiegeln", tags: [["t", "upload"], ["x", sha], ["expiration", String(jetzt + 600)]] };
}

/** Kopfzeile `Authorization` (BUD-01). */
export const blossomKopf = (ev: NostrEvent): string => `Nostr ${base64.encode(utf8.encode(JSON.stringify(ev)))}`;

/** Blob-Beschreibung des Servers: nur mit derselben Prüfsumme und einer Adresse in Quellen-Form. */
export function blossomQuelle(roh: unknown, sha: string): Quelle | null {
  const d = roh as { sha256?: unknown; url?: unknown } | null;
  if (!d || d.sha256 !== sha || typeof d.url !== "string" || !d.url.includes(sha)) return null;
  return leseQuellen({ quellen: [{ art: "blossom", url: d.url }] }).gesetzt[0] ?? null;
}

// ── Ergebnis eines Laufs ─────────────────────────────────────────────────

export interface SpiegelErgebnis {
  version: 1;
  /** Prüfsumme von freedom.html, für die die Quellen gelten. */
  sha256: string;
  quellen: Quelle[];
  /** Was nicht lief – ehrlich mit Grund (fehlendes Konto, Fehler). */
  uebersprungen: { art: QuellenArt; grund: string }[];
}

/**
 * Quellen aus einem Ergebnis, nur für die Datei mit dieser Prüfsumme und nur
 * in gültiger Form (`leseQuellen()`) – für das Release-Manifest.
 */
export function quellenAusErgebnis(roh: unknown, sha: string): Quelle[] {
  const e = roh as Partial<SpiegelErgebnis> | null;
  if (!e || e.version !== 1 || typeof e.sha256 !== "string" || e.sha256.toLowerCase() !== sha.toLowerCase()) return [];
  return leseQuellen({ quellen: e.quellen }).gesetzt;
}
