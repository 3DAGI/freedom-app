/**
 * VKf (K1, VK-W9): Kopplung mit Code zum Eintippen. Geprüft wird: Form und Lesen des Codes
 * (Crockford), dieselbe Ableitung mit WebCrypto und `@noble/hashes`, das Event des Knotens
 * (Suchkennung, Ablauf, nur verschlüsselt) und dass die App nur koppelt, wenn alles passt –
 * Signatur, Kennung, Frist, Schlüssel und der Autor als Knoten. Dazu der Tag zum Einlösen, nur im
 * versiegelten Kern der Statusabfrage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  KIND_KURZCODE, KURZCODE_GUELTIG, KURZCODE_TAG, LocalSigner, baueKurzcodeEvent, baueStatusAuftrag, generateKeypair, getTag,
  kopplungscode, kurzcodeAbleitung, leseKurzcode, leseKurzcodeEvent, neueKopplung, neuerKurzcode, openPrivateKundenEvent, signEvent,
} from "../src/index.js";

const JETZT = 1_790_000_000;

test("Kurzcode: zwölf Zeichen Crockford in drei Vierern, gelesen wie abgetippt", () => {
  const codes = new Set(Array.from({ length: 50 }, () => neuerKurzcode()));
  assert.equal(codes.size, 50);
  for (const c of codes) assert.match(c, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.equal(leseKurzcode("7kq2 9xmb 4trp"), "7KQ2-9XMB-4TRP");
  assert.equal(leseKurzcode(" 7KQ2-9XMB-4TRP "), "7KQ2-9XMB-4TRP");
  assert.equal(leseKurzcode("IL0O-AAAA-BBBB"), "1100-AAAA-BBBB", "I, L wie 1, O wie 0");
  for (const x of ["7KQ2-9XMB-4TR", "7KQ2-9XMB-4TRPX", "7KQ2-9XMB-4TRU", "", "freedom-kopplung:1:ab"]) assert.equal(leseKurzcode(x), null, x);
});

test("Kurzcode: Ableitung wie PBKDF2-SHA256 mit 600 000 Runden – WebCrypto und noble gleich", async () => {
  const a = await kurzcodeAbleitung("7kq2-9xmb-4trp");
  const noble = await pbkdf2Async(sha256, "7KQ29XMB4TRP", "freedomstack-kurzcode-v1", { c: 600_000, dkLen: 64 });
  assert.deepEqual([...a.schluessel], [...noble.slice(0, 32)]);
  assert.equal(a.suche, Buffer.from(noble.slice(32)).toString("hex"));
  await assert.rejects(kurzcodeAbleitung("zu-kurz"));
});

test("Kurzcode: Event des Knotens – findbar über die Kennung, nur verschlüsselt, koppelt nur, wenn alles passt", async () => {
  const knoten = generateKeypair();
  const kopplung = neueKopplung(knoten.pk);
  const code = neuerKurzcode();
  const ab = await kurzcodeAbleitung(code);
  const ev = signEvent(await baueKurzcodeEvent({ kopplung, code, jetzt: JETZT }), knoten.sk);
  assert.equal(ev.kind, KIND_KURZCODE);
  assert.equal(getTag(ev, "d"), ab.suche);
  assert.equal(getTag(ev, "expiration"), String(JETZT + KURZCODE_GUELTIG));
  assert.ok(!JSON.stringify(ev).includes(kopplung.geheimnis), "das Geheimnis steht nur verschlüsselt darin");
  assert.deepEqual(await leseKurzcodeEvent(ev, ab, JETZT + 60), kopplung);

  // Anderer Code (andere Schlüssel), abgelaufen, zu lange gültig, verändert, anderes Kind: nichts
  const anders = await kurzcodeAbleitung(neuerKurzcode());
  assert.equal(await leseKurzcodeEvent(ev, { ...anders, suche: ab.suche }, JETZT + 60), null, "falscher Schlüssel");
  assert.equal(await leseKurzcodeEvent(ev, anders, JETZT + 60), null, "falsche Kennung");
  assert.equal(await leseKurzcodeEvent(ev, ab, JETZT + KURZCODE_GUELTIG), null, "abgelaufen");
  const lang = signEvent({ ...ev, tags: [["d", ab.suche], ["expiration", String(JETZT + KURZCODE_GUELTIG + 1)]] }, knoten.sk);
  assert.equal(await leseKurzcodeEvent(lang, ab, JETZT + 60), null, "länger gültig als erlaubt");
  assert.equal(await leseKurzcodeEvent({ ...ev, content: ev.content.slice(0, -4) + "AAAA" }, ab, JETZT + 60), null, "verändert");
  assert.equal(await leseKurzcodeEvent(signEvent({ ...ev, kind: 1 }, knoten.sk), ab, JETZT + 60), null);

  // Ein Fremder wiederholt das Event unter eigenem Schlüssel: Der Inhalt nennt einen anderen Knoten
  const fremd = generateKeypair();
  const kopie = signEvent({ ...ev, pubkey: fremd.pk }, fremd.sk);
  assert.equal(await leseKurzcodeEvent(kopie, ab, JETZT + 60), null);
  // … oder legt einen eigenen Kopplungscode hinein: ohne den Schlüssel aus dem Code nicht lesbar
  const eigenes = signEvent(await baueKurzcodeEvent({ kopplung: neueKopplung(fremd.pk), code: neuerKurzcode(), jetzt: JETZT }), fremd.sk);
  assert.equal(await leseKurzcodeEvent({ ...eigenes, tags: [["d", ab.suche], ...eigenes.tags.slice(1)] }, ab, JETZT + 60), null);
  assert.ok(kopplungscode(kopplung).startsWith("freedom-kopplung:1:"));
});

test("Kurzcode einlösen: Tag nur im versiegelten Kern der Statusabfrage", async () => {
  const knoten = generateKeypair();
  const k = neueKopplung(knoten.pk);
  const sitzung = new LocalSigner(generateKeypair().sk);
  const suche = "ab".repeat(32);
  const { wrap } = await baueStatusAuftrag({ sitzung, kopplung: k, kurzcode: suche });
  assert.deepEqual(wrap.tags, [["p", knoten.pk]], "offen nur der Empfänger");
  assert.ok(!JSON.stringify(wrap).includes(suche));
  const r = await openPrivateKundenEvent(wrap, new LocalSigner(knoten.sk));
  assert.ok(r.ok);
  assert.equal(getTag(r.request, KURZCODE_TAG), suche);
  const ohne = await openPrivateKundenEvent((await baueStatusAuftrag({ sitzung, kopplung: k })).wrap, new LocalSigner(knoten.sk));
  assert.ok(ohne.ok && getTag(ohne.request, KURZCODE_TAG) === undefined);
});
