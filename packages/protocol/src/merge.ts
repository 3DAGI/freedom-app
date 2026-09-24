/**
 * Zusammenführen nach Offline-Bearbeitung.
 *
 * DAS PROBLEM
 * Zwei Geräte ändern offline dieselbe Sache. Beim Wiederverbinden gewinnt der
 * letzte Schreibvorgang, und der andere ist weg. Bei Nachrichten harmlos — die
 * sind unveränderlich und werden nur gesammelt. Bei Raumeinstellungen, Rollen
 * und eigenen Namen nicht: Dort verschwindet Arbeit, ohne dass es jemand
 * merkt.
 *
 * WAS HIER PASSIERT
 * Zwei Datenstrukturen, die ohne Absprache zusammenführbar sind:
 *
 *   · **Menge mit Zeitstempeln** — jedes Element trägt, wann es hinzugefügt
 *     und wann es entfernt wurde. Zusammenführen heißt: das jeweils Spätere
 *     gewinnt, je Element. Zwei Geräte, die verschiedene Elemente ändern,
 *     verlieren nichts.
 *   · **Feld mit Zeitstempel** — für einzelne Werte wie einen Raumnamen.
 *     Hier gewinnt tatsächlich der letzte, aber nur für DIESES Feld, nicht
 *     für das ganze Objekt.
 *
 * DER UNTERSCHIED ZUM NAIVEN WEG
 * „Letzter Schreibvorgang gewinnt" auf Objektebene verliert alles, was das
 * andere Gerät geändert hat. Auf Feldebene verliert es nur, was BEIDE
 * geändert haben — und das ist selten.
 *
 * WAS DAS NICHT LEISTET
 * Bei echtem Konflikt — beide ändern dasselbe Feld — muss einer verlieren.
 * Das wird angezeigt statt verschwiegen, damit der Nutzer nachsehen kann.
 */

export interface TimestampedEntry<T> {
  value: T;
  addedAt: number;
  removedAt?: number;
}

export interface MergeableSet<T> {
  entries: Map<string, TimestampedEntry<T>>;
}

export function emptySet<T>(): MergeableSet<T> {
  return { entries: new Map() };
}

export function setAdd<T>(s: MergeableSet<T>, key: string, value: T, at: number): MergeableSet<T> {
  const e = s.entries.get(key);
  // Ein Hinzufügen, das älter ist als das bekannte Entfernen, wird ignoriert.
  if (e?.removedAt !== undefined && e.removedAt > at) return s;
  s.entries.set(key, { value, addedAt: at });
  return s;
}

export function setRemove<T>(s: MergeableSet<T>, key: string, at: number): MergeableSet<T> {
  const e = s.entries.get(key);
  if (!e) {
    // Grabstein anlegen: Sonst käme das Element beim Zusammenführen mit
    // einem Gerät zurück, das es noch hat.
    s.entries.set(key, { value: undefined as T, addedAt: 0, removedAt: at });
    return s;
  }
  if (e.addedAt > at) return s;
  s.entries.set(key, { ...e, removedAt: at });
  return s;
}

export function setValues<T>(s: MergeableSet<T>): { key: string; value: T }[] {
  const out: { key: string; value: T }[] = [];
  for (const [key, e] of s.entries) {
    if (e.removedAt !== undefined && e.removedAt >= e.addedAt) continue;
    out.push({ key, value: e.value });
  }
  return out;
}

export interface MergeReport {
  merged: number;
  /** Elemente, bei denen beide Seiten etwas geändert haben. */
  conflicts: { key: string; kept: string; discarded: string }[];
}

/**
 * Zwei Mengen zusammenführen.
 *
 * Je Element gewinnt der spätere Zeitstempel. Zwei Geräte, die verschiedene
 * Elemente geändert haben, verlieren nichts — das ist der ganze Punkt.
 */
