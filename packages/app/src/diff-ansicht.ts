/**
 * Diff-Leser (Schritt C.3b1): liest den Text aus `git format-patch` – Autor,
 * Datum, Nachricht und je Datei die Abschnitte mit Zeilennummern – ohne DOM,
 * damit testbar. Gezeichnet wird in `shell/tabs/patch-seite.ts`, nur über
 * `textContent`.
 *
 * Der Text kommt von Fremden: Zahlen werden geprüft, alles ist begrenzt
 * (`DIFF_GRENZEN`); was nicht passt, fällt weg oder beendet den Abschnitt –
 * der Leser wirft nie.
 */

export const DIFF_GRENZEN = {
  /** Höchstens so viele Dateien … */
  dateien: 200,
  /** … und Zeilen in Abschnitten; darüber ist der Diff „gekürzt“. */
  zeilen: 5000,
  /** Zeichen je Zeile, Pfad und Kopf. */
  zeichen: 2000,
  /** Zeilennummern darüber sind Unfug. */
  nummer: 10_000_000,
} as const;

export type ZeilenArt = "kontext" | "neu" | "weg" | "hinweis";

export interface DiffZeile {
  art: ZeilenArt;
  text: string;
  /** Zeilennummer vorher bzw. nachher – fehlt, wo die Zeile dort nicht steht. */
  alt?: number;
  neu?: number;
}

export interface DiffAbschnitt {
  /** Die `@@ … @@`-Zeile samt Kontext dahinter. */
  kopf: string;
  zeilen: DiffZeile[];
}

export type DateiArt = "geaendert" | "neu" | "geloescht" | "umbenannt";

export interface DiffDatei {
  /** Pfade ohne `a/` und `b/`. */
  alt: string;
  neu: string;
  art: DateiArt;
  binaer: boolean;
  plus: number;
  minus: number;
  abschnitte: DiffAbschnitt[];
}

export interface GelesenerDiff {
  /** Zeile „From:“ und „Date:“ aus dem Kopf, wie sie dastehen (gekürzt). */
  autor?: string;
  datum?: string;
  /** Commit-Nachricht nach dem Betreff, bis „---“. */
  nachricht: string;
  dateien: DiffDatei[];
  plus: number;
  minus: number;
  /** Mehr Dateien oder Zeilen als erlaubt – der Rest steht nur in der Datei. */
  gekuerzt: boolean;
}

const HUNK = /^@@ -(\d{1,9})(?:,(\d{1,9}))? \+(\d{1,9})(?:,(\d{1,9}))? @@(.*)$/;
const DIFF_GIT = /^diff --git a\/(.+) b\/(.+)$/;

const kurz = (s: string): string => s.slice(0, DIFF_GRENZEN.zeichen);
const ohnePraefix = (p: string, praefix: string): string => kurz(p.startsWith(praefix) ? p.slice(praefix.length) : p);

