/**
 * Tests fuer die Funk-Anbindung.
 *
 * Der Schwerpunkt liegt auf dem, was im Feld schiefgeht: ein Geraet, das
 * zugeschuettet wird und Pakete still verwirft; ein Knoten, der nichts
 * weiterreicht und damit die Reichweite eines einzelnen Geraets hat; und der
 * Fall, dass gar kein Funkgeraet vorhanden ist.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MeshNode, fileTransport, packBundle, unpackBundle, detectTransports,
  eventToMesh, meshToEvent, MeshTransport,
} from "../src/mesh-radio.js";
import {
  MeshKind, MeshPriority, fragment, parseFrame, Sendezeitkonto,
  buildEvent, buildPrivateDm, generateKeypair, signEvent, type NostrEvent,
} from "@freedomstack/protocol";

const text = (s: string) => new TextEncoder().encode(s);

/**
 * Umschlag in der Form von NIP-59 (Wegwerf-Autor, Inhalt wie NIP-44 v2) –
 * seit 7.1 das Einzige, was ueber Mesh geht. `bytes` steuert die Groesse.
 */
function umschlagEvent(bytes = 400, at = 1000): NostrEvent {
  const w = generateKeypair();
  const inhalt = Buffer.from([2, ...crypto.getRandomValues(new Uint8Array(bytes))]).toString("base64");
  return signEvent(buildEvent(w.pk, 1059, [["p", generateKeypair().pk]], inhalt, at), w.sk);
}
const umschlag = (bytes = 400) => eventToMesh(umschlagEvent(bytes));

/**
 * Transport, der alles mitschreibt statt zu senden.
 *
 * Die Art bestimmt den Durchsatz — `attach()` leitet ihn daraus ab, weil im
 * Betrieb die Strecke entscheidet und nicht der Aufrufer. Fuer Tests, die
 * nicht auf Funkgeschwindigkeit warten sollen, "datei".
 */
function fakeTransport(kind: "seriell" | "bluetooth" | "datei" = "datei"):
  MeshTransport & { gesendet: Uint8Array[] } {
  const gesendet: Uint8Array[] = [];
  return {
    kind, name: "Test", gesendet,
    async send(f) { gesendet.push(f); },
    async close() { /* nichts */ },
  };
}

function node(onMessage: (p: Uint8Array, k: MeshKind) => void = () => {}) {
  return new MeshNode({ onMessage }, 100_000); // schnell, damit Tests nicht warten
}

// ------------------------------------------------------------- Senden

test("Nachricht wird zerlegt gesendet", async () => {
  const t = fakeTransport();
  const n = node();
  await n.attach(t);
  const r = n.enqueue(umschlag(600), MeshKind.NostrEvent, MeshPriority.Nachricht, "Test");
  assert.ok(r.frames > 1);
  await new Promise((res) => setTimeout(res, 200));
  assert.equal(t.gesendet.length, r.frames);
});

test("Kein Rahmen ueberschreitet die Funk-Grenze", async () => {
  const t = fakeTransport();
  const n = node();
  await n.attach(t);
  n.enqueue(umschlag(3000), MeshKind.NostrEvent, MeshPriority.Nachricht, "gross");
  await new Promise((res) => setTimeout(res, 300));
  for (const f of t.gesendet) assert.ok(f.length <= 200, `Rahmen mit ${f.length} Byte`);
});

test("Zu grosse Nachrichten werden vorher abgelehnt", () => {
  const n = node();
  assert.throws(
    () => n.enqueue(umschlag(60_000), MeshKind.NostrEvent, MeshPriority.Nachricht, "riesig"),
    /zu viel für Funk/,
  );
});

test("Dauer wird ehrlich geschaetzt, nicht als Balken versteckt", () => {
  const n = new MeshNode({ onMessage: () => {} }, 200);
  const r = n.enqueue(umschlag(2000), MeshKind.NostrEvent, MeshPriority.Nachricht, "Test");
  assert.ok(r.etaSeconds > 5, `${r.etaSeconds}s`);
  assert.ok(r.note.length > 0);
});

test("Abbrechen entfernt die Nachricht", () => {
  const n = node();
  const r = n.enqueue(umschlag(600), MeshKind.NostrEvent, MeshPriority.Nachricht, "Test");
  assert.equal(n.cancel(r.msgId), true);
  assert.equal(n.pending.length, 0);
});

test("Notfall ueberholt Hintergrund in der Warteschlange", () => {
  const n = node();
  n.enqueue(umschlag(400), MeshKind.NostrEvent, MeshPriority.Hintergrund, "Bild");
  n.enqueue(umschlag(100), MeshKind.NostrEvent, MeshPriority.Notfall, "Notruf");
  assert.equal(n.pending[0].label, "Notruf");
});

// --------------------------------------------- Nur verschluesselt (7.1)

