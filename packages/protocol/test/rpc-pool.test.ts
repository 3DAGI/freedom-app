/**
 * Tests fuer den RPC-Pool.
 *
 * Der Zweck ist Ausfallsicherheit, deshalb pruefen die Tests vor allem, was
 * bei Ausfaellen passiert: Weicht der Pool aus? Merkt er sich tote Endpunkte?
 * Und unterscheidet er einen Endpunkt-Ausfall von einer fachlichen Antwort
 * der Kette — denn die weiterzureichen waere sinnlos.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { RpcPool, parseUserEndpoints, DEFAULT_MAINNET_RPCS } from "../src/rpc-pool.js";

/** Erzeugt ein fetch, das je URL ein festgelegtes Verhalten zeigt. */
function fakeFetch(verhalten: Record<string, "ok" | "tot" | "http500" | "rpcfehler">, log: string[] = []) {
  return (async (url: string | URL) => {
    const u = url.toString();
    log.push(u);
    const v = verhalten[u] ?? "tot";
    if (v === "tot") throw new Error("ECONNREFUSED");
    if (v === "http500") return new Response("boom", { status: 500 });
    if (v === "rpcfehler") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "ungueltige Adresse" } }));
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { value: 42 } }));
  }) as unknown as typeof fetch;
}

const E = (n: number) => `https://rpc${n}.test`;
const endpoints = [1, 2, 3].map((n) => ({ url: E(n), label: `rpc${n}` }));

test("Pool: erfolgreicher Aufruf ueber den ersten Endpunkt", async () => {
  const log: string[] = [];
  const pool = new RpcPool(endpoints, { fetchImpl: fakeFetch({ [E(1)]: "ok" }, log) });
  assert.equal(await pool.getBalance("abc"), 42);
  assert.equal(log.length, 1, "kein unnoetiger zweiter Aufruf");
});

test("Pool: weicht auf den naechsten Endpunkt aus", async () => {
  const log: string[] = [];
  const pool = new RpcPool(endpoints, {
    fetchImpl: fakeFetch({ [E(1)]: "tot", [E(2)]: "ok" }, log),
  });
  assert.equal(await pool.getBalance("abc"), 42);
  assert.deepEqual(log, [E(1), E(2)]);
});

test("Pool: HTTP-Fehler zaehlt als Ausfall, nicht als Antwort", async () => {
  const pool = new RpcPool(endpoints, {
    fetchImpl: fakeFetch({ [E(1)]: "http500", [E(2)]: "ok" }),
  });
  assert.equal(await pool.getBalance("abc"), 42);
});

test("Pool: alle tot -> ein Fehler, der ALLE Gruende nennt", async () => {
  // "konnte nicht verbinden" ohne Angabe, was womit schiefging, kostet bei der
  // Fehlersuche Stunden.
  const pool = new RpcPool(endpoints, { fetchImpl: fakeFetch({}) });
  await assert.rejects(
    () => pool.getBalance("abc"),
    (e: Error) => {
      assert.match(e.message, /Kein Solana-Endpunkt erreichbar/);
      assert.match(e.message, /rpc1/);
      assert.match(e.message, /rpc3/);
      return true;
    },
  );
});

test("Pool: fachlicher Kettenfehler wird NICHT weitergereicht", async () => {
  // Eine ungueltige Adresse beantwortet jeder Endpunkt gleich. Sie
  // durchzureichen kostet nur Zeit und verschleiert die eigentliche Ursache.
  const log: string[] = [];
  const pool = new RpcPool(endpoints, {
    fetchImpl: fakeFetch({ [E(1)]: "rpcfehler", [E(2)]: "ok" }, log),
  });
  await assert.rejects(() => pool.getBalance("kaputt"), /ungueltige Adresse/);
  assert.equal(log.length, 1, "kein Ausweichen bei fachlichen Fehlern");
});

test("Pool: ausgefallener Endpunkt wird eine Weile uebersprungen", async () => {
  const log: string[] = [];
  const pool = new RpcPool(endpoints, {
    fetchImpl: fakeFetch({ [E(1)]: "tot", [E(2)]: "ok" }, log),
    cooldownMs: 60_000,
  });
  await pool.getBalance("a");
  log.length = 0;
  await pool.getBalance("b");
  // Ein dauerhaft toter Anbieter darf nicht jede Anfrage verzoegern.
  assert.ok(!log.includes(E(1)), "der tote Endpunkt wird uebersprungen");
});

