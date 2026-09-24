/**
 * SOL-Transfer-Builder (lazy @solana/web3.js).
 *
 * Wird vom chat-zap genutzt. Laedt web3.js nur wenn tatsaechlich ein
 * Solana-Zap gesendet wird — haelt das Bundle klein.
 */

export async function buildSolTransfer(fromPubkey: string, toPubkey: string, amountSol: string): Promise<unknown> {
  const web3 = await import("@solana/web3.js");
  const lamports = Math.round(Number(amountSol) * 1_000_000_000);
  if (!Number.isFinite(lamports) || lamports <= 0) throw new Error("ungueltiger betrag");

  // Endpunkt aus dem Pool: eine feste Adresse waere ein einzelner
  // Ausfallpunkt fuer jede Solana-Funktion der App.
  const { RpcPool, parseUserEndpoints, DEFAULT_MAINNET_RPCS } = await import("@freedomstack/protocol");
  const konfiguriert = (window as unknown as { FREEDOM_SOL_RPC?: string }).FREEDOM_SOL_RPC;
  const RPC = new RpcPool(DEFAULT_MAINNET_RPCS, {
    userEndpoints: [
      ...(konfiguriert ? [konfiguriert] : []),
      ...parseUserEndpoints(localStorage.getItem("freedom.sol.rpcs")),
    ],
  }).bestUrl();
  const connection = new web3.Connection(RPC, "confirmed");

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
