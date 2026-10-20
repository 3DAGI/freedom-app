/**
 * Die Kette als Attrappe für kit (A-21d3b): ein Endpunkt hinter einem echten `RpcPool`. Er nennt einen
 * Blockhash (echte 32 Byte – kit prüft das), nimmt Transaktionen an und merkt ihre Bytes, meldet sie
 * bestätigt und liest Konten und Guthaben aus `konten`. `fehler`: Die Kette bestätigt die Transaktion
 * mit diesem Fehler; `vorab`: Schon die Vorabsimulation lehnt ab (Programmfehler in Anweisung 0) – dann
 * wird nichts gemerkt. Die Signatur ist die erste aus dem Draht, wie bei einer echten Kette.
 */
import { base58 } from "@scure/base";
import { RpcPool, poolRpc, type SolRpc } from "@freedomstack/protocol";

export const ATTRAPPE_BLOCKHASH = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k";

export interface AttrappenKonto { owner: string; data: Uint8Array; lamports?: number; executable?: boolean }

export function ketteAttrappe(o: {
  blockhash?: string; fehler?: unknown; vorab?: number; konten?: Map<string, AttrappenKonto>; beimSenden?: (roh: Uint8Array) => void;
} = {}): { rpc: SolRpc; gesendet: Uint8Array[]; signaturen: string[]; anfragen: Array<{ method: string; params: unknown[] }> } {
  const gesendet: Uint8Array[] = [];
  const signaturen: string[] = [];
  const anfragen: Array<{ method: string; params: unknown[] }> = [];
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const { id, method, params } = JSON.parse(String(init!.body)) as { id: number; method: string; params: unknown[] };
    anfragen.push({ method, params });
    const antwort = (x: object) => new Response(JSON.stringify({ jsonrpc: "2.0", id, ...x }));
    const wert = (value: unknown) => antwort({ result: { context: { slot: 1 }, value } });
    switch (method) {
      case "getLatestBlockhash":
        return wert({ blockhash: o.blockhash ?? ATTRAPPE_BLOCKHASH, lastValidBlockHeight: 1_000 });
      case "sendTransaction": {
        if (o.vorab !== undefined) {
          return antwort({ error: {
            code: -32002, message: "Transaction simulation failed",
            data: { err: { InstructionError: [0, { Custom: o.vorab }] }, logs: [], accounts: null, unitsConsumed: 0 },
          } });
        }
        const roh = new Uint8Array(Buffer.from(String(params[0]), "base64"));
        gesendet.push(roh);
        o.beimSenden?.(roh);
        // Erste Signatur: nach der Anzahl (ein Byte bis 127 Unterschriften) die ersten 64 Byte
        signaturen.push(base58.encode(roh.subarray(1, 65)));
        return antwort({ result: signaturen[signaturen.length - 1] });
      }
      case "getSignatureStatuses":
        return wert([{ slot: 2, confirmations: 1, err: o.fehler ?? null, confirmationStatus: "confirmed" }]);
      case "getBlockHeight":
        return antwort({ result: 10 });
      case "getAccountInfo": {
        const k = o.konten?.get(String(params[0]));
        return wert(k ? {
          data: [Buffer.from(k.data).toString("base64"), "base64"], executable: k.executable ?? false,
          lamports: k.lamports ?? 1, owner: k.owner, rentEpoch: 0, space: k.data.length,
        } : null);
      }
      case "getBalance":
        return wert(o.konten?.get(String(params[0]))?.lamports ?? 0);
    }
    throw new TypeError(`Attrappe kennt ${method} nicht`);
  }) as typeof fetch;
  return { rpc: poolRpc(new RpcPool([{ url: "https://rpc.test" }], { fetchImpl })), gesendet, signaturen, anfragen };
}
