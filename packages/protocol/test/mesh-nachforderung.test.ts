/**
 * Schritt 7.4b1: Fehlende Rahmen nachfordern. Über Funk geht jeder zwanzigste
 * Rahmen verloren – ohne Nachforderung wäre eine Antwort aus elf Rahmen fast
 * jedes zweite Mal ganz verloren. Die Nachforderung trägt nur, was ohnehin in
 * jedem Rahmenkopf steht (Kennung, Nummern), und kostet Sendezeit: deshalb
 * begrenzt auf beiden Seiten.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BESTAND_BYTES, BESTAND_MARKE, MeshKind, MeshPriority, MeshQueue, NACHFORDERUNG_BYTES, Reassembler,
  Sendegedaechtnis, baueNachforderung, fragment, leseNachforderung, messageId, parseFrame, pruefeMeshInhalt,
} from "../src/index.js";

const nutzlast = (n: number) => crypto.getRandomValues(new Uint8Array(n));

test("7.4b1: Nachforderung – Form, Grenzen, von Mesh als eigene Art erkannt", () => {
  const p = baueNachforderung("0a1b2c3d", [0, 7, 8, 254]);
  assert.equal(p.length, NACHFORDERUNG_BYTES);
  assert.deepEqual(leseNachforderung(p), { msgId: "0a1b2c3d", fehlend: [0, 7, 8, 254] });
  assert.deepEqual(pruefeMeshInhalt(p, MeshKind.NostrEvent), { ok: true, art: "nachforderung" });
  // Nur als Nostr-Art – als Klartext geht auch eine Nachforderung nicht
  assert.equal(pruefeMeshInhalt(p, MeshKind.PlainText).ok, false);

  assert.throws(() => baueNachforderung("0A1B2C3D", [1]), /Kennung/);
  assert.throws(() => baueNachforderung("0a1b2c", [1]), /Kennung/);
  assert.throws(() => baueNachforderung("0a1b2c3d", []), /Nichts/);
  assert.throws(() => baueNachforderung("0a1b2c3d", [255]), /255/);
  assert.throws(() => baueNachforderung("0a1b2c3d", [1.5]), /ungültig/);

  // Falsche Länge, falsche Marke, nichts gesetzt, Bit 255 gesetzt: keine Nachforderung
  assert.equal(leseNachforderung(p.subarray(0, 36)), null);
  assert.equal(leseNachforderung(Uint8Array.from([0x44, ...p.subarray(1)])), null);
  const leer = p.slice();
  leer.fill(0, 5);
  assert.equal(leseNachforderung(leer), null);
  const bit255 = p.slice();
  bit255[36] |= 0x80;
  assert.equal(leseNachforderung(bit255), null);
  assert.equal(pruefeMeshInhalt(bit255, MeshKind.NostrEvent).ok, false);

  // Bestand und Nachforderung verwechseln sich nicht
  const bestand = new Uint8Array(5 + BESTAND_BYTES);
  bestand[0] = BESTAND_MARKE;
  assert.deepEqual(pruefeMeshInhalt(bestand, MeshKind.NostrEvent), { ok: true, art: "bestand" });
  assert.equal(leseNachforderung(bestand), null);
});

test("7.4b1: Empfänger fordert nach Ruhe nach – höchstens dreimal, mit wachsendem Abstand", () => {
  const frames = fragment(nutzlast(700), MeshKind.NostrEvent, MeshPriority.Zahlung);
  assert.equal(frames.length, 4);
  const r = new Reassembler();
  r.add(frames[0], 1000);
  r.add(frames[2], 1000);
  assert.deepEqual(r.faelligeNachforderungen(1019), [], "noch keine 20 s Ruhe");
  const erste = r.faelligeNachforderungen(1020);
  assert.deepEqual(erste, [{ msgId: parseFrame(frames[0]).msgId, fehlend: [1, 3], priority: MeshPriority.Zahlung }]);
  assert.deepEqual(r.faelligeNachforderungen(1021), [], "nicht gleich noch einmal");
  // Zweite erst nach 60 s (dreifache Ruhe), ein neuer Rahmen setzt die Ruhe zurück
  assert.deepEqual(r.faelligeNachforderungen(1079), []);
  r.add(frames[1], 1075);
  assert.deepEqual(r.faelligeNachforderungen(1100), []);
  assert.deepEqual(r.faelligeNachforderungen(1135)[0]?.fehlend, [3]);
  // Ein doppelter Rahmen ist kein Fortschritt
  r.add(frames[1], 1200);
  assert.deepEqual(r.faelligeNachforderungen(1315)[0]?.fehlend, [3], "dritte nach 180 s");
  assert.deepEqual(r.faelligeNachforderungen(99_999), [], "danach nie mehr");
  // Vollständig: nichts mehr offen
  assert.ok(r.add(frames[3], 100_000)?.complete);
  assert.equal(r.pending, 0);
});

test("7.4b1: Sender sendet nur aus dem Gedächtnis nach – unbekannt, zu alt, zu oft: nichts", () => {
  const g = new Sendegedaechtnis(3, 3600, 2);
  const p = nutzlast(500);
  const frames = fragment(p, MeshKind.NostrEvent);
  const id = messageId(p);
  g.merke(id, frames, 1000);
  assert.deepEqual(g.nachsenden({ msgId: "ffffffff", fehlend: [0] }, 1000), [], "unbekannt");
  assert.deepEqual(g.nachsenden({ msgId: id, fehlend: [1, 9] }, 1100), [frames[1]], "Nummer außerhalb übergangen");
  assert.deepEqual(g.nachsenden({ msgId: id, fehlend: [0, 2] }, 1200), [frames[0], frames[2]]);
  assert.deepEqual(g.nachsenden({ msgId: id, fehlend: [0] }, 1300), [], "höchstens zweimal");
  assert.ok(g.kennt(id, 1300) && !g.kennt("ffffffff", 1300), "erschöpft, aber bekannt");

  g.merke(id, frames, 2000);
  assert.deepEqual(g.nachsenden({ msgId: id, fehlend: [0] }, 5601), [], "älter als eine Stunde");
  assert.equal(g.kennt(id, 5601), false);
  // Höchstens drei Nachrichten: die älteste fällt heraus
  const ids = [nutzlast(50), nutzlast(60), nutzlast(70), nutzlast(80)].map((x) => {
    g.merke(messageId(x), fragment(x, MeshKind.NostrEvent), 6000);
    return messageId(x);
  });
  assert.deepEqual(g.nachsenden({ msgId: ids[0], fehlend: [0] }, 6000), []);
  assert.equal(g.nachsenden({ msgId: ids[3], fehlend: [0] }, 6000).length, 1);
  // Eine gemerkte Kopie: späteres Senden aus der Warteschlange ändert sie nicht
  const q = new MeshQueue();
  const m = q.enqueue(p, MeshKind.NostrEvent, MeshPriority.Nachricht, "x", 7000);
  g.merke(m.msgId, m.frames, 7000);
  while (q.next());
  assert.equal(g.nachsenden({ msgId: m.msgId, fehlend: [0, 1, 2] }, 7000).length, 3);
});

test("7.4b1: Nachgesendete Rahmen reihen sich nach Vorrang ein", () => {
  const q = new MeshQueue();
  const hinten = q.enqueue(nutzlast(300), MeshKind.NostrEvent, MeshPriority.Hintergrund, "hinten", 1);
  const nach = fragment(nutzlast(400), MeshKind.NostrEvent, MeshPriority.Zahlung);
  q.enqueueFrames([nach[2], nach[0]], "abcd0123", MeshPriority.Zahlung, "nach", 5);
  q.enqueueFrames([], "leer", MeshPriority.Notfall, "leer", 6);
  assert.deepEqual(q.pending.map((m) => m.label), ["nach", "hinten"]);
  assert.equal(q.next()?.frame, nach[2]);
  assert.equal(q.next()?.frame, nach[0]);
  assert.equal(q.next()?.msgId, hinten.msgId, "danach der Rest");
});

test("7.4b1: über einen verlustreichen Kanal – Lücke gemeldet, nachgesendet, Nachricht vollständig", () => {
  const original = nutzlast(1500);
  const q = new MeshQueue();
  const g = new Sendegedaechtnis();
  const m = q.enqueue(original, MeshKind.NostrEvent, MeshPriority.Nachricht, "auftrag", 1000);
  g.merke(m.msgId, m.frames, 1000);

  // Hin: die Rahmen 2 und 5 gehen verloren
  const empfaenger = new Reassembler();
  let n = 0;
  for (let f = q.next(); f; f = q.next(), n++) if (n !== 2 && n !== 5) assert.equal(empfaenger.add(f.frame, 1000)?.complete, false);
  const [luecke] = empfaenger.faelligeNachforderungen(1030);
  assert.deepEqual(luecke.fehlend, [2, 5]);

  // Die Nachforderung selbst reist zerlegt über denselben Kanal zurück
  const sender = new Reassembler();
  let angekommen: Uint8Array | undefined;
  for (const f of fragment(baueNachforderung(luecke.msgId, luecke.fehlend), MeshKind.NostrEvent, luecke.priority)) {
    angekommen = sender.add(f, 1031)?.payload;
  }
  assert.equal(pruefeMeshInhalt(angekommen!, MeshKind.NostrEvent).ok, true);
  const nachzusenden = g.nachsenden(leseNachforderung(angekommen!)!, 1031);
  assert.equal(nachzusenden.length, 2);

  let fertig: Uint8Array | undefined;
  for (const f of nachzusenden) fertig = empfaenger.add(f, 1040)?.payload ?? fertig;
  assert.deepEqual(fertig, original, "Hash der Kennung passt zum Inhalt");
  assert.deepEqual(empfaenger.faelligeNachforderungen(99_999), []);
});
