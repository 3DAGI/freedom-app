/**
 * Bitchat über Bluetooth (Sammlung B-36, Entscheidungen BC-W1–W4 A vom 23.10.2026, `docs/BITCHAT-ENTWURF.md`) – das
 * Paketformat (B-36a1): Kopf, Auffüllen, Signatur und Peer-ID, Byte für Byte wie bitchat-android
 * (`test/fixtures/bitchat-referenz.json` aus `scripts/bitchat-referenz.sh`); Ankündigung und Fragmente folgen (B-36a2).
 * Eigene Umsetzung nach dem gemeinfreien Whitepaper und Swift-Code – kein Code aus bitchat-android (GPL-3.0).
 *
 * Freedom packt nie: Bitchat signiert über eine neue Kodierung des Pakets und packt dabei Nutzlasten ab 100 Byte selbst,
 * wenn sie sich packen lassen (raw deflate, nicht eindeutig) – die Signatur gälte dann nicht mehr. Ankündigungen bleiben
 * deshalb unter 100 Byte (ohne Nachbarliste; `signiereBitchat()` lehnt größere ab), alles andere ist Chiffrat und lässt
 * sich nicht packen. Gepackte Pakete anderer liest `leseBitchat()` nur bis zum Kopf (`komprimiert`) und entpackt sie nie.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";

/** Pakettypen, die Freedom sendet oder liest (`MessageType` in Bitchat). */
export const BITCHAT_TYP = Object.freeze({
  ankuendigung: 0x01,
  abschied: 0x03,
  noiseHandshake: 0x10,
  noiseVerschluesselt: 0x11,
} as const);

export const BITCHAT_GRENZEN = Object.freeze({
  kennung: 8,
  signatur: 64,
  ttl: 7,
  /** Nutzlast je Paket (bitchat-android `MAX_PAYLOAD_LENGTH`: 1 MiB) */
  nutzlast: 1 << 20,
  /** Ab hier packt Bitchat selbst – Ankündigungen bleiben darunter. */
  packen: 100,
});

/** Blöcke, auf die Noise-Pakete aufgefüllt werden (PKCS#7, Whitepaper §4.1). */
export const BITCHAT_BLOECKE = [256, 512, 1024, 2048] as const;

export const BITCHAT_FAELLE = ["form", "zu-gross", "ankuendigung-zu-gross"] as const; // kein UI-Text
export type BitchatFall = (typeof BITCHAT_FAELLE)[number];

export class BitchatFehler extends Error {
  constructor(readonly fall: BitchatFall) {
    super(`Bitchat: ${fall}`); // kein UI-Text
    this.name = "BitchatFehler";
  }
}

export interface BitchatPaket {
  version: 1 | 2;
  typ: number;
  ttl: number;
  /** Millisekunden seit 1970 (UInt64 im Paket) */
  zeit: number;
  absender: Uint8Array;
  empfaenger?: Uint8Array;
  /** nur Fassung 2: Peer-IDs der Sprünge */
  route?: Uint8Array[];
  nutzlast: Uint8Array;
  signatur?: Uint8Array;
}

/** Was `leseBitchat()` liefert: gepackte Nutzlast bleibt gepackt (`nutzlast` = Bytes auf dem Draht). */
export interface GelesenesBitchatPaket extends BitchatPaket {
  komprimiert: boolean;
  /** nur bei `komprimiert`: Größe nach dem Entpacken */
  ungepackt?: number;
}

const FLAG = Object.freeze({ empfaenger: 0x01, signatur: 0x02, komprimiert: 0x04, route: 0x08 });

const byte = (n: number): boolean => Number.isInteger(n) && n >= 0 && n <= 0xff;
const kennungOk = (k: Uint8Array | undefined): boolean => k instanceof Uint8Array && k.length === BITCHAT_GRENZEN.kennung;

