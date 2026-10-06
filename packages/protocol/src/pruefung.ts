/**
 * Freedom-Prüfung (E7, `docs/FREEDOM-PRUEFUNG.md`) – ohne DOM, ohne Netz.
 *
 * Nach dem Vorbild von OpenRouter:
 * - Verfügbarkeit in Stufen (ab 95 % normal, 80–94 % herabgestuft, darunter nur
 *   Rückfall), erst ab genug Anfragen;
 * - Neue ohne Daten in der Mitte;
 * - Ausreißer bei der Qualität nach hinten;
 * - unter gleich Guten zufällig, gewichtet mit 1/Preis².
 *
 * Gemessen wird nur in der App, am eigenen Verkehr und nur auf dem Gerät. Prüfer
 * mit eigenen Prüffragen und Messberichte (38081) fielen mit der Entscheidung vom
 * 05.10.2026 (P5a) weg; geprüft wird in Prüfrunden – die echte Anfrage an drei
 * Provider statt an einen (P5c). Wer dort mit der Mehrheit einig ist oder abweicht,
 * steht im Messpunkt (`einig`) und ergibt ab `minVergleiche` die Qualität. Die
 * Rangfolge bildet jede App selbst.
 */
export const PRUEF_GRENZEN = Object.freeze({
  /** Ab diesem Anteil Erfolge normal. */
  normal: 0.95,
  /** Darunter nur noch Rückfall. */
  herabgestuft: 0.8,
  /** So viele eigene Anfragen, bevor die eigene Messung zählt. */
  minEigene: 20,
  /** Ein Ausfall so kurz zurück stellt den Provider nach hinten (Sekunden). */
  ausfallSek: 60,
  /** So viele eigene Messpunkte je Provider. */
  fenster: 100,
  /** So weit unter dem Median der Trefferquote gilt ein Provider als Ausreißer. */
  ausreisser: 0.15,
  /** So viele Vergleiche aus Prüfrunden (P5c), bevor die Übereinstimmung als Qualität zählt. */
  minVergleiche: 3,
});

export type Stufe = "neu" | "normal" | "herabgestuft" | "ausgefallen";
export const PRUEF_STUFEN: readonly Stufe[] = ["neu", "normal", "herabgestuft", "ausgefallen"];

/** Stufe aus Anfragen und Erfolgen – „neu“, solange es weniger als `mindestens` sind. */
export function stufeAus(anfragen: number, erfolge: number, mindestens: number): Stufe {
  if (!(anfragen >= mindestens) || anfragen <= 0) return "neu";
  const quote = erfolge / anfragen;
  return quote >= PRUEF_GRENZEN.normal ? "normal" : quote >= PRUEF_GRENZEN.herabgestuft ? "herabgestuft" : "ausgefallen";
}

// ------------------------------------------------------------ eigene Messung

export interface Messpunkt {
  zeit: number;
  ok: boolean;
  ms?: number;
  /** Nur aus Prüfrunden (P5c): mit der Mehrheit einig (true) oder Ausreißer (false); ohne Aussage fehlt es. */
  einig?: boolean;
}

/** Neuen Punkt anhängen, nur die letzten `fenster` behalten. */
export function merkeMesspunkt(punkte: readonly Messpunkt[], p: Messpunkt, fenster = PRUEF_GRENZEN.fenster): Messpunkt[] {
  return [...punkte, p].slice(-fenster);
}

export interface MessStand {
  anfragen: number;
  erfolge: number;
  medianMs?: number;
  ausfallJetzt: boolean;
  stufe: Stufe;
  /** Anteil der Prüfrunden, in denen der Provider mit der Mehrheit einig war – erst ab `minVergleiche`. */
  qualitaet?: number;
}

export function fasseMessungZusammen(punkte: readonly Messpunkt[], jetzt: number): MessStand {
  const erfolge = punkte.filter((p) => p.ok).length;
  const zeiten = punkte.filter((p) => p.ok && Number.isFinite(p.ms)).map((p) => p.ms!).sort((a, b) => a - b);
  const letzterAusfall = Math.max(-Infinity, ...punkte.filter((p) => !p.ok).map((p) => p.zeit));
  const vergleiche = punkte.filter((p) => p.einig !== undefined);
  return {
    anfragen: punkte.length,
    erfolge,
    ...(zeiten.length > 0 ? { medianMs: zeiten[Math.floor((zeiten.length - 1) / 2)] } : {}),
    ausfallJetzt: jetzt - letzterAusfall < PRUEF_GRENZEN.ausfallSek,
    stufe: stufeAus(punkte.length, erfolge, PRUEF_GRENZEN.minEigene),
    ...(vergleiche.length >= PRUEF_GRENZEN.minVergleiche ? { qualitaet: vergleiche.filter((p) => p.einig).length / vergleiche.length } : {}),
  };
}

// ------------------------------------------------------------ Auswahl

export interface PruefKandidat {
  pk: string;
  /** Preis je Auftrag oder je 1k Tokens – nur der Vergleich zählt; 0 = gratis. */
  preisMsat: number;
  stufe: Stufe;
  /** Qualität (0..1), falls bekannt – die Übereinstimmung in Prüfrunden (P5c, `MessStand.qualitaet`). */
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
