/**
 * Tests fuer die LND-Anbindung.
 *
 * Dieses Modul bewegt echtes Geld und hatte bislang keinen einzigen Test. Der
 * Schwerpunkt liegt auf dem, was beim ersten echten Sat schiefgehen kann:
 * falsche Kodierung, verschluckte Fehler, und eine TLS-Ausnahme, die mehr
 * oeffnet als gedacht.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LndLightningAdapter, loadMacaroonHex, preimageAusLnd } from "../src/lnd-adapter.js";
import { toHex } from "../src/htlc.js";

const LOKAL = "https://127.0.0.1:8080";
const MAC = "0201036c6e64";

/** fetch-Ersatz, der Aufrufe mitschreibt und feste Antworten gibt. */
function fakeFetch(antworten: Record<string, unknown>, log: { url: string; body: unknown }[] = []) {
  return (async (url: string | URL, init?: RequestInit) => {
    const u = url.toString();
    log.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const treffer = Object.keys(antworten).find((k) => u.includes(k));
    if (!treffer) return new Response("nicht gefunden", { status: 404 });
    const a = antworten[treffer];
    if (a instanceof Response) return a;
    return new Response(JSON.stringify(a));
  }) as unknown as typeof fetch;
}

function mitFetch<T>(f: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const orig = globalThis.fetch;
  globalThis.fetch = f;
  return fn().finally(() => { globalThis.fetch = orig; });
}

// ------------------------------------------------------------- TLS

test("Unsicheres TLS oeffnet NICHT den ganzen Prozess", () => {
  // Frueher stand hier NODE_TLS_REJECT_UNAUTHORIZED = "0". Das schaltet die
  // Zertifikatspruefung fuer Solana-RPC, Relays und alles andere ab — und
  // zwar dauerhaft und unsichtbar.
  const vorher = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  new LndLightningAdapter({ restUrl: LOKAL, macaroonHex: MAC, allowInsecureTls: true });
  assert.equal(
    process.env.NODE_TLS_REJECT_UNAUTHORIZED, vorher,
    "die globale TLS-Einstellung darf sich nicht aendern",
  );
});

test("Unsicheres TLS nur fuer lokale Instanzen", () => {
  // Ein selbstsigniertes Zertifikat auf einer fremden Adresse ist nicht zu
  // unterscheiden von einem Angriff.
  assert.throws(
    () => new LndLightningAdapter({
      restUrl: "https://fremde-lnd.example:8080", macaroonHex: MAC, allowInsecureTls: true,
    }),
    /nur fuer lokale|nur für lokale/,
  );
  assert.doesNotThrow(() => new LndLightningAdapter({
    restUrl: "https://localhost:8080", macaroonHex: MAC, allowInsecureTls: true,
  }));
});

test("Ohne die Ausnahme wird jede Adresse akzeptiert", () => {
  assert.doesNotThrow(() => new LndLightningAdapter({
    restUrl: "https://lnd.example:8080", macaroonHex: MAC,
  }));
});

// ------------------------------------------------------------- Kodierung

test("Hold-Invoice: Payment-Hash geht als base64 raus", async () => {
  // LND erwartet base64. Hex zu schicken ergibt eine Invoice auf einen
  // voellig anderen Hash — und die Zahlung landet nirgends.
  const log: { url: string; body: unknown }[] = [];
  const hash = new Uint8Array(32).fill(7);
  const inv = await mitFetch(
    fakeFetch({ "/v2/invoices/hodl": { payment_request: "lnbc1test" } }, log),
    () => new LndLightningAdapter({ restUrl: LOKAL, macaroonHex: MAC })
      .createHoldInvoice(hash, 1000, 144),
  );

  const body = log[0].body as { hash: string; value: string; cltv_expiry: string };
  assert.equal(body.hash, Buffer.from(hash).toString("base64"));
  assert.equal(body.value, "1000", "Betrag als Zeichenkette, nicht als Zahl");
  assert.equal(body.cltv_expiry, "144");
  assert.equal(inv.bolt11, "lnbc1test");
});

test("Macaroon wandert in den richtigen Kopf", async () => {
  let kopf: string | null = null;
  const f = (async (url: string | URL, init?: RequestInit) => {
    kopf = (init?.headers as Record<string, string>)["Grpc-Metadata-macaroon"];
    void url;
    return new Response(JSON.stringify({ payment_request: "x" }));
  }) as unknown as typeof fetch;

  await mitFetch(f, () => new LndLightningAdapter({ restUrl: LOKAL, macaroonHex: MAC })
    .createHoldInvoice(new Uint8Array(32), 1, 1));
  assert.equal(kopf, MAC);
});

