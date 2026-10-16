/**
 * Negentropy, Fassung 1 (Schritt B-35a, NIP-77; Entscheidung NG1 B: eigene
 * Umsetzung, Vektoren aus der Referenz `hoytech/negentropy`): zwei Seiten finden
 * mit wenig Daten heraus, welche Events der anderen fehlen – nach einer Zeit ohne
 * Netz, zwischen dem eigenen Relay und anderen, über ein Funk-Gateway.
 *
 * Verfahren wie die Referenz, Byte für Byte (`test/fixtures/negentropy-referenz.json`,
 * erzeugt mit `scripts/negentropy-referenz.mjs`): Einträge (Zeit, Id) sortiert,
 * Bereiche mit oberer Grenze (Zeit als Abstand, kürzester Id-Präfix), je Bereich
 * Überspringen, Fingerabdruck (SHA-256 über die Summe der Ids mod 2^256 und die
 * Anzahl, 16 Byte) oder die Liste der Ids; ab 32 Einträgen 16 Teile.
 *
 * Nachrichten kommen von Fremden: Längen, Zahlen und Ids sind begrenzt, alles
 * Unpassende bricht mit `NegFehler` ab – nie mit Text aus der Nachricht.
 */
import { sha256 } from "@noble/hashes/sha2.js";

export const NEG_FASSUNG = 0x61;
const ID = 32, FINGERABDRUCK = 16, TEILE = 16;
const UEBERSPRINGEN = 0, ABDRUCK = 1, IDLISTE = 2;

export const NEG_GRENZEN = {
  /** Kleinste erlaubte Rahmengröße (wie die Referenz); 0 heißt ohne Grenze. */
  rahmenMin: 4096,
  /** Eine Nachricht von außen höchstens so groß (Bytes) … */
  nachricht: 512 * 1024,
  /** … mit höchstens so vielen Ids in einer Liste. */
  ids: 100_000,
} as const;

export type NegFall = "neg.format" | "neg.fassung" | "neg.gross" | "neg.reihenfolge";

/** Fehler im Abgleich – `fall` ist die Kennung, nie Text aus der Nachricht. */
export class NegFehler extends Error {
  constructor(readonly fall: NegFall) {
    super(fall);
    this.name = "NegFehler";
  }
}

interface NegEintrag { zeit: number; id: Uint8Array }
interface Grenze { zeit: number; id: Uint8Array }
const UNENDLICH = Number.POSITIVE_INFINITY;

function vergleicheBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}
const negVergleich = (a: Grenze, b: Grenze): number => (a.zeit === b.zeit ? vergleicheBytes(a.id, b.id) : a.zeit < b.zeit ? -1 : 1);

function hexZuBytes(hex: string, laenge?: number): Uint8Array {
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(hex) || (laenge !== undefined && hex.length !== laenge * 2)) throw new NegFehler("neg.format");
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return b;
}
const bytesZuHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** Die Einträge einer Seite – erst sammeln, dann `versiegeln()` (sortiert, doppelte verboten). */
export class NegSpeicher {
  private eintraege: NegEintrag[] = [];
  private zu = false;

  einfuegen(zeit: number, idHex: string): void {
    if (this.zu) throw new Error("Speicher versiegelt");
    if (!Number.isSafeInteger(zeit) || zeit < 0) throw new NegFehler("neg.format");
    this.eintraege.push({ zeit, id: hexZuBytes(idHex, ID) });
  }

  versiegeln(): this {
    this.eintraege.sort(negVergleich);
    for (let i = 1; i < this.eintraege.length; i++) if (negVergleich(this.eintraege[i - 1]!, this.eintraege[i]!) === 0) throw new NegFehler("neg.format");
    this.zu = true;
    return this;
  }

  get groesse(): number {
    return this.eintraege.length;
  }

  eintrag(i: number): NegEintrag {
    return this.eintraege[i]!;
  }

  /** Erster Index ab `von`, dessen NegEintrag nicht kleiner als `g` ist. */
  untereGrenze(von: number, bis: number, g: Grenze): number {
    while (von < bis) {
      const mitte = (von + bis) >>> 1;
      if (negVergleich(this.eintraege[mitte]!, g) < 0) von = mitte + 1;
      else bis = mitte;
    }
    return von;
  }

  /** Fingerabdruck der Einträge `[von, bis)`: SHA-256 über die Summe der Ids (mod 2^256, little-endian) und die Anzahl. */
  fingerabdruck(von: number, bis: number): Uint8Array {
    const summe = new Uint8Array(ID);
    for (let i = von; i < bis; i++) {
      const id = this.eintraege[i]!.id;
      let uebertrag = 0;
      for (let j = 0; j < ID; j++) {
        const s = summe[j]! + id[j]! + uebertrag;
        summe[j] = s & 0xff;
        uebertrag = s >> 8;
      }
    }
    const anzahl = zahlBytes(bis - von);
    const daten = new Uint8Array(ID + anzahl.length);
    daten.set(summe);
    daten.set(anzahl, ID);
    return sha256(daten).subarray(0, FINGERABDRUCK);
  }
}

