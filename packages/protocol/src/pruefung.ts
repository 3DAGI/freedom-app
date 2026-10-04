/**
 * Freedom-Prüfung (E7, `docs/FREEDOM-PRUEFUNG.md`), Schritt P1a – ohne DOM, ohne Netz.
 *
 * Nach dem Vorbild von OpenRouter:
 * - Verfügbarkeit in Stufen (ab 95 % normal, 80–94 % herabgestuft, darunter nur
 *   Rückfall), erst ab genug Anfragen;
 * - Neue ohne Daten in der Mitte;
 * - Ausreißer bei der Qualität nach hinten;
 * - unter gleich Guten zufällig, gewichtet mit 1/Preis².
 *
 * Gemessen wird zweifach: die App am eigenen Verkehr (nur auf dem Gerät) und
 * Prüfer mit synthetischen Prüffragen (nie Fragen von Nutzern), die sie als
 * Messbericht (Kind 38081, `messbericht.ts`) veröffentlichen. Die Rangfolge bildet jede App
 * selbst – veröffentlicht werden nur Messwerte, keine Rangliste.
 *
 * Prüffragen entstehen aus Vorlagen mit Zufall, die Antwort prüft Code – kein
 * Sprachmodell als Richter. Die Fragen sind Daten an Provider, keine Texte der
 * Oberfläche (deshalb englisch, wie Modelle sie am sichersten verstehen).
 */
export const PRUEF_GRENZEN = Object.freeze({
  /** Ab diesem Anteil Erfolge normal. */
  normal: 0.95,
  /** Darunter nur noch Rückfall. */
  herabgestuft: 0.8,
  /** So viele eigene Anfragen, bevor die eigene Messung zählt. */
  minEigene: 20,
  /** So viele Prüffragen, bevor ein Bericht zählt. */
  minPruefer: 50,
  /** Ein Ausfall so kurz zurück stellt den Provider nach hinten (Sekunden). */
  ausfallSek: 60,
  /** So viele eigene Messpunkte je Provider. */
  fenster: 100,
  /** So weit unter dem Median der Trefferquote gilt ein Provider als Ausreißer. */
  ausreisser: 0.15,
});

export type Stufe = "neu" | "normal" | "herabgestuft" | "ausgefallen";
export const PRUEF_STUFEN: readonly Stufe[] = ["neu", "normal", "herabgestuft", "ausgefallen"];

/** Stufe aus Anfragen und Erfolgen – „neu“, solange es weniger als `mindestens` sind. */
export function stufeAus(anfragen: number, erfolge: number, mindestens: number): Stufe {
  if (!(anfragen >= mindestens) || anfragen <= 0) return "neu";
  const quote = erfolge / anfragen;
  return quote >= PRUEF_GRENZEN.normal ? "normal" : quote >= PRUEF_GRENZEN.herabgestuft ? "herabgestuft" : "ausgefallen";
}

// ------------------------------------------------------------ Prüffragen

export type PruefArt = "rechnen" | "umkehren" | "zaehlen" | "sortieren" | "json";
export const PRUEF_ARTEN: readonly PruefArt[] = ["rechnen", "umkehren", "zaehlen", "sortieren", "json"];

export interface PruefFrage { art: PruefArt; frage: string; erwartet: string }

const ganz = (zufall: () => number, von: number, bis: number) => von + Math.floor(zufall() * (bis - von + 1));
const wort = (zufall: () => number, laenge: number) =>
  Array.from({ length: laenge }, () => "abcdefghijkmnopqrstuvwxyz"[ganz(zufall, 0, 24)]).join("");

