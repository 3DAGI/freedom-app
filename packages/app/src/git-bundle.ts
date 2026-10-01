/**
 * Git-Bundle-Leser (Schritt C.3c1, Entscheidung E4): liest Bundles v2/v3
 * samt Packfile – Commits, Bäume, Dateien, auch Deltas – ohne neue
 * Abhängigkeit: entpackt wird mit `DecompressionStream`, gehasht mit
 * `crypto.subtle`. Ohne DOM, damit testbar; die Ansicht folgt in C.3c2.
 *
 * Bundles kommen von Fremden: alles ist begrenzt (`BUNDLE_GRENZEN`), jede
 * Zahl geprüft, die Prüfsumme des Packs und jedes Objekt-Hash nachgerechnet.
 * Was nicht passt, bricht mit `BundleFehler` ab – mit einer Kennung, nie mit
 * Text aus dem Bundle.
 *
 * Packfiles nennen nicht, wie lang die gepackten Daten eines Objekts sind.
 * Das Ende findet der Leser über die Adler-32-Prüfsumme am Ende jedes
 * zlib-Stroms: erst entpacken (danach folgt „Müll“, das nächste Objekt), dann
 * die Summe suchen und das Stück genau bis dort noch einmal sauber entpacken.
 */

export const BUNDLE_GRENZEN = {
  /** Bundle höchstens 32 MB … */
  bytes: 32 * 1024 * 1024,
  /** … mit höchstens so vielen Objekten … */
  objekte: 10_000,
  /** … entpackt zusammen höchstens 128 MB, ein Objekt höchstens 16 MB. */
  entpackt: 128 * 1024 * 1024,
  objekt: 16 * 1024 * 1024,
  /** Delta auf Delta auf … höchstens so tief. */
  tiefe: 50,
  /** Zeilen im Kopf (Voraussetzungen und Refs). */
  kopfZeilen: 1000,
} as const;

/** Grenzen als Zahlen – Tests setzen kleinere ein. */
export type BundleGrenzen = { [K in keyof typeof BUNDLE_GRENZEN]: number };

export type BundleFehlerArt = "format" | "gross" | "objekte" | "entpacken" | "delta" | "tiefe" | "pruefsumme" | "kaputt" | "unsicher";

/** Fehler beim Lesen – `art` ist die Kennung für den Text in der Oberfläche. */
export class BundleFehler extends Error {
  constructor(readonly art: BundleFehlerArt) {
    super(`bundle-${art}`);
  }
}

export type ObjektArt = "commit" | "tree" | "blob" | "tag";
export interface GitObjekt { art: ObjektArt; daten: Uint8Array }

export interface GelesenesBundle {
  version: 2 | 3;
  refs: Array<{ name: string; sha: string }>;
  /** Commits, die das Bundle voraussetzt, aber nicht enthält. */
  voraussetzungen: string[];
  objekte: Map<string, GitObjekt>;
}

const SHA = /^[0-9a-f]{40}$/;
const ARTEN: Record<number, ObjektArt> = { 1: "commit", 2: "tree", 3: "blob", 4: "tag" };
const OFS_DELTA = 6, REF_DELTA = 7;

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

async function sha1(daten: Uint8Array): Promise<Uint8Array> {
  // ohne sicheren Kontext (http im Heimnetz, B-10b) gibt es kein crypto.subtle
  if (typeof globalThis.crypto?.subtle?.digest !== "function") throw new BundleFehler("unsicher");
  return new Uint8Array(await crypto.subtle.digest("SHA-1", daten as BufferSource));
}

/** Kopf „<art> <länge>\0“ + Inhalt – so rechnet git die Kennung eines Objekts. */
export async function objektSha(art: ObjektArt, daten: Uint8Array): Promise<string> {
  const kopf = new TextEncoder().encode(`${art} ${daten.length}\0`);
  const alles = new Uint8Array(kopf.length + daten.length);
  alles.set(kopf);
  alles.set(daten, kopf.length);
  return hex(await sha1(alles));
}

