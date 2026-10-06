/**
 * Prüfbudget (P5b, Entscheidung 05.10.2026), ohne DOM.
 *
 * Von jeder KI-Zahlung über Lightning behält die App 0,5 % (Anteil `pruefung`,
 * `teileAuf()`) – nur bei Knoten, die die Aufteilung ab Fassung 2 rechnen. Das
 * Geld verlässt die Wallet nicht; hier steht nur, wie viel davon für
 * Prüfrunden bereitliegt (P5c: etwa jede 400. Antwort geht die echte Anfrage
 * an drei Provider statt an einen, bezahlt aus diesem Budget).
 *
 * Dazu zählt es die Antworten seit der letzten Prüfrunde (P5c, MENSCH
 * 06.10.2026: „Antwort, nicht Zahlung“). Eine Runde ist fällig, wenn genug
 * Antworten da sind und das Budget die zwei zusätzlichen deckt; ihr Bedarf
 * wird beim Start abgezogen, was nicht gebraucht wurde, kommt zurück.
 *
 * Der Stand liegt über `geheim` (mit Tresor verschlüsselt): Er verrät, wie viel
 * jemand die KI nutzt. Nicht in der Sicherung – geht er verloren, fehlt nur
 * Budget für Prüfrunden, kein Geld.
 */
export const LS_PRUEFBUDGET = "freedom.pruefbudget";

/** Prüfrunden (P5c): etwa jede 400. Antwort, die Frage zusätzlich an zwei andere Provider. */
export const PRUEFRUNDE = Object.freeze({ abstand: 400, zusatz: 2 });

export interface BudgetSpeicher {
  getItem(k: string): string | null;
  setItem(k: string, v: string): Promise<void> | void;
}

interface Stand { msat: number; antworten: number }

const zahl = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;

export class PruefBudget {
  constructor(private readonly speicher: BudgetSpeicher) {}

  private lies(): Stand {
    try {
      const roh = JSON.parse(this.speicher.getItem(LS_PRUEFBUDGET) ?? "{}") as { msat?: unknown; antworten?: unknown } | null;
      return { msat: zahl(roh?.msat) ? roh.msat : 0, antworten: zahl(roh?.antworten) ? roh.antworten : 0 };
    } catch {
      return { msat: 0, antworten: 0 };
    }
  }

  private async schreibe(s: Stand): Promise<void> {
    await this.speicher.setItem(LS_PRUEFBUDGET, JSON.stringify(s));
  }

  /** Bereitliegendes Budget in msat – Unlesbares zählt als 0. */
  stand(): number {
    return this.lies().msat;
  }

  /** Antworten seit der letzten Prüfrunde. */
  antworten(): number {
    return this.lies().antworten;
  }

  /** Den behaltenen Anteil einer Zahlung gutschreiben – nur ganze, positive msat. */
  async verbuche(msat: number): Promise<void> {
    if (!Number.isSafeInteger(msat) || msat <= 0) return;
    const s = this.lies();
    if (!Number.isSafeInteger(s.msat + msat)) return;
    await this.schreibe({ ...s, msat: s.msat + msat });
  }

  /** Eine Antwort aus dem Netz zählen (nicht Gerät, eigener Knoten, Funk). */
  async zaehleAntwort(): Promise<void> {
    const s = this.lies();
    if (Number.isSafeInteger(s.antworten + 1)) await this.schreibe({ ...s, antworten: s.antworten + 1 });
  }

  /** Fällig: genug Antworten seit der letzten Runde und Budget für die zusätzlichen Antworten. */
  faellig(bedarfMsat: number): boolean {
    const s = this.lies();
    return Number.isSafeInteger(bedarfMsat) && bedarfMsat >= 0 && s.antworten >= PRUEFRUNDE.abstand && s.msat >= bedarfMsat;
  }

  /** Eine Runde beginnen: Bedarf abziehen, Zähler auf 0 – nur wenn fällig. */
  async beginneRunde(bedarfMsat: number): Promise<boolean> {
    if (!this.faellig(bedarfMsat)) return false;
    const s = this.lies();
    await this.schreibe({ msat: s.msat - bedarfMsat, antworten: 0 });
    return true;
  }
}