export function mergeSets<T>(
  a: MergeableSet<T>,
  b: MergeableSet<T>,
): { result: MergeableSet<T>; report: MergeReport } {
  const result: MergeableSet<T> = { entries: new Map(a.entries) };
  const conflicts: MergeReport["conflicts"] = [];

  for (const [key, eb] of b.entries) {
    const ea = result.entries.get(key);
    if (!ea) {
      result.entries.set(key, eb);
      continue;
    }

    const zeitA = Math.max(ea.addedAt, ea.removedAt ?? 0);
    const zeitB = Math.max(eb.addedAt, eb.removedAt ?? 0);

    if (zeitB > zeitA) {
      // Nur melden, wenn beide Seiten wirklich etwas geändert haben.
      if (zeitA > 0 && JSON.stringify(ea.value) !== JSON.stringify(eb.value)) {
        conflicts.push({
          key,
          kept: JSON.stringify(eb.value),
          discarded: JSON.stringify(ea.value),
        });
      }
      result.entries.set(key, eb);
    } else if (zeitA === zeitB && ea.removedAt === undefined && eb.removedAt !== undefined) {
      // Gleichstand zwischen Hinzufügen und Entfernen: Entfernen gewinnt.
      // Jemanden versehentlich im Raum zu lassen ist schlimmer, als ihn
      // versehentlich auszuschließen — das lässt sich rückgängig machen.
      result.entries.set(key, eb);
    }
  }

  return { result, report: { merged: result.entries.size, conflicts } };
}

export interface TimestampedField<T> {
  value: T;
  updatedAt: number;
  /** Welches Gerät es zuletzt geändert hat — für die Anzeige bei Konflikt. */
  by?: string;
}

/**
 * Einzelnes Feld zusammenführen.
 *
 * Hier gewinnt tatsächlich der letzte — aber nur für DIESES Feld. Ein Gerät,
 * das den Raumnamen geändert hat, überschreibt damit nicht die Rollen, die
 * das andere geändert hat.
 */
export function mergeField<T>(
  a: TimestampedField<T>,
  b: TimestampedField<T>,
): { result: TimestampedField<T>; conflicted: boolean; discarded?: T } {
  if (b.updatedAt > a.updatedAt) {
    const konflikt = a.updatedAt > 0 && JSON.stringify(a.value) !== JSON.stringify(b.value);
    return { result: b, conflicted: konflikt, discarded: konflikt ? a.value : undefined };
  }
  if (a.updatedAt > b.updatedAt) {
    const konflikt = b.updatedAt > 0 && JSON.stringify(a.value) !== JSON.stringify(b.value);
    return { result: a, conflicted: konflikt, discarded: konflikt ? b.value : undefined };
  }
  // Exakt gleichzeitig: Die Gerätekennung entscheidet, damit beide Seiten
  // unabhängig zum selben Ergebnis kommen.
  const gewinner = (a.by ?? "") >= (b.by ?? "") ? a : b;
  const verlierer = gewinner === a ? b : a;
  const konflikt = JSON.stringify(a.value) !== JSON.stringify(b.value);
  return { result: gewinner, conflicted: konflikt, discarded: konflikt ? verlierer.value : undefined };
}

export interface ConflictSummary {
  total: number;
  message: string;
  details: string[];
}

/**
 * Konflikte für den Nutzer aufbereiten.
 *
 * Stillschweigend zu überschreiben ist der Fehler, den die meisten Systeme
 * machen: Der Nutzer merkt erst Wochen später, dass eine Änderung fehlt — und
 * kann sie dann nicht mehr rekonstruieren.
 */
export function summarizeConflicts(reports: MergeReport[]): ConflictSummary {
  const alle = reports.flatMap((r) => r.conflicts);
  if (alle.length === 0) {
    return { total: 0, message: "Ohne Konflikte zusammengeführt.", details: [] };
  }
  return {
    total: alle.length,
    message:
      `${alle.length} Änderung(en) wurden überschrieben, weil zwei Geräte ` +
      `dasselbe geändert haben. Die neuere hat gewonnen.`,
    details: alle.map((c) => `${c.key}: „${c.discarded}" → „${c.kept}"`),
  };
}
