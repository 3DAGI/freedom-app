/**
 * Meshtastic-Geräte direkt ansprechen (7.5a, Wunsch MENSCH 08.10.2026).
 *
 * WARUM
 * Bis 7.5 schickte die App ihre Rahmen roh mit zwei Byte Länge davor (7.4c1).
 * Das versteht kein Funkgerät von der Stange: Meshtastic – die verbreitete
 * Firmware für LoRa-Geräte um 40 € – spricht über USB, Bluetooth und TCP ein
 * eigenes Protobuf-Format und verwarf unsere Rahmen still. Hier steht genau
 * so viel von diesem Format, wie die App braucht – ohne Abhängigkeit,
 * verglichen mit der offiziellen Python-Bibliothek
 * (`scripts/meshtastic-referenz.py`). Alles Weitere: `docs/MESHTASTIC.md`.
 *
 * WIE
 * - Jeder unserer Rahmen (höchstens `LORA_MTU` = 200 Byte) wird ein
 *   Meshtastic-Paket an alle (`to` = 0xFFFFFFFF) mit Port `PRIVATE_APP` auf
 *   dem Kanal „freedom“. Die Firmware leitet es selbst weiter (Hop-Limit des
 *   Geräts) – die App reicht über Meshtastic nichts mehr weiter.
 * - Kanal „freedom“ (Entscheidung MENSCH 08.10.: Variante a): ein zweiter Kanal
 *   neben dem Hauptkanal des Geräts. Gesendet wird damit auf derselben
 *   Frequenz wie die Meshtastic-Geräte in der Nähe; die leiten in ihrer
 *   Standardeinstellung („ALL“) auch weiter, was sie nicht lesen können.
 * - Der Schlüssel des Kanals ist KEIN Geheimnis: Er steht hier im Code, damit
 *   jede App denselben Kanal findet. Er trennt nur unseren Verkehr vom Chat der
 *   anderen. Geschützt sind die Nachrichten durch ihre eigenen Umschläge (7.1).
 * - Eine Paket-Id setzt die App nicht: Fehlt sie, vergibt die Firmware eine.
 */
import { hexToBytes } from "@noble/hashes/utils.js";

/** Beginn jeder Nachricht im Strom (USB, TCP): START1, START2. */
const MESHTASTIC_START = Uint8Array.from([0x94, 0xc3]);
/** Größte Nachricht im Strom (`MAX_TO_FROM_RADIO_SIZE`). */
const MESHTASTIC_MAX_NACHRICHT = 512;
/** Größte Nutzlast eines Pakets (`Constants.DATA_PAYLOAD_LEN`). */
export const MESHTASTIC_MAX_NUTZLAST = 233;
/** Port für eigene Anwendungen (`PortNum.PRIVATE_APP`). */
export const MESHTASTIC_PORT = 256;
/** Empfänger „alle“ (`BROADCAST_NUM`). */
const MESHTASTIC_RUNDRUF = 0xffffffff;
/** TCP-Port der Geräte mit WLAN. */
export const MESHTASTIC_TCP_PORT = 4403;
/** Bluetooth: Dienst und Merkmale der Firmware. */
export const MESHTASTIC_BLE = {
  dienst: "6ba1b218-15a8-461f-9fa8-5dcae273eafd",
  zumGeraet: "f75c76d2-129e-4dad-a1dd-7866124401e7",
  vomGeraet: "2c55e69e-4993-11ed-b878-0242ac120002",
  meldung: "ed9da18c-a800-4f66-a670-aa7547e34453",
} as const;
/** Region „nicht gesetzt“: Ein neues Gerät sendet so nicht. */
export const MESHTASTIC_REGION_UNGESETZT = 0;

/**
 * Der Kanal der App. Schlüssel = SHA-256 von „freedomstack-meshtastic-kanal-v1“
 * (ein Test rechnet nach) – öffentlich, siehe oben. Ändern heißt: Alte und
 * neue Apps finden sich nicht mehr.
 */
export const FREEDOM_KANAL = {
  name: "freedom",
  psk: hexToBytes("86c15e838c5fa4f975c270d4dd2cd959b9efe5174f8ba980ba07d4b06d7d036d"),
} as const;

// --- Schreiben (Protobuf, nur was die App sendet) ---

function varint(n: number): number[] {
  const out: number[] = [];
  let v = n;
  while (v > 0x7f) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
  return out;
}

