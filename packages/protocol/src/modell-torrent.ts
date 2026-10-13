/**
 * Modelle über BitTorrent im eigenen Netz (Schritt B-29c2a, entschieden vom
 * MENSCHEN am 12.10.2026: aria2c, Pirate Face integrieren, alles mit dem
 * dezentralen Freedom-Dateisystem verbinden – `docs/E9-ENTWURF.md`).
 *
 * Beschreibung und Vertrauen bleiben bei Nostr: das Manifest (38057) nennt
 * jede Datei mit SHA-256, „ich halte vor“ (38058) nennt jetzt auch den
 * Magnet-Link, unter dem ein Knoten die Dateien teilt, und die Inhalts-Kennung
 * (`inhaltsKennung()`), zu der er sie geprüft hat. Die Bytes reisen über
 * BitTorrent – zwischen Freedom-Knoten und mit Pirate Face, wenn es derselbe
 * Magnet ist. Woher sie kommen, ist gleich: geprüft wird immer gegen die
 * SHA-256 im Manifest (BitTorrent v1 prüft nur SHA-1-Stücke).
 *
 * Ein Magnet-Link ist Fremdtext: `leseMagnet()` nimmt nur die Kennung des
 * Torrents (`btih`), Tracker (udp, http, https, wss) und Web-Seeds (nur
 * https) – keine lokalen oder privaten Hosts, nichts anderes (`xs`, `as`
 * ließen den Client beliebige Adressen holen).
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { isPrivateAddress } from "./adressbereich.js";
import { type NostrEvent, verifyEvent } from "./event.js";
import { KIND_MODEL_SEED, type ModelManifest, parseModelSeed } from "./model-registry.js";

export const MAGNET_GRENZEN = { laenge: 4096, tracker: 10, webSeeds: 5, adresse: 300 };

export interface Magnet {
  /** Kennung des Torrents (BitTorrent v1), 40 Zeichen Hex, klein. */
  infohash: string;
  tracker: string[];
  webSeeds: string[];
  /** Neu gebaut aus den geprüften Teilen – nur so geht er an aria2. */
  link: string;
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32ZuHex(s: string): string | null {
  let bits = "";
  for (const c of s.toUpperCase()) {
    const i = BASE32.indexOf(c);
    if (i < 0) return null;
    bits += i.toString(2).padStart(5, "0");
  }
  return bits.match(/.{4}/g)!.map((b) => parseInt(b, 2).toString(16)).join("");
}

/** Ein Host, den ein Client ansprechen darf: kein lokaler Name, keine private Adresse. */
function oeffentlicherHost(url: URL): boolean {
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return false;
  if (/^[\d.]+$/.test(host) || host.includes(":")) return !isPrivateAddress(host);
  return host.includes(".") && !/(^|\.)(localhost|local|lan|internal|home\.arpa)$/.test(host);
}

function adresse(s: string, schemata: readonly string[]): string | null {
  if (s.length > MAGNET_GRENZEN.adresse) return null;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (!schemata.includes(u.protocol) || u.username || u.password || !oeffentlicherHost(u)) return null;
  return u.toString();
}

/**
 * Magnet-Link lesen, streng. Genau eine Kennung `xt=urn:btih:` (40 Hex oder 32
 * Base32); eine zusätzliche v2-Kennung (`urn:btmh:`, Hybrid-Torrents) bleibt
 * unbeachtet. Ungültige Tracker und Web-Seeds fallen weg, alles andere auch.
 */
export function leseMagnet(s: string): Magnet | null {
  if (typeof s !== "string" || s.length > MAGNET_GRENZEN.laenge || !s.startsWith("magnet:?")) return null;
  let teile: URLSearchParams;
  try { teile = new URLSearchParams(s.slice("magnet:?".length)); } catch { return null; }
  const kennungen = teile.getAll("xt").filter((x) => x.toLowerCase().startsWith("urn:btih:")).map((x) => x.slice("urn:btih:".length));
  if (kennungen.length !== 1) return null;
  const k = kennungen[0]!;
  const infohash = /^[0-9a-fA-F]{40}$/.test(k) ? k.toLowerCase() : /^[A-Za-z2-7]{32}$/.test(k) ? base32ZuHex(k) : null;
  if (!infohash) return null;
  const tracker = [...new Set(teile.getAll("tr").map((t) => adresse(t, ["udp:", "http:", "https:", "wss:"])).filter((t): t is string => !!t))].slice(0, MAGNET_GRENZEN.tracker);
  const webSeeds = [...new Set(teile.getAll("ws").map((w) => adresse(w, ["https:"])).filter((w): w is string => !!w))].slice(0, MAGNET_GRENZEN.webSeeds);
  const link = `magnet:?xt=urn:btih:${infohash}${tracker.map((t) => `&tr=${encodeURIComponent(t)}`).join("")}${webSeeds.map((w) => `&ws=${encodeURIComponent(w)}`).join("")}`;
  return { infohash, tracker, webSeeds, link };
}

/**
 * Kennung des Inhalts eines Manifests: SHA-256 über die sortierten Zeilen
 * `<sha256>:<größe>` seiner Dateien. Gleich für jeden Herausgeber, der
 * dieselben Dateien festhält – so finden Knoten Seeds zu ihrer Fassung, auch
 * wenn jeder sein eigenes Manifest signiert hat (bis E9-4 die Regel).
 */
export function inhaltsKennung(m: ModelManifest): string {
  const zeilen = m.files.map((f) => `${f.sha256}:${f.sizeBytes}`).sort().join("\n");
  return bytesToHex(sha256(new TextEncoder().encode(zeilen)));
}

export interface MagnetQuelle {
  magnet: Magnet;
  /** Wie viele Knoten diesen Magnet für diese Fassung melden. */
  seeder: number;
}

/**
 * Welche Magnete gibt es im Netz für genau diese Fassung? Aus „ich halte vor“
 * (38058) mit gültiger Signatur, dem Modell, der Inhalts-Kennung des Manifests
 * und einem gültigen Magnet; nicht älter als `maxAlterSek`; je Knoten die
 * neueste Meldung. Je Torrent einmal, die meistgemeldeten zuerst. Vertrauen
 * braucht es dafür nicht – die Bytes prüft das Manifest.
 */
export function magnetQuellen(events: readonly NostrEvent[], m: ModelManifest, jetzt: number, maxAlterSek = 14 * 24 * 3600): MagnetQuelle[] {
  const inhalt = inhaltsKennung(m);
  const neueste = new Map<string, NostrEvent>();
  for (const ev of events) {
    if (ev.kind !== KIND_MODEL_SEED || jetzt - ev.created_at > maxAlterSek || !verifyEvent(ev)) continue;
    const bisher = neueste.get(ev.pubkey);
    if (!bisher || ev.created_at > bisher.created_at) neueste.set(ev.pubkey, ev);
  }
  const je = new Map<string, MagnetQuelle>();
  for (const ev of neueste.values()) {
    let s;
    try { s = parseModelSeed(ev); } catch { continue; }
    const magnet = s.magnet ? leseMagnet(s.magnet) : null;
    if (s.modelId !== m.modelId || s.inhalt !== inhalt || !magnet) continue;
    const q = je.get(magnet.infohash);
    if (q) q.seeder++;
    else je.set(magnet.infohash, { magnet, seeder: 1 });
  }
  return [...je.values()].sort((a, b) => b.seeder - a.seeder || a.magnet.infohash.localeCompare(b.magnet.infohash));
}
