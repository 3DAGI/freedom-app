/**
 * Durchsatz des KI-Antriebs messen (Sammlung B-29b, Anhang E): dasselbe Modell
 * bei einer und bei N gleichzeitigen Anfragen. Welcher Antrieb auf dem GX10
 * läuft (Ollama, vLLM, SGLang, TensorFold), entscheidet diese Messung (MENSCH).
 *
 * Gemessen wird über denselben Weg wie echte Anfragen (`complete()` mit
 * Systemprompt), aber ohne Werkzeuge – eine Websuche gehört nicht zur Messung.
 * Die Fragen sind feste Übungsfragen; Antworten gehen nirgends hin, Fehler nur
 * mit ihrem Namen (Kein Klartext im Knoten).
 */
import type { InferenceBackend } from "./inference.js";

/** Grenzen der Kommandozeile – mehr hält ein Gerät nicht sinnvoll aus, weniger ist keine Messung. */
export const MESS_GRENZEN = { gleichzeitig: 64, stufen: 8, anfragen: 512, tokensMin: 16, tokensMax: 4096 } as const;

export interface MessWunsch {
  /** Modellname beim Antrieb; leer: das erste aus `PROVIDER_MODELS`. */
  modell?: string;
  /** Stufen, z. B. [1, 4, 8]. */
  gleichzeitig: number[];
  /** Anfragen je Stufe; leer: doppelt so viele wie gleichzeitig, mindestens 4. */
  anfragen?: number;
  /** Grenze je Antwort (`maxTokens`). */
  tokens: number;
}

/** Feste Übungsfragen – wechselnd, damit kein Antrieb dieselbe Antwort aus einem Zwischenspeicher liefert. */
export const MESS_FRAGEN = [
  "Erkläre in etwa 150 Wörtern, wie ein Kühlschrank funktioniert.",
  "Schreibe eine kurze Geschichte über einen Leuchtturmwärter, etwa 150 Wörter.",
  "Nenne fünf Vor- und Nachteile von Fahrrädern in der Stadt, je mit einem Satz.",
  "Explain in about 150 words how a solar panel turns light into electricity.",
  "Beschreibe in etwa 150 Wörtern den Wasserkreislauf der Erde.",
  "Write about 150 words on why bread rises when it is baked.",
  "Erkläre einem Kind in etwa 150 Wörtern, warum der Himmel blau ist.",
  "Summarize in about 150 words how a bicycle gear system works.",
] as const;

const ZAHLEN = /^\d{1,4}$/;

/** `--gleichzeitig 1,4,8 --anfragen 16 --tokens 256 --modell <name>` – ungültig: Grund. */
export function leseMessWunsch(args: string[]): { wunsch: MessWunsch; grund?: undefined } | { wunsch?: undefined; grund: string } {
  const wert = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const bekannt = new Set(["--modell", "--gleichzeitig", "--anfragen", "--tokens"]);
  for (let i = 0; i < args.length; i += 2) {
    if (!bekannt.has(args[i]!) || args[i + 1] === undefined) return { grund: "Aufruf: npm run messen -- [--modell <name>] [--gleichzeitig 1,4,8] [--anfragen <n>] [--tokens <n>]" };
  }
  const stufen = (wert("gleichzeitig") ?? "1,4").split(",");
  if (!stufen.every((s) => ZAHLEN.test(s))) return { grund: "--gleichzeitig: ganze Zahlen, durch Komma getrennt" };
  const gleichzeitig = [...new Set(stufen.map(Number))].sort((a, b) => a - b);
  if (gleichzeitig.length > MESS_GRENZEN.stufen || gleichzeitig.some((n) => n < 1 || n > MESS_GRENZEN.gleichzeitig)) {
    return { grund: `--gleichzeitig: höchstens ${MESS_GRENZEN.stufen} Stufen von 1 bis ${MESS_GRENZEN.gleichzeitig}` };
  }
  const roh = wert("anfragen");
  if (roh !== undefined && (!ZAHLEN.test(roh) || Number(roh) < 1 || Number(roh) > MESS_GRENZEN.anfragen)) {
    return { grund: `--anfragen: 1 bis ${MESS_GRENZEN.anfragen}` };
  }
  const tokens = wert("tokens") ?? "256";
  if (!ZAHLEN.test(tokens) || Number(tokens) < MESS_GRENZEN.tokensMin || Number(tokens) > MESS_GRENZEN.tokensMax) {
    return { grund: `--tokens: ${MESS_GRENZEN.tokensMin} bis ${MESS_GRENZEN.tokensMax}` };
  }
  const modell = wert("modell");
  return { wunsch: { gleichzeitig, tokens: Number(tokens), ...(roh !== undefined ? { anfragen: Number(roh) } : {}), ...(modell ? { modell } : {}) } };
}

/** Anfragen einer Stufe: wie gewünscht, sonst doppelt so viele wie gleichzeitig, mindestens 4. */
export function anfragenFuer(w: Pick<MessWunsch, "anfragen">, gleichzeitig: number): number {
  return w.anfragen ?? Math.max(4, 2 * gleichzeitig);
}

