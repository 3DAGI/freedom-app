/**
 * NWC-Tests (NIP-47) inklusive eines simulierten Wallets.
 *
 * Die Wallet-Simulation ist der Punkt: ohne sie liesse sich nur pruefen, ob
 * Strings richtig zusammengesetzt werden. Mit ihr laeuft der komplette Weg
 * — Kommando verschluesseln, ueber den Relay-Pool schicken, Antwort
 * entschluesseln — genau so wie mit einem echten Wallet am Handy.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OutboxPool,
  MemoryRelay,
} from "../src/outbox.js";
import { generateKeypair, signEvent, buildEvent, NostrEvent } from "../src/event.js";
import { toHex } from "../src/htlc.js";
import { nip04Encrypt, nip04Decrypt, isNip04Payload } from "../src/nip04.js";
import { encryptDM } from "../src/dm.js";
import {
  parseNwcUri,
  formatNwcUri,
  redactNwcUri,
  NwcClient,
  parseNwcResponse,
  buildNwcRequest,
  explainNwcError,
  detectPaymentCapabilities,
  KIND_NWC_INFO,
  KIND_NWC_RESPONSE,
  KIND_NWC_REQUEST,
} from "../src/nwc.js";

// ------------------------------------------------------------- NIP-04

test("NIP-04: Roundtrip zwischen zwei Parteien", () => {
  const a = generateKeypair();
  const b = generateKeypair();
  const ct = nip04Encrypt("pay_invoice bitte", a.sk, b.pk);

  assert.ok(isNip04Payload(ct), "Payload muss ?iv= enthalten");
  assert.equal(nip04Decrypt(ct, b.sk, a.pk), "pay_invoice bitte");
});

test("NIP-04: Dritter kann nicht lesen", () => {
  const a = generateKeypair();
  const b = generateKeypair();
  const c = generateKeypair();
  const ct = nip04Encrypt("geheim", a.sk, b.pk);
  assert.throws(() => nip04Decrypt(ct, c.sk, a.pk));
});

test("NIP-04: kaputtes Format wird sauber abgelehnt", () => {
  const a = generateKeypair();
  assert.throws(() => nip04Decrypt("keinIvHier", a.sk, a.pk), /ohne \?iv=/);
});

// ------------------------------------------------------------- URI-Parsing

const WALLET_PK = "a".repeat(64);
const SECRET = "b3".repeat(32);

test("NWC-URI: vollstaendige URI wird korrekt zerlegt", () => {
  const c = parseNwcUri(
    `nostr+walletconnect://${WALLET_PK}?relay=wss://relay.one&relay=wss://relay.two&secret=${SECRET}&lud16=me@wallet.cash`,
  );
  assert.equal(c.walletPubkey, WALLET_PK);
  assert.deepEqual(c.relays, ["wss://relay.one", "wss://relay.two"]);
  assert.equal(toHex(c.secretKey), SECRET);
  assert.equal(c.lud16, "me@wallet.cash");
  assert.match(c.clientPubkey, /^[0-9a-f]{64}$/);
});

test("NWC-URI: mehrere Relays bleiben erhalten (Multi-Relay-Invariante)", () => {
  const c = parseNwcUri(
    `nostr+walletconnect://${WALLET_PK}?relay=wss://a&relay=wss://b&relay=wss://c&secret=${SECRET}`,
  );
  assert.equal(c.relays.length, 3, "kein Relay darf verloren gehen");
});

test("NWC-URI: fehlerhafte Eingaben ergeben verstaendliche Fehler", () => {
  assert.throws(() => parseNwcUri("https://example.com"), /nostr\+walletconnect/);
  assert.throws(() => parseNwcUri(`nostr+walletconnect://xyz?relay=wss://a&secret=${SECRET}`), /Hex/);
  assert.throws(() => parseNwcUri(`nostr+walletconnect://${WALLET_PK}?secret=${SECRET}`), /kein relay/);
  assert.throws(() => parseNwcUri(`nostr+walletconnect://${WALLET_PK}?relay=wss://a`), /secret/);
});

test("NWC-URI: Leerzeichen und Grossschreibung stoeren nicht (Copy-Paste vom Handy)", () => {
  const c = parseNwcUri(
    `  NOSTR+WALLETCONNECT://${WALLET_PK.toUpperCase()}?relay=wss://a&secret=${SECRET.toUpperCase()}  `,
  );
  assert.equal(c.walletPubkey, WALLET_PK);
});

test("NWC-URI: Roundtrip format -> parse", () => {
  const original = parseNwcUri(`nostr+walletconnect://${WALLET_PK}?relay=wss://a&secret=${SECRET}`);
  const again = parseNwcUri(formatNwcUri(original));
  assert.equal(again.walletPubkey, original.walletPubkey);
  assert.equal(toHex(again.secretKey), toHex(original.secretKey));
});

test("NWC-URI: Anzeige-Variante enthaelt das Secret nicht", () => {
  const uri = `nostr+walletconnect://${WALLET_PK}?relay=wss://a&secret=${SECRET}`;
  const shown = redactNwcUri(uri);
  assert.ok(!shown.includes(SECRET), "Secret darf nie in der UI landen");
  assert.ok(shown.includes(WALLET_PK));
});

// ------------------------------------------------------------- Simuliertes Wallet

/**
 * Minimales NWC-Wallet: liest Kommandos vom Relay, antwortet verschluesselt.
 * Genau das, was ein Alby Hub oder eine Mobile-Wallet auf der Gegenseite tut.
 */
