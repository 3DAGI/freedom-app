/**
 * TON-Zahlungen serverseitig verifizieren (Gram, native).
 *
 * Client sendet eine tx per TON Connect. Server prüft on-chain über
 * toncenter:
 *   1. getTransactions(depot) — neueste Transaktionen des Depot-Wallets
 *   2. Eingehend: out_msgs leer (oder nur excesses)
 *   3. Kommentar (in_msg.decoded_body.text) == erwarteter Auftrags-Kommentar
 *   4. Betrag (in_msg.value, nanoTON) == erwarteter Betrag
 *   5. Replay-Schutz: tx-hash merken, jede tx nur einmal gutschreiben
 *   6. Finalität: nur masterchain-included tx zählen (toncenter markiert das
 *      — für Testnet reicht confirmed)
 *
 * Polling-Takt: 10 s. Kein Webhook nötig, kein eigener Knoten.
 */
import { createHash } from "node:crypto";

const TESTNET = "https://testnet.toncenter.com/api/v2/jsonRPC";
const MAINNET = "https://toncenter.com/api/v2/jsonRPC";

interface RpcClient {
  call<T>(methode: string, params?: Record<string, unknown>): Promise<T>;
}

function rpc(endpoint: string, apiKey?: string): RpcClient {
  return {
    async call<T>(methode: string, params: Record<string, unknown> = {}): Promise<T> {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (apiKey) headers["X-API-Key"] = apiKey;
      const r = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: methode, params }),
      });
      const j = (await r.json()) as { result?: T; error?: { message: string } };
      if (j.error) throw new Error(`ton ${methode}: ${j.error.message}`);
      if (!j.result) throw new Error(`ton ${methode}: kein Ergebnis`);
      return j.result;
    },
  };
}

export interface TonTx {
  hash: string;
  lt: string;
  utime: number;
  /** Eingangsnachricht (die Zahlung). */
  in_msg?: {
    source?: string;
    value?: string;       // nanoTON als String
    decoded_body?: { text?: string; comment?: string };
    message?: string;
    msg_data?: { text?: string };
  };
  out_msgs_count?: number;
}

export interface TonZahlung {
  /** Nur zur Protokollierung — der Verifier vergleicht nano + kommentar. */
  auftrag?: string;
  nano: string;      // erwarteter Betrag in nanoTON
  kommentar: string; // erwarteter Kommentar
}

export interface TonBeleg {
  hash: string;
  von: string;
  nano: string;
  kommentar: string;
  utime: number;
}

export interface TonVerifier {
  /** Prüft, ob eine passende tx existiert (noch nicht verbraucht). */
  pruefe(depot: string, erwartung: TonZahlung): Promise<TonBeleg | undefined>;
  /** tx als verbraucht markieren (nach Gutschrift). */
  verbrauche(beleg: TonBeleg): void;
}

/**
 * Kommentar dekodieren: toncenter liefert in_msg.decoded_body.text (bei
 * Text-Kommentar, op 0x00000000) oder msg_data.text je Version.
 */
function txKommentar(tx: TonTx): string | undefined {
  const im = tx.in_msg;
  if (!im) return undefined;
  return im.decoded_body?.text ?? im.decoded_body?.comment ?? im.msg_data?.text;
}

/** nanoTON → lesbare Zahl (1 TON = 1e9 nano). */
export function nanoNachTon(nano: string | number): number {
  return Number(BigInt(nano)) / 1e9;
}
/** TON → nanoTON-String. */
export function tonNachNano(ton: number): string {
  return BigInt(Math.round(ton * 1e9)).toString();
}

/**
 * Verifier mit Replay-Schutz. `verbraucht` kann persistent übergeben werden
 * (Datei/DB) — sonst nur pro Prozess.
 */
export function tonVerifier(opts: { testnet?: boolean; apiKey?: string; verbraucht?: Set<string> } = {}): TonVerifier {
  const client = rpc(opts.testnet === false ? MAINNET : TESTNET, opts.apiKey);
  const verbraucht = opts.verbraucht ?? new Set<string>();

  return {
    async pruefe(depot, erwartung) {
      // Neueste 20 tx — genug, Polling läuft alle 10 s.
      const res = await client.call<{ transactions: TonTx[] } | TonTx[]>("getTransactions", {
        address: depot,
        limit: 20,
      });
      const txs = Array.isArray(res) ? res : res.transactions ?? [];
      for (const tx of txs) {
        if (!tx.in_msg) continue;                       // ausgehend
        if ((tx.out_msgs_count ?? 0) > 0) continue;     // kein reiner Eingang
        const kommentar = txKommentar(tx);
        if (kommentar !== erwartung.kommentar) continue;
        const wert = tx.in_msg.value ?? "0";
        if (wert !== erwartung.nano) continue;          // exakter Betrag
        if (verbraucht.has(tx.hash)) continue;          // Replay
        return {
          hash: tx.hash,
          von: tx.in_msg.source ?? "?",
          nano: wert,
          kommentar,
          utime: tx.utime,
        };
      }
      return undefined;
    },
    verbrauche(beleg) {
      verbraucht.add(beleg.hash);
    },
  };
}

/**
 * Stable Ablage des Verbraucht-Sets (JSON, atomar geschrieben).
 * Damit überlebt der Replay-Schutz einen Node-Neustart.
 */
export function ladeVerbraucht(json: string | undefined): Set<string> {
  if (!json) return new Set();
  try {
    const arr = JSON.parse(json) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}

export function speichereVerbraucht(set: Set<string>, datei: string, schreibe: (p: string, c: string) => void): void {
  schreibe(datei, JSON.stringify([...set]));
}

/** Digest für Logs (tx-hash nie im Klartext in fremde Logs). */
export function txAbdruck(hash: string): string {
  return createHash("sha256").update(hash).digest("hex").slice(0, 12);
}
