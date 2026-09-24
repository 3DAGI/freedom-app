/**
 * Schritt 3.1a: private KI-Anfragen – versiegelt vom Sitzungsschluessel, im
 * Umschlag an den Provider, mit Rechenarbeit gegen Spam.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEvent, computeEventId, generateKeypair, signEvent, type NostrEvent } from "../src/event.js";
import { buildJobRequest } from "../src/dvm.js";
import { giftWrapMitSigner } from "../src/gift-wrap.js";
import { MAX_POW_BITS, buildPrivateJobRequest, openPrivateJobRequest } from "../src/private-job.js";
import { eventDifficulty } from "../src/pow.js";
import { LocalSigner } from "../src/signer.js";
import { buildCapabilities, parseCapabilities } from "../src/tiers.js";
import { regelAutorNicht, regelKeinKlartext, regelKeinKlartextPrompt, regelKundeVerborgen } from "../src/leak-rules.js";

const PROMPT = "Welche Nebenwirkungen hat mein neues Medikament?";
const identitaet = generateKeypair();
const provider = new LocalSigner(generateKeypair().sk);

function anfrage(sitzung: LocalSigner) {
  return buildJobRequest({
    customerPubkey: sitzung.publicKey(), input: PROMPT, bidMsat: 21_000,
    providerPubkey: provider.publicKey(), params: [["tier", "standard"]],
  }, 1_790_000_000);
}

test("privat: Provider oeffnet genau die Anfrage, Autor ist der Sitzungsschluessel", async () => {
  const sitzung = new LocalSigner(generateKeypair().sk);
  const req = anfrage(sitzung);
  const { wrap, requestId } = await buildPrivateJobRequest({ request: req, sessionSigner: sitzung, providerPk: provider.publicKey() });
  const r = await openPrivateJobRequest(wrap, provider);
  assert.ok(r.ok, !r.ok ? r.grund : "");
  assert.equal(r.kundePk, sitzung.publicKey());
  assert.equal(r.request.id, requestId);
  assert.equal(r.request.id, computeEventId(req));
  assert.deepEqual(r.request.tags, req.tags);
  assert.equal(r.request.kind, 5050);
});

test("privat: Relays sehen weder Prompt noch Kunde noch Sitzungsschluessel", async () => {
  const sitzung = new LocalSigner(generateKeypair().sk);
  const { wrap } = await buildPrivateJobRequest({ request: anfrage(sitzung), sessionSigner: sitzung, providerPk: provider.publicKey() });
  assert.equal(wrap.kind, 1059);
  assert.deepEqual(regelKeinKlartextPrompt([wrap], [PROMPT]), []);
  assert.deepEqual(regelKeinKlartext([wrap], [PROMPT]), []);
  assert.deepEqual(regelKundeVerborgen([wrap], identitaet.pk), []);
  assert.deepEqual(regelKundeVerborgen([wrap], sitzung.publicKey()), []);
  assert.deepEqual(regelAutorNicht([wrap], sitzung.publicKey()), []);
  assert.deepEqual(wrap.tags.filter((t) => t[0] === "p"), [["p", provider.publicKey()]]);
});

test("privat: ein anderer Provider kann den Umschlag nicht oeffnen", async () => {
  const sitzung = new LocalSigner(generateKeypair().sk);
  const { wrap } = await buildPrivateJobRequest({ request: anfrage(sitzung), sessionSigner: sitzung, providerPk: provider.publicKey() });
  const fremd = new LocalSigner(generateKeypair().sk);
  const r = await openPrivateJobRequest(wrap, fremd);
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.grund : "", /nicht an diesen Provider/);
  // Auch mit umgeschriebenem p-Tag: die Signatur bricht, entschluesselt wird nichts.
  const umgelenkt = { ...wrap, tags: [["p", fremd.publicKey()]] };
  const r2 = await openPrivateJobRequest(umgelenkt, fremd);
  assert.equal(r2.ok, false);
  assert.match(!r2.ok ? r2.grund : "", /Signatur ungültig/);
});

test("privat: Rechenarbeit – verlangt, geleistet, zu wenig", async () => {
  const sitzung = new LocalSigner(generateKeypair().sk);
  const { wrap } = await buildPrivateJobRequest({ request: anfrage(sitzung), sessionSigner: sitzung, providerPk: provider.publicKey(), powBits: 8 });
  const bits = eventDifficulty(wrap);
  assert.ok(bits >= 8);
  assert.ok(wrap.tags.some((t) => t[0] === "nonce" && t[2] === "8"));
  assert.equal((await openPrivateJobRequest(wrap, provider, 8)).ok, true);
  const zuWenig = await openPrivateJobRequest(wrap, provider, bits + 1);
  assert.equal(zuWenig.ok, false);
  assert.match(!zuWenig.ok ? zuWenig.grund : "", /Zu wenig Rechenarbeit/);
  await assert.rejects(
    buildPrivateJobRequest({ request: anfrage(sitzung), sessionSigner: sitzung, providerPk: provider.publicKey(), powBits: MAX_POW_BITS + 1 }),
    /außerhalb/,
  );
});

test("privat: falsche Eingaben – kein Job, fremder Sitzungsschluessel, kaputter Kern", async () => {
  const sitzung = new LocalSigner(generateKeypair().sk);
  // Kein Job-Kind
  await assert.rejects(buildPrivateJobRequest({
    request: buildEvent(sitzung.publicKey(), 14, [], "hallo"), sessionSigner: sitzung, providerPk: provider.publicKey(),
  }), /Keine Job-Anfrage/);
  // Anfrage eines anderen Schluessels
  await assert.rejects(buildPrivateJobRequest({
    request: anfrage(new LocalSigner(generateKeypair().sk)), sessionSigner: sitzung, providerPk: provider.publicKey(),
  }), /Sitzungsschlüssel/);
  // Eine DM im Umschlag an den Provider ist keine Anfrage
  const dm = await giftWrapMitSigner(buildEvent(sitzung.publicKey(), 14, [], "hallo"), sitzung, provider.publicKey());
  const r = await openPrivateJobRequest(dm, provider);
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.grund : "", /Keine Job-Anfrage/);
  // Kern mit falschen Typen
  const kaputt = await giftWrapMitSigner({ ...anfrage(sitzung), tags: [["i", 5 as unknown as string]] }, sitzung, provider.publicKey());
  const r2 = await openPrivateJobRequest(kaputt, provider);
  assert.equal(r2.ok, false);
  assert.match(!r2.ok ? r2.grund : "", /beschädigt/);
  // Ein gewoehnliches Event ist kein Umschlag
  const offen: NostrEvent = signEvent(anfrage(sitzung), generateKeypair().sk);
  assert.equal((await openPrivateJobRequest(offen, provider)).ok, false);
});

test("Angebot: pow-Tag hin und zurueck, Fremdes wird ignoriert", () => {
  const kp = generateKeypair();
  const basis = { pubkey: kp.pk, tier: "classic" as const, models: ["m"], textRatePerKTokenMsat: 1000, tools: [], currentlyFree: false };
  const mit = parseCapabilities(signEvent(buildCapabilities({ ...basis, powBits: 12 }), kp.sk));
  assert.equal(mit.powBits, 12);
  assert.equal(parseCapabilities(signEvent(buildCapabilities(basis), kp.sk)).powBits, undefined);
  for (const roh of ["", "-1", "99", "1e1", "abc", String(MAX_POW_BITS + 1)]) {
    const ev = buildCapabilities(basis);
    ev.tags.push(["pow", roh]);
    assert.equal(parseCapabilities(signEvent(ev, kp.sk)).powBits, undefined, roh);
  }
});
