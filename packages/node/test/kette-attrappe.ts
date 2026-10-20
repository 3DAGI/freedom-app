/**
 * Die Kette als JSON-RPC-Server auf 127.0.0.1 (A-21e1): Der Knoten bekommt nur eine Adresse
 * (`SOLANA_RPC_URL`) und baut den Pool selbst – geprüft wird so der ganze Weg über kit und den
 * `RpcPool`. Der Server nennt einen Blockhash, nimmt Transaktionen an und merkt ihre Bytes, meldet
 * sie bestätigt (mit `fehler`, wenn gesetzt) und liest Konten und Guthaben aus `konten`. Die
 * Signatur ist die erste aus dem Draht, wie bei einer echten Kette.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { base58 } from "@scure/base";

export const ATTRAPPE_BLOCKHASH = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k";

export interface AttrappenKonto { owner: string; data?: Uint8Array; lamports?: bigint; executable?: boolean }

export async function ketteAufPort(o: { konten?: Map<string, AttrappenKonto>; fehler?: unknown } = {}): Promise<{
  url: string; gesendet: Uint8Array[]; anfragen: Array<{ method: string; params: unknown[] }>; schliesse(): Promise<void>;
}> {
  const gesendet: Uint8Array[] = [];
  const anfragen: Array<{ method: string; params: unknown[] }> = [];
  const antwortAuf = (method: string, params: unknown[]): { result?: unknown; error?: unknown } => {
    const wert = (value: unknown) => ({ result: { context: { slot: 1 }, value } });
    switch (method) {
      case "getLatestBlockhash": return wert({ blockhash: ATTRAPPE_BLOCKHASH, lastValidBlockHeight: 1_000 });
      case "sendTransaction": {
        const roh = new Uint8Array(Buffer.from(String(params[0]), "base64"));
        gesendet.push(roh);
        return { result: base58.encode(roh.subarray(1, 65)) };
      }
      case "getSignatureStatuses": return wert([{ slot: 2, confirmations: 1, err: o.fehler ?? null, confirmationStatus: "confirmed" }]);
      case "getBlockHeight": return { result: 10 };
      case "getAccountInfo": {
        const k = o.konten?.get(String(params[0]));
        const daten = k?.data ?? new Uint8Array(0);
        return wert(k ? {
          data: [Buffer.from(daten).toString("base64"), "base64"], executable: k.executable ?? false,
          lamports: Number(k.lamports ?? 1n), owner: k.owner, rentEpoch: 0, space: daten.length,
        } : null);
      }
      case "getBalance": return wert(Number(o.konten?.get(String(params[0]))?.lamports ?? 0n));
    }
    return { error: { code: -32601, message: "Method not found" } };
  };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d: Buffer) => { body += d.toString("utf8"); });
    req.on("end", () => {
      const { id, method, params } = JSON.parse(body) as { id: number; method: string; params: unknown[] };
      anfragen.push({ method, params });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id, ...antwortAuf(method, params ?? []) }));
    });
  });
  await new Promise<void>((fertig) => server.listen(0, "127.0.0.1", fertig));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`, gesendet, anfragen,
    schliesse: () => new Promise<void>((fertig) => server.close(() => fertig())),
  };
}
