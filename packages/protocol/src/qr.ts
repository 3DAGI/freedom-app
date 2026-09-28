/**
 * QR-Codes ohne Abhängigkeit (Schritt 11.1a) – nach ISO/IEC 18004.
 *
 * - Nur Byte-Modus (UTF-8): Gerätecodes und Werbelinks sind Text mit
 *   Kleinbuchstaben; die anderen Modi sparten dort nichts.
 * - Fehlerkorrektur L, M, Q oder H (Standard M), Version 1–40 – die kleinste,
 *   in die die Daten passen.
 * - Maske mit den wenigsten Strafpunkten (Regeln 1–4 der Norm), bewertet am
 *   fertigen Symbol samt Formatbits; die Ruhezone zählt als hell. Jede Maske
 *   ist lesbar – die Wahl macht es Scannern nur leichter.
 *
 * Ergebnis ist die Modul-Matrix; `qrSvgPfad()` macht daraus die Pfaddaten
 * eines SVG (`setAttribute("d", …)`, kein `innerHTML`). Getestet gegen Codes
 * aus python-qrcode (`test/qr.test.ts`).
 */
import { ProtokollFehler } from "./fehler.js";

export type QrStufe = "L" | "M" | "Q" | "H";

export interface QrCode {
  version: number;
  stufe: QrStufe;
  maske: number;
  /** Kantenlänge in Modulen: 17 + 4 · Version. */
  groesse: number;
  /** `module[y][x]` – true heißt dunkel. */
  module: boolean[][];
}

const STUFEN: QrStufe[] = ["L", "M", "Q", "H"];
/** Format-Bits der Stufen (L = 01, M = 00, Q = 11, H = 10). */
const STUFE_BITS: Record<QrStufe, number> = { L: 1, M: 0, Q: 3, H: 2 };

// Tabelle 9 der Norm: Fehlerkorrektur-Bytes je Block und Zahl der Blöcke, je Stufe (L, M, Q, H) und Version (Index 1–40)
const EC_JE_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const BLOECKE = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

/** Zahl der Module für Daten und Fehlerkorrektur (ohne Funktionsmuster und Format). */
function rohModule(v: number): number {
  let n = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const a = Math.floor(v / 7) + 2;
    n -= (25 * a - 10) * a - 55;
    if (v >= 7) n -= 36;
  }
  return n;
}

const datenBytes = (v: number, s: number): number =>
  Math.floor(rohModule(v) / 8) - EC_JE_BLOCK[s]![v]! * BLOECKE[s]![v]!;

/** Wie viele Bytes passen in Version `v` bei Stufe `stufe` (Byte-Modus)? */
export function qrKapazitaet(v: number, stufe: QrStufe = "M"): number {
  const bits = datenBytes(v, STUFEN.indexOf(stufe)) * 8 - 4 - (v < 10 ? 8 : 16);
  return Math.floor(bits / 8);
}

// ------------------------------------------------------------ Reed-Solomon über GF(256), Polynom 0x11D

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
const mal = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!);

/** Generatorpolynom (x − α⁰)…(x − α^(n−1)), höchster Koeffizient (1) weggelassen. */
function generator(n: number): Uint8Array {
  const g = new Uint8Array(n);
  g[n - 1] = 1;
  for (let i = 0, wurzel = 1; i < n; i++) {
    for (let j = 0; j < n; j++) {
      g[j] = mal(g[j]!, wurzel) ^ (j + 1 < n ? g[j + 1]! : 0);
    }
    wurzel = mal(wurzel, 2);
  }
  return g;
}

function rest(daten: Uint8Array, g: Uint8Array): Uint8Array {
  const r = new Uint8Array(g.length);
  for (const b of daten) {
    const f = b ^ r[0]!;
    r.copyWithin(0, 1);
    r[r.length - 1] = 0;
    for (let i = 0; i < r.length; i++) r[i]! ^= mal(g[i]!, f);
  }
  return r;
}

// ------------------------------------------------------------ Bitstrom und Blöcke

