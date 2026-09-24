/**
 * Signer-Schnittstelle (Schritt 1.3): signieren und entschluesseln, ohne dass
 * der Aufrufer den privaten Schluessel in die Hand bekommt.
 *
 * DAS PROBLEM
 * In der App stand der private Schluessel an Dutzenden Stellen als
 * `state.keypair.sk` – jede davon konnte ihn weiterreichen, loggen oder in ein
 * Objekt kopieren, das spaeter serialisiert wird. Und ein Schluessel, der nicht
 * im Browser liegt (NIP-46-Bunker, Hardware), passte gar nicht hinein.
 *
 * WAS HIER GEBAUT IST
 * - `Signer`: oeffentlicher Schluessel, Event signieren, NIP-44 ver- und
 *   entschluesseln. Mehr braucht die App fuer Nostr nicht.
 * - `SolanaSigner`: oeffentlicher Schluessel und Transaktion signieren.
 * - `LocalSigner`: der Schluessel liegt lokal (in der App aus dem Tresor). Er
 *   steckt in einem privaten Klassenfeld – `JSON.stringify`, Objekt-Spread
 *   und das Auflisten der Felder zeigen ihn nicht.
 * - `LocalSigner.mitSchluessel()`: der einzige Weg an den rohen Schluessel, fuer
 *   das, was nur mit ihm geht (Sicherung, Nachfolge, Swap-Adressen, Export).
 */
import { NostrEvent, UnsignedEvent, keypairFromSecret, signEvent } from "./event.js";
import { decryptDM, encryptDM } from "./dm.js";

export interface Signer {
  /** x-only Pubkey, 64 Zeichen hex. */
  publicKey(): string;
  signEvent(ev: UnsignedEvent): Promise<NostrEvent>;
  nip44Encrypt(peerPk: string, text: string): Promise<string>;
  nip44Decrypt(peerPk: string, payload: string): Promise<string>;
}

export interface SolanaSigner {
  /** Adresse, base58. */
  publicKey(): string;
  signTransaction(tx: unknown): Promise<unknown>;
}

const HEX64 = /^[0-9a-f]{64}$/;

/** Fremde Pubkeys vor jeder Rechnung pruefen – sonst schneidet Hex still ab. */
function pruefePeer(peerPk: string): void {
  if (typeof peerPk !== "string" || !HEX64.test(peerPk)) {
    throw new Error("Pubkey ungültig (64 Zeichen hex erwartet)");
  }
}

export class LocalSigner implements Signer {
  readonly #sk: Uint8Array;
  readonly #pk: string;

  constructor(sk: Uint8Array) {
    // Kopie: Wer das Original spaeter ueberschreibt, aendert den Signer nicht.
    this.#sk = Uint8Array.from(sk);
    this.#pk = keypairFromSecret(this.#sk).pk;
  }

  publicKey(): string {
    return this.#pk;
  }

  async signEvent(ev: UnsignedEvent): Promise<NostrEvent> {
    // Ein Event mit fremdem pubkey waere ungueltig signiert – lieber laut scheitern.
    if (ev.pubkey !== this.#pk) throw new Error("Event gehört zu einem anderen Schlüssel");
    return signEvent(ev, this.#sk);
  }

  async nip44Encrypt(peerPk: string, text: string): Promise<string> {
    pruefePeer(peerPk);
    return encryptDM(text, this.#sk, peerPk);
  }

  async nip44Decrypt(peerPk: string, payload: string): Promise<string> {
    pruefePeer(peerPk);
    return decryptDM(payload, this.#sk, peerPk);
  }

  /**
   * Den rohen Schluessel fuer genau eine Rechnung leihen – nur fuer das, was
   * ohne ihn nicht geht: Ableitungen (Sicherung, Swap-Adressen), Shamir-Teile
   * fuer die Nachfolge, Export durch den Nutzer. Ein entfernter Signer kann
   * das grundsaetzlich nicht; darum steht es nicht in der Schnittstelle.
   *
   * `fn` bekommt eine Kopie, die danach mit Nullen ueberschrieben wird – was
   * `fn` sich merkt, ist wertlos. Darum nur synchron: Bei einem Promise waere
   * die Kopie beim Weiterlaufen schon geloescht.
   */
  mitSchluessel<T>(fn: (sk: Uint8Array) => T): T {
    const kopie = Uint8Array.from(this.#sk);
    try {
      const ergebnis = fn(kopie);
      if (typeof (ergebnis as { then?: unknown } | null)?.then === "function") {
        throw new Error("mitSchluessel: nur synchrone Rechnungen");
      }
      return ergebnis;
    } finally {
      kopie.fill(0);
    }
  }

  /** Nichts Geheimes in Logs oder serialisierten Objekten. */
  toJSON(): { type: string; pubkey: string } {
    return { type: "LocalSigner", pubkey: this.#pk };
  }
}
