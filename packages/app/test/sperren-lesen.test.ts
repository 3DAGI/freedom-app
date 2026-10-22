/**
 * A-21c: Sperren liest die App über kit auf dem RpcPool (`solRpc()` in `shell/state.ts`) –
 * der Rückhol-Wächter (welche Sperren sind noch offen?), die Prüfung der Gegenseite im
 * Tausch und der Verdienen-Tab. Lesen baut keine eigene Verbindung mehr; geschrieben wird
 * bis A-21d weiter über web3.js.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import { AnchorSolanaHtlc, HTLC_PROGRAMM_ID, poolRpc, RpcPool } from "@freedomstack/protocol";
import { walletRefundRunner } from "../src/refund-watcher.js";

/** Ein Swap-Konto des HTLC-Programms: Diskriminator, IDs, Hashlock, Frist, Betrag, eingelöst, zurückgeholt, Bump. */
function sperre(eingeloest: boolean, zurueck: boolean): Buffer {
  const d = Buffer.alloc(8 + 32 * 4 + 8 + 8 + 3);
  Keypair.generate().publicKey.toBuffer().copy(d, 40);
  Keypair.generate().publicKey.toBuffer().copy(d, 72);
  d.writeBigInt64LE(1_790_000_000n, 136);
  d.writeBigUInt64LE(1_000_000n, 144);
  d[152] = eingeloest ? 1 : 0;
  d[153] = zurueck ? 1 : 0;
  return d;
}

test("Rückhol-Wächter: offen sind nur Sperren auf der Kette, die weder eingelöst noch zurückgeholt sind", async () => {
  const pda = (id: string) => AnchorSolanaHtlc.deriveSwapPda(id).pda.toBase58();
  const konten = new Map([
    [pda("offen"), sperre(false, false)],
    [pda("eingeloest"), sperre(true, false)],
    [pda("zurueck"), sperre(false, true)],
  ]);
  const gefragt: string[] = [];
  const rpc = poolRpc(new RpcPool([{ url: "https://rpc.test" }], {
    fetchImpl: (async (_u: unknown, init?: RequestInit) => {
      const { id, params } = JSON.parse(String(init!.body)) as { id: number; params: [string] };
      gefragt.push(params[0]);
      const d = konten.get(params[0]);
      const value = d ? { data: [d.toString("base64"), "base64"], executable: false, lamports: 1, owner: HTLC_PROGRAMM_ID, rentEpoch: 0, space: d.length } : null;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: { context: { slot: 1 }, value } }));
    }) as typeof fetch,
  }));
  const runner = walletRefundRunner({} as Parameters<typeof walletRefundRunner>[0], rpc);
  assert.deepEqual(await runner.offen!(["offen", "eingeloest", "zurueck", "weg"], "swap"), ["offen"]);
  assert.deepEqual(gefragt, ["offen", "eingeloest", "zurueck", "weg"].map(pda), "nur über den Pool, je Sperre einmal");
});

test("verdrahtet: Sperren und Kanäle nur über solRpc() lesen – der gemeinsame Pool", () => {
  const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
  const state = src("shell/state.ts");
  const f = state.slice(state.indexOf("export async function solRpc("), state.indexOf("export async function solRpcUrl()"));
  assert.ok(f.length > 0, "solRpc() gefunden");
  assert.match(f, /ensureRpcPool\(\)/);
  // Ohne Angabe der gemeinsame Pool; ein Vorgang (A-21d3a) bleibt bei einem Anbieter desselben Pools
  assert.match(f, /return poolRpc\(opts\.einVorgang \? pool\.einVorgang\(\) : pool\);/);
  const tausch = src("shell/tabs/tausch.ts");
  assert.match(tausch, /const reader = AnchorSolanaHtlc\.reader\(await solRpc\(\)\);/);
  // Lesen über den gemeinsamen Pool, jede Rückholung ein eigener Vorgang (A-21d3b)
  assert.match(tausch, /walletRefundRunner\(signer, await solRpc\(\), \(\) => solRpc\(\{ einVorgang: true \}\)\)/);
  assert.doesNotMatch(tausch, /reader\(new Connection/);
  assert.match(src("refund-watcher.ts"), /const leser = AnchorSolanaHtlc\.reader\(rpc\);/);
  assert.match(src("shell/zahlkanal-ui.ts"), /await programmBereit\(await solRpc\(\)\)/);
});
