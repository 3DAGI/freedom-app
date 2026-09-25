/**
 * Schritt 2.5b: private Kontaktliste nach NIP-51 – alle Eintraege
 * verschluesselt an sich selbst, kein p-Tag offen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEvent, generateKeypair, signEvent } from "../src/event.js";
import { D_KONTAKTE, KIND_KONTAKTLISTE, MAX_KONTAKTE, buildPrivateKontaktliste, oeffnePrivateKontaktliste } from "../src/kontaktliste.js";
import { LocalSigner } from "../src/signer.js";
import { regelKeinKlartext, regelPTagsNur } from "../src/leak-rules.js";

const ich = new LocalSigner(generateKeypair().sk);
const [anna, ben] = [generateKeypair().pk, generateKeypair().pk];
const sk = (s: LocalSigner) => s.mitSchluessel((k) => k.slice());

test("Kontaktliste: hin und zurueck, Relays sehen weder Schluessel noch Namen", async () => {
  const ev = signEvent(await buildPrivateKontaktliste([{ pk: anna, name: "Anna Ärztin" }, { pk: ben, name: "Ben" }], ich), sk(ich));
  assert.equal(ev.kind, KIND_KONTAKTLISTE);
  assert.deepEqual(ev.tags, [["d", D_KONTAKTE]]);
  assert.deepEqual(regelPTagsNur([ev], []), []);
  assert.deepEqual(regelKeinKlartext([ev], [anna, ben, "Anna Ärztin", "Ben"]), []);
  assert.deepEqual(await oeffnePrivateKontaktliste(ev, ich), [{ pk: anna, name: "Anna Ärztin" }, { pk: ben, name: "Ben" }]);
  // Leere Liste (beim Ausschalten) ist gueltig
  assert.deepEqual(await oeffnePrivateKontaktliste(signEvent(await buildPrivateKontaktliste([], ich), sk(ich)), ich), []);
});

test("Kontaktliste: fremde, falsche und offene Listen werden abgelehnt", async () => {
  const fremd = new LocalSigner(generateKeypair().sk);
  const seine = signEvent(await buildPrivateKontaktliste([{ pk: anna, name: "A" }], fremd), sk(fremd));
  await assert.rejects(oeffnePrivateKontaktliste(seine, ich), /Nicht die eigene/);
  const andereD = signEvent(buildEvent(ich.publicKey(), KIND_KONTAKTLISTE, [["d", "andere"]], ""), sk(ich));
  await assert.rejects(oeffnePrivateKontaktliste(andereD, ich), /Keine Kontaktliste/);
  const offen = signEvent(buildEvent(ich.publicKey(), KIND_KONTAKTLISTE, [["d", D_KONTAKTE], ["p", anna]], ""), sk(ich));
  await assert.rejects(oeffnePrivateKontaktliste(offen, ich), /offenen Einträgen/);
  const muell = signEvent(buildEvent(ich.publicKey(), KIND_KONTAKTLISTE, [["d", D_KONTAKTE]], "kein chiffrat"), sk(ich));
  await assert.rejects(oeffnePrivateKontaktliste(muell, ich), /nicht lesbar/);
});

test("Kontaktliste: kaputte Eintraege fallen heraus, Grenzen gelten", async () => {
  const inhalt = await ich.nip44Encrypt(ich.publicKey(), JSON.stringify([
    ["p", anna, "", "Anna"], ["p", anna, "", "doppelt"], ["p", "ZZ"], ["e", ben], "x", ["p", ben, "", 7], ["p", ben.toUpperCase()],
  ]));
  const ev = signEvent(buildEvent(ich.publicKey(), KIND_KONTAKTLISTE, [["d", D_KONTAKTE]], inhalt), sk(ich));
  assert.deepEqual(await oeffnePrivateKontaktliste(ev, ich), [{ pk: anna, name: "Anna" }, { pk: ben, name: "" }]);
  await assert.rejects(buildPrivateKontaktliste([{ pk: "abc", name: "x" }], ich), /ungültig/);
  const zuViele = Array.from({ length: MAX_KONTAKTE + 1 }, () => ({ pk: anna, name: "" }));
  await assert.rejects(buildPrivateKontaktliste(zuViele, ich), /Höchstens/);
  const lang = await buildPrivateKontaktliste([{ pk: anna, name: "x".repeat(500) }], ich);
  assert.equal((await oeffnePrivateKontaktliste(signEvent(lang, sk(ich)), ich))[0].name.length, 100);
});
