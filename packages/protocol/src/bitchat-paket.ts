/**
 * Bitchat über Bluetooth (Sammlung B-36, Entscheidungen BC-W1–W4 A vom 23.10.2026, `docs/BITCHAT-ENTWURF.md`) – das
 * Paketformat: Kopf, Auffüllen, Signatur und Peer-ID (B-36a1), Ankündigung und Fragmente (B-36a2), Byte für Byte wie
 * bitchat-android (`test/fixtures/bitchat-referenz.json` aus `scripts/bitchat-referenz.sh`).
 * Eigene Umsetzung nach dem gemeinfreien Whitepaper und Swift-Code – kein Code aus bitchat-android (GPL-3.0).
 *
 * Freedom packt nie: Bitchat signiert über eine neue Kodierung des Pakets und packt dabei Nutzlasten ab 100 Byte selbst,
 * wenn sie sich packen lassen (raw deflate, nicht eindeutig) – die Signatur gälte dann nicht mehr. Ankündigungen bleiben
 * deshalb unter 100 Byte (ohne Nachbarliste, `baueBitchatAnkuendigung()`; `signiereBitchat()` lehnt größere ab), alles
 * andere ist Chiffrat und lässt sich nicht packen. Gepackte Pakete anderer liest `leseBitchat()` nur bis zum Kopf (`komprimiert`) und entpackt sie nie.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";

/** Pakettypen, die Freedom sendet oder liest (`MessageType` in Bitchat). */
export const BITCHAT_TYP = Object.freeze({
  ankuendigung: 0x01,
  abschied: 0x03,
  noiseHandshake: 0x10,
  noiseVerschluesselt: 0x11,
  fragment: 0x20,
} as const);

