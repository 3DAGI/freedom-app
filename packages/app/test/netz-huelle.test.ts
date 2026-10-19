/**
 * 6.1b1b/6.1b2b: Direkt oder Tor – der Schalter für die Hülle (Desktop und Android). Die
 * Hülle selbst (Zugang, arti, `netz.json`, Proxy unter Android) testet `packages/launcher`
 * (`cargo test`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { brueckeRueckfrage, brueckenFehlerText, leseNetzStand, netzStand, netzZeilen, setzeBruecken, setzeTor, torRueckfrage, zeilenAusText, type NetzStand } from "../src/shell/netz-huelle.js";
import { setLang } from "../src/i18n.js";

const STAND: NetzStand = { verfuegbar: true, tor: true, aktiv: true, bereit: true, fehler: null, bruecken: false, brueckenAktiv: false, brueckenMoeglich: false, eigeneZeilen: 0 };

test("6.1b1b: der Stand der Hülle wird streng gelesen", () => {
  assert.deepEqual(leseNetzStand(STAND), STAND);
  assert.deepEqual(leseNetzStand({ ...STAND, fehler: "bootstrap" }), { ...STAND, fehler: "bootstrap" });
  assert.deepEqual(leseNetzStand({ ...STAND, fehler: "proxy" }), { ...STAND, fehler: "proxy" }, "6.1b2b: Android");
  for (const kaputt of [null, 1, { ...STAND, tor: "ja" }, { ...STAND, bereit: undefined }, { ...STAND, fehler: "anders" }, { ...STAND, fehler: undefined }]) {
    assert.equal(leseNetzStand(kaputt), null, JSON.stringify(kaputt));
  }
});

test("6.1b1b: Stand und Umschalten nur in der Hülle", async () => {
  assert.equal(await netzStand(null), null, "im Browser kein Stand");
  assert.equal(await netzStand(async () => { throw new Error("weg"); }), null);
  const gerufen: unknown[] = [];
  assert.deepEqual(await netzStand(async (b, a) => { gerufen.push([b, a]); return STAND; }), STAND);
  assert.equal(await setzeTor(true, async (b, a) => { gerufen.push([b, a]); return STAND; }), true);
  assert.deepEqual(gerufen, [["netz_stand", undefined], ["netz_setzen", { tor: true, neustart: true }]], "umschalten heißt neu starten");
  assert.equal(await setzeTor(false, null), false);
  assert.equal(await setzeTor(false, async () => { throw "ablage"; }), false);
});

test("6.1b1b: der Text sagt, wie diese Sitzung läuft – und was ab dem Start gilt", () => {
  setLang("de");
  try {
    assert.deepEqual(netzZeilen(STAND), ["Tor: verbunden – der Verkehr dieser App geht über Tor."]);
    assert.deepEqual(netzZeilen({ ...STAND, bereit: false }), ["Tor: verbindet … bis dahin geht nichts hinaus."]);
    assert.match(netzZeilen({ ...STAND, bereit: false, fehler: "start" })[0]!, /startet nicht – es geht nichts hinaus/);
    assert.match(netzZeilen({ ...STAND, bereit: false, fehler: "bootstrap" })[0]!, /erreicht das Tor-Netz nicht – es geht nichts hinaus/);
    assert.match(netzZeilen({ ...STAND, bereit: false, fehler: "proxy" })[0]!, /nimmt den Tor-Zugang nicht an – es geht nichts hinaus/);
    assert.deepEqual(netzZeilen({ ...STAND, tor: false, aktiv: false, bereit: false }), ["Direkt: Relays und Dienste sehen deine IP-Adresse."]);
    // gewählt, aber noch nicht gestartet – und umgekehrt
    assert.deepEqual(netzZeilen({ ...STAND, aktiv: false, bereit: false }), ["Direkt: Relays und Dienste sehen deine IP-Adresse.", "Tor ist gewählt – gilt ab dem nächsten Start."]);
    assert.deepEqual(netzZeilen({ ...STAND, tor: false }), ["Tor: verbunden – der Verkehr dieser App geht über Tor.", "Direkt ist gewählt – gilt ab dem nächsten Start."]);
  } finally {
    setLang("en");
  }
});

test("6.1b2b: die Rückfrage sagt je Hülle, was passiert – Android schließt die App", () => {
  setLang("de");
  try {
    const desktop = torRueckfrage(true, "desktop");
    assert.equal(desktop.ok, "Neu starten");
    assert.match(desktop.text, /^Die App startet neu/);
    const android = torRueckfrage(true, "android");
    assert.equal(android.ok, "App schließen");
    assert.match(android.text, /^Die App schließt sich\. Öffnest du sie wieder, geht sie nur noch über Tor/);
    assert.match(android.text, /Anrufe laufen nicht über Tor/);
    assert.match(torRueckfrage(false, "android").text, /^Die App schließt sich\. Öffnest du sie wieder, verbindet sie sich direkt/);
    assert.equal(torRueckfrage(false, "android").titel, "Wieder direkt verbinden?");
  } finally {
    setLang("en");
  }
});

test("Verdrahtung (6.1b1b/6.1b2b): Schalter nur in der Hülle, umgeschaltet nur nach Rückfrage", () => {
  const html = readFileSync(new URL("../src/shell/index.html", import.meta.url), "utf8");
  assert.match(html, /<div id="huelle-tor-block" class="hidden">/, "verborgen, bis die Hülle ihn zeigt");
  // Seit C-53b eine Zeile mit Schalter; die Grenze (Anrufe nicht über Tor) steht auch im kurzen Satz
  assert.match(html, /<span class="einst-titel" data-i18n="set\.torHaken">[^<]*<\/span><span class="einst-satz" data-i18n="set\.torKurz">[^<]*Anrufe schon[^<]*<\/span><\/span>\s*<input type="checkbox" id="huelle-tor" class="schalter" role="switch" \/>/);
  const app = readFileSync(new URL("../src/shell/app.ts", import.meta.url), "utf8");
  assert.match(app, /void wireHuellenTor\(\);/);
  const m = readFileSync(new URL("../src/shell/netz-huelle.ts", import.meta.url), "utf8");
  assert.match(m, /const art = huellenArt\(\);\n  if \(!block \|\| !haken \|\| !standBox \|\| !art\) return;/, "nur in einer Hülle – im Browser nie");
  assert.match(m, /if \(!stand\?\.verfuegbar\) return;/);
  const wire = m.slice(m.indexOf("export async function wireHuellenTor"));
  assert.ok(wire.indexOf("await bestaetige(torRueckfrage(an, art))") > 0 && wire.indexOf("await bestaetige(") < wire.indexOf("setzeTor(an)"), "erst fragen, dann umschalten");
  // Die Texte versprechen nichts, was die Hülle nicht hält
  const texte = readFileSync(new URL("../src/texte/settings.ts", import.meta.url), "utf8");
  assert.match(texte, /"set\.torText": \{ de: "[^"]*Anrufe laufen nicht über Tor\.[^"]*nie still direkt/);
});

const BRUECKE: NetzStand = { ...STAND, bruecken: true, brueckenAktiv: true, brueckenMoeglich: true };

test("B-33c: Brücken im Stand der Hülle – streng, ältere Hüllen ohne die Felder", () => {
  const roh = { verfuegbar: true, tor: true, aktiv: true, bereit: true, fehler: "bruecke", bruecken: true, brueckenAktiv: true, brueckenMoeglich: true, eigeneZeilen: 2 };
  assert.deepEqual(leseNetzStand(roh), { ...BRUECKE, fehler: "bruecke", eigeneZeilen: 2 });
  const alt = { verfuegbar: true, tor: true, aktiv: true, bereit: true, fehler: null };
  assert.deepEqual(leseNetzStand(alt), STAND, "Hülle vor B-33b1: keine Brücken");
  for (const kaputt of [{ ...roh, bruecken: "ja" }, { ...roh, brueckenMoeglich: 1 }, { ...roh, eigeneZeilen: -1 }, { ...roh, eigeneZeilen: 1.5 }, { ...roh, eigeneZeilen: "2" }, { ...roh, fehler: "brücke" }]) {
    assert.equal(leseNetzStand(kaputt), null, JSON.stringify(kaputt));
  }
});

test("B-33c: der Text sagt, ob diese Sitzung über eine Brücke läuft – und was ab dem Start gilt", () => {
  setLang("de");
  try {
    assert.deepEqual(netzZeilen(BRUECKE), ["Tor über Brücke: verbunden – der Verkehr dieser App geht über Tor."]);
    assert.match(netzZeilen({ ...BRUECKE, bereit: false })[0]!, /^Tor über Brücke: verbindet … mit Snowflake kann das einige Minuten dauern; bis dahin geht nichts hinaus\.$/);
    assert.match(netzZeilen({ ...BRUECKE, bereit: false, fehler: "bruecke" })[0]!, /^Die Brücke startet nicht .* es geht nichts hinaus/);
    assert.match(netzZeilen({ ...BRUECKE, bereit: false, fehler: "bootstrap" })[0]!, /über die Brücke das Tor-Netz nicht – es geht nichts hinaus/);
    assert.deepEqual(netzZeilen({ ...BRUECKE, brueckenAktiv: false }).slice(1), ["Brücke ist gewählt – gilt ab dem nächsten Start."]);
    assert.deepEqual(netzZeilen({ ...BRUECKE, bruecken: false }).slice(1), ["Ohne Brücke ist gewählt – gilt ab dem nächsten Start."]);
    assert.deepEqual(netzZeilen({ ...BRUECKE, eigeneZeilen: 3 }).slice(1), ["Eigene Brücken: 3 (statt der eingebauten)."]);
    // Ohne Tor sagt der Text nichts über Brücken – sie gelten nur mit Tor
    assert.deepEqual(netzZeilen({ ...BRUECKE, tor: false, aktiv: false, brueckenAktiv: false, eigeneZeilen: 3 }), ["Direkt: Relays und Dienste sehen deine IP-Adresse.", "Eigene Brücken: 3 (statt der eingebauten)."]);
  } finally {
    setLang("en");
  }
});

test("B-33c: eingefügte Zeilen – je Zeile eine, auch in der Form von bridges.torproject.org", () => {
  const w = "webtunnel [2001:db8::1]:443 B04AA0C0F1E2D3C4B5A6978869504132ABCDEF01 url=https://bruecke.example.org/a ver=0.0.1";
  assert.deepEqual(zeilenAusText(`  ${w}\r\n\n Bridge ${w}  \n`), [w, `Bridge ${w}`]);
  assert.deepEqual(zeilenAusText(`['${w}', '${w.replace("::1", "::2")}']`), [w, w.replace("::1", "::2")], "QR-Code von bridges.torproject.org");
  assert.deepEqual(zeilenAusText(`["${w}"]`), [w]);
  assert.deepEqual(zeilenAusText("  \n "), [], "leer: die eingebauten");
});

test("B-33c: Fehler der Hülle nur als eigene Texte", () => {
  setLang("de");
  try {
    assert.equal(brueckenFehlerText("zeile:1:fingerabdruck"), "Zeile 2: Fingerabdruck mit 40 Hex-Zeichen fehlt – nichts gemerkt.");
    assert.equal(brueckenFehlerText("zeile:16:zu-viele"), "Zeile 17: mehr als 16 Brücken – nichts gemerkt.");
    assert.equal(brueckenFehlerText("bruecken-fehlen"), "Die Programme für Brücken liegen dieser App nicht bei.");
    const allgemein = "Die Wahl ließ sich nicht speichern – es bleibt, wie es war.";
    for (const e of ["zeile:0:constructor", "zeile:0:toString", "zeile:x:leer", "ablage", new Error("zeile:0:leer"), "zeile:0:leer <script>"]) {
      assert.equal(brueckenFehlerText(e), allgemein, String(e));
    }
  } finally {
    setLang("en");
  }
});

test("B-33c: Brücken setzen nur über die Hülle – mit Brücke auch Tor", async () => {
  const gerufen: unknown[] = [];
  const aufruf = async (b: string, a?: Record<string, unknown>) => { gerufen.push([b, a]); return STAND; };
  assert.equal(await setzeBruecken({ tor: true, neustart: true, bruecken: true }, aufruf), null);
  assert.equal(await setzeBruecken({ tor: false, neustart: false, zeilen: ["x"] }, aufruf), null);
  assert.deepEqual(gerufen, [["netz_setzen", { tor: true, neustart: true, bruecken: true }], ["netz_setzen", { tor: false, neustart: false, zeilen: ["x"] }]]);
  setLang("de");
  try {
    assert.equal(await setzeBruecken({ tor: true, neustart: false, zeilen: ["x"] }, async () => { throw "zeile:0:transport"; }), "Zeile 1: nur webtunnel oder snowflake – nichts gemerkt.");
    assert.equal(await setzeBruecken({ tor: true, neustart: true, bruecken: true }, null), "Die Wahl ließ sich nicht speichern – es bleibt, wie es war.");
    assert.match(brueckeRueckfrage(true, "desktop").text, /freiwillige Proxys deine IP-Adresse .* DNS .* Geht die Brücke nicht, geht nichts hinaus\.$/);
    assert.equal(brueckeRueckfrage(false, "desktop").ok, "Neu starten");
    // B-33d: Android startet nicht neu, die App schließt sich – Text und Knopf sagen das
    const androidAn = brueckeRueckfrage(true, "android");
    assert.match(androidAn.text, /^Die App schließt sich\. Öffnest du sie wieder, geht sie über Tor mit einer Brücke ins Netz/);
    assert.match(androidAn.text, /dein Gerät fragt sein DNS .* Geht die Brücke nicht, geht nichts hinaus\.$/);
    assert.doesNotMatch(androidAn.text, /startet neu|Rechner/);
    assert.equal(androidAn.ok, "App schließen");
    assert.match(brueckeRueckfrage(false, "android").text, /^Die App schließt sich\. .*ohne Brücke/);
    assert.equal(brueckeRueckfrage(false, "android").ok, "App schließen");
    assert.doesNotMatch(brueckeRueckfrage(true, "desktop").text, /schließt sich/);
  } finally {
    setLang("en");
  }
});

test("Verdrahtung (B-33c): Brücken nur, wenn die Programme beiliegen, umgeschaltet nur nach Rückfrage", () => {
  const html = readFileSync(new URL("../src/shell/index.html", import.meta.url), "utf8");
  const tor = html.slice(html.indexOf('<div id="huelle-tor-block"'), html.indexOf('<p id="huelle-tor-stand"'));
  assert.match(tor, /<div id="huelle-bruecke-block" class="hidden">/, "im Block der Hülle und verborgen");
  assert.match(tor, /<input type="checkbox" id="huelle-bruecke" class="schalter" role="switch" \/>/);
  assert.match(tor, /<button id="huelle-bruecken-zeilen" class="ghost mini" type="button"/);
  const m = readFileSync(new URL("../src/shell/netz-huelle.ts", import.meta.url), "utf8");
  const wire = m.slice(m.indexOf("function wireBruecken"));
  assert.match(wire, /if \(!block \|\| !haken \|\| !knopf \|\| !stand\.brueckenMoeglich\) return;/);
  assert.ok(wire.indexOf("await bestaetige(brueckeRueckfrage(an, art))") < wire.indexOf("await setzeBruecken("), "erst fragen, dann umschalten");
  assert.match(wire, /tor: an \|\| stand\.tor/, "mit Brücke auch Tor");
  // Die Zeilen gehen nur an die Hülle – nie in den Speicher der App
  assert.doesNotMatch(m, /localStorage|geheim\.|sessionStorage/);
  const texte = readFileSync(new URL("../src/texte/settings.ts", import.meta.url), "utf8");
  assert.match(texte, /"set\.brueckeText": \{ de: "[^"]*sehen deine IP-Adresse, nicht, was du tust\.[^"]*bei seinem DNS an\.[^"]*nie still ohne Brücke\."/);
});