const kopf = (nr: number, typ: 0 | 2 | 5): number[] => varint(nr * 8 + typ);
const zahl = (nr: number, v: number): number[] => (v === 0 ? [] : [...kopf(nr, 0), ...varint(v)]);
const fest32 = (nr: number, v: number): number[] => [...kopf(nr, 5), v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, v >>> 24];
const teil = (nr: number, inhalt: ArrayLike<number>): number[] => [...kopf(nr, 2), ...varint(inhalt.length), ...Array.from(inhalt)];

function uint32(v: number, was: string): number {
  if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) throw new RangeError(`meshtastic: ${was} ungültig`);
  return v;
}

/** `ToRadio { want_config_id }` – danach schickt das Gerät seine Einstellungen und Pakete. */
export function baueKonfigAnfrage(id: number): Uint8Array {
  return Uint8Array.from(zahl(3, uint32(id, "id")));
}

/** `ToRadio { packet }`: ein Rahmen an alle, Port `PRIVATE_APP`, auf `kanal`. */
export function baueFunkPaket(p: { kanal: number; hopLimit: number; nutzlast: Uint8Array }): Uint8Array {
  if (p.nutzlast.length > MESHTASTIC_MAX_NUTZLAST) throw new RangeError("meshtastic: Nutzlast zu groß");
  const daten = [...zahl(1, MESHTASTIC_PORT), ...(p.nutzlast.length ? teil(2, p.nutzlast) : [])];
  const paket = [
    ...fest32(2, MESHTASTIC_RUNDRUF),
    ...zahl(3, uint32(p.kanal, "kanal")),
    ...teil(4, daten),
    ...zahl(9, uint32(p.hopLimit, "hopLimit")),
  ];
  return Uint8Array.from(teil(1, paket));
}

/** Kopf für den Strom (USB, TCP): START1, START2, Länge (Big Endian). */
export function mitMeshtasticKopf(nachricht: Uint8Array): Uint8Array {
  if (nachricht.length > MESHTASTIC_MAX_NACHRICHT) throw new RangeError("meshtastic: Nachricht zu groß");
  const out = new Uint8Array(4 + nachricht.length);
  out.set(MESHTASTIC_START);
  out[2] = nachricht.length >> 8;
  out[3] = nachricht.length & 0xff;
  out.set(nachricht, 4);
  return out;
}

/**
 * Nachrichten aus dem Strom eines Geräts. Was nicht mit START1 beginnt, ist
 * Text aus dem Debug-Log der Firmware und wird übergangen; eine Länge über
 * 512 heißt: neu aufsetzen (wie die Python-Bibliothek).
 */
export class MeshtasticStrom {
  #puffer: number[] = [];

  push(bytes: Uint8Array): Uint8Array[] {
    const fertig: Uint8Array[] = [];
    for (const b of bytes) {
      const p = this.#puffer;
      if (p.length === 0) {
        if (b === MESHTASTIC_START[0]) p.push(b);
      } else if (p.length === 1) {
        if (b === MESHTASTIC_START[1]) p.push(b);
        else this.#puffer = b === MESHTASTIC_START[0] ? [b] : [];
      } else {
        p.push(b);
        if (p.length < 4) continue;
        const laenge = (p[2]! << 8) | p[3]!;
        if (laenge > MESHTASTIC_MAX_NACHRICHT) this.#puffer = [];
        else if (p.length === 4 + laenge) {
          fertig.push(Uint8Array.from(p.slice(4)));
          this.#puffer = [];
        }
      }
    }
    return fertig;
  }
}

// --- Lesen (FromRadio, nur was die App braucht; alles andere wird übersprungen) ---

export type VomGeraet =
  | { art: "paket"; von: number; an: number; kanal: number; port: number; nutzlast: Uint8Array }
  | { art: "ich"; knoten: number }
  | { art: "lora"; region: number; hopLimit: number; senden: boolean; preset: number; vorgabe: boolean }
  | { art: "kanal"; index: number; name: string; psk: Uint8Array; rolle: number }
  | { art: "fertig"; id: number }
  | { art: "warteschlange"; frei: number; max: number }
  | { art: "neustart" }
  | { art: "anderes" };

class Kaputt extends Error {}