class FakeWallet {
  public paid: { invoice: string; amount?: number }[] = [];
  constructor(
    private kp: { sk: Uint8Array; pk: string },
    private pool: OutboxPool,
    private balanceMsat = 500_000,
    private failWith?: { code: string; message: string },
  ) {}

  get pubkey(): string { return this.kp.pk; }

  async publishInfo(methods = "pay_invoice get_balance make_invoice pay_keysend", nip44 = false): Promise<void> {
    const tags = nip44 ? [["encryption", "nip44_v2 nip04"]] : [];
    await this.pool.publish(signEvent(buildEvent(this.kp.pk, KIND_NWC_INFO, tags, methods), this.kp.sk));
  }

  /** Alle offenen Kommandos abarbeiten. */
  async processOnce(): Promise<number> {
    const reqs = await this.pool.query({ kinds: [KIND_NWC_REQUEST], "#p": [this.kp.pk] });
    let handled = 0;
    for (const req of reqs) {
      if (this.seen.has(req.id)) continue;
      this.seen.add(req.id);
      const json = nip04Decrypt(req.content, this.kp.sk, req.pubkey);
      const { method, params } = JSON.parse(json) as { method: string; params: Record<string, unknown> };

      let body: Record<string, unknown>;
      if (this.failWith) {
        body = { result_type: method, error: this.failWith };
      } else if (method === "get_balance") {
        body = { result_type: method, result: { balance: this.balanceMsat } };
      } else if (method === "pay_invoice") {
        this.paid.push({ invoice: String(params.invoice), amount: params.amount as number });
        body = { result_type: method, result: { preimage: "aa".repeat(32), fees_paid: 1000 } };
      } else if (method === "pay_keysend") {
        body = { result_type: method, result: { preimage: "bb".repeat(32) } };
      } else if (method === "make_invoice") {
        body = { result_type: method, result: { invoice: "lnbc1test", payment_hash: "cc".repeat(32) } };
      } else {
        body = { result_type: method, error: { code: "NOT_IMPLEMENTED", message: "unbekannt" } };
      }

      const content = nip04Encrypt(JSON.stringify(body), this.kp.sk, req.pubkey);
      await this.pool.publish(
        signEvent(
          buildEvent(this.kp.pk, KIND_NWC_RESPONSE, [["e", req.id], ["p", req.pubkey]], content),
          this.kp.sk,
        ),
      );
      handled++;
    }
    return handled;
  }

