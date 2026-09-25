/**
 * Private Direktnachrichten nach NIP-17 (Schritt 2.1) und die Leak-Regeln
 * dazu (Schritt 1.5).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDmRelayList,
  buildPrivateDm,
  dmAbgelaufen,
  isUsableDmRelay,
  MAX_ABLAUF_SECS,
  KIND_DM_RELAYS,
  openPrivateDm,
  parseDmRelayList,
} from "../src/private-dm.js";
import { giftUnwrap, KIND_GIFT_WRAP, KIND_SEAL, MAX_TIME_JITTER_SECS } from "../src/gift-wrap.js";
import { buildEvent, generateKeypair, signEvent } from "../src/event.js";
import { encryptDM } from "../src/dm.js";
import { regelAutorNicht, regelKeinKind4, regelKeinKlartext, regelPTagsNur } from "../src/leak-rules.js";

const alice = generateKeypair();
const bob = generateKeypair();
const carol = generateKeypair();
const TEXT = "Treffen morgen um neun am Bahnhof";

async function dmAliceAnBob() {
  return buildPrivateDm({ senderSk: alice.sk, senderPk: alice.pk, recipientPk: bob.pk, content: TEXT });
}

test("Bob oeffnet die Nachricht von Alice", async () => {
  const { toRecipient, rumorId } = await dmAliceAnBob();
  const r = await openPrivateDm(toRecipient, bob.sk, bob.pk);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.dm.from, alice.pk);
  assert.equal(r.dm.partner, alice.pk);
  assert.equal(r.dm.content, TEXT);
  assert.equal(r.dm.id, rumorId);
});

test("Alice sieht ihre eigene Kopie in derselben Unterhaltung", async () => {
  const { toSelf, rumorId } = await dmAliceAnBob();
  const r = await openPrivateDm(toSelf, alice.sk, alice.pk);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.dm.from, alice.pk);
  assert.equal(r.dm.partner, bob.pk);
  assert.equal(r.dm.id, rumorId, "beide Kopien haben dieselbe ID");
});

test("Unbeteiligte koennen nichts oeffnen", async () => {
  const { toRecipient, toSelf } = await dmAliceAnBob();
  assert.equal((await openPrivateDm(toRecipient, carol.sk, carol.pk)).ok, false);
  assert.equal((await openPrivateDm(toSelf, bob.sk, bob.pk)).ok, false);
});

test("Ein Siegel mit falscher Signatur wird verworfen", async () => {
  // Mallory kennt Bobs Posteingang, aber nicht Alices Schluessel: Er baut ein
  // Siegel, das behauptet, von Alice zu sein, und signiert es selbst.
  const mallory = generateKeypair();
  const kern = JSON.stringify(buildEvent(alice.pk, 14, [["p", bob.pk]], "gefälscht", 1_700_000_000));
  const siegelInhalt = await encryptDM(kern, mallory.sk, bob.pk);
  const siegel = signEvent(buildEvent(mallory.pk, KIND_SEAL, [], siegelInhalt, 1_700_000_000), mallory.sk);
  const gefaelscht = { ...siegel, pubkey: alice.pk }; // Signatur passt nicht mehr
  const wegwerf = generateKeypair();
  const umschlag = signEvent(
    buildEvent(wegwerf.pk, KIND_GIFT_WRAP, [["p", bob.pk]], await encryptDM(JSON.stringify(gefaelscht), wegwerf.sk, bob.pk), 1_700_000_000),
    wegwerf.sk,
  );
  const r = await giftUnwrap(umschlag, bob.sk);
  assert.equal(r.ok, false);
  assert.equal((await openPrivateDm(umschlag, bob.sk, bob.pk)).ok, false);
});

test("Ungueltige Empfaenger werden abgelehnt", async () => {
  await assert.rejects(
    buildPrivateDm({ senderSk: alice.sk, senderPk: alice.pk, recipientPk: "npub1xyz", content: "x" }),
    /64-stelliger Hex/,
  );
});

test("Posteingangs-Relays (Kind 10050): nur wss, keine lokalen Adressen, hoechstens fuenf", () => {
  assert.equal(isUsableDmRelay("wss://relay.example.org"), true);
  for (const schlecht of ["ws://relay.example.org", "wss://localhost", "wss://127.0.0.1", "wss://192.168.1.2", "wss://10.0.0.1", "wss://172.20.0.1", "https://x.org", "kaputt"]) {
    assert.equal(isUsableDmRelay(schlecht), false, schlecht);
  }
  const ev = buildDmRelayList(alice.pk, ["wss://a.org", "wss://a.org", "wss://localhost", "wss://b.org", "wss://c.org", "wss://d.org", "wss://e.org", "wss://f.org"]);
  assert.equal(ev.kind, KIND_DM_RELAYS);
  const gelesen = parseDmRelayList(signEvent(ev, alice.sk));
  assert.deepEqual(gelesen, ["wss://a.org", "wss://b.org", "wss://c.org", "wss://d.org", "wss://e.org"]);
  assert.deepEqual(parseDmRelayList(undefined), []);
});

// ------------------------------------------------------------- Leak-Tests

test("Leak: eine DM veroeffentlicht kein Kind 4, keinen Klartext, keinen echten Absender", async () => {
  const { toRecipient, toSelf } = await dmAliceAnBob();
  const veroeffentlicht = [toRecipient, toSelf];
  assert.deepEqual(regelKeinKind4(veroeffentlicht), []);
  assert.deepEqual(regelKeinKlartext(veroeffentlicht, [TEXT]), []);
  assert.deepEqual(regelAutorNicht(veroeffentlicht, alice.pk), []);
  assert.deepEqual(regelPTagsNur(veroeffentlicht, [bob.pk, alice.pk]), []);
});

test("Leak-Regeln erkennen das alte Format als undicht", () => {
  const alt = signEvent(buildEvent(alice.pk, 4, [["p", bob.pk]], "verschluesselt"), alice.sk);
  assert.equal(regelKeinKind4([alt]).length, 1);
  assert.equal(regelAutorNicht([alt], alice.pk).length, 1);
  const offen = signEvent(buildEvent(alice.pk, 5050, [["i", TEXT, "text"]], ""), alice.sk);
  assert.equal(regelKeinKlartext([offen], [TEXT]).length, 1);
});

// ------------------------------------------------------------- Ueber den Signer (Schritt 1.3)

import { LocalSigner, type Signer } from "../src/signer.js";

/** Signer, der mitzaehlt – und keinen Schluessel nach aussen gibt. */
function zaehlSigner(sk: Uint8Array): Signer & { aufrufe: string[] } {
  const innen = new LocalSigner(sk);
  const aufrufe: string[] = [];
  return {
    aufrufe,
    publicKey: () => innen.publicKey(),
    signEvent: async (ev) => { aufrufe.push("signEvent:" + ev.kind); return innen.signEvent(ev); },
    nip44Encrypt: async (p, t) => { aufrufe.push("nip44Encrypt"); return innen.nip44Encrypt(p, t); },
    nip44Decrypt: async (p, t) => { aufrufe.push("nip44Decrypt"); return innen.nip44Decrypt(p, t); },
  };
}

