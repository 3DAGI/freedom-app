/**
 * FreedomStack Client-Core: die plattform-agnostische Logik der App.
 *
 * Vier Bereiche, ein Download (siehe README):
 *   💬 Chat      — Nostr-Kommunikation (unzensierbar, Multi-Relay)
 *   🤖 KI        — DVM-Marktplatz: Job ausschreiben, Results empfangen, zappen
 *   ⚡ Wallet    — Lightning + Solana, Atomic Swap (non-custodial)
 *   🖥️ Verdienen — eigener Provider-Knoten (später: Seeker/GX10 on-device)
 *
 * Diese Schicht kennt KEIN UI-Framework. React-Native-/Web-/CLI-Shells
 * binden nur diese Klassen ein.
 */
import {
  Keypair,
  generateKeypair,
  signEvent,
  buildEvent,
  OutboxPool,
  fromHex,
  toHex,
  buildJobRequest,
  parseJobResult,
  isDvmResult,
  NostrEvent,
  KIND_DVM_TEXT_RESULT,
} from "@freedomstack/protocol";
import { schnorr } from "@noble/curves/secp256k1.js";

export interface Identity {
  keypair: Keypair;
  lud16?: string;
}

/** Identitaet: erzeugen oder aus gespeichertem Secret wiederherstellen. */
export function createIdentity(secretKeyHex?: string): Identity {
  if (secretKeyHex) {
    const sk = fromHex(secretKeyHex);
    return { keypair: { sk, pk: toHex(schnorr.getPublicKey(sk)) } };
  }
  return { keypair: generateKeypair() };
}

// ------------------------------------------------------------------ KI-Tab

export interface AiJobHandle {
  requestId: string;
  bidMsat: number;
}

export interface AiAnswer {
  requestId: string;
  providerPubkey: string;
  output: string;
  amountMsat: number;
}

/** Der KI-Tab der App: Jobs ausschreiben, Antworten einsammeln. */
export class AiMarketplaceClient {
  constructor(
    private identity: Identity,
    private pool: OutboxPool,
  ) {}

  /** Job ausschreiben (kind 5050). Gibt sofort ein Handle zurueck. */
  async ask(prompt: string, bidMsat: number, providerPubkey?: string): Promise<AiJobHandle> {
    const ev = signEvent(
      buildJobRequest({
        customerPubkey: this.identity.keypair.pk,
        input: prompt,
        bidMsat,
        providerPubkey,
      }),
      this.identity.keypair.sk,
    );
    await this.pool.publish(ev);
    return { requestId: ev.id, bidMsat };
  }

  /** Antworten zu einem Job einsammeln (kind 6050, e-Tag = requestId). */
  async answers(handle: AiJobHandle): Promise<AiAnswer[]> {
    const events = await this.pool.query({
      kinds: [KIND_DVM_TEXT_RESULT],
      "#e": [handle.requestId],
    });
    return events
      .filter((ev) => isDvmResult(ev.kind))
      .map((ev) => {
        const r = parseJobResult(ev);
        return {
          requestId: r.requestId,
          providerPubkey: r.providerPubkey,
          output: r.output,
          amountMsat: r.amountMsat,
        };
      });
  }

  /** Pollen, bis mindestens eine Antwort da ist oder Timeout. */
  async waitForAnswer(
    handle: AiJobHandle,
    timeoutMs = 60_000,
    pollMs = 3000,
  ): Promise<AiAnswer | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const a = await this.answers(handle);
      if (a.length > 0) return a[0];
      await new Promise((r) => setTimeout(r, pollMs));
    }
    return null;
  }
}

// ---------------------------------------------------------------- Chat-Tab

export interface ChatMessage {
  from: string;
  text: string;
  at: number;
}

/** Minimaler Chat-Tab: signierte Text-Notes (kind 1) ueber Multi-Relay. */
export class ChatClient {
  constructor(
    private identity: Identity,
    private pool: OutboxPool,
  ) {}

  async post(text: string): Promise<string> {
    const ev = signEvent(buildEvent(this.identity.keypair.pk, 1, [], text), this.identity.keypair.sk);
    await this.pool.publish(ev);
    return ev.id;
  }

  async feed(limit = 50): Promise<ChatMessage[]> {
    const events = await this.pool.query({ kinds: [1], limit });
    return events
      .map((ev: NostrEvent) => ({ from: ev.pubkey, text: ev.content, at: ev.created_at }))
      .sort((a, b) => b.at - a.at);
  }
}

export { OutboxPool, WebSocketRelay, MemoryRelay } from "@freedomstack/protocol";
