/**
 * Browser-Shim fuer node:fs/promises — die betroffenen Funktionen
 * (loadMacaroonHex, loadSolanaKeypair) sind Node-only-Features
 * (LND-/Solana-Adapter), die in der Browser-App nie aufgerufen werden.
 * Shim wirft erst bei tatsaechlichem Aufruf, nicht beim Import.
 */
export async function readFile(): Promise<never> {
  throw new Error("fs nicht verfuegbar im Browser (Node-only-Adapter)");
}