export function leseDiff(text: string): GelesenerDiff {
  const zeilen = String(text ?? "").split(/\r?\n/);
  const erg: GelesenerDiff = { nachricht: "", dateien: [], plus: 0, minus: 0, gekuerzt: false };
  let i = 0;

  // Kopf: From/Date, der Betreff (steht schon im Patch-Event) samt Folgezeilen, dann die Nachricht bis „---“.
  let imKopf = true;
  const nachricht: string[] = [];
  for (; i < zeilen.length && !zeilen[i]!.startsWith("diff --git "); i++) {
    const z = zeilen[i]!;
    if (imKopf) {
      if (z === "") imKopf = false;
      else if (z.startsWith("From: ")) erg.autor = kurz(z.slice(6).trim()); // kein UI-Text
      else if (z.startsWith("Date: ")) erg.datum = kurz(z.slice(6).trim()); // kein UI-Text
      continue;
    }
    if (z === "---") {
      // Danach folgt nur noch die Zusammenfassung („ x | 2 +-“) bis zum ersten Diff.
      for (; i < zeilen.length && !zeilen[i]!.startsWith("diff --git "); i++);
      break;
    }
    if (nachricht.length < 200) nachricht.push(kurz(z));
  }
  erg.nachricht = nachricht.join("\n").trim();

  let gesamt = 0;
  let datei: DiffDatei | null = null;
  while (i < zeilen.length) {
    const z = zeilen[i]!;
    const kopf = DIFF_GIT.exec(z);
    if (kopf) {
      if (erg.dateien.length >= DIFF_GRENZEN.dateien) {
        erg.gekuerzt = true;
        break;
      }
      datei = { alt: kurz(kopf[1]!), neu: kurz(kopf[2]!), art: "geaendert", binaer: false, plus: 0, minus: 0, abschnitte: [] };
      erg.dateien.push(datei);
      i++;
      continue;
    }
    if (!datei) {
      i++;
      continue;
    }
    if (z.startsWith("new file mode")) datei.art = "neu"; // kein UI-Text
    else if (z.startsWith("deleted file mode")) datei.art = "geloescht"; // kein UI-Text
    else if (z.startsWith("rename from ")) { datei.art = "umbenannt"; datei.alt = kurz(z.slice(12)); } // kein UI-Text
    else if (z.startsWith("rename to ")) { datei.art = "umbenannt"; datei.neu = kurz(z.slice(10)); } // kein UI-Text
    else if (z.startsWith("Binary files ") || z === "GIT binary patch") datei.binaer = true; // kein UI-Text
    else if (z.startsWith("--- ") && !datei.abschnitte.length) { if (z !== "--- /dev/null") datei.alt = ohnePraefix(z.slice(4), "a/"); }
    else if (z.startsWith("+++ ") && !datei.abschnitte.length) { if (z !== "+++ /dev/null") datei.neu = ohnePraefix(z.slice(4), "b/"); }
    else {
      const h = HUNK.exec(z);
      if (h) {
        const [altStart, neuStart] = [Number(h[1]), Number(h[3])];
        let altRest = h[2] === undefined ? 1 : Number(h[2]);
        let neuRest = h[4] === undefined ? 1 : Number(h[4]);
        if ([altStart, neuStart, altRest, neuRest].some((n) => n > DIFF_GRENZEN.nummer)) {
          i++;
          continue; // Unfug-Kopf: der Abschnitt fällt weg, seine Zeilen bleiben ungelesen
        }
        const abschnitt: DiffAbschnitt = { kopf: kurz(z), zeilen: [] };
        datei.abschnitte.push(abschnitt);
        let alt = altStart, neu = neuStart;
        i++;
        while (i < zeilen.length && (altRest > 0 || neuRest > 0 || zeilen[i]!.startsWith("\\"))) {
          if (gesamt >= DIFF_GRENZEN.zeilen) {
            erg.gekuerzt = true;
            break;
          }
          const zeile = zeilen[i]!;
          const zeichen = zeile[0];
          if ((zeichen === " " || zeile === "") && altRest > 0 && neuRest > 0) {
            abschnitt.zeilen.push({ art: "kontext", text: kurz(zeile.slice(1)), alt: alt++, neu: neu++ });
            altRest--;
            neuRest--;
          } else if (zeichen === "+" && neuRest > 0) {
            abschnitt.zeilen.push({ art: "neu", text: kurz(zeile.slice(1)), neu: neu++ });
            neuRest--;
            datei.plus++;
          } else if (zeichen === "-" && altRest > 0) {
            abschnitt.zeilen.push({ art: "weg", text: kurz(zeile.slice(1)), alt: alt++ });
            altRest--;
            datei.minus++;
          } else if (zeichen === "\\") {
            abschnitt.zeilen.push({ art: "hinweis", text: kurz(zeile.slice(1).trim()) });
          } else break; // passt nicht zu den Zahlen im Kopf: Abschnitt endet hier
          gesamt++;
          i++;
        }
        if (erg.gekuerzt) break;
        continue;
      }
    }
    i++;
  }
  for (const d of erg.dateien) {
    erg.plus += d.plus;
    erg.minus += d.minus;
  }
  return erg;
}
