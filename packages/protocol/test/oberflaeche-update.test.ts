/**
 * Neue Oberfläche prüfen (6.1a2): Nur was k vertraute Signierer bestätigen,
 * nur neuer als die laufende Fassung, nur Quellen über https – und eine
 * heruntergeladene Datei nur, wenn Größe und Prüfsumme stimmen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, type NostrEvent } from "../src/event.js";
import { buildReleaseManifest, hashText } from "../src/release.js";
import { OBERFLAECHE_DATEI, UPDATE_GRENZEN, pruefeDatei, suchUpdate } from "../src/oberflaeche-update.js";

const A = generateKeypair();
const B = generateKeypair();
const C = generateKeypair();
const FREMD = generateKeypair();
const VERTRAUT = [A.pk, B.pk, C.pk];

const ALT = "<!doctype html><p>Fassung 1</p>";
const NEU = "<!doctype html><p>Fassung 2</p>";
const SW = "self.addEventListener('push', () => {});";

function manifest(kp: { pk: string; sk: Uint8Array }, inhalt: string, o: { version?: string; releasedAt?: number; quellen?: string[]; createdAt?: number; mitSw?: boolean } = {}): NostrEvent {
  const artifacts = [{ name: OBERFLAECHE_DATEI, sha256: hashText(inhalt), sizeBytes: new TextEncoder().encode(inhalt).length }];
  if (o.mitSw ?? true) artifacts.push({ name: "freedom-sw.js", sha256: hashText(SW), sizeBytes: SW.length });
  return signEvent(buildReleaseManifest({
    version: o.version ?? "1.0.0",
    releasedAt: o.releasedAt ?? 1000,
    artifacts,
    sources: o.quellen ?? ["https://3dagi.github.io/freedom-app/freedom.html", "ipfs://bafy", "magnet:?xt=urn:btih:abc"],
  }, kp.pk, o.createdAt ?? 1_700_000_000), kp.sk);
}

const laufendAlt = { sha256: hashText(ALT) };

test("6.1a2: zwei vertraute Signierer bestätigen eine neuere Fassung – Angebot mit beiden Belegen", () => {
  const evs = [
    manifest(A, ALT, { version: "1.0.0", releasedAt: 1000 }), manifest(B, ALT, { version: "1.0.0", releasedAt: 1000 }),
    manifest(A, NEU, { version: "1.1.0", releasedAt: 2000 }), manifest(B, NEU, { version: "1.1.0", releasedAt: 2000 }),
  ];
  const r = suchUpdate(evs, VERTRAUT, laufendAlt);
  assert.ok("angebot" in r, JSON.stringify(r));
  assert.equal(r.angebot.version, "1.1.0");
  assert.equal(r.angebot.sha256, hashText(NEU));
  assert.equal(r.angebot.sizeBytes, new TextEncoder().encode(NEU).length);
  assert.equal(r.angebot.releasedAt, 2000);
  assert.deepEqual(r.angebot.belege.map((e) => e.pubkey), [A.pk, B.pk].sort());
  assert.deepEqual(r.angebot.quellen, ["https://3dagi.github.io/freedom-app/freedom.html"], "nur https – ipfs und magnet lädt das Webview nicht");
});

test("6.1a2: ein Signierer allein reicht nie – auch nicht mit vielen Manifesten", () => {
  const evs = [manifest(A, NEU, { version: "2.0.0", releasedAt: 5000 }), manifest(A, NEU, { version: "2.0.0", releasedAt: 5000, createdAt: 1_700_000_100 })];
  const r = suchUpdate(evs, VERTRAUT, laufendAlt);
  assert.deepEqual(r, { fall: "zu-wenig", noetig: 2, bestaetigt: 1 });
});

test("6.1a2: fremde Signierer zählen nicht – auch nicht als zweite Stimme", () => {
  const evs = [manifest(A, NEU, { version: "2.0.0" }), manifest(FREMD, NEU, { version: "2.0.0" })];
  assert.deepEqual(suchUpdate(evs, VERTRAUT, laufendAlt), { fall: "zu-wenig", noetig: 2, bestaetigt: 1 });
  assert.deepEqual(suchUpdate([manifest(FREMD, NEU), manifest(generateKeypair(), NEU)], VERTRAUT, laufendAlt), { fall: "kein-manifest", noetig: 2 });
  assert.deepEqual(suchUpdate([], [], laufendAlt), { fall: "kein-manifest", noetig: 2 });
});

test("6.1a2: eine gefälschte Signatur zählt nicht – geänderte Prüfsumme nach dem Signieren", () => {
  const echt = manifest(B, NEU, { version: "2.0.0" });
  const boese = hashText("<!doctype html><script>steal()</script>");
  const gefaelscht = { ...echt, tags: echt.tags.map((t) => (t[0] === "artifact" && t[1] === OBERFLAECHE_DATEI ? [t[0], t[1], boese, t[3]!] : t)) };
  const r = suchUpdate([manifest(A, NEU, { version: "2.0.0" }), gefaelscht], VERTRAUT, laufendAlt);
  assert.deepEqual(r, { fall: "zu-wenig", noetig: 2, bestaetigt: 1 });
  // Ebenso: das Manifest eines anderen mit fremdem Schlüssel als Autor ausgegeben
  const untergeschoben = { ...manifest(FREMD, NEU, { version: "2.0.0" }), pubkey: B.pk };
  assert.deepEqual(suchUpdate([manifest(A, NEU, { version: "2.0.0" }), untergeschoben], VERTRAUT, laufendAlt), { fall: "zu-wenig", noetig: 2, bestaetigt: 1 });
});

test("6.1a2: uneinige Signierer – andere Datei oder andere Version – bestätigen nichts", () => {
  const andereDatei = [manifest(A, NEU, { version: "2.0.0" }), manifest(B, NEU + " ", { version: "2.0.0" })];
  assert.deepEqual(suchUpdate(andereDatei, VERTRAUT, laufendAlt), { fall: "zu-wenig", noetig: 2, bestaetigt: 1 });
  const andereVersion = [manifest(A, NEU, { version: "2.0.0" }), manifest(B, NEU, { version: "2.0.1" })];
  assert.deepEqual(suchUpdate(andereVersion, VERTRAUT, laufendAlt), { fall: "zu-wenig", noetig: 2, bestaetigt: 1 });
  const ohneWorker = [manifest(A, NEU, { version: "2.0.0" }), manifest(B, NEU, { version: "2.0.0", mitSw: false })];
  assert.deepEqual(suchUpdate(ohneWorker, VERTRAUT, laufendAlt), { fall: "zu-wenig", noetig: 2, bestaetigt: 1 }, "alle Dateien gehören zur Version");
});

test("6.1a2: Quellen und Notizen dürfen je Signierer abweichen – die Quellen werden zusammengeführt", () => {
  const evs = [
    manifest(A, NEU, { version: "2.0.0", quellen: ["https://a.example.org/freedom.html"] }),
    manifest(B, NEU, { version: "2.0.0", quellen: ["https://b.example.org/freedom.html", "https://nutzer:pw@c.example.org/x", "http://d.example.org/x"] }),
  ];
  const r = suchUpdate(evs, VERTRAUT, laufendAlt);
  assert.ok("angebot" in r);
  assert.deepEqual(r.angebot.quellen, ["https://a.example.org/freedom.html", "https://b.example.org/freedom.html"], "keine Zugangsdaten, kein http");
});

test("6.1a2: läuft schon die neueste, gibt es nichts", () => {
  const evs = [manifest(A, NEU, { version: "2.0.0" }), manifest(B, NEU, { version: "2.0.0" })];
  assert.deepEqual(suchUpdate(evs, VERTRAUT, { sha256: hashText(NEU).toUpperCase() }), { fall: "aktuell", noetig: 2, bestaetigt: 2 });
});

test("6.1a2: nie eine ältere – weder gegen die bestätigte laufende noch gegen das Datum der Hülle", () => {
  const evs = [
    manifest(A, NEU, { version: "2.0.0", releasedAt: 3000 }), manifest(B, NEU, { version: "2.0.0", releasedAt: 3000 }),
    manifest(A, ALT, { version: "1.0.0", releasedAt: 1000 }), manifest(B, ALT, { version: "1.0.0", releasedAt: 1000 }),
  ];
  // Ein Relay zeigt nur die alte Fassung – die laufende neue bleibt
  assert.deepEqual(suchUpdate(evs.slice(2), VERTRAUT, { sha256: hashText(NEU), releasedAt: 3000 }), { fall: "aktuell", noetig: 2, bestaetigt: 2 });
  // Die laufende ist eine unbestätigte Datei, die Hülle kennt aber ihr Datum
  assert.deepEqual(suchUpdate(evs.slice(2), VERTRAUT, { sha256: hashText("<p>eigener Bau</p>"), releasedAt: 1500 }), { fall: "aktuell", noetig: 2, bestaetigt: 2 });
  // Ohne Datum und unbestätigt: die neueste bestätigte wird angeboten
  const r = suchUpdate(evs, VERTRAUT, { sha256: hashText("<p>eigener Bau</p>") });
  assert.ok("angebot" in r && r.angebot.version === "2.0.0");
});

test("6.1a2: der Zeitpunkt einer Version ist der früheste der Signierer", () => {
  const evs = [
    manifest(A, ALT, { version: "1.0.0", releasedAt: 1000 }), manifest(B, ALT, { version: "1.0.0", releasedAt: 1000 }),
    // A behauptet ein spätes Datum für 1.1.0, B ein frühes – die Version gilt als früh
    manifest(A, NEU, { version: "1.1.0", releasedAt: 9000 }), manifest(B, NEU, { version: "1.1.0", releasedAt: 900 }),
  ];
  const r = suchUpdate(evs, VERTRAUT, { sha256: hashText(ALT) });
  assert.deepEqual(r, { fall: "aktuell", noetig: 2, bestaetigt: 2 }, "1.1.0 gilt als älter als die laufende 1.0.0");
});

test("6.1a2: je Signierer das neueste Manifest einer Version – ein Signierer zählt einmal", () => {
  const evs = [
    manifest(A, NEU, { version: "2.0.0", quellen: ["https://alt.example.org/f"], createdAt: 1_700_000_000 }),
    manifest(A, NEU, { version: "2.0.0", quellen: ["https://neu.example.org/f"], createdAt: 1_700_000_500 }),
    manifest(B, NEU, { version: "2.0.0", quellen: [] }),
  ];
  const r = suchUpdate(evs, VERTRAUT, laufendAlt);
  assert.ok("angebot" in r);
  assert.equal(r.angebot.belege.length, 2);
  assert.deepEqual(r.angebot.quellen, ["https://neu.example.org/f"]);
});

test("6.1a2: kaputte Angaben zählen nicht – Version, Dateiname, Größe, fehlende Oberfläche", () => {
  const roh = (kp: typeof A, tags: string[][]) => signEvent({ kind: 38054, pubkey: kp.pk, created_at: 1_700_000_000, tags, content: "" }, kp.sk);
  const gut = (v: string) => [["d", `release:${v}`], ["version", v], ["released_at", "2000"], ["artifact", OBERFLAECHE_DATEI, hashText(NEU), "30"]];
  for (const [name, tags] of [
    ["Version mit Leerzeichen", [["version", "2.0 boese"], ["released_at", "2000"], ["artifact", OBERFLAECHE_DATEI, hashText(NEU), "30"]]],
    ["Version zu lang", [["version", "1".repeat(40)], ["released_at", "2000"], ["artifact", OBERFLAECHE_DATEI, hashText(NEU), "30"]]],
    ["Dateiname mit Pfad", [...gut("2.0.0"), ["artifact", "../freedom.html", hashText(NEU), "30"]]],
    ["Größe 0", [["version", "2.0.0"], ["released_at", "2000"], ["artifact", OBERFLAECHE_DATEI, hashText(NEU), "0"]]],
    ["zu groß", [["version", "2.0.0"], ["released_at", "2000"], ["artifact", OBERFLAECHE_DATEI, hashText(NEU), String(UPDATE_GRENZEN.bytes + 1)]]],
    ["ohne freedom.html", [["version", "2.0.0"], ["released_at", "2000"], ["artifact", "freedom-sw.js", hashText(SW), "10"]]],
    ["Datei doppelt", [...gut("2.0.0"), ["artifact", OBERFLAECHE_DATEI, hashText(NEU), "30"]]],
  ] as const) {
    const r = suchUpdate([roh(A, tags as unknown as string[][]), roh(B, tags as unknown as string[][])], VERTRAUT, laufendAlt);
    assert.deepEqual(r, { fall: "kein-manifest", noetig: 2 }, name);
  }
});

test("6.1a2: andere Kinds und mehr als die Grenze an Manifesten werden nicht geprüft", () => {
  const anderes = { ...manifest(A, NEU, { version: "2.0.0" }), kind: 30063 };
  assert.deepEqual(suchUpdate([anderes, manifest(B, NEU, { version: "2.0.0" })], VERTRAUT, laufendAlt), { fall: "zu-wenig", noetig: 2, bestaetigt: 1 });
  const viele = Array.from({ length: UPDATE_GRENZEN.manifeste }, (_, i) => manifest(A, ALT, { version: `0.${i}`, releasedAt: 10 + i }));
  const r = suchUpdate([...viele, manifest(A, NEU, { version: "2.0.0" }), manifest(B, NEU, { version: "2.0.0" })], VERTRAUT, laufendAlt);
  assert.equal("fall" in r && r.fall, "zu-wenig", "nach der Grenze wird nichts mehr geprüft");
});

test("6.1a2: k ist einstellbar – mit drei Signierern bei k = 3", () => {
  const evs = [A, B, C].map((kp) => manifest(kp, NEU, { version: "2.0.0" }));
  assert.ok("angebot" in suchUpdate(evs, VERTRAUT, laufendAlt, 3));
  assert.deepEqual(suchUpdate(evs.slice(0, 2), VERTRAUT, laufendAlt, 3), { fall: "zu-wenig", noetig: 3, bestaetigt: 2 });
});

test("6.1a2: pruefeDatei – nur genau die angebotene Datei", () => {
  const daten = new TextEncoder().encode(NEU);
  const angebot = { sha256: hashText(NEU), sizeBytes: daten.length };
  assert.deepEqual(pruefeDatei(angebot, daten), { ok: true });
  assert.deepEqual(pruefeDatei(angebot, new TextEncoder().encode(NEU.replace("2", "3"))), { ok: false, fall: "pruefsumme" });
  assert.deepEqual(pruefeDatei(angebot, new TextEncoder().encode(NEU + "x")), { ok: false, fall: "groesse" });
  assert.deepEqual(pruefeDatei(angebot, new Uint8Array(0)), { ok: false, fall: "groesse" });
  assert.deepEqual(pruefeDatei({ sha256: hashText(NEU), sizeBytes: UPDATE_GRENZEN.bytes + 1 }, new Uint8Array(UPDATE_GRENZEN.bytes + 1)), { ok: false, fall: "groesse" });
});
