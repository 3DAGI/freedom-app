/**
 * Tests fuer die Datenschutz-Selbstauskunft.
 *
 * Der Zweck dieses Moduls ist, unangenehm zu sein. Die Tests pruefen deshalb
 * vor allem, dass es NICHT beschoenigt — ein Bericht, in dem alles gruen ist,
 * waere entweder gelogen oder nutzlos.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  auditPrivacy, summarizePrivacy, mixnetImpact, privacyReport,
  DEFAULT_CONFIG, PrivacyConfig,
} from "../src/privacy-audit.js";

const cfg = (over: Partial<PrivacyConfig> = {}): PrivacyConfig => ({ ...DEFAULT_CONFIG, ...over });

test("Mit Vorgabewerten ist die IP-Adresse KRITISCH", () => {
  // Das ist der wichtigste Befund des ganzen Moduls: Inhalt und Absender
  // koennen perfekt verborgen sein, und trotzdem sieht jedes Relay, von wo
  // jemand verbindet.
  const f = auditPrivacy(cfg());
  const ip = f.find((x) => x.title.includes("IP"))!;
  assert.equal(ip.severity, "kritisch");
  assert.match(ip.whoSeesWhat, /JEDES Relay/);
});

test("Die Punktzahl ist streng", () => {
  // Ein System, das sich selbst gute Noten gibt, ist als Auskunft wertlos.
  const s = summarizePrivacy(auditPrivacy(cfg()));
  assert.ok(s.score < 70, `${s.score} ist zu freundlich fuer Vorgabewerte`);
});

test("Bei kritischen Befunden steht ausdruecklich: NICHT anonym", () => {
  const s = summarizePrivacy(auditPrivacy(cfg()));
  assert.match(s.headline, /NICHT anonym/);
});

test("Kritisches steht oben", () => {
  // Wer nur ueberfliegt, soll das Wichtigste zuerst sehen.
  const f = auditPrivacy(cfg({ usesSwaps: true, solanaInProfile: true }));
  assert.equal(f[0].severity, "kritisch");
});

test("Tor entschaerft die IP, beseitigt sie aber nicht als Thema", () => {
  const f = auditPrivacy(cfg({ network: "tor" }));
  const ip = f.find((x) => x.title.includes("IP"))!;
  assert.notEqual(ip.severity, "kritisch");
  // Der Tor-Ausgang selbst sieht, wohin es geht.
  assert.match(ip.whoSeesWhat, /Ausgang/);
});

test("Ein Mixnetz gilt als gut — mit Korrelationshinweis", () => {
  const ip = auditPrivacy(cfg({ network: "mixnet" })).find((x) => x.title.includes("IP"))!;
  assert.equal(ip.severity, "gut");
  assert.match(ip.remedy, /Zeitmuster korrelieren/);
});

// ---------------------------------------------------- Die Kette

test("Swaps sind KRITISCH — und kein Mixnetz hilft", () => {
  // Das wird am haeufigsten uebersehen: Eine Kettentransaktion ist dauerhaft
  // oeffentlich, und die Transportverschluesselung aendert daran nichts.
  const f = auditPrivacy(cfg({ usesSwaps: true }));
  const swap = f.find((x) => x.title.includes("Solana-Transaktionen"))!;
  assert.equal(swap.severity, "kritisch");
  assert.match(swap.whoSeesWhat, /Kein Mixnetz ändert daran etwas|Kein Mixnetz aendert daran etwas/);
});

test("Eine Adresse im Profil verknuepft die gesamte Historie", () => {
  const f = auditPrivacy(cfg({ solanaInProfile: true }));
  const a = f.find((x) => x.title.includes("Adresse im Profil"))!;
  assert.equal(a.severity, "kritisch");
  assert.match(a.remedy, /bereits veröffentlicht wurde, bleibt|bereits veroeffentlicht wurde, bleibt/);
});

test("Ein verwahrender Lightning-Anbieter wird benannt", () => {
  const f = auditPrivacy(cfg({ custodialLightning: true }));
  assert.equal(f.find((x) => x.title.includes("Lightning-Anbieter"))!.severity, "warnung");
});

// ---------------------------------------------------- Der Inhalt

test("Ohne Geschenkumschlag ist der Sozialgraph offen", () => {
  const f = auditPrivacy(cfg({ giftWrap: false }));
  const g = f.find((x) => x.title.includes("Absender"))!;
  assert.equal(g.severity, "warnung");
  assert.match(g.whoSeesWhat, /Sozialgraph/);
});

test("Mit Umschlag wird die verbleibende Grenze genannt", () => {
  const g = auditPrivacy(cfg({ giftWrap: true })).find((x) => x.title.includes("Absender"))!;
  assert.equal(g.severity, "gut");
  assert.match(g.remedy, /EMPFAENGER bleibt sichtbar|EMPFÄNGER bleibt sichtbar/);
});

test("Offene Kanaele werden als das benannt, was sie sind", () => {
  const k = auditPrivacy(cfg({ encryptedChannels: false })).find((x) => x.title === "Kanäle" || x.title === "Kanaele")!;
  assert.equal(k.severity, "warnung");
  assert.match(k.whoSeesWhat, /JEDER lesen/);
});

test("Auch verschluesselte Kanaele bekommen einen Vorbehalt", () => {
  // Wer austritt, behaelt alles Gelesene — das gehoert in jede Anzeige.
  const k = auditPrivacy(cfg({ encryptedChannels: true })).find((x) => x.title === "Kanäle" || x.title === "Kanaele")!;
  assert.equal(k.severity, "gut");
  assert.match(k.remedy, /austritt/);
});

test("Ein fremd gehostetes Profilbild verraet die Betrachter", () => {
  const b = auditPrivacy(cfg({ externalAvatar: true })).find((x) => x.title.includes("Profilbild"))!;
  assert.match(b.whoSeesWhat, /JEDES Menschen|jedes Menschen/);
});

// ---------------------------------------------------- Mixnetz-Frage

test("Die Mixnetz-Antwort nennt, was es NICHT behebt", () => {
  // Die Antwort enttaeuscht meist — es verbessert genau eine von drei
  // Schichten.
  const m = mixnetImpact(cfg({ usesSwaps: true }));
  assert.ok(m.fixes.length > 0);
  assert.ok(m.doesNotFix.some((x) => /Kette|oeffentlich|öffentlich/.test(x)));
  assert.ok(m.doesNotFix.length > m.fixes.length, "die Liste der Grenzen ist laenger");
});

test("Bei klarer Verbindung ist ein Mixnetz die groesste Einzelverbesserung", () => {
  const m = mixnetImpact(cfg({ network: "klar" }));
  assert.match(m.verdict, /größte einzelne Verbesserung|groesste einzelne Verbesserung/);
  // Aber nicht als Anonymitaetsversprechen.
  assert.match(m.verdict, /nicht anonym/);
});

test("Wer schon anonymisiert verbindet, gewinnt weniger", () => {
  const m = mixnetImpact(cfg({ network: "tor" }));
  assert.match(m.verdict, /GANZE Netz/);
});

test("Verwahrtes Lightning und Profiladresse tauchen in den Grenzen auf", () => {
  const m = mixnetImpact(cfg({ custodialLightning: true, solanaInProfile: true }));
  assert.ok(m.doesNotFix.some((x) => /Lightning-Anbieter/.test(x)));
  assert.ok(m.doesNotFix.some((x) => /Kettenadresse/.test(x)));
});

// ---------------------------------------------------- Bericht

test("Der Bericht nennt den groessten Gewinn", () => {
  const s = summarizePrivacy(auditPrivacy(cfg()));
  assert.ok(s.biggestWin);
  assert.match(s.biggestWin!, /IP/);
});

test("Der Textbericht ist lesbar und vollstaendig", () => {
  const t = privacyReport(cfg({ usesSwaps: true }));
  assert.match(t, /von 100/);
  assert.match(t, /!!/);
  assert.match(t, /Größter Gewinn|Groesster Gewinn/);
});

test("Die beste Konfiguration verspricht trotzdem keine Anonymitaet", () => {
  // Auch mit allem an bleiben Kette und Empfaenger sichtbar. Ein Bericht,
  // der hier "anonym" sagen wuerde, waere die gefaehrlichste Zeile im
  // ganzen System.
  const beste = cfg({
    giftWrap: true, encryptedChannels: true, network: "mixnet",
    ownRelay: true, expiringMessages: true, stateBackup: true,
  });
  const s = summarizePrivacy(auditPrivacy(beste));
  assert.equal(s.critical, 0);
  assert.ok(!/\banonym\b/.test(s.headline), "das Wort 'anonym' darf hier nicht stehen");
  assert.match(s.headline, /so gut.*wie es hier geht/);
});
