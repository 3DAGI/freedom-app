/**
 * Tests fuer den Offline-Abgleich.
 *
 * Zwei Geraete, die sich treffen, muessen in wenigen hundert Byte
 * herausfinden, was sie austauschen. Die Tests pruefen vor allem, dass die
 * Bandbreite respektiert wird — ein Plan, der vier Stunden dauert, ist kein
 * Plan.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, buildEvent, NostrEvent } from "../src/event.js";
import {
  buildDigest, digestHas, falsePositiveRate, planSync, policyFor,
  blobFeasibility, offlineCapabilities, SYNC_POLICY, LINK_BYTES_PER_SEC,
} from "../src/mesh-sync.js";

const KP = generateKeypair();
const ev = (kind: number, content = "x", at = 1000): NostrEvent =>
  signEvent(buildEvent(KP.pk, kind, [], content, at), KP.sk);

/**
 * Umschlag in der Form von NIP-59: Wegwerf-Autor, ein Empfaenger, Inhalt wie
 * NIP-44 v2 (Version 2, dann Zufall). Der Planer prueft nur die Form.
 */
const EMPF = generateKeypair().pk;
const umschlag = (bytes = 300, at = 1000, tags: string[][] = [["p", EMPF]]): NostrEvent => {
  const w = generateKeypair();
  const inhalt = Buffer.from([2, ...crypto.getRandomValues(new Uint8Array(bytes))]).toString("base64");
  return signEvent(buildEvent(w.pk, 1059, tags, inhalt, at), w.sk);
};

// ------------------------------------------------------------- Bestand

test("Bestand erkennt, was schon da ist", () => {
  const a = ev(4, "eins");
  const d = buildDigest([a]);
  assert.equal(digestHas(d, a.id), true);
  assert.equal(digestHas(d, ev(4, "zwei").id), false);
});

test("Bestand bleibt klein genug fuer Funk", () => {
  // Eine Liste von 1000 Kennungen waere 32 KB und damit ueber LoRa
  // unbrauchbar — das ist der ganze Grund fuer den Filter.
  const d = buildDigest(Array.from({ length: 1000 }, (_, i) => ev(4, `n${i}`)));
  assert.ok(d.bits.length <= 1024, `${d.bits.length} Byte`);
  assert.equal(d.count, 1000);
});

test("Der Fehler geht in die harmlose Richtung", () => {
  // Der Filter behauptet manchmal, etwas zu haben, das er nicht hat. Folge:
  // ein Ereignis wird ausgelassen und beim naechsten Treffen nachgereicht.
  // Nie kommt falscher Inhalt heraus.
  const vorhanden = Array.from({ length: 50 }, (_, i) => ev(4, `da${i}`));
  const d = buildDigest(vorhanden);
  for (const e of vorhanden) assert.equal(digestHas(d, e.id), true, "Vorhandenes wird nie verneint");
});

test("Ungenauigkeit waechst mit dem Bestand und ist ablesbar", () => {
  assert.ok(falsePositiveRate(buildDigest(Array.from({ length: 100 }, (_, i) => ev(4, `a${i}`)))) < 0.01);
  assert.ok(falsePositiveRate(buildDigest(Array.from({ length: 5000 }, (_, i) => ev(4, `b${i}`)))) > 0.1);
});

test("Alte Ereignisse lassen sich ausklammern", () => {
  const alt = ev(4, "alt", 100);
  const neu = ev(4, "neu", 9000);
  const d = buildDigest([alt, neu], 5000);
  assert.equal(digestHas(d, neu.id), true);
  assert.equal(d.count, 1);
});

// ------------------------------------------------------------- Plan

test("Nur Fehlendes wird gesendet", () => {
  const a = umschlag(), b = umschlag();
  const plan = planSync([a, b], buildDigest([a]), { link: "lora" });
  assert.equal(plan.send.length, 1);
  assert.equal(plan.send[0].id, b.id);
});

test("Nichts zu tun wird auch so gesagt", () => {
  const a = ev(4, "x");
  const plan = planSync([a], buildDigest([a]), { link: "lora" });
  assert.equal(plan.send.length, 0);
  assert.match(plan.note, /hat alles/);
});

test("Nur Umschlaege gehen ueber Mesh – Profile und alte DMs nicht (7.1)", () => {
  // Ein Profil oder eine Kind-4-DM traegt den Schluessel des Autors; ueber
  // Funk verraete das, wer wo sendet.
  const u = umschlag();
  for (const link of ["lora", "bluetooth", "datei"] as const) {
    const plan = planSync([ev(0, "profil"), ev(4, "dringend"), ev(42, "raum"), u], buildDigest([]), { link });
    assert.deepEqual(plan.send.map((e) => e.id), [u.id], link);
    assert.match(plan.skipped.find((s) => s.cls === "verzeichnis")!.reason, /Schlüssel des Autors/);
    assert.match(plan.skipped.find((s) => s.cls === "altnachricht")!.reason, /Absender und Empfänger offen/);
    assert.match(plan.skipped.find((s) => s.cls === "community")!.reason, /noch nicht verschlüsselt \(2\.3\)/);
  }
});

