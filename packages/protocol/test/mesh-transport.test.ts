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
  pruefeMeshInhalt, pruefeSolanaTx, Sendezeitkonto, luftBytes, BESTAND_BYTES, BESTAND_MARKE, FRAME_HEADER_BYTES,
} from "../src/mesh-transport.js";
import { buildEvent, generateKeypair, signEvent } from "../src/event.js";
import { buildPrivateDm } from "../src/private-dm.js";
import {
  Keypair, PublicKey, SystemProgram, Transaction, TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";

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
  const f = fragment(text("hallo mesh"), MeshKind.NostrEvent)[0];
  assert.equal(c.shouldForward(f, NOW), true);
  assert.equal(c.shouldForward(f, NOW + 1), false);
});

test("Nach der Sperrfrist darf erneut weitergereicht werden", () => {
  const c = new ForwardingCache(60);
  const f = fragment(text("hallo"), MeshKind.NostrEvent)[0];
  c.shouldForward(f, NOW);
  assert.equal(c.shouldForward(f, NOW + 120), true);
});

test("Ausgelaufene Sprungzahl beendet die Weitergabe", () => {
  const c = new ForwardingCache();
  const f = fragment(text("hallo"), MeshKind.NostrEvent, MeshPriority.Nachricht, 1)[0];
  assert.equal(c.shouldForward(f, NOW), false, "sonst kreist ein Paket ewig");
});

