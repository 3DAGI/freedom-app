/**
 * Suche — lokal, und damit von Natur aus dezentral.
 *
 * WARUM LOKAL DIE RICHTIGE ANTWORT IST
 * Ein verteilter Suchindex wäre technisch möglich und sicherheitstechnisch
 * eine Katastrophe: Wer Suchanfragen beantwortet, erfährt, wonach jemand
 * sucht. Das ist mehr wert als der Inhalt der Nachrichten — und es gibt
 * keinen Weg, das zu verbergen, ohne ein Mixnetz zu bauen.
 *
 * Ein lokaler Index braucht keinen Server, fragt niemanden und verrät nichts.
 * Er ist damit dezentral im einzigen Sinn, auf den es hier ankommt: Es gibt
 * keine Stelle, die abgeschaltet oder befragt werden kann.
 *
 * DIE GRENZE, DIE DARAUS FOLGT
 * Man findet nur, was man selbst hat. Eine netzweite Suche gibt es nicht —
 * und sie wäre auch nicht wünschenswert, weil sie jeden öffentlichen Beitrag
 * auffindbar und damit angreifbar machte.
 *
 * WARUM EIN INDEX UND NICHT EINFACH DURCHSUCHEN
 * Bei ein paar hundert Nachrichten reicht lineares Suchen. Ab einigen tausend
 * wird die Oberfläche merklich langsam, und ab zehntausend unbrauchbar — auf
 * einem Telefon früher. Ein invertierter Index kostet einmal Aufbau und
 * danach nichts.
 */

export interface IndexedDoc {
  id: string;
  text: string;
  /** Kanal, Unterhaltung oder Raum. */
  scope?: string;
  author?: string;
  createdAt: number;
}

export interface SearchIndex {
  /** Wort → Dokumentkennungen. */
  terms: Map<string, Set<string>>;
  docs: Map<string, IndexedDoc>;
  /** Wie viele Wörter insgesamt — für die Anzeige der Indexgröße. */
  termCount: number;
}

/** Wortgrenzen inklusive Umlauten und anderer Schriften. */
const WORT = /[\p{L}\p{N}]+/gu;

/**
 * Text in Suchbegriffe zerlegen.
 *
 * Kleinschreibung und Mindestlänge zwei: Ein Index über einzelne Buchstaben
 * wäre gleich groß wie der Text und nutzlos, weil jeder Buchstabe in fast
 * jedem Dokument vorkommt.
 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const m of text.toLowerCase().matchAll(WORT)) {
    if (m[0].length >= 2) out.push(m[0]);
  }
  return out;
}

export function emptyIndex(): SearchIndex {
  return { terms: new Map(), docs: new Map(), termCount: 0 };
}

export function indexDoc(idx: SearchIndex, doc: IndexedDoc): SearchIndex {
  if (idx.docs.has(doc.id)) return idx;
  idx.docs.set(doc.id, doc);

  for (const w of new Set(tokenize(doc.text))) {
    const s = idx.terms.get(w) ?? new Set<string>();
    if (s.size === 0) idx.termCount++;
    s.add(doc.id);
    idx.terms.set(w, s);
  }
  return idx;
}

export function removeDoc(idx: SearchIndex, id: string): SearchIndex {
  const doc = idx.docs.get(id);
  if (!doc) return idx;
  idx.docs.delete(id);
  for (const w of new Set(tokenize(doc.text))) {
    const s = idx.terms.get(w);
    if (!s) continue;
    s.delete(id);
    if (s.size === 0) {
      idx.terms.delete(w);
      idx.termCount--;
    }
  }
  return idx;
}

export interface SearchHit {
  doc: IndexedDoc;
  /** Wie viele Suchbegriffe vorkommen. */
  matched: number;
  /** Textausschnitt um den ersten Treffer. */
  snippet: string;
}

export interface SearchOptions {
  scope?: string;
  author?: string;
  /** Nur Dokumente ab diesem Zeitpunkt. */
  since?: number;
  limit?: number;
}

function snippet(text: string, begriff: string, laenge = 120): string {
  const pos = text.toLowerCase().indexOf(begriff.toLowerCase());
  if (pos < 0) return text.slice(0, laenge);
  const start = Math.max(0, pos - laenge / 3);
  const roh = text.slice(start, start + laenge);
  return (start > 0 ? "…" : "") + roh + (start + laenge < text.length ? "…" : "");
}

/**
 * Suchen.
 *
 * Mehrere Begriffe werden als UND behandelt und nach Anzahl der Treffer
 * sortiert — wer zwei Wörter eingibt, meint beide. Eine ODER-Suche liefert
 * bei zwei häufigen Wörtern praktisch alles und hilft niemandem.
 */
