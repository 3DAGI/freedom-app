/**
 * Nip46Signer (Schritt 1.3): Der Schluessel bleibt in einem entfernten Signer
 * („Bunker“, z. B. nsecBunker oder Amber) – die App fragt Unterschriften und
 * NIP-44-Operationen ueber Relays ab (NIP-46).
 *
 * ABLAUF
 * Die Verbindung kommt als `bunker://<signer-pubkey>?relay=wss://…&secret=…`.
 * Die App erzeugt einen Wegwerf-Schluessel und schickt Anfragen als Kind 24133
 * an den Signer, Inhalt NIP-44-verschluesselt: {id, method, params}. Der Signer
 * antwortet ebenso mit {id, result, error}.
 *
 * DEM SIGNER NICHT BLIND GLAUBEN
 * - Antworten zaehlen nur vom Signer-Pubkey, mit gueltiger Signatur und passender id.
 * - Ein signiertes Event muss genau das angefragte sein (kind, Inhalt, Tags,
 *   Zeit, pubkey des Nutzers) und eine gueltige Signatur tragen.
 * - Verlangt der Signer eine Freigabe (`auth_url`), meldet der Aufruf das mit
 *   der Adresse – geoeffnet wird nichts automatisch.
 *
 * Der Verweis der Karte auf devices.ts passte nicht: Dort gibt es bewusst kein
 * NIP-46 (Geraetschluessel, offline). Dies ist die neue, eigenstaendige Umsetzung.
 */
import { NostrEvent, UnsignedEvent, buildEvent, generateKeypair, verifyEvent } from "./event.js";
import type { RelayFilter } from "./outbox.js";
import { LocalSigner, type Signer } from "./signer.js";

export const KIND_NIP46 = 24133;

const HEX64 = /^[0-9a-f]{64}$/;

export interface BunkerUri {
  signerPubkey: string;
  relays: string[];
  secret?: string;
}

/** Nur was der Signer zum Verbinden braucht – der Pool der App passt. */
export interface Nip46Transport {
  publish(ev: NostrEvent): Promise<unknown>;
  query(filter: RelayFilter): Promise<NostrEvent[]>;
}

export interface Nip46Options {
  transport: Nip46Transport;
  /** Wegwerf-Schluessel des Clients; ohne Angabe neu erzeugt. */
  clientSk?: Uint8Array;
  /**
   * Pubkey des Nutzers aus einer frueheren Verbindung – nimmt die Sitzung
   * ohne neues `connect()` wieder auf (gleicher `clientSk` noetig).
   */
  nutzer?: string;
  timeoutMs?: number;
  pollMs?: number;
}

/** `bunker://`-Adresse lesen; alles Unerwartete wird abgelehnt. */
export function parseBunkerUri(uri: string): BunkerUri {
  let u: URL;
  try { u = new URL(uri.trim()); } catch { throw new Error("Keine gültige bunker://-Adresse"); }
  if (u.protocol !== "bunker:") throw new Error("Keine gültige bunker://-Adresse");
  const signerPubkey = (u.hostname || u.pathname.replace(/^\/+/, "")).toLowerCase();
  if (!HEX64.test(signerPubkey)) throw new Error("Signer-Pubkey ungültig (64 Zeichen hex erwartet)");
  const relays = u.searchParams.getAll("relay").filter((r) => /^wss:\/\/[^\s]+$/i.test(r));
  if (relays.length === 0) throw new Error("Keine Relay-Adresse (wss://) in der bunker://-Adresse");
  const secret = u.searchParams.get("secret") ?? undefined;
  return { signerPubkey, relays, secret };
}

