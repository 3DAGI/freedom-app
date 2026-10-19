/**
 * B-38a: Vorlesen nur mit Stimmen dieses Geräts (SP-W2 A, `docs/SPRACHE-ENTWURF.md` V1, V5).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { browserSprecher, lokaleStimmen, VORLESE_GRENZEN, vorleseStuecke, Vorleser, waehleStimme, type Sprecher, type Stimme } from "../src/vorlesen.js";

const NETZ_DE: Stimme = { name: "Google Deutsch", lang: "de-DE", localService: false, default: true };
const ANNA: Stimme = { name: "Anna", lang: "de-DE", localService: true };
const MARKUS: Stimme = { name: "Markus", lang: "de_AT", localService: true, default: true };
const DANIEL: Stimme = { name: "Daniel", lang: "en-GB", localService: true };

test("B-38a: nur Stimmen, die auf dem Gerät sprechen – nie eine Netzstimme, nie eine andere Sprache", () => {
  assert.deepEqual(lokaleStimmen([NETZ_DE, ANNA, DANIEL]), [ANNA, DANIEL]);
  const halb = { name: "x", lang: "de", localService: "true" } as unknown as Stimme;
  assert.deepEqual(lokaleStimmen([halb]), [], "nur wirklich true");
  assert.equal(waehleStimme([NETZ_DE, ANNA], "de"), ANNA, "die Vorgabe des Systems ist eine Netzstimme – trotzdem die lokale");
  assert.equal(waehleStimme([NETZ_DE, ANNA, MARKUS], "de"), MARKUS, "unter den lokalen die Vorgabe (de_AT zählt als de)");
  assert.equal(waehleStimme([NETZ_DE], "de"), null, "nur eine Netzstimme: nicht vorlesen");
  assert.equal(waehleStimme([NETZ_DE, DANIEL], "de"), null, "keine englische Stimme für deutschen Text");
  assert.equal(waehleStimme([DANIEL], "en"), DANIEL);
  assert.equal(waehleStimme([], "de"), null);
});

test("B-38a: Text in Stücken – an Satzenden, lange Sätze an Leerzeichen, mit Obergrenze", () => {
  assert.deepEqual(vorleseStuecke("  "), []);
  assert.deepEqual(vorleseStuecke("Hallo   Welt.\n\nNoch ein Satz!  Und?"), ["Hallo Welt. Noch ein Satz! Und?"]);
  const g = { ...VORLESE_GRENZEN, stueck: 20 };
  assert.deepEqual(vorleseStuecke("Erster Satz hier. Zweiter Satz da.", g), ["Erster Satz hier.", "Zweiter Satz da."]);
  assert.deepEqual(vorleseStuecke("eins zwei drei vier fünf sechs sieben", g), ["eins zwei drei vier", "fünf sechs sieben"]);
  assert.deepEqual(vorleseStuecke("a".repeat(45), g), ["a".repeat(20), "a".repeat(20), "a".repeat(5)], "ein Wort ohne Leerzeichen hart");
  const lang = vorleseStuecke("Satz. ".repeat(5000));
  assert.ok(lang.join(" ").length <= VORLESE_GRENZEN.zeichen);
  assert.ok(lang.every((s) => s.length <= VORLESE_GRENZEN.stueck));
});

/** Ein Sprecher zum Prüfen: merkt sich, was er mit welcher Stimme sprechen sollte. */
function attrappe(stimmen: Stimme[], o: { verzoegert?: boolean; fehlerBei?: number } = {}) {
  const gesprochen: Array<{ stueck: string; stimme: string }> = [];
  let offen: ((ok: boolean) => void) | null = null;
  let hoerer: (() => void) | null = null;
  let stopps = 0;
  const s: Sprecher = {
    stimmen: () => stimmen,
    aufStimmen: (f) => {
      hoerer = f;
      return () => {
        hoerer = null;
      };
    },
    sprich: (stueck, stimme, fertig) => {
      gesprochen.push({ stueck, stimme: stimme.name });
      if (o.fehlerBei === gesprochen.length) fertig(false);
      else if (o.verzoegert) offen = fertig;
      else fertig(true);
    },
    stopp: () => {
      stopps++;
      const f = offen;
      offen = null;
      f?.(false);
    },
  };
  return { s, gesprochen, stopps: () => stopps, weiter: () => { const f = offen; offen = null; f?.(true); }, stimmenDa: () => hoerer?.() };
}

test("B-38a: der Vorleser spricht alle Stücke mit der lokalen Stimme, auch wenn die Vorgabe eine Netzstimme ist", async () => {
  const a = attrappe([NETZ_DE, ANNA]);
  const v = new Vorleser(a.s);
  assert.equal(await v.lies("Erster Satz. Zweiter Satz.", "de"), "fertig");
  assert.deepEqual(a.gesprochen, [{ stueck: "Erster Satz. Zweiter Satz.", stimme: "Anna" }]);
  assert.equal(v.spricht, false);
  assert.equal(await v.lies("   ", "de"), "leer");
});

test("B-38a: ohne lokale Stimme liest er nicht – kein einziges Stück an eine Netzstimme", async () => {
  const a = attrappe([NETZ_DE, DANIEL]);
  assert.equal(await new Vorleser(a.s).lies("Hallo.", "de"), "keine-stimme");
  assert.deepEqual(a.gesprochen, []);
});

