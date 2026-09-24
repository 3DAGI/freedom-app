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

  /** Nichts Geheimes in Logs oder serialisierten Objekten. */
  toJSON(): { type: string; pubkey: string } {
    return { type: "LocalSigner", pubkey: this.#pk };
  }
}
