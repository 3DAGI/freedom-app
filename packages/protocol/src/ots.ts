/**
 * OpenTimestamps (Schritt 5.10b, Sammlung B-17) – der Kettenanker, den
 * `timestamps.ts` als dritte Stufe vorsieht: Beweise lesen, schreiben,
 * bündeln und bis zu ihren Attestierungen nachrechnen.
 *
 * Format wie python-opentimestamps (Detached Timestamp File, Version 1),
 * ohne neue Abhängigkeit; Hashes aus `@noble/hashes`. Die Testvektoren in
 * `test/fixtures/ots-referenz.json` stammen aus echten Kalender-Antworten und
 * sind mit der Referenz nachgerechnet (`scripts/ots-referenz.py`).
 *
 * Was ein Beweis belegt: Die Nachricht existierte, bevor der genannte
 * Bitcoin-Block entstand – aber nur, wenn der Endwert der Merkle-Wurzel jenes
 * Blocks gleicht. Das prüft hier niemand; dafür braucht es den Blockkopf.
 * Eine ausstehende Attestierung ist nur das Versprechen eines Kalenders.
 *
 * Fremde Beweise sind Fremddaten: gelesen nur mit den Grenzen aus
 * `OTS_GRENZEN`, Fehler nur als Kennung (`OtsFehler`), nie mit Text daraus.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { ripemd160, sha1 } from "@noble/hashes/legacy.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export const OTS_GRENZEN = {
  /** Länge einer Nachricht und eines Arguments (wie die Referenz). */
  nachricht: 4096,
  /** Verschachtelung des Baums (wie die Referenz). */
  tiefe: 256,
  /** Knoten im ganzen Beweis – gegen aufgeblähte Bäume. */
  knoten: 4096,
  /** Größe eines Beweises in Bytes. */
  bytes: 65536,
  /** Nutzlast einer Attestierung, Länge einer Kalender-Adresse. */
  nutzlast: 8192,
  uri: 1000,
} as const;

export type OtsOp =
  | { art: "sha256" | "sha1" | "ripemd160" | "keccak256" | "reverse" | "hexlify" }
  | { art: "append" | "prepend"; arg: Uint8Array };

export type OtsAttestierung =
  | { art: "bitcoin"; hoehe: number }
  | { art: "ausstehend"; kalender: string }
  | { art: "unbekannt"; tag: Uint8Array; nutzlast: Uint8Array };

export interface OtsZeitstempel {
  nachricht: Uint8Array;
  attestierungen: OtsAttestierung[];
  zweige: { op: OtsOp; weiter: OtsZeitstempel }[];
}

/** Beweis für einen SHA-256-Wert (eine Event-Kennung ist einer). */
export interface OtsDatei {
  digest: Uint8Array;
  zeitstempel: OtsZeitstempel;
}

export class OtsFehler extends Error {
  constructor(readonly kennung: string) {
    super(`OpenTimestamps: ${kennung}`);
  }
}

const MAGIE = Uint8Array.from([0x00, ...new TextEncoder().encode("OpenTimestamps"), 0x00, 0x00, ...new TextEncoder().encode("Proof"), 0x00, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94]);
const TAG_BITCOIN = Uint8Array.from([0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01]);
const TAG_AUSSTEHEND = Uint8Array.from([0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e]);
const URI_ZEICHEN = /^[A-Za-z0-9\-._/:]+$/;
const UNAER: Record<number, OtsOp["art"]> = { 0x02: "sha1", 0x03: "ripemd160", 0x08: "sha256", 0x67: "keccak256", 0xf2: "reverse", 0xf3: "hexlify" };
const BINAER: Record<number, OtsOp["art"]> = { 0xf0: "append", 0xf1: "prepend" };
const OP_TAG: Record<OtsOp["art"], number> = { sha1: 0x02, ripemd160: 0x03, sha256: 0x08, keccak256: 0x67, reverse: 0xf2, hexlify: 0xf3, append: 0xf0, prepend: 0xf1 };

function verbinde(...teile: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(teile.reduce((n, t) => n + t.length, 0));
  let i = 0;
  for (const t of teile) { out.set(t, i); i += t.length; }
  return out;
}
function vergleiche(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}
const gleich = (a: Uint8Array, b: Uint8Array) => vergleiche(a, b) === 0;

