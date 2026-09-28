/**
 * Fehler mit Kennung (Schritt 8.16i).
 *
 * Die Meldung bleibt deutsch – Knoten, Logs und Tests lesen sie wie bisher.
 * Die App zeigt Fehler in der Sprache ihrer Oberfläche: Sie erkennt den Fall
 * an `kennung` (nie am deutschen Text) und setzt `werte` in ihren Text ein.
 * Nur für Fehler, die Nutzer sehen können (Eingaben, Netz, Wallet) – Parser
 * fremder Events und Schutzprüfungen werfen weiter einfache Fehler.
 */
export class ProtokollFehler extends Error {
  constructor(
    readonly kennung: string,
    meldung: string,
    readonly werte: Readonly<Record<string, string | number>> = {},
  ) {
    super(meldung);
  }
}
