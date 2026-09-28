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
  eventToMesh, meshToEvent, MeshTransport, serielleStrecke, bluetoothStrecke, type SerialPortLike, type NusMerkmal,
} from "../src/mesh-radio.js";
import {
  MeshKind, MeshPriority, fragment, parseFrame, Sendezeitkonto, baueNachforderung, leseNachforderung,
  LORA_MTU, LaengenRahmen, mitLaenge,
  buildEvent, buildPrivateDm, generateKeypair, signEvent, type NostrEvent,
} from "@freedomstack/protocol";
import { setLang } from "../src/i18n.js";

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
  setLang("de"); // Grund wörtlich auf Deutsch (seit 8.16g2b3b in der Sprache der Oberfläche)
  try {
    assert.throws(
      () => n.enqueue(umschlag(60_000), MeshKind.NostrEvent, MeshPriority.Nachricht, "riesig"),
      /zu viel für Funk/,
    );
  } finally {
    setLang("en");
  }
  assert.throws(() => n.enqueue(umschlag(60_000), MeshKind.NostrEvent, MeshPriority.Nachricht, "riesig"), /bytes are too much for radio/);
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
  setLang("de"); // Gründe wörtlich auf Deutsch (seit 8.16g2b3a in der Sprache der Oberfläche)
  try {
    assert.throws(() => n.enqueue(text("HILFE am Bahnhof"), MeshKind.PlainText, MeshPriority.Notfall, "x"), /nur Verschlüsseltes/);
    assert.throws(() => n.enqueue(text("cashuAeyJ0b2tlbiI6"), MeshKind.Ecash, MeshPriority.Zahlung, "x"), /nur Verschlüsseltes/);
    assert.throws(() => n.enqueue(offen, MeshKind.NostrEvent, MeshPriority.Nachricht, "x"), /nur Umschläge/);
    assert.throws(() => n.enqueue(text("x".repeat(600)), MeshKind.NostrEvent, MeshPriority.Nachricht, "x"), /Kein Nostr-Event/);
  } finally {
    setLang("en");
  }
  assert.throws(() => n.enqueue(text("HILFE am Bahnhof"), MeshKind.PlainText, MeshPriority.Notfall, "x"), /Only encrypted content goes over mesh/);
  assert.throws(() => n.enqueue(offen, MeshKind.NostrEvent, MeshPriority.Nachricht, "x"), /Only envelopes \(NIP-59\)/);
  assert.equal(n.pending.length, 0);
});

test("Die eigene Kopie einer DM geht nicht ueber Mesh – sie traegt den eigenen Schluessel", async () => {
  const alice = generateKeypair(), bob = generateKeypair();
  const dm = await buildPrivateDm({ senderSk: alice.sk, senderPk: alice.pk, recipientPk: bob.pk, content: "hallo" });
  const n = node();
  n.setEigeneSchluessel([alice.pk]);
  setLang("de");
  try {
    assert.throws(() => n.enqueue(eventToMesh(dm.toSelf), MeshKind.NostrEvent, MeshPriority.Nachricht, "x"), /eigenen Schlüssel/);
  } finally {
    setLang("en");
  }
  assert.throws(() => n.enqueue(eventToMesh(dm.toSelf), MeshKind.NostrEvent, MeshPriority.Nachricht, "x"), /Envelope carries your own key/);
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

// ------------------------------------------------------------- Nachfordern (7.4b)

test("Verlorene Rahmen werden nachgefordert und nachgesendet (7.4b)", async () => {
  const original = umschlag(900);
  const beiB: Uint8Array[] = [];
  const beiA: Uint8Array[] = [];
  const a = node((p) => { beiA.push(p); });
  const b = node((p) => { beiB.push(p); });
  let n = 0;
  // Hin gehen beim ersten Mal die Rahmen 1 und 4 verloren
  await a.attach({ ...fakeTransport(), async send(f) { if (n++ !== 1 && n !== 5) b.receive(f); } });
  await b.attach({ ...fakeTransport(), async send(f) { a.receive(f); } });
  const r = a.enqueue(original, MeshKind.NostrEvent, MeshPriority.Nachricht, "Test");
  assert.ok(r.frames >= 5);
  await new Promise((res) => setTimeout(res, 100));
  assert.equal(beiB.length, 0, "unvollständig");
  assert.equal(b.nachfordern(Math.floor(Date.now() / 1000) + 5), 0, "noch keine Ruhe");

  assert.equal(b.nachfordern(Math.floor(Date.now() / 1000) + 30), 1);
  await new Promise((res) => setTimeout(res, 100));
  assert.equal(beiB.length, 1);
  assert.deepEqual(beiB[0], original);
  assert.equal(n, r.frames + 2, "genau die zwei fehlenden nachgesendet");
  assert.ok(beiA.every((p) => p.length !== 37), "die Nachforderung ist keine Nachricht");
  assert.equal(b.nachfordern(Math.floor(Date.now() / 1000) + 999), 0, "nichts mehr offen");
  await a.detach();
  await b.detach();
});

test("Nachgesendet wird nur Eigenes und höchstens zweimal – Fremdes geht weiter (7.4b)", async () => {
  const t = fakeTransport();
  const n = node();
  await n.attach(t);
  const r = n.enqueue(umschlag(600), MeshKind.NostrEvent, MeshPriority.Nachricht, "Test");
  // Gesendet wird im Takt (je Rahmen eine Pause): erst zählen, wenn alle draußen
  // sind – nach festen 50 ms fehlten bei voller Last Rahmen, die dann als
  // „nachgesendet“ zählten (10 statt 8, gesehen in 11.1b)
  const bis = async (anzahl: number) => { for (let i = 0; i < 200 && t.gesendet.length < anzahl; i++) await new Promise((res) => setTimeout(res, 10)); };
  await bis(r.frames);
  const vorher = t.gesendet.length;
  assert.equal(vorher, r.frames);
  const fordere = (msgId: string, fehlend: number[]) => {
    for (const f of fragment(baueNachforderung(msgId, fehlend), MeshKind.NostrEvent, MeshPriority.Nachricht, 5)) n.receive(f);
  };
  fordere(r.msgId, [0]);
  fordere(r.msgId, [1, 2]);
  fordere(r.msgId, [0, 1, 2]);
  await bis(vorher + 3);
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(t.gesendet.length, vorher + 3, "zweimal nachgesendet, dann nicht mehr");
  assert.ok(t.gesendet.slice(vorher).every((f) => parseFrame(f).msgId === r.msgId));

  fordere("ffffffff", [0]);
  await bis(vorher + 4);
  const weiter = t.gesendet.slice(vorher + 3);
  assert.equal(weiter.length, 1, "unbekannt: die Nachforderung selbst geht weiter");
  assert.deepEqual(leseNachforderung(parseFrame(weiter[0]).data), { msgId: "ffffffff", fehlend: [0] });
  assert.equal(parseFrame(weiter[0]).ttl, 4);

  // Ohne Gerät keine Nachforderung
  const ohne = node();
  for (const f of fragment(umschlag(600), MeshKind.NostrEvent).slice(1)) ohne.receive(f, 1000);
  assert.equal(ohne.nachfordern(2000), 0);
  await n.detach();
});

// ------------------------------------------------ Geräte-Strecken (7.4c1)

/** Port wie Web Serial: schreibt mit, liefert vorgegebene Häppchen. */
function fakePort(haeppchen: Uint8Array[]) {
  const geschrieben: Uint8Array[] = [];
  let abgebrochen = false;
  const port: SerialPortLike & { geschrieben: Uint8Array[]; abgebrochen: () => boolean } = {
    geschrieben, abgebrochen: () => abgebrochen,
    async open() { /* offen */ },
    async close() { /* zu */ },
    writable: { getWriter: () => ({ async write(d: Uint8Array) { geschrieben.push(d); }, releaseLock() { /* frei */ } }) },
    readable: {
      getReader: () => ({
        async read() {
          await new Promise((r) => setTimeout(r, 1));
          const value = haeppchen.shift();
          return value ? { value, done: false } : { done: true };
        },
        async cancel() { abgebrochen = true; },
        releaseLock() { /* frei */ },
      }),
    },
  };
  return port;
}

/** Strom in ungleiche Häppchen zerlegen – Grenzen mitten im Längenfeld und im Rahmen. */
function zerstueckle(strom: Uint8Array, groessen = [1, 7, 150, 3, 90]): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let off = 0, i = 0; off < strom.length; i++) {
    const n = groessen[i % groessen.length];
    out.push(strom.subarray(off, off + n));
    off += n;
  }
  return out;
}

