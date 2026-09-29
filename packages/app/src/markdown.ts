/**
 * Markdown lesen (Schritt C-20a, Sammlung C-20): README, Issues und
 * Kommentare wie bei GitHub. Hier nur der Leser – er liefert einen Baum aus
 * Blöcken und Inline-Teilen, ohne DOM; gezeichnet wird er in
 * `shell/markdown-ui.ts` nur mit `createElement` und `textContent`.
 *
 * Bewusst eine Teilmenge von CommonMark und GFM: Überschriften, Absätze,
 * Listen (auch Aufgaben), Zitate, Code-Blöcke, Linien, Tabellen (seit C-20b);
 * inline Code, fett, kursiv, durchgestrichen, Links, Bilder, Umbrüche. Rohes
 * HTML bleibt Text. Links nur auf https (wie `sichereWebAdressen()`), Bilder
 * werden nie geladen – ein Bild vom fremden Server verriete, wer wann liest.
 * Relative Ziele („docs/x.md“) sind Verweise ins Repo (`loesePfad()`) –
 * die Oberfläche öffnet sie im Reiter „Code“, nie als Adresse.
 *
 * Alles kommt von Fremden: Länge, Tiefe und Suchweite sind begrenzt.
 */

export const MD_GRENZEN = { zeichen: 100_000, tiefe: 8, suche: 1_000, schritte: 1_000_000, spalten: 64 } as const;

/** Suchschritte des laufenden `leseMarkdown()` – danach bleibt der Rest Text (nie quadratisch lange). */
let schritte = 0;
const leer = (z: string | undefined): boolean => z === undefined || z === " " || z === "\n" || z === "\t";

export type MdInline =
  | { art: "text"; text: string }
  | { art: "code"; text: string }
  | { art: "fett" | "kursiv" | "durch"; kinder: MdInline[] }
  | { art: "link"; ziel: string; kinder: MdInline[] }
  /** Relatives Ziel im Repo (C-20b) – kein Link nach außen. */
  | { art: "verweis"; ziel: string; kinder: MdInline[] }
  | { art: "bild"; ziel: string | null; alt: string }
  | { art: "umbruch" };

export interface MdPunkt { kinder: MdBlock[]; erledigt?: boolean }
export type MdAusrichtung = "" | "links" | "mitte" | "rechts";

export type MdBlock =
  | { art: "ueberschrift"; stufe: number; inhalt: MdInline[] }
  | { art: "absatz"; inhalt: MdInline[] }
  | { art: "code"; sprache: string; text: string }
  | { art: "zitat"; kinder: MdBlock[] }
  | { art: "liste"; geordnet: boolean; start: number; punkte: MdPunkt[] }
  | { art: "linie" }
  | { art: "tabelle"; ausrichtung: MdAusrichtung[]; kopf: MdInline[][]; zeilen: MdInline[][][] };

export interface MdOptionen {
  /** Zeilenumbruch im Absatz bleibt Umbruch (GitHub in Issues und Kommentaren); sonst ein Leerzeichen (README). */
  umbrueche?: boolean;
}

