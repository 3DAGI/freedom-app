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
  MeshNode, fileTransport, unpackBundle, detectTransports,
  eventToMesh, meshToEvent, MeshTransport,
} from "../src/mesh-radio.js";
import { MeshKind, MeshPriority, fragment, parseFrame } from "@freedomstack/protocol";

const text = (s: string) => new TextEncoder().encode(s);

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
  const r = n.enqueue(text("x".repeat(600)), MeshKind.NostrEvent, MeshPriority.Nachricht, "Test");
  assert.ok(r.frames > 1);
  await new Promise((res) => setTimeout(res, 200));
  assert.equal(t.gesendet.length, r.frames);
});

test("Kein Rahmen ueberschreitet die Funk-Grenze", async () => {
  const t = fakeTransport();
  const n = node();
  await n.attach(t);
  n.enqueue(text("y".repeat(3000)), MeshKind.NostrEvent, MeshPriority.Nachricht, "gross");
  await new Promise((res) => setTimeout(res, 300));
  for (const f of t.gesendet) assert.ok(f.length <= 200, `Rahmen mit ${f.length} Byte`);
});

test("Zu grosse Nachrichten werden vorher abgelehnt", () => {
  const n = node();
  assert.throws(
    () => n.enqueue(new Uint8Array(200_000), MeshKind.NostrEvent, MeshPriority.Nachricht, "riesig"),
    /zu viel für Funk/,
  );
});

test("Dauer wird ehrlich geschaetzt, nicht als Balken versteckt", () => {
  const n = new MeshNode({ onMessage: () => {} }, 200);
  const r = n.enqueue(text("z".repeat(2000)), MeshKind.NostrEvent, MeshPriority.Nachricht, "Test");
  assert.ok(r.etaSeconds > 5, `${r.etaSeconds}s`);
  assert.ok(r.note.length > 0);
});

test("Abbrechen entfernt die Nachricht", () => {
  const n = node();
  const r = n.enqueue(text("a".repeat(600)), MeshKind.NostrEvent, MeshPriority.Nachricht, "Test");
  assert.equal(n.cancel(r.msgId), true);
  assert.equal(n.pending.length, 0);
});

test("Notfall ueberholt Hintergrund in der Warteschlange", () => {
  const n = node();
  n.enqueue(text("b".repeat(400)), MeshKind.NostrEvent, MeshPriority.Hintergrund, "Bild");
  n.enqueue(text("HILFE"), MeshKind.PlainText, MeshPriority.Notfall, "Notruf");
  assert.equal(n.pending[0].label, "Notruf");
});

// ------------------------------------------------------------- Empfangen

test("Empfangene Rahmen ergeben wieder die Nachricht", async () => {
  const original = text("Treffen um 19 Uhr. " + "x".repeat(500));
  let empfangen: Uint8Array | null = null;
  const n = node((p) => { empfangen = p; });

  for (const f of fragment(original, MeshKind.NostrEvent)) n.receive(f);
  assert.deepEqual(empfangen, original);
});

test("Nostr-Event ueberlebt den Funkweg unveraendert", async () => {
  const ev = { id: "a".repeat(64), kind: 1, content: "Grüße ⚡", sig: "b".repeat(128) };
  let zurueck: unknown = null;
  const n = node((p) => { zurueck = meshToEvent(p); });
  for (const f of fragment(eventToMesh(ev), MeshKind.NostrEvent)) n.receive(f);
  assert.deepEqual(zurueck, ev);
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
  const fremd = fragment(text("fremde nachricht"), MeshKind.PlainText, MeshPriority.Nachricht, 5)[0];
  n.receive(fremd);
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(t.gesendet.length, 1, "das Paket muss weiter");
  assert.equal(parseFrame(t.gesendet[0]).ttl, 4, "mit verringerter Sprungzahl");
});

test("Dasselbe Paket wird nicht zweimal weitergereicht", async () => {
  // Sonst wird aus jeder Nachricht eine Lawine, die den Funkkanal stilllegt.
  const t = fakeTransport();
  const n = node();
  await n.attach(t);
  const f = fragment(text("hallo"), MeshKind.PlainText, MeshPriority.Nachricht, 5)[0];
  n.receive(f);
  n.receive(f);
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(t.gesendet.length, 1);
});

test("Ausgelaufene Sprungzahl wird nicht weitergereicht", async () => {
  const t = fakeTransport();
  const n = node();
  await n.attach(t);
  n.receive(fragment(text("ende"), MeshKind.PlainText, MeshPriority.Nachricht, 1)[0]);
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(t.gesendet.length, 0);
});

// ------------------------------------------------------------- Datei-Weg

test("Datei-Transport buendelt Rahmen und macht sie wieder trennbar", async () => {
  let bundle: Uint8Array | null = null;
  let anzahl = 0;
  const t = fileTransport((d, c) => { bundle = d; anzahl = c; });
  const n = node();
  await n.attach(t);

  n.enqueue(text("q".repeat(600)), MeshKind.NostrEvent, MeshPriority.Nachricht, "Datei");
  await new Promise((res) => setTimeout(res, 200));
  await t.close();

  assert.ok(bundle);
  assert.equal(unpackBundle(bundle!).length, anzahl);
});

test("Datei-Weg und Funk-Weg sind fuer die Schicht darueber gleich", async () => {
  // Das ist der Punkt: "funktioniert ohne Internet" darf nicht bedeuten
  // "funktioniert, wenn du die richtige Hardware gekauft hast".
  const original = text("Nachricht per Stick " + "w".repeat(400));
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
  const meins = Array.from({ length: 5 }, (_, i) => ({
    id: String(i).padEnd(64, "0"), kind: 4, created_at: 1000 + i, content: `n${i}`,
    pubkey: "b".repeat(64), tags: [], sig: "c".repeat(128),
  }));

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

  for (const f of fragment(paket, MeshKind.NostrEvent)) n.receive(f);
  await new Promise((res) => setTimeout(res, 100));

  assert.ok(geplant >= 3, `nur ${geplant} Ereignisse geplant — die Differenz muss erkannt werden`);
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