test("USB: Rahmen mit Längenpräfix hin und zurück – die App liest jetzt auch (7.4c1)", async () => {
  const original = umschlag(700);
  const rahmen = fragment(original, MeshKind.NostrEvent);
  const strom = Uint8Array.from(rahmen.flatMap((f) => [...mitLaenge(f)]));
  const port = fakePort(zerstueckle(strom));
  let empfangen: Uint8Array | null = null;
  const n = node((p) => { empfangen = p; });
  const tr = serielleStrecke(port, (raw) => n.receive(raw));
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(empfangen, original, "aus dem Strom zusammengesetzt");

  await tr.send(rahmen[0]);
  assert.deepEqual(port.geschrieben, [mitLaenge(rahmen[0])], "gesendet mit Länge vorn");
  await assert.rejects(tr.send(new Uint8Array(LORA_MTU + 1)));
  await tr.close();
  assert.ok(port.abgebrochen(), "Lesen beim Trennen beendet");
  // Ohne Empfänger wird nicht gelesen (wie bisher für reine Sender)
  const still = fakePort([strom]);
  serielleStrecke(still);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(still.abgebrochen(), false);
});

test("Bluetooth: Häppchen ergeben wieder Rahmen, gesendet in Häppchen mit Länge (7.4c1)", async () => {
  const original = umschlag(700);
  const rahmen = fragment(original, MeshKind.NostrEvent);
  assert.ok(rahmen[0].length > 180, "ein Rahmen passt nicht in ein BLE-Häppchen");
  const hoerer: ((e: Event) => void)[] = [];
  const geschrieben: Uint8Array[] = [];
  const merkmal = (): NusMerkmal => ({
    async writeValueWithoutResponse(d) { geschrieben.push(d.slice()); },
    async startNotifications() { /* an */ },
    addEventListener(_t, f) { hoerer.push(f); },
  });
  let empfangen: Uint8Array | null = null;
  let getrennt = false;
  const n = node((p) => { empfangen = p; });
  const tr = await bluetoothStrecke(merkmal(), merkmal(), "Test", () => { getrennt = true; }, (raw) => n.receive(raw));
  const strom = Uint8Array.from(rahmen.flatMap((f) => [...mitLaenge(f)]));
  for (const h of zerstueckle(strom, [20, 180, 5])) {
    for (const f of hoerer) f({ target: { value: new DataView(h.buffer, h.byteOffset, h.byteLength) } } as unknown as Event);
  }
  assert.deepEqual(empfangen, original);

  await tr.send(rahmen[0]);
  assert.ok(geschrieben.length >= 2 && geschrieben.every((g) => g.length <= 180));
  assert.deepEqual(new LaengenRahmen().push(Uint8Array.from(geschrieben.flatMap((g) => [...g]))), [rahmen[0]]);
  await tr.close();
  assert.ok(getrennt);
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