function zufallsId(): string {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export class Nip46Signer implements Signer {
  readonly #client: LocalSigner;
  readonly #bunker: BunkerUri;
  readonly #transport: Nip46Transport;
  readonly #timeoutMs: number;
  readonly #pollMs: number;
  #nutzer: string | null = null;

  constructor(bunker: BunkerUri | string, opts: Nip46Options) {
    this.#bunker = typeof bunker === "string" ? parseBunkerUri(bunker) : bunker;
    this.#client = new LocalSigner(opts.clientSk ?? generateKeypair().sk);
    this.#transport = opts.transport;
    this.#timeoutMs = opts.timeoutMs ?? 30_000;
    this.#pollMs = opts.pollMs ?? 1_000;
    if (opts.nutzer !== undefined) {
      if (!HEX64.test(opts.nutzer)) throw new Error("Nutzer-Pubkey ungültig (64 Zeichen hex erwartet)");
      this.#nutzer = opts.nutzer;
    }
  }

  /** Verbinden (mit Geheimnis, falls die Adresse eins traegt) und Nutzer-Pubkey holen. */
  async connect(): Promise<string> {
    const params = [this.#bunker.signerPubkey];
    if (this.#bunker.secret) params.push(this.#bunker.secret);
    await this.#anfrage("connect", params);
    const pk = await this.#anfrage("get_public_key", []);
    if (!HEX64.test(pk)) throw new Error("Signer lieferte keinen gültigen Pubkey");
    this.#nutzer = pk;
    return pk;
  }

  publicKey(): string {
    if (!this.#nutzer) throw new Error("Nicht verbunden – erst connect()");
    return this.#nutzer;
  }

  async signEvent(ev: UnsignedEvent): Promise<NostrEvent> {
    const pk = this.publicKey();
    if (ev.pubkey !== pk) throw new Error("Event gehört zu einem anderen Schlüssel");
    const anfrage = { kind: ev.kind, content: ev.content, tags: ev.tags, created_at: ev.created_at };
    const roh = await this.#anfrage("sign_event", [JSON.stringify(anfrage)]);
    let signiert: NostrEvent;
    try { signiert = JSON.parse(roh) as NostrEvent; } catch { throw new Error("Signer lieferte kein Event"); }
    // Genau das angefragte Event, vom Nutzer, gueltig signiert – sonst nichts.
    const gleich = signiert.pubkey === pk && signiert.kind === ev.kind && signiert.content === ev.content
      && signiert.created_at === ev.created_at && JSON.stringify(signiert.tags) === JSON.stringify(ev.tags);
    if (!gleich || !verifyEvent(signiert)) throw new Error("Signer lieferte ein anderes oder ungültiges Event");
    return signiert;
  }

  async nip44Encrypt(peerPk: string, text: string): Promise<string> {
    if (!HEX64.test(peerPk)) throw new Error("Pubkey ungültig (64 Zeichen hex erwartet)");
    return this.#anfrage("nip44_encrypt", [peerPk, text]);
  }

  async nip44Decrypt(peerPk: string, payload: string): Promise<string> {
    if (!HEX64.test(peerPk)) throw new Error("Pubkey ungültig (64 Zeichen hex erwartet)");
    return this.#anfrage("nip44_decrypt", [peerPk, payload]);
  }

  toJSON(): { type: string; signer: string; pubkey: string | null } {
    return { type: "Nip46Signer", signer: this.#bunker.signerPubkey, pubkey: this.#nutzer };
  }

  /** Eine Anfrage schicken und auf die passende, echte Antwort warten. */
  async #anfrage(method: string, params: string[]): Promise<string> {
    const id = zufallsId();
    const signer = this.#bunker.signerPubkey;
    const clientPk = this.#client.publicKey();
    const inhalt = await this.#client.nip44Encrypt(signer, JSON.stringify({ id, method, params }));
    const jetzt = Math.floor(Date.now() / 1000);
    const ev = await this.#client.signEvent(buildEvent(clientPk, KIND_NIP46, [["p", signer]], inhalt, jetzt));
    await this.#transport.publish(ev);

    const ende = Date.now() + this.#timeoutMs;
    while (Date.now() < ende) {
      const antworten = await this.#transport.query({
        kinds: [KIND_NIP46], authors: [signer], "#p": [clientPk], since: jetzt - 60,
      });
      for (const a of antworten) {
        if (a.pubkey !== signer || !verifyEvent(a)) continue;
        let r: { id?: unknown; result?: unknown; error?: unknown };
        try { r = JSON.parse(await this.#client.nip44Decrypt(signer, a.content)); } catch { continue; }
        if (r.id !== id) continue;
        if (r.result === "auth_url") {
          throw new Error(`Signer verlangt eine Freigabe: ${typeof r.error === "string" ? r.error : "(ohne Adresse)"}`);
        }
        if (typeof r.error === "string" && r.error) throw new Error(`Signer lehnt ab: ${r.error}`);
        if (typeof r.result !== "string") throw new Error("Signer lieferte keine gültige Antwort");
        return r.result;
      }
      await new Promise((res) => setTimeout(res, this.#pollMs));
    }
    throw new Error(`Keine Antwort vom Signer (${method})`);
  }
}
