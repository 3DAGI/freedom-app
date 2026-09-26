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
  assert.ok(new Set(hosts).size >= 4, `nur ${new Set(hosts).size} verschiedene Anbieter`); // 5.8: mindestens vier
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

test("ohne fetchImpl: das globale fetch wird ohne fremdes this aufgerufen (wie im Browser)", async () => {
  // Browser werfen „Illegal invocation“, wenn fetch als Methode eines anderen
  // Objekts laeuft. Node nicht – deshalb blieb der Fehler bis 4.2b unbemerkt:
  // In der App scheiterte jeder Pool-Aufruf, auch die Guthaben-Anzeige.
  const echt = globalThis.fetch;
  globalThis.fetch = function (this: unknown) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
    return Promise.resolve(new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { value: 7 } })));
  } as typeof fetch;
  try {
    const pool = new RpcPool([{ url: "https://a.example" }]);
    assert.equal(await pool.getBalance("x"), 7);
  } finally {
    globalThis.fetch = echt;
  }
});

test("Verteilen (4.9): fremde Anbieter abwechselnd statt immer derselbe – eigener Endpunkt bleibt vorn", async () => {
  const alleOk = { [E(1)]: "ok", [E(2)]: "ok", [E(3)]: "ok", [E(9)]: "ok" } as const;
  const log: string[] = [];
  const zahlen = [0.9, 0.1, 0.5, 0.2, 0.8, 0.4];
  let i = 0;
  const pool = new RpcPool(endpoints, { fetchImpl: fakeFetch(alleOk, log), verteilen: true, zufall: () => zahlen[i++ % zahlen.length] });
  for (let n = 0; n < 2; n++) await pool.getBalance("x");
  assert.deepEqual(log, [E(2), E(1)], "mit dem Zufall wechselt der erste Anbieter");

  const log2: string[] = [];
  const eigener = new RpcPool(endpoints, { fetchImpl: fakeFetch(alleOk, log2), userEndpoints: [E(9)], verteilen: true, zufall: Math.random });
  for (let n = 0; n < 5; n++) await eigener.getBalance("x");
  assert.deepEqual(log2, Array(5).fill(E(9)), "eigener Knoten immer zuerst – er ist keine fremde Partei");

  // Ohne Verteilen: Reihenfolge wie bisher nach Ausfaellen und Latenz – der Zufall wird nie gefragt.
  let gefragt = 0;
  const alt = new RpcPool(endpoints, { fetchImpl: fakeFetch(alleOk), zufall: () => { gefragt++; return 0.5; } });
  for (let n = 0; n < 3; n++) await alt.getBalance("x");
  assert.equal(gefragt, 0);
});

// ------------------------------------------------------------- Stichprobe (5.8)

const G_MAIN = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const G_DEV = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const H1 = "9zZkXyQm3vH7cP2rT8wLbN4sJfGdKa6uEo1xYiRqWn5B";
const H2 = "4hQx8TzLk2WpRn7VbYc3MfJs9GdUe6NaHo5KiXwEt1Zr";
const H_FALSCH = "7Fk2Lm9QwXv4RtYp8NbZc3HsJd6GeUa5Ko1WiTxEq2Mn";
const KONTO = "Kunde1111111111111111111111111111111111111";

interface Knoten {
  genesis?: string; hash?: string; slot?: number; kennt?: string[];
  /** Kontostaende nacheinander (der letzte bleibt). */
  konto?: number[];
  tot?: boolean; hinkt?: boolean; muell?: boolean;
}