  private seen = new Set<string>();
}

function setup(failWith?: { code: string; message: string }) {
  const pool = new OutboxPool([new MemoryRelay("mem://nwc")], { minAcks: 1 });
  const walletKp = generateKeypair();
  const clientKp = generateKeypair();
  const wallet = new FakeWallet(walletKp, pool, 500_000, failWith);
  const uri = `nostr+walletconnect://${walletKp.pk}?relay=mem://nwc&secret=${toHex(clientKp.sk)}`;
  const client = new NwcClient(parseNwcUri(uri), pool, 8000);
  return { pool, wallet, client };
}

/** Wallet im Hintergrund mitlaufen lassen, waehrend der Client wartet. */
function runWallet(wallet: FakeWallet, ms = 6000): NodeJS.Timeout {
  const h = setInterval(() => { void wallet.processOnce(); }, 200);
  setTimeout(() => clearInterval(h), ms);
  return h;
}

test("NWC: Guthaben abfragen — kompletter Weg ueber den Relay", async () => {
  const { wallet, client } = setup();
  await wallet.publishInfo();
  const h = runWallet(wallet);
  try {
    assert.equal(await client.getBalance(), 500_000);
  } finally {
    clearInterval(h);
  }
});

test("NWC: Rechnung bezahlen liefert das Preimage als Zahlungsbeweis", async () => {
  const { wallet, client } = setup();
  await wallet.publishInfo();
  const h = runWallet(wallet);
  try {
    const res = await client.payInvoice("lnbc10n1testinvoice");
    assert.equal(res.preimage, "aa".repeat(32));
    assert.equal(res.feesPaidMsat, 1000);
    assert.equal(wallet.paid.length, 1);
    assert.equal(wallet.paid[0].invoice, "lnbc10n1testinvoice");
  } finally {
    clearInterval(h);
  }
});

test("NWC: Keysend funktioniert (Provider-Bezahlung ohne Rechnung)", async () => {
  const { wallet, client } = setup();
  await wallet.publishInfo();
  const h = runWallet(wallet);
  try {
    const res = await client.payKeysend("03aabb", 21_000);
    assert.equal(res.preimage, "bb".repeat(32));
  } finally {
    clearInterval(h);
  }
});

test("NWC: Rechnung erzeugen (Empfangen)", async () => {
  const { wallet, client } = setup();
  await wallet.publishInfo();
  const h = runWallet(wallet);
  try {
    const inv = await client.makeInvoice(1000, "freedom test");
    assert.equal(inv.invoice, "lnbc1test");
  } finally {
    clearInterval(h);
  }
});

test("NWC: Wallet-Fehler kommt als verstaendlicher Satz an, nicht als Code", async () => {
  const { wallet, client } = setup({ code: "QUOTA_EXCEEDED", message: "budget exceeded" });
  await wallet.publishInfo();
  const h = runWallet(wallet);
  try {
    await assert.rejects(() => client.getBalance(), /Budget .* aufgebraucht/);
  } finally {
    clearInterval(h);
  }
});

test("NWC: nicht unterstuetzte Methode wird vorab abgefangen", async () => {
  const { wallet, client } = setup();
  await wallet.publishInfo("get_balance"); // pay_invoice fehlt bewusst
  await client.init();
  await assert.rejects(() => client.payInvoice("lnbc1"), /unterstützt "pay_invoice" nicht/);
});

test("NWC: ohne Info-Event wird nichts vorschnell abgelehnt", async () => {
  const { wallet, client } = setup();
  // KEIN publishInfo — aeltere Wallets liefern keins.
  const info = await client.init();
  assert.equal(info.encryption, "nip04", "sicherer Fallback");
  assert.equal(client.supports("pay_invoice"), true, "unbekannt heisst nicht 'kann nicht'");

  const h = runWallet(wallet);
  try {
    assert.equal(await client.getBalance(), 500_000);
  } finally {
    clearInterval(h);
  }
});