/** Ziel eines Links: nur https ohne Zugangsdaten – sonst `null`, dann bleibt es Text. */
export function sicheresZiel(ziel: string): string | null {
  try {
    const u = new URL(ziel);
    return u.protocol === "https:" && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}

/** Relatives Ziel: kein Schema, kein „//“, kein bloßer Anker. */
const istRelativ = (ziel: string): boolean => !!ziel && !/^[a-z][a-z0-9+.-]*:/i.test(ziel) && !ziel.startsWith("//") && !ziel.startsWith("#");

/**
 * Relatives Ziel eines Verweises (C-20b) gegen den Ordner `basis` auflösen –
 * `/…` ab der Wurzel, Anker und Abfrage fallen weg. `null`, wenn es aus dem
 * Repo hinausführt („..“ über die Wurzel) oder unlesbar ist.
 */
export function loesePfad(basis: readonly string[], ziel: string): string[] | null {
  let roh = ziel.split(/[?#]/)[0]!;
  try {
    roh = decodeURIComponent(roh);
  } catch {
    return null;
  }
  if (!roh || roh.includes("\0") || roh.includes("\\")) return null;
  const teile = roh.startsWith("/") ? [] : [...basis];
  for (const teil of roh.split("/")) {
    if (teil === "" || teil === ".") continue;
    if (teil !== "..") teile.push(teil);
    else if (!teile.pop()) return null;
  }
  return teile;
}

const ZAUN = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/;
const UEBERSCHRIFT = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const LINIE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const ZITAT = /^ {0,3}> ?(.*)$/;
const PUNKT = /^( {0,3})([-+*]|\d{1,9}[.)])(?:([ \t]+)(.*))?$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const AUFGABE = /^\[([ xX])\][ \t]+/;
const TRENNER = /^[ \t]*:?-+:?[ \t]*$/;
const ESCAPEBAR = /^[!-/:-@[-`{-~]$/;

/** Spalten des Einzugs (Tab bis zur nächsten Vierer-Spalte) und der Rest der Zeile. */
function fuehrend(z: string): [number, string] {
  let spalte = 0;
  let i = 0;
  for (; i < z.length; i++) {
    if (z[i] === " ") spalte++;
    else if (z[i] === "\t") spalte += 4 - (spalte % 4);
    else break;
  }
  return [spalte, z.slice(i)];
}
const ohneEinzug = (z: string, n: number): string => {
  const [spalte, rest] = fuehrend(z);
  return " ".repeat(Math.max(0, spalte - n)) + rest;
};
const punktArt = (m: RegExpExecArray): string => (/\d/.test(m[2]!) ? `1${m[2]!.slice(-1)}` : m[2]!);

/** Beginnt hier ein Block, der einen Absatz unterbricht? */
function beginntBlock(z: string): boolean {
  if (ZAUN.test(z) || UEBERSCHRIFT.test(z) || LINIE.test(z) || ZITAT.test(z)) return true;
  const p = PUNKT.exec(z);
  return !!p && !!p[4]?.trim() && (!/\d/.test(p[2]!) || /^1[.)]$/.test(p[2]!));
}

/** Markdown in Blöcke – höchstens `MD_GRENZEN.zeichen` Zeichen. */
export function leseMarkdown(quelle: string, o: MdOptionen = {}): MdBlock[] {
  const text = quelle.slice(0, MD_GRENZEN.zeichen).replace(/\r\n?/g, "\n");
  schritte = 0;
  return bloecke(text.split("\n"), 0, o.umbrueche ?? false);
}

function bloecke(zeilen: string[], tiefe: number, umbr: boolean): MdBlock[] {
  // Zu tief verschachtelt: der Rest bleibt Text
  if (tiefe >= MD_GRENZEN.tiefe) return zeilen.some((z) => z.trim()) ? [{ art: "absatz", inhalt: [{ art: "text", text: zeilen.join("\n").trim() }] }] : [];
  const aus: MdBlock[] = [];
  let i = 0;
  while (i < zeilen.length) {
    const z = zeilen[i]!;
    let m: RegExpExecArray | null;
    if (!z.trim()) {
      i++;
    } else if ((m = ZAUN.exec(z))) {
      const zu = new RegExp(`^ {0,3}${m[1]![0] === "`" ? "`" : "~"}{${m[1]!.length},}[ \\t]*$`);
      const einzug = fuehrend(z)[0];
      const code: string[] = [];
      for (i++; i < zeilen.length && !zu.test(zeilen[i]!); i++) code.push(ohneEinzug(zeilen[i]!, einzug));
      i++;
      aus.push({ art: "code", sprache: m[2] ?? "", text: code.join("\n") });
    } else if ((m = UEBERSCHRIFT.exec(z))) {
      aus.push({ art: "ueberschrift", stufe: m[1]!.length, inhalt: inline((m[2] ?? "").trim(), 0, umbr) });
      i++;
    } else if (LINIE.test(z)) {
      aus.push({ art: "linie" });
      i++;
    } else if (ZITAT.test(z)) {
      const innen: string[] = [];
      for (; i < zeilen.length; i++) {
        const q = ZITAT.exec(zeilen[i]!);
        // Ohne „>“ geht nur Absatztext weiter (wie CommonMark)
        if (q) innen.push(q[1]!);
        else if (zeilen[i]!.trim() && innen.at(-1)?.trim() && !beginntBlock(zeilen[i]!) && !PUNKT.test(zeilen[i]!)) innen.push(zeilen[i]!);
        else break;
      }
      aus.push({ art: "zitat", kinder: bloecke(innen, tiefe + 1, umbr) });
    } else if (PUNKT.test(z)) {
      i = liste(zeilen, i, tiefe, umbr, aus);
    } else if (tabelleBeginnt(zeilen, i)) {
      i = tabelle(zeilen, i, umbr, aus);
    } else if (fuehrend(z)[0] >= 4) {
      const code: string[] = [];
      for (; i < zeilen.length && (fuehrend(zeilen[i]!)[0] >= 4 || !zeilen[i]!.trim()); i++) code.push(ohneEinzug(zeilen[i]!, 4));
      while (code.length && !code.at(-1)!.trim()) code.pop();
      aus.push({ art: "code", sprache: "", text: code.join("\n") });
    } else {
      // Absatz bis zur Leerzeile oder einem anderen Block; darunter === bzw. --- macht ihn zur Überschrift
      const absatz = [z.trimStart()];
      let stufe = 0;
      for (i++; i < zeilen.length && zeilen[i]!.trim(); i++) {
        const s = SETEXT.exec(zeilen[i]!);
        if (s) {
          stufe = s[1]![0] === "=" ? 1 : 2;
          i++;
          break;
        }
        if (beginntBlock(zeilen[i]!) || tabelleBeginnt(zeilen, i)) break;
        absatz.push(zeilen[i]!.trimStart());
      }
      const inhalt = inline(absatz.join("\n").trimEnd(), 0, umbr);
      aus.push(stufe ? { art: "ueberschrift", stufe, inhalt } : { art: "absatz", inhalt });
    }
  }
  return aus;
}

/** Eine Liste ab Zeile `i` – Punkte derselben Art, Leerzeilen dazwischen erlaubt; gibt die nächste Zeile zurück. */
function liste(zeilen: string[], i: number, tiefe: number, umbr: boolean, aus: MdBlock[]): number {
  const erster = PUNKT.exec(zeilen[i]!)!;
  const art = punktArt(erster);
  const geordnet = /\d/.test(erster[2]!);
  const punkte: MdPunkt[] = [];
  for (;;) {
    let j = i;
    while (j < zeilen.length && !zeilen[j]!.trim()) j++;
    const m = j < zeilen.length ? PUNKT.exec(zeilen[j]!) : null;
    if (!m || LINIE.test(zeilen[j]!) || punktArt(m) !== art) break;
    const abstand = m[3] === undefined || fuehrend(m[3])[0] > 4 ? 1 : fuehrend(m[3])[0];
    const einzug = m[1]!.length + m[2]!.length + abstand;
    const inhalt = [m[3] !== undefined && abstand === 1 && fuehrend(m[3])[0] > 4 ? " ".repeat(fuehrend(m[3])[0] - 1) + (m[4] ?? "") : (m[4] ?? "")];
    for (i = j + 1; i < zeilen.length; i++) {
      const z = zeilen[i]!;
      if (!z.trim()) {
        // Leerzeilen gehören dazu, wenn danach eingerückt weitergeht
        let k = i + 1;
        while (k < zeilen.length && !zeilen[k]!.trim()) k++;
        if (k >= zeilen.length || fuehrend(zeilen[k]!)[0] < einzug) break;
        inhalt.push("");
      } else if (fuehrend(z)[0] >= einzug) inhalt.push(ohneEinzug(z, einzug));
      else if (inhalt.at(-1)?.trim() && !beginntBlock(z) && !PUNKT.test(z)) inhalt.push(z.trimStart());
      else break;
    }
    const aufgabe = AUFGABE.exec(inhalt[0]!);
    if (aufgabe) inhalt[0] = inhalt[0]!.slice(aufgabe[0].length);
    punkte.push({ kinder: bloecke(inhalt, tiefe + 1, umbr), ...(aufgabe ? { erledigt: aufgabe[1] !== " " } : {}) });
  }
  aus.push({ art: "liste", geordnet, start: geordnet ? Number.parseInt(erster[2]!, 10) : 1, punkte });
  return i;
}

/** Zellen einer Tabellenzeile: an „|“ getrennt, Rand-„|“ weg, „\|“ bleibt ein Strich im Text. */
function zellen(z: string): string[] {
  let s = z.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const aus: string[] = [];
  let jetzt = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") {
      jetzt += "|";
      i++;
    } else if (s[i] === "|") {
      aus.push(jetzt.trim());
      jetzt = "";
    } else jetzt += s[i];
  }
  aus.push(jetzt.trim());
  return aus;
}

/** Beginnt hier eine Tabelle (GFM)? Kopf und Trennzeile mit „|“ und gleich vielen Spalten. */
function tabelleBeginnt(zeilen: string[], i: number): boolean {
  const kopf = zeilen[i];
  const trenner = zeilen[i + 1];
  if (!kopf?.includes("|") || !trenner?.includes("|") || fuehrend(kopf)[0] >= 4) return false;
  const spalten = zellen(trenner);
  return spalten.length <= MD_GRENZEN.spalten && spalten.every((x) => TRENNER.test(x)) && zellen(kopf).length === spalten.length;
}

/** Tabelle ab Zeile `i` – Zeilen bis zur Leerzeile oder einem anderen Block, auf die Spalten des Kopfs gebracht. */
function tabelle(zeilen: string[], i: number, umbr: boolean, aus: MdBlock[]): number {
  const zelle = (x: string) => inline(x, 0, umbr);
  const ausrichtung = zellen(zeilen[i + 1]!).map((x): MdAusrichtung => {
    const t = x.trim();
    return t.startsWith(":") && t.endsWith(":") ? "mitte" : t.startsWith(":") ? "links" : t.endsWith(":") ? "rechts" : "";
  });
  const kopf = zellen(zeilen[i]!).map(zelle);
  const reihen: MdInline[][][] = [];
  for (i += 2; i < zeilen.length && zeilen[i]!.trim() && !beginntBlock(zeilen[i]!); i++) {
    const r = zellen(zeilen[i]!);
    reihen.push(ausrichtung.map((_, n) => zelle(r[n] ?? "")));
  }
  aus.push({ art: "tabelle", ausrichtung, kopf, zeilen: reihen });
  return i;
}

/** Inline-Teile eines Absatzes oder einer Überschrift. */
function inline(text: string, tiefe: number, umbr: boolean): MdInline[] {
  const aus: MdInline[] = [];
  let puffer = "";
  const setze = (x: MdInline) => {
    if (puffer) aus.push({ art: "text", text: puffer });
    puffer = "";
    aus.push(x);
  };
  for (let i = 0; i < text.length;) {
    const c = text[i]!;
    if (c === "\\" && text[i + 1] === "\n") {
      setze({ art: "umbruch" });
      i += 2;
    } else if (c === "\\" && ESCAPEBAR.test(text[i + 1] ?? "")) {
      puffer += text[i + 1];
      i += 2;
    } else if (c === "\n") {
      // Zwei Leerzeichen am Zeilenende: harter Umbruch (CommonMark)
      const hart = puffer.endsWith("  ");
      puffer = puffer.trimEnd();
      if (hart || umbr) setze({ art: "umbruch" });
      else puffer += " ";
      i++;
    } else if (c === "`") {
      let n = 1;
      while (text[i + n] === "`") n++;
      const ende = codeEnde(text, i + n, n);
      if (ende < 0) {
        puffer += "`".repeat(n);
        i += n;
      } else {
        const roh = text.slice(i + n, ende).replace(/\n/g, " ");
        setze({ art: "code", text: /^ .*[^ ].* $/.test(roh) ? roh.slice(1, -1) : roh });
        i = ende + n;
      }
    } else {
      const teil = tiefe < MD_GRENZEN.tiefe && schritte < MD_GRENZEN.schritte ? auszeichnung(text, i, tiefe, umbr, puffer) : null;
      if (teil) {
        if (Array.isArray(teil.teil)) {
          // Link auf ein Ziel, das nicht erlaubt ist: nur sein Text
          for (const x of teil.teil) if (x.art === "text") puffer += x.text; else setze(x);
        } else setze(teil.teil);
        i = teil.ende;
      } else {
        puffer += c;
        i++;
      }
    }
  }
  if (puffer) aus.push({ art: "text", text: puffer });
  return aus;
}

/** Ende eines Code-Spans: der nächste Lauf aus genau `n` Backticks. */
function codeEnde(text: string, ab: number, n: number): number {
  for (let j = text.indexOf("`", ab); j >= 0 && j < ab + MD_GRENZEN.suche && schritte++ < MD_GRENZEN.schritte;) {
    let k = j;
    while (text[k] === "`") k++;
    if (k - j === n) return j;
    j = text.indexOf("`", k);
  }
  return -1;
}

type Treffer = { teil: MdInline | MdInline[]; ende: number } | null;

/** Link, Bild, Adresse oder Betonung ab `i` – sonst `null`. */
function auszeichnung(text: string, i: number, tiefe: number, umbr: boolean, davor: string): Treffer {
  const c = text[i]!;
  if (c === "[" || (c === "!" && text[i + 1] === "[")) {
    const bild = c === "!";
    const l = linkAb(text, bild ? i + 1 : i);
    if (!l) return null;
    const ziel = sicheresZiel(l.ziel);
    if (bild) return { teil: { art: "bild", ziel, alt: l.text.replace(/[\\*_`~[\]]/g, "") }, ende: l.ende };
    const kinder = inline(l.text, tiefe + 1, umbr);
    if (ziel) return { teil: { art: "link", ziel, kinder }, ende: l.ende };
    return { teil: istRelativ(l.ziel) ? { art: "verweis", ziel: l.ziel, kinder } : kinder, ende: l.ende };
  }
  if (c === "<") {
    const m = /^<(https:\/\/[^\s<>]+)>/.exec(text.slice(i, i + MD_GRENZEN.suche));
    const ziel = m ? sicheresZiel(m[1]!) : null;
    return m && ziel ? { teil: { art: "link", ziel, kinder: [{ art: "text", text: m[1]! }] }, ende: i + m[0].length } : null;
  }
  if (c === "h" && text.startsWith("https://", i) && !/[\p{L}\p{N}_/]$/u.test(davor)) {
    // Nackte Adresse (GFM): Satzzeichen am Ende gehören nicht dazu
    const m = /^https:\/\/[^\s<]*[^\s<?!.,:;*_~'")\]]/.exec(text.slice(i, i + MD_GRENZEN.suche));
    const ziel = m ? sicheresZiel(m[0]) : null;
    return m && ziel ? { teil: { art: "link", ziel, kinder: [{ art: "text", text: m[0] }] }, ende: i + m[0].length } : null;
  }
  if (c === "*" || c === "_" || c === "~") return betonung(text, i, tiefe, umbr, davor);
  return null;
}

/** `[text](ziel "titel")` ab der öffnenden Klammer – Klammern im Text dürfen verschachtelt sein. */
function linkAb(text: string, i: number): { text: string; ziel: string; ende: number } | null {
  const grenze = Math.min(text.length, i + MD_GRENZEN.suche);
  let tief = 0;
  let j = i;
  for (; j < grenze && schritte++ < MD_GRENZEN.schritte; j++) {
    if (text[j] === "\\") j++;
    else if (text[j] === "[") tief++;
    else if (text[j] === "]" && --tief === 0) break;
  }
  if (j >= grenze || text[j] !== "]" || text[j + 1] !== "(") return null;
  const m = /^\([ \t\n]*(<[^<>\n]*>|[^\s()<>]*(?:\([^\s()<>]*\)[^\s()<>]*)*)(?:[ \t\n]+("[^"]*"|'[^']*'))?[ \t\n]*\)/.exec(text.slice(j + 1, j + 1 + MD_GRENZEN.suche));
  if (!m) return null;
  const ziel = m[1]!.startsWith("<") ? m[1]!.slice(1, -1) : m[1]!;
  return { text: text.slice(i + 1, j), ziel, ende: j + 1 + m[0].length };
}

/**
 * Fett (`**`, `__`), kursiv (`*`, `_`), beides (`***`), durchgestrichen (`~~`).
 * Öffnen nicht vor Leerraum, schließen nicht nach Leerraum; `_` nur an
 * Wortgrenzen (snake_case bleibt Text).
 */
function betonung(text: string, i: number, tiefe: number, umbr: boolean, davor: string): Treffer {
  const c = text[i]!;
  let n = 1;
  while (text[i + n] === c && n < 3) n++;
  if (c === "~" && n !== 2) return null;
  if (c === "_" && /[\p{L}\p{N}]$/u.test(davor)) return null;
  for (const lang of n === 3 ? [3, 2, 1] : [n]) {
    const zeichen = c.repeat(lang);
    const ab = i + lang;
    if (leer(text[ab])) continue;
    for (let j = text.indexOf(zeichen, ab + 1); j >= 0 && j < ab + MD_GRENZEN.suche && schritte++ < MD_GRENZEN.schritte; j = text.indexOf(zeichen, j + 1)) {
      if (leer(text[j - 1]) || text[j - 1] === c) continue;
      if (lang < 3 && text[j + lang] === c && (lang === 1 || c === "~")) continue;
      if (c === "_" && /[\p{L}\p{N}]/u.test(text[j + lang] ?? "")) continue;
      const innen = inline(text.slice(ab, j), tiefe + 1, umbr);
      const teil: MdInline = lang === 3 ? { art: "fett", kinder: [{ art: "kursiv", kinder: innen }] }
        : { art: c === "~" ? "durch" : lang === 2 ? "fett" : "kursiv", kinder: innen };
      return { teil, ende: j + lang };
    }
  }
  return null;
}