/** Ein kleines Netz aus RPC-Knoten: ehrlich, solange nichts anderes gesagt ist. */
function rpcNetz(knoten: Record<string, Knoten>, log: string[] = []) {
  return (async (url: string | URL, init?: RequestInit) => {
    const u = url.toString();
    const { method, params } = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
    const opt = params.at(-1) as { minContextSlot?: number } | undefined;
    log.push(`${u} ${method}${opt?.minContextSlot !== undefined ? ` ab ${opt.minContextSlot}` : ""}`);
    const k = { genesis: G_MAIN, hash: H1, slot: 100, kennt: [H1, H2], konto: [5], ...knoten[u] };
    if (!(u in knoten) || k.tot) throw new Error("ECONNREFUSED");
    const antwort = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
    if (k.hinkt && opt?.minContextSlot !== undefined && opt.minContextSlot > k.slot) {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32016, message: "Minimum context slot has not been reached" } }));
    }
    switch (method) {
      case "getGenesisHash": return antwort(k.genesis);
      case "getLatestBlockhash": return antwort(k.muell ? { value: {} } : { context: { slot: k.slot }, value: { blockhash: k.hash, lastValidBlockHeight: 1 } });
      case "isBlockhashValid": return antwort({ context: { slot: k.slot }, value: k.kennt.includes(params[0] as string) });
      case "getBalance": {
        const wert = k.konto.length > 1 ? k.konto.shift()! : k.konto[0];
        knoten[u]!.slot = k.slot + 1;
        return antwort({ context: { slot: k.slot }, value: wert });
      }
      default: return antwort(null);
    }
  }) as unknown as typeof fetch;
}

test("Stichprobe (5.8): zwei ehrliche Anbieter stimmen ueberein – ein dritter wird nicht gefragt", async () => {
  const log: string[] = [];
  const pool = new RpcPool(endpoints, { fetchImpl: rpcNetz({ [E(1)]: {}, [E(2)]: { hash: H2 }, [E(3)]: {} }, log) });
  const r = await pool.stichprobe({ konto: KONTO });
  assert.deepEqual(r, { anbieter: ["rpc1", "rpc2"], verglichen: ["netz", "blockhash", "kontostand"], warnungen: [], hinweise: [] });
  assert.ok(!log.some((z) => z.startsWith(E(3))), "nur zwei Anbieter");
  assert.ok(log.includes(`${E(2)} isBlockhashValid ab 100`) && log.includes(`${E(1)} isBlockhashValid ab 100`), "Blockhash in beide Richtungen, ab dem Stand des Fragenden");
});

test("Stichprobe: ein falscher Blockhash faellt auf – egal, welcher der beiden luegt", async () => {
  const pool = new RpcPool(endpoints, { fetchImpl: rpcNetz({ [E(1)]: { hash: H_FALSCH }, [E(2)]: {} }) });
  const r = await pool.stichprobe();
  assert.deepEqual(r.warnungen, ["rpc2 kennt den letzten Blockhash von rpc1 nicht – einer der beiden liefert eine falsche Kette."]);
  assert.deepEqual(r.verglichen, ["netz", "blockhash"], "ohne Konto kein Kontostand");

  const zweiter = new RpcPool(endpoints, { fetchImpl: rpcNetz({ [E(1)]: {}, [E(2)]: { kennt: [] } }) });
  assert.match((await zweiter.stichprobe()).warnungen.join(), /rpc2 kennt den letzten Blockhash von rpc1 nicht/);
});

test("Stichprobe: ein falscher Kontostand faellt auf, eine Aenderung zwischen den Abfragen nicht", async () => {
  const falsch = new RpcPool(endpoints, { fetchImpl: rpcNetz({ [E(1)]: { konto: [5_000] }, [E(2)]: { konto: [7_000] } }) });
  const r = await falsch.stichprobe({ konto: KONTO });
  assert.deepEqual(r.warnungen, ["Kontostand weicht ab: rpc1 meldet 5000 Lamports, rpc2 7000."]);

  const log: string[] = [];
  const geaendert = new RpcPool(endpoints, { fetchImpl: rpcNetz({ [E(1)]: { konto: [5_000, 7_000] }, [E(2)]: { konto: [7_000], slot: 120 } }, log) });
  const r2 = await geaendert.stichprobe({ konto: KONTO });
  assert.deepEqual(r2.warnungen, []);
  assert.ok(log.includes(`${E(1)} getBalance ab 120`), "Wiederholung ab dem hoeheren Stand");
});