/** Eine Operation auf eine Nachricht anwenden (mit den Grenzen der Referenz). */
export function wendeAn(op: OtsOp, msg: Uint8Array): Uint8Array {
  if (msg.length === 0 || msg.length > OTS_GRENZEN.nachricht) throw new OtsFehler("nachricht-laenge");
  let r: Uint8Array;
  switch (op.art) {
    case "append": r = verbinde(msg, op.arg); break;
    case "prepend": r = verbinde(op.arg, msg); break;
    case "sha256": r = sha256(msg); break;
    case "sha1": r = sha1(msg); break;
    case "ripemd160": r = ripemd160(msg); break;
    case "keccak256": r = keccak_256(msg); break;
    case "reverse": r = Uint8Array.from(msg).reverse(); break;
    case "hexlify":
      if (msg.length > OTS_GRENZEN.nachricht / 2) throw new OtsFehler("nachricht-laenge");
      r = new TextEncoder().encode(bytesToHex(msg)); break;
  }
  if (r.length > OTS_GRENZEN.nachricht) throw new OtsFehler("ergebnis-laenge");
  return r;
}

class Leser {
  pos = 0;
  knoten = 0;
  constructor(readonly b: Uint8Array) {}
  byte(): number { if (this.pos >= this.b.length) throw new OtsFehler("zu-kurz"); return this.b[this.pos++]!; }
  bytes(n: number): Uint8Array { if (this.pos + n > this.b.length) throw new OtsFehler("zu-kurz"); const r = this.b.slice(this.pos, this.pos + n); this.pos += n; return r; }
  varuint(): number {
    let wert = 0, faktor = 1;
    for (;;) {
      const b = this.byte();
      wert += (b & 0x7f) * faktor;
      if (!(b & 0x80)) break;
      faktor *= 128;
      if (faktor > 2 ** 49) throw new OtsFehler("zahl-zu-gross");
    }
    return wert;
  }
  varbytes(max: number, min = 0): Uint8Array {
    const n = this.varuint();
    if (n > max || n < min) throw new OtsFehler("laenge");
    return this.bytes(n);
  }
  ende(): void { if (this.pos !== this.b.length) throw new OtsFehler("rest"); }
}
function varuint(n: number): Uint8Array {
  const out: number[] = [];
  do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 0x80; out.push(b); } while (n > 0);
  return Uint8Array.from(out);
}
const varbytes = (b: Uint8Array) => verbinde(varuint(b.length), b);

function leseAttestierung(l: Leser): OtsAttestierung {
  const tag = l.bytes(8);
  const nutzlast = l.varbytes(OTS_GRENZEN.nutzlast);
  const p = new Leser(nutzlast);
  if (gleich(tag, TAG_BITCOIN)) { const hoehe = p.varuint(); p.ende(); return { art: "bitcoin", hoehe }; }
  if (gleich(tag, TAG_AUSSTEHEND)) {
    const kalender = new TextDecoder().decode(p.varbytes(OTS_GRENZEN.uri));
    p.ende();
    if (!URI_ZEICHEN.test(kalender)) throw new OtsFehler("kalender-adresse");
    return { art: "ausstehend", kalender };
  }
  return { art: "unbekannt", tag, nutzlast };
}
function schreibeAttestierung(a: OtsAttestierung): Uint8Array {
  if (a.art === "bitcoin") return verbinde(TAG_BITCOIN, varbytes(varuint(a.hoehe)));
  if (a.art === "ausstehend") return verbinde(TAG_AUSSTEHEND, varbytes(varbytes(new TextEncoder().encode(a.kalender))));
  return verbinde(a.tag, varbytes(a.nutzlast));
}
// Reihenfolge wie die Referenz: nach Tag, innerhalb einer Art nach Höhe, Adresse bzw. Nutzlast
function attestierungsTag(a: OtsAttestierung): Uint8Array { return a.art === "bitcoin" ? TAG_BITCOIN : a.art === "ausstehend" ? TAG_AUSSTEHEND : a.tag; }
function vergleicheAttestierung(a: OtsAttestierung, b: OtsAttestierung): number {
  const t = vergleiche(attestierungsTag(a), attestierungsTag(b));
  if (t !== 0) return t;
  if (a.art === "bitcoin" && b.art === "bitcoin") return a.hoehe - b.hoehe;
  if (a.art === "ausstehend" && b.art === "ausstehend") return a.kalender < b.kalender ? -1 : a.kalender > b.kalender ? 1 : 0;
  if (a.art === "unbekannt" && b.art === "unbekannt") return vergleiche(a.nutzlast, b.nutzlast);
  return 0;
}
function vergleicheOp(a: OtsOp, b: OtsOp): number {
  const t = OP_TAG[a.art] - OP_TAG[b.art];
  if (t !== 0 || !("arg" in a) || !("arg" in b)) return t;
  return vergleiche(a.arg, b.arg);
}

