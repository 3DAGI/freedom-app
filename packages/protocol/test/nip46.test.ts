/**
 * Nip46Signer (Schritt 1.3) gegen einen Test-Bunker im Speicher – auch gegen
 * einen, der luegt, schweigt oder eine Freigabe verlangt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { KIND_NIP46, Nip46Signer, parseBunkerUri, type Nip46Transport } from "../src/nip46.js";
import { LocalSigner } from "../src/signer.js";
import { MemoryRelay, type RelayFilter } from "../src/outbox.js";
import { buildEvent, generateKeypair, getTag, signEvent, verifyEvent, type NostrEvent } from "../src/event.js";
import { decryptDM } from "../src/dm.js";

type Verhalten = "ehrlich" | "anderesEvent" | "fremderAbsender" | "falscheId" | "fehler" | "authUrl" | "stumm" | "falschesSecret";

/** Test-Bunker: beantwortet Anfragen an seinen Schluessel mit dem Nutzer-Schluessel. */
function testBunker(verhalten: Verhalten = "ehrlich", secret?: string) {
  const bunker = generateKeypair();
  const nutzer = generateKeypair();
  const nutzerSigner = new LocalSigner(nutzer.sk);
  const bunkerSigner = new LocalSigner(bunker.sk);
  const relay = new MemoryRelay("wss://test.relay");
  const anfragen: string[] = [];
  const transport: Nip46Transport = {
    async publish(ev: NostrEvent) {
      await relay.publish(ev);
      if (ev.kind !== KIND_NIP46 || getTag(ev, "p") !== bunker.pk) return;
      const anfrage = JSON.parse(await bunkerSigner.nip44Decrypt(ev.pubkey, ev.content));
      anfragen.push(anfrage.method);
      if (verhalten === "stumm") return;
      let result = "";
      let error: string | undefined;
      switch (anfrage.method) {
        case "connect":
          if (verhalten === "falschesSecret" && anfrage.params[1] !== secret) error = "invalid secret";
          else result = "ack";
          break;
        case "get_public_key": result = nutzer.pk; break;
        case "sign_event": {
          const e = JSON.parse(anfrage.params[0]);
          const inhalt = verhalten === "anderesEvent" ? e.content + " (geändert)" : e.content;
          result = JSON.stringify(signEvent(buildEvent(nutzer.pk, e.kind, e.tags, inhalt, e.created_at), nutzer.sk));
          break;
        }
        case "nip44_encrypt": result = await nutzerSigner.nip44Encrypt(anfrage.params[0], anfrage.params[1]); break;
        case "nip44_decrypt": result = await nutzerSigner.nip44Decrypt(anfrage.params[0], anfrage.params[1]); break;
      }
      if (verhalten === "fehler" && anfrage.method === "sign_event") { result = ""; error = "nicht erlaubt"; }
      if (verhalten === "authUrl" && anfrage.method === "sign_event") { result = "auth_url"; error = "https://bunker.example/freigabe/123"; }
      const id = verhalten === "falscheId" ? "0000" : anfrage.id;
      const absender = verhalten === "fremderAbsender" ? new LocalSigner(generateKeypair().sk) : bunkerSigner;
      const antwort = await absender.signEvent(buildEvent(absender.publicKey(), KIND_NIP46, [["p", ev.pubkey]],
        await absender.nip44Encrypt(ev.pubkey, JSON.stringify({ id, result, error })), ev.created_at));
      await relay.publish(antwort);
    },
    // Wie ein boeswilliges Relay: liefert alles an den Client, egal von wem –
    // die Absenderpruefung muss der Signer selbst leisten.
    query: (f: RelayFilter) => relay.query({ kinds: f.kinds, "#p": f["#p"] }),
  };
  const uri = `bunker://${bunker.pk}?relay=${encodeURIComponent("wss://test.relay")}` + (secret ? `&secret=${secret}` : "");
  return { bunker, nutzer, transport, uri, anfragen, relay };
}

const schnell = { timeoutMs: 300, pollMs: 20 };

test("NIP-46: verbinden, Pubkey holen, signieren – gueltig und genau das Angefragte", async () => {
  const b = testBunker("ehrlich", "geheim123");
  const s = new Nip46Signer(b.uri, { transport: b.transport, ...schnell });
  assert.throws(() => s.publicKey(), /Nicht verbunden/);
  assert.equal(await s.connect(), b.nutzer.pk);
  assert.deepEqual(b.anfragen, ["connect", "get_public_key"]);
  const ev = buildEvent(b.nutzer.pk, 1, [["t", "x"]], "hallo", 1_790_000_000);
  const signiert = await s.signEvent(ev);
  assert.equal(verifyEvent(signiert), true);
  assert.equal(signiert.content, "hallo");
  assert.equal(signiert.pubkey, b.nutzer.pk);
});

