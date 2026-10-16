/**
 * Patch-Schreiber (Schritt 11.5a2a, `docs/REPO-AGENTEN-ENTWURF.md` V5, W1 B):
 * die Arbeitskopie nach dem Auftrag gegen den Kopf des Bundles als Text in der
 * Form von `git format-patch` – ohne git, ohne Abhängigkeit. Der Knoten baut den
 * Patch, nie das Modell.
 *
 * - Der Commit in der ersten Zeile wird gerechnet wie bei git: Bäume aus allen
 *   Dateien (Submodule unverändert), Eltern = Kopf, Autor und Committer gleich,
 *   die Nachricht wie `git am` sie aus der Mail liest. `git am` mit
 *   `--committer-date-is-author-date` ergibt dieselbe Kennung.
 * - Unified Diff mit drei Zeilen Kontext (Myers), volle Kennungen in `index`,
 *   Pfade gequotet wie git (`core.quotePath`).
 * - Binäres (Nullbyte, kein UTF-8) und zu Großes gibt es nicht als Patch – dann
 *   ein Fall (`fall`), nie ein halber Patch. Was herauskommt, nimmt
 *   `lesePatchText()` an.
 */
import type { ArbeitsDatei, Arbeitskopie } from "./arbeitskopie.js";
import { istRepoPfad } from "./arbeitskopie.js";
import { objektSha } from "./git-bundle.js";
import { PATCH_MAX_BYTES, lesePatchText } from "./nip34.js";

export const PATCH_GRENZEN = {
  /** Zeilen Kontext um jede Änderung, wie git. */
  kontext: 3,
  /** Schritte des Diffs je Datei (eingefügte plus entfernte Zeilen) – darüber zu groß. */
  schritte: 4000,
  /** Betreff und Beschreibung in Zeichen. */
  betreff: 200,
  beschreibung: 2000,
} as const;

export interface PatchAngaben {
  /** Name des Autors (der Agent, W4) – nur Buchstaben, Ziffern, Leerzeichen, `._-`. */
  name: string;
  mail: string;
  /** Zeit des Auftrags in Sekunden (UTC). */
  zeit: number;
  betreff: string;
  beschreibung?: string;
}

/** `patch.ordner`: den Arbeitsordner konnte der Knoten nicht lesen (11.5a2b). */
export type PatchFall = "patch.angaben" | "patch.keine-aenderung" | "patch.binaer" | "patch.gross" | "patch.ordner";
export type PatchErgebnis = { ok: true; text: string; commit: string; geaendert: string[] } | { ok: false; fall: PatchFall };

const MODUS = { datei: "100644", ausfuehrbar: "100755", verweis: "120000" } as const;
const NULL_SHA = "0".repeat(40);
const enc = new TextEncoder();

/** Text wie git ihn diffen würde: kein Nullbyte in den ersten 8000 Bytes, gültiges UTF-8 – ein BOM bleibt stehen. */
function alsText(daten: Uint8Array): string | null {
  if (daten.subarray(0, 8000).includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(daten);
  } catch {
    return null;
  }
}

