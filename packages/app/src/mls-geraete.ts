/**
 * Geräte in 1:1-MLS-Gruppen (Schritt 2.2b-e2, Entscheidung A), ohne DOM.
 *
 * Mitglied einer 1:1-Gruppe sind beide Personen und ihre Geräte mit gültiger
 * Vollmacht („nachrichten“, 8.6b) – jedes Gerät unter seinem Geräteschlüssel.
 * Vor jedem Senden gleicht die App die Gruppe damit ab: fehlende einladen,
 * entzogene und fremde entfernen. Wem eine Gruppe gehört, folgt aus den
 * Vollmachten – nie aus einer Behauptung in der Gruppe.
 */

export interface GeraeteQuelle {
  /** Geräte, die jetzt Nachrichten bekommen (gültige Vollmacht, nicht entzogen). */
  kopienFuer(person: string): Promise<string[]>;
  /** Alle je bevollmächtigten Geräte der Person – auch entzogene. */
  alle(person: string): Promise<string[]>;
}

/**
 * Wer in der 1:1-Gruppe von `ich` und `partner` sein soll – je Mitglied die
 * Person, der es gehört (für den Posteingang seiner Einladung).
 */
export async function sollMitglieder(ich: string, partner: string, q: GeraeteQuelle): Promise<Map<string, string>> {
  const soll = new Map<string, string>([[ich, ich], [partner, partner]]);
  const [meine, seine] = await Promise.all([q.kopienFuer(ich), q.kopienFuer(partner)]);
  // Ein Schlüssel, der zugleich eine der Personen ist, bleibt deren Hauptschlüssel
  for (const g of meine) if (!soll.has(g)) soll.set(g, ich);
  for (const g of seine) if (!soll.has(g)) soll.set(g, partner);
  return soll;
}

/** Abgleich einer Gruppe mit dem Soll: wer fehlt, wer nicht hineingehört. */
export function abgleich(ist: readonly string[], soll: ReadonlyMap<string, string>): { fehlen: string[]; zuViel: string[] } {
  return { fehlen: [...soll.keys()].filter((m) => !ist.includes(m)), zuViel: ist.filter((m) => !soll.has(m)) };
}

/**
 * Mit wem ist diese Gruppe eine 1:1-Unterhaltung? Die eine Person, der mit
 * ihren (je bevollmächtigten) Geräten alle Mitglieder gehören, die nicht
 * `ich`, `selbst` oder eigene Geräte sind – sonst null (Gruppe zu mehreren,
 * fremde Mitglieder, oder `selbst` ist gar nicht dabei).
 */
export async function partnerDerGruppe(mitglieder: readonly string[], ich: string, selbst: string, q: GeraeteQuelle): Promise<string | null> {
  if (!mitglieder.includes(selbst)) return null;
  const meine = new Set([ich, selbst, ...(await q.alle(ich))]);
  const rest = mitglieder.filter((m) => !meine.has(m));
  for (const kandidat of rest) {
    const seine = new Set([kandidat, ...(await q.alle(kandidat))]);
    if (rest.every((m) => seine.has(m))) return kandidat;
  }
  return null;
}
