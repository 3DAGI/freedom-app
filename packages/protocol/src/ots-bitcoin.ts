/**
 * „In Bitcoin verankert“ prüfen (Schritt 5.10b, B-17b2, K4 A). Ein Beweis
 * endet in einer Bitcoin-Attestierung; der Wert dort muss die Merkle-Wurzel
 * des Blocks dieser Höhe sein. Den Blockkopf liefern zwei unabhängige Explorer
 * (mempool.space, blockstream.info – beide Esplora): Er gilt nur, wenn beide
 * denselben nennen, wie bei der Stichprobe der RPC-Anbieter (5.8).
 *
 * Dazu prüft der Kopf sich selbst: Hash nachgerechnet und gleich dem, den der
 * Explorer zur Höhe nennt, Arbeit nach seinem Ziel, Ziel höchstens das des
 * Hauptnetzes. Ein gefälschter Kopf kostet so Rechenarbeit – schützen tut er
 * erst zusammen mit den zwei Quellen; welche Höhe er hat, wissen nur sie.
 *
 * Gefragt wird nur bei Bedarf (B-17b3). Die Explorer sehen IP und Blockhöhe,
 * nie den Beweis; mit Tor nur den Ausgang. Antworten begrenzt, kein Text
 * daraus hinaus – das Ergebnis ist eine Kennung.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { holeHoechstens, type OtsHolen } from "./ots-kalender.js";
import { OtsFehler, attestierungenVon, type OtsZeitstempel } from "./ots.js";

export const OTS_EXPLORER: readonly string[] = ["https://mempool.space/api", "https://blockstream.info/api"];

export const BLOCKKOPF_GRENZEN = {
  /** Höhen je Prüfung (ein Beweis nennt meist eine). */
  hoehen: 3,
  /** Antworten: Hash zur Höhe (64 Zeichen), Kopf (160 Zeichen). */
  hashBytes: 128,
  kopfBytes: 256,
} as const;

/** Höchstes Ziel im Hauptnetz (Bits 0x1d00ffff). */
const POW_LIMIT = 0xffffn << 208n;

export interface Blockkopf {
  /** Hash, wie Explorer ihn zeigen (umgedreht, Hex). */
  hash: string;
  /** Merkle-Wurzel in der Reihenfolge des Kopfs – so steht sie im Beweis. */
  wurzel: Uint8Array;
  /** Zeit des Blocks (Unix-Sekunden, vom Miner gesetzt, auf etwa zwei Stunden genau). */
  zeit: number;
  bits: number;
}

/** 80 Bytes lesen und den Kopf sich selbst prüfen lassen (Ziel, Arbeit). */
export function leseBlockkopf(kopf: Uint8Array): Blockkopf {
  if (kopf.length !== 80) throw new OtsFehler("blockkopf-laenge");
  const dv = new DataView(kopf.buffer, kopf.byteOffset, 80);
  const zeit = dv.getUint32(68, true);
  const bits = dv.getUint32(72, true);
  const exp = bits >>> 24;
  const mant = bits & 0x007fffff;
  if (mant === 0 || (bits & 0x00800000) !== 0) throw new OtsFehler("blockkopf-ziel");
  const ziel = exp <= 3 ? BigInt(mant >>> (8 * (3 - exp))) : BigInt(mant) << BigInt(8 * (exp - 3));
  if (ziel === 0n || ziel > POW_LIMIT) throw new OtsFehler("blockkopf-ziel");
  const hash = bytesToHex(sha256(sha256(kopf)).reverse());
  if (BigInt(`0x${hash}`) > ziel) throw new OtsFehler("blockkopf-arbeit");
  return { hash, wurzel: kopf.slice(36, 68), zeit, bits };
}

const holenStandard: OtsHolen = (url, init) => fetch(url, init);
const text = (b: Uint8Array) => new TextDecoder().decode(b).trim();

/** Kopf zur Höhe von einem Explorer – nur, wenn er sich selbst prüft und zum genannten Hash passt. */
async function kopfVon(holen: OtsHolen, basis: string, hoehe: number): Promise<{ hex: string; kopf: Blockkopf } | undefined> {
  const a = await holeHoechstens(holen, `${basis}/block-height/${hoehe}`, { method: "GET" }, BLOCKKOPF_GRENZEN.hashBytes);
  if (a?.status !== 200 || !a.bytes) return undefined;
  const hash = text(a.bytes);
  if (!/^[0-9a-f]{64}$/.test(hash)) return undefined;
  const b = await holeHoechstens(holen, `${basis}/block/${hash}/header`, { method: "GET" }, BLOCKKOPF_GRENZEN.kopfBytes);
  if (b?.status !== 200 || !b.bytes) return undefined;
  const hex = text(b.bytes);
  if (!/^[0-9a-f]{160}$/.test(hex)) return undefined;
  let kopf: Blockkopf;
  try { kopf = leseBlockkopf(hexToBytes(hex)); } catch { return undefined; }
  return kopf.hash === hash ? { hex, kopf } : undefined;
}

export type Verankerung =
  | { ok: true; hoehe: number; zeit: number; blockHash: string }
  | { ok: false; fall: "keine-bitcoin" | "nicht-erreichbar" | "uneinig" | "falsche-wurzel" };

/**
 * Beweis gegen Bitcoin prüfen: Höhen aufsteigend (höchstens
 * `BLOCKKOPF_GRENZEN.hoehen`), je Höhe der Kopf von jedem Explorer. Fehlt
 * einer oder ist einer unbrauchbar → `nicht-erreichbar`; nennen sie
 * verschiedene → `uneinig` – beides heißt: keine Aussage. Passt bei keiner
 * Höhe die Wurzel → `falsche-wurzel`. Sonst die niedrigste passende Höhe mit
 * der Zeit des Blocks: Der Wert existierte, bevor dieser Block entstand.
 */
export async function pruefeVerankerung(
  z: OtsZeitstempel,
  opt: { holen?: OtsHolen; explorer?: readonly string[] } = {},
): Promise<Verankerung> {
  const holen = opt.holen ?? holenStandard;
  const explorer = (opt.explorer ?? OTS_EXPLORER).map((e) => e.replace(/\/$/, ""));
  const werte = new Map<number, string[]>();
  for (const { nachricht, attestierung: a } of attestierungenVon(z)) {
    if (a.art !== "bitcoin") continue;
    werte.set(a.hoehe, [...(werte.get(a.hoehe) ?? []), bytesToHex(nachricht)]);
  }
  if (werte.size === 0) return { ok: false, fall: "keine-bitcoin" };
  if (new Set(explorer).size < 2) return { ok: false, fall: "nicht-erreichbar" };
  for (const hoehe of [...werte.keys()].sort((a, b) => a - b).slice(0, BLOCKKOPF_GRENZEN.hoehen)) {
    const koepfe = await Promise.all(explorer.map((e) => kopfVon(holen, e, hoehe)));
    const gut = koepfe.filter((k): k is { hex: string; kopf: Blockkopf } => k !== undefined);
    if (gut.length < koepfe.length) return { ok: false, fall: "nicht-erreichbar" };
    if (gut.some((k) => k.hex !== gut[0]!.hex)) return { ok: false, fall: "uneinig" };
    const { kopf } = gut[0]!;
    if (werte.get(hoehe)!.includes(bytesToHex(kopf.wurzel))) return { ok: true, hoehe, zeit: kopf.zeit, blockHash: kopf.hash };
  }
  return { ok: false, fall: "falsche-wurzel" };
}