test("NWC: Wallet offline -> klare Fehlermeldung statt Haenger", async () => {
  const { client } = setup();
  const fast = new NwcClient(client.connection, (client as unknown as { pool: OutboxPool })["pool"], 2500);
  await assert.rejects(() => fast.getBalance(), /nicht geantwortet/);
});

test("NWC: NIP-44 wird genutzt, wenn das Wallet es ankuendigt", async () => {
  const { wallet, client } = setup();
  await wallet.publishInfo("get_balance pay_invoice", true);
  const info = await client.init();
  assert.equal(info.encryption, "nip44_v2");
});

test("NWC: Kommando traegt ein Ablaufdatum", async () => {
  const conn = parseNwcUri(`nostr+walletconnect://${WALLET_PK}?relay=wss://a&secret=${SECRET}`);
  const ev = await buildNwcRequest(conn, { method: "get_balance", params: {} }, "nip04", 120);
  const exp = Number(ev.tags.find((t) => t[0] === "expiration")?.[1] ?? 0);
  // Ein Zahlungsbefehl, der Tage spaeter noch ausgefuehrt werden kann, ist ein Risiko.
  assert.ok(exp > Math.floor(Date.now() / 1000), "expiration muss in der Zukunft liegen");
});

test("NWC: Antwort eines fremden Keys laesst sich nicht entschluesseln", async () => {
  const conn = parseNwcUri(`nostr+walletconnect://${WALLET_PK}?relay=wss://a&secret=${SECRET}`);
  const fremd = generateKeypair();
  const content = nip04Encrypt(JSON.stringify({ result_type: "get_balance", result: { balance: 99 } }), fremd.sk, conn.clientPubkey);
  const ev = signEvent(buildEvent(fremd.pk, KIND_NWC_RESPONSE, [], content), fremd.sk) as NostrEvent;
  await assert.rejects(() => parseNwcResponse(ev, conn));
});

test("NWC: Fehlercodes sind uebersetzt, unbekannte fallen nicht durchs Raster", () => {
  assert.match(explainNwcError({ code: "INSUFFICIENT_BALANCE", message: "" }), /Guthaben/);
  assert.match(explainNwcError({ code: "UNAUTHORIZED", message: "" }), /widerrufen/);
  assert.equal(explainNwcError({ code: "WEIRD", message: "etwas Eigenes" }), "etwas Eigenes");
});

test("Geraete-Erkennung: Mobile bekommt NWC empfohlen, nicht WebLN", () => {
  const iphone = detectPaymentCapabilities("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
  assert.equal(iphone.isMobile, true);
  assert.equal(iphone.recommendation, "nwc");
  // Der Hinweis muss zum NWC-Link fuehren — das ist der Weg, der mobil geht.
  assert.match(iphone.note, /NWC-Link/);

  const android = detectPaymentCapabilities("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari");
  assert.equal(android.isMobile, true);
  assert.equal(android.recommendation, "nwc");

  // Auch das Seeker-Phone ist Android — es darf nicht als Desktop gelten.
  const seeker = detectPaymentCapabilities("Mozilla/5.0 (Linux; Android 13; Saga) Mobile");
  assert.equal(seeker.isMobile, true);
});

test("Geraete-Erkennung: Desktop ohne Extension bekommt trotzdem einen Weg", () => {
  const desktop = detectPaymentCapabilities("Mozilla/5.0 (X11; Linux x86_64) Chrome/120");
  assert.equal(desktop.isMobile, false);
  // Kein WebLN im Test-Prozess -> NWC ist die Empfehlung. Wichtig: es gibt
  // IMMER eine Empfehlung, nie ein "geht nicht".
  assert.equal(desktop.recommendation, "nwc");
  assert.ok(desktop.note.length > 0);
});
