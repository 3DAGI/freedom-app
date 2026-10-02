/**
 * Code in Antworten einfärben (seit C-6d2) – ohne DOM: der Text als Stücke mit
 * ihrer Art. Gezeichnet wird mit `textContent` (`shell/antwort-ui.ts`); vorher
 * baute `highlightCode()` HTML-Text. Grob und sprachübergreifend wie bisher:
 * Zeichenketten, Kommentare, Schlüsselwörter, Zahlen. Jedes Muster bleibt in
 * seiner Zeile, und lange Zeilen bleiben ungefärbt: Eine offene Zeichenkette
 * sucht bis zum Zeilenende – je Zeile höchstens `CODE_ZEILE_MAX` Schritte je
 * Anfang, sonst würde ein böser Text quadratisch langsam.
 */

export type CodeArt = "str" | "com" | "kw" | "num";
export interface CodeStueck { text: string; art?: CodeArt }

/** Länger wird nicht gefärbt, nur als Text gezeigt – der ganze Block und je Zeile. */
export const CODE_FARBE_MAX = 50_000;
export const CODE_ZEILE_MAX = 500;

// Wörter aus Programmiersprachen (JS/TS, Python, Rust gemischt – pragmatisch wie bisher)
const SCHLUESSELWOERTER = [
  "const", "let", "var", "function", "return", "if", "else", "for", "while", "import", "export", "from", "class", "extends",
  "new", "async", "await", "try", "catch", "throw", "typeof", "interface", "type", "public", "private", "def", "self",
  "None", "True", "False", "fn", "pub", "impl", "struct", "match", "use", "mut", "null", "undefined", "true", "false", // kein UI-Text
].join("|");

const MUSTER = new RegExp(
  String.raw`("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')` + // Zeichenkette in einer Zeile
  String.raw`|(\/\/[^\n]*|#[^\n]*|\/\*[^\n]*?\*\/)` + // Kommentar bis zum Zeilenende, /* … */ in einer Zeile
  String.raw`|\b(` + SCHLUESSELWOERTER + String.raw`)\b` +
  String.raw`|\b(\d+(?:\.\d+)?)\b`,
  "g",
);

/** Der Code als Stücke – zusammengesetzt wieder genau der Code. */
export function codeTeile(code: string): CodeStueck[] {
  if (code.length > CODE_FARBE_MAX) return [{ text: code }];
  const aus: CodeStueck[] = [];
  const roh = (text: string): void => {
    const letztes = aus[aus.length - 1];
    if (letztes && !letztes.art) letztes.text += text;
    else aus.push({ text });
  };
  // Kein Muster reicht über ein Zeilenende – also Zeile für Zeile
  for (const zeile of code.split(/(?<=\n)/)) {
    if (zeile.length > CODE_ZEILE_MAX) { roh(zeile); continue; }
    let pos = 0;
    for (const m of zeile.matchAll(MUSTER)) {
      const i = m.index ?? 0;
      if (i > pos) roh(zeile.slice(pos, i));
      aus.push({ text: m[0], art: m[1] ? "str" : m[2] ? "com" : m[3] ? "kw" : "num" });
      pos = i + m[0].length;
    }
    if (pos < zeile.length) roh(zeile.slice(pos));
  }
  return aus;
}
