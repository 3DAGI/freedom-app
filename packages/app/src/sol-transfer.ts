/**
 * SOL-Transfer-Builder (lazy @solana/web3.js).
 *
 * Genutzt von der Solana-Schiene (shell/zahlschienen.ts). Laedt web3.js nur,
 * wenn tatsaechlich SOL ueberwiesen wird — haelt das Bundle klein.
 */

/** Ueberweisung in Lamports (Schritt 4.1b: fuer die Solana-Schiene). */
export async function buildSolTransfer(fromPubkey: string, toPubkey: string, lamports: number): Promise<unknown> {
  const web3 = await import("@solana/web3.js");
  if (!Number.isSafeInteger(lamports) || lamports <= 0) throw new Error("ungueltiger betrag");

  const connection = new web3.Connection(await solRpcUrl(), "confirmed");

  const tx = new web3.Transaction().add(
    web3.SystemProgram.transfer({
      fromPubkey: new web3.PublicKey(fromPubkey),
      toPubkey: new web3.PublicKey(toPubkey),
      lamports,
    }),
  );
  // blockhash holen (wallet signiert + sendet)
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = new web3.PublicKey(fromPubkey);
  return tx;
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
  }).bestUrl();
}