function adler32(d: Uint8Array): number {
  let a = 1, b = 0;
  for (let i = 0; i < d.length; i++) {
    a = (a + d[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** Ein Versuch mit `DecompressionStream`: was herauskam und ob es einen Fehler gab (z. B. Daten nach dem Ende). */
async function entpackeVersuch(teil: Uint8Array, hoechstens: number): Promise<{ daten: Uint8Array; fehler: boolean }> {
  const strom = new DecompressionStream("deflate");
  const schreiber = strom.writable.getWriter();
  schreiber.write(teil as BufferSource).catch(() => {});
  schreiber.close().catch(() => {});
  const leser = strom.readable.getReader();
  const teile: Uint8Array[] = [];
  let n = 0, fehler = false;
  try {
    for (;;) {
      const { done, value } = await leser.read();
      if (done) break;
      n += value.length;
      if (n > hoechstens) {
        fehler = true;
        await leser.cancel().catch(() => {});
        break;
      }
      teile.push(value);
    }
  } catch {
    fehler = true;
  }
  const daten = new Uint8Array(Math.min(n, hoechstens + 1));
  let o = 0;
  for (const t of teile) {
    daten.set(t.subarray(0, daten.length - o), o);
    o += t.length;
  }
  return { daten, fehler };
}

/** Entpackt das zlib-Stück ab `start` mit genau `laenge` Bytes Inhalt; liefert auch, wo es endet. */
async function entpacke(pack: Uint8Array, start: number, laenge: number): Promise<{ daten: Uint8Array; ende: number }> {
  // Gepackt ist ein Objekt höchstens so groß wie ungepackt plus Verwaltung (Blöcke ohne Kompression).
  const fenster = pack.subarray(start, Math.min(pack.length, start + laenge + 5 * Math.ceil((laenge + 1) / 65535) + 64));
  const erster = await entpackeVersuch(fenster, laenge);
  if (erster.daten.length !== laenge) throw new BundleFehler("entpacken");
  const summe = adler32(erster.daten);
  const s = [summe >>> 24, (summe >>> 16) & 255, (summe >>> 8) & 255, summe & 255];
  for (let i = 2; i + 4 <= fenster.length; i++) {
    if (fenster[i] !== s[0] || fenster[i + 1] !== s[1] || fenster[i + 2] !== s[2] || fenster[i + 3] !== s[3]) continue;
    const genau = await entpackeVersuch(fenster.subarray(0, i + 4), laenge);
    if (!genau.fehler && genau.daten.length === laenge) return { daten: genau.daten, ende: start + i + 4 };
  }
  throw new BundleFehler("entpacken");
}

/** Varint-Länge in Deltas (7 Bit je Byte, niederwertig zuerst). */
function deltaZahl(d: Uint8Array, pos: { i: number }): number {
  let n = 0, schieb = 0;
  for (;;) {
    if (pos.i >= d.length || schieb > 28) throw new BundleFehler("delta");
    const b = d[pos.i++]!;
    n += (b & 0x7f) * 2 ** schieb;
    schieb += 7;
    if (!(b & 0x80)) return n;
  }
}

/** Delta auf eine Basis anwenden (git: kopieren aus der Basis oder Bytes einfügen). */
export function wendeDeltaAn(basis: Uint8Array, delta: Uint8Array, hoechstens: number = BUNDLE_GRENZEN.objekt): Uint8Array {
  const pos = { i: 0 };
  if (deltaZahl(delta, pos) !== basis.length) throw new BundleFehler("delta");
  const ziel = deltaZahl(delta, pos);
  if (ziel > hoechstens) throw new BundleFehler("gross");
  const aus = new Uint8Array(ziel);
  let o = 0;
  while (pos.i < delta.length) {
    const befehl = delta[pos.i++]!;
    if (befehl & 0x80) {
      let von = 0, n = 0;
      for (let bit = 0; bit < 4; bit++) if (befehl & (1 << bit)) {
        if (pos.i >= delta.length) throw new BundleFehler("delta");
        von += delta[pos.i++]! * 2 ** (8 * bit);
      }
      for (let bit = 0; bit < 3; bit++) if (befehl & (0x10 << bit)) {
        if (pos.i >= delta.length) throw new BundleFehler("delta");
        n += delta[pos.i++]! * 2 ** (8 * bit);
      }
      if (n === 0) n = 0x10000;
      if (von + n > basis.length || o + n > ziel) throw new BundleFehler("delta");
      aus.set(basis.subarray(von, von + n), o);
      o += n;
    } else if (befehl) {
      if (pos.i + befehl > delta.length || o + befehl > ziel) throw new BundleFehler("delta");
      aus.set(delta.subarray(pos.i, pos.i + befehl), o);
      pos.i += befehl;
      o += befehl;
    } else throw new BundleFehler("delta");
  }
  if (o !== ziel) throw new BundleFehler("delta");
  return aus;
}

interface Eintrag {
  art?: ObjektArt;
  basisVersatz?: number;
  basisSha?: string;
  daten: Uint8Array;
}

export async function leseBundle(bytes: Uint8Array, g: BundleGrenzen = BUNDLE_GRENZEN): Promise<GelesenesBundle> {
  if (bytes.length > g.bytes) throw new BundleFehler("gross");
  // Kopf: Zeilen bis zur Leerzeile, danach das Pack
  const zeilen: string[] = [];
  let i = 0;
  for (;;) {
    const nl = bytes.indexOf(10, i);
    if (nl < 0 || zeilen.length > g.kopfZeilen) throw new BundleFehler("format");
    const zeile = new TextDecoder().decode(bytes.subarray(i, nl));
    i = nl + 1;
    if (zeile === "") break;
    zeilen.push(zeile);
  }
  const version = zeilen[0] === "# v2 git bundle" ? 2 : zeilen[0] === "# v3 git bundle" ? 3 : 0; // kein UI-Text
  if (!version) throw new BundleFehler("format");
  const refs: GelesenesBundle["refs"] = [];
  const voraussetzungen: string[] = [];
  for (const z of zeilen.slice(1)) {
    if (version === 3 && z.startsWith("@")) {
      if (z.startsWith("@object-format=") && z !== "@object-format=sha1") throw new BundleFehler("format"); // kein UI-Text
      continue;
    }
    if (z.startsWith("-")) {
      const sha = z.slice(1, 41);
      if (!SHA.test(sha)) throw new BundleFehler("format");
      voraussetzungen.push(sha);
      continue;
    }
    const [sha, name] = [z.slice(0, 40), z.slice(41)];
    if (!SHA.test(sha) || z[40] !== " " || !name || name.length > 255 || /[\x00-\x1f\x7f]/.test(name)) throw new BundleFehler("format");
    refs.push({ name, sha });
  }

  // Pack: „PACK“, Version 2 oder 3, Anzahl; am Ende SHA-1 über alles davor
  const pack = bytes.subarray(i);
  if (pack.length < 32 || new TextDecoder().decode(pack.subarray(0, 4)) !== "PACK") throw new BundleFehler("format"); // kein UI-Text
  const sicht = new DataView(pack.buffer, pack.byteOffset, pack.byteLength);
  const packVersion = sicht.getUint32(4);
  const anzahl = sicht.getUint32(8);
  if (packVersion !== 2 && packVersion !== 3) throw new BundleFehler("format");
  if (anzahl > g.objekte) throw new BundleFehler("objekte");
  const inhaltEnde = pack.length - 20;
  if (hex(await sha1(pack.subarray(0, inhaltEnde))) !== hex(pack.subarray(inhaltEnde))) throw new BundleFehler("pruefsumme");

  const eintraege = new Map<number, Eintrag>();
  let pos = 12, gesamt = 0;
  for (let n = 0; n < anzahl; n++) {
    const anfang = pos;
    if (pos >= inhaltEnde) throw new BundleFehler("kaputt");
    let b = pack[pos++]!;
    const typ = (b >> 4) & 7;
    let groesse = b & 15, schieb = 4;
    while (b & 0x80) {
      if (pos >= inhaltEnde || schieb > 28) throw new BundleFehler("kaputt");
      b = pack[pos++]!;
      groesse += (b & 0x7f) * 2 ** schieb;
      schieb += 7;
    }
    if (groesse > g.objekt) throw new BundleFehler("gross");
    const eintrag: Partial<Eintrag> = {};
    if (typ === OFS_DELTA) {
      if (pos >= inhaltEnde) throw new BundleFehler("kaputt");
      b = pack[pos++]!;
      let versatz = b & 0x7f;
      while (b & 0x80) {
        if (pos >= inhaltEnde || versatz > 2 ** 40) throw new BundleFehler("kaputt");
        b = pack[pos++]!;
        versatz = (versatz + 1) * 128 + (b & 0x7f);
      }
      if (versatz <= 0 || versatz > anfang || !eintraege.has(anfang - versatz)) throw new BundleFehler("delta");
      eintrag.basisVersatz = anfang - versatz;
    } else if (typ === REF_DELTA) {
      if (pos + 20 > inhaltEnde) throw new BundleFehler("kaputt");
      eintrag.basisSha = hex(pack.subarray(pos, pos + 20));
      pos += 20;
    } else if (ARTEN[typ]) eintrag.art = ARTEN[typ];
    else throw new BundleFehler("kaputt");
    gesamt += groesse;
    if (gesamt > g.entpackt) throw new BundleFehler("gross");
    const { daten, ende } = await entpacke(pack.subarray(0, inhaltEnde), pos, groesse);
    eintraege.set(anfang, { ...eintrag, daten });
    pos = ende;
  }
  if (pos !== inhaltEnde) throw new BundleFehler("kaputt");

  // Deltas auflösen (Basis im Pack über den Versatz oder über ihre Kennung), dann alle Kennungen rechnen.
  // Tiefe zählt über beide Arten von Deltas; aufgelöst zusammen höchstens `entpackt`.
  const objekte = new Map<string, GitObjekt>();
  const tiefeVon = new Map<string, number>();
  const aufgeloest = new Map<number, { o: GitObjekt; t: number }>();
  let summe = 0;
  const loese = (versatz: number, tiefe: number): { o: GitObjekt; t: number } | undefined => {
    const fertig = aufgeloest.get(versatz);
    if (fertig) return fertig;
    const e = eintraege.get(versatz)!;
    if (e.art) return { o: { art: e.art, daten: e.daten }, t: 0 };
    let basis: { o: GitObjekt; t: number } | undefined;
    if (e.basisVersatz !== undefined) {
      if (tiefe >= g.tiefe) throw new BundleFehler("tiefe");
      basis = loese(e.basisVersatz, tiefe + 1);
    } else {
      const o = objekte.get(e.basisSha!);
      basis = o ? { o, t: tiefeVon.get(e.basisSha!) ?? 0 } : undefined;
    }
    if (!basis) return undefined; // Basis (noch) unbekannt
    if (basis.t + 1 > g.tiefe) throw new BundleFehler("tiefe");
    const daten = wendeDeltaAn(basis.o.daten, e.daten, g.objekt);
    summe += daten.length;
    if (summe > g.entpackt) throw new BundleFehler("gross");
    const r = { o: { art: basis.o.art, daten }, t: basis.t + 1 };
    aufgeloest.set(versatz, r);
    return r;
  };
  let offen = [...eintraege.keys()];
  while (offen.length) {
    const naechste: number[] = [];
    for (const versatz of offen) {
      const r = loese(versatz, 0);
      if (!r) {
        naechste.push(versatz);
        continue;
      }
      const sha = await objektSha(r.o.art, r.o.daten);
      objekte.set(sha, r.o);
      tiefeVon.set(sha, r.t);
    }
    if (naechste.length === offen.length) throw new BundleFehler("delta"); // Basis fehlt ganz
    offen = naechste;
  }
  return { version: version as 2 | 3, refs, voraussetzungen, objekte };
}

export interface GelesenerCommit {
  baum: string;
  eltern: string[];
  autor: string;
  /** Sekunden seit 1970 laut Autor-Zeile. */
  zeit: number;
  betreff: string;
  nachricht: string;
}

/** Commit-Text lesen: tree, parent, author, dann die Nachricht. */
export function leseCommit(daten: Uint8Array): GelesenerCommit {
  const text = new TextDecoder().decode(daten);
  const leer = text.indexOf("\n\n");
  const kopf = (leer < 0 ? text : text.slice(0, leer)).split("\n");
  const nachricht = leer < 0 ? "" : text.slice(leer + 2);
  const baum = kopf.find((z) => z.startsWith("tree "))?.slice(5) ?? ""; // kein UI-Text
  if (!SHA.test(baum)) throw new BundleFehler("kaputt");
  const eltern = kopf.filter((z) => z.startsWith("parent ")).map((z) => z.slice(7)).filter((s) => SHA.test(s)); // kein UI-Text
  const autorZeile = /^author (.*) <[^>]*> (\d{1,12}) [+-]\d{4}$/.exec(kopf.find((z) => z.startsWith("author ")) ?? ""); // kein UI-Text
  return {
    baum, eltern,
    autor: (autorZeile?.[1] ?? "").slice(0, 200),
    zeit: autorZeile ? Number(autorZeile[2]) : 0,
    betreff: (nachricht.split("\n")[0] ?? "").slice(0, 200),
    nachricht: nachricht.trim().slice(0, 10_000),
  };
}

export interface BaumEintrag {
  name: string;
  sha: string;
  art: "ordner" | "datei" | "link" | "modul";
  modus: string;
}

/** Baum lesen: je Eintrag „<modus> <name>\0<20 Byte Kennung>“; Ordner zuerst, dann nach Namen. */
export function leseBaum(daten: Uint8Array): BaumEintrag[] {
  const aus: BaumEintrag[] = [];
  let i = 0;
  while (i < daten.length) {
    const leer = daten.indexOf(32, i);
    const null0 = daten.indexOf(0, leer + 1);
    if (leer < 0 || null0 < 0 || null0 + 21 > daten.length || leer - i > 6) throw new BundleFehler("kaputt");
    const modus = new TextDecoder().decode(daten.subarray(i, leer));
    const name = new TextDecoder().decode(daten.subarray(leer + 1, null0));
    if (!/^[0-7]{5,6}$/.test(modus) || !name || name.includes("/") || name === "." || name === "..") throw new BundleFehler("kaputt");
    const art = modus === "40000" ? "ordner" : modus === "120000" ? "link" : modus === "160000" ? "modul" : "datei";
    aus.push({ name: name.slice(0, 255), sha: hex(daten.subarray(null0 + 1, null0 + 21)), art, modus });
    i = null0 + 21;
  }
  // Unabhängig von der Sprache: Groß/klein egal, bei Gleichstand nach Code-Punkten
  const schluessel = (e: BaumEintrag) => e.name.toLowerCase();
  return aus.sort((a, b) => Number(b.art === "ordner") - Number(a.art === "ordner")
    || (schluessel(a) < schluessel(b) ? -1 : schluessel(a) > schluessel(b) ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Welcher Commit gilt: HEAD, sonst main/master, sonst der erste Ref – nur, wenn er im Bundle liegt. */
export function kopfCommit(b: GelesenesBundle): string | undefined {
  const wahl = b.refs.find((r) => r.name === "HEAD") ?? b.refs.find((r) => r.name === "refs/heads/main")
    ?? b.refs.find((r) => r.name === "refs/heads/master") ?? b.refs[0];
  return wahl && b.objekte.get(wahl.sha)?.art === "commit" ? wahl.sha : undefined;
}

export interface ZweigOderTag {
  /** Ohne „refs/heads/“ bzw. „refs/tags/“. */
  name: string;
  art: "zweig" | "tag";
  commit: string;
}

/** Annotierter Tag → das Objekt, auf das er zeigt (höchstens fünf Stufen); `undefined`, wenn am Ende kein Commit im Bundle liegt. */
function aufCommit(b: GelesenesBundle, sha: string): string | undefined {
  for (let i = 0; i < 5; i++) {
    const o = b.objekte.get(sha);
    if (o?.art === "commit") return sha;
    if (o?.art !== "tag") return undefined;
    const ziel = /^object ([0-9a-f]{40})$/m.exec(new TextDecoder().decode(o.daten.subarray(0, 200)))?.[1];
    if (!ziel) return undefined;
    sha = ziel;
  }
  return undefined;
}

/**
 * Zweige und Tags (seit C-20c), deren Commit im Bundle liegt – annotierte
 * Tags aufgelöst, jeder Name einmal; Zweige zuerst, je nach Namen.
 */
export function zweigeUndTags(b: GelesenesBundle): ZweigOderTag[] {
  const aus = new Map<string, ZweigOderTag>();
  for (const r of b.refs) {
    const m = /^refs\/(heads|tags)\/(.{1,200})$/.exec(r.name);
    const commit = m && !aus.has(r.name) ? aufCommit(b, r.sha) : undefined;
    if (m && commit) aus.set(r.name, { name: m[2]!, art: m[1] === "heads" ? "zweig" : "tag", commit });
  }
  return [...aus.values()].sort((x, y) => Number(x.art === "tag") - Number(y.art === "tag") || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
}

/** Commits ab `sha` entlang der ersten Eltern, höchstens `max`; endet, wo das Bundle aufhört. */
export function commitsAb(b: GelesenesBundle, sha: string, max = 100): Array<{ sha: string } & GelesenerCommit> {
  const aus: Array<{ sha: string } & GelesenerCommit> = [];
  const gesehen = new Set<string>();
  let jetzt: string | undefined = sha;
  while (jetzt && aus.length < max && !gesehen.has(jetzt)) {
    gesehen.add(jetzt);
    const o = b.objekte.get(jetzt);
    if (o?.art !== "commit") break;
    const c = leseCommit(o.daten);
    aus.push({ sha: jetzt, ...c });
    jetzt = c.eltern[0];
  }
  return aus;
}

export type AnPfad =
  | { art: "ordner"; eintraege: BaumEintrag[] }
  | { art: "datei" | "link"; daten: Uint8Array }
  | { art: "modul"; sha: string };

/**
 * Was unter `pfad` im Baum `baum` liegt (seit C.3c2) – Ordner, Datei, Link
 * oder Submodul; `null`, wenn es den Pfad im Bundle nicht gibt (auch bei
 * „..“ oder einem Pfad durch eine Datei hindurch).
 */
export function unterPfad(b: GelesenesBundle, baum: string, pfad: readonly string[]): AnPfad | null {
  let jetzt = baum;
  for (let i = 0; i <= pfad.length; i++) {
    const o = b.objekte.get(jetzt);
    if (!o) return null;
    if (o.art !== "tree") return null;
    const eintraege = leseBaum(o.daten);
    if (i === pfad.length) return { art: "ordner", eintraege };
    const e = eintraege.find((x) => x.name === pfad[i]);
    if (!e) return null;
    if (e.art === "modul") return i === pfad.length - 1 ? { art: "modul", sha: e.sha } : null;
    if (e.art !== "ordner") {
      const d = b.objekte.get(e.sha);
      return i === pfad.length - 1 && d?.art === "blob" ? { art: e.art, daten: d.daten } : null;
    }
    jetzt = e.sha;
  }
  return null;
}

/** Text, den die App zeigen kann: gültiges UTF-8 ohne Nullbyte (so erkennt auch git Binärdateien). */
export function alsText(daten: Uint8Array): string | null {
  if (daten.subarray(0, 8000).includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(daten);
  } catch {
    return null;
  }
}

/** Kennung dessen, was unter `pfad` im Baum `baum` liegt (Ordner oder Datei) – `null`, wenn dort nichts liegt. */
function kennungUnterPfad(b: GelesenesBundle, baum: string, pfad: readonly string[]): string | null {
  let jetzt = baum;
  for (const teil of pfad) {
    const o = b.objekte.get(jetzt);
    const e = o?.art === "tree" ? leseBaum(o.daten).find((x) => x.name === teil) : undefined;
    if (!e) return null;
    jetzt = e.sha;
  }
  return jetzt;
}

export type DateiAenderung = "neu" | "geaendert" | "geloescht";

/**
 * Verlauf einer Datei (seit C-20d): die Commits ab `sha` entlang der ersten
 * Eltern, in denen sich die Kennung unter `pfad` gegenüber den Eltern ändert –
 * angelegt, geändert oder gelöscht. Höchstens `max` Commits werden angesehen;
 * `abgeschnitten`, wenn danach noch Verlauf käme oder die Eltern nicht im
 * Bundle liegen (dann lässt sich nicht sagen, was der Commit tat).
 */
export function dateiVerlauf(
  b: GelesenesBundle, sha: string, pfad: readonly string[], max = 100,
): { eintraege: Array<{ sha: string; art: DateiAenderung } & GelesenerCommit>; abgeschnitten: boolean } {
  const eintraege: Array<{ sha: string; art: DateiAenderung } & GelesenerCommit> = [];
  const commits = commitsAb(b, sha, max);
  for (const c of commits) {
    const jetzt = kennungUnterPfad(b, c.baum, pfad);
    let vorher: string | null = null;
    const eltern = c.eltern[0];
    if (eltern) {
      const o = b.objekte.get(eltern);
      if (o?.art !== "commit") return { eintraege, abgeschnitten: true };
      vorher = kennungUnterPfad(b, leseCommit(o.daten).baum, pfad);
    }
    if (jetzt !== vorher) eintraege.push({ ...c, art: vorher === null ? "neu" : jetzt === null ? "geloescht" : "geaendert" });
  }
  const letzter = commits.at(-1);
  return { eintraege, abgeschnitten: commits.length >= max && !!letzter?.eltern[0] };
}

export interface CodeTreffer {
  pfad: string[];
  /** Zeile ab 1; 0 heißt: der Name der Datei passt. */
  nr: number;
  zeile: string;
}

/** Grenzen der Suche im Code – fremde Bundles, also nie unbegrenzt. */
export const SUCHE_GRENZEN = { dateien: 5000, treffer: 200, groesse: 1_000_000, zeile: 300, tiefe: 32 } as const;

/**
 * Suche im Code (seit C-20d): Namen und Zeilen aller Textdateien unter
 * `baum`, die `text` enthalten (Groß/klein egal), in der Reihenfolge des
 * Reiters „Code“ – nur im Speicher, mit den Grenzen aus `SUCHE_GRENZEN`;
 * `mehr`, wenn eine Grenze griff. Unter zwei Zeichen wird nicht gesucht.
 */
export function sucheImCode(b: GelesenesBundle, baum: string, text: string): { treffer: CodeTreffer[]; mehr: boolean } {
  const suche = text.trim().toLowerCase();
  const treffer: CodeTreffer[] = [];
  let dateien = 0;
  let mehr = false;
  const nimm = (x: CodeTreffer) => {
    if (treffer.length >= SUCHE_GRENZEN.treffer) mehr = true;
    else treffer.push(x);
  };
  const geh = (sha: string, pfad: string[]) => {
    const o = b.objekte.get(sha);
    if (o?.art !== "tree" || pfad.length > SUCHE_GRENZEN.tiefe) return;
    for (const e of leseBaum(o.daten)) {
      if (mehr) return;
      if (e.art === "ordner") {
        geh(e.sha, [...pfad, e.name]);
        continue;
      }
      if (e.art !== "datei") continue;
      if (++dateien > SUCHE_GRENZEN.dateien) {
        mehr = true;
        return;
      }
      if (e.name.toLowerCase().includes(suche)) nimm({ pfad: [...pfad, e.name], nr: 0, zeile: "" });
      const d = b.objekte.get(e.sha);
      const inhalt = d?.art === "blob" && d.daten.length <= SUCHE_GRENZEN.groesse ? alsText(d.daten) : null;
      if (inhalt === null) continue;
      const zeilen = inhalt.split("\n");
      for (let i = 0; i < zeilen.length && !mehr; i++) {
        if (zeilen[i]!.toLowerCase().includes(suche)) nimm({ pfad: [...pfad, e.name], nr: i + 1, zeile: zeilen[i]!.trim().slice(0, SUCHE_GRENZEN.zeile) });
      }
    }
  };
  if (suche.length >= 2) geh(baum, []);
  return { treffer, mehr };
}