test("Ein Kind 1059 mit weiteren Tags ist kein Umschlag fuer Mesh", () => {
  // Jedes Tag ausser Empfaenger, Ablauf und Rechenarbeit koennte Klartext tragen.
  const plan = planSync([umschlag(300, 1000, [["p", EMPF], ["subject", "Treffen um 19 Uhr"]])], buildDigest([]), { link: "datei" });
  assert.equal(plan.send.length, 0);
  assert.match(plan.skipped[0].reason, /kein gültiger Umschlag/);
  assert.equal(planSync([umschlag(300, 1000, [["p", EMPF], ["expiration", "2000000000"]])], buildDigest([]), { link: "datei" }).send.length, 1);
});

test("Gewichte gehen NICHT ueber Funk", () => {
  // Ein leeres Versprechen waere schlimmer als eine ehrliche Absage.
  const plan = planSync([ev(38058, "seed")], buildDigest([]), { link: "lora" });
  assert.equal(plan.send.length, 0);
  assert.ok(plan.skipped.some((s) => s.cls === "gewichte"));
  assert.match(plan.skipped.find((s) => s.cls === "gewichte")!.reason, /nicht über Funk/);
});

test("Code geht ueber keine Mesh-Strecke – oeffentlich und mit Autor (7.1)", () => {
  for (const link of ["lora", "bluetooth", "datei"] as const) {
    assert.equal(planSync([ev(38056, "commit")], buildDigest([]), { link }).send.length, 0, link);
  }
});

test("Das Zeitbudget wird eingehalten", () => {
  const viele = Array.from({ length: 500 }, (_, i) => umschlag(200 + i));
  const plan = planSync(viele, buildDigest([]), { link: "lora", maxSeconds: 60 });
  assert.ok(plan.estimatedSeconds <= 60, `${plan.estimatedSeconds}s`);
  assert.ok(plan.send.length < viele.length);
  assert.ok(plan.skipped.some((s) => /Zeitbudget/.test(s.reason)));
});

test("Ueber Funk begrenzt die Sendezeit: 1 % je Stunde (EU 868 MHz)", () => {
  // 36 s Sendezeit je Stunde – auch wenn der Abgleich zehn Minuten dauern duerfte.
  const viele = Array.from({ length: 100 }, () => umschlag(1000));
  const plan = planSync(viele, buildDigest([]), { link: "lora", maxSeconds: 600 });
  assert.ok(plan.estimatedSeconds <= 36, `${plan.estimatedSeconds}s`);
  assert.ok(plan.send.length >= 2 && plan.send.length < 10, `${plan.send.length} Umschläge`);
  assert.match(plan.skipped[0].reason, /1 % Sendezeit je Stunde/);
  // Verbrauchte Sendezeit zaehlt mit: ohne freie Sendezeit geht nichts raus.
  assert.equal(planSync(viele, buildDigest([]), { link: "lora", sendezeitSekunden: 0 }).send.length, 0);
  // Bluetooth und Datei kennen diese Grenze nicht.
  assert.ok(planSync(viele, buildDigest([]), { link: "bluetooth", maxSeconds: 600 }).send.length === viele.length);
});

test("Rahmenkoepfe zaehlen zur Sendezeit", () => {
  const u = umschlag(1000);
  const json = JSON.stringify(u).length;
  const plan = planSync([u], buildDigest([]), { link: "lora" });
  assert.ok(plan.totalBytes > json, `${plan.totalBytes} ≤ ${json}`);
});

test("Ein grosser Umschlag verdraengt keine kleinen", () => {
  // Passt der neueste nicht mehr ins Budget, gehen die kleineren trotzdem.
  const klein = umschlag(200, 1000);
  const plan = planSync(
    [umschlag(5000, 2000), klein],
    buildDigest([]), { link: "lora", sendezeitSekunden: 10 });
  assert.deepEqual(plan.send.map((e) => e.id), [klein.id], "der kleine muss durch");
});

test("Schnellere Strecken schaffen mehr", () => {
  const viele = Array.from({ length: 200 }, (_, i) => umschlag(300 + i));
  const funk = planSync(viele, buildDigest([]), { link: "lora", maxSeconds: 60 });
  const bt = planSync(viele, buildDigest([]), { link: "bluetooth", maxSeconds: 60 });
  assert.ok(bt.send.length > funk.send.length);
  assert.ok(LINK_BYTES_PER_SEC.datei > LINK_BYTES_PER_SEC.bluetooth);
});

