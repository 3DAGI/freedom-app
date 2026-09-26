/**
 * Schritt 1.3f: Anmelden per Bunker (NIP-46) – verbinden, Sitzung sichern,
 * beim Start ohne Netz wieder aufnehmen, abmelden. Dazu ein ehrlicher
 * Test-Bunker ueber ein Relay im Speicher.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  KIND_NIP46, LocalSigner, MemoryRelay, buildEvent, generateKeypair, getTag, verifyEvent,
  type NostrEvent, type Nip46Transport, type RelayFilter,
} from "@freedomstack/protocol";

// tresor.ts liest localStorage beim Laden – vor dem Import bereitstellen.
const ls = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => ls.get(k) ?? null,
  setItem: (k: string, v: string) => { ls.set(k, String(v)); },
  removeItem: (k: string) => { ls.delete(k); },
  key: (i: number) => [...ls.keys()][i] ?? null,
  get length() { return ls.size; },
};
const { meldeBunkerAb, meldeMitBunkerAn, nimmBunkerAuf } = await import("../src/shell/bunker.js");
const { LS_BUNKER, mitBunker, mitRohemSchluessel, signiere, state } = await import("../src/shell/state.js");

function testBunker(secret?: string) {
  const bunker = new LocalSigner(generateKeypair().sk);
  const nutzerKp = generateKeypair();
  const nutzer = new LocalSigner(nutzerKp.sk);
  const relay = new MemoryRelay("wss://bunker.test");
  const anfragen: string[] = [];
  const transport: Nip46Transport = {
    async publish(ev: NostrEvent) {
      await relay.publish(ev);
      if (ev.kind !== KIND_NIP46 || getTag(ev, "p") !== bunker.publicKey()) return;
      const a = JSON.parse(await bunker.nip44Decrypt(ev.pubkey, ev.content));
      anfragen.push(a.method);
      let result = "";
      let error: string | undefined;
      if (a.method === "connect") {
        if (secret && a.params[1] !== secret) error = "invalid secret"; else result = "ack";
      } else if (a.method === "get_public_key") result = nutzer.publicKey();
      else if (a.method === "sign_event") {
        const e = JSON.parse(a.params[0]);
        result = JSON.stringify(await nutzer.signEvent(buildEvent(nutzer.publicKey(), e.kind, e.tags, e.content, e.created_at)));
      }
      const antwort = await bunker.signEvent(buildEvent(bunker.publicKey(), KIND_NIP46, [["p", ev.pubkey]],
        await bunker.nip44Encrypt(ev.pubkey, JSON.stringify({ id: a.id, result, error })), ev.created_at));
      await relay.publish(antwort);
    },
    query: (f: RelayFilter) => relay.query(f),
  };
  const uri = `bunker://${bunker.publicKey()}?relay=wss://bunker.test` + (secret ? `&secret=${secret}` : "");
  return { uri, nutzerPk: nutzer.publicKey(), nutzerSkHex: Buffer.from(nutzerKp.sk).toString("hex"), transport, anfragen };
}

function zuruecksetzen(): void {
  ls.clear();
  state.signer = null;
  state.keypair = null;
}

test("Bunker: verbinden sichert die Sitzung – ohne Secret, ohne Nutzer-Schluessel", async () => {
  zuruecksetzen();
  const b = testBunker("einmalig42");
  const pk = await meldeMitBunkerAn(b.uri, () => b.transport);
  assert.equal(pk, b.nutzerPk);
  const roh = ls.get(LS_BUNKER)!;
  const s = JSON.parse(roh);
  assert.deepEqual(Object.keys(s).sort(), ["clientSk", "nutzer", "relays", "signerPubkey"]);
  assert.equal(s.nutzer, b.nutzerPk);
  assert.deepEqual(s.relays, ["wss://bunker.test"]);
  assert.match(s.clientSk, /^[0-9a-f]{64}$/);
  assert.ok(!roh.includes("einmalig42"), "Secret gespeichert");
  assert.ok(!roh.includes(b.nutzerSkHex), "Nutzer-Schluessel gespeichert");
  // Verbinden allein wechselt die Identitaet nicht – das macht erst der Neustart.
  assert.equal(state.signer, null);
});

test("Bunker: beim Start ohne Netz aufgenommen – signieren ueber den Bunker, kein roher Schluessel", async () => {
  zuruecksetzen();
  const b = testBunker();
  await meldeMitBunkerAn(b.uri, () => b.transport);
  assert.equal(nimmBunkerAuf(() => b.transport), true);
  assert.equal(mitBunker(), true);
  assert.ok(!(state.signer instanceof LocalSigner));
  assert.deepEqual(state.keypair, { pk: b.nutzerPk });

  const ev = await signiere(buildEvent(b.nutzerPk, 1, [], "über den Bunker", 1_790_000_000));
  assert.equal(verifyEvent(ev), true);
  assert.equal(ev.pubkey, b.nutzerPk);
  assert.deepEqual(b.anfragen, ["connect", "get_public_key", "sign_event"], "kein zweites connect");
  assert.throws(() => mitRohemSchluessel("Der Export", (sk) => sk), /nicht über einen Bunker/);
});

test("Bunker: falsches Secret – nichts gespeichert, keine Anmeldung", async () => {
  zuruecksetzen();
  const b = testBunker("richtig");
  await assert.rejects(meldeMitBunkerAn(b.uri.replace("richtig", "falsch"), () => b.transport), /Signer lehnt ab: invalid secret/);
  assert.equal(ls.has(LS_BUNKER), false);
  assert.equal(nimmBunkerAuf(() => b.transport), false);
  await assert.rejects(meldeMitBunkerAn("nostrconnect://abc", () => b.transport), /bunker:\/\//);
});

test("Bunker: kaputte oder fremde Sitzung wird nicht aufgenommen", async () => {
  const b = testBunker();
  const gut = { signerPubkey: "a".repeat(64), relays: ["wss://bunker.test"], clientSk: "b".repeat(64), nutzer: "c".repeat(64) };
  const kaputt = [
    "{kein json",
    JSON.stringify({ ...gut, clientSk: "zz" + "b".repeat(62) }),
    JSON.stringify({ ...gut, nutzer: "C".repeat(64) }),
    JSON.stringify({ ...gut, relays: ["https://bunker.test"] }),
    JSON.stringify({ ...gut, relays: [] }),
    JSON.stringify({ ...gut, signerPubkey: undefined }),
  ];
  for (const k of kaputt) {
    zuruecksetzen();
    ls.set(LS_BUNKER, k);
    assert.equal(nimmBunkerAuf(() => b.transport), false, k);
    assert.equal(state.signer, null);
  }
  zuruecksetzen();
  ls.set(LS_BUNKER, JSON.stringify(gut));
  assert.equal(nimmBunkerAuf(() => b.transport), true);
});

test("Bunker: abmelden loescht die Sitzung", async () => {
  zuruecksetzen();
  const b = testBunker();
  await meldeMitBunkerAn(b.uri, () => b.transport);
  await meldeBunkerAb();
  assert.equal(ls.has(LS_BUNKER), false);
  assert.equal(nimmBunkerAuf(() => b.transport), false);
});

test("Verdrahtung: Bunker vor dem lokalen Schluessel, Sitzung im Tresor, Knoepfe beim Start", () => {
  const app = readFileSync(new URL("../src/shell/app.ts", import.meta.url), "utf8");
  const laden = app.slice(app.indexOf("function loadOrCreateIdentity("));
  assert.ok(laden.indexOf("nimmBunkerAuf()") > -1 && laden.indexOf("nimmBunkerAuf()") < laden.indexOf("ladeSchluessel()"));
  const starte = app.slice(app.indexOf("function starte("));
  assert.match(starte, /wireBunkerKarte\(beschaeftigt\)/);
  assert.match(starte, /wireSicherheitsKnoepfe\(\)/);

  const tresor = readFileSync(new URL("../src/shell/tresor.ts", import.meta.url), "utf8");
  assert.match(tresor, /const GEHEIM_FEST = \[LS_KEY, LS_BUNKER,/);

  // Frueher standen die Knoepfe am Ende von richteNachfolgeEin() – ohne Nachfolge waren sie tot.
  const settings = readFileSync(new URL("../src/shell/tabs/settings.ts", import.meta.url), "utf8");
  const nachfolge = settings.slice(settings.indexOf("export async function richteNachfolgeEin("), settings.indexOf("export function wireSicherheitsKnoepfe("));
  assert.ok(!nachfolge.includes('$("#backup-now")'));
});
