/**
 * 6.1b1b/6.1b2b: Direkt oder Tor – der Schalter für die Hülle (Desktop und Android). Die
 * Hülle selbst (Zugang, arti, `netz.json`, Proxy unter Android) testet `packages/launcher`
 * (`cargo test`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { leseNetzStand, netzStand, netzZeilen, setzeTor, torRueckfrage, type NetzStand } from "../src/shell/netz-huelle.js";
import { setLang } from "../src/i18n.js";

const STAND: NetzStand = { verfuegbar: true, tor: true, aktiv: true, bereit: true, fehler: null };

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
  assert.match(html, /<input type="checkbox" id="huelle-tor" \/> <span data-i18n="set\.torHaken">/);
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