class Leser {
  #i = 0;
  constructor(private readonly b: Uint8Array) {}
  get ende(): boolean {
    return this.#i >= this.b.length;
  }
  varint(): number {
    let v = 0;
    for (let n = 0; n < 10; n++) {
      if (this.#i >= this.b.length) throw new Kaputt();
      const x = this.b[this.#i++]!;
      v += (x & 0x7f) * 2 ** (7 * n);
      if (x < 0x80) return v;
    }
    throw new Kaputt();
  }
  stueck(n: number): Uint8Array {
    if (n > this.b.length - this.#i) throw new Kaputt();
    const s = this.b.subarray(this.#i, this.#i + n);
    this.#i += n;
    return s;
  }
  fest32(): number {
    const s = this.stueck(4);
    return (s[0]! | (s[1]! << 8) | (s[2]! << 16) | (s[3]! << 24)) >>> 0;
  }
  /** Nächstes Feld: Nummer, Typ und Wert (Zahl oder Bytes); Typ 1 und 5 als Bytes. */
  feld(): { nr: number; zahl?: number; bytes?: Uint8Array } {
    const k = this.varint();
    const nr = Math.floor(k / 8);
    const typ = k % 8;
    if (nr === 0) throw new Kaputt();
    if (typ === 0) return { nr, zahl: this.varint() };
    if (typ === 1) return { nr, bytes: this.stueck(8) };
    if (typ === 2) return { nr, bytes: this.stueck(this.varint()) };
    if (typ === 5) return { nr, bytes: this.stueck(4) };
    throw new Kaputt(); // Gruppen (3, 4) gibt es in Meshtastic nicht
  }
}

function felder(b: Uint8Array, je: (nr: number, f: { zahl?: number; bytes?: Uint8Array }) => void): void {
  const l = new Leser(b);
  while (!l.ende) {
    const f = l.feld();
    je(f.nr, f);
  }
}

const u32 = (f: { zahl?: number }): number => {
  if (f.zahl === undefined || f.zahl > 0xffffffff) throw new Kaputt();
  return f.zahl;
};
const roh = (f: { bytes?: Uint8Array }): Uint8Array => {
  if (!f.bytes) throw new Kaputt();
  return f.bytes;
};
const f32 = (f: { bytes?: Uint8Array }): number => {
  const b = roh(f);
  if (b.length !== 4) throw new Kaputt();
  return (b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24)) >>> 0;
};

function lesePaket(b: Uint8Array): VomGeraet {
  let von = 0, an = 0, kanal = 0;
  let inhalt: { port: number; nutzlast: Uint8Array } | null = null;
  felder(b, (nr, f) => {
    if (nr === 1) von = f32(f);
    else if (nr === 2) an = f32(f);
    else if (nr === 3) kanal = u32(f);
    else if (nr === 5) inhalt = null; // verschlüsselt: das Gerät kennt den Kanal nicht
    else if (nr === 4) {
      let port = 0, nutzlast: Uint8Array = new Uint8Array(0);
      felder(roh(f), (dn, df) => {
        if (dn === 1) port = u32(df);
        else if (dn === 2) nutzlast = roh(df);
      });
      inhalt = { port, nutzlast };
    }
  });
  const i = inhalt as { port: number; nutzlast: Uint8Array } | null;
  return i ? { art: "paket", von, an, kanal, port: i.port, nutzlast: Uint8Array.from(i.nutzlast) } : { art: "anderes" };
}

function leseKonfig(b: Uint8Array): VomGeraet {
  let lora: VomGeraet = { art: "anderes" };
  felder(b, (nr, f) => {
    if (nr !== 6) {
      lora = { art: "anderes" };
      return;
    }
    const l = { art: "lora" as const, region: 0, hopLimit: 0, senden: false, preset: 0, vorgabe: false };
    felder(roh(f), (ln, lf) => {
      if (ln === 1) l.vorgabe = u32(lf) !== 0;
      else if (ln === 2) l.preset = u32(lf);
      else if (ln === 7) l.region = u32(lf);
      else if (ln === 8) l.hopLimit = u32(lf);
      else if (ln === 9) l.senden = u32(lf) !== 0;
    });
    lora = l;
  });
  return lora;
}

function leseKanal(b: Uint8Array): VomGeraet {
  const k = { art: "kanal" as const, index: 0, name: "", psk: new Uint8Array(0), rolle: 0 };
  felder(b, (nr, f) => {
    if (nr === 1) k.index = u32(f);
    else if (nr === 3) k.rolle = u32(f);
    else if (nr === 2) {
      felder(roh(f), (sn, sf) => {
        if (sn === 2) k.psk = Uint8Array.from(roh(sf));
        else if (sn === 3) k.name = new TextDecoder().decode(roh(sf));
      });
    }
  });
  if (k.index > 7) throw new Kaputt(); // Meshtastic kennt acht Kanäle
  return k;
}

/** Eine Nachricht des Geräts (`FromRadio`); null, wenn sie kaputt ist. */
export function leseVomGeraet(b: Uint8Array): VomGeraet | null {
  try {
    let ergebnis: VomGeraet = { art: "anderes" };
    felder(b, (nr, f) => {
      if (nr === 1) return; // laufende Nummer der Nachricht
      if (nr === 2) ergebnis = lesePaket(roh(f));
      else if (nr === 3) {
        let knoten = 0;
        felder(roh(f), (mn, mf) => { if (mn === 1) knoten = u32(mf); });
        ergebnis = { art: "ich", knoten };
      } else if (nr === 5) ergebnis = leseKonfig(roh(f));
      else if (nr === 7) ergebnis = { art: "fertig", id: u32(f) };
      else if (nr === 8) ergebnis = u32(f) ? { art: "neustart" } : { art: "anderes" };
      else if (nr === 10) ergebnis = leseKanal(roh(f));
      else if (nr === 11) {
        const w = { art: "warteschlange" as const, frei: 0, max: 0 };
        felder(roh(f), (qn, qf) => {
          if (qn === 2) w.frei = u32(qf);
          else if (qn === 3) w.max = u32(qf);
        });
        ergebnis = w;
      } else ergebnis = { art: "anderes" };
    });
    return ergebnis;
  } catch (e) {
    if (e instanceof Kaputt) return null;
    throw e;
  }
}

// --- Sendezeit (7.5b) ---

/**
 * Funkparameter der Presets (Bandbreite kHz, Spreizfaktor, Coding-Rate 4/x) wie
 * `modemPresetToParams()` der Firmware (`MeshRadio.h`); Unbekanntes gilt dort als
 * LongFast. Breitband (2,4 GHz) ist schneller – die Zahlen hier rechnen dann zu viel.
 */
const PRESETS: Record<number, [number, number, number]> = {
  0: [250, 11, 5], // LONG_FAST
  1: [125, 12, 8], // LONG_SLOW
  3: [250, 10, 5], // MEDIUM_SLOW
  4: [250, 9, 5], // MEDIUM_FAST
  5: [250, 8, 5], // SHORT_SLOW
  6: [250, 7, 5], // SHORT_FAST
  7: [125, 11, 8], // LONG_MODERATE
  8: [500, 7, 5], // SHORT_TURBO
  9: [500, 11, 8], // LONG_TURBO
  10: [125, 9, 5], // LITE_FAST
  11: [125, 10, 5], // LITE_SLOW
  12: [62.5, 7, 6], // NARROW_FAST
  13: [62.5, 8, 6], // NARROW_SLOW
  16: [500, 9, 5], // MEDIUM_TURBO
};
/** Kopf jedes Meshtastic-Pakets in der Luft (`MESHTASTIC_HEADER_LENGTH`). */
const MESHTASTIC_KOPF = 16;
/** Präambel der Firmware in Symbolen (`preambleLength`). */
const PRAEAMBEL = 16;

/**
 * Sendezeit eines Pakets mit `nutzlast` Byte in Sekunden – Formel von Semtech
 * (explizite Kopfzeile, CRC an), dazu der Meshtastic-Kopf und die Hülle der
 * Daten (Port, Längenangabe, Bitfeld der Firmware). Eigene Funkparameter
 * (`vorgabe` aus) kennt die App nicht: dann so langsam wie LongSlow.
 */
export function meshtasticSendezeit(e: { preset: number; vorgabe: boolean }, nutzlast: number): number {
  const [bw, sf, cr] = (e.vorgabe ? PRESETS[e.preset] : undefined) ?? (e.vorgabe ? PRESETS[0]! : PRESETS[1]!);
  const daten = 3 + 1 + (nutzlast > 127 ? 2 : 1) + nutzlast + 2;
  const laenge = MESHTASTIC_KOPF + daten;
  const symbol = 2 ** sf / (bw * 1000);
  const de = symbol > 0.016 ? 1 : 0;
  const symbole = 8 + Math.max(Math.ceil((8 * laenge - 4 * sf + 28 + 16) / (4 * (sf - 2 * de))) * cr, 0);
  return (PRAEAMBEL + 4.25) * symbol + symbole * symbol;
}