/** Eine Prüffrage dieser Art – jedes Mal andere Zahlen und Wörter, die Antwort prüft `pruefeAntwort()`. */
export function neuePruefFrage(art: PruefArt, zufall: () => number): PruefFrage {
  switch (art) {
    case "rechnen": {
      const a = ganz(zufall, 100, 999);
      const b = ganz(zufall, 100, 999);
      return { art, frage: `Compute ${a} + ${b}. Reply with the number only.`, erwartet: String(a + b) }; // kein UI-Text
    }
    case "umkehren": {
      const w = wort(zufall, ganz(zufall, 6, 9));
      return { art, frage: `Write the word "${w}" backwards. Reply with the result only.`, erwartet: [...w].reverse().join("") }; // kein UI-Text
    }
    case "zaehlen": {
      const w = wort(zufall, ganz(zufall, 12, 20));
      const z = w[ganz(zufall, 0, w.length - 1)];
      return { art, frage: `How many times does the letter "${z}" occur in "${w}"? Reply with the number only.`, erwartet: String([...w].filter((x) => x === z).length) }; // kein UI-Text
    }
    case "sortieren": {
      const zahlen = Array.from({ length: 5 }, () => ganz(zufall, 1, 999));
      return {
        art,
        frage: `Sort these numbers in ascending order: ${zahlen.join(", ")}. Reply with the numbers only, separated by commas.`, // kein UI-Text
        erwartet: [...zahlen].sort((x, y) => x - y).join(","),
      };
    }
    case "json": {
      const schluessel = wort(zufall, 5);
      const zahl = ganz(zufall, 1, 9_999);
      const text = wort(zufall, 7);
      return {
        art,
        frage: `Return exactly this JSON object and nothing else: key "${schluessel}" with the number ${zahl}, key "text" with the string "${text}".`, // kein UI-Text
        erwartet: JSON.stringify({ [schluessel]: zahl, text }),
      };
    }
  }
}

