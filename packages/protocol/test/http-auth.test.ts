/**
 * Tests fuer NIP-98 HTTP-Auth.
 *
 * Damit authentifizieren sich Clients bei einem Storage-Provider ohne
 * Passwoerter — die Nostr-Identitaet IST der Zugang. Der Schwerpunkt liegt auf
 * dem, was ein Angreifer versucht: ein abgefangenes Auth-Event fuer einen
 * anderen Zweck wiederverwenden.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent } from "../src/event.js";
import { buildHttpAuth, verifyHttpAuth, checkHttpAuth, KIND_HTTP_AUTH } from "../src/http-auth.js";
import { sha256, toHex } from "../src/htlc.js";

const KP = generateKeypair();
const URL_A = "https://provider.example/chunk/abc";
const URL_B = "https://provider.example/chunk/xyz";

function kopf(url: string, method: "GET" | "POST" | "PUT" | "DELETE", body?: Uint8Array, at?: number): string {
  const ev = signEvent(buildHttpAuth({
    pubkey: KP.pk, url, method,
    payloadHash: body ? toHex(sha256(body)) : undefined,
  }, at) as never, KP.sk);
  return "Nostr " + Buffer.from(JSON.stringify(ev)).toString("base64");
}

test("Gueltiger Kopf wird angenommen", () => {
  const v = checkHttpAuth(kopf(URL_A, "GET"), URL_A, "GET");
  assert.equal(v.ok, true, v.reason ?? "abgelehnt");
  // Die geprueften Angaben stehen unter `auth` — der Aufrufer soll sehen,
  // WER sich ausgewiesen hat, nicht nur dass jemand es tat.
  assert.equal(v.auth!.pubkey, KP.pk);
  assert.equal(v.auth!.url, URL_A);
});

test("Ein Auth-Event fuer eine ANDERE URL gilt nicht", () => {
  // Der wichtigste Fall: Ein abgefangener Kopf darf nicht fuer einen anderen
  // Chunk wiederverwendbar sein.
  const v = checkHttpAuth(kopf(URL_A, "GET"), URL_B, "GET");
  assert.equal(v.ok, false);
});

test("Ein Auth-Event fuer eine andere Methode gilt nicht", () => {
  // Sonst wuerde aus einem Leserecht ein Schreibrecht.
  const v = checkHttpAuth(kopf(URL_A, "GET"), URL_A, "PUT");
  assert.equal(v.ok, false);
});

test("Manipuliertes Event faellt an der Signatur auf", () => {
  const roh = kopf(URL_A, "GET").slice("Nostr ".length);
  const ev = JSON.parse(Buffer.from(roh, "base64").toString());
  ev.tags = ev.tags.map((t: string[]) => (t[0] === "u" ? ["u", URL_B] : t));
  const v = checkHttpAuth(
    "Nostr " + Buffer.from(JSON.stringify(ev)).toString("base64"), URL_B, "GET");
  assert.equal(v.ok, false);
});

test("Falscher Kind wird abgelehnt", () => {
  const ev = signEvent({
    pubkey: KP.pk, kind: 1, created_at: Math.floor(Date.now() / 1000),
    tags: [["u", URL_A], ["method", "GET"]], content: "",
  } as never, KP.sk);
  const v = checkHttpAuth(
    "Nostr " + Buffer.from(JSON.stringify(ev)).toString("base64"), URL_A, "GET");
  assert.equal(v.ok, false);
  assert.equal(KIND_HTTP_AUTH, 27235);
});

test("Alte Koepfe gelten nicht ewig", () => {
  // Ein Auth-Event von gestern waere ein dauerhafter Nachschluessel.
  const alt = kopf(URL_A, "GET", undefined, Math.floor(Date.now() / 1000) - 7200);
  assert.equal(checkHttpAuth(alt, URL_A, "GET").ok, false);
});

test("Nutzlast-Pruefsumme muss stimmen", () => {
  // Ohne sie koennte jemand einen gueltigen Kopf abfangen und damit ANDERE
  // Daten hochladen.
  const daten = new TextEncoder().encode("die echten daten");
  const gefaelscht = new TextEncoder().encode("ganz andere daten");
  const k = kopf(URL_A, "PUT", daten);

  assert.equal(checkHttpAuth(k, URL_A, "PUT", daten).ok, true);
  assert.equal(checkHttpAuth(k, URL_A, "PUT", gefaelscht).ok, false);
});

test("Muell im Kopf stuerzt den Server nicht ab", () => {
  for (const k of ["", "Nostr", "Nostr !!!kein base64!!!", "Bearer token", "Nostr " + Buffer.from("{kaputt").toString("base64")]) {
    const v = checkHttpAuth(k, URL_A, "GET");
    assert.equal(v.ok, false, `"${k.slice(0, 20)}" wurde angenommen`);
    assert.ok(v.reason, "es muss einen Grund geben");
  }
});

test("Fehlendes Schema wird abgelehnt", () => {
  const roh = kopf(URL_A, "GET").slice("Nostr ".length);
  assert.equal(checkHttpAuth(roh, URL_A, "GET").ok, false);
});

test("Fehlender Kopf ergibt eine Ablehnung, keinen Absturz", () => {
  // In einem HTTP-Handler waere ein Wurf ein 500 — obwohl "keine
  // Zugangsdaten" ein 401 ist.
  const v = checkHttpAuth(undefined, URL_A, "GET");
  assert.equal(v.ok, false);
  assert.match(v.reason!, /kein Authorization/);
});

test("Die werfende Fassung bleibt fuer bestehende Aufrufer erhalten", () => {
  assert.doesNotThrow(() => verifyHttpAuth(kopf(URL_A, "GET"), URL_A, "GET"));
  assert.throws(() => verifyHttpAuth(kopf(URL_A, "GET"), URL_B, "GET"), /url mismatch/);
});