function pruefeForm(p: BitchatPaket): void {
  const ok =
    (p.version === 1 || p.version === 2) &&
    byte(p.typ) &&
    byte(p.ttl) &&
    Number.isSafeInteger(p.zeit) &&
    p.zeit >= 0 &&
    kennungOk(p.absender) &&
    (p.empfaenger === undefined || kennungOk(p.empfaenger)) &&
    (p.route === undefined || (p.version === 2 && p.route.length <= 0xff && p.route.every(kennungOk))) &&
    (p.signatur === undefined || p.signatur.length === BITCHAT_GRENZEN.signatur);
  if (!ok) throw new BitchatFehler("form");
  if (p.nutzlast.length > BITCHAT_GRENZEN.nutzlast) throw new BitchatFehler("zu-gross");
}

/** Blockgröße wie `MessagePadding.optimalBlockSize()` – 16 Byte Luft, darüber bleibt die Größe. */
export function bitchatBlock(laenge: number): number {
  return BITCHAT_BLOECKE.find((b) => laenge + 16 <= b) ?? laenge;
}

/** PKCS#7 auf den Block – nur, wenn höchstens 255 Byte fehlen (sonst bleibt es, wie es ist). */
export function polstereBitchat(daten: Uint8Array): Uint8Array {
  const fehlt = bitchatBlock(daten.length) - daten.length;
  if (fehlt <= 0 || fehlt > 255) return daten;
  const aus = new Uint8Array(daten.length + fehlt);
  aus.set(daten);
  aus.fill(fehlt, daten.length);
  return aus;
}

/** Entfernt ein gültiges PKCS#7-Polster, sonst bleibt alles. */
export function entpolstereBitchat(daten: Uint8Array): Uint8Array {
  const n = daten.length ? daten[daten.length - 1] : 0;
  if (n === 0 || n > daten.length) return daten;
  for (let i = daten.length - n; i < daten.length; i++) if (daten[i] !== n) return daten;
  return daten.subarray(0, daten.length - n);
}

/** Kodiert ein Paket – nie gepackt; aufgefüllt nur mit `polster` (Bitchat füllt nur Noise-Pakete auf). */
export function kodiereBitchat(p: BitchatPaket, o: { polster?: boolean } = {}): Uint8Array {
  pruefeForm(p);
  const route = p.version === 2 && p.route?.length ? p.route : undefined;
  const laenge = p.nutzlast.length;
  const kopf = p.version === 2 ? 16 : 14;
  const groesse =
    kopf + 8 + (p.empfaenger ? 8 : 0) + (route ? 1 + route.length * 8 : 0) + laenge + (p.signatur ? 64 : 0);
  if (p.version === 1 && laenge > 0xffff) throw new BitchatFehler("zu-gross");
  const aus = new Uint8Array(groesse);
  const dv = new DataView(aus.buffer);
  aus[0] = p.version;
  aus[1] = p.typ;
  aus[2] = p.ttl;
  dv.setBigUint64(3, BigInt(p.zeit));
  aus[11] =
    (p.empfaenger ? FLAG.empfaenger : 0) | (p.signatur ? FLAG.signatur : 0) | (route ? FLAG.route : 0);
  if (p.version === 2) dv.setUint32(12, laenge);
  else dv.setUint16(12, laenge);
  let i = kopf;
  aus.set(p.absender, i);
  i += 8;
  if (p.empfaenger) {
    aus.set(p.empfaenger, i);
    i += 8;
  }
  if (route) {
    aus[i++] = route.length;
    for (const hop of route) {
      aus.set(hop, i);
      i += 8;
    }
  }
  aus.set(p.nutzlast, i);
  i += laenge;
  if (p.signatur) aus.set(p.signatur, i);
  return o.polster ? polstereBitchat(aus) : aus;
}