/** Zeilen samt Zeilenende – die letzte ohne `\n`, wenn die Datei so endet. */
function zeilen(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

type Op = [" " | "-" | "+", string];

/**
 * Myers-Diff zweier Zeilenlisten; `null`, wenn mehr als `max` Schritte nötig wären.
 * Je Schritt und Diagonale merkt er sich Richtung und Anfang der Schlange – nur
 * Züge im Raster zählen, der Rückweg folgt genau diesen Entscheidungen.
 */
export function zeilenDiff(a: readonly string[], b: readonly string[], max: number = PATCH_GRENZEN.schritte): Op[] | null {
  let vorn = 0;
  while (vorn < a.length && vorn < b.length && a[vorn] === b[vorn]) vorn++;
  let hinten = 0;
  while (hinten < a.length - vorn && hinten < b.length - vorn && a[a.length - 1 - hinten] === b[b.length - 1 - hinten]) hinten++;
  const A = a.slice(vorn, a.length - hinten), B = b.slice(vorn, b.length - hinten);
  const N = A.length, M = B.length;
  // je Schritt d: x am Ende (nach der Schlange), x am Anfang der Schlange, Richtung (1 = einfügen) – Index k + d
  const ende: Int32Array[] = [], anfang: Int32Array[] = [], runter: Uint8Array[] = [];
  const bei = (d: number, k: number) => (d < 0 || k < -d || k > d ? -1 : ende[d]![k + d]!);
  let d = 0;
  for (;; d++) {
    if (d > max) return null;
    const e = new Int32Array(2 * d + 1).fill(-1), s = new Int32Array(2 * d + 1), r = new Uint8Array(2 * d + 1);
    ende.push(e); anfang.push(s); runter.push(r);
    let fertig = false;
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (d === 0) x = 0;
      else {
        const vonOben = bei(d - 1, k + 1), vonLinks = bei(d - 1, k - 1);
        const xR = vonOben >= 0 && vonOben - k <= M ? vonOben : -1; // einfügen: x bleibt, y + 1
        const xL = vonLinks >= 0 && vonLinks + 1 <= N && vonLinks + 1 - k >= 0 ? vonLinks + 1 : -1; // löschen: x + 1
        if (xR < 0 && xL < 0) continue;
        r[k + d] = xR >= xL ? 1 : 0;
        x = Math.max(xR, xL);
      }
      s[k + d] = x;
      let y = x - k;
      while (x < N && y < M && A[x] === B[y]) { x++; y++; }
      e[k + d] = x;
      if (k === N - M && x >= N) fertig = true;
    }
    if (fertig) break;
  }
  const mitte: Op[] = [];
  let x = N, y = M;
  for (; d >= 0; d--) {
    const k = x - y, start = anfang[d]![k + d]!;
    while (x > start) { mitte.push([" ", A[--x]!]); y--; }
    if (d === 0) break;
    if (runter[d]![k + d]) mitte.push(["+", B[--y]!]);
    else mitte.push(["-", A[--x]!]);
  }
  return [...a.slice(0, vorn).map((z): Op => [" ", z]), ...mitte.reverse(), ...a.slice(a.length - hinten).map((z): Op => [" ", z])];
}

/** Abschnitte mit `kontext` Zeilen drumherum; nahe Änderungen in einem Abschnitt, wie git. */
function abschnitte(ops: readonly Op[], kontext: number): string {
  const aend = ops.flatMap(([art], i) => (art === " " ? [] : [i]));
  let aus = "";
  for (let i = 0; i < aend.length;) {
    let j = i;
    while (j + 1 < aend.length && aend[j + 1]! - aend[j]! <= 2 * kontext + 1) j++;
    const von = Math.max(0, aend[i]! - kontext), bis = Math.min(ops.length, aend[j]! + kontext + 1);
    let alt = 0, neu = 0;
    for (const [art] of ops.slice(0, von)) { if (art !== "+") alt++; if (art !== "-") neu++; }
    const teil = ops.slice(von, bis);
    const nA = teil.filter(([art]) => art !== "+").length, nN = teil.filter(([art]) => art !== "-").length;
    const bereich = (start: number, n: number) => (n === 1 ? `${start + 1}` : `${n === 0 ? start : start + 1},${n}`);
    aus += `@@ -${bereich(alt, nA)} +${bereich(neu, nN)} @@\n`;
    for (const [art, z] of teil) aus += z.endsWith("\n") ? `${art}${z}` : `${art}${z}\n\\ No newline at end of file\n`;
    i = j + 1;
  }
  return aus;
}

