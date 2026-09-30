/**
 * Belege als CSV (Sammlung A-6), ohne DOM.
 *
 * Die Quittungen der KI-Zahlungen (5.5, nur im Tresor, die neuesten 500)
 * als Datei für die eigene Buchhaltung – erzeugt und gespeichert nur auf
 * diesem Gerät, nie hochgeladen. Die Datei ist nicht verschlüsselt: Sie zeigt,
 * wen man wann wofür bezahlt hat; die Oberfläche sagt das vor dem Speichern.
 *
 * Beträge in der kleinsten Einheit (msat bzw. Lamports), damit nichts gerundet
 * wird; Zeit als ISO 8601 in UTC. Zellen, die eine Tabellenkalkulation als
 * Formel läse (`=`, `+`, `-`, `@`, Tab, Wagenrücklauf am Anfang), bekommen ein
 * `'` davor – Quittungen enthalten fremde Werte (Rechnungen der Provider).
 */
import type { Quittung } from "@freedomstack/protocol";

/** Spaltennamen – maschinenlesbar, in jeder Sprache gleich. */
export const BELEGE_SPALTEN = ["datum", "art", "provider", "auftraege", "betrag", "einheit", "stand", "rechnung", "preimage", "kanal", "gutschrift", "anfrage"] as const; // kein UI-Text

/** Eine Zelle nach RFC 4180, ohne Formel-Anfang. */
export function csvZelle(wert: string | number): string {
  let s = String(wert);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function zeile(q: Quittung): (string | number)[] {
  const datum = new Date(q.zeit * 1000).toISOString();
  return q.art === "lightning"
    ? [datum, q.art, q.provider, q.auftraege, q.betragMsat, "msat", q.stand, q.rechnung, q.preimage, "", "", ""]
    : [datum, q.art, q.provider, q.auftraege, q.preisLamports, "lamports", q.stand, "", "", q.kanal, q.gutschrift, q.anfrage];
}

/** Alle Quittungen, älteste zuerst; Zeilenende CRLF wie in RFC 4180. */
export function belegeCsv(quittungen: readonly Quittung[]): string {
  const zeilen = [[...BELEGE_SPALTEN], ...[...quittungen].sort((a, b) => a.zeit - b.zeit).map(zeile)];
  return zeilen.map((z) => z.map(csvZelle).join(",")).join("\r\n") + "\r\n";
}

/** Dateiname mit dem Tag des Exports. */
export function belegeDateiname(jetzt: Date): string {
  return `freedom-belege-${jetzt.toISOString().slice(0, 10)}.csv`;
}