/** Antwort prüfen – großzügig bei Hülle (Leerzeichen, Codeblock), streng beim Inhalt. */
export function pruefeAntwort(f: PruefFrage, antwort: string): boolean {
  const a = antwort.slice(0, 4_000).replace(/```[a-z]*\n?|```/gi, "").trim();
  switch (f.art) {
    case "rechnen":
    case "zaehlen": {
      // Die letzte Zahl zählt („347 + 829 = 1176“ ist richtig), Tausender-Trennzeichen fallen weg
      const zahlen = a.replace(/(\d)[,.'’](?=\d{3}\b)/g, "$1").match(/-?\d+/g) ?? [];
      return zahlen.length > 0 && zahlen[zahlen.length - 1] === f.erwartet;
    }
    case "umkehren":
      return a.toLowerCase().replace(/[^a-z]/g, "") === f.erwartet;
    case "sortieren":
      return (a.match(/\d+/g) ?? []).join(",") === f.erwartet;
    case "json": {
      const anfang = a.indexOf("{");
      const ende = a.lastIndexOf("}");
      if (anfang < 0 || ende < anfang) return false;
      try {
        const erhalten = JSON.parse(a.slice(anfang, ende + 1)) as Record<string, unknown>;
        const erwartet = JSON.parse(f.erwartet) as Record<string, unknown>;
        const k = Object.keys(erwartet);
        return Object.keys(erhalten).length === k.length && k.every((x) => erhalten[x] === erwartet[x]);
      } catch {
        return false;
      }
    }
  }
}

// ------------------------------------------------------------ eigene Messung

export interface Messpunkt { zeit: number; ok: boolean; ms?: number }

/** Neuen Punkt anhängen, nur die letzten `fenster` behalten. */
export function merkeMesspunkt(punkte: readonly Messpunkt[], p: Messpunkt, fenster = PRUEF_GRENZEN.fenster): Messpunkt[] {
  return [...punkte, p].slice(-fenster);
}

export interface MessStand { anfragen: number; erfolge: number; medianMs?: number; ausfallJetzt: boolean; stufe: Stufe }

export function fasseMessungZusammen(punkte: readonly Messpunkt[], jetzt: number): MessStand {
  const erfolge = punkte.filter((p) => p.ok).length;
  const zeiten = punkte.filter((p) => p.ok && Number.isFinite(p.ms)).map((p) => p.ms!).sort((a, b) => a - b);
  const letzterAusfall = Math.max(-Infinity, ...punkte.filter((p) => !p.ok).map((p) => p.zeit));
  return {
    anfragen: punkte.length,
    erfolge,
    ...(zeiten.length > 0 ? { medianMs: zeiten[Math.floor((zeiten.length - 1) / 2)] } : {}),
    ausfallJetzt: jetzt - letzterAusfall < PRUEF_GRENZEN.ausfallSek,
    stufe: stufeAus(punkte.length, erfolge, PRUEF_GRENZEN.minEigene),
  };
}

// ------------------------------------------------------------ Auswahl

/**
 * Stufe für die Auswahl (3.3): die eigene Messung, sobald sie genug Anfragen
 * hat (`minEigene`), sonst der Stand der gewählten Prüfer ab `minPruefer`
 * Prüffragen, sonst „neu“. Eigene Messungen gehen immer vor.
 */
export function stufeFuerAuswahl(eigene?: { stufe: Stufe }, pruefer?: { stufe: Stufe }): Stufe {
  if (eigene && eigene.stufe !== "neu") return eigene.stufe;
  if (pruefer && pruefer.stufe !== "neu") return pruefer.stufe;
  return "neu";
}

export interface PruefKandidat {
  pk: string;
  /** Preis je Auftrag oder je 1k Tokens – nur der Vergleich zählt; 0 = gratis. */
  preisMsat: number;
  stufe: Stufe;
  /** Trefferquote der Prüffragen (0..1), falls bekannt. */
  qualitaet?: number;
  /** Eigener Ausfall in den letzten Sekunden (`PRUEF_GRENZEN.ausfallSek`). */
  ausfallJetzt?: boolean;
  /** Vertrauen aus Quittungen (0..100, `berechneRuf()`), wirkt als Gewicht. */
  vertrauen?: number;
  /** Quittungen vorhanden (eigene oder von Kontakten) – unter den Neuen vor den Unbekannten. */
  bekannt?: boolean;
}

/**
 * Reihenfolge für Auswahl und Rückfall: normale (ohne Ausreißer), dann neue –
 * bekannte (mit Quittungen) vor unbekannten –, dann Ausreißer, dann
 * herabgestufte, dann gerade ausgefallene (eigener Ausfall vor Sekunden),
 * zuletzt ausgefallene (unter 80 %, nur noch Rückfall). In den ersten drei
 * Gruppen zufällig, gewichtet mit 1/Preis² (mal 1 + Vertrauen/100); dahinter
 * fest nach Vertrauen und Preis.
 */
export function ordneNachPruefung<K extends PruefKandidat>(kandidaten: readonly K[], zufall: () => number): K[] {
  const quoten = kandidaten.map((k) => k.qualitaet).filter((q): q is number => q !== undefined && Number.isFinite(q)).sort((a, b) => a - b);
  const median = quoten.length > 0 ? quoten[Math.floor((quoten.length - 1) / 2)] : undefined;
  const ausreisser = (k: K) => median !== undefined && k.qualitaet !== undefined && k.qualitaet < median - PRUEF_GRENZEN.ausreisser;
  const gruppe = (k: K): number =>
    k.stufe === "ausgefallen" ? 6
    : k.ausfallJetzt ? 5
    : k.stufe === "herabgestuft" ? 4
    : ausreisser(k) ? 3
    : k.stufe === "neu" ? (k.bekannt ? 1 : 2)
    : 0;
  const gewicht = (k: K) => (1 / Math.max(1, k.preisMsat) ** 2) * (1 + Math.max(0, Math.min(100, k.vertrauen ?? 0)) / 100);
  const fest = (a: K, b: K) => (b.vertrauen ?? 0) - (a.vertrauen ?? 0) || a.preisMsat - b.preisMsat;
  const ziehe = (liste: K[]): K[] => {
    const rest = [...liste];
    const aus: K[] = [];
    while (rest.length > 0) {
      const summe = rest.reduce((s, k) => s + gewicht(k), 0);
      let r = zufall() * summe;
      let i = rest.findIndex((k) => (r -= gewicht(k)) < 0);
      if (i < 0) i = rest.length - 1;
      aus.push(rest.splice(i, 1)[0]);
    }
    return aus;
  };
  const nach = (g: number) => kandidaten.filter((k) => gruppe(k) === g);
  return [...ziehe(nach(0)), ...ziehe(nach(1)), ...ziehe(nach(2)), ...[3, 4, 5, 6].flatMap((g) => nach(g).sort(fest))];
}
