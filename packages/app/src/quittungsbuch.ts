/**
 * Quittungsbuch der App (Schritt 5.5b).
 *
 * Quittungen (Beleg nach 4.8, `quittung.ts`) liegen nur im Tresor
 * (`freedom.quittungen`), nie auf einem Relay und nie in der Sicherung. Aus
 * ihnen – und später aus den Zusammenfassungen der Kontakte (5.5c) – kommt der
 * Ruf eines Providers; Leistungs-Events (38010) zählen nicht mehr.
 */
import { type EigeneReklamation } from "./streitfall.js";
import { type KanalQuittung, type Quittung, kanalBelegt, leseQuittung } from "@freedomstack/protocol";

export const LS_QUITTUNGEN = "freedom.quittungen";
/** Die neuesten so vielen Quittungen bleiben – der Ruf braucht keine Jahre. */
export const QUITTUNGEN_MAX = 500;

export interface QuittungsSpeicher {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void | Promise<void>;
}

/** Kennung gegen Doppelte: je Zahlung genau eine Quittung. */
const kennung = (q: Quittung): string => (q.art === "lightning" ? `ln:${q.preimage}` : `kanal:${q.anfrage}`);

export class QuittungsBuch {
  constructor(private speicher: QuittungsSpeicher) {}

  alle(): Quittung[] {
    try {
      const roh = JSON.parse(this.speicher.getItem(LS_QUITTUNGEN) ?? "[]") as unknown;
      return Array.isArray(roh) ? roh.map(leseQuittung).filter((q): q is Quittung => q !== null) : [];
    } catch {
      return [];
    }
  }

  /** Neue Quittung – eine schon bekannte Zahlung ersetzt nur ihren Stand. */
  async lege(q: Quittung): Promise<void> {
    const alle = this.alle().filter((x) => kennung(x) !== kennung(q));
    alle.push(q);
    await this.speicher.setItem(LS_QUITTUNGEN, JSON.stringify(alle.sort((a, b) => a.zeit - b.zeit).slice(-QUITTUNGEN_MAX)));
  }

  /** Kanäle mit Quittungen, die noch „angekündigt“ sind. */
  offeneKanaele(): string[] {
    return [...new Set(this.alle().filter((q): q is KanalQuittung => q.art === "kanal" && q.stand === "angekuendigt").map((q) => q.kanal))];
  }

  /** Mit der Auszahlung auf der Kette auf „belegt“ heben; Zahl der gehobenen. */
  async hebe(kanal: string, ausgezahlt: bigint): Promise<number> {
    let n = 0;
    const neu = this.alle().map((q) => {
      if (q.art !== "kanal" || q.kanal !== kanal || q.stand === "belegt") return q;
      const h = kanalBelegt(q, ausgezahlt);
      if (h.stand === "belegt") n++;
      return h;
    });
    if (n > 0) await this.speicher.setItem(LS_QUITTUNGEN, JSON.stringify(neu));
    return n;
  }
}

/** Reklamationen je Provider – nur die, denen der Prüfer recht gab. Eine offene Reklamation ist eine Behauptung. */
export function reklamationenJeProvider(r: readonly EigeneReklamation[]): Map<string, number> {
  const je = new Map<string, number>();
  for (const x of r) {
    if (x.urteil?.ergebnis !== "erstattet" && x.urteil?.ergebnis !== "geteilt") continue;
    je.set(x.providerPk, (je.get(x.providerPk) ?? 0) + 1);
  }
  return je;
}

/**
 * Antworten seit der letzten Lightning-Zahlung je Provider (nur im Speicher):
 * Die Sitzung zahlt gesammelt, eine Quittung deckt alle Antworten davor.
 */
export class OffeneAntworten {
  private je = new Map<string, number>();

  zaehle(provider: string): void {
    this.je.set(provider, (this.je.get(provider) ?? 0) + 1);
  }

  /** Bezahlt: so viele Antworten deckt die Zahlung (mindestens eine). */
  nimm(provider: string): number {
    const n = Math.max(1, this.je.get(provider) ?? 0);
    this.je.delete(provider);
    return n;
  }
}