export const BITCHAT_GRENZEN = Object.freeze({
  kennung: 8,
  signatur: 64,
  ttl: 7,
  /** Nutzlast je Paket (bitchat-android `MAX_PAYLOAD_LENGTH`: 1 MiB) */
  nutzlast: 1 << 20,
  /** Ab hier packt Bitchat selbst – Ankündigungen bleiben darunter. */
  packen: 100,
  /** Größer ungepolstert, und das Paket geht in Fragmenten (Whitepaper §4.4). */
  mtu: 512,
  fragmentKopf: 13,
  /** Höchstens so viele Fragmente je Paket – mehr nimmt bitchat-android nicht an (`MAX_FRAGMENTS_PER_ID`). */
  fragmente: 256,
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

export interface BitchatAnkuendigung {
  name: string;
  noise: Uint8Array;
  signier: Uint8Array;
  /** Bitfeld der Fähigkeiten, fehlt bei alten Geräten */
  faehigkeiten?: bigint;
  /** Nachbarn (TLV 0x04) – Freedom liest sie, sendet sie nie */
  nachbarn?: Uint8Array[];
}

const TLV = Object.freeze({ name: 0x01, noise: 0x02, signier: 0x03, nachbarn: 0x04, faehigkeiten: 0x05 });

/**
 * Die eigene Ankündigung: Name, Noise- und Signierschlüssel – keine Nachbarn, keine Fähigkeiten (BC-W3 A: niemand im
 * Funk soll Freedom erkennen). Unter 100 Byte, sonst packte Bitchat und die Signatur gälte nicht.
 */
export function baueBitchatAnkuendigung(a: { name: string; noise: Uint8Array; signier: Uint8Array }): Uint8Array {
  const name = new TextEncoder().encode(a.name);
  if (a.noise.length !== 32 || a.signier.length !== 32 || name.length > 255) throw new BitchatFehler("form");
  const aus = new Uint8Array(6 + name.length + 64);
  aus.set([TLV.name, name.length], 0);
  aus.set(name, 2);
  let i = 2 + name.length;
  aus.set([TLV.noise, 32], i);
  aus.set(a.noise, i + 2);
  i += 34;
  aus.set([TLV.signier, 32], i);
  aus.set(a.signier, i + 2);
  if (aus.length >= BITCHAT_GRENZEN.packen) throw new BitchatFehler("ankuendigung-zu-gross");
  return aus;
}

/** Liest eine Ankündigung; Name und beide Schlüssel (je 32 Byte) sind Pflicht, Unbekanntes wird übersprungen. */
export function leseBitchatAnkuendigung(d: Uint8Array): BitchatAnkuendigung | null {
  let name: string | undefined;
  let noise: Uint8Array | undefined;
  let signier: Uint8Array | undefined;
  let faehigkeiten: bigint | undefined;
  let nachbarn: Uint8Array[] | undefined;
  let i = 0;
  while (i + 2 <= d.length) {
    const typ = d[i];
    const n = d[i + 1];
    i += 2;
    if (i + n > d.length) return null;
    const wert = d.slice(i, i + n);
    i += n;
    if (typ === TLV.name) {
      try {
        name = new TextDecoder("utf-8", { fatal: true }).decode(wert);
      } catch {
        return null;
      }
    } else if (typ === TLV.noise) noise = wert;
    else if (typ === TLV.signier) signier = wert;
    else if (typ === TLV.faehigkeiten) {
      faehigkeiten = 0n;
      wert.slice(0, 8).forEach((b, k) => (faehigkeiten! |= BigInt(b) << BigInt(8 * k)));
    } else if (typ === TLV.nachbarn) {
      if (n % 8 !== 0) return null;
      nachbarn = Array.from({ length: n / 8 }, (_, k) => wert.slice(k * 8, k * 8 + 8));
    }
  }
  if (i !== d.length || name === undefined || noise?.length !== 32 || signier?.length !== 32) return null;
  return {
    name,
    noise,
    signier,
    ...(faehigkeiten !== undefined ? { faehigkeiten } : {}),
    ...(nachbarn ? { nachbarn } : {}),
  };
}

export interface BitchatFragment {
  kennung: Uint8Array;
  index: number;
  gesamt: number;
  typ: number;
  daten: Uint8Array;
}

/** Nutzlast eines Fragments: 8 Byte Kennung, Index und Gesamtzahl (UInt16), ursprünglicher Typ, Daten. */
export function kodiereBitchatFragment(f: BitchatFragment): Uint8Array {
  if (
    !kennungOk(f.kennung) ||
    !Number.isInteger(f.index) ||
    !Number.isInteger(f.gesamt) ||
    f.gesamt < 1 ||
    f.gesamt > 0xffff ||
    f.index < 0 ||
    f.index >= f.gesamt ||
    !byte(f.typ)
  ) {
    throw new BitchatFehler("form");
  }
  const aus = new Uint8Array(BITCHAT_GRENZEN.fragmentKopf + f.daten.length);
  aus.set(f.kennung, 0);
  aus.set([f.index >> 8, f.index & 0xff, f.gesamt >> 8, f.gesamt & 0xff, f.typ], 8);
  aus.set(f.daten, BITCHAT_GRENZEN.fragmentKopf);
  return aus;
}

export function leseBitchatFragment(d: Uint8Array): BitchatFragment | null {
  if (d.length <= BITCHAT_GRENZEN.fragmentKopf) return null;
  const index = (d[8] << 8) | d[9];
  const gesamt = (d[10] << 8) | d[11];
  if (gesamt < 1 || index >= gesamt) return null;
  return { kennung: d.slice(0, 8), index, gesamt, typ: d[12], daten: d.slice(BITCHAT_GRENZEN.fragmentKopf) };
}

/**
 * Zerlegt ein Paket, das größer als die MTU ist, in Fragmente (Typ 0x20, ohne Signatur, gleicher Absender, Empfänger, Zeit
 * und TTL – wie bitchat-android). Datenstücke so groß, dass jedes Fragment mit Polster in 512 Byte passt. Die Kennung gibt
 * der Aufrufer (8 Zufallsbyte). Seit B-36a4 auch für eine kleinere Grenze je Verbindung (`grenze`) und über das gepolsterte
 * Paket (`polster`) – dann verrät auch das Zerlegen die Länge nicht.
 */
export function zerlegeBitchat(
  p: BitchatPaket,
  kennung: Uint8Array,
  o: { grenze?: number; polster?: boolean } = {},
): BitchatPaket[] {
  const grenze = o.grenze ?? BITCHAT_GRENZEN.mtu;
  const ganz = kodiereBitchat(p, { polster: o.polster });
  if (ganz.length <= grenze) return [p];
  const route = p.version === 2 && p.route?.length ? p.route : undefined;
  const kopf = route ? 16 : 14;
  const aufwand =
    kopf + 8 + (p.empfaenger ? 8 : 0) + (route ? 1 + route.length * 8 : 0) + BITCHAT_GRENZEN.fragmentKopf + 16;
  const stueck = Math.min(Math.min(grenze, BITCHAT_GRENZEN.mtu) - aufwand, 469);
  if (stueck <= 0) throw new BitchatFehler("zu-gross");
  const gesamt = Math.ceil(ganz.length / stueck);
  if (gesamt > BITCHAT_GRENZEN.fragmente) throw new BitchatFehler("zu-gross");
  return Array.from({ length: gesamt }, (_, index) => ({
    version: route ? 2 : 1,
    typ: BITCHAT_TYP.fragment,
    ttl: p.ttl,
    zeit: p.zeit,
    absender: p.absender,
    ...(p.empfaenger ? { empfaenger: p.empfaenger } : {}),
    ...(route ? { route } : {}),
    nutzlast: kodiereBitchatFragment({
      kennung,
      index,
      gesamt,
      typ: p.typ,
      daten: ganz.subarray(index * stueck, (index + 1) * stueck),
    }),
  }));
}

/** Grenzen beim Zusammensetzen – wie bitchat-android (`AppConstants.Fragmentation`). */
export const BITCHAT_ZUSAMMENSETZEN = Object.freeze({ offen: 64, bytesJeSatz: 1 << 20, bytes: 4 << 20, fristMs: 30_000 });

interface OffenerSatz {
  typ: number;
  gesamt: number;
  teile: Map<number, Uint8Array>;
  groesse: number;
  seit: number;
}

/**
 * Setzt Fragmente wieder zusammen – je Absender und Kennung, mit den Grenzen aus `BITCHAT_ZUSAMMENSETZEN`; was sie
 * überschritte, fällt weg (ein neuer Satz bei vollem Speicher, ein ganzer Satz bei widersprüchlichen Angaben). Das fertige
 * Paket kommt mit TTL 0 heraus: Weitergereicht werden die Fragmente, nie das zusammengesetzte Ganze.
 */
export class BitchatZusammensetzer {
  private readonly saetze = new Map<string, OffenerSatz>();
  private gepuffert = 0;

  nimm(p: BitchatPaket, jetzt: number): GelesenesBitchatPaket | null {
    if (p.typ !== BITCHAT_TYP.fragment) return null;
    const f = leseBitchatFragment(p.nutzlast);
    if (!f || f.gesamt > BITCHAT_GRENZEN.fragmente) return null;
    this.raeume(jetzt);
    const name = `${hexKurz(p.absender)}:${hexKurz(f.kennung)}`;
    let satz = this.saetze.get(name);
    if (satz && (satz.gesamt !== f.gesamt || satz.typ !== f.typ)) {
      this.vergiss(name);
      return null;
    }
    if (!satz) {
      if (this.saetze.size >= BITCHAT_ZUSAMMENSETZEN.offen) return null;
      satz = { typ: f.typ, gesamt: f.gesamt, teile: new Map(), groesse: 0, seit: jetzt };
      this.saetze.set(name, satz);
    }
    const plus = f.daten.length - (satz.teile.get(f.index)?.length ?? 0);
    if (satz.groesse + plus > BITCHAT_ZUSAMMENSETZEN.bytesJeSatz) {
      this.vergiss(name);
      return null;
    }
    if (this.gepuffert + plus > BITCHAT_ZUSAMMENSETZEN.bytes) {
      if (satz.teile.size === 0) this.vergiss(name);
      return null;
    }
    satz.teile.set(f.index, f.daten);
    satz.groesse += plus;
    this.gepuffert += plus;
    if (satz.teile.size < satz.gesamt) return null;
    const ganz = new Uint8Array(satz.groesse);
    let i = 0;
    for (let k = 0; k < satz.gesamt; k++) {
      const teil = satz.teile.get(k)!;
      ganz.set(teil, i);
      i += teil.length;
    }
    this.vergiss(name);
    const paket = leseBitchat(ganz);
    return paket && paket.typ === satz.typ ? { ...paket, ttl: 0 } : null;
  }

  /** Offene Sätze (für Tests und die Anzeige im Funk-Bereich) */
  get offen(): number {
    return this.saetze.size;
  }

  private raeume(jetzt: number): void {
    for (const [name, satz] of this.saetze) if (jetzt - satz.seit > BITCHAT_ZUSAMMENSETZEN.fristMs) this.vergiss(name);
  }

  private vergiss(name: string): void {
    const satz = this.saetze.get(name);
    if (!satz) return;
    this.gepuffert -= satz.groesse;
    this.saetze.delete(name);
  }
}

const hexKurz = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