test("Klartext, offene Events und Ecash werden nicht gesendet", () => {
  const n = node();
  const kp = generateKeypair();
  const offen = eventToMesh(signEvent(buildEvent(kp.pk, 1, [], "Treffen um 19 Uhr"), kp.sk));
  assert.throws(() => n.enqueue(text("HILFE am Bahnhof"), MeshKind.PlainText, MeshPriority.Notfall, "x"), /nur Verschlüsseltes/);
  assert.throws(() => n.enqueue(text("cashuAeyJ0b2tlbiI6"), MeshKind.Ecash, MeshPriority.Zahlung, "x"), /nur Verschlüsseltes/);
  assert.throws(() => n.enqueue(offen, MeshKind.NostrEvent, MeshPriority.Nachricht, "x"), /nur Umschläge/);
  assert.throws(() => n.enqueue(text("x".repeat(600)), MeshKind.NostrEvent, MeshPriority.Nachricht, "x"), /Kein Nostr-Event/);
  assert.equal(n.pending.length, 0);
});

test("Die eigene Kopie einer DM geht nicht ueber Mesh – sie traegt den eigenen Schluessel", async () => {
  const alice = generateKeypair(), bob = generateKeypair();
  const dm = await buildPrivateDm({ senderSk: alice.sk, senderPk: alice.pk, recipientPk: bob.pk, content: "hallo" });
  const n = node();
  n.setEigeneSchluessel([alice.pk]);
  assert.throws(() => n.enqueue(eventToMesh(dm.toSelf), MeshKind.NostrEvent, MeshPriority.Nachricht, "x"), /eigenen Schlüssel/);
  assert.ok(n.enqueue(eventToMesh(dm.toRecipient), MeshKind.NostrEvent, MeshPriority.Nachricht, "an Bob").frames > 1);
});

test("Ueber Funk haelt der Knoten die Sendezeit ein (1 % je Stunde)", async () => {
  // Fenster 150 s statt einer Stunde: Budget 1,5 s – nach einem Rahmen (1 s) ist Schluss.
  const t = fakeTransport("seriell");
  const warten: number[] = [];
  const n = new MeshNode({ onMessage: () => {}, onProgress: (i) => { if (i.wartetSekunden) warten.push(i.wartetSekunden); } },
    200, new Sendezeitkonto(0.01, 150));
  await n.attach(t);
  const r = n.enqueue(umschlag(300), MeshKind.NostrEvent, MeshPriority.Nachricht, "Test");
  assert.ok(r.frames >= 3);
  assert.ok(r.etaSeconds > 100, `ehrliche Dauer mit Sendezeit-Grenze: ${r.etaSeconds}s`);
  await new Promise((res) => setTimeout(res, 1300));
  assert.equal(t.gesendet.length, 1, "danach schweigt das Geraet");
  assert.ok(warten.length > 0 && warten[0] > 100, `gemeldete Wartezeit: ${warten[0]}s`);
  await n.detach();
});

test("Ein Funkgeraet per Bluetooth zaehlt als Funk – mit derselben Sendezeit", async () => {
  const n = new MeshNode({ onMessage: () => {} }, 200, new Sendezeitkonto(0.01, 150));
  await n.attach(fakeTransport("bluetooth"));
  const r = n.enqueue(umschlag(300), MeshKind.NostrEvent, MeshPriority.Nachricht, "Test");
  assert.ok(r.etaSeconds > 100, `${r.etaSeconds}s`);
  await n.detach();
});

// ------------------------------------------------------------- Empfangen

test("Empfangene Rahmen ergeben wieder die Nachricht", async () => {
  const original = umschlag(500);
  let empfangen: Uint8Array | null = null;
  const n = node((p) => { empfangen = p; });

  for (const f of fragment(original, MeshKind.NostrEvent)) n.receive(f);
  assert.deepEqual(empfangen, original);
});

test("Nostr-Event ueberlebt den Funkweg unveraendert", async () => {
  const alice = generateKeypair(), bob = generateKeypair();
  const ev = (await buildPrivateDm({ senderSk: alice.sk, senderPk: alice.pk, recipientPk: bob.pk, content: "Grüße ⚡" })).toRecipient;
  let zurueck: unknown = null;
  const n = node((p) => { zurueck = meshToEvent(p); });
  for (const f of fragment(eventToMesh(ev), MeshKind.NostrEvent)) n.receive(f);
  assert.deepEqual(zurueck, ev);
});

