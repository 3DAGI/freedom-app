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
  const a = ev(4, "hat er"), b = ev(4, "hat er nicht");
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

test("Nachrichten gehen vor Verzeichnis", () => {
  // Bei 200 Byte pro Sekunde entscheidet die Reihenfolge, ob eine Nachricht
  // in Minuten oder in Stunden ankommt.
  const plan = planSync(
    [ev(0, "profil"), ev(4, "dringend")], buildDigest([]), { link: "lora" });
  assert.equal(plan.send[0].kind, 4);
});

test("Gewichte gehen NICHT ueber Funk", () => {
  // Ein leeres Versprechen waere schlimmer als eine ehrliche Absage.
  const plan = planSync([ev(38058, "seed")], buildDigest([]), { link: "lora" });
  assert.equal(plan.send.length, 0);
  assert.ok(plan.skipped.some((s) => s.cls === "gewichte"));
  assert.match(plan.skipped.find((s) => s.cls === "gewichte")!.reason, /nicht über Funk/);
});

test("Code geht ueber Bluetooth, nicht ueber Funk", () => {
  assert.equal(planSync([ev(38056, "commit")], buildDigest([]), { link: "lora" }).send.length, 0);
  assert.equal(planSync([ev(38056, "commit")], buildDigest([]), { link: "bluetooth" }).send.length, 1);
});

test("Das Zeitbudget wird eingehalten", () => {
  const viele = Array.from({ length: 500 }, (_, i) => ev(4, "x".repeat(200) + i));
  const plan = planSync(viele, buildDigest([]), { link: "lora", maxSeconds: 60 });
  assert.ok(plan.estimatedSeconds <= 60, `${plan.estimatedSeconds}s`);
  assert.ok(plan.send.length < viele.length);
  assert.ok(plan.skipped.some((s) => /Zeitbudget/.test(s.reason)));
});

test("Ein grosses Buendel verdraengt keine Nachrichten", () => {
  // Andersherum sortiert waere die dringende Nachricht hinter einem
  // Git-Buendel gelandet.
  const plan = planSync(
    [ev(38056, "g".repeat(5000)), ev(4, "dringend")],
    buildDigest([]), { link: "bluetooth", maxSeconds: 1 });
  assert.ok(plan.send.some((e) => e.kind === 4), "die Nachricht muss durch");
});

test("Schnellere Strecken schaffen mehr", () => {
  const viele = Array.from({ length: 200 }, (_, i) => ev(4, "y".repeat(300) + i));
  const funk = planSync(viele, buildDigest([]), { link: "lora", maxSeconds: 60 });
  const bt = planSync(viele, buildDigest([]), { link: "bluetooth", maxSeconds: 60 });
  assert.ok(bt.send.length > funk.send.length);
  assert.ok(LINK_BYTES_PER_SEC.datei > LINK_BYTES_PER_SEC.bluetooth);
});

test("Hohe Ungenauigkeit wird dem Nutzer gesagt", () => {
  const plan = planSync(
    [ev(4, "neu")],
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

test("Auskunft unterscheidet, was ueber welche Strecke geht", () => {
  const holen = (link: "lora" | "bluetooth" | "datei", teil: string): boolean => {
    const eintrag = offlineCapabilities(link).find((x) => x.feature.includes(teil));
    assert.ok(eintrag, `kein Eintrag fuer "${teil}" bei ${link}`);
    return eintrag.works;
  };
  // Code passt ueber Bluetooth und Datei, nicht ueber Funk.
  assert.equal(holen("lora", "Code"), false);
  assert.equal(holen("bluetooth", "Code"), true);
  // Gewichte nur per Datei.
  assert.equal(holen("datei", "Modellgewichte"), true);
  assert.equal(holen("lora", "Modellgewichte"), false);
  assert.equal(holen("bluetooth", "Modellgewichte"), false);
});

test("Jede Ereignisart hat eine Einordnung", () => {
  for (const p of SYNC_POLICY) {
    assert.ok(p.kinds.length > 0, `${p.cls} ohne Kinds`);
    assert.ok(p.links.length > 0);
    assert.ok(p.note.length > 15, `${p.cls} ohne Begruendung`);
  }
  assert.equal(policyFor(4)!.cls, "nachricht");
  assert.equal(policyFor(38058)!.cls, "gewichte");
  assert.equal(policyFor(99999), undefined);
});
