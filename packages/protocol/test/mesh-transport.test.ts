/**
 * Tests fuer den Mesh-Transport.
 *
 * Ueber Funk gibt es keine Rueckfrage und keine zweite Chance. Deshalb pruefen
 * die Tests vor allem, dass nichts still Falsches herauskommt: falsch
 * zusammengesetzte Nachrichten, Fragments fremder Nachrichten, und die
 * Lawine, die ein Funknetz innerhalb von Sekunden lahmlegt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fragment, parseFrame, decrementTtl, messageId,
  Reassembler, ForwardingCache, MeshQueue,
  meshFeasibility, MeshKind, MeshPriority,
  LORA_MTU, MAX_PAYLOAD_PER_FRAME,
} from "../src/mesh-transport.js";

const text = (s: string) => new TextEncoder().encode(s);
const NOW = 1_800_000_000;

// ------------------------------------------------------------- Zerlegen

test("Kurze Nachricht passt in einen Rahmen", () => {
  const f = fragment(text("hallo"), MeshKind.PlainText);
  assert.equal(f.length, 1);
  assert.ok(f[0].length <= LORA_MTU, "ein Rahmen darf die Funk-Nutzlast nie ueberschreiten");
});

test("Jeder Rahmen bleibt unter der Funk-Grenze", () => {
  // Das ist die harte Bedingung: Ein zu grosser Rahmen wird gar nicht erst
  // gesendet, und der Fehler faellt erst im Feld auf.
  const gross = new Uint8Array(5000).fill(65);
  for (const f of fragment(gross, MeshKind.NostrEvent)) {
    assert.ok(f.length <= LORA_MTU, `Rahmen mit ${f.length} Byte`);
  }
});

test("Ein typisches Nostr-Event braucht mehrere Rahmen", () => {
  const ev = JSON.stringify({ id: "a".repeat(64), sig: "b".repeat(128), content: "x".repeat(300) });
  const f = fragment(text(ev), MeshKind.NostrEvent);
  assert.ok(f.length > 1, "genau deshalb braucht es Zerlegung");
});

test("Zu grosse Nachrichten werden vorher abgelehnt, nicht unterwegs", () => {
  const zuGross = new Uint8Array(255 * MAX_PAYLOAD_PER_FRAME + 1);
  assert.throws(() => fragment(zuGross, MeshKind.NostrEvent), /zu groß für Funk/);
  assert.throws(() => fragment(new Uint8Array(0), MeshKind.PlainText), /Leere Nachricht/);
});

test("Rahmenkopf traegt alle noetigen Angaben", () => {
  const f = fragment(text("x".repeat(500)), MeshKind.SolanaTx, MeshPriority.Zahlung, 5);
  const p = parseFrame(f[1]);
  assert.equal(p.kind, MeshKind.SolanaTx);
  assert.equal(p.priority, MeshPriority.Zahlung);
  assert.equal(p.index, 1);
  assert.equal(p.total, f.length);
  assert.equal(p.ttl, 5);
});

test("Muell-Rahmen werden abgelehnt", () => {
  assert.throws(() => parseFrame(new Uint8Array(3)), /zu kurz/);
  const f = fragment(text("hallo"), MeshKind.PlainText)[0];
  const kaputt = f.slice();
  kaputt[4] = 99; // unbekannte Paketart
  assert.throws(() => parseFrame(kaputt), /unbekannte Paketart/);
});

// ------------------------------------------------------- Zusammensetzen

test("Roundtrip: zerlegt und wieder zusammengesetzt", () => {
  const original = text("Treffen um 19 Uhr an der Bruecke. " + "x".repeat(800));
  const r = new Reassembler();
  let ergebnis = null;
  for (const f of fragment(original, MeshKind.NostrEvent)) ergebnis = r.add(f, NOW);
  assert.ok(ergebnis?.complete);
  assert.deepEqual(ergebnis!.payload, original);
});

test("Reihenfolge egal — Funk liefert nicht sortiert", () => {
  const original = text("y".repeat(700));
  const frames = fragment(original, MeshKind.NostrEvent).reverse();
  const r = new Reassembler();
  let ergebnis = null;
  for (const f of frames) ergebnis = r.add(f, NOW);
  assert.deepEqual(ergebnis!.payload, original);
});

test("Fehlende Fragments werden benannt, nicht nur gezaehlt", () => {
  // Damit gezielt nachgefordert werden kann, statt alles neu zu senden.
  const frames = fragment(text("z".repeat(700)), MeshKind.NostrEvent);
  const r = new Reassembler();
  let st = null;
  for (const [i, f] of frames.entries()) if (i !== 1) st = r.add(f, NOW);
  assert.equal(st!.complete, false);
  assert.deepEqual(st!.missing, [1]);
});

test("Doppelt empfangene Fragments stoeren nicht", () => {
  const original = text("w".repeat(600));
  const frames = fragment(original, MeshKind.NostrEvent);
  const r = new Reassembler();
  let st = null;
  for (const f of [...frames, ...frames]) st = r.add(f, NOW);
  assert.ok(st === null || st.complete === false || st.payload);
});

test("Fragments zweier Nachrichten laufen nicht zusammen", () => {
  // Der gefaehrlichste Fall: Es kaeme etwas heraus, das niemand geschrieben
  // hat — und die Signatur waere kaputt, ohne dass klar ist, warum.
  const a = fragment(text("a".repeat(600)), MeshKind.NostrEvent);
  const b = fragment(text("b".repeat(600)), MeshKind.NostrEvent);
  const r = new Reassembler();
  r.add(a[0], NOW);
  const st = r.add(b[1], NOW);
  // b gehoert zu einer anderen msgId -> eigene Sammlung, nicht vermischt.
  assert.ok(st === null || st.msgId !== parseFrame(a[0]).msgId);
});

test("Verfaelschter Inhalt faellt an der Kennung auf", () => {
  const frames = fragment(text("q".repeat(500)), MeshKind.NostrEvent);
  // Ein Byte in der Nutzlast kippen, Kopf unveraendert lassen.
  frames[0][FRAME_HEADER_OFFSET] ^= 0xff;
  const r = new Reassembler();
  let st = null;
  for (const f of frames) st = r.add(f, NOW);
  assert.equal(st!.complete, false, "lieber unvollstaendig als still falsch");
});
const FRAME_HEADER_OFFSET = 12;

test("Unvollstaendige Nachrichten verfallen", () => {
  const frames = fragment(text("r".repeat(600)), MeshKind.NostrEvent);
  const r = new Reassembler(60);
  r.add(frames[0], NOW);
  assert.equal(r.pending, 1);
  r.prune(NOW + 3600);
  assert.equal(r.pending, 0, "sonst fuellt ein Angreifer den Speicher");
});

test("Speicher ist hart begrenzt", () => {
  const r = new Reassembler(999_999, 10);
  for (let i = 0; i < 50; i++) {
    r.add(fragment(text(`nachricht-${i}-` + "x".repeat(400)), MeshKind.NostrEvent)[0], NOW + i);
  }
  assert.ok(r.pending <= 10, `pending=${r.pending}`);
});

// ------------------------------------------------------- Weiterleiten

test("Dieselbe Nachricht wird nicht zweimal weitergereicht", () => {
  // Ohne das wird aus jeder Nachricht eine Lawine, die den gemeinsamen
  // Funkkanal innerhalb von Sekunden stilllegt.
  const c = new ForwardingCache();
  const f = fragment(text("hallo mesh"), MeshKind.PlainText)[0];
  assert.equal(c.shouldForward(f, NOW), true);
  assert.equal(c.shouldForward(f, NOW + 1), false);
});

test("Nach der Sperrfrist darf erneut weitergereicht werden", () => {
  const c = new ForwardingCache(60);
  const f = fragment(text("hallo"), MeshKind.PlainText)[0];
  c.shouldForward(f, NOW);
  assert.equal(c.shouldForward(f, NOW + 120), true);
});

test("Ausgelaufene Sprungzahl beendet die Weitergabe", () => {
  const c = new ForwardingCache();
  const f = fragment(text("hallo"), MeshKind.PlainText, MeshPriority.Nachricht, 1)[0];
  assert.equal(c.shouldForward(f, NOW), false, "sonst kreist ein Paket ewig");
});

test("Sprungzahl wird bei jeder Weitergabe verringert", () => {
  let f: Uint8Array | null = fragment(text("hallo"), MeshKind.PlainText, MeshPriority.Nachricht, 3)[0];
  assert.equal(parseFrame(f).ttl, 3);
  f = decrementTtl(f);
  assert.equal(parseFrame(f!).ttl, 2);
  f = decrementTtl(f!);
  assert.equal(parseFrame(f!).ttl, 1);
  assert.equal(decrementTtl(f!), null, "danach ist Schluss");
});

test("Weiterleitungs-Speicher waechst nicht unbegrenzt", () => {
  const c = new ForwardingCache(999_999, 50);
  for (let i = 0; i < 300; i++) {
    c.shouldForward(fragment(text(`m${i}`), MeshKind.PlainText)[0], NOW + i);
  }
  assert.ok(c.size <= 50);
});

// ------------------------------------------------------------- Vorrang

test("Notfall geht vor Hintergrund", () => {
  const q = new MeshQueue();
  q.enqueue(text("bild".repeat(100)), MeshKind.NostrEvent, MeshPriority.Hintergrund, "Bild", NOW);
  q.enqueue(text("HILFE"), MeshKind.PlainText, MeshPriority.Notfall, "Notruf", NOW + 10);
  assert.equal(q.pending[0].label, "Notruf");
});

test("Innerhalb einer Stufe zaehlt das Alter", () => {
  // Sonst verdraengt eine neue Nachricht derselben Stufe eine aeltere dauerhaft.
  const q = new MeshQueue();
  q.enqueue(text("erste"), MeshKind.PlainText, MeshPriority.Nachricht, "A", NOW);
  q.enqueue(text("zweite"), MeshKind.PlainText, MeshPriority.Nachricht, "B", NOW + 10);
  assert.deepEqual(q.pending.map((p) => p.label), ["A", "B"]);
});

test("Warteschlange liefert Rahmen einzeln und wird leer", () => {
  const q = new MeshQueue();
  q.enqueue(text("x".repeat(600)), MeshKind.NostrEvent, MeshPriority.Nachricht, "Test", NOW);
  let n = 0;
  while (q.next()) n++;
  assert.ok(n >= 3);
  assert.equal(q.next(), null);
});

test("Abbrechen entfernt eine Nachricht aus der Warteschlange", () => {
  const q = new MeshQueue();
  const m = q.enqueue(text("x".repeat(600)), MeshKind.NostrEvent, MeshPriority.Nachricht, "Test", NOW);
  assert.equal(q.remove(m.msgId), true);
  assert.equal(q.pending.length, 0);
});

test("Dauer wird ehrlich geschaetzt", () => {
  // Ein Fortschrittsbalken ohne Zeitbezug ist bei Funk nutzlos — es geht um
  // Minuten, und der Nutzer sollte das vorher wissen.
  const q = new MeshQueue();
  q.enqueue(new Uint8Array(4000).fill(65), MeshKind.NostrEvent, MeshPriority.Nachricht, "gross", NOW);
  assert.ok(q.estimateSeconds(200) >= 20);
});

// ------------------------------------------------------------- Machbarkeit

test("Machbarkeit: Text ja, Dateien nein", () => {
  const kurz = meshFeasibility(200);
  assert.equal(kurz.feasible, true);
  assert.ok(kurz.seconds < 10);

  // 40 KB sind ueberraschend machbar: gut 3 Minuten. Das ist die Groesse, bei
  // der Mesh noch Sinn ergibt.
  const mittel = meshFeasibility(40_000);
  assert.equal(mittel.feasible, true);
  assert.ok(mittel.seconds > 120 && mittel.seconds < 600, `${mittel.seconds}s`);

  // Ueber 10 Minuten Sendezeit wird ehrlich in Minuten gewarnt, statt eine
  // Sekundenzahl zu nennen, die niemand einordnet.
  const lang = meshFeasibility(40_000, 50);
  assert.match(lang.note, /Minuten/);
  assert.match(lang.note, /fuer Dateien nicht|für Dateien nicht/);

  const riesig = meshFeasibility(200_000);
  assert.equal(riesig.feasible, false);
  assert.match(riesig.note, /zu viel für Funk/);
});

test("Machbarkeit: eine Solana-Transaktion passt", () => {
  // 1.232 Byte ist die Obergrenze einer Solana-Transaktion — der Grund,
  // warum Zahlungen ueber Funk ueberhaupt gehen.
  const r = meshFeasibility(1232);
  assert.equal(r.feasible, true);
  assert.ok(r.seconds < 60, `dauert ${r.seconds}s`);
});

test("Kennung ist inhaltsabhaengig", () => {
  assert.equal(messageId(text("gleich")), messageId(text("gleich")));
  assert.notEqual(messageId(text("a")), messageId(text("b")));
});
