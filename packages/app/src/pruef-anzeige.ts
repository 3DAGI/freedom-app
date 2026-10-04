/**
 * Anzeige der Freedom-Prüfung auf der Seite Netz (P2b2, E7) – ohne DOM.
 *
 * Je Provider eine Zeile: Stand, Verfügbarkeit, Antwortzeit und woher die Zahl
 * kommt – dieselbe Quelle wie bei der Auswahl (`stufeFuerAuswahl()`): die
 * eigene Messung, sobald sie genug hat, sonst die gewählten Prüfer, sonst noch
 * keine. Gezeigt wird nur auf dem Gerät; eine Rangliste veröffentlicht niemand.
 */
import type { MessStand, PruefStand, Stufe } from "@freedomstack/protocol";

export type PruefQuelle = "eigene" | "pruefer" | "keine";

export interface PruefZeile {
  pk: string;
  stand: Stufe;
  quelle: PruefQuelle;
  /** Erfolge je Anfrage in ganzen Prozent – nur mit Quelle. */
  verfuegbarkeit?: number;
  antwortMs?: number;
  /** Bei Prüfern: von wie vielen. */
  pruefer?: number;
}

export function pruefZeile(pk: string, messung?: MessStand, pruefung?: PruefStand): PruefZeile {
  const prozent = (s: { anfragen: number; erfolge: number }) => Math.floor((s.erfolge / s.anfragen) * 100);
  if (messung && messung.stufe !== "neu") {
    return { pk, stand: messung.stufe, quelle: "eigene", verfuegbarkeit: prozent(messung), ...(messung.medianMs === undefined ? {} : { antwortMs: messung.medianMs }) };
  }
  if (pruefung && pruefung.stufe !== "neu") {
    return { pk, stand: pruefung.stufe, quelle: "pruefer", verfuegbarkeit: prozent(pruefung), pruefer: pruefung.pruefer, ...(pruefung.medianMs === undefined ? {} : { antwortMs: pruefung.medianMs }) };
  }
  return { pk, stand: "neu", quelle: "keine" };
}

const REIHE: Record<Stufe, number> = { normal: 0, neu: 1, herabgestuft: 2, ausgefallen: 3 };

/** Zeilen nach Stand (geprüft, neu, herabgestuft, ausgefallen), darin fest nach Schlüssel – keine Wertung darüber hinaus. */
export function pruefZeilen(provider: ReadonlyArray<{ pk: string; messung?: MessStand; pruefung?: PruefStand }>): PruefZeile[] {
  return provider.map((p) => pruefZeile(p.pk, p.messung, p.pruefung)).sort((a, b) => REIHE[a.stand] - REIHE[b.stand] || (a.pk < b.pk ? -1 : 1));
}
