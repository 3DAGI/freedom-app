/**
 * SOL-Transfer-Builder (lazy @solana/web3.js).
 *
 * Genutzt von der Solana-Schiene (shell/zahlschienen.ts). Laedt web3.js nur,
 * wenn tatsaechlich SOL ueberwiesen wird — haelt das Bundle klein. Die Anweisung
 * selbst seit A-21b2 aus `@solana/kit` (`ueberweisungAnweisung()`), die Transaktion
 * seit A-21d2 ebenfalls (`baueTransaktion()`); den Blockhash fragt bis A-21d3 web3.js.
 */
import { baueTransaktion, type SolTransaktion, ueberweisungAnweisung } from "@freedomstack/protocol";
import { t } from "./i18n.js";

/**
 * Ueberweisung in Lamports (Schritt 4.1b: fuer die Solana-Schiene). Die Verbindung
 * nur fuer den Blockhash; ohne Angabe die beste aus dem Pool (Tests geben eine an, A-21a).
 */
export async function buildSolTransfer(
  fromPubkey: string, toPubkey: string, lamports: number, referenz?: string,
  verbindung?: Pick<import("@solana/web3.js").Connection, "getLatestBlockhash">,
): Promise<SolTransaktion> {
  if (!Number.isSafeInteger(lamports) || lamports <= 0) throw new Error(t("zahl.ungueltigerBetrag"));

  const connection = verbindung ?? new (await import("@solana/web3.js")).Connection(await solRpcUrl(), "confirmed");

  // Referenz nach Solana Pay (8.4c): nur lesend, nicht signierend – der Empfaenger findet so sein Angebot
  const ueberweisung = ueberweisungAnweisung({ von: fromPubkey, an: toPubkey, lamports: BigInt(lamports), referenz });
  // blockhash holen (wallet signiert + sendet)
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  return baueTransaktion({ zahler: fromPubkey, anweisungen: [ueberweisung], lebensdauer: { blockhash, letzteHoehe: BigInt(lastValidBlockHeight) } });
}

/**
 * Bester erreichbarer RPC-Endpunkt aus dem Pool – eine feste Adresse waere ein
 * einzelner Ausfallpunkt fuer jede Solana-Funktion der App.
 */
export async function solRpcUrl(): Promise<string> {
  const { RpcPool, parseUserEndpoints, DEFAULT_MAINNET_RPCS } = await import("@freedomstack/protocol");
  const konfiguriert = (window as unknown as { FREEDOM_SOL_RPC?: string }).FREEDOM_SOL_RPC;
  return new RpcPool(DEFAULT_MAINNET_RPCS, {
    userEndpoints: [
      ...(konfiguriert ? [konfiguriert] : []),
      ...parseUserEndpoints(localStorage.getItem("freedom.sol.rpcs")),
    ],
    // Nicht immer derselbe fremde Anbieter (4.9) – er saehe jede Adresse samt IP.
    verteilen: true,
  }).bestUrl();
}