test("NIP-17 ueber den Signer: Siegel signiert und verschluesselt der Signer, der Empfaenger liest wie bisher", async () => {
  const s = zaehlSigner(alice.sk);
  const out = await buildPrivateDm({ signer: s, recipientPk: bob.pk, content: TEXT });
  assert.deepEqual(s.aufrufe, ["nip44Encrypt", "signEvent:13", "nip44Encrypt", "signEvent:13"],
    "je Umschlag: Siegel verschluesseln und signieren – ueber den Signer");
  const r = await openPrivateDm(out.toRecipient, bob.sk, bob.pk);
  assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.dm.content, TEXT); assert.equal(r.dm.from, alice.pk); }
  const selbst = await openPrivateDm(out.toSelf, alice.sk, alice.pk);
  assert.equal(selbst.ok && selbst.dm.partner, bob.pk);
});

test("NIP-17 ueber den Signer: Oeffnen ueber den Signer, kompatibel in beide Richtungen", async () => {
  const alt = await buildPrivateDm({ senderSk: alice.sk, senderPk: alice.pk, recipientPk: bob.pk, content: TEXT });
  const b = zaehlSigner(bob.sk);
  const r = await openPrivateDm(alt.toRecipient, b);
  assert.equal(r.ok && r.dm.content, TEXT);
  assert.deepEqual(b.aufrufe, ["nip44Decrypt", "nip44Decrypt"], "Umschlag und Siegel ueber den Signer");
  const fremd = await openPrivateDm(alt.toRecipient, zaehlSigner(carol.sk));
  assert.equal(fremd.ok, false, "nicht fuer Carol");
});