test("Stichprobe: eigener Knoten in einem anderen Netz – Warnung statt falscher Entwarnung", async () => {
  const pool = new RpcPool(endpoints, {
    userEndpoints: [E(9)], verteilen: true,
    fetchImpl: rpcNetz({ [E(9)]: { genesis: G_DEV }, [E(1)]: {}, [E(2)]: {}, [E(3)]: {} }),
  });
  const r = await pool.stichprobe({ konto: KONTO });
  assert.equal(r.anbieter[0], "eigener Knoten", "eigener Endpunkt zuerst");
  assert.deepEqual(r.verglichen, ["netz"]);
  assert.equal(r.warnungen.length, 1);
  assert.match(r.warnungen[0]!, /^eigener Knoten \(Devnet\) und rpc\d \(Mainnet\) hängen an verschiedenen Ketten/);
});

test("Stichprobe: was sich nicht vergleichen laesst, ist ein Hinweis – kein Befund und kein Absturz", async () => {
  // Tote Endpunkte werden uebersprungen.
  const tot = await new RpcPool(endpoints, { fetchImpl: rpcNetz({ [E(1)]: { tot: true }, [E(2)]: {}, [E(3)]: {} }) }).stichprobe();
  assert.deepEqual([tot.anbieter, tot.warnungen, tot.hinweise], [["rpc2", "rpc3"], [], ["rpc1: ECONNREFUSED"]]);

  // Nur ein Betreiber (zwei Adressen derselben Partei) → keine Stichprobe.
  const einer = await new RpcPool([{ url: "https://api.mainnet-beta.solana.com", label: "A" }, { url: "https://rpc.solana.com", label: "B" }], {
    fetchImpl: rpcNetz({ "https://api.mainnet-beta.solana.com": {}, "https://rpc.solana.com": {} }),
  }).stichprobe();
  assert.deepEqual([einer.anbieter, einer.verglichen, einer.warnungen], [["A"], [], []]);
  assert.match(einer.hinweise.join(), /Kein zweiter Anbieter erreichbar/);

  // Einer hinkt hinterher → diese Richtung bleibt offen, die andere zaehlt.
  const hinkt = await new RpcPool(endpoints, { fetchImpl: rpcNetz({ [E(1)]: {}, [E(2)]: { slot: 90, hash: H2, hinkt: true } }) }).stichprobe();
  assert.deepEqual([hinkt.verglichen, hinkt.warnungen, hinkt.hinweise], [["netz", "blockhash"], [], ["Blockhash rpc1 → rpc2: hinkt hinterher"]]);

  // Unbrauchbare Antworten und Adressen.
  const muell = await new RpcPool(endpoints, { fetchImpl: rpcNetz({ [E(1)]: { muell: true }, [E(2)]: { genesis: "<b>kaputt</b>" }, [E(3)]: {} }) })
    .stichprobe({ konto: "keine-adresse" });
  assert.deepEqual(muell.anbieter, ["rpc1", "rpc3"]);
  assert.deepEqual(muell.warnungen, []);
  assert.deepEqual(muell.hinweise, ["rpc2: unerwartete Antwort", "Blockhash rpc1 → rpc3: unerwartete Antwort", "Kontostand: keine gültige Solana-Adresse."]);
});

test("Stichprobe veraendert die Ausfallhistorie des Pools nicht", async () => {
  const pool = new RpcPool(endpoints, { fetchImpl: rpcNetz({ [E(1)]: { tot: true }, [E(2)]: {}, [E(3)]: {} }) });
  await pool.stichprobe();
  assert.ok(pool.status().every((s) => s.available && s.failures === 0));
});