/** Zahl als Varint: Basis 128, höchste Stelle zuerst, Folgebit in allen außer dem letzten Byte. */
function zahlBytes(n: number): Uint8Array {
  const stellen: number[] = [];
  do {
    stellen.unshift(n % 128);
    n = Math.floor(n / 128);
  } while (n > 0);
  return Uint8Array.from(stellen, (s, i) => (i < stellen.length - 1 ? s | 0x80 : s));
}

class NegLeser {
  private pos = 0;
  constructor(private daten: Uint8Array) {}
  get rest(): number {
    return this.daten.length - this.pos;
  }
  byte(): number {
    if (this.pos >= this.daten.length) throw new NegFehler("neg.format");
    return this.daten[this.pos++]!;
  }
  bytes(n: number): Uint8Array {
    if (this.rest < n) throw new NegFehler("neg.format");
    return this.daten.subarray(this.pos, (this.pos += n));
  }
  /** Varint bis 2^53 – längere sind Unfug. */
  zahl(): number {
    let n = 0;
    for (let i = 0; i < 8; i++) {
      const b = this.byte();
      n = n * 128 + (b & 0x7f);
      if (!(b & 0x80)) return n;
    }
    throw new NegFehler("neg.format");
  }
}

class NegSchreiber {
  private teile: Uint8Array[] = [];
  laenge = 0;
  dazu(b: Uint8Array | number[]): this {
    const u = b instanceof Uint8Array ? b : Uint8Array.from(b);
    this.teile.push(u);
    this.laenge += u.length;
    return this;
  }
  zahl(n: number): this {
    return this.dazu(zahlBytes(n));
  }
  bytes(): Uint8Array {
    const aus = new Uint8Array(this.laenge);
    let o = 0;
    for (const t of this.teile) { aus.set(t, o); o += t.length; }
    return aus;
  }
}

/**
 * Eine Seite des Abgleichs. Wer beginnt (`beginne()`), sammelt, was er hat und
 * was ihm fehlt; die andere Seite (`istBeginner` falsch) antwortet nur.
 */
export class Negentropy {
  private beginner = false;
  private zeitEin = 0;
  private zeitAus = 0;

  constructor(private speicher: NegSpeicher, private rahmen = 0) {
    if (rahmen !== 0 && rahmen < NEG_GRENZEN.rahmenMin) throw new Error("Rahmen zu klein");
  }

  /** Erste Nachricht (hex) – nur die beginnende Seite. */
  beginne(): string {
    if (this.beginner) throw new NegFehler("neg.reihenfolge");
    this.beginner = true;
    const aus = new NegSchreiber().dazu([NEG_FASSUNG]);
    this.zeitAus = 0;
    this.teile(0, this.speicher.groesse, { zeit: UNENDLICH, id: new Uint8Array(0) }, aus);
    return bytesZuHex(aus.bytes());
  }