test("NIP-17: Schluessel und Pubkey muessen zusammenpassen", async () => {
  await assert.rejects(buildPrivateDm({ senderSk: alice.sk, senderPk: bob.pk, recipientPk: carol.pk, content: "x" }),
    /passt nicht zum Schlüssel/);
  await assert.rejects(buildPrivateDm({ recipientPk: carol.pk, content: "x" }), /Absender fehlt/);
  const out = await buildPrivateDm({ senderSk: alice.sk, senderPk: alice.pk, recipientPk: bob.pk, content: "x" });
  await assert.rejects(openPrivateDm(out.toRecipient, bob.sk, carol.pk), /passt nicht zum Schlüssel/);
});

// ---------------------------------------------------------- Ablauf (2.5, NIP-40)

test("2.5: Ablauf steht exakt im Inhalt und spaeter auf beiden Umschlaegen", async () => {
  const jetzt = 1_790_000_000;
  const tag = 24 * 3600;
  const dm = await buildPrivateDm({ senderSk: alice.sk, senderPk: alice.pk, recipientPk: bob.pk, content: TEXT, nowSecs: jetzt, ablaufSecs: tag });
  for (const w of [dm.toRecipient, dm.toSelf]) {
    const ablauf = Number(w.tags.find((t) => t[0] === "expiration")?.[1]);
    assert.ok(ablauf >= jetzt + tag && ablauf < jetzt + 2 * tag, `Umschlag laeuft nach der Dauer ab, hoechstens eine Dauer spaeter: ${ablauf - jetzt}`);
    assert.deepEqual(w.tags.map((t) => t[0]).sort(), ["expiration", "p"], "sonst nichts Neues auf dem Umschlag");
  }
  const r = await openPrivateDm(dm.toRecipient, bob.sk, bob.pk);
  assert.ok(r.ok);
  assert.equal(r.dm.expiresAt, jetzt + tag, "im Inhalt exakt");
  assert.equal(dmAbgelaufen(r.dm, jetzt + tag - 1), false);
  assert.equal(dmAbgelaufen(r.dm, jetzt + tag), true);
  // Ohne Ablauf: kein Tag, nie abgelaufen
  const ohne = await dmAliceAnBob();
  assert.equal(ohne.toRecipient.tags.some((t) => t[0] === "expiration"), false);
  const o = await openPrivateDm(ohne.toRecipient, bob.sk, bob.pk);
  assert.ok(o.ok);
  assert.equal(o.dm.expiresAt, undefined);
  assert.equal(dmAbgelaufen(o.dm, Number.MAX_SAFE_INTEGER), false);
});

test("2.5: Der Ablauf des Umschlags verraet den Sendezeitpunkt nicht genau", async () => {
  // Bei langer Dauer streut der Ablauf ueber das ganze Zeitfenster von NIP-59.
  const jetzt = 1_790_000_000;
  const dauer = 30 * 24 * 3600;
  const abl = new Set<number>();
  for (let i = 0; i < 8; i++) {
    const dm = await buildPrivateDm({ senderSk: alice.sk, senderPk: alice.pk, recipientPk: bob.pk, content: TEXT, nowSecs: jetzt, ablaufSecs: dauer });
    for (const w of [dm.toRecipient, dm.toSelf]) {
      const a = Number(w.tags.find((t) => t[0] === "expiration")?.[1]);
      assert.ok(a >= jetzt + dauer && a < jetzt + dauer + MAX_TIME_JITTER_SECS);
      abl.add(a);
    }
  }
  assert.ok(abl.size >= 15, `16 Umschlaege, ${abl.size} verschiedene Ablaufzeiten`);
});

test("2.5: Ablauf ausserhalb 60 s bis 1 Jahr wird abgelehnt; Muell im Inhalt zaehlt nicht", async () => {
  const bau = (ablaufSecs: number) => buildPrivateDm({ senderSk: alice.sk, senderPk: alice.pk, recipientPk: bob.pk, content: TEXT, ablaufSecs });
  await assert.rejects(bau(59), /außerhalb/);
  await assert.rejects(bau(MAX_ABLAUF_SECS + 1), /außerhalb/);
  await assert.rejects(bau(1.5), /außerhalb/);
  // Fremder Inhalt mit kaputtem Ablauf: wird nicht als Ablauf gelesen
  const { giftWrap } = await import("../src/gift-wrap.js");
  const rumor = buildEvent(alice.pk, 14, [["p", bob.pk], ["expiration", "morgen"]], TEXT);
  const w = await giftWrap(rumor, alice.sk, alice.pk, bob.pk);
  const r = await openPrivateDm(w, bob.sk, bob.pk);
  assert.ok(r.ok);
  assert.equal(r.dm.expiresAt, undefined);
});
