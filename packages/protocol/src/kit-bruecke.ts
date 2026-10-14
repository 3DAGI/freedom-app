/**
 * Brücke von `@solana/kit` zu web3.js v1 (A-21b1, `docs/KIT-PLAN.md`): Anweisungen
 * entstehen als kit-`Instruction` – Adressen als Text, Rollen statt zweier Schalter.
 * Wer noch web3.js-Transaktionen baut (App, Knoten bis A-21d/e), bekommt sie über
 * `alsWeb3()`. Fällt mit A-21f weg, zusammen mit web3.js.
 *
 * Die Bytes jeder Nachricht halten die Vektoren aus A-21a fest
 * (`test/fixtures/solana-vektoren.json`) – die Brücke ändert keine.
 */
import { AccountRole, address, createNoopSigner, isSignerRole, isWritableRole, type Instruction } from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";

// Für die App (A-21b2): kit nur über das Protokoll – eine eigene Abhängigkeit legte eine zweite
// Kopie neben diese (im Wurzelordner liegt kit 5.x), und das Bundle trüge beide.
export { AccountRole, type Instruction };

/** Programme und Sysvars, die die Anweisungen nennen (fest, nie aus Fremddaten). */
export const SYSTEM_PROGRAMM = "11111111111111111111111111111111";
export const ED25519_PROGRAMM = "Ed25519SigVerify111111111111111111111111111";
export const SYSVAR_ANWEISUNGEN = "Sysvar1nstructions1111111111111111111111111";

/** Ein Konto einer Anweisung – die Adresse prüft `address()` (base58, 32 Byte). */
export function konto(adresse: string, rolle: AccountRole): { address: ReturnType<typeof address>; role: AccountRole } {
  return { address: address(adresse), role: rolle };
}

/** Eine Anweisung aus Adressen als Text – jede prüft `address()` (base58, 32 Byte). */
export function anweisung(programm: string, konten: ReadonlyArray<readonly [string, AccountRole]>, daten: Uint8Array): Instruction {
  return { programAddress: address(programm), accounts: konten.map(([a, rolle]) => konto(a, rolle)), data: daten };
}

/**
 * Überweisung über das System-Programm; die Unterschrift des Absenders nur als Rolle. Eine
 * Referenz nach Solana Pay (8.4c) hängt nur lesend an – der Empfänger findet so sein Angebot.
 */
export function ueberweisungAnweisung(p: { von: string; an: string; lamports: bigint; referenz?: string }): Instruction {
  const ix = getTransferSolInstruction({ source: createNoopSigner(address(p.von)), destination: address(p.an), amount: p.lamports });
  return p.referenz ? { ...ix, accounts: [...ix.accounts, konto(p.referenz, AccountRole.READONLY)] } : ix;
}

/** Eine kit-Anweisung als web3.js-`TransactionInstruction` – gleiche Konten, Rollen und Daten. */
export function alsWeb3(ix: Instruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programAddress),
    keys: (ix.accounts ?? []).map((k) => ({ pubkey: new PublicKey(k.address), isSigner: isSignerRole(k.role), isWritable: isWritableRole(k.role) })),
    data: Buffer.from(ix.data ?? new Uint8Array(0)),
  });
}

/**
 * Prüfung einer Ed25519-Signatur durch das Programm der Kette – Daten wie
 * `Ed25519Program.createInstructionWithPublicKey()` von web3.js: Kopf (16 Byte), dann
 * Schlüssel, Signatur, Nachricht; alle drei in dieser Anweisung (Index 0xffff).
 */
export function ed25519Anweisung(p: { schluessel: Uint8Array; signatur: Uint8Array; nachricht: Uint8Array }): Instruction {
  if (p.schluessel.length !== 32 || p.signatur.length !== 64) throw new Error("Ed25519: Schlüssel 32 Byte, Signatur 64 Byte");
  const kopf = 16, schluesselAb = kopf, signaturAb = schluesselAb + 32, nachrichtAb = signaturAb + 64;
  if (p.nachricht.length > 0xffff - nachrichtAb) throw new Error("Ed25519: Nachricht zu lang");
  const daten = new Uint8Array(nachrichtAb + p.nachricht.length);
  const v = new DataView(daten.buffer);
  v.setUint8(0, 1); // eine Signatur
  v.setUint8(1, 0); // Füllbyte
  for (const [stelle, wert] of [[2, signaturAb], [4, 0xffff], [6, schluesselAb], [8, 0xffff], [10, nachrichtAb], [12, p.nachricht.length], [14, 0xffff]] as const) {
    v.setUint16(stelle, wert, true);
  }
  daten.set(p.schluessel, schluesselAb);
  daten.set(p.signatur, signaturAb);
  daten.set(p.nachricht, nachrichtAb);
  return { programAddress: address(ED25519_PROGRAMM), accounts: [], data: daten };
}