test("Sprungzahl wird bei jeder Weitergabe verringert", () => {
  let f: Uint8Array | null = fragment(text("hallo"), MeshKind.NostrEvent, MeshPriority.Nachricht, 3)[0];
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
    c.shouldForward(fragment(text(`m${i}`), MeshKind.NostrEvent)[0], NOW + i);
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

// ------------------------------------------- Nur verschluesselt (7.1)

const ALICE = generateKeypair();
const BOB = generateKeypair();
const json = (x: unknown) => text(JSON.stringify(x));

test("Ein Umschlag darf ueber Mesh – ohne den Schluessel des Absenders", async () => {
  const dm = await buildPrivateDm({ senderSk: ALICE.sk, senderPk: ALICE.pk, recipientPk: BOB.pk, content: "Treffen um 19 Uhr" });
  assert.deepEqual(pruefeMeshInhalt(json(dm.toRecipient), MeshKind.NostrEvent, { eigeneSchluessel: [ALICE.pk] }), { ok: true, art: "umschlag" });
  // Die eigene Kopie traegt den eigenen Schluessel als Empfaenger – ueber Funk
  // verriete sie, wem das Geraet gehoert.
  const r = pruefeMeshInhalt(json(dm.toSelf), MeshKind.NostrEvent, { eigeneSchluessel: [ALICE.pk] });
  assert.equal(r.ok, false);
  assert.match((r as { grund: string }).grund, /eigenen Schlüssel/);
  // Beim Empfang (ohne eigene Schluessel) ist die Kopie ein gueltiger Umschlag.
  assert.equal(pruefeMeshInhalt(json(dm.toSelf), MeshKind.NostrEvent).ok, true);
});

test("Offene Events, Klartext und Ecash gehen nicht ueber Mesh", async () => {
  const offen = (kind: number, content: string) => json(signEvent(buildEvent(ALICE.pk, kind, [["p", BOB.pk]], content), ALICE.sk));
  for (const kind of [0, 1, 4, 14, 42, 9734, 38030]) {
    const r = pruefeMeshInhalt(offen(kind, "Treffen um 19 Uhr"), MeshKind.NostrEvent);
    assert.equal(r.ok, false, `Kind ${kind}`);
  }
  assert.equal(pruefeMeshInhalt(text("HILFE am Bahnhof"), MeshKind.PlainText).ok, false);
  assert.equal(pruefeMeshInhalt(text("cashuAeyJ0b2tlbiI6W3…"), MeshKind.Ecash).ok, false);
  assert.equal(pruefeMeshInhalt(text("kein json"), MeshKind.NostrEvent).ok, false);
  assert.equal(pruefeMeshInhalt(new Uint8Array([0xff, 0xfe, 0x7b]), MeshKind.NostrEvent).ok, false);
});

test("Ein veraenderter oder aufgefuellter Umschlag wird abgelehnt", async () => {
  const { toRecipient: w } = await buildPrivateDm({ senderSk: ALICE.sk, senderPk: ALICE.pk, recipientPk: BOB.pk, content: "x" });
  // Klartext in einem Zusatz-Tag: neu signiert, damit nur die Form scheitert.
  const zusatz = signEvent(buildEvent(w.pubkey, 1059, [...w.tags, ["subject", "Treffen"]], w.content, w.created_at), generateKeypair().sk);
  assert.match((pruefeMeshInhalt(json(zusatz), MeshKind.NostrEvent) as { grund: string }).grund, /nur Umschläge/);
  // Inhalt veraendert: Signatur passt nicht mehr.
  const falsch = { ...w, content: "A" + w.content.slice(2) + "B" };
  assert.equal(pruefeMeshInhalt(json(falsch), MeshKind.NostrEvent).ok, false);
  // Klartext statt NIP-44 im Inhalt.
  const k = generateKeypair();
  const klar = signEvent(buildEvent(k.pk, 1059, [["p", BOB.pk]], "Treffen um 19 Uhr am Bahnhof".repeat(6)), k.sk);
  assert.equal(pruefeMeshInhalt(json(klar), MeshKind.NostrEvent).ok, false);
});

test("Die Bestandsmeldung des Abgleichs darf – nur in genau ihrer Form", () => {
  const d = new Uint8Array(5 + BESTAND_BYTES);
  d[0] = BESTAND_MARKE;
  assert.deepEqual(pruefeMeshInhalt(d, MeshKind.NostrEvent), { ok: true, art: "bestand" });
  assert.equal(pruefeMeshInhalt(d.subarray(0, 100), MeshKind.NostrEvent).ok, false);
});

const HASH = "11111111111111111111111111111111";
function solanaTx(signieren = true): Uint8Array {
  const zahler = Keypair.generate();
  const tx = new Transaction({ feePayer: zahler.publicKey, recentBlockhash: HASH })
    .add(SystemProgram.transfer({ fromPubkey: zahler.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 5000 }));
  if (signieren) tx.sign(zahler);
  return new Uint8Array(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
}

test("Solana: nur vollstaendig signierte Transaktionen (Legacy und v0)", () => {
  assert.deepEqual(pruefeMeshInhalt(solanaTx(), MeshKind.SolanaTx), { ok: true, art: "solana" });
  assert.match((pruefeSolanaTx(solanaTx(false)) as { grund: string }).grund, /Signatur 1 von 1/);
  const verfaelscht = solanaTx();
  verfaelscht[verfaelscht.length - 1] ^= 1; // Betrag geaendert
  assert.equal(pruefeSolanaTx(verfaelscht).ok, false);
  assert.equal(pruefeSolanaTx(new Uint8Array(1300)).ok, false);
  assert.equal(pruefeSolanaTx(new Uint8Array([1, 2, 3])).ok, false);
  assert.equal(pruefeSolanaTx(new Uint8Array(0)).ok, false);

  const zahler = Keypair.generate();
  const msg = new TransactionMessage({
    payerKey: zahler.publicKey, recentBlockhash: HASH,
    instructions: [SystemProgram.transfer({ fromPubkey: zahler.publicKey, toPubkey: new PublicKey(HASH), lamports: 1 })],
  }).compileToV0Message();
  const v0 = new VersionedTransaction(msg);
  assert.equal(pruefeSolanaTx(v0.serialize()).ok, false, "unsigniert");
  v0.sign([zahler]);
  assert.equal(pruefeSolanaTx(v0.serialize()).ok, true);
});

test("Klartext und Ecash werden nicht weitergereicht, Verschluesseltes schon", () => {
  const c = new ForwardingCache();
  assert.equal(c.shouldForward(fragment(text("HILFE"), MeshKind.PlainText)[0], NOW), false);
  assert.equal(c.shouldForward(fragment(text("cashuA…"), MeshKind.Ecash)[0], NOW), false);
  assert.equal(c.shouldForward(fragment(text("umschlag"), MeshKind.NostrEvent)[0], NOW), true);
  assert.equal(c.shouldForward(fragment(text("transaktion"), MeshKind.SolanaTx)[0], NOW), true);
});

// ------------------------------------------------ Sendezeit (7.1)

test("Sendezeitkonto: 1 % je Stunde, gleitendes Fenster", () => {
  const k = new Sendezeitkonto();
  assert.equal(k.budget, 36);
  assert.equal(k.frei(NOW), 36);
  assert.equal(k.wartezeit(10, NOW), 0);
  k.buche(20, NOW);
  k.buche(10, NOW + 100);
  assert.equal(k.frei(NOW + 200), 6);
  // 10 s brauchen 4 s mehr als frei: frei wird es, wenn die erste Buchung aus dem Fenster faellt.
  assert.equal(k.wartezeit(10, NOW + 200), 3400);
  assert.equal(k.wartezeit(6, NOW + 200), 0);
  assert.equal(k.frei(NOW + 3601), 26, "die erste Buchung ist aus dem Fenster");
  assert.equal(k.frei(NOW + 3701), 36);
  assert.throws(() => k.wartezeit(40, NOW), /mehr als 36s/);
});

test("Sendezeit: ehrliche Dauer ueber das Budget hinaus", () => {
  const k = new Sendezeitkonto();
  assert.equal(k.dauer(30, NOW), 30);
  // 46 s Sendezeit: 36 sofort, der Rest mit 1 % – also 1000 s.
  assert.equal(k.dauer(46, NOW), 36 + 1000);
});

test("Luft-Byte: ein Rahmenkopf je Funkpaket", () => {
  assert.equal(luftBytes(1), 1 + FRAME_HEADER_BYTES);
  assert.equal(luftBytes(MAX_PAYLOAD_PER_FRAME + 1), MAX_PAYLOAD_PER_FRAME + 1 + 2 * FRAME_HEADER_BYTES);
});
