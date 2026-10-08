/**
 * 6.1a3c: Neue Oberfläche in der Desktop-Hülle installieren – Erkennen der Hülle,
 * Stand lesen, Datei laden und prüfen, Übergabe an die Hülle. Die Prüfung der
 * Belege in der Hülle testet `packages/launcher` (`cargo test`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { buildReleaseManifest, generateKeypair, hashText, signEvent, suchUpdate, type UpdateAngebot } from "@freedomstack/protocol";
import { alsText, huellenArt, huellenAufruf, huellenStand, huellenStandZeilen, ladeOberflaeche, leseHuellenStand, rueckwegText, uebergibHuelle } from "../src/shell/oberflaeche-huelle.js";
import { setLang } from "../src/i18n.js";

const HTML = "﻿<!doctype html><title>Fassung 2</title><p>„ü“ 😀</p>\n";
const DATEN = new TextEncoder().encode(HTML);

function angebot(inhalt = HTML): UpdateAngebot {
  const [a, b] = [generateKeypair(), generateKeypair()];
  const ev = (kp: typeof a) => signEvent(buildReleaseManifest({
    version: "2.0.0",
    releasedAt: 2000,
    artifacts: [{ name: "freedom.html", sha256: hashText(inhalt), sizeBytes: new TextEncoder().encode(inhalt).length }],
    sources: ["https://eins.example/freedom.html", "https://zwei.example/freedom.html", "https://drei.example/freedom.html"],
  }, kp.pk, 1_700_000_000), kp.sk);
  const r = suchUpdate([ev(a), ev(b)], [a.pk, b.pk], { sha256: hashText("<p>laufend</p>") });
  assert.ok("angebot" in r, JSON.stringify(r));
  return r.angebot;
}

const STAND = { quelle: "installiert", version: "2.0.0", sha256: "a".repeat(64), releasedAt: 2000, nurBeigelegt: false, vorher: true };

test("6.1a3c: die Hülle nur mit Kennung und Tauri-Aufruf", async () => {
  assert.equal(huellenAufruf({}), null);
  assert.equal(huellenAufruf({ __FREEDOM_NATIVE__: { huelle: "desktop" } }), null);
  assert.equal(huellenAufruf({ __TAURI_INTERNALS__: { invoke: async () => 1 } }), null, "Tauri allein ist nicht diese Hülle");
  assert.equal(huellenAufruf({ __FREEDOM_NATIVE__: { huelle: "ios" }, __TAURI_INTERNALS__: { invoke: async () => 1 } }), null, "nur bekannte Hüllen");
  // Seit 6.1c auch Android
  assert.ok(huellenAufruf({ __FREEDOM_NATIVE__: { huelle: "android" }, __TAURI_INTERNALS__: { invoke: async () => 1 } }));
  assert.deepEqual([huellenArt({}), huellenArt({ __FREEDOM_NATIVE__: { huelle: "desktop" } }), huellenArt({ __FREEDOM_NATIVE__: { huelle: "android" } }), huellenArt({ __FREEDOM_NATIVE__: { huelle: 1 } })], [null, "desktop", "android", null]);
  const innen = {
    gesehen: [] as unknown[],
    async invoke(this: { gesehen: unknown[] }, befehl: string, argumente?: unknown) {
      this.gesehen.push([befehl, argumente]);
      return STAND;
    },
  };
  const aufruf = huellenAufruf({ __FREEDOM_NATIVE__: { huelle: "desktop" }, __TAURI_INTERNALS__: innen });
  assert.ok(aufruf);
  assert.deepEqual(await huellenStand(aufruf), STAND);
  assert.deepEqual(innen.gesehen, [["oberflaeche_stand", undefined]], "aufgerufen mit dem Objekt der Hülle als this");
  assert.equal(await huellenStand(null), null, "im Browser kein Stand");
  assert.equal(await huellenStand(async () => { throw new Error("weg"); }), null);
});

test("6.1a3c: der Stand der Hülle wird streng gelesen", () => {
  assert.deepEqual(leseHuellenStand(STAND), STAND);
  assert.deepEqual(leseHuellenStand({ ...STAND, quelle: "beigelegt", version: null, releasedAt: 0 }), { ...STAND, quelle: "beigelegt", version: null, releasedAt: 0 });
  for (const kaputt of [
    null, "x", { ...STAND, quelle: "netz" }, { ...STAND, sha256: "A".repeat(64) }, { ...STAND, sha256: "a".repeat(63) },
    { ...STAND, releasedAt: -1 }, { ...STAND, releasedAt: 1.5 }, { ...STAND, releasedAt: "2000" }, { ...STAND, version: "<b>" },
    { ...STAND, version: 2 }, { ...STAND, vorher: "ja" }, { ...STAND, nurBeigelegt: undefined },
  ]) assert.equal(leseHuellenStand(kaputt), null, JSON.stringify(kaputt));
});

test("6.1c: der Rückweg je Hülle – Desktop über den Start, Android über „Cache leeren“", () => {
  setLang("de");
  try {
    const beigelegt = { ...STAND, quelle: "beigelegt", version: null, vorher: true } as const;
    const installiert = { ...STAND, quelle: "installiert", vorher: true } as const;
    assert.deepEqual(huellenStandZeilen(installiert, "desktop"), ["Oberfläche dieser App: installiert, Version 2.0.0.", "Zurück zur vorigen Fassung: die Desktop-App mit --oberflaeche=vorher starten."]);
    // Android kennt keine Startargumente: kein --oberflaeche, aber der Weg über den Cache
    const android = huellenStandZeilen(installiert, "android");
    assert.equal(android.length, 2);
    assert.match(android[1]!, /Cache leeren/);
    assert.ok(android.every((z) => !z.includes("--oberflaeche")));
    assert.deepEqual(huellenStandZeilen(beigelegt, "android"), ["Oberfläche dieser App: wie beigelegt."], "beigelegt: kein Rückweg nötig");
    assert.match(rueckwegText("desktop"), /--oberflaeche=vorher/);
    assert.match(rueckwegText("android"), /Cache leeren/);
  } finally {
    setLang("en");
  }
});

test("6.1a3c: geladen wird Quelle für Quelle, nur genau die angebotene Datei", async () => {
  const a = angebot();
  const gefragt: [string, RequestInit][] = [];
  const antworten: Record<string, () => Response> = {
    "https://eins.example/freedom.html": () => new Response(DATEN.map((b, i) => (i === 5 ? b ^ 1 : b))), // gleiche Größe, andere Datei
    "https://zwei.example/freedom.html": () => new Response(new Uint8Array(DATEN.length + 1)), // zu groß
    "https://drei.example/freedom.html": () => new Response(DATEN),
  };
  const daten = await ladeOberflaeche(a, async (u, o) => {
    gefragt.push([u, o]);
    return antworten[u]!();
  });
  assert.deepEqual(daten, DATEN);
  assert.deepEqual(gefragt.map(([u]) => u), a.quellen);
  assert.ok(gefragt.every(([, o]) => o.credentials === "omit" && o.cache === "no-store" && o.referrerPolicy === "no-referrer"));
  // Keine passt: nichts
  assert.equal(await ladeOberflaeche(a, async () => new Response("<p>fremd</p>")), null);
  assert.equal(await ladeOberflaeche(a, async () => new Response(DATEN, { status: 404 })), null);
  assert.equal(await ladeOberflaeche(a, async () => { throw new TypeError("Netz"); }), null);
});

test("6.1a3c: als Text gehen genau dieselben Bytes an die Hülle – auch das BOM", () => {
  const text = alsText(DATEN);
  assert.ok(text?.startsWith("﻿"));
  assert.deepEqual(new TextEncoder().encode(text!), DATEN);
  assert.equal(alsText(new Uint8Array([0x3c, 0xff, 0x3e])), null, "kein gültiges UTF-8");
  assert.equal(alsText(new Uint8Array([0xed, 0xa0, 0x80])), null, "kein einzelnes Surrogat");
});

test("6.1a3c: Übergabe an die Hülle – Datei und Belege, Fehler nur als Kennung", async () => {
  const a = angebot();
  let gesendet: unknown;
  const ok = await uebergibHuelle(a, DATEN, async (befehl, argumente) => {
    gesendet = [befehl, argumente];
    return STAND;
  });
  assert.deepEqual(ok, { ok: true, stand: STAND });
  assert.deepEqual(gesendet, ["oberflaeche_installieren", { html: HTML, belege: a.belege }]);
  assert.equal(a.belege.length, 2);

  for (const kennung of ["kein-beleg", "zu-wenig", "abweichend", "nicht-neuer", "zu-gross", "keine-ablage", "ablage"]) {
    assert.deepEqual(await uebergibHuelle(a, DATEN, async () => { throw kennung; }), { ok: false, fehler: kennung });
  }
  assert.deepEqual(await uebergibHuelle(a, DATEN, async () => { throw "<script>"; }), { ok: false, fehler: "unbekannt" });
  assert.deepEqual(await uebergibHuelle(a, DATEN, async () => ({ quelle: "irgendwo" })), { ok: false, fehler: "unbekannt" });
  assert.deepEqual(await uebergibHuelle(a, DATEN, null), { ok: false, fehler: "keine-huelle" });

  let gerufen = false;
  const nie = async () => { gerufen = true; return STAND; };
  assert.deepEqual(await uebergibHuelle(a, new TextEncoder().encode("<p>fremd</p>"), nie), { ok: false, fehler: "laden" });
  const kaputt = new Uint8Array([0x3c, 0xff, 0x3e]); // passt zum Angebot, ist aber kein UTF-8
  const fuerKaputt = { ...a, sha256: createHash("sha256").update(kaputt).digest("hex"), sizeBytes: kaputt.length };
  assert.deepEqual(await uebergibHuelle(fuerKaputt, kaputt, nie), { ok: false, fehler: "kodierung" });
  assert.equal(gerufen, false, "Fremdes und Kaputtes erreicht die Hülle nie");
});

test("Verdrahtung (6.1a3c): Installieren nur in der Hülle, nach Rückfrage, nie zurück aus der App", () => {
  const s = readFileSync(new URL("../src/shell/tabs/settings.ts", import.meta.url), "utf8");
  assert.match(s, /const seit = stand && stand\.releasedAt > 0 \? \{ releasedAt: stand\.releasedAt \} : \{\};\n\s*const update = suchUpdate\(events, TRUSTED_SIGNERS, \{ sha256: hash, \.\.\.seit \}\);/, "die Hülle nennt den Zeitpunkt der laufenden Fassung, 0 heißt unbekannt");
  assert.match(s, /if \(stand && art && neueste\) \{/, "der Knopf nur in der Hülle und nur mit Angebot");
  assert.match(s, /void installiereNeue\(neueste, box, rueckwegText\(art\)\)/, "die Rückfrage nennt den Rückweg dieser Hülle");
  assert.match(s, /const hash = stand \? stand\.sha256 : hashText\(await \(await fetch\(location\.href, \{ cache: "no-store" \}\)\)\.text\(\)\);/, "in der Hülle deren Prüfsumme – die CSP lässt kein fetch aufs eigene Schema zu");
  const knopf = s.slice(s.indexOf("async function installiereNeue("));
  assert.ok(knopf.length > 0);
  const frage = knopf.indexOf("await bestaetige(");
  const uebergabe = knopf.indexOf("uebergibHuelle(");
  assert.ok(knopf.indexOf("ladeOberflaeche(") < frage && frage > 0 && frage < uebergabe, "laden und prüfen, fragen, dann erst übergeben");
  // Nur zwei Kommandos – und keins, das zurückschaltet
  const quellen = readdirSync(new URL("../src/shell/", import.meta.url), { recursive: true }).filter((f) => String(f).endsWith(".ts"));
  const kommandos = new Set<string>();
  for (const f of quellen) {
    for (const m of readFileSync(new URL(`../src/shell/${f}`, import.meta.url), "utf8").matchAll(/"(oberflaeche_[a-z_]+)"/g)) kommandos.add(m[1]!);
  }
  assert.deepEqual([...kommandos].sort(), ["oberflaeche_installieren", "oberflaeche_stand"]);
});