/** Pfad wie git ihn in Diff-Köpfen schreibt: mit `"…"` und Oktal, sobald `"`, `\` oder Nicht-ASCII darin steht. */
function gitPfad(praefix: string, pfad: string): string {
  const roh = praefix + pfad;
  if (!/["\\\u0080-￿]/.test(roh)) return roh;
  let aus = "";
  for (const b of enc.encode(roh)) aus += b === 0x22 ? '\\"' : b === 0x5c ? "\\\\" : b >= 0x80 ? `\\${b.toString(8).padStart(3, "0")}` : String.fromCharCode(b);
  return `"${aus}"`;
}

/** Ein Abschnitt `diff --git` für eine Datei – `null` für binär oder zu groß. */
function dateiDiff(pfad: string, alt: ArbeitsDatei | undefined, neu: ArbeitsDatei | undefined, sha: Map<ArbeitsDatei, string>): string | null | "binaer" {
  const textAlt = alt ? alsText(alt.daten) : "", textNeu = neu ? alsText(neu.daten) : "";
  if (textAlt === null || textNeu === null) return "binaer";
  const ops = zeilenDiff(zeilen(textAlt), zeilen(textNeu));
  if (!ops) return null;
  const a = gitPfad("a/", pfad), b = gitPfad("b/", pfad);
  let kopf = `diff --git ${a} ${b}\n`;
  const shaAlt = alt ? sha.get(alt)! : NULL_SHA, shaNeu = neu ? sha.get(neu)! : NULL_SHA;
  if (!alt) kopf += `new file mode ${MODUS[neu!.art]}\nindex ${shaAlt}..${shaNeu}\n`;
  else if (!neu) kopf += `deleted file mode ${MODUS[alt.art]}\nindex ${shaAlt}..${shaNeu}\n`;
  else if (alt.art !== neu.art) kopf += `old mode ${MODUS[alt.art]}\nnew mode ${MODUS[neu.art]}\n${shaAlt === shaNeu ? "" : `index ${shaAlt}..${shaNeu}\n`}`;
  else kopf += `index ${shaAlt}..${shaNeu} ${MODUS[neu.art]}\n`;
  if (shaAlt === shaNeu || !ops.some(([art]) => art !== " ")) return kopf;
  return `${kopf}--- ${alt ? a : "/dev/null"}\n+++ ${neu ? b : "/dev/null"}\n${abschnitte(ops, PATCH_GRENZEN.kontext)}`;
}

async function baumSha(eintraege: Array<{ pfad: string; modus: string; sha: string }>): Promise<string> {
  const hier: Array<{ name: string; modus: string; sha: string }> = [];
  const unter = new Map<string, Array<{ pfad: string; modus: string; sha: string }>>();
  for (const e of eintraege) {
    const i = e.pfad.indexOf("/");
    if (i < 0) hier.push({ name: e.pfad, modus: e.modus, sha: e.sha });
    else {
      const name = e.pfad.slice(0, i);
      if (!unter.has(name)) unter.set(name, []);
      unter.get(name)!.push({ ...e, pfad: e.pfad.slice(i + 1) });
    }
  }
  for (const [name, teil] of unter) hier.push({ name, modus: "40000", sha: await baumSha(teil) });
  // git ordnet nach Bytes, Ordner als „name/“
  const schluessel = (e: { name: string; modus: string }) => enc.encode(e.modus === "40000" ? `${e.name}/` : e.name);
  hier.sort((x, y) => {
    const a = schluessel(x), b = schluessel(y);
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
    return a.length - b.length;
  });
  const teile = hier.flatMap((e) => [enc.encode(`${e.modus} ${e.name}\0`), Uint8Array.from(e.sha.match(/../g)!.map((h) => parseInt(h, 16)))]);
  const daten = new Uint8Array(teile.reduce((n, t) => n + t.length, 0));
  let o = 0;
  for (const t of teile) { daten.set(t, o); o += t.length; }
  return objektSha("tree", daten);
}

/** Betreff wie `git am` ihn liest: eine Zeile, ohne `[…]`- und `Re:`-Vorspann, Leerraum zusammengefasst. */
function betreffFuerGit(roh: string): string {
  let s = roh.replace(/\s+/g, " ").trim();
  for (let alt = ""; alt !== s;) { alt = s; s = s.replace(/^(\[[^\]]*\]|re:)\s*/i, ""); }
  return s.slice(0, PATCH_GRENZEN.betreff).trim();
}

/** Beschreibung so, dass `git am` sie unverändert liest: kein Trenner, kein Diff, keine Mbox-Zeile darin. */
function beschreibungFuerGit(roh: string): string {
  const z = roh.replace(/\r/g, "").slice(0, PATCH_GRENZEN.beschreibung).split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .map((l) => (/^(---|-- |diff -|Index: |From |>*From )/.test(l) || l === "--" ? ` ${l}` : l).replace(/\s+$/, ""));
  return z.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
}

/** RFC 2047 (Q) für Kopfzeilen mit Nicht-ASCII, in Wörtern zu höchstens 75 Zeichen, nie mitten in einem Zeichen geteilt. */
function kopfWort(text: string): string {
  if (!/[^\x20-\x7e]/.test(text)) return text;
  const woerter: string[] = [];
  let wort = "";
  for (const zeichen of text) {
    const q = Array.from(enc.encode(zeichen), (b) => (/[A-Za-z0-9!*+\-/]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : b === 0x20 ? "_" : `=${b.toString(16).toUpperCase().padStart(2, "0")}`)).join("");
    if (wort.length + q.length > 75 - 12) { woerter.push(wort); wort = ""; }
    wort += q;
  }
  woerter.push(wort);
  return woerter.map((w) => `=?UTF-8?q?${w}?=`).join("\n ");
}

const TAGE = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MONATE = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const zwei = (n: number) => String(n).padStart(2, "0");
function mailDatum(sek: number): string {
  const d = new Date(sek * 1000);
  return `${TAGE[d.getUTCDay()]}, ${d.getUTCDate()} ${MONATE[d.getUTCMonth()]} ${d.getUTCFullYear()} ${zwei(d.getUTCHours())}:${zwei(d.getUTCMinutes())}:${zwei(d.getUTCSeconds())} +0000`;
}

/**
 * Der Patch: `neu` sind alle Dateien der Arbeitskopie nach dem Auftrag (Pfade
 * nach `istRepoPfad()`, Submodule kommen aus `alt`). Ohne Änderung, mit binären
 * Änderungen oder über `PATCH_MAX_BYTES` gibt es keinen Patch, nur den Fall.
 */
export async function schreibePatch(alt: Arbeitskopie, neu: readonly ArbeitsDatei[], a: PatchAngaben): Promise<PatchErgebnis> {
  const name = a.name.normalize("NFC").replace(/[^\p{L}\p{N} ._-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  const betreff = betreffFuerGit(a.betreff), beschreibung = beschreibungFuerGit(a.beschreibung ?? "");
  const mailOk = /^[A-Za-z0-9._+-]{1,64}@[A-Za-z0-9.-]{1,190}$/.test(a.mail);
  if (!name || !mailOk || !betreff || !Number.isSafeInteger(a.zeit) || a.zeit < 0) return { ok: false, fall: "patch.angaben" };
  const pfade = new Set<string>();
  for (const d of neu) {
    if (!istRepoPfad(d.pfad) || pfade.has(d.pfad)) return { ok: false, fall: "patch.angaben" };
    pfade.add(d.pfad);
  }
  // Kennungen: aus dem Baum, gleiche Bytes übernommen, sonst gerechnet
  const altNach = new Map(alt.dateien.map((d) => [d.pfad, d]));
  const sha = new Map<ArbeitsDatei, string>();
  for (const d of alt.dateien) sha.set(d, d.sha ?? (await objektSha("blob", d.daten)));
  for (const d of neu) {
    const vorher = altNach.get(d.pfad);
    const gleich = vorher && vorher.daten.length === d.daten.length && vorher.daten.every((x, i) => x === d.daten[i]);
    sha.set(d, gleich ? sha.get(vorher)! : d.sha ?? (await objektSha("blob", d.daten)));
  }
  const neuNach = new Map(neu.map((d) => [d.pfad, d]));
  const alle = [...new Set([...altNach.keys(), ...neuNach.keys()])].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  const geaendert: string[] = [];
  let diffs = "";
  for (const pfad of alle) {
    const x = altNach.get(pfad), y = neuNach.get(pfad);
    if (x && y && x.art === y.art && sha.get(x) === sha.get(y)) continue;
    geaendert.push(pfad);
    // Art gewechselt zwischen Verweis und Datei: wie git als Löschen und Anlegen
    const teile = x && y && (x.art === "verweis") !== (y.art === "verweis") ? [dateiDiff(pfad, x, undefined, sha), dateiDiff(pfad, undefined, y, sha)] : [dateiDiff(pfad, x, y, sha)];
    for (const t of teile) {
      if (t === "binaer") return { ok: false, fall: "patch.binaer" };
      if (t === null) return { ok: false, fall: "patch.gross" };
      diffs += t;
    }
  }
  if (geaendert.length === 0) return { ok: false, fall: "patch.keine-aenderung" };
  const baum = await baumSha([
    ...neu.map((d) => ({ pfad: d.pfad, modus: MODUS[d.art], sha: sha.get(d)! })),
    ...alt.module.filter((m) => !neuNach.has(m.pfad)).map((m) => ({ pfad: m.pfad, modus: "160000", sha: m.sha })),
  ]);
  const person = `${name} <${a.mail}> ${a.zeit} +0000`;
  const nachricht = `${betreff}\n${beschreibung ? `\n${beschreibung}\n` : ""}`;
  const commit = await objektSha("commit", enc.encode(`tree ${baum}\nparent ${alt.commit}\nauthor ${person}\ncommitter ${person}\n\n${nachricht}`));
  const nichtAscii = /[^\x00-\x7f]/.test(name + betreff + beschreibung + diffs);
  const text = `From ${commit} Mon Sep 17 00:00:00 2001\nFrom: ${kopfWort(name)} <${a.mail}>\nDate: ${mailDatum(a.zeit)}\n`
    + `Subject: [PATCH] ${kopfWort(betreff)}\n`
    + (nichtAscii ? "MIME-Version: 1.0\nContent-Type: text/plain; charset=UTF-8\nContent-Transfer-Encoding: 8bit\n" : "")
    + `\n${beschreibung ? `${beschreibung}\n` : ""}---\n${diffs}`;
  if (enc.encode(text).length > PATCH_MAX_BYTES) return { ok: false, fall: "patch.gross" };
  lesePatchText(text);
  return { ok: true, text, commit, geaendert };
}