  /**
   * Eine Nachricht der anderen Seite (hex) beantworten. `antwort` ist `null`,
   * wenn die beginnende Seite fertig ist; `habe` und `brauche` (Ids) sammelt nur sie.
   */
  abgleich(nachrichtHex: string): { antwort: string | null; habe: string[]; brauche: string[] } {
    if (nachrichtHex.length > NEG_GRENZEN.nachricht * 2) throw new NegFehler("neg.gross");
    const ein = new NegLeser(hexZuBytes(nachrichtHex));
    const habe: string[] = [], brauche: string[] = [];
    this.zeitEin = this.zeitAus = 0;
    const aus = new NegSchreiber().dazu([NEG_FASSUNG]);
    const fassung = ein.byte();
    if (fassung < 0x60 || fassung > 0x6f) throw new NegFehler("neg.format");
    if (fassung !== NEG_FASSUNG) {
      // die antwortende Seite nennt ihre Fassung, die beginnende kann nichts tun
      if (this.beginner) throw new NegFehler("neg.fassung");
      return { antwort: bytesZuHex(aus.bytes()), habe, brauche };
    }
    const n = this.speicher.groesse;
    let vorherGrenze: Grenze = { zeit: 0, id: new Uint8Array(0) };
    let vorherIndex = 0;
    let ueberspringen = false;
    while (ein.rest > 0) {
      let o = new NegSchreiber();
      const nachholen = () => {
        if (!ueberspringen) return;
        ueberspringen = false;
        o.dazu(this.grenzeBytes(vorherGrenze)).zahl(UEBERSPRINGEN);
      };
      const grenze = this.leseGrenze(ein);
      const art = ein.zahl();
      const unten = vorherIndex;
      let oben = this.speicher.untereGrenze(vorherIndex, n, grenze);
      if (art === UEBERSPRINGEN) ueberspringen = true;
      else if (art === ABDRUCK) {
        const ihrer = ein.bytes(FINGERABDRUCK);
        if (vergleicheBytes(ihrer, this.speicher.fingerabdruck(unten, oben)) !== 0) {
          nachholen();
          this.teile(unten, oben, grenze, o);
        } else ueberspringen = true;
      } else if (art === IDLISTE) {
        const anzahl = ein.zahl();
        if (anzahl > NEG_GRENZEN.ids || anzahl * ID > ein.rest) throw new NegFehler("neg.gross");
        const ihre = new Set<string>();
        for (let i = 0; i < anzahl; i++) ihre.add(bytesZuHex(ein.bytes(ID)));
        if (this.beginner) {
          ueberspringen = true;
          for (let i = unten; i < oben; i++) {
            const id = bytesZuHex(this.speicher.eintrag(i).id);
            if (!ihre.delete(id)) habe.push(id);
          }
          brauche.push(...ihre);
        } else {
          nachholen();
          const ids = new NegSchreiber();
          let zahl = 0;
          let ende: Grenze = grenze;
          for (let i = unten; i < oben; i++) {
            if (this.zuGross(aus.laenge + ids.laenge)) {
              ende = this.speicher.eintrag(i);
              oben = i;
              break;
            }
            ids.dazu(this.speicher.eintrag(i).id);
            zahl++;
          }
          o.dazu(this.grenzeBytes(ende)).zahl(IDLISTE).zahl(zahl).dazu(ids.bytes());
          aus.dazu(o.bytes());
          o = new NegSchreiber();
        }
      } else throw new NegFehler("neg.format");
      if (this.zuGross(aus.laenge + o.laenge)) {
        // Rahmen voll: für den Rest nur ein Fingerabdruck, die andere Seite fragt weiter
        aus.dazu(this.grenzeBytes({ zeit: UNENDLICH, id: new Uint8Array(0) })).zahl(ABDRUCK).dazu(this.speicher.fingerabdruck(oben, n));
        break;
      }
      aus.dazu(o.bytes());
      vorherIndex = oben;
      vorherGrenze = grenze;
    }
    return { antwort: aus.laenge === 1 && this.beginner ? null : bytesZuHex(aus.bytes()), habe, brauche };
  }

  private zuGross(n: number): boolean {
    return this.rahmen !== 0 && n > this.rahmen - 200;
  }

  private teile(unten: number, oben: number, obereGrenze: Grenze, o: NegSchreiber): void {
    const anzahl = oben - unten;
    if (anzahl < TEILE * 2) {
      o.dazu(this.grenzeBytes(obereGrenze)).zahl(IDLISTE).zahl(anzahl);
      for (let i = unten; i < oben; i++) o.dazu(this.speicher.eintrag(i).id);
      return;
    }
    const je = Math.floor(anzahl / TEILE), mitMehr = anzahl % TEILE;
    let jetzt = unten;
    for (let i = 0; i < TEILE; i++) {
      const groesse = je + (i < mitMehr ? 1 : 0);
      const abdruck = this.speicher.fingerabdruck(jetzt, jetzt + groesse);
      jetzt += groesse;
      const naechste = jetzt === oben ? obereGrenze : this.kuerzesteGrenze(this.speicher.eintrag(jetzt - 1), this.speicher.eintrag(jetzt));
      o.dazu(this.grenzeBytes(naechste)).zahl(ABDRUCK).dazu(abdruck);
    }
  }

  /** Die kürzeste Grenze zwischen zwei benachbarten Einträgen: die Zeit, bei gleicher Zeit der kürzeste trennende Id-Präfix. */
  private kuerzesteGrenze(vorher: NegEintrag, jetzt: NegEintrag): Grenze {
    if (jetzt.zeit !== vorher.zeit) return { zeit: jetzt.zeit, id: new Uint8Array(0) };
    let gemeinsam = 0;
    while (gemeinsam < ID && jetzt.id[gemeinsam] === vorher.id[gemeinsam]) gemeinsam++;
    return { zeit: jetzt.zeit, id: jetzt.id.subarray(0, gemeinsam + 1) };
  }

  private grenzeBytes(g: Grenze): Uint8Array {
    const s = new NegSchreiber();
    if (g.zeit === UNENDLICH) {
      this.zeitAus = UNENDLICH;
      s.zahl(0);
    } else {
      const abstand = g.zeit - this.zeitAus;
      this.zeitAus = g.zeit;
      s.zahl(abstand + 1);
    }
    return s.zahl(g.id.length).dazu(g.id).bytes();
  }

  private leseGrenze(ein: NegLeser): Grenze {
    const roh = ein.zahl();
    let zeit: number;
    if (roh === 0 || this.zeitEin === UNENDLICH) zeit = this.zeitEin = UNENDLICH;
    else {
      zeit = this.zeitEin + roh - 1;
      if (!Number.isSafeInteger(zeit)) throw new NegFehler("neg.format");
      this.zeitEin = zeit;
    }
    const laenge = ein.zahl();
    if (laenge > ID) throw new NegFehler("neg.format");
    return { zeit, id: ein.bytes(laenge) };
  }
}