test("Lookup kodiert den Hash URL-sicher", async () => {
  // Base64 enthaelt + / = — ohne Kodierung antwortet LND mit HTTP 400.
  const log: { url: string; body: unknown }[] = [];
  const hash = new Uint8Array(32).fill(255); // erzeugt sicher Sonderzeichen
  await mitFetch(
    fakeFetch({ "/v2/invoices/lookup": { state: "OPEN" } }, log),
    () => new LndLightningAdapter({ restUrl: LOKAL, macaroonHex: MAC }).getInvoiceState(hash),
  );
  assert.ok(!log[0].url.includes("+"), "rohes + wuerde als Leerzeichen gelesen");
  assert.ok(log[0].url.includes("%2F") || !log[0].url.includes("/v2/invoices/lookup?payment_hash=/"));
});

test("Settle und Cancel schicken base64", async () => {
  const log: { url: string; body: unknown }[] = [];
  const a = new LndLightningAdapter({ restUrl: LOKAL, macaroonHex: MAC });
  const pre = new Uint8Array(32).fill(3);
  await mitFetch(fakeFetch({ "/v2/invoices/settle": {}, "/v2/invoices/cancel": {} }, log), async () => {
    await a.settleHoldInvoice(pre);
    await a.cancelHoldInvoice(pre);
  });
  assert.equal((log[0].body as { preimage: string }).preimage, Buffer.from(pre).toString("base64"));
  assert.equal((log[1].body as { payment_hash: string }).payment_hash, Buffer.from(pre).toString("base64"));
});

// ------------------------------------------------------------- Zustaende

test("Invoice-Zustaende werden durchgereicht", async () => {
  for (const zustand of ["OPEN", "ACCEPTED", "SETTLED", "CANCELED"]) {
    const r = await mitFetch(
      fakeFetch({ "/v2/invoices/lookup": { state: zustand } }),
      () => new LndLightningAdapter({ restUrl: LOKAL, macaroonHex: MAC })
        .getInvoiceState(new Uint8Array(32)),
    );
    assert.equal(r, zustand);
  }
});

test("Unbekannter Zustand gilt als OPEN, nicht als bezahlt", () => {
  // Die sichere Richtung: Eine Invoice faelschlich als bezahlt zu behandeln
  // waere ein Verlust, sie faelschlich als offen zu behandeln nur eine
  // Verzoegerung.
  return mitFetch(
    fakeFetch({ "/v2/invoices/lookup": { state: "WAS_AUCH_IMMER" } }),
    async () => {
      const r = await new LndLightningAdapter({ restUrl: LOKAL, macaroonHex: MAC })
        .getInvoiceState(new Uint8Array(32));
      assert.equal(r, "OPEN");
    },
  );
});

// ------------------------------------------------------------- Fehler

test("HTTP-Fehler werden mit Text gemeldet, nicht verschluckt", async () => {
  // "Zahlung fehlgeschlagen" ohne Grund kostet bei der Fehlersuche Stunden.
  await assert.rejects(
    () => mitFetch(
      fakeFetch({ "/v2/invoices/hodl": new Response("macaroon abgelaufen", { status: 401 }) }),
      () => new LndLightningAdapter({ restUrl: LOKAL, macaroonHex: MAC })
        .createHoldInvoice(new Uint8Array(32), 1, 1),
    ),
    /HTTP 401.*macaroon abgelaufen/,
  );
});

test("Zahlung: Preimage kommt als Hex zurueck, nicht als base64", async () => {
  // Der Fee-Beweis braucht Hex. Base64 durchzureichen ergaebe einen Beleg,
  // den niemand pruefen kann.
  const pre = new Uint8Array(32).fill(9);
  const zeilen = JSON.stringify({
    result: { status: "SUCCEEDED", payment_preimage: Buffer.from(pre).toString("base64") },
  }) + "\n";

  const f = (async () => new Response(zeilen)) as unknown as typeof fetch;
  const r = await mitFetch(f, () => new LndLightningAdapter({ restUrl: LOKAL, macaroonHex: MAC })
    .payInvoiceAndGetPreimage("lnbc1"));
  assert.equal(r, toHex(pre));
});

