/**
 * Solana-Transaktionen über `@solana/kit` (A-21d1, `docs/KIT-PLAN.md`): bauen – mit Blockhash
 * oder Durable Nonce –, signieren über `@noble/curves` (W2: den Schlüssel hält nur der Aufrufer,
 * kurz, und nullt ihn danach; kein Ed25519 aus Web Crypto), ins Drahtformat und zurück, lesen.
 * Ersetzt Schritt für Schritt `Transaction` von web3.js; die Bytes jeder Nachricht halten die
 * Vektoren aus A-21a fest (`test/fixtures/solana-vektoren.json`).
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  address, appendTransactionMessageInstructions, blockhash, compileTransaction, createTransactionMessage, getAddressDecoder,
  getCompiledTransactionMessageDecoder, getTransactionDecoder, getTransactionEncoder, setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash, setTransactionMessageLifetimeUsingDurableNonce,
  type Instruction, type Nonce, type SignatureBytes, type Transaction,
} from "@solana/kit";

/** Eine Transaktion, wie kit sie hält: die Nachricht als Bytes und je Unterzeichner ein Platz. */
export type SolTransaktion = Transaction;

/** Wie lange sie gilt: bis zur Blockhöhe eines Blockhashs, oder bis das Nonce-Konto weiterschaltet. */
export type Lebensdauer =
  | { blockhash: string; letzteHoehe: bigint }
  | { nonce: string; nonceKonto: string; autoritaet: string };

/**
 * Eine Transaktion (legacy, wie bisher mit web3.js) aus Zahler, Anweisungen und Lebensdauer. Mit
 * Nonce stellt kit das Weiterschalten des Kontos an den Anfang – der Wert steht an der Stelle
 * des Blockhashs. Alle Adressen prüft `address()`.
 */
export function baueTransaktion(p: { zahler: string; anweisungen: readonly Instruction[]; lebensdauer: Lebensdauer }): SolTransaktion {
  const l = p.lebensdauer;
  const mitZahler = setTransactionMessageFeePayer(address(p.zahler), createTransactionMessage({ version: "legacy" }));
  const mitZeit = "blockhash" in l
    ? setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(l.blockhash), lastValidBlockHeight: l.letzteHoehe }, mitZahler)
    : setTransactionMessageLifetimeUsingDurableNonce(
      { nonce: blockhash(l.nonce) as string as Nonce, nonceAccountAddress: address(l.nonceKonto), nonceAuthorityAddress: address(l.autoritaet) },
      mitZahler,
    );
  return compileTransaction(appendTransactionMessageInstructions(p.anweisungen, mitZeit));
}

/** Adresse (base58) zu einem öffentlichen Schlüssel. */
function adresseVon(oeffentlich: Uint8Array): string {
  return getAddressDecoder().decode(oeffentlich);
}

/**
 * Ein frischer Schlüssel für ein Konto, das eine Transaktion neu anlegt (Nonce-Konto): Er
 * unterschreibt nur diese eine; der Aufrufer nullt `geheim` gleich danach.
 */
export function neuerKontoSchluessel(): { geheim: Uint8Array; adresse: string } {
  const geheim = ed25519.utils.randomSecretKey();
  return { geheim, adresse: adresseVon(ed25519.getPublicKey(geheim)) };
}

/**
 * Signiert für die Adresse dieses Schlüssels – nur, wenn die Nachricht sie als Unterzeichner
 * nennt; sonst `null`. Der Schlüssel bleibt beim Aufrufer (er nullt ihn danach), die
 * Transaktion wird nicht verändert: zurück kommt eine neue.
 */
export function signiereMit(tx: SolTransaktion, geheim: Uint8Array): SolTransaktion | null {
  const adresse = adresseVon(ed25519.getPublicKey(geheim));
  if (!Object.hasOwn(tx.signatures, adresse)) return null;
  const signatur = ed25519.sign(Uint8Array.from(tx.messageBytes), geheim) as SignatureBytes;
  return Object.freeze({ ...tx, signatures: Object.freeze({ ...tx.signatures, [adresse]: signatur }) });
}

/** Drahtformat: Signaturen (fehlende als Nullen), dann die Nachricht. */
export function alsDraht(tx: SolTransaktion): Uint8Array {
  return Uint8Array.from(getTransactionEncoder().encode(tx));
}

/** Aus dem Drahtformat – wirft bei kaputten Bytes. Geprüft ist damit noch keine Signatur. */
export function ausDraht(roh: Uint8Array): SolTransaktion {
  return getTransactionDecoder().decode(roh);
}

/** Ein Konto einer gelesenen Anweisung – Rollen aus dem Kopf der Nachricht. */
export interface GelesenesKonto {
  adresse: string;
  signiert: boolean;
  schreibbar: boolean;
}

export interface GeleseneNachricht {
  /** Der Gebührenzahler – immer das erste Konto. */
  zahler: string;
  /** Blockhash oder Nonce-Wert. */
  lebensdauer: string;
  anweisungen: Array<{ programm: string; konten: GelesenesKonto[]; daten: Uint8Array }>;
}

/**
 * Liest die Nachricht einer Transaktion – nur legacy (wie bisher `Transaction.from()` von
 * web3.js); Versionen mit Adresstabellen und Verweise auf fehlende Konten werfen.
 */
export function leseNachricht(tx: SolTransaktion): GeleseneNachricht {
  const m = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  if (m.version !== "legacy") throw new Error("Nur legacy-Transaktionen");
  const { numSignerAccounts: signierend, numReadonlySignerAccounts: nurLesendSigniert, numReadonlyNonSignerAccounts: nurLesend } = m.header;
  const konten = m.staticAccounts;
  const konto = (i: number): GelesenesKonto => {
    const adresse = konten[i];
    if (adresse === undefined) throw new Error("Anweisung nennt ein Konto, das die Nachricht nicht hat");
    const signiert = i < signierend;
    return { adresse, signiert, schreibbar: signiert ? i < signierend - nurLesendSigniert : i < konten.length - nurLesend };
  };
  if (!konten.length) throw new Error("Nachricht ohne Konten");
  return {
    zahler: konten[0]!,
    lebensdauer: m.lifetimeToken,
    anweisungen: m.instructions.map((ix) => ({
      programm: konto(ix.programAddressIndex).adresse,
      konten: (ix.accountIndices ?? []).map(konto),
      daten: Uint8Array.from(ix.data ?? []),
    })),
  };
}
