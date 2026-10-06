/**
 * Prüfbudget (P5b, Entscheidung 05.10.2026), ohne DOM.
 *
 * Von jeder KI-Zahlung über Lightning behält die App 0,5 % (Anteil `pruefung`,
 * `teileAuf()`) – nur bei Knoten, die die Aufteilung ab Fassung 2 rechnen. Das
 * Geld verlässt die Wallet nicht; hier steht nur, wie viel davon für
 * Prüfrunden bereitliegt (P5c: etwa jede 400. Antwort geht die echte Anfrage
 * an drei Provider statt an einen, bezahlt aus diesem Budget).
 *
 * Der Stand liegt über `geheim` (mit Tresor verschlüsselt): Er verrät, wie viel
 * jemand die KI nutzt. Nicht in der Sicherung – geht er verloren, fehlt nur
 * Budget für Prüfrunden, kein Geld.
 */
export const LS_PRUEFBUDGET = "freedom.pruefbudget";

export interface BudgetSpeicher {
  getItem(k: string): string | null;
  setItem(k: string, v: string): Promise<void> | void;
}

const betrag = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;

export class PruefBudget {
  constructor(private readonly speicher: BudgetSpeicher) {}

  /** Bereitliegendes Budget in msat – Unlesbares zählt als 0. */
  stand(): number {
    try {
      const roh = JSON.parse(this.speicher.getItem(LS_PRUEFBUDGET) ?? "{}") as { msat?: unknown } | null;
      return betrag(roh?.msat) ? roh.msat : 0;
    } catch {
      return 0;
    }
  }

  /** Den behaltenen Anteil einer Zahlung gutschreiben – nur ganze, positive msat. */
  async verbuche(msat: number): Promise<void> {
    if (!Number.isSafeInteger(msat) || msat <= 0) return;
    const neu = this.stand() + msat;
    if (!Number.isSafeInteger(neu)) return;
    await this.speicher.setItem(LS_PRUEFBUDGET, JSON.stringify({ msat: neu }));
  }
}