test("NIP-46: Anfragen sind verschluesselt – Relays sehen weder Methode noch Inhalt", async () => {
  const b = testBunker();
  const s = new Nip46Signer(b.uri, { transport: b.transport, ...schnell });
  await s.connect();
  await s.signEvent(buildEvent(b.nutzer.pk, 1, [], "vertraulicher Text"));
  const alle = await b.relay.query({ kinds: [KIND_NIP46] });
  assert.ok(alle.length >= 6);
  for (const e of alle) {
    for (const verraten of ["vertraulicher Text", "sign_event", "get_public_key", b.nutzer.pk]) {
      assert.ok(!e.content.includes(verraten), verraten);
    }
  }
});

test("NIP-46: NIP-44 ueber den Bunker – kompatibel mit direkt verschluesselten Nachrichten", async () => {
  const b = testBunker();
  const s = new Nip46Signer(b.uri, { transport: b.transport, ...schnell });
  await s.connect();
  const bob = generateKeypair();
  const payload = await s.nip44Encrypt(bob.pk, "an bob");
  assert.equal(await decryptDM(payload, bob.sk, b.nutzer.pk), "an bob");
  const zurueck = await new LocalSigner(bob.sk).nip44Encrypt(b.nutzer.pk, "an dich");
  assert.equal(await s.nip44Decrypt(bob.pk, zurueck), "an dich");
  await assert.rejects(s.nip44Encrypt("npub1abc", "x"), /Pubkey ungültig/);
});

test("NIP-46: ein Bunker, der etwas anderes signiert, wird entlarvt", async () => {
  const b = testBunker("anderesEvent");
  const s = new Nip46Signer(b.uri, { transport: b.transport, ...schnell });
  await s.connect();
  await assert.rejects(s.signEvent(buildEvent(b.nutzer.pk, 1, [], "zahle 1 sat")), /anderes oder ungültiges Event/);
});

test("NIP-46: Antworten von fremdem Absender oder mit falscher id zaehlen nicht", async () => {
  for (const v of ["fremderAbsender", "falscheId", "stumm"] as const) {
    const b = testBunker(v);
    const s = new Nip46Signer(b.uri, { transport: b.transport, ...schnell });
    await assert.rejects(s.connect(), /Keine Antwort vom Signer \(connect\)/, v);
  }
});

test("NIP-46: Ablehnung, Freigabe-Adresse und falsches Secret werden gemeldet", async () => {
  const f = testBunker("fehler");
  const s1 = new Nip46Signer(f.uri, { transport: f.transport, ...schnell });
  await s1.connect();
  await assert.rejects(s1.signEvent(buildEvent(f.nutzer.pk, 1, [], "x")), /Signer lehnt ab: nicht erlaubt/);

  const a = testBunker("authUrl");
  const s2 = new Nip46Signer(a.uri, { transport: a.transport, ...schnell });
  await s2.connect();
  await assert.rejects(s2.signEvent(buildEvent(a.nutzer.pk, 1, [], "x")),
    /Freigabe: https:\/\/bunker\.example\/freigabe\/123/);

  const g = testBunker("falschesSecret", "richtig");
  const falsch = g.uri.replace("secret=richtig", "secret=falsch");
  await assert.rejects(new Nip46Signer(falsch, { transport: g.transport, ...schnell }).connect(), /invalid secret/);
});

test("NIP-46: fremde Events werden nicht zum Signieren geschickt", async () => {
  const b = testBunker();
  const s = new Nip46Signer(b.uri, { transport: b.transport, ...schnell });
  await s.connect();
  const vorher = b.anfragen.length;
  await assert.rejects(s.signEvent(buildEvent(generateKeypair().pk, 1, [], "x")), /anderen Schlüssel/);
  assert.equal(b.anfragen.length, vorher, "keine Anfrage an den Bunker");
});

test("NIP-46: bunker://-Adressen werden streng gelesen", () => {
  const pk = generateKeypair().pk;
  const ok = parseBunkerUri(`bunker://${pk}?relay=wss%3A%2F%2Fa.example&relay=wss://b.example&secret=s1`);
  assert.equal(ok.signerPubkey, pk);
  assert.deepEqual(ok.relays, ["wss://a.example", "wss://b.example"]);
  assert.equal(ok.secret, "s1");
  for (const [uri, fehler] of [
    [`nostrconnect://${pk}?relay=wss://a.example`, /bunker/],
    [`bunker://${pk.slice(0, 60)}?relay=wss://a.example`, /Signer-Pubkey/],
    [`bunker://${pk}zz?relay=wss://a.example`, /Signer-Pubkey/],
    [`bunker://${pk}`, /Relay/],
    [`bunker://${pk}?relay=http://a.example`, /Relay/],
    ["kein uri", /bunker/],
  ] as const) {
    assert.throws(() => parseBunkerUri(uri), fehler, uri);
  }
});

test("NIP-46: der Wegwerf-Schluessel taucht in keiner Darstellung auf", () => {
  const client = generateKeypair();
  const b = testBunker();
  const s = new Nip46Signer(b.uri, { transport: b.transport, clientSk: client.sk });
  const text = JSON.stringify(s) + JSON.stringify({ ...s }) + Object.keys(s).join();
  assert.ok(!text.includes(Buffer.from(client.sk).toString("hex")));
  assert.deepEqual(JSON.parse(JSON.stringify(s)), { type: "Nip46Signer", signer: b.bunker.pk, pubkey: null });
});