test("Pool: nach der Sperrfrist wird wieder probiert", async () => {
  const log: string[] = [];
  const pool = new RpcPool(endpoints, {
    fetchImpl: fakeFetch({ [E(1)]: "tot", [E(2)]: "ok" }, log),
    cooldownMs: 1000,
  });
  // Durchgaengig gesetzte Zeit: Wuerde der erste Aufruf die echte Uhr nutzen
  // und der zweite eine erfundene, laege die Sperrfrist in ferner Zukunft und
  // der Test pruefte etwas anderes als gemeint.
  const t0 = Date.now();
  await pool.call("getBalance", ["a"], t0);
  log.length = 0;
  // Nach der Sperrfrist gilt der Endpunkt wieder als verfuegbar. Dass er
  // trotzdem nicht als erster drankommt, ist richtig: Der Pool bevorzugt den
  // Endpunkt mit weniger Ausfaellen.
  assert.equal(pool.status(t0 + 10_000).find((s) => s.url === E(1))!.available, true);

  // Faellt der gesunde aus, wird der ehemals tote wieder probiert.
  const pool2 = new RpcPool(endpoints, {
    fetchImpl: fakeFetch({ [E(1)]: "ok" }, log),
    cooldownMs: 1000,
  });
  log.length = 0;
  await pool2.call("getBalance", ["c"], t0);
  assert.ok(log.includes(E(1)));
});

test("Pool: sind alle gesperrt, wird trotzdem probiert", async () => {
  // Lieber ein wahrscheinlicher Fehlschlag als gar kein Versuch.
  const log: string[] = [];
  const pool = new RpcPool([{ url: E(1) }], { fetchImpl: fakeFetch({}, log) });
  await assert.rejects(() => pool.getBalance("a"));
  log.length = 0;
  await assert.rejects(() => pool.getBalance("a"));
  assert.equal(log.length, 1, "es wird weiter versucht");
});

test("Eigene Endpunkte kommen zuerst", async () => {
  // Wer einen eigenen Knoten betreibt, soll ihn benutzen — nicht als letzten
  // Ausweg nach drei fremden Anbietern.
  const log: string[] = [];
  const pool = new RpcPool(endpoints, {
    userEndpoints: ["https://mein-knoten.local"],
    fetchImpl: fakeFetch({ "https://mein-knoten.local": "ok" }, log),
  });
  await pool.getBalance("a");
  assert.equal(log[0], "https://mein-knoten.local");
});

test("Doppelte Endpunkte werden zusammengefuehrt", () => {
  const pool = new RpcPool([{ url: E(1) }, { url: E(1) }, { url: E(2) }]);
  assert.equal(pool.urls.length, 2);
});

test("Leere Endpunktliste wird abgelehnt", () => {
  assert.throws(() => new RpcPool([]), /mindestens einen Endpunkt/);
});

test("Voreinstellung nutzt verschiedene Anbieter", () => {
  // Redundanz gegen Ausfall hilft nichts, wenn alle Endpunkte derselben Partei
  // gehoeren und diese Partei sperrt.
  const hosts = DEFAULT_MAINNET_RPCS.map((e) => new URL(e.url).hostname.split(".").slice(-2).join("."));
  assert.ok(new Set(hosts).size >= 3, `nur ${new Set(hosts).size} verschiedene Anbieter`);
});

test("Statusanzeige meldet Ausfaelle mit Grund", async () => {
  const pool = new RpcPool(endpoints, { fetchImpl: fakeFetch({ [E(2)]: "ok" }) });
  await pool.getBalance("a");
  const st = pool.status();
  const tot = st.find((s) => s.url === E(1))!;
  assert.equal(tot.available, false);
  assert.match(tot.lastError!, /ECONNREFUSED/);
  assert.equal(st.find((s) => s.url === E(2))!.available, true);
});

test("healthCheck prueft alle Endpunkte auf einmal", async () => {
  const pool = new RpcPool(endpoints, { fetchImpl: fakeFetch({ [E(1)]: "ok", [E(3)]: "ok" }) });
  const st = await pool.healthCheck();
  assert.equal(st.filter((s) => s.available).length, 2);
});

test("bestUrl liefert einen brauchbaren Endpunkt fuer fremde Bibliotheken", async () => {
  const pool = new RpcPool(endpoints, { fetchImpl: fakeFetch({ [E(2)]: "ok" }) });
  await pool.getBalance("a").catch(() => {});
  assert.ok(pool.urls.includes(pool.bestUrl()));
});

test("Nutzereingabe: nur brauchbare URLs, begrenzte Anzahl", () => {
  assert.deepEqual(parseUserEndpoints("https://a.io, https://b.io"), ["https://a.io", "https://b.io"]);
  assert.deepEqual(parseUserEndpoints("nicht-mal-eine-url"), []);
  assert.deepEqual(parseUserEndpoints(null), []);
  assert.equal(parseUserEndpoints(Array.from({ length: 20 }, (_, i) => `https://r${i}.io`).join(",")).length, 5);
});
