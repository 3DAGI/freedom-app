/**
 * Schritt 11.2b: NIP-05 für den Werbelink. Nur öffentliche Namen über https,
 * genau eine Adresse, keine Weiterleitung, Antwort begrenzt, Schlüssel nur
 * als 64 Zeichen Hex – nie geworfen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { NIP05_MAX_BYTES, leseNip05, loeseNip05, nip05Adresse, nip05Text, oeffentlicheDomain } from "../src/nip05.js";

const PK = "ab".repeat(32);

test("Name lesen: name@domain, klein geschrieben; nichts Lokales, keine IP, kein zweites @", () => {
  assert.deepEqual(leseNip05(" Alice@Kopie.Example "), { name: "alice", domain: "kopie.example" });
  assert.deepEqual(leseNip05("_@kopie.example"), { name: "_", domain: "kopie.example" });
  assert.deepEqual(leseNip05("a.b-c_d@sub.kopie.example"), { name: "a.b-c_d", domain: "sub.kopie.example" });
  for (const falsch of ["", "alice", "@kopie.example", "alice@", "a@b@kopie.example", "al ice@kopie.example", "älice@kopie.example",
    "alice@localhost", "alice@drucker.local", "alice@app.localhost", "alice@intranet", "alice@127.0.0.1", "alice@[::1]",
    "alice@kopie.example:8443", "alice@-kopie.example", "alice@kopie..example", `${"a".repeat(65)}@kopie.example`]) {
    assert.equal(leseNip05(falsch), undefined, falsch);
  }
  assert.equal(oeffentlicheDomain("10.0.0.1"), false);
  assert.equal(oeffentlicheDomain("kopie.test"), true);
  assert.equal(nip05Text({ name: "alice", domain: "kopie.example" }), "alice@kopie.example");
  assert.equal(nip05Adresse({ name: "a.b", domain: "kopie.example" }), "https://kopie.example/.well-known/nostr.json?name=a.b");
});

/** Server-Attrappe: merkt Adresse und Optionen, antwortet mit `antwort`. */
function server(antwort: () => Response | Promise<Response>) {
  const gefragt: { url: string; init: RequestInit }[] = [];
  return { gefragt, holen: async (url: string, init: RequestInit) => { gefragt.push({ url, init }); return antwort(); } };
}

test("Auflösen: genau eine Adresse, ohne Weiterleitung, Cookies und Herkunft; nur der Schlüssel unter genau diesem Namen", async () => {
  const s = server(() => Response.json({ names: { alice: PK, bob: "cd".repeat(32) }, relays: {} }));
  assert.deepEqual(await loeseNip05({ name: "alice", domain: "kopie.example" }, s.holen), { ok: true, pubkey: PK });
  assert.equal(s.gefragt.length, 1);
  assert.equal(s.gefragt[0].url, "https://kopie.example/.well-known/nostr.json?name=alice");
  assert.equal(s.gefragt[0].init.redirect, "error", "NIP-05: Weiterleitungen nicht folgen");
  assert.equal(s.gefragt[0].init.credentials, "omit");
  assert.equal(s.gefragt[0].init.referrerPolicy, "no-referrer");
  assert.deepEqual(await loeseNip05({ name: "carol", domain: "kopie.example" }, s.holen), { ok: false, fall: "unbekannt" });
});

test("Auflösen: kaputte, fremde und zu große Antworten sind Fälle, nie Ausnahmen", async () => {
  const k = { name: "alice", domain: "kopie.example" };
  const fall = async (antwort: () => Response | Promise<Response>) => {
    const r = await loeseNip05(k, server(antwort).holen);
    return r.ok ? "ok" : r.fall;
  };
  assert.equal(await fall(() => { throw new TypeError("Failed to fetch"); }), "nicht-erreichbar");
  assert.equal(await fall(() => new Response("weg", { status: 404 })), "nicht-erreichbar");
  const umgeleitet = Response.json({ names: { alice: PK } });
  Object.defineProperty(umgeleitet, "redirected", { value: true });
  assert.equal(await fall(() => umgeleitet), "nicht-erreichbar", "eine Weiterleitung zählt nicht, auch wenn der Abruf ihr folgte");
  assert.equal(await fall(() => new Response("kein json")), "ungueltig");
  assert.equal(await fall(() => Response.json({ names: [PK] })), "ungueltig");
  assert.equal(await fall(() => Response.json({ names: { alice: PK.toUpperCase() } })), "ungueltig");
  assert.equal(await fall(() => Response.json({ names: { alice: "npub1xyz" } })), "ungueltig");
  assert.equal(await fall(() => Response.json({ names: { alice: PK.slice(0, 63) } })), "ungueltig");
  assert.equal(await fall(() => Response.json({})), "ungueltig");
  // Geerbte Eigenschaften zählen nicht als Name
  assert.equal((await loeseNip05({ name: "constructor", domain: "kopie.example" }, server(() => Response.json({ names: {} })).holen)).ok, false);
  const gross = new Response("x", { headers: { "content-length": String(NIP05_MAX_BYTES + 1) } });
  assert.equal(await fall(() => gross), "zu-gross");
  assert.equal(gross.bodyUsed, false, "zu groß angekündigt: gar nicht erst gelesen");
  // Ohne Längenangabe: beim Lesen abgebrochen, sobald es zu viel wird
  const strom = new ReadableStream<Uint8Array>({
    pull(c) { c.enqueue(new Uint8Array(64 * 1024).fill(0x20)); },
  });
  assert.equal(await fall(() => new Response(strom)), "zu-gross");
});