test("Klartext und offene Events kommen beim Empfang nicht an (7.1)", () => {
  let empfangen = 0;
  const n = node(() => { empfangen++; });
  const kp = generateKeypair();
  const offen = eventToMesh(signEvent(buildEvent(kp.pk, 4, [["p", generateKeypair().pk]], "Treffen um 19 Uhr"), kp.sk));
  for (const f of fragment(offen, MeshKind.NostrEvent)) n.receive(f);
  for (const f of fragment(text("HILFE am Bahnhof"), MeshKind.PlainText)) n.receive(f);
  for (const f of fragment(text("cashuAeyJ0b2tlbiI6"), MeshKind.Ecash)) n.receive(f);
  assert.equal(empfangen, 0);
});

test("Kaputte Rahmen werden verworfen, nicht durchgereicht", () => {
  let empfangen = 0;
  const n = node(() => { empfangen++; });
  n.receive(new Uint8Array(3));
  n.receive(new Uint8Array(50).fill(255));
  assert.equal(empfangen, 0);
});

// ------------------------------------------------------------- Weitergabe

test("Knoten reicht fremde Pakete weiter — sonst waere das Netz ein Geraet", async () => {
  const t = fakeTransport();
  const n = node();
  await n.attach(t);
  const fremd = fragment(umschlag(300), MeshKind.NostrEvent, MeshPriority.Nachricht, 5);
  for (const f of fremd) n.receive(f);
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(t.gesendet.length, fremd.length, "die Nachricht muss weiter");
  assert.ok(t.gesendet.every((f) => parseFrame(f).ttl === 4), "mit verringerter Sprungzahl");
});

test("Dasselbe Paket wird nicht zweimal weitergereicht", async () => {
  // Sonst wird aus jeder Nachricht eine Lawine, die den Funkkanal stilllegt.
  const t = fakeTransport();
  const n = node();
  await n.attach(t);
  const fremd = fragment(umschlag(300), MeshKind.NostrEvent, MeshPriority.Nachricht, 5);
  for (const f of fremd) n.receive(f);
  for (const f of [...fremd].reverse()) n.receive(f);
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(t.gesendet.length, fremd.length);
});

test("Ausgelaufene Sprungzahl wird nicht weitergereicht", async () => {
  const t = fakeTransport();
  const n = node();
  await n.attach(t);
  for (const f of fragment(umschlag(), MeshKind.NostrEvent, MeshPriority.Nachricht, 1)) n.receive(f);
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(t.gesendet.length, 0);
});

test("Weitergereicht wird nur Geprueftes – kein fremder Klartext, keine Post an mich (7.1)", async () => {
  const t = fakeTransport();
  const ich = generateKeypair();
  const n = node();
  n.setEigeneSchluessel([ich.pk]);
  await n.attach(t);
  const kp = generateKeypair();
  const offen = eventToMesh(signEvent(buildEvent(kp.pk, 1, [], "Treffen um 19 Uhr"), kp.sk));
  for (const f of fragment(offen, MeshKind.NostrEvent, MeshPriority.Nachricht, 5)) n.receive(f);
  for (const f of fragment(text("x".repeat(500)), MeshKind.NostrEvent, MeshPriority.Nachricht, 5)) n.receive(f);
  // Ein Umschlag an mich: kommt an, geht aber nicht ueber mein Funkgeraet weiter.
  let an = 0;
  const empfaenger = new MeshNode({ onMessage: () => { an++; } }, 100_000);
  empfaenger.setEigeneSchluessel([ich.pk]);
  const t2 = fakeTransport();
  await empfaenger.attach(t2);
  const dm = await buildPrivateDm({ senderSk: kp.sk, senderPk: kp.pk, recipientPk: ich.pk, content: "hallo" });
  for (const f of fragment(eventToMesh(dm.toRecipient), MeshKind.NostrEvent, MeshPriority.Nachricht, 5)) empfaenger.receive(f);
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(t.gesendet.length, 0, "fremder Klartext geht nicht über mein Gerät");
  assert.equal(an, 1, "die Post an mich kommt an");
  assert.equal(t2.gesendet.length, 0, "und wird nicht mit meinem Schlüssel weitergefunkt");
});

// ------------------------------------------------------------- Datei-Weg

test("Datei-Transport buendelt Rahmen und macht sie wieder trennbar", async () => {
  let bundle: Uint8Array | null = null;
  let anzahl = 0;
  const t = fileTransport((d, c) => { bundle = d; anzahl = c; });
  const n = node();
  await n.attach(t);

  n.enqueue(umschlag(600), MeshKind.NostrEvent, MeshPriority.Nachricht, "Datei");
  await new Promise((res) => setTimeout(res, 200));
  await t.close();

  assert.ok(bundle);
  assert.equal(unpackBundle(bundle!).length, anzahl);
});

