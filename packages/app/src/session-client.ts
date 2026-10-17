/**
 * Abrechnung mit dem Provider (App-Seite) – seit RM2c3 ohne Sitzung auf Kredit.
 *
 * Bis RM2c3 eröffnete die App je Provider eine Sitzung (38021) mit 100 sats Budget, die der Knoten
 * auf Kredit bediente; gezahlt wurde in Fenstern von 20 sats, dazu Belege (38022). Schlüssel kosten
 * nichts – jeder neue bekam wieder Kredit (Entscheidung RM2 B, `docs/RM2-ENTWURF.md` V7). Jetzt trägt
 * jede Anfrage ein Gebot (oder Pfand bzw. Gutschrift), und die App zahlt den Anteil des Providers
 * (5.1.3) nach jeder Antwort, sobald ganze sats fällig sind – Kredit höchstens eine Antwort. Was unter
 * einem sat bleibt, wartet auf die nächste Antwort desselben Schlüssels oder auf `begleiche()` (D1b2).
 *
 * Gezählt wird je Provider und Sitzungsschlüssel (D1b): eine Antwort auf einen früheren Auftrag
 * verbucht bei dessen Schlüssel. Nach einem unklaren Ausgang zahlt die App für diesen Schlüssel nie
 * wieder von selbst – ob das Geld ging, weiß nur die Wallet.
 */
import type { Signer } from "@freedomstack/protocol";

/** Kleinster Betrag, der gezahlt wird – Lightning-Rechnungen über ganze sats. */
const ZAHLEN_AB_MSAT = 1000;

export interface SessionClientConfig {
  /** Sitzungsschlüssel je Provider (Schritt 3.1) – nie die Identität. */
  signerFuer: (providerPubkey: string) => Signer;
}

/**
 * Zahlung an den Provider (5.1.3), zweistufig: erst die Rechnung (bewegt kein
 * Geld), dann zahlen – so ist klar, ob ein Fehler vor der Wallet lag.
 */
export interface ProviderZahlung {
  rechnung(amountMsat: number): Promise<string>;
  /** Gibt den Nachweis zurück (Preimage). */
  zahle(rechnung: string, amountMsat: number): Promise<string>;
}

/** Ergebnis von `begleiche()` – mit Rechnung und Preimage die Quittung (5.5b). */
export interface Beglichen {
  settled: boolean;
  unklar: boolean;
  gezahltMsat: number;
  paymentRef?: string;
  rechnung?: string;
}

/** Was ein Sitzungsschlüssel einem Provider schuldet. */
interface Konto {
  provider: string;
  kunde: string;
  /** Verbucht (msat, Anteil des Providers). */
  chargedMsat: number;
  /** Bezahlt (msat). */
  paidMsat: number;
  /** Rechnung einer Zahlung mit unklarem Ausgang – dann nie wieder von selbst. */
  unklar?: string;
  /** Läuft gerade eine Zahlung? Dann zahlt eine zweite Antwort nicht dieselbe Schuld. */
  zahlt?: boolean;
}

export class SessionClient {
  private konten = new Map<string, Konto>();

  constructor(private cfg: SessionClientConfig) {}

  private konto(provider: string, kunde: string): Konto {
    const id = `${provider}:${kunde}`;
    let k = this.konten.get(id);
    if (!k) this.konten.set(id, (k = { provider, kunde, chargedMsat: 0, paidMsat: 0 }));
    return k;
  }

  /**
   * Nach einer Antwort: den Anteil des Providers verbuchen und zahlen, was an ganzen sats fällig ist.
   * Verbucht beim Schlüssel, der den Auftrag stellte (`kunde`, D1b) – ohne Angabe der aktuelle.
   */
  async chargeForResult(
    providerPubkey: string,
    amountMsat: number,
    wallet?: ProviderZahlung,
    kunde: Signer = this.cfg.signerFuer(providerPubkey),
  ): Promise<{ settled: boolean; unklar?: boolean; gezahltMsat?: number; offenMsat: number; paymentRef?: string; rechnung?: string }> {
    const k = this.konto(providerPubkey, kunde.publicKey());
    if (amountMsat > 0) k.chargedMsat += Math.floor(amountMsat);
    const z = await this.zahleFaellig(k, wallet);
    return {
      settled: z.settled, unklar: z.unklar, gezahltMsat: z.settled ? z.due : 0, offenMsat: k.chargedMsat - k.paidMsat,
      ...(z.paymentRef ? { paymentRef: z.paymentRef } : {}), ...(z.rechnung ? { rechnung: z.rechnung } : {}),
    };
  }

  /**
   * Fällige ganze sats zahlen: erst die Rechnung (bewegt kein Geld), dann zahlen; nach unklarem
   * Ausgang zahlt dieser Schlüssel nie wieder von selbst, und nie zwei Zahlungen zugleich.
   */
  private async zahleFaellig(k: Konto, wallet?: ProviderZahlung): Promise<{ settled: boolean; unklar: boolean; due: number; paymentRef?: string; rechnung?: string }> {
    const offen = k.chargedMsat - k.paidMsat;
    const due = offen - (offen % 1000);
    if (!(due >= ZAHLEN_AB_MSAT && wallet && !k.unklar && !k.zahlt)) return { settled: false, unklar: false, due };
    k.zahlt = true;
    try {
      let rechnung: string | undefined;
      try {
        rechnung = await wallet.rechnung(due);
      } catch { /* nichts gezahlt – beim nächsten Mal wieder */ }
      if (!rechnung) return { settled: false, unklar: false, due };
      try {
        const paymentRef = await wallet.zahle(rechnung, due);
        k.paidMsat += due;
        // Die bezahlte Rechnung – mit dem Preimage die Quittung (5.5b)
        return { settled: true, unklar: false, due, paymentRef, rechnung };
      } catch {
        k.unklar = rechnung;
        return { settled: false, unklar: true, due };
      }
    } finally {
      k.zahlt = false;
    }
  }

  /** Provider, bei denen dieser Schlüssel noch ganze sats schuldet (D1b2) – ohne unklare. */
  offeneVon(kundePk: string): string[] {
    const offen = new Set<string>();
    for (const k of this.konten.values()) {
      if (k.kunde === kundePk && !k.unklar && k.chargedMsat - k.paidMsat >= ZAHLEN_AB_MSAT) offen.add(k.provider);
    }
    return [...offen];
  }

  /** Offene ganze sats dieses Schlüssels beim Provider begleichen (D1b2) – vor dem Wechsel zu einem neuen Schlüssel. */
  async begleiche(providerPubkey: string, kunde: Signer, wallet?: ProviderZahlung): Promise<Beglichen> {
    const k = this.konten.get(`${providerPubkey}:${kunde.publicKey()}`);
    if (!k) return { settled: false, unklar: false, gezahltMsat: 0 };
    const z = await this.zahleFaellig(k, wallet);
    if (!z.settled) return { settled: false, unklar: z.unklar, gezahltMsat: 0 };
    return { settled: true, unklar: false, gezahltMsat: z.due, paymentRef: z.paymentRef, rechnung: z.rechnung };
  }
}
