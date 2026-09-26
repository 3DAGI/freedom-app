/**
 * Sitzungsschluessel fuer KI-Auftraege (Schritt 3.1).
 *
 * Je Provider ein zufaelliger Schluessel – nicht aus dem Seed abgeleitet, nur
 * im Speicher der Seite. Mit ihm signiert die App Sitzung, Belege und
 * Anfragen; der Provider sieht nie die Identitaet, und zwei Provider sehen
 * nicht denselben Schluessel. Nach dem Neuladen beginnt eine neue Sitzung.
 */
import { LocalSigner, generateKeypair, toHex } from "@freedomstack/protocol";

export class KiSitzungen {
  readonly #je = new Map<string, LocalSigner>();
  readonly #roh = new Map<string, string>();

  /** Der Sitzungsschluessel fuer diesen Provider – beim ersten Mal neu. */
  fuer(providerPk: string): LocalSigner {
    let s = this.#je.get(providerPk);
    if (!s) {
      const kp = generateKeypair();
      s = new LocalSigner(kp.sk);
      this.#je.set(providerPk, s);
      this.#roh.set(providerPk, toHex(kp.sk));
      kp.sk.fill(0);
    }
    return s;
  }

  /**
   * Der rohe Sitzungsschluessel (hex) – nur, damit eine Reklamation ihr Urteil
   * auch nach einem Neustart lesen kann (5.6b); er gehoert dann in den Tresor.
   */
  schluesselHex(providerPk: string): string | undefined {
    return this.#roh.get(providerPk);
  }

  /** Alle bisher erzeugten Sitzungsschluessel (Pubkeys) – fuer das Abo privater Antworten (3.2). */
  pubkeys(): string[] {
    return [...this.#je.values()].map((s) => s.publicKey());
  }

  /** Der Sitzungsschluessel mit diesem Pubkey, falls es ihn gibt. */
  mitPubkey(pk: string): LocalSigner | undefined {
    for (const s of this.#je.values()) if (s.publicKey() === pk) return s;
    return undefined;
  }
}