function leseKnoten(l: Leser, nachricht: Uint8Array, tiefe: number): OtsZeitstempel {
  if (tiefe > OTS_GRENZEN.tiefe) throw new OtsFehler("zu-tief");
  if (++l.knoten > OTS_GRENZEN.knoten) throw new OtsFehler("zu-viele-knoten");
  const z: OtsZeitstempel = { nachricht, attestierungen: [], zweige: [] };
  const eintrag = (tag: number) => {
    if (tag === 0x00) { z.attestierungen.push(leseAttestierung(l)); return; }
    let op: OtsOp;
    if (UNAER[tag]) op = { art: UNAER[tag] } as OtsOp;
    else if (BINAER[tag]) op = { art: BINAER[tag] as "append" | "prepend", arg: l.varbytes(OTS_GRENZEN.nachricht, 1) };
    else throw new OtsFehler("unbekannte-operation");
    z.zweige.push({ op, weiter: leseKnoten(l, wendeAn(op, nachricht), tiefe + 1) });
  };
  let tag = l.byte();
  while (tag === 0xff) { eintrag(l.byte()); tag = l.byte(); }
  eintrag(tag);
  return z;
}
function schreibeKnoten(z: OtsZeitstempel): Uint8Array {
  const atts = [...z.attestierungen].sort(vergleicheAttestierung);
  const ops = [...z.zweige].sort((a, b) => vergleicheOp(a.op, b.op));
  if (atts.length === 0 && ops.length === 0) throw new OtsFehler("leerer-zeitstempel");
  const teile: Uint8Array[] = [];
  atts.forEach((a, i) => {
    const letzte = i === atts.length - 1 && ops.length === 0;
    teile.push(letzte ? Uint8Array.of(0x00) : Uint8Array.of(0xff, 0x00), schreibeAttestierung(a));
  });
  ops.forEach((z2, i) => {
    if (i < ops.length - 1) teile.push(Uint8Array.of(0xff));
    teile.push(Uint8Array.of(OP_TAG[z2.op.art]));
    if ("arg" in z2.op) teile.push(varbytes(z2.op.arg));
    teile.push(schreibeKnoten(z2.weiter));
  });
  return verbinde(...teile);
}

/** Einen Zeitstempel (z. B. die Antwort eines Kalenders) zu einer Nachricht lesen. */
export function leseOtsZeitstempel(bytes: Uint8Array, nachricht: Uint8Array): OtsZeitstempel {
  if (bytes.length > OTS_GRENZEN.bytes) throw new OtsFehler("zu-gross");
  const l = new Leser(bytes);
  const z = leseKnoten(l, nachricht, 0);
  l.ende();
  return z;
}
export const schreibeOtsZeitstempel = (z: OtsZeitstempel): Uint8Array => schreibeKnoten(z);

/** Eine `.ots`-Datei lesen – nur für SHA-256-Werte (Event-Kennungen). */
export function leseOtsDatei(bytes: Uint8Array): OtsDatei {
  if (bytes.length > OTS_GRENZEN.bytes) throw new OtsFehler("zu-gross");
  const l = new Leser(bytes);
  if (!gleich(l.bytes(MAGIE.length), MAGIE)) throw new OtsFehler("keine-ots-datei");
  if (l.varuint() !== 1) throw new OtsFehler("version");
  if (l.byte() !== OP_TAG.sha256) throw new OtsFehler("nur-sha256");
  const digest = l.bytes(32);
  const zeitstempel = leseKnoten(l, digest, 0);
  l.ende();
  return { digest, zeitstempel };
}
export function schreibeOtsDatei(d: OtsDatei): Uint8Array {
  if (d.digest.length !== 32) throw new OtsFehler("nur-sha256");
  return verbinde(MAGIE, varuint(1), Uint8Array.of(OP_TAG.sha256), d.digest, schreibeKnoten(d.zeitstempel));
}

