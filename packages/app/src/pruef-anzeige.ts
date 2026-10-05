/**
 * Anzeige der Freedom-Prüfung auf der Seite Netz (P2b2, E7) – ohne DOM.
 *
 * Je Provider eine Zeile: Stand, Verfügbarkeit, Antwortzeit und woher die Zahl
 * kommt – dieselbe Quelle wie bei der Auswahl: die eigene Messung, sobald sie
 * genug hat, sonst noch keine (Prüfer fielen mit P5a weg). Gezeigt wird nur auf
 * dem Gerät; eine Rangliste veröffentlicht niemand.
 */
import type { MessStand, Stufe } from "@freedomstack/protocol";

export type PruefQuelle = "eigene" | "keine";

export interface PruefZeile {
  pk: string;
  stand: Stufe;
  quelle: PruefQuelle;
  /** Erfolge je Anfrage in ganzen Prozent – nur mit Quelle. */
  verfuegbarkeit?: number;
  antwortMs?: number;
}

export function pruefZeile(pk: string, messung?: MessStand): PruefZeile {
  if (messung && messung.stufe !== "neu") {
    const verfuegbarkeit = Math.floor((messung.erfolge / messung.anfragen) * 100);
    return { pk, stand: messung.stufe, quelle: "eigene", verfuegbarkeit, ...(messung.medianMs === undefined ? {} : { antwortMs: messung.medianMs }) };
  }
  return { pk, stand: "neu", quelle: "keine" };
}

const REIHE: Record<Stufe, number> = { normal: 0, neu: 1, herabgestuft: 2, ausgefallen: 3 };

/** Zeilen nach Stand (geprüft, neu, herabgestuft, ausgefallen), darin fest nach Schlüssel – keine Wertung darüber hinaus. */
export function pruefZeilen(provider: ReadonlyArray<{ pk: string; messung?: MessStand }>): PruefZeile[] {
  return provider.map((p) => pruefZeile(p.pk, p.messung)).sort((a, b) => REIHE[a.stand] - REIHE[b.stand] || (a.pk < b.pk ? -1 : 1));
}
