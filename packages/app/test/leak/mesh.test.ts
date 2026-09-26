/**
 * Leak-Szenario „Mesh nur verschluesselt“ (Schritt 7.1, Abnahme): Was der
 * Funkknoten der App (`MeshNode`, Settings → Mesh) und die Chat-Datei
 * (`baueMeshBuendel`, Chat → ⇪) ausgeben, wird mitgeschnitten. Darin steht
 * weder der Schluessel des Absenders (Hex, npub, roh) noch Klartext – auch
 * nicht, wenn Offenes zu senden versucht wird.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MeshKind, MeshPriority, Reassembler, buildDigest, buildEvent, buildPrivateDm, fragment,
  generateKeypair, regelMeshVerschluesselt, signEvent, type NostrEvent,
} from "@freedomstack/protocol";
import { MeshNode, eventToMesh, type MeshTransport } from "../../src/mesh-radio.js";
import { baueMeshBuendel } from "../../src/mesh-transfer.js";

const TEXT = "Treffen um 19 Uhr am Bahnhof";
const alice = generateKeypair();
const bob = generateKeypair();
const text = (s: string) => new TextEncoder().encode(s);
const warte = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Transport, der jeden gesendeten Rahmen mitschneidet (Datei-Art: ohne Takt). */
function mitschnitt(): MeshTransport & { gesendet: Uint8Array[] } {
  const gesendet: Uint8Array[] = [];
  return { kind: "datei", name: "Mitschnitt", gesendet, async send(f) { gesendet.push(f); }, async close() { /* nichts */ } };
}

/** Rahmen UND zusammengesetzte Nutzlasten – ein Schluessel kann ueber zwei Rahmen verteilt sein. */
function paketeUndNutzlasten(frames: Uint8Array[]): Uint8Array[] {
  const r = new Reassembler();
  const out = [...frames];
  for (const f of frames) {
    const st = r.add(f);
    if (st?.complete && st.payload) out.push(st.payload);
  }
  return out;
}

const pruefe = (pakete: Uint8Array[]) =>
  regelMeshVerschluesselt(paketeUndNutzlasten(pakete), { schluessel: [alice.pk], klartexte: [TEXT] });

/** Was es zu senden gab, bevor 7.1 es verbot – alles mit Alices Schluessel oder Klartext. */
function offenes(): [Uint8Array, MeshKind][] {
  const ev = (kind: number, tags: string[][]) => eventToMesh(signEvent(buildEvent(alice.pk, kind, tags, TEXT), alice.sk));
  return [
    [ev(4, [["p", bob.pk]]), MeshKind.NostrEvent],
    [ev(1, []), MeshKind.NostrEvent],
    [ev(42, [["h", "raum"]]), MeshKind.NostrEvent],
    [ev(0, []), MeshKind.NostrEvent],
    [text(TEXT), MeshKind.PlainText],
    [text(`cashuA${TEXT}`), MeshKind.Ecash],
  ];
}

test("Funk: eine DM geht nur als Umschlag – ohne Schluessel und Klartext des Absenders", async () => {
  const dm = await buildPrivateDm({ senderSk: alice.sk, senderPk: alice.pk, recipientPk: bob.pk, content: TEXT });
  const t = mitschnitt();
  const n = new MeshNode({ onMessage: () => {} }, 100_000);
  n.setEigeneSchluessel([alice.pk]);
  await n.attach(t);

  n.enqueue(eventToMesh(dm.toRecipient), MeshKind.NostrEvent, MeshPriority.Nachricht, "an Bob");
  // Die eigene Kopie traegt Alice als Empfaenger, alles Offene ihren Schluessel oder Klartext.
  assert.throws(() => n.enqueue(eventToMesh(dm.toSelf), MeshKind.NostrEvent, MeshPriority.Nachricht, "Kopie"));
  for (const [nutzlast, art] of offenes()) {
    assert.throws(() => n.enqueue(nutzlast, art, MeshPriority.Nachricht, "offen"), `Art ${art}`);
  }
  await warte(200);

  assert.ok(t.gesendet.length > 1, "der Umschlag ist raus");
  assert.deepEqual(pruefe(t.gesendet), []);
  // Gegenprobe: Die Regel findet Alice in dem, was bis 7.1 gesendet werden konnte.
  for (const [nutzlast, art] of offenes()) {
    assert.ok(pruefe(fragment(nutzlast, art)).length > 0, `Gegenprobe Art ${art}`);
  }
});

test("Abgleich: aus einem gemischten Bestand gehen nur fremde Umschlaege", async () => {
  const dm = await buildPrivateDm({ senderSk: alice.sk, senderPk: alice.pk, recipientPk: bob.pk, content: TEXT });
  const offen = signEvent(buildEvent(alice.pk, 4, [["p", bob.pk]], TEXT), alice.sk);
  const profil = signEvent(buildEvent(alice.pk, 0, [], `{"name":"${TEXT}"}`), alice.sk);
  const bestand: NostrEvent[] = [dm.toRecipient, dm.toSelf, offen, profil];

  const t = mitschnitt();
  const n = new MeshNode({ onMessage: () => {} }, 100_000);
  n.setEigeneSchluessel([alice.pk]);
  n.setEventSource(() => bestand);
  await n.attach(t);
  await warte(100);

  // Die Gegenseite hat nichts: ihr leerer Bestand loest den Abgleich aus.
  const fremd = buildDigest([]);
  const paket = new Uint8Array(5 + fremd.bits.length);
  paket[0] = 0x44;
  paket.set(fremd.bits, 5);
  for (const f of fragment(paket, MeshKind.NostrEvent)) n.receive(f);
  await warte(200);

  const nutzlasten = paketeUndNutzlasten(t.gesendet).slice(t.gesendet.length);
  const umschlag = new TextDecoder().decode(eventToMesh(dm.toRecipient));
  assert.ok(nutzlasten.some((p) => new TextDecoder().decode(p) === umschlag), "der Umschlag an Bob ging raus");
  assert.deepEqual(pruefe(t.gesendet), []);
});

test("Datei: die Chat-Datei traegt nur Umschlaege und keinen Absender", async () => {
  const dm = await buildPrivateDm({ senderSk: alice.sk, senderPk: alice.pk, recipientPk: bob.pk, content: TEXT });
  const offen = signEvent(buildEvent(alice.pk, 4, [["p", bob.pk]], TEXT), alice.sk);
  const raum = signEvent(buildEvent(alice.pk, 42, [["h", "raum"]], TEXT), alice.sk);
  const { bundle, abgelehnt } = baueMeshBuendel([dm.toRecipient, dm.toSelf, offen, raum], [alice.pk]);
  assert.deepEqual(bundle.events.map((e) => e.id), [dm.toRecipient.id]);
  assert.equal(abgelehnt, 3);
  assert.equal("exportedBy" in bundle, false);
  assert.deepEqual(pruefe([text(JSON.stringify(bundle, null, 2))]), []);
});