/** Alle Attestierungen mit dem Wert, den sie bestätigen (für Bitcoin: die erwartete Merkle-Wurzel). */
export function attestierungenVon(z: OtsZeitstempel): { nachricht: Uint8Array; attestierung: OtsAttestierung }[] {
  const out: { nachricht: Uint8Array; attestierung: OtsAttestierung }[] = [];
  const geh = (k: OtsZeitstempel) => { for (const a of k.attestierungen) out.push({ nachricht: k.nachricht, attestierung: a }); for (const z2 of k.zweige) geh(z2.weiter); };
  geh(z);
  return out;
}

/**
 * Mehrere SHA-256-Werte in einen Stempel bündeln – wie der ots-Client: an
 * jeden Wert eine Zufallszahl hängen (der Kalender lernt so keinen Wert),
 * dann ein Merkle-Baum. Zurück kommen die Spitze, die an die Kalender geht,
 * und je Wert eine Datei, die sich die Knoten des Baums teilt – was später an
 * der Spitze ankommt (`fuegeEin()`), steht damit in jeder Datei.
 */
export function buendele(digests: Uint8Array[], nonce: () => Uint8Array): { spitze: OtsZeitstempel; dateien: OtsDatei[] } {
  if (digests.length === 0) throw new OtsFehler("leeres-buendel");
  const knoten = (nachricht: Uint8Array): OtsZeitstempel => ({ nachricht, attestierungen: [], zweige: [] });
  const weiter = (z: OtsZeitstempel, op: OtsOp) => { const w = knoten(wendeAn(op, z.nachricht)); z.zweige.push({ op, weiter: w }); return w; };
  const dateien: OtsDatei[] = [];
  let ebene = digests.map((d) => {
    if (d.length !== 32) throw new OtsFehler("nur-sha256");
    const z = knoten(Uint8Array.from(d));
    dateien.push({ digest: Uint8Array.from(d), zeitstempel: z });
    const n = nonce();
    if (n.length !== 16) throw new OtsFehler("nonce");
    return weiter(weiter(z, { art: "append", arg: n }), { art: "sha256" });
  });
  while (ebene.length > 1) {
    const naechste: OtsZeitstempel[] = [];
    for (let i = 0; i + 1 < ebene.length; i += 2) {
      const l = ebene[i]!, r = ebene[i + 1]!;
      const verkettet = knoten(verbinde(l.nachricht, r.nachricht));
      l.zweige.push({ op: { art: "append", arg: r.nachricht }, weiter: verkettet });
      r.zweige.push({ op: { art: "prepend", arg: l.nachricht }, weiter: verkettet });
      naechste.push(weiter(verkettet, { art: "sha256" }));
    }
    if (ebene.length % 2 === 1) naechste.push(ebene[ebene.length - 1]!);
    ebene = naechste;
  }
  return { spitze: ebene[0]!, dateien };
}

/** Eine Antwort (gleiche Nachricht) in einen vorhandenen Knoten übernehmen; gleiche Zweige werden zusammengeführt. */
export function fuegeEin(ziel: OtsZeitstempel, quelle: OtsZeitstempel): void {
  if (!gleich(ziel.nachricht, quelle.nachricht)) throw new OtsFehler("andere-nachricht");
  for (const a of quelle.attestierungen) if (!ziel.attestierungen.some((b) => vergleicheAttestierung(a, b) === 0 && a.art === b.art)) ziel.attestierungen.push(a);
  for (const z of quelle.zweige) {
    const da = ziel.zweige.find((y) => vergleicheOp(y.op, z.op) === 0);
    if (da) fuegeEin(da.weiter, z.weiter); else ziel.zweige.push(z);
  }
}