test("Hohe Ungenauigkeit wird dem Nutzer gesagt", () => {
  const plan = planSync(
    [umschlag()],
    buildDigest(Array.from({ length: 6000 }, (_, i) => ev(4, `f${i}`))),
    { link: "bluetooth" });
  if (plan.send.length > 0) assert.match(plan.note, /ungenau|zweites Treffen/);
});

// ------------------------------------------------------------- Brocken

test("Grosse Brocken nennen die bessere Strecke, nicht nur ein Nein", () => {
  // "Geht nicht" allein laesst den Nutzer ratlos zurueck.
  const v = blobFeasibility({ blobId: "b", sizeBytes: 50_000_000, label: "Modell" }, "lora");
  assert.equal(v.feasible, false);
  assert.equal(v.recommendedLink, "datei");
  assert.match(v.note, /Über Datei/);
});

test("Kleine Brocken gehen ueberall", () => {
  const v = blobFeasibility({ blobId: "b", sizeBytes: 8000, label: "Bild" }, "lora");
  assert.equal(v.feasible, true);
});

test("Mittlere Brocken ueber Bluetooth mit ehrlicher Dauer", () => {
  const v = blobFeasibility({ blobId: "b", sizeBytes: 3_000_000, label: "Bündel" }, "bluetooth");
  assert.equal(v.feasible, true);
  assert.match(v.note, /Minuten/);
});

// ------------------------------------------------------------- Auskunft

test("Nicht gebaute Faehigkeiten werden nicht als vorhanden ausgegeben", () => {
  // Ecash stand hier auf "funktioniert", war aber nie implementiert. Eine
  // behauptete Faehigkeit ist schlimmer als eine fehlende — der Nutzer plant
  // damit und merkt es erst, wenn es darauf ankommt.
  const e = offlineCapabilities("datei").find((x) => x.feature.includes("Ecash"))!;
  assert.equal(e.works, false);
  assert.match(e.note, /Noch nicht gebaut/);
});

test("Auskunft sagt bei jeder Strecke dasselbe ueber Lightning und KI", () => {
  // Ein Versprechen, das an zwei Stellen verschieden lautet, wird an der
  // schwaecheren geglaubt.
  for (const link of ["lora", "bluetooth", "datei"] as const) {
    const f = offlineCapabilities(link);
    assert.equal(f.find((x) => /Lightning/.test(x.feature))!.works, false);
    assert.equal(f.find((x) => /KI/.test(x.feature))!.works, false);
  }
});

test("Auskunft: ueber keine Strecke geht Offenes (7.1)", () => {
  const holen = (link: "lora" | "bluetooth" | "datei", teil: string): boolean => {
    const eintrag = offlineCapabilities(link).find((x) => x.feature.includes(teil));
    assert.ok(eintrag, `kein Eintrag fuer "${teil}" bei ${link}`);
    return eintrag.works;
  };
  for (const link of ["lora", "bluetooth", "datei"] as const) {
    // Verschluesselte Direktnachrichten ja – alles Offene nein.
    assert.equal(holen(link, "Direktnachrichten"), true);
    for (const teil of ["Räume", "Profile", "Code", "Modellgewichte"]) assert.equal(holen(link, teil), false, `${teil} über ${link}`);
    // Solana: Transport steht, offline signieren erst mit 7.2 – nicht als vorhanden ausgeben.
    assert.equal(holen(link, "Solana"), false);
  }
  // Ueber Funk nennt die Auskunft die Sendezeit-Grenze.
  assert.match(offlineCapabilities("lora").find((x) => x.feature === "Direktnachrichten")!.note, /1 % Sendezeit/);
});

test("Jede Ereignisart hat eine Einordnung – ueber Mesh nur Umschlaege", () => {
  for (const p of SYNC_POLICY) {
    assert.ok(p.kinds.length > 0, `${p.cls} ohne Kinds`);
    assert.ok(p.note.length > 15, `${p.cls} ohne Begruendung`);
    // Seit 7.1 hat nur die Umschlag-Klasse Strecken.
    assert.equal(p.links.length > 0, p.cls === "nachricht", p.cls);
  }
  assert.deepEqual(policyFor(1059)!.kinds, [1059]);
  assert.equal(policyFor(4)!.cls, "altnachricht");
  assert.equal(policyFor(42)!.cls, "community");
  assert.equal(policyFor(38058)!.cls, "gewichte");
  assert.equal(policyFor(99999), undefined);
});
