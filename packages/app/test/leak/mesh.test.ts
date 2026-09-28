/**
 * Leak-Szenario „Mesh nur verschluesselt“ (Schritt 7.1, Abnahme): Was der
 * Funkknoten der App (`MeshNode`, Netz → Mesh) und die Chat-Datei
 * (`baueMeshBuendel`, Chat → ⇪) ausgeben, wird mitgeschnitten. Darin steht
 * weder der Schluessel des Absenders (Hex, npub, roh) noch Klartext – auch
 * nicht, wenn Offenes zu senden versucht wird.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MeshKind, MeshPriority, Reassembler, baueOfflineUeberweisung, buildDigest, buildEvent, buildPrivateDm, fragment,
  generateKeypair, regelMeshVerschluesselt, signEvent, type NostrEvent,
} from "@freedomstack/protocol";
import { Keypair } from "@solana/web3.js";
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

test("Nachforderung (7.4b): Luecken nachfordern verraet weder Schluessel noch Klartext", async () => {
  const dm = await buildPrivateDm({ senderSk: alice.sk, senderPk: alice.pk, recipientPk: bob.pk, content: TEXT });
  const vonA = mitschnitt();
  const vonB = mitschnitt();
  let angekommen = 0;
  const a = new MeshNode({ onMessage: () => {} }, 100_000);
  const b = new MeshNode({ onMessage: () => { angekommen++; } }, 100_000);
  a.setEigeneSchluessel([alice.pk]);
  b.setEigeneSchluessel([bob.pk]);
  let n = 0;
  // Der zweite Rahmen geht verloren; Bob fordert ihn nach, Alice sendet ihn nach
  await a.attach({ ...vonA, async send(f) { vonA.gesendet.push(f); if (n++ !== 1) b.receive(f); } });
  await b.attach({ ...vonB, async send(f) { vonB.gesendet.push(f); a.receive(f); } });
  a.enqueue(eventToMesh(dm.toRecipient), MeshKind.NostrEvent, MeshPriority.Nachricht, "an Bob");
  await warte(100);
  assert.equal(b.nachfordern(Math.floor(Date.now() / 1000) + 30), 1);
  await warte(100);

  assert.equal(angekommen, 1, "die DM ist vollstaendig bei Bob");
  assert.ok(vonB.gesendet.length > 0, "Bob hat nachgefordert");
  assert.deepEqual(pruefe(vonA.gesendet), []);
  // Bobs Nachforderung traegt keinen der beiden Schluessel und keinen Klartext
  assert.deepEqual(regelMeshVerschluesselt(paketeUndNutzlasten(vonB.gesendet), { schluessel: [alice.pk, bob.pk], klartexte: [TEXT] }), []);
  await a.detach();
  await b.detach();
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

test("Offline-SOL-Zahlung (7.2): ueber Funk ohne Nostr-Schluessel und ohne Nachrichtentext", async () => {
  // Die SOL-Adresse ist eine andere (SLIP-10); sie steht – wie spaeter auf der Kette – in der Transaktion.
  const sol = Keypair.generate();
  const tx = baueOfflineUeberweisung({
    von: sol.publicKey.toBase58(), an: Keypair.generate().publicKey.toBase58(), lamports: 1_000_000,
    nonceKonto: Keypair.generate().publicKey.toBase58(),
    stand: { autoritaet: sol.publicKey.toBase58(), nonce: Keypair.generate().publicKey.toBase58(), lamportsJeSignatur: 5000 },
  });
  tx.sign(sol);
  const t = mitschnitt();
  const n = new MeshNode({ onMessage: () => {} }, 100_000);
  n.setEigeneSchluessel([alice.pk]);
  await n.attach(t);
  n.enqueue(new Uint8Array(tx.serialize()), MeshKind.SolanaTx, MeshPriority.Zahlung, "SOL offline");
  await warte(100);
  assert.ok(t.gesendet.length >= 1);
  assert.deepEqual(pruefe(t.gesendet), []);
});
