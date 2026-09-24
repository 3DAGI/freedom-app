/**
 * Interop-Test fuer Schritt 2.1: Unsere NIP-17-Umsetzung gegen eine
 * unabhaengige Referenz – nostr-tools (nip17/nip59), die viele Nostr-Clients
 * verwenden. Laeuft ohne Netz und ohne Relays, in beide Richtungen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as nip17 from "nostr-tools/nip17";
import * as nip59 from "nostr-tools/nip59";
import { buildPrivateDm, openPrivateDm } from "../src/private-dm.js";
import { generateKeypair } from "../src/event.js";

const alice = generateKeypair(); // FreedomStack
const bob = generateKeypair();   // anderer Client (nostr-tools)

test("FreedomStack → nostr-tools: der andere Client kann unsere DM öffnen", async () => {
  const text = "Hallo aus FreedomStack – Interop-Test";
  const { toRecipient } = await buildPrivateDm({
    senderSk: alice.sk, senderPk: alice.pk, recipientPk: bob.pk, content: text,
  });
  const rumor = nip59.unwrapEvent(toRecipient as never, bob.sk);
  assert.equal(rumor.kind, 14);
  assert.equal(rumor.content, text);
  assert.equal(rumor.pubkey, alice.pk);
  assert.deepEqual(rumor.tags.filter((t) => t[0] === "p").map((t) => t[1]), [bob.pk]);
});

test("nostr-tools → FreedomStack: wir können die DM des anderen Clients öffnen", async () => {
  const text = "Antwort von einem anderen Client";
  const wrap = nip17.wrapEvent(bob.sk, { publicKey: alice.pk }, text);
  const r = await openPrivateDm(wrap as never, alice.sk, alice.pk);
  assert.equal(r.ok, true, r.ok ? "" : r.reason);
  if (!r.ok) return;
  assert.equal(r.dm.from, bob.pk);
  assert.equal(r.dm.partner, bob.pk);
  assert.equal(r.dm.content, text);
});

test("nostr-tools mit Betreff und Antwortbezug: wir lesen den Inhalt trotzdem", async () => {
  const wrap = nip17.wrapEvent(bob.sk, { publicKey: alice.pk }, "mit Extras", "Betreff", {
    eventId: "ab".repeat(32),
  });
  const r = await openPrivateDm(wrap as never, alice.sk, alice.pk);
  assert.equal(r.ok, true, r.ok ? "" : r.reason);
  if (r.ok) assert.equal(r.dm.content, "mit Extras");
});

test("Selbstkopien von nostr-tools werden keiner fremden Unterhaltung zugeordnet", async () => {
  // nostr-tools (wrapManyEvents) baut fuer die Selbstkopie einen eigenen Inhalt,
  // dessen p-Tag der Absender selbst ist – anders als unsere Selbstkopie, die
  // denselben Inhalt wie an den Empfaenger traegt. Wir ordnen so eine Kopie
  // deshalb dem Absender selbst zu; die App zeigt sie nicht als fremde
  // Unterhaltung an (syncDmInbox ueberspringt partner === ich).
  const wraps = nip17.wrapManyEvents(bob.sk, [{ publicKey: alice.pk }], "an Alice, Kopie an mich");
  let eigene = 0;
  for (const w of wraps) {
    const r = await openPrivateDm(w as never, bob.sk, bob.pk);
    if (r.ok) {
      eigene++;
      assert.ok(r.dm.partner === bob.pk || r.dm.partner === alice.pk, "nie eine dritte Person");
    }
  }
  assert.ok(eigene >= 1, "mindestens eine Hülle ist für Bob selbst");
  // Alice bekommt die Nachricht regulaer.
  const fuerAlice = await Promise.all(wraps.map((w) => openPrivateDm(w as never, alice.sk, alice.pk)));
  assert.equal(fuerAlice.filter((r) => r.ok && r.dm.partner === bob.pk).length, 1);
});

test("unsere Selbstkopie kann der andere Client mit Alices Schlüssel öffnen", async () => {
  const { toSelf } = await buildPrivateDm({
    senderSk: alice.sk, senderPk: alice.pk, recipientPk: bob.pk, content: "Kopie",
  });
  const rumor = nip59.unwrapEvent(toSelf as never, alice.sk);
  assert.equal(rumor.content, "Kopie");
  assert.deepEqual(rumor.tags.find((t) => t[0] === "p")?.[1], bob.pk);
});