test("Datei-Weg und Funk-Weg sind fuer die Schicht darueber gleich", async () => {
  // Das ist der Punkt: "funktioniert ohne Internet" darf nicht bedeuten
  // "funktioniert, wenn du die richtige Hardware gekauft hast".
  const original = umschlag(400);
  let bundle: Uint8Array | null = null;
  const t = fileTransport((d) => { bundle = d; });
  const sender = node();
  await sender.attach(t);
  sender.enqueue(original, MeshKind.NostrEvent, MeshPriority.Nachricht, "Test");
  await new Promise((res) => setTimeout(res, 200));
  await t.close();

  let empfangen: Uint8Array | null = null;
  const empfaenger = node((p) => { empfangen = p; });
  empfaenger.receiveBundle(bundle!);
  assert.deepEqual(empfangen, original);
});

test("Buendel aus Rahmen: packBundle und unpackBundle passen zusammen (7.2: SOL als Datei)", () => {
  const frames = fragment(umschlag(600), MeshKind.NostrEvent);
  assert.deepEqual(unpackBundle(packBundle(frames)), frames);
});

test("Beschaedigtes Buendel bricht den Import nicht ab", () => {
  const n = node();
  assert.doesNotThrow(() => n.receiveBundle(new Uint8Array([0, 5, 1, 2])));
  assert.doesNotThrow(() => n.receiveBundle(new Uint8Array(0)));
});

// ------------------------------------------------------------- Geraete

test("Ohne Geraetezugriff wird der Datei-Weg empfohlen, nicht aufgegeben", () => {
  // Das ist der haeufigste Fall: iOS im Browser kann weder Serial noch
  // Bluetooth. "Geht nicht" waere hier die falsche Antwort.
  const t = detectTransports({});
  assert.equal(t.recommendation, "datei");
  assert.match(t.note, /iOS/);
});

test("Verfuegbare Geraetewege werden bevorzugt", () => {
  assert.equal(detectTransports({ serial: {}, bluetooth: {} }).recommendation, "seriell");
  assert.equal(detectTransports({ bluetooth: {} }).recommendation, "bluetooth");
});


// ------------------------------------------------------ Bestandsabgleich

test("Beim Verbinden wird der eigene Bestand angeboten", async () => {
  // Ohne das passiert bei einem Treffen NICHTS, bis jemand von Hand etwas
  // sendet — genau der Zustand, in dem die Funktion behauptet wurde, aber
  // nichts tat.
  const t = fakeTransport();
  const n = node();
  n.setEventSource(() => [{ id: "a".repeat(64), kind: 4, created_at: 1, content: "x",
    pubkey: "b".repeat(64), tags: [], sig: "c".repeat(128) }] as never);
  await n.attach(t);
  await new Promise((res) => setTimeout(res, 150));
  assert.ok(t.gesendet.length > 0, "der Bestand muss ohne Zutun raus");
});

test("Ohne Bestandsquelle wird nichts angeboten", async () => {
  const t = fakeTransport();
  const n = node();
  await n.attach(t);
  await new Promise((res) => setTimeout(res, 100));
  assert.equal(t.gesendet.length, 0);
});

test("Ein fremder Bestand loest den Abgleich aus", async () => {
  const { buildDigest } = await import("@freedomstack/protocol");
  // Seit 7.1 gleicht der Abgleich nur Umschlaege ab.
  const meins = Array.from({ length: 5 }, (_, i) => umschlagEvent(200, 1000 + i));

  const t = fakeTransport();
  let geplant = 0;
  const n = new MeshNode({ onMessage: () => {}, onSyncPlan: (anzahl) => { geplant = anzahl; } }, 100_000);
  n.setEventSource(() => meins as never);
  await n.attach(t);
  await new Promise((res) => setTimeout(res, 100));

  // Gegenseite hat nur das erste Ereignis.
  const fremd = buildDigest([meins[0]] as never);
  const paket = new Uint8Array(5 + fremd.bits.length);
  paket[0] = 0x44;
  new DataView(paket.buffer).setUint32(1, fremd.count, false);
  paket.set(fremd.bits, 5);

  const vorher = t.gesendet.length;
  for (const f of fragment(paket, MeshKind.NostrEvent)) n.receive(f);
  await new Promise((res) => setTimeout(res, 100));

  assert.ok(geplant >= 3, `nur ${geplant} Ereignisse geplant — die Differenz muss erkannt werden`);
  assert.ok(t.gesendet.length - vorher >= 3 * 2, "die Umschläge gehen auch wirklich raus");
});

test("Eine Bestandsmeldung wird nicht als Nachricht angezeigt", async () => {
  // Sonst saehe der Nutzer bei jedem Treffen eine unlesbare "Nachricht".
  let alsNachricht = 0;
  const n = new MeshNode({ onMessage: () => { alsNachricht++; } }, 100_000);
  n.setEventSource(() => []);
  const paket = new Uint8Array(5 + 1024);
  paket[0] = 0x44;
  for (const f of fragment(paket, MeshKind.NostrEvent)) n.receive(f);
  assert.equal(alsNachricht, 0);
});
