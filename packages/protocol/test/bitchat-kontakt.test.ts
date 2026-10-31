/**
 * B-36c1: Bitchat zwischen Freedom-Kontakten – Schlüssel versiegelt an Kontakte (Kind 38083, BC-W3 A) und Umschläge in der
 * Noise-Sitzung unter dem Typ 0xF0 (BC-W2 A), geprüft wie alles im Mesh.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair } from "../src/event.js";
import { LocalSigner } from "../src/signer.js";
import { giftWrapMitSigner } from "../src/gift-wrap.js";
import {
  BITCHAT_FREEDOM_UMSCHLAG,
  KIND_BITCHAT_SCHLUESSEL,
  baueBitchatSchluesselUmschlaege,
  bitchatUmschlagKlartext,
  leseBitchatUmschlag,
  oeffneBitchatSchluesselUmschlag,
} from "../src/bitchat-kontakt.js";

const JETZT = 1_800_000_000;
const NOISE = "5a".repeat(32);
const SIGNIER = "c3".repeat(32);
const bytes = (x: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(x));

test("B-36c1: je Kontakt ein Umschlag – offen weder Schlüssel noch Absender noch Kind", async () => {
  const ich = new LocalSigner(generateKeypair().sk);
  const [k1, k2] = [new LocalSigner(generateKeypair().sk), new LocalSigner(generateKeypair().sk)];
  const wraps = await baueBitchatSchluesselUmschlaege({
    von: ich, an: [k1.publicKey(), k2.publicKey(), k2.publicKey(), ich.publicKey(), "zz"], noise: NOISE, signier: SIGNIER, nowSecs: JETZT,
  });
  assert.equal(wraps.length, 2, "je Kontakt einer, nicht an sich selbst, nichts Ungültiges");
  for (const [i, w] of wraps.entries()) {
    const offen = JSON.stringify(w);
    for (const nadel of [NOISE, SIGNIER, ich.publicKey()]) assert.ok(!offen.includes(nadel), nadel);
    assert.equal(w.kind, 1059, `nicht ${KIND_BITCHAT_SCHLUESSEL}`);
    assert.deepEqual(w.tags, [["p", [k1, k2][i]!.publicKey()]]);
  }
  assert.deepEqual(await oeffneBitchatSchluesselUmschlag(wraps[0]!, k1, new Set([ich.publicKey()])), {
    von: ich.publicKey(), zeit: JETZT, noise: NOISE, signier: SIGNIER,
  });
  assert.equal(await oeffneBitchatSchluesselUmschlag(wraps[0]!, k1, new Set()), null, "nur von eigenen Kontakten");
  assert.equal(await oeffneBitchatSchluesselUmschlag(wraps[1]!, k1, new Set([ich.publicKey()])), null, "nicht für mich");
  for (const [noise, signier] of [["", SIGNIER], [NOISE.toUpperCase(), SIGNIER], [NOISE, SIGNIER.slice(2)]]) {
    assert.deepEqual(await baueBitchatSchluesselUmschlaege({ von: ich, an: [k1.publicKey()], noise, signier, nowSecs: JETZT }), []);
  }
});

test("B-36c1: fremde Kerne – falscher Autor, anderes Kind, Inhalt, Tags in anderer Form", async () => {
  const kontakt = new LocalSigner(generateKeypair().sk);
  const ich = new LocalSigner(generateKeypair().sk);
  const kontakte = new Set([kontakt.publicKey()]);
  const umschlag = (o: { tags?: string[][]; kind?: number; content?: string; von?: LocalSigner }) => giftWrapMitSigner(
    {
      pubkey: kontakt.publicKey(), kind: o.kind ?? KIND_BITCHAT_SCHLUESSEL, created_at: JETZT,
      tags: o.tags ?? [["noise", NOISE], ["signier", SIGNIER]], content: o.content ?? "",
    },
    o.von ?? kontakt, ich.publicKey(), { nowSecs: JETZT });
  assert.ok(await oeffneBitchatSchluesselUmschlag(await umschlag({}), ich, kontakte), "die Gegenprobe gilt");
  assert.equal(await oeffneBitchatSchluesselUmschlag(await umschlag({ von: new LocalSigner(generateKeypair().sk) }), ich, kontakte), null, "Fremder");
  for (const [was, o] of [
    ["anderes Kind", { kind: 38082 }],
    ["Inhalt", { content: "hallo" }],
    ["vertauscht", { tags: [["signier", SIGNIER], ["noise", NOISE]] }],
    ["nur Noise", { tags: [["noise", NOISE]] }],
    ["weiteres Tag", { tags: [["noise", NOISE], ["signier", SIGNIER], ["p", kontakt.publicKey()]] }],
    ["zweimal derselbe Schlüssel", { tags: [["noise", NOISE], ["signier", NOISE]] }],
    ["Großbuchstaben", { tags: [["noise", NOISE.toUpperCase()], ["signier", SIGNIER]] }],
    ["Zusatz im Tag", { tags: [["noise", NOISE, "x"], ["signier", SIGNIER]] }],
  ] as const) {
    assert.equal(await oeffneBitchatSchluesselUmschlag(await umschlag(o as never), ich, kontakte), null, was);
  }
});

test("B-36c1: in der Noise-Sitzung nur Umschläge unter 0xF0 – nie Klartext, nie die eigene Kopie", async () => {
  const ich = new LocalSigner(generateKeypair().sk);
  const du = new LocalSigner(generateKeypair().sk);
  const wrap = await giftWrapMitSigner({ pubkey: ich.publicKey(), kind: 14, created_at: JETZT, tags: [], content: "hallo" }, ich, du.publicKey(), { nowSecs: JETZT });
  const klar = bitchatUmschlagKlartext(bytes(wrap), [ich.publicKey()])!;
  assert.equal(klar[0], BITCHAT_FREEDOM_UMSCHLAG);
  assert.deepEqual(leseBitchatUmschlag(klar), bytes(wrap));
  // Die eigene Kopie (Empfänger ich) geht nie hinaus
  const eigene = await giftWrapMitSigner({ pubkey: ich.publicKey(), kind: 14, created_at: JETZT, tags: [], content: "x" }, ich, ich.publicKey(), { nowSecs: JETZT });
  assert.equal(bitchatUmschlagKlartext(bytes(eigene), [ich.publicKey()]), null);
  // Kein Umschlag, kaputte Signatur, Klartext
  const offen = bytes({ ...wrap, kind: 1 });
  assert.equal(bitchatUmschlagKlartext(offen, []), null, "kein Umschlag");
  assert.equal(bitchatUmschlagKlartext(bytes({ ...wrap, content: wrap.content + "A" }), []), null, "Signatur");
  assert.equal(bitchatUmschlagKlartext(new TextEncoder().encode("hallo"), []), null, "Klartext");
  // Beim Lesen: nur unser Typ, nur ein gültiger Umschlag – Bitchats eigene Typen (0x01 Nachricht …) nicht
  assert.equal(leseBitchatUmschlag(Uint8Array.from([0x01, ...bytes(wrap)])), null);
  assert.equal(leseBitchatUmschlag(Uint8Array.from([BITCHAT_FREEDOM_UMSCHLAG, ...offen])), null);
  assert.equal(leseBitchatUmschlag(new Uint8Array(0)), null);
});