test("Gescheiterte Zahlung nennt den Grund", async () => {
  const zeilen = JSON.stringify({
    result: { status: "FAILED", failure_reason: "FAILURE_REASON_NO_ROUTE" },
  }) + "\n";
  const f = (async () => new Response(zeilen)) as unknown as typeof fetch;
  await assert.rejects(
    () => mitFetch(f, () => new LndLightningAdapter({ restUrl: LOKAL, macaroonHex: MAC })
      .payInvoiceAndGetPreimage("lnbc1")),
    /NO_ROUTE/,
  );
});

test("Abbruch ohne Ergebnis wird als solcher gemeldet", async () => {
  // Ein stiller Abbruch saehe fuer den Aufrufer aus wie Erfolg.
  const f = (async () => new Response("")) as unknown as typeof fetch;
  await assert.rejects(
    () => mitFetch(f, () => new LndLightningAdapter({ restUrl: LOKAL, macaroonHex: MAC })
      .payInvoiceAndGetPreimage("lnbc1")),
    /kein Ergebnis/,
  );
});

test("Fehler im Strom wird durchgereicht", async () => {
  const zeilen = JSON.stringify({ error: { message: "insufficient balance" } }) + "\n";
  const f = (async () => new Response(zeilen)) as unknown as typeof fetch;
  await assert.rejects(
    () => mitFetch(f, () => new LndLightningAdapter({ restUrl: LOKAL, macaroonHex: MAC })
      .payInvoiceAndGetPreimage("lnbc1")),
    /insufficient balance/,
  );
});

// ------------------------------------------------ Gegenrichtung (4.6b)

test("Zahlung der Gegenrichtung: cltv_limit geht mit, Preimage als Hex (lnrpc.Payment)", async () => {
  const pre = new Uint8Array(32).fill(7);
  const log: { url: string; body: unknown }[] = [];
  const zeilen = JSON.stringify({ result: { status: "SUCCEEDED", payment_preimage: toHex(pre) } }) + "\n";
  const r = await mitFetch(fakeFetch({ "/v2/router/send": new Response(zeilen) }, log),
    () => new LndLightningAdapter({ restUrl: LOKAL, macaroonHex: MAC }).payInvoice("lnbc1", 30));
  assert.deepEqual(r.preimage, pre);
  assert.deepEqual(log[0].body, { payment_request: "lnbc1", cltv_limit: 30, timeout_seconds: 120, no_inflight_updates: true });
});

test("Zahlung der Gegenrichtung ohne gueltiges cltv_limit geht gar nicht erst raus", async () => {
  const log: { url: string; body: unknown }[] = [];
  for (const cltv of [0, -1, 1.5, Number.NaN]) {
    await assert.rejects(
      () => mitFetch(fakeFetch({}, log), () => new LndLightningAdapter({ restUrl: LOKAL, macaroonHex: MAC }).payInvoice("lnbc1", cltv)),
      /cltv_limit/,
    );
  }
  assert.equal(log.length, 0, "ohne Grenze koennte die Zahlung laenger haengen als die Sperre haelt");
});

test("Zahlungsstand nach einem Neustart: erfolgreich (mit Preimage), gescheitert, laeuft, unbekannt", async () => {
  const pre = new Uint8Array(32).fill(5);
  const hash = new Uint8Array(32).fill(0xfb); // base64 mit + und / -> muss URL-sicher werden
  const lnd = new LndLightningAdapter({ restUrl: LOKAL, macaroonHex: MAC });
  const log: { url: string; body: unknown }[] = [];
  const stand = (result: unknown) => mitFetch(fakeFetch({ "/v2/router/track/": { result } }, log), () => lnd.zahlungsstand(hash));
  assert.deepEqual(await stand({ status: "SUCCEEDED", payment_preimage: toHex(pre) }), { status: "erfolgreich", preimage: pre });
  assert.match(log[0].url, /\/v2\/router\/track\/-_v7-/);
  assert.ok(!/[+/=]/.test(log[0].url.split("/track/")[1]));
  assert.deepEqual(await stand({ status: "FAILED", failure_reason: "FAILURE_REASON_TIMEOUT" }), { status: "gescheitert" });
  assert.deepEqual(await stand({ status: "IN_FLIGHT" }), { status: "laeuft" });
  assert.deepEqual(await stand({ status: "UNKNOWN" }), { status: "unbekannt" });
  assert.deepEqual(await mitFetch(fakeFetch({}), () => lnd.zahlungsstand(hash)), { status: "unbekannt" }, "404: nie angekommen");
  assert.deepEqual(await mitFetch(fakeFetch({ "/v2/router/track/": { error: { code: 2, message: "payment isn't initiated" } } }), () => lnd.zahlungsstand(hash)), { status: "unbekannt" });
  assert.deepEqual(await mitFetch(fakeFetch({ "/v2/router/track/": new Response('{"message":"payment isn\'t initiated"}', { status: 500 }) }), () => lnd.zahlungsstand(hash)), { status: "unbekannt" });
  await assert.rejects(
    () => mitFetch(fakeFetch({ "/v2/router/track/": { error: { message: "permission denied" } } }), () => lnd.zahlungsstand(hash)),
    /permission denied/,
  );
  await assert.rejects(
    () => mitFetch(fakeFetch({ "/v2/router/track/": new Response("macaroon abgelaufen", { status: 401 }) }), () => lnd.zahlungsstand(hash)),
    /HTTP 401/,
    "ein Fehler ist kein „unbekannt“",
  );
});

