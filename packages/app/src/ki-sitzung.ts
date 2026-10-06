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
 *
 * Seit D1b2 gibt es je Unterhaltung neue Schluessel (`neueUnterhaltung()`):
 * Ueber den Schluessel kann ein Provider zwei Unterhaltungen nicht verbinden.
 * Die bisherigen bleiben `ALT_HALTEN_MS` fuer spaete Antworten.
 */
import { LocalSigner, generateKeypair, toHex } from "@freedomstack/protocol";

/** So viele Auftraege merkt sich die Seite ihren Schluessel. */
export const KI_AUFTRAEGE_MAX = 1000;
/** So lange holt das Abo Antworten an die Schluessel einer verlassenen Unterhaltung noch ab – laenger als ein Lauf mit Failover. */
export const ALT_HALTEN_MS = 30 * 60_000;

export class KiSitzungen {
  readonly #je = new Map<string, LocalSigner>();
  /** Roher Schluessel (hex) je Sitzungs-Pubkey. */
  readonly #roh = new Map<string, string>();
  /** Auftrag (Request-Id) → Sitzungsschluessel, der ihn stellte. */
  readonly #auftraege = new Map<string, LocalSigner>();
  /** Schluessel verlassener Unterhaltungen – nur noch fuer spaete Antworten, bis `bis`. */
  #alt: Array<{ signer: LocalSigner; bis: number }> = [];

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

  /**
   * Neue Unterhaltung (D1b2): Jeder Provider bekommt beim naechsten Auftrag
   * einen neuen Schluessel. Die bisherigen kommen zurueck – mit ihnen begleicht
   * die App offene Betraege – und bleiben `ALT_HALTEN_MS` fuer spaete Antworten.
   */
  neueUnterhaltung(jetzt = Date.now()): LocalSigner[] {
    const bisher = [...this.#je.values()];
    for (const signer of bisher) this.#alt.push({ signer, bis: jetzt + ALT_HALTEN_MS });
    this.#je.clear();
    return bisher;
  }

  /** Aktuelle und noch gehaltene Schluessel – abgelaufene vergisst sie dabei. */
  #alle(jetzt: number): LocalSigner[] {
    this.#alt = this.#alt.filter((a) => a.bis > jetzt);
    return [...this.#je.values(), ...this.#alt.map((a) => a.signer)];
  }

  /**
   * Die Schluessel dieser Auftraege, solange gehalten – fuer die Abfrage ihrer
   * Antworten (3.2). Seit D1b2 nur diese: nie die Schluessel anderer
   * Unterhaltungen in derselben Abfrage.
   */
  pubkeysFuer(requestIds: Iterable<string>, jetzt = Date.now()): string[] {
    const gehalten = new Set(this.#alle(jetzt));
    const pks = new Set<string>();
    for (const id of requestIds) {
      const s = this.#auftraege.get(id);
      if (s && gehalten.has(s)) pks.add(s.publicKey());
    }
    return [...pks];
  }

  /** Der Sitzungsschluessel mit diesem Pubkey, falls es ihn gibt (auch einer verlassenen Unterhaltung, solange gehalten). */
  mitPubkey(pk: string, jetzt = Date.now()): LocalSigner | undefined {
    return this.#alle(jetzt).find((s) => s.publicKey() === pk);
  }

  /** Der aktuelle Schluessel fuer diesen Provider, ohne einen anzulegen. */
  aktuell(providerPk: string): LocalSigner | undefined {
    return this.#je.get(providerPk);
  }
}
