/**
 * Redundanz-Konsens: wichtige Jobs an mehrere Provider, Vergleich beim Client.
 *
 * DAS PROBLEM, DAS DAS LÖST
 * In einem offenen Marktplatz kann ein Provider lügen: ein kleineres Modell
 * fahren als angeboten, abkürzen, oder gezielt falsch antworten. Ein zentraler
 * Anbieter löst das über Vertrauen in die Firma. Ein betreiberloses Protokoll
 * hat diese Option nicht — es braucht einen Mechanismus, der ohne Vertrauen
 * auskommt. Redundanz ist dieser Mechanismus: derselbe Job an N unabhängige
 * Provider, Vergleich der Antworten LOKAL beim Kunden.
 *
 * WICHTIG: Das ist keine Wahrheitsgarantie. Wenn alle Provider dasselbe
 * Basismodell fahren, teilen sie auch dessen Irrtümer — Übereinstimmung heißt
 * dann "konsistent", nicht "richtig". Was Redundanz tatsächlich erkennt, ist
 * ABWEICHUNG: ein Ausreißer bedeutet, dass mindestens einer nicht das geliefert
 * hat, was die anderen liefern. Genau das ist die Betrugserkennung.
 *
 * KOSTEN: N Provider = N-facher Preis. Deshalb ist das ein Opt-in pro Job
 * ("wichtige Frage"), kein Default. Der Client zeigt die Kosten vorher an.
 *
 * VERFAHREN
 *   1. Antworten normalisieren (Whitespace, Groß/Klein, Satzzeichen)
 *   2. Exakte Dubletten gruppieren -> stärkstes Signal
 *   3. Sonst paarweise Ähnlichkeit (Jaccard über Wort-Shingles)
 *   4. Cluster ab Schwellwert bilden; größter Cluster = Mehrheit
 *   5. Vertrauensgrad + Ausreißer melden, Entscheidung bleibt beim Nutzer
 */

/** Eine Antwort, die in den Vergleich eingeht. */
export interface ConsensusAnswer {
  providerPubkey: string;
  output: string;
  /** Für die Kostenanzeige und Gewichtung nach Reputation. */
  amountMsat?: number;
  /** Optional: Reputationsgewicht (jobsCompleted/trust). Default 1. */
  weight?: number;
  /** Optional: welches Modell der Provider gemeldet hat. */
  model?: string;
}

export type ConsensusVerdict =
  /** Alle inhaltlich einig — höchstes Vertrauen. */
  | "unanimous"
  /** Mehrheit einig, mindestens ein Ausreißer. */
  | "majority"
  /** Keine Mehrheit — Antworten gehen auseinander. */
  | "split"
  /** Zu wenige Antworten für eine Aussage. */
  | "insufficient";

export interface ConsensusResult {
  verdict: ConsensusVerdict;
  /** Antwort des größten Clusters (repräsentativ, nicht "die Wahrheit"). */
  answer: string | null;
  /** Provider, die den Mehrheits-Cluster tragen. */
  agreeing: string[];
  /** Provider, die abweichen — die eigentlich interessante Information. */
  outliers: string[];
  /** Anteil der (gewichteten) Zustimmung, 0..1. */
  confidence: number;
  /** Gesamtkosten der Redundanz in msat. */
  totalCostMsat: number;
  /** Menschenlesbare Begründung für die UI. */
  explanation: string;
}

export interface ConsensusOptions {
  /** Ab welcher Ähnlichkeit gelten zwei Antworten als "dasselbe". */
  similarityThreshold?: number;
  /** Reputationsgewichte berücksichtigen (sonst zählt jede Stimme gleich). */
  useWeights?: boolean;
}

/** Normalisierung: entfernt Unterschiede, die keine inhaltlichen sind. */
export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/\s+/g, " ")) // Codeblöcke: nur Whitespace glätten
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // Satzzeichen raus
    .replace(/\s+/g, " ")
    .trim();
}

/** Wort-Shingles (n-Gramme) für den Ähnlichkeitsvergleich. */
function shingles(s: string, n = 3): Set<string> {
  const words = normalizeAnswer(s).split(" ").filter(Boolean);
  if (words.length === 0) return new Set();
  if (words.length < n) return new Set([words.join(" ")]);
  const out = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) out.add(words.slice(i, i + n).join(" "));
  return out;
}

/**
 * Ähnlichkeit zweier Antworten, 0..1.
 *
 * Kombination aus zwei Massen, weil Jaccard allein einen konkreten Fehler
 * macht: sagt Provider A "Paris ist die Hauptstadt" und Provider B dasselbe
 * plus zwei Sätze Zusatzinfo, ist der Jaccard-Wert niedrig — obwohl B dem
 * Kunden mehr, nicht anderes geliefert hat. B würde als Ausreisser markiert.
 * Deshalb zusätzlich die Containment-Zahl: geht die kürzere Antwort in der
 * längeren auf, gelten sie als einig.
 *
 * Bewusst simpel: kein Embedding-Modell, weil der Vergleich im Browser laufen
 * muss, ohne Netzwerk und ohne dass ein weiterer Dienst mitliest. Für die
 * Frage "hat einer etwas völlig anderes gesagt" reicht das.
 */
