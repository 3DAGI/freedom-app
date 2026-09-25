/**
 * Sitzungsschluessel fuer KI-Auftraege (Schritt 3.1).
 *
 * Je Provider ein zufaelliger Schluessel – nicht aus dem Seed abgeleitet, nur
 * im Speicher der Seite. Mit ihm signiert die App Sitzung, Belege und
 * Anfragen; der Provider sieht nie die Identitaet, und zwei Provider sehen
 * nicht denselben Schluessel. Nach dem Neuladen beginnt eine neue Sitzung.
 */
import { LocalSigner, generateKeypair } from "@freedomstack/protocol";

export class KiSitzungen {
  readonly #je = new Map<string, LocalSigner>();

  /** Der Sitzungsschluessel fuer diesen Provider – beim ersten Mal neu. */
  fuer(providerPk: string): LocalSigner {
    let s = this.#je.get(providerPk);
    if (!s) {
      s = new LocalSigner(generateKeypair().sk);
      this.#je.set(providerPk, s);
    }
    return s;
  }
}