function leseKern(d: Uint8Array): GelesenesBitchatPaket | null {
  if (d.length < 22) return null;
  const version = d[0];
  if (version !== 1 && version !== 2) return null;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const kopf = version === 2 ? 16 : 14;
  if (d.length < kopf + 8) return null;
  const zeit = dv.getBigUint64(3);
  if (zeit > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const flags = d[11];
  const laenge = version === 2 ? dv.getUint32(12) : dv.getUint16(12);
  if (laenge > BITCHAT_GRENZEN.nutzlast) return null;
  let i = kopf;
  const nimm = (n: number): Uint8Array | null => {
    if (i + n > d.length) return null;
    const teil = d.slice(i, i + n);
    i += n;
    return teil;
  };
  const absender = nimm(8);
  if (!absender) return null;
  let empfaenger: Uint8Array | undefined;
  if (flags & FLAG.empfaenger) {
    const e = nimm(8);
    if (!e) return null;
    empfaenger = e;
  }
  let route: Uint8Array[] | undefined;
  if (version === 2 && flags & FLAG.route) {
    const anzahl = nimm(1);
    if (!anzahl) return null;
    route = [];
    for (let h = 0; h < anzahl[0]; h++) {
      const hop = nimm(8);
      if (!hop) return null;
      route.push(hop);
    }
    if (route.length === 0) route = undefined;
  }
  const komprimiert = (flags & FLAG.komprimiert) !== 0;
  let ungepackt: number | undefined;
  let rest = laenge;
  if (komprimiert) {
    const feld = version === 2 ? 4 : 2;
    const g = nimm(feld);
    if (!g || laenge <= feld) return null;
    ungepackt = feld === 4 ? new DataView(g.buffer).getUint32(0) : new DataView(g.buffer).getUint16(0);
    if (ungepackt === 0 || ungepackt > BITCHAT_GRENZEN.nutzlast) return null;
    rest -= feld;
  }
  const nutzlast = nimm(rest);
  if (!nutzlast) return null;
  let signatur: Uint8Array | undefined;
  if (flags & FLAG.signatur) {
    const s = nimm(64);
    if (!s) return null;
    signatur = s;
  }
  return {
    version,
    typ: d[1],
    ttl: d[2],
    zeit: Number(zeit),
    absender,
    ...(empfaenger ? { empfaenger } : {}),
    ...(route ? { route } : {}),
    nutzlast,
    ...(signatur ? { signatur } : {}),
    komprimiert,
    ...(ungepackt !== undefined ? { ungepackt } : {}),
  };
}

/** Liest ein Paket wie Bitchat: erst wie es ist, sonst ohne Polster. Unlesbares → `null`. */
export function leseBitchat(daten: Uint8Array): GelesenesBitchatPaket | null {
  const roh = leseKern(daten);
  if (roh) return roh;
  const ohne = entpolstereBitchat(daten);
  return ohne === daten ? null : leseKern(ohne);
}

/** Was signiert wird: das Paket ohne Signatur, mit TTL 0, aufgefüllt – wie `toBinaryDataForSigning()`. */
export function bitchatSignierDaten(p: BitchatPaket): Uint8Array {
  return kodiereBitchat({ ...p, ttl: 0, signatur: undefined }, { polster: true });
}

/** Signiert mit dem Ed25519-Schlüssel der Bitchat-Identität (nie der Nostr-Schlüssel, BC-W4 A). */
export function signiereBitchat(p: BitchatPaket, signierSchluessel: Uint8Array): BitchatPaket {
  if (p.typ === BITCHAT_TYP.ankuendigung && p.nutzlast.length >= BITCHAT_GRENZEN.packen) {
    throw new BitchatFehler("ankuendigung-zu-gross");
  }
  return { ...p, signatur: ed25519.sign(bitchatSignierDaten(p), signierSchluessel) };
}

export function pruefeBitchatSignatur(p: BitchatPaket, signierPk: Uint8Array): boolean {
  if (!p.signatur || signierPk.length !== 32 || ("komprimiert" in p && p.komprimiert)) return false;
  try {
    return ed25519.verify(p.signatur, bitchatSignierDaten(p), signierPk);
  } catch {
    return false;
  }
}

/** Peer-ID: die ersten 8 Byte von SHA-256 über den statischen Noise-Schlüssel (fest je Identität, Whitepaper §3). */
export function bitchatPeerId(noiseStatischPk: Uint8Array): Uint8Array {
  if (noiseStatischPk.length !== 32) throw new BitchatFehler("form");
  return sha256(noiseStatischPk).slice(0, 8);
}