function kodiere(daten: Uint8Array, v: number, s: number): Uint8Array {
  const bits: number[] = [];
  const schreib = (wert: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((wert >>> i) & 1); };
  schreib(0b0100, 4);
  schreib(daten.length, v < 10 ? 8 : 16);
  for (const b of daten) schreib(b, 8);
  const platz = datenBytes(v, s) * 8;
  schreib(0, Math.min(4, platz - bits.length));
  schreib(0, (8 - (bits.length % 8)) % 8);
  for (let fueller = 0xec; bits.length < platz; fueller ^= 0xec ^ 0x11) schreib(fueller, 8);
  const bytes = new Uint8Array(platz / 8);
  for (let i = 0; i < bits.length; i++) bytes[i >>> 3]! |= bits[i]! << (7 - (i & 7));

  // In Blöcke teilen, je Block Fehlerkorrektur, dann spaltenweise verschränken
  const anzahl = BLOECKE[s]![v]!;
  const ec = EC_JE_BLOCK[s]![v]!;
  const gesamt = Math.floor(rohModule(v) / 8);
  const kurze = anzahl - (gesamt % anzahl);
  const kurzLaenge = Math.floor(gesamt / anzahl) - ec;
  const g = generator(ec);
  const bloecke: Uint8Array[] = [];
  const fehler: Uint8Array[] = [];
  for (let i = 0, k = 0; i < anzahl; i++) {
    const l = kurzLaenge + (i < kurze ? 0 : 1);
    const b = bytes.subarray(k, k + l);
    k += l;
    bloecke.push(b);
    fehler.push(rest(b, g));
  }
  const aus: number[] = [];
  for (let i = 0; i <= kurzLaenge; i++) for (const b of bloecke) if (i < b.length) aus.push(b[i]!);
  for (let i = 0; i < ec; i++) for (const f of fehler) aus.push(f[i]!);
  return Uint8Array.from(aus);
}

// ------------------------------------------------------------ Matrix

/** Mittelpunkte der Ausrichtungsmuster (Anhang E). */
function ausrichtung(v: number): number[] {
  if (v === 1) return [];
  const n = Math.floor(v / 7) + 2;
  const schritt = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2;
  const p = [6];
  for (let pos = v * 4 + 10; p.length < n; pos -= schritt) p.splice(1, 0, pos);
  return p;
}

const MASKEN: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** BCH-Rest: `wert` · 2^grad mod `poly`. */
function bch(wert: number, poly: number, grad: number): number {
  let r = wert << grad;
  for (let i = 31 - Math.clz32(r); i >= grad; i--) if ((r >>> i) & 1) r ^= poly << (i - grad);
  return r;
}

class Matrix {
  readonly m: boolean[][];
  readonly fest: boolean[][];
  constructor(readonly n: number) {
    this.m = Array.from({ length: n }, () => Array<boolean>(n).fill(false));
    this.fest = Array.from({ length: n }, () => Array<boolean>(n).fill(false));
  }
  setze(x: number, y: number, dunkel: boolean): void {
    this.m[y]![x] = dunkel;
    this.fest[y]![x] = true;
  }
}

function funktionsmuster(q: Matrix, v: number): void {
  const n = q.n;
  for (let i = 0; i < n; i++) {
    q.setze(6, i, i % 2 === 0);
    q.setze(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        q.setze(x, y, d !== 2 && d !== 4);
      }
    }
  }
  const p = ausrichtung(v);
  for (let i = 0; i < p.length; i++) {
    for (let j = 0; j < p.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === p.length - 1) || (i === p.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) q.setze(p[i]! + dx, p[j]! + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }
  format(q, 0, 0); // Platz reservieren, echte Bits nach der Maske
  if (v >= 7) {
    const bits = (v << 12) | bch(v, 0x1f25, 12);
    for (let i = 0; i < 18; i++) {
      const b = ((bits >>> i) & 1) === 1;
      const a = n - 11 + (i % 3), c = Math.floor(i / 3);
      q.setze(a, c, b);
      q.setze(c, a, b);
    }
  }
}

function format(q: Matrix, stufe: number, maske: number): void {
  const d = (stufe << 3) | maske;
  const bits = ((d << 10) | bch(d, 0x537, 10)) ^ 0x5412;
  const bit = (i: number) => ((bits >>> i) & 1) === 1;
  const n = q.n;
  for (let i = 0; i <= 5; i++) q.setze(8, i, bit(i));
  q.setze(8, 7, bit(6));
  q.setze(8, 8, bit(7));
  q.setze(7, 8, bit(8));
  for (let i = 9; i < 15; i++) q.setze(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) q.setze(n - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) q.setze(8, n - 15 + i, bit(i));
  q.setze(8, n - 8, true); // dunkles Modul
}

function platziere(q: Matrix, daten: Uint8Array): void {
  const n = q.n;
  let i = 0;
  for (let rechts = n - 1; rechts >= 1; rechts -= 2) {
    if (rechts === 6) rechts = 5;
    for (let k = 0; k < n; k++) {
      for (let j = 0; j < 2; j++) {
        const x = rechts - j;
        const hoch = ((rechts + 1) & 2) === 0;
        const y = hoch ? n - 1 - k : k;
        if (q.fest[y]![x] || i >= daten.length * 8) continue;
        q.m[y]![x] = ((daten[i >>> 3]! >>> (7 - (i & 7))) & 1) === 1;
        i++;
      }
    }
  }
}