/** Eine Stufe: Anfragen, Wanduhr, je Anfrage Dauer und Tokens; Fehler nur mit Namen. */
export interface MessStufe {
  gleichzeitig: number;
  anfragen: number;
  ms: number;
  dauern: number[];
  tokens: number;
  /** Anfragen, für die der Antrieb keine Tokens nannte – dann gibt es keine Tokens je Sekunde. */
  ohneTokens: number;
  fehler: string[];
}

/** Höchstens `gleichzeitig` Anfragen zugleich, bis `anfragen` gestellt sind. */
export async function missStufe(
  backend: Pick<InferenceBackend, "complete">,
  e: { modell: string; gleichzeitig: number; anfragen: number; tokens: number; jetzt?: () => number },
): Promise<MessStufe> {
  const jetzt = e.jetzt ?? (() => performance.now());
  const stufe: MessStufe = { gleichzeitig: e.gleichzeitig, anfragen: e.anfragen, ms: 0, dauern: [], tokens: 0, ohneTokens: 0, fehler: [] };
  let naechste = 0;
  const arbeiter = async () => {
    while (naechste < e.anfragen) {
      const nr = naechste++;
      const start = jetzt();
      try {
        const r = await backend.complete({
          jobId: `messung-${e.gleichzeitig}-${nr}`, prompt: MESS_FRAGEN[nr % MESS_FRAGEN.length]!,
          model: e.modell, maxTokens: e.tokens, ohneWerkzeuge: true,
        });
        stufe.dauern.push(jetzt() - start);
        if (r.completionTokens > 0) stufe.tokens += r.completionTokens;
        else stufe.ohneTokens++;
      } catch (err) {
        stufe.fehler.push(err instanceof Error ? err.name : "unbekannt");
      }
    }
  };
  const start = jetzt();
  await Promise.all(Array.from({ length: Math.min(e.gleichzeitig, e.anfragen) }, arbeiter));
  stufe.ms = jetzt() - start;
  return stufe;
}

/** Wert an der Stelle `anteil` (0,5 = Median) der sortierten Dauern. */
function stelle(sortiert: number[], anteil: number): number {
  return sortiert[Math.min(sortiert.length - 1, Math.ceil(anteil * sortiert.length) - 1)] ?? 0;
}

export interface MessAuswertung {
  gleichzeitig: number;
  fertig: number;
  fehler: number;
  /** Erzeugte Tokens je Sekunde über alle gleichzeitigen Anfragen; undefined, wenn der Antrieb keine nannte. */
  tokensJeSek?: number;
  antwortenJeMin: number;
  medianSek: number;
  p95Sek: number;
}

export function werteAus(s: MessStufe): MessAuswertung {
  const sortiert = [...s.dauern].sort((a, b) => a - b);
  const sek = s.ms / 1000;
  return {
    gleichzeitig: s.gleichzeitig,
    fertig: s.dauern.length,
    fehler: s.fehler.length,
    ...(s.ohneTokens === 0 && s.dauern.length && sek > 0 ? { tokensJeSek: s.tokens / sek } : {}),
    antwortenJeMin: sek > 0 ? (s.dauern.length / sek) * 60 : 0,
    medianSek: stelle(sortiert, 0.5) / 1000,
    p95Sek: stelle(sortiert, 0.95) / 1000,
  };
}

/** Tabelle für die Kommandozeile; der Faktor bezieht sich auf die erste Stufe. */
export function messTabelle(antrieb: string, modell: string, auswertungen: MessAuswertung[], fehler: string[] = []): string {
  const zahl = (n: number, s = 1) => n.toFixed(s).replace(".", ",");
  // Faktor über Tokens je Sekunde, wenn jede Stufe sie hat – sonst über Antworten je Minute, nie gemischt
  const mitTokens = auswertungen.every((a) => a.tokensJeSek !== undefined);
  const wertVon = (a: MessAuswertung) => (mitTokens ? a.tokensJeSek! : a.antwortenJeMin);
  const basis = auswertungen[0] ? wertVon(auswertungen[0]) : 0;
  const zeilen = auswertungen.map((a) => {
    const faktor = basis > 0 ? `${zahl(wertVon(a) / basis, 2)}×` : "–";
    return [String(a.gleichzeitig).padStart(12), `${a.fertig}/${a.fertig + a.fehler}`.padStart(8),
      (a.tokensJeSek === undefined ? "–" : zahl(a.tokensJeSek)).padStart(10), zahl(a.antwortenJeMin).padStart(12),
      zahl(a.medianSek, 2).padStart(10), zahl(a.p95Sek, 2).padStart(9), faktor.padStart(8)].join(" ");
  });
  const namen = [...new Set(fehler)];
  return [
    `Antrieb ${antrieb}, Modell ${modell}`,
    `${"gleichzeitig".padStart(12)} ${"fertig".padStart(8)} ${"Tokens/s".padStart(10)} ${"Antw./min".padStart(12)} ${"Median s".padStart(10)} ${"p95 s".padStart(9)} ${"Faktor".padStart(8)}`,
    ...zeilen,
    ...(!mitTokens ? ["Tokens/s „–“: Der Antrieb nannte keine Zahl der Tokens – der Faktor rechnet dann mit Antworten je Minute."] : []),
    ...(namen.length ? [`Fehler (nur Namen): ${namen.join(", ")}`] : []),
  ].join("\n");
}