export function similarity(a: string, b: string): number {
  const na = normalizeAnswer(a);
  const nb = normalizeAnswer(b);
  if (na === nb) return 1;
  if (!na || !nb) return 0;

  const sa = shingles(a);
  const sb = shingles(b);
  if (sa.size === 0 || sb.size === 0) return 0;

  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;

  const union = sa.size + sb.size - inter;
  const jaccard = union === 0 ? 0 : inter / union;

  // Containment nur bei genug Substanz: bei ein, zwei Shingles wäre jede
  // zufällige Überschneidung sofort 1.0.
  const smaller = Math.min(sa.size, sb.size);
  const containment = smaller >= 3 ? inter / smaller : 0;

  return Math.max(jaccard, containment);
}

/**
 * Wertet mehrere Antworten aus.
 *
 * Gibt nie eine Antwort als "verifiziert" aus — die Entscheidung bleibt beim
 * Nutzer. Was zurückkommt, ist eine Aussage über die Übereinstimmung.
 */
export function evaluateConsensus(
  answers: ConsensusAnswer[],
  opts: ConsensusOptions = {},
): ConsensusResult {
  const threshold = opts.similarityThreshold ?? 0.6;
  const useWeights = opts.useWeights ?? false;
  const totalCostMsat = answers.reduce((s, a) => s + (a.amountMsat ?? 0), 0);
  const weightOf = (a: ConsensusAnswer): number => (useWeights ? Math.max(0.1, a.weight ?? 1) : 1);

  if (answers.length === 0) {
    return {
      verdict: "insufficient",
      answer: null,
      agreeing: [],
      outliers: [],
      confidence: 0,
      totalCostMsat,
      explanation: "Keine Antwort erhalten.",
    };
  }
  if (answers.length === 1) {
    return {
      verdict: "insufficient",
      answer: answers[0].output,
      agreeing: [answers[0].providerPubkey],
      outliers: [],
      confidence: 0,
      totalCostMsat,
      explanation:
        "Nur ein Provider hat geantwortet — ohne Vergleich ist keine Aussage über " +
        "die Verlässlichkeit möglich.",
    };
  }

  // Cluster bilden: jede Antwort startet einen Cluster, ähnliche schließen sich an.
  const clusters: { members: number[]; weight: number }[] = [];
  for (let i = 0; i < answers.length; i++) {
    let placed = false;
    for (const c of clusters) {
      // Gegen den Cluster-Repräsentanten vergleichen (erstes Mitglied).
      if (similarity(answers[c.members[0]].output, answers[i].output) >= threshold) {
        c.members.push(i);
        c.weight += weightOf(answers[i]);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ members: [i], weight: weightOf(answers[i]) });
  }

  clusters.sort((a, b) => b.weight - a.weight || b.members.length - a.members.length);
  const top = clusters[0];
  const totalWeight = answers.reduce((s, a) => s + weightOf(a), 0);
  const confidence = totalWeight === 0 ? 0 : top.weight / totalWeight;

  const agreeing = top.members.map((i) => answers[i].providerPubkey);
  const outliers = answers
    .map((a, i) => (top.members.includes(i) ? null : a.providerPubkey))
    .filter((x): x is string => x !== null);

  // Repräsentant des Mehrheits-Clusters: die längste Antwort darin. Bei
  // gleichwertigem Inhalt ist die ausführlichere für den Nutzer meist nützlicher.
  const answer = top.members
    .map((i) => answers[i].output)
    .sort((a, b) => b.length - a.length)[0];

  let verdict: ConsensusVerdict;
  let explanation: string;
  if (clusters.length === 1) {
    verdict = "unanimous";
    explanation = `Alle ${answers.length} Provider sind sich inhaltlich einig.`;
  } else if (confidence > 0.5) {
    verdict = "majority";
    explanation =
      `${agreeing.length} von ${answers.length} Providern stimmen überein, ` +
      `${outliers.length} weichen ab. Abweichung heißt nicht automatisch Betrug — ` +
      `sie heißt, dass hier jemand etwas anderes geliefert hat als die übrigen.`;
  } else {
    verdict = "split";
    explanation =
      `Die Antworten gehen auseinander (${clusters.length} verschiedene Varianten). ` +
      `Kein Provider hat eine Mehrheit. Bei einer wichtigen Frage: neu stellen, ` +
      `präziser formulieren oder mehr Provider hinzunehmen.`;
  }

  return { verdict, answer, agreeing, outliers, confidence, totalCostMsat, explanation };
}

/** Kostenvorschau für die UI, bevor der Nutzer Redundanz einschaltet. */
export function consensusCostPreview(
  singleJobMsat: number,
  providerCount: number,
): { totalMsat: number; multiplier: number; note: string } {
  const n = Math.max(1, Math.floor(providerCount));
  return {
    totalMsat: singleJobMsat * n,
    multiplier: n,
    note:
      n === 1
        ? "Ein Provider — kein Vergleich, kein Aufpreis."
        : `${n} Provider parallel: ${n}× Preis. Dafür wird eine abweichende ` +
          `Antwort sichtbar, statt unbemerkt durchzugehen.`,
  };
}

/** Empfehlung, wie viele Provider für eine Frage sinnvoll sind. */
export function recommendedRedundancy(stakes: "normal" | "important" | "critical"): number {
  // Gerade Zahlen vermeiden: bei 2 Antworten gibt es bei Uneinigkeit keine
  // Mehrheit, nur ein Patt.
  switch (stakes) {
    case "critical":
      return 5;
    case "important":
      return 3;
    default:
      return 1;
  }
}