test("B-38a: anhalten und ein neuer Text beenden den laufenden; ein Fehler bricht ab", async () => {
  const a = attrappe([ANNA], { verzoegert: true });
  const v = new Vorleser(a.s);
  const text = `${"Satz eins. ".repeat(30)}${"Satz zwei. ".repeat(30)}`;
  const erster = v.lies(text, "de");
  await new Promise((r) => setImmediate(r));
  assert.equal(v.spricht, true);
  assert.equal(a.gesprochen.length, 1);
  v.stopp();
  assert.equal(await erster, "abgebrochen");
  assert.equal(a.gesprochen.length, 1, "nach dem Anhalten kein weiteres Stück");
  assert.equal(a.stopps(), 1);
  assert.equal(v.spricht, false);

  const zweiter = v.lies(text, "de");
  await new Promise((r) => setImmediate(r));
  const dritter = v.lies("Neu.", "de");
  assert.equal(await zweiter, "abgebrochen", "ein neuer Text beendet den laufenden");
  a.weiter();
  assert.equal(await dritter, "fertig");
  assert.equal(a.gesprochen.at(-1)?.stueck, "Neu.");

  const f = attrappe([ANNA], { fehlerBei: 1 });
  assert.equal(await new Vorleser(f.s).lies(text, "de"), "abgebrochen");
  assert.equal(f.gesprochen.length, 1);
});

test("B-38a: die Stimmen kommen später (voiceschanged) – er wartet, aber nicht ewig", async () => {
  const liste: Stimme[] = [];
  const a = attrappe(liste);
  const v = new Vorleser(a.s, 5_000);
  const lauf = v.lies("Hallo.", "de");
  await new Promise((r) => setImmediate(r));
  liste.push(NETZ_DE, ANNA);
  a.stimmenDa();
  assert.equal(await lauf, "fertig");
  assert.equal(a.gesprochen[0]?.stimme, "Anna");

  const leer = attrappe([]);
  assert.equal(await new Vorleser(leer.s, 20).lies("Hallo.", "de"), "keine-stimme");
});

test("B-38a: der Sprecher des Browsers setzt immer eine lokale Stimme – sonst spricht er nicht", () => {
  const netz = { name: "Google Deutsch", lang: "de-DE", localService: false, default: true };
  const anna = { name: "Anna", lang: "de-DE", localService: true, default: false };
  const gesagt: Array<{ text: string; voice: unknown; lang: string }> = [];
  class Aeusserung {
    voice: unknown = null;
    lang = "";
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public text: string) {}
  }
  const fenster = {
    SpeechSynthesisUtterance: Aeusserung,
    speechSynthesis: {
      getVoices: () => [netz, anna],
      speak: (u: Aeusserung) => {
        gesagt.push({ text: u.text, voice: u.voice, lang: u.lang });
        u.onend?.();
      },
      cancel: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  };
  const s = browserSprecher(fenster);
  assert.ok(s);
  const ergebnis: boolean[] = [];
  s.sprich("Hallo.", anna, (ok) => ergebnis.push(ok));
  assert.deepEqual(gesagt, [{ text: "Hallo.", voice: anna, lang: "de-DE" }]);
  s.sprich("Nein.", netz, (ok) => ergebnis.push(ok));
  s.sprich("Weg.", { name: "Fremd", lang: "de-DE", localService: true }, (ok) => ergebnis.push(ok));
  assert.equal(gesagt.length, 1, "Netzstimme und unbekannte Stimme: nichts gesprochen");
  assert.deepEqual(ergebnis, [true, false, false]);
  assert.equal(browserSprecher({}), null, "ohne speechSynthesis (Android-WebView) kein Sprecher");
  assert.equal(browserSprecher({ speechSynthesis: fenster.speechSynthesis }), null, "ohne SpeechSynthesisUtterance auch nicht");
});

test("B-38a: verdrahtet – Knopf unter jeder Antwort, nie SpeechRecognition, Texte in beiden Sprachen", async () => {
  const { readFileSync, readdirSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const anzeige = readFileSync(new URL("../src/shell/tabs/agent-anzeige.ts", import.meta.url), "utf8");
  assert.match(anzeige, /const vorlesen = vorlesenKnopf\(koerper\);\n\s+if \(vorlesen\) aktionen\.append\(vorlesen\);/);
  // Spracherkennung des Browsers schickt den Ton an Google (Chrome) – nirgends in der App
  const quellen = new URL("../src/", import.meta.url).pathname;
  const dateien: string[] = [];
  const lauf = (d: string): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) lauf(p);
      else if (p.endsWith(".ts")) dateien.push(p);
    }
  };
  lauf(quellen);
  for (const p of dateien) assert.doesNotMatch(readFileSync(p, "utf8"), /SpeechRecognition/, p);
  const { setLang, t } = await import("../src/i18n.js");
  for (const sprache of ["de", "en"] as const) {
    setLang(sprache);
    for (const k of ["agent.vorlesen", "agent.vorlesenStopp", "agent.vorlesenTitel", "agent.vorlesenKeineStimme", "agent.vorlesenCode"]) {
      assert.notEqual(t(k), k, `${sprache}: ${k}`);
    }
  }
  setLang("en");
});
