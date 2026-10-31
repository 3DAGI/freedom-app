/**
 * B-36e1: Bitchat-Schlüssel beim Treffen (BC-W5 A) – die „Bitchat-Karte“ im QR-Code: Person, beide Schlüssel, Zeit und die
 * Signatur der Person über ein Event 38083. Was nicht von der Person stammt, verändert oder aus der Zukunft ist, gilt nie.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, type NostrEvent, type UnsignedEvent } from "../src/event.js";
import { LocalSigner, type Signer } from "../src/signer.js";
import { qrCode } from "../src/qr.js";
import { BITCHAT_KARTE_PRAEFIX, BITCHAT_KARTE_ZUKUNFT_SEK, baueBitchatKarte, leseBitchatKarte } from "../src/bitchat-kontakt.js";

const JETZT = 1_800_000_000;
const NOISE = "5a".repeat(32);
const SIGNIER = "c3".repeat(32);

test("B-36e1: Karte bauen und lesen – Person, Schlüssel und Zeit kommen genau so heraus, der QR-Code fasst sie", async () => {
  const ich = new LocalSigner(generateKeypair().sk);
  const karte = await baueBitchatKarte({ von: ich, noise: NOISE, signier: SIGNIER, nowSecs: JETZT });
  assert.ok(karte?.startsWith(BITCHAT_KARTE_PRAEFIX));
  assert.equal(karte!.split(":").length, 7);
  assert.deepEqual(leseBitchatKarte(karte!, JETZT), { von: ich.publicKey(), zeit: JETZT, noise: NOISE, signier: SIGNIER });
  assert.deepEqual(leseBitchatKarte(`  ${karte}\n`, JETZT)?.von, ich.publicKey(), "eingefügt mit Leerzeichen");
  assert.ok(qrCode(karte!).groesse > 0, "passt in einen QR-Code");
  assert.equal(await baueBitchatKarte({ von: ich, noise: NOISE, signier: NOISE, nowSecs: JETZT }), null, "zwei gleiche Schlüssel");
  assert.equal(await baueBitchatKarte({ von: ich, noise: "zz", signier: SIGNIER, nowSecs: JETZT }), null);
});

test("B-36e1: nichts Fremdes, nichts Verändertes – eine andere Person, getauschte oder geänderte Felder gelten nie", async () => {
  const ich = new LocalSigner(generateKeypair().sk);
  const karte = (await baueBitchatKarte({ von: ich, noise: NOISE, signier: SIGNIER, nowSecs: JETZT }))!;
  const [, , person, noise, signier, zeit, sig] = karte.split(":");
  const mit = (teile: string[]) => `freedom-bitchat:1:${teile.join(":")}`;
  const fremd = generateKeypair().pk;
  for (const [name, falsch] of [
    ["andere Person", mit([fremd, noise!, signier!, zeit!, sig!])],
    ["anderer Noise-Schlüssel", mit([person!, "77".repeat(32), signier!, zeit!, sig!])],
    ["getauscht", mit([person!, signier!, noise!, zeit!, sig!])],
    ["andere Zeit", mit([person!, noise!, signier!, String(JETZT - 1), sig!])],
    ["andere Signatur", mit([person!, noise!, signier!, zeit!, "0".repeat(128)])],
  ] as const) {
    assert.equal(leseBitchatKarte(falsch, JETZT), null, name);
  }
});

test("B-36e1: die Form genau – Fassung, Großbuchstaben, führende Nullen, zusätzliche Felder, Zukunft", async () => {
  const ich = new LocalSigner(generateKeypair().sk);
  const karte = (await baueBitchatKarte({ von: ich, noise: NOISE, signier: SIGNIER, nowSecs: JETZT }))!;
  for (const [name, falsch] of [
    ["Fassung 2", karte.replace("freedom-bitchat:1:", "freedom-bitchat:2:")],
    ["Großbuchstaben", karte.toUpperCase()],
    ["führende Null", karte.replace(`:${JETZT}:`, `:0${JETZT}:`)],
    ["Feld zu viel", `${karte}:x`],
    ["leer", ""],
    ["nur der Anfang", BITCHAT_KARTE_PRAEFIX],
  ] as const) {
    assert.equal(leseBitchatKarte(falsch, JETZT), null, name);
  }
  assert.ok(leseBitchatKarte(karte, JETZT - BITCHAT_KARTE_ZUKUNFT_SEK), "bis zur Grenze voraus gilt sie");
  assert.equal(leseBitchatKarte(karte, JETZT - BITCHAT_KARTE_ZUKUNFT_SEK - 1), null, "weiter voraus nicht");
});

test("B-36e1: ein Signer, der etwas anderes signiert, ergibt keine Karte", async () => {
  const echt = new LocalSigner(generateKeypair().sk);
  const anderer = new LocalSigner(generateKeypair().sk);
  const falsch = (f: (e: UnsignedEvent) => Promise<NostrEvent>): Signer => ({ ...echt, publicKey: () => echt.publicKey(), signEvent: f } as Signer);
  for (const [name, signer] of [
    ["andere Zeit", falsch((e) => echt.signEvent({ ...e, created_at: e.created_at + 1 }))],
    ["anderer Schlüssel", falsch((e) => anderer.signEvent({ ...e, pubkey: anderer.publicKey() }))],
    ["mehr Tags", falsch((e) => echt.signEvent({ ...e, tags: [...e.tags, ["x", "y"]] }))],
  ] as const) {
    assert.equal(await baueBitchatKarte({ von: signer, noise: NOISE, signier: SIGNIER, nowSecs: JETZT }), null, name);
  }
});
