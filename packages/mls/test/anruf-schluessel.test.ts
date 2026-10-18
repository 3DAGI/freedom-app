/**
 * B-34b: Schlüssel für Bild und Ton eines Gruppenanrufs aus dem MLS-Exporter (LK3 A) – alle Mitglieder einer Epoche
 * leiten denselben ab, nach einem Commit gibt es einen neuen, und wer entfernt wurde, kennt ihn nicht.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { schnorr } from "@noble/curves/secp256k1.js";
import { LocalSigner, fromHex, generateKeypair, toHex, type NostrEvent } from "@freedomstack/protocol";
import { Mls, ladeMls } from "../src/index.js";

ladeMls(gunzipSync(readFileSync(new URL("../dist/freedom_mls_bg.wasm.gz", import.meta.url))));

const RELAYS = ["wss://nostr.mom", "wss://offchain.pub"];
const ANRUF = "ab".repeat(16);
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

function person() {
  const kp = generateKeypair();
  const signer = new LocalSigner(kp.sk);
  const beweis = (idHex: string) => toHex(schnorr.sign(fromHex(idHex), kp.sk));
  return { pk: kp.pk, signer, beweis, mls: new Mls(signer, beweis) };
}
type Person = ReturnType<typeof person>;

const keyPackage = async (p: Person) => p.signer.signEvent(await p.mls.keyPackage("geraet-1"));
const fuer = (einladungen: NostrEvent[], pk: string) => einladungen.find((e) => e.tags.some((t) => t[0] === "p" && t[1] === pk))!;
const schluessel = (p: Person, gruppe: string, anruf = ANRUF) => hex(p.mls.anrufSchluessel(gruppe, anruf, p.mls.epoche(gruppe)));

async function gruppeZuDritt() {
  const [a, b, c] = [person(), person(), person()];
  const g = await a.mls.gruppeAnlegen("Anruf", [await keyPackage(b), await keyPackage(c)], RELAYS);
  for (const p of [b, c]) assert.equal(await p.mls.beitreten(fuer(g.einladungen, p.pk)), g.gruppe);
  return { a, b, c, gruppe: g.gruppe };
}

test("B-34b: alle Mitglieder einer Epoche leiten denselben Schlüssel ab – 32 Byte, je Anruf ein anderer", async () => {
  const { a, b, c, gruppe } = await gruppeZuDritt();
  const k = schluessel(a, gruppe);
  assert.match(k, /^[0-9a-f]{64}$/);
  assert.equal(schluessel(b, gruppe), k);
  assert.equal(schluessel(c, gruppe), k);
  assert.equal(schluessel(a, gruppe), k, "beliebig oft – ein Neuladen mitten im Anruf findet denselben");
  assert.notEqual(schluessel(a, gruppe, "cd".repeat(16)), k, "ein anderer Anruf derselben Epoche hat einen anderen");

  // eine zweite Gruppe derselben Leute hat einen anderen
  const g2 = await a.mls.gruppeAnlegen("Anruf 2", [await keyPackage(b)], RELAYS);
  await b.mls.beitreten(fuer(g2.einladungen, b.pk));
  assert.notEqual(schluessel(a, g2.gruppe), k);
  assert.equal(schluessel(b, g2.gruppe), schluessel(a, g2.gruppe));

  // nach dem Neuladen des Zustands derselbe
  const c2 = new Mls(c.signer, c.beweis, c.mls.zustand());
  assert.equal(hex(c2.anrufSchluessel(gruppe, ANRUF, c2.epoche(gruppe))), k);
});

test("B-34b: nach dem Commit ein neuer Schlüssel – das entfernte Mitglied kennt ihn nicht", async () => {
  const { a, b, c, gruppe } = await gruppeZuDritt();
  const alt = schluessel(a, gruppe);
  const alteEpoche = a.mls.epoche(gruppe);
  const rm = await a.mls.entfernen(gruppe, [b.pk]);
  await a.mls.bestaetigt(rm.ausstehend!);
  for (const p of [c, b]) await p.mls.empfangen(rm.events[0]).catch(() => undefined);
  const w = c.mls.wartezeit(gruppe);
  if (w !== undefined) await new Promise((r) => setTimeout(r, w + 20));
  await c.mls.fortschreiten(gruppe);

  const neueEpoche = a.mls.epoche(gruppe);
  assert.ok(neueEpoche > alteEpoche);
  assert.equal(c.mls.epoche(gruppe), neueEpoche);
  const neu = schluessel(a, gruppe);
  assert.notEqual(neu, alt);
  assert.equal(schluessel(c, gruppe), neu);
  assert.throws(() => b.mls.anrufSchluessel(gruppe, ANRUF, neueEpoche), "Bob bekommt den neuen nie");
  let bobs: string | undefined;
  try {
    bobs = schluessel(b, gruppe);
  } catch {
    bobs = undefined;
  }
  assert.notEqual(bobs, neu, "was Bob noch ableiten kann, ist höchstens der alte");
});

test("B-34b: falsche Epoche, falscher Anruf, fremde Gruppe – Fehler statt eines Schlüssels", async () => {
  const { a, gruppe } = await gruppeZuDritt();
  const e = a.mls.epoche(gruppe);
  assert.throws(() => a.mls.anrufSchluessel(gruppe, ANRUF, e + 1), /Epoche gewechselt/);
  assert.throws(() => a.mls.anrufSchluessel(gruppe, ANRUF, e - 1), /Epoche gewechselt/);
  for (const falsch of ["", "AB".repeat(16), "ab".repeat(15), "ab".repeat(17), "zz".repeat(16)]) {
    assert.throws(() => a.mls.anrufSchluessel(gruppe, falsch, e), /Anruf ungültig/, JSON.stringify(falsch));
  }
  assert.throws(() => a.mls.anrufSchluessel("00".repeat(32), ANRUF, 0));
  assert.throws(() => person().mls.anrufSchluessel(gruppe, ANRUF, e), "wer nicht Mitglied ist, bekommt nichts");
});