function maskiere(q: Matrix, maske: number): void {
  const f = MASKEN[maske]!;
  for (let y = 0; y < q.n; y++) for (let x = 0; x < q.n; x++) if (!q.fest[y]![x] && f(x, y)) q.m[y]![x] = !q.m[y]![x];
}

/** Strafpunkte einer fertigen Matrix (Regeln 1–4, Abschnitt 7.8.3). */
export function qrStrafpunkte(m: boolean[][]): number {
  const n = m.length;
  let p = 0;
  const zeile = (lies: (i: number) => boolean) => {
    let lauf = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && lies(i) === lies(i - 1)) { lauf++; continue; }
      if (lauf >= 5) p += lauf - 2;
      lauf = 1;
    }
    // 1:1:3:1:1 mit vier hellen Modulen davor oder danach (außerhalb zählt hell)
    const w = (i: number) => (i < 0 || i >= n ? false : lies(i));
    for (let i = -4; i + 10 < n; i++) {
      const kern = w(i + 4) && !w(i + 5) && w(i + 6) && w(i + 7) && w(i + 8) && !w(i + 9) && w(i + 10);
      if (!kern) continue;
      const vor = !w(i) && !w(i + 1) && !w(i + 2) && !w(i + 3);
      const nach = !w(i + 11) && !w(i + 12) && !w(i + 13) && !w(i + 14);
      if (vor || nach) p += 40;
    }
  };
  for (let y = 0; y < n; y++) zeile((x) => m[y]![x]!);
  for (let x = 0; x < n; x++) zeile((y) => m[y]![x]!);
  for (let y = 0; y + 1 < n; y++) {
    for (let x = 0; x + 1 < n; x++) {
      const c = m[y]![x];
      if (m[y]![x + 1] === c && m[y + 1]![x] === c && m[y + 1]![x + 1] === c) p += 3;
    }
  }
  let dunkel = 0;
  for (const r of m) for (const b of r) if (b) dunkel++;
  p += Math.floor(Math.abs(dunkel * 20 - n * n * 10) / (n * n)) * 10;
  return p;
}

/**
 * QR-Code für `daten` (Text wird UTF-8). Wirft `qr-zu-lang`, wenn es selbst in
 * Version 40 nicht passt. `maske` nur für Tests – sonst die beste.
 */
export function qrCode(daten: string | Uint8Array, o: { stufe?: QrStufe; maske?: number } = {}): QrCode {
  const bytes = typeof daten === "string" ? new TextEncoder().encode(daten) : daten;
  const stufe = o.stufe ?? "M";
  const s = STUFEN.indexOf(stufe);
  if (s < 0) throw new Error(`unbekannte Stufe ${String(stufe)}`);
  if (o.maske !== undefined && !(Number.isInteger(o.maske) && o.maske >= 0 && o.maske < 8)) throw new Error("Maske 0–7");
  let v = 1;
  while (v <= 40 && qrKapazitaet(v, stufe) < bytes.length) v++;
  if (v > 40) {
    const max = qrKapazitaet(40, stufe);
    throw new ProtokollFehler("qr-zu-lang", `Zu lang für einen QR-Code: ${bytes.length} Byte, höchstens ${max}`, { n: bytes.length, max });
  }
  const q = new Matrix(17 + 4 * v);
  funktionsmuster(q, v);
  platziere(q, kodiere(bytes, v, s));
  let beste = o.maske ?? 0;
  if (o.maske === undefined) {
    let min = Infinity;
    for (let k = 0; k < 8; k++) {
      maskiere(q, k);
      format(q, STUFE_BITS[stufe], k);
      const p = qrStrafpunkte(q.m);
      if (p < min) { min = p; beste = k; }
      maskiere(q, k);
    }
  }
  maskiere(q, beste);
  format(q, STUFE_BITS[stufe], beste);
  return { version: v, stufe, maske: beste, groesse: q.n, module: q.m };
}

/**
 * Pfaddaten für ein SVG (`<path d="…">`, viewBox `0 0 g g` mit g = Größe + 2·Rand):
 * je dunklem Modul ein Quadrat, Nachbarn einer Zeile zusammengefasst.
 */
export function qrSvgPfad(qr: Pick<QrCode, "module">, rand = 4): string {
  const teile: string[] = [];
  qr.module.forEach((zeile, y) => {
    for (let x = 0; x < zeile.length; x++) {
      if (!zeile[x]) continue;
      let l = 1;
      while (zeile[x + l]) l++;
      teile.push(`M${x + rand} ${y + rand}h${l}v1h-${l}z`);
      x += l - 1;
    }
  });
  return teile.join("");
}
