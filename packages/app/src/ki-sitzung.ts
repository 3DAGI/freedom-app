/**
 * Sitzungsschluessel fuer KI-Auftraege (Schritt 3.1).
 *
 * Je Provider ein zufaelliger Schluessel – nicht aus dem Seed abgeleitet, nur
 * im Speicher der Seite. Mit ihm signiert die App Sitzung, Belege und
 * Anfragen; der Provider sieht nie die Identitaet, und zwei Provider sehen
 * nicht denselben Schluessel. Nach dem Neuladen beginnt eine neue Sitzung.
 *
 * Seit D1b1 (`docs/DATENSCHUTZ-PROVIDER.md`) merkt sie, welcher Schluessel
 * welchen Auftrag stellte: Abrechnung und Reklamation nehmen diesen, nicht den
 * aktuellen – den `p`-Tag im Ergebnis setzt der Provider selbst.
 */
import { LocalSigner, generateKeypair, toHex } from "@freedomstack/protocol";

/** So viele Auftraege merkt sich die Seite ihren Schluessel. */
export const KI_AUFTRAEGE_MAX = 1000;

export class KiSitzungen {
  readonly #je = new Map<string, LocalSigner>();
  /** Roher Schluessel (hex) je Sitzungs-Pubkey. */
  readonly #roh = new Map<string, string>();
  /** Auftrag (Request-Id) → Sitzungsschluessel, der ihn stellte. */
  readonly #auftraege = new Map<string, LocalSigner>();

  /** Der Sitzungsschluessel fuer diesen Provider – beim ersten Mal neu. */
  fuer(providerPk: string): LocalSigner {
    let s = this.#je.get(providerPk);
    if (!s) {
      const kp = generateKeypair();
      s = new LocalSigner(kp.sk);
      this.#je.set(providerPk, s);
      this.#roh.set(s.publicKey(), toHex(kp.sk));
      kp.sk.fill(0);
    }
    return s;
  }

  /**
   * Der rohe Sitzungsschluessel (hex) – nur, damit eine Reklamation ihr Urteil
   * auch nach einem Neustart lesen kann (5.6b); er gehoert dann in den Tresor.
   */
  schluesselHex(sitzungPk: string): string | undefined {
    return this.#roh.get(sitzungPk);
  }

  /** Merken, welcher Sitzungsschluessel diesen Auftrag stellte – vor dem Senden. */
  merkeAuftrag(requestId: string, sitzung: LocalSigner): void {
    this.#auftraege.set(requestId, sitzung);
    // Nur die letzten – Antworten und Reklamationen kommen in derselben Sitzung der Seite
    if (this.#auftraege.size > KI_AUFTRAEGE_MAX) this.#auftraege.delete(this.#auftraege.keys().next().value!);
  }

  /** Der Sitzungsschluessel, der diesen Auftrag stellte – nur aus dem eigenen Gedaechtnis. */
  fuerAuftrag(requestId: string): LocalSigner | undefined {
    return this.#auftraege.get(requestId);
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
