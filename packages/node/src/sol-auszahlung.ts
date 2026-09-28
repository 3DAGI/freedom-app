/**
 * Auszahlung an die eigene Adresse (Schritt 4.5, Entscheidung MENSCH 28.09.:
 * eine Provider-Adresse je Knoten).
 *
 * Der Knoten löst Gutschriften mit seinem Schlüssel ein (`NODE_SOL_ADDRESS`,
 * heißer Schlüssel auf dem Gerät). Was sich dort sammelt, geht gebündelt an
 * `NODE_SOL_PAYOUT` – eine Adresse, deren Schlüssel nicht auf dem Knoten liegt.
 * So liegt auf dem Gerät nie mehr als die Rücklage plus eine Schwelle.
 *
 * - Nur über der Schwelle und höchstens einmal je Abstand (Standard 24 h) –
 *   nicht nach jeder Einlösung.
 * - Die Rücklage bleibt: Das Konto des Providers muss mietbefreit sein, und
 *   künftige Einlösungen kosten Gebühren.
 * - Mit Vorabsimulation; nach außen nur der Fehlername, nie Meldungen des RPC.
 *
 * Das ist keine Auszahlung an andere: Der Knoten verteilt nichts (5.1.2), er
 * bringt nur eigenes Geld vom heißen Schlüssel weg.
 */
import type { TransactionInstruction } from "@solana/web3.js";

/** Mindestens so viel bleibt: Mietbefreiung (890.880 Lamports) plus Gebühren. */
export const MIN_RUECKLAGE = 1_000_000n;
export const RUECKLAGE = 10_000_000n; // 0,01 SOL
export const AUSZAHLUNG_SCHWELLE = 100_000_000n; // 0,1 SOL
export const MIN_SCHWELLE = 1_000_000n;
export const AUSZAHLUNG_ABSTAND_SEK = 86_400;

export interface AuszahlungOpts {
  /** Heißer Schlüssel des Knotens (NODE_SOL_ADDRESS). */
  von: string;
  /** Eigene Auszahlungsadresse (NODE_SOL_PAYOUT). */
  an: string;
  guthaben(): Promise<bigint>;
  /** Ist die Zieladresse ein Programm? Dorthin geht nichts. */
  istProgramm(adresse: string): Promise<boolean>;
  /** Signiert als `von`, mit Vorabsimulation. */
  sende(ixs: TransactionInstruction[]): Promise<string>;
  ueberweisung(von: string, an: string, lamports: bigint): TransactionInstruction;
  jetzt?: () => number;
  ruecklage?: bigint;
  schwelle?: bigint;
  abstandSek?: number;
}

export type AuszahlungsErgebnis = { betrag: bigint; signatur: string } | { betrag: bigint; fehler: string };

export class SolAuszahlung {
  private zuletzt = 0;
  private readonly ruecklage: bigint;
  private readonly schwelle: bigint;
  private readonly jetzt: () => number;

  constructor(private readonly o: AuszahlungOpts) {
    if (o.an === o.von) throw new Error("Auszahlungsadresse ist die Adresse des Knotens");
    this.ruecklage = o.ruecklage ?? RUECKLAGE;
    this.schwelle = o.schwelle ?? AUSZAHLUNG_SCHWELLE;
    if (this.ruecklage < MIN_RUECKLAGE) throw new Error("Rücklage unter der Mietbefreiung");
    if (this.schwelle < MIN_SCHWELLE) throw new Error("Schwelle zu klein");
    this.jetzt = o.jetzt ?? (() => Math.floor(Date.now() / 1000));
  }

  /** Auszahlen, wenn es fällig ist – sonst undefined. */
  async pruefe(): Promise<AuszahlungsErgebnis | undefined> {
    const jetzt = this.jetzt();
    if (this.zuletzt > 0 && jetzt - this.zuletzt < (this.o.abstandSek ?? AUSZAHLUNG_ABSTAND_SEK)) return undefined;
    const betrag = (await this.o.guthaben()) - this.ruecklage;
    if (betrag < this.schwelle) return undefined;
    // Ein Versuch zählt – auch ein gescheiterter wird erst nach dem Abstand wiederholt
    this.zuletzt = jetzt;
    try {
      if (await this.o.istProgramm(this.o.an)) return { betrag, fehler: "Auszahlungsadresse ist ein Programm" };
      return { betrag, signatur: await this.o.sende([this.o.ueberweisung(this.o.von, this.o.an, betrag)]) };
    } catch (e) {
      // Nur der Fehlername – Meldungen der Kette oder des RPC nicht weiterreichen
      return { betrag, fehler: (e as Error).name || "Fehler" };
    }
  }
}