test("Zahlungsstand liest nur den ersten, vollstaendigen Eintrag des Stroms", async () => {
  const pre = new Uint8Array(32).fill(3);
  const erster = JSON.stringify({ result: { status: "SUCCEEDED", payment_preimage: toHex(pre) } });
  const strom = new ReadableStream({
    start(c) {
      const b = new TextEncoder().encode(erster + "\n" + JSON.stringify({ result: { status: "FAILED" } }) + "\n");
      for (let i = 0; i < b.length; i += 7) c.enqueue(b.slice(i, i + 7)); // in Stuecken, mitten in der Zeile getrennt
      c.close();
    },
  });
  const r = await mitFetch((async () => new Response(strom)) as unknown as typeof fetch,
    () => new LndLightningAdapter({ restUrl: LOKAL, macaroonHex: MAC }).zahlungsstand(new Uint8Array(32)));
  assert.deepEqual(r, { status: "erfolgreich", preimage: pre });
});

test("Preimage aus LND: Hex oder base64, aber immer genau 32 Byte", () => {
  const pre = new Uint8Array(32).fill(0xab);
  assert.deepEqual(preimageAusLnd(toHex(pre)), pre);
  assert.deepEqual(preimageAusLnd(toHex(pre).toUpperCase()), pre);
  assert.deepEqual(preimageAusLnd(Buffer.from(pre).toString("base64")), pre);
  for (const falsch of ["", "abcd", toHex(pre).slice(2), Buffer.from(new Uint8Array(31)).toString("base64")]) {
    assert.throws(() => preimageAusLnd(falsch), /falscher Laenge/, JSON.stringify(falsch));
  }
});

test("Vorab-Rechnung (4.6d): normale Rechnung, 10 Minuten gueltig, Hash aus LND", async () => {
  const hash = new Uint8Array(32).fill(4);
  const log: { url: string; body: unknown }[] = [];
  const r = await mitFetch(fakeFetch({ "/v1/invoices": { r_hash: Buffer.from(hash).toString("base64"), payment_request: "lnbc100n1vorab" } }, log),
    () => new LndLightningAdapter({ restUrl: LOKAL, macaroonHex: MAC }).createInvoice(10));
  assert.deepEqual(r, { bolt11: "lnbc100n1vorab", paymentHash: hash, amountSats: 10 });
  assert.deepEqual(log[0].body, { value: "10", memo: "FreedomStack: Vorab-Gebühr für einen Tausch", expiry: "600" });
  await assert.rejects(
    () => mitFetch(fakeFetch({ "/v1/invoices": { payment_request: "lnbc1" } }), () => new LndLightningAdapter({ restUrl: LOKAL, macaroonHex: MAC }).createInvoice(10)),
    /unvollständige Rechnung|keine vollständige/,
  );
  await assert.rejects(() => new LndLightningAdapter({ restUrl: LOKAL, macaroonHex: MAC }).createInvoice(0), /positive ganze Zahl/);
});

test("Macaroon-Datei wird als Hex gelesen", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "freedom-mac-"));
  try {
    const p = join(dir, "admin.macaroon");
    await writeFile(p, Buffer.from([0x02, 0x01, 0x03]));
    assert.equal(await loadMacaroonHex(p), "020103");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