export function search(
  idx: SearchIndex,
  query: string,
  opts: SearchOptions = {},
): SearchHit[] {
  const begriffe = tokenize(query);
  if (begriffe.length === 0) return [];

  // Kommt EIN Begriff nirgends vor, kann bei UND-Verknüpfung nichts passen.
  // Unbekannte Begriffe wegzulassen wäre ein stilles ODER — „vertrag
  // gibtesnicht" fände dann alle Verträge, obwohl der Nutzer beides wollte.
  const roh = begriffe.map((b) => ({ b, ids: idx.terms.get(b) }));
  if (roh.some((x) => x.ids === undefined)) return [];

  // Mit der seltensten Menge beginnen: Bei „der vertrag" bestimmt „vertrag"
  // den Aufwand, nicht „der".
  const mengen = (roh as { b: string; ids: Set<string> }[])
    .sort((a, b) => a.ids.size - b.ids.size);

  if (mengen.length === 0) return [];

  let kandidaten = [...mengen[0].ids];
  for (let i = 1; i < mengen.length; i++) {
    kandidaten = kandidaten.filter((id) => mengen[i].ids.has(id));
    if (kandidaten.length === 0) break;
  }

  const treffer: SearchHit[] = [];
  for (const id of kandidaten) {
    const doc = idx.docs.get(id);
    if (!doc) continue;
    if (opts.scope && doc.scope !== opts.scope) continue;
    if (opts.author && doc.author !== opts.author) continue;
    if (opts.since && doc.createdAt < opts.since) continue;

    treffer.push({
      doc,
      matched: mengen.length,
      snippet: snippet(doc.text, mengen[mengen.length - 1].b),
    });
  }

  return treffer
    .sort((a, b) => b.matched - a.matched || b.doc.createdAt - a.doc.createdAt)
    .slice(0, opts.limit ?? 50);
}

export interface IndexStats {
  docs: number;
  terms: number;
  /** Grobe Größe im Speicher. */
  approxBytes: number;
  message: string;
}

export function indexStats(idx: SearchIndex): IndexStats {
  let eintraege = 0;
  for (const s of idx.terms.values()) eintraege += s.size;
  // Grob: je Eintrag eine Kennung von 64 Zeichen plus Verwaltung.
  const bytes = eintraege * 80 + idx.termCount * 20;

  return {
    docs: idx.docs.size,
    terms: idx.termCount,
    approxBytes: bytes,
    message:
      `${idx.docs.size} Nachrichten, ${idx.termCount} Wörter, etwa ` +
      `${Math.round(bytes / 1024)} KB. Der Index liegt nur hier — ` +
      `niemand erfährt, wonach du suchst.`,
  };
}

export interface BuildProgress {
  done: number;
  total: number;
  finished: boolean;
}

/**
 * Index in Abschnitten aufbauen.
 *
 * Zehntausend Nachrichten am Stück zu indizieren friert die Oberfläche für
 * Sekunden ein. In Abschnitten bleibt sie bedienbar — der Nutzer soll
 * weiterlesen können, während der Index entsteht.
 */
export function* buildIndexIncrementally(
  docs: IndexedDoc[],
  chunkSize = 200,
): Generator<BuildProgress, SearchIndex, void> {
  const idx = emptyIndex();
  for (let i = 0; i < docs.length; i += chunkSize) {
    for (const d of docs.slice(i, i + chunkSize)) indexDoc(idx, d);
    yield {
      done: Math.min(i + chunkSize, docs.length),
      total: docs.length,
      finished: i + chunkSize >= docs.length,
    };
  }
  return idx;
}

/** Wortvorschläge beim Tippen — rein aus dem eigenen Bestand. */
export function suggest(idx: SearchIndex, prefix: string, limit = 8): string[] {
  const p = prefix.toLowerCase().trim();
  if (p.length < 2) return [];
  const out: { wort: string; haeufigkeit: number }[] = [];
  for (const [wort, ids] of idx.terms) {
    if (wort.startsWith(p) && wort !== p) out.push({ wort, haeufigkeit: ids.size });
  }
  return out
    .sort((a, b) => b.haeufigkeit - a.haeufigkeit)
    .slice(0, limit)
    .map((x) => x.wort);
}

export function searchInfo(): string {
  return [
    "Die Suche läuft nur auf diesem Gerät.",
    "",
    "Es gibt keinen Suchserver und keine netzweite Suche. Wer Suchanfragen",
    "beantwortet, erfährt, wonach jemand sucht — und das ist oft mehr wert",
    "als der Inhalt der Nachrichten.",
    "",
    "Die Folge: Du findest nur, was du selbst hast.",
  ].join("\n");
}
