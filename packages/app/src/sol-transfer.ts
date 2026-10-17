/**
 * SOL-Transfer-Builder.
 *
 * Genutzt von der Solana-Schiene (shell/zahlschienen.ts). Die Anweisung seit A-21b2
 * aus `@solana/kit` (`ueberweisungAnweisung()`), die Transaktion seit A-21d2 ebenfalls
 * (`baueTransaktion()`), den Blockhash seit A-21d3a über den RPC-Pool (`neuesterBlockhash()`).
 */
import { baueTransaktion, neuesterBlockhash, type SolRpc, type SolTransaktion, ueberweisungAnweisung } from "@freedomstack/protocol";
import { t } from "./i18n.js";

/**
 * Ueberweisung in Lamports (Schritt 4.1b: fuer die Solana-Schiene). Die Kette fragt sie
 * nur nach dem Blockhash – über den Pool der App (`solRpc()`), Tests geben eine Attrappe (A-21a).
 */
export async function buildSolTransfer(
  fromPubkey: string, toPubkey: string, lamports: number, referenz: string | undefined, rpc: SolRpc,
): Promise<SolTransaktion> {
  if (!Number.isSafeInteger(lamports) || lamports <= 0) throw new Error(t("zahl.ungueltigerBetrag"));

  // Referenz nach Solana Pay (8.4c): nur lesend, nicht signierend – der Empfaenger findet so sein Angebot
  const ueberweisung = ueberweisungAnweisung({ von: fromPubkey, an: toPubkey, lamports: BigInt(lamports), referenz });
  // blockhash holen (wallet signiert + sendet)
  return baueTransaktion({ zahler: fromPubkey, anweisungen: [ueberweisung], lebensdauer: await neuesterBlockhash(rpc) });
}
