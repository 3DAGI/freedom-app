/**
 * B-32c1: Reticulum-Adresse versiegelt an Kontakte (Kind 38082, `docs/RETICULUM-ENTWURF.md` W2 A). Relays sehen nur
 * Umschläge an Kontakte; gelesen wird nur, was ein Kontakt selbst geschrieben hat, in genau der Form.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair } from "../src/event.js";
import { LocalSigner } from "../src/signer.js";
import { giftWrapMitSigner } from "../src/gift-wrap.js";
import { KIND_FUNK_ADRESSE, baueFunkAdresseUmschlaege, oeffneFunkAdresseUmschlag } from "../src/funk-adresse.js";

const JETZT = 1_800_000_000;
const ADRESSE = "7f3a".repeat(8);

test("B-32c1: je Kontakt ein Umschlag – offen nur der Empfänger, weder Adresse noch Absender noch Kind", async () => {
  const ich = new LocalSigner(generateKeypair().sk);
  const [k1, k2] = [new LocalSigner(generateKeypair().sk), new LocalSigner(generateKeypair().sk)];
  const wraps = await baueFunkAdresseUmschlaege({
    von: ich, an: [k1.publicKey(), k2.publicKey(), k1.publicKey(), ich.publicKey(), "zz"], adresse: ADRESSE, nowSecs: JETZT,
  });
  assert.equal(wraps.length, 2, "je Kontakt einer, nicht an sich selbst, nichts Ungültiges");
  for (const [i, w] of wraps.entries()) {
    const offen = JSON.stringify(w);
    for (const nadel of [ADRESSE, ich.publicKey()]) assert.ok(!offen.includes(nadel), nadel);
    // Das Kind (38082) nur über die Struktur – in Signatur und Chiffrat steht die Zahl gelegentlich zufällig
    assert.equal(w.kind, 1059, `nicht ${KIND_FUNK_ADRESSE}`);
    assert.deepEqual(w.tags, [["p", [k1, k2][i]!.publicKey()]]);
  }
  assert.deepEqual(await oeffneFunkAdresseUmschlag(wraps[0]!, k1, new Set([ich.publicKey()])), { von: ich.publicKey(), zeit: JETZT, adresse: ADRESSE });
  assert.equal(await oeffneFunkAdresseUmschlag(wraps[0]!, k1, new Set()), null, "nur von eigenen Kontakten");
  assert.equal(await oeffneFunkAdresseUmschlag(wraps[0]!, k2, new Set([ich.publicKey()])), null, "nicht für mich");
  for (const kaputt of ["", "7F3A".repeat(8), ADRESSE.slice(2), `${ADRESSE}00`, `<${ADRESSE}>`]) {
    assert.deepEqual(await baueFunkAdresseUmschlaege({ von: ich, an: [k1.publicKey()], adresse: kaputt, nowSecs: JETZT }), [], kaputt);
  }
});

test("B-32c1: fremde Kerne – falscher Autor, anderes Kind, mehr Tags, Inhalt, kaputte Adresse", async () => {
  const kontakt = new LocalSigner(generateKeypair().sk);
  const ich = new LocalSigner(generateKeypair().sk);
  const kontakte = new Set([kontakt.publicKey()]);
  const umschlag = (o: { tags?: string[][]; kind?: number; content?: string; von?: LocalSigner }) => giftWrapMitSigner(
    { pubkey: kontakt.publicKey(), kind: o.kind ?? KIND_FUNK_ADRESSE, created_at: JETZT, tags: o.tags ?? [["lxmf", ADRESSE]], content: o.content ?? "" },
    o.von ?? kontakt, ich.publicKey(), { nowSecs: JETZT });
  assert.ok(await oeffneFunkAdresseUmschlag(await umschlag({}), ich, kontakte), "die Gegenprobe gilt");
  // Ein Fremder gibt sich im Kern als Kontakt aus – das Siegel verrät ihn (NIP-59)
  assert.equal(await oeffneFunkAdresseUmschlag(await umschlag({ von: new LocalSigner(generateKeypair().sk) }), ich, kontakte), null, "Fremder");
  for (const [was, o] of [
    ["anderes Kind", { kind: 38075 }],
    ["Inhalt", { content: "hallo" }],
    ["zwei Adressen", { tags: [["lxmf", ADRESSE], ["lxmf", "00".repeat(16)]] }],
    ["weiteres Tag", { tags: [["lxmf", ADRESSE], ["p", kontakt.publicKey()]] }],
    ["keine Adresse", { tags: [] }],
    ["Großbuchstaben", { tags: [["lxmf", ADRESSE.toUpperCase()]] }],
    ["zu kurz", { tags: [["lxmf", ADRESSE.slice(2)]] }],
    ["Zusatz im Tag", { tags: [["lxmf", ADRESSE, "x"]] }],
  ] as const) {
    assert.equal(await oeffneFunkAdresseUmschlag(await umschlag(o as never), ich, kontakte), null, was);
  }
});
