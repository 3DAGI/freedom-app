/**
 * Schritt 11.2b: Werbelink mit kurzem Namen (NIP-05). Der Link trägt den
 * geprüften eigenen Namen statt des Schlüssels (auf seiner Domain nur den Teil
 * vor dem @); der Geworbene merkt ihn vor und fragt die Domain genau einmal.
 * Der erste Werber bleibt, die Lightning-Adresse kommt aus dem Link oder dem
 * signierten Profil.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SICHERUNG_EINTRAEGE, type Nip05Ergebnis, type Nip05Kennung } from "@freedomstack/protocol";
import {
  LS_WERBER, LS_WERBER_LN, LS_WERBER_NAME, LS_WERBE_NAME,
  eigenerWerbeName, loeseWerberName, merkeWerbeName, merkeWerber, werbeLink, werbeRef,
} from "../src/werbung.js";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const ICH = "ab".repeat(32);
const WERBER = "cd".repeat(32);
const speicher = (start: Record<string, string> = {}) => {
  const m = new Map(Object.entries(start));
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
};
/** Auflöser-Attrappe: zählt die Abfragen. */
const aufloeser = (ergebnis: Nip05Ergebnis) => {
  const gefragt: string[] = [];
  return { gefragt, loese: async (k: Nip05Kennung) => { gefragt.push(`${k.name}@${k.domain}`); return ergebnis; } };
};
const keinProfil = async () => undefined;

test("Werber: Link mit dem geprüften Namen – auf seiner Domain nur der Teil vor dem @; fremder Schlüssel → wieder der Schlüssel", () => {
  const s = speicher();
  assert.equal(werbeRef(s, ICH, "https://app.example/freedom.html"), ICH, "ohne Namen der Schlüssel");
  merkeWerbeName(s, { name: "alice", domain: "kopie.example" }, ICH);
  assert.equal(werbeRef(s, ICH, "https://app.example/freedom.html"), "alice@kopie.example");
  assert.equal(werbeRef(s, ICH, "https://kopie.example/freedom.html"), "alice");
  assert.equal(werbeLink("https://app.example/freedom.html", werbeRef(s, ICH, "https://app.example/freedom.html")),
    "https://app.example/freedom.html?ref=alice%40kopie.example");
  // Nach einem Wechsel der Identität gilt der Name nicht mehr
  assert.equal(werbeRef(s, WERBER, "https://app.example/"), WERBER);
  assert.deepEqual(eigenerWerbeName(s), { name: "alice", domain: "kopie.example" }, "ohne Schlüssel: für die Anzeige im Feld");
  assert.equal(eigenerWerbeName(speicher({ [LS_WERBE_NAME]: "kaputt" })), undefined);
  assert.ok(SICHERUNG_EINTRAEGE.includes(LS_WERBE_NAME), "ein neues Gerät wirbt mit demselben Namen (8.12)");
  assert.ok(!SICHERUNG_EINTRAEGE.includes(LS_WERBER_NAME), "der vorgemerkte Name ist nur Übergang");
});

test("Geworbener: Name vormerken, einmal auflösen, dann vergessen – der Werber samt Adresse aus dem Link", async () => {
  const s = speicher();
  merkeWerber("?ref=Alice@Kopie.Example&ln=alice%40kopie.example", s, "app.example");
  assert.equal(s.m.get(LS_WERBER), undefined, "erst nach der Auflösung");
  assert.deepEqual(JSON.parse(s.m.get(LS_WERBER_NAME)!), { name: "alice@kopie.example", ln: "alice@kopie.example" });
  const a = aufloeser({ ok: true, pubkey: WERBER });
  let profilGefragt = 0;
  assert.equal(await loeseWerberName(s, a.loese, async () => { profilGefragt++; return "anders@x.example"; }), "gemerkt");
  assert.equal(s.m.get(LS_WERBER), WERBER);
  assert.equal(s.m.get(LS_WERBER_LN), "alice@kopie.example", "die Adresse aus dem Link");
  assert.equal(profilGefragt, 0, "mit Adresse im Link kein Profil holen");
  assert.equal(s.m.has(LS_WERBER_NAME), false);
  assert.equal(await loeseWerberName(s, a.loese, keinProfil), "kein", "kein zweites Mal");
  assert.deepEqual(a.gefragt, ["alice@kopie.example"]);
});

test("Geworbener: ohne @ gilt die Domain der App; ohne Adresse im Link die aus dem signierten Profil", async () => {
  const s = speicher();
  merkeWerber("?ref=alice", s, "kopie.example");
  const a = aufloeser({ ok: true, pubkey: WERBER });
  assert.equal(await loeseWerberName(s, a.loese, async (pk) => (pk === WERBER ? "alice@kopie.example" : undefined)), "gemerkt");
  assert.deepEqual(a.gefragt, ["alice@kopie.example"]);
  assert.equal(s.m.get(LS_WERBER_LN), "alice@kopie.example");
  // Von einer IP oder localhost geladen: kein Name ohne Domain
  for (const herkunft of ["127.0.0.1", "localhost", undefined]) {
    const t = speicher();
    merkeWerber("?ref=alice", t, herkunft);
    assert.equal(t.m.size, 0, String(herkunft));
  }
  // Unsinn im Namen: nichts gemerkt
  const u = speicher();
  merkeWerber("?ref=<script>@kopie.example", u, "kopie.example");
  assert.equal(u.m.size, 0);
  // Ein Profil, das nicht erreichbar ist, bricht nichts ab
  const p = speicher();
  merkeWerber("?ref=alice@kopie.example", p);
  assert.equal(await loeseWerberName(p, a.loese, async () => { throw new Error("offline"); }), "gemerkt");
  assert.equal(p.m.get(LS_WERBER), WERBER);
  assert.equal(p.m.has(LS_WERBER_LN), false);
});

test("Der erste Werber bleibt; eine gescheiterte Abfrage wird nie wiederholt", async () => {
  // Schon ein Werber: der Name wird gar nicht erst vorgemerkt
  const s = speicher({ [LS_WERBER]: ICH });
  merkeWerber("?ref=alice@kopie.example", s);
  assert.equal(s.m.has(LS_WERBER_NAME), false);
  // Vorgemerkter Name, dann ein Link mit Schlüssel: der Name wird nicht mehr gefragt
  const t = speicher();
  merkeWerber("?ref=alice@kopie.example", t);
  merkeWerber(`?ref=${ICH}`, t);
  const a = aufloeser({ ok: true, pubkey: WERBER });
  assert.equal(await loeseWerberName(t, a.loese, keinProfil), "schon-werber");
  assert.equal(t.m.get(LS_WERBER), ICH);
  assert.deepEqual(a.gefragt, []);
  // Zwei Namen-Links: nur der erste zählt
  const u = speicher();
  merkeWerber("?ref=alice@kopie.example", u);
  merkeWerber("?ref=mallory@boese.example", u);
  assert.equal(JSON.parse(u.m.get(LS_WERBER_NAME)!).name, "alice@kopie.example");
  // Gescheitert: vergessen, kein Werber, kein zweiter Versuch
  for (const fall of ["nicht-erreichbar", "unbekannt", "ungueltig", "zu-gross"] as const) {
    const v = speicher();
    merkeWerber("?ref=alice@kopie.example", v);
    const b = aufloeser({ ok: false, fall });
    assert.equal(await loeseWerberName(v, b.loese, keinProfil), fall);
    assert.equal(await loeseWerberName(v, b.loese, keinProfil), "kein");
    assert.equal(v.m.size, 0, fall);
    assert.equal(b.gefragt.length, 1);
  }
  // Kaputter Eintrag: vergessen
  const w = speicher({ [LS_WERBER_NAME]: "{kaputt" });
  assert.equal(await loeseWerberName(w, a.loese, keinProfil), "ungueltig");
  assert.equal(w.m.size, 0);
});

test("Verdrahtet: Link mit Name, Auflösung beim Erfassen, Übernehmen nur mit eigenem Schlüssel", () => {
  const earn = src("../src/shell/tabs/earn.ts");
  assert.match(earn, /link\.value = werbeLink\(basis, werbeRef\(localStorage, pub, basis\), lud16, sol\);/);
  assert.match(earn, /merkeWerber\(window\.location\.search, localStorage, window\.location\.hostname\);\s*void loeseWerberNameJetzt\(\);/);
  assert.match(earn, /loeseWerberName\(localStorage, \(k\) => loeseNip05\(k\),/);
  assert.match(earn, /frageBeiAutoren\(\{ kinds: \[0\], authors: \[pk\]/, "Adresse nur aus dem signierten Profil");
  const ui = src("../src/shell/werben-ui.ts");
  assert.match(ui, /if \(r\.pubkey !== ich\) return melde\(t\("earn\.nameFremd"\), "err"\);\s*merkeWerbeName\(localStorage, k, ich\);/, "gemerkt nur der eigene Schlüssel");
  assert.equal((ui.match(/loeseNip05\(/g) ?? []).length, 1);
  assert.ok(ui.indexOf("loeseNip05(") > ui.indexOf('setzen.addEventListener("click", async'), "Abfrage nur auf Klick");
  assert.doesNotMatch(ui, /innerHTML/);
  assert.match(src("../src/shell/app.ts"), /wireEigeneAdresse\(\);\s*wireWerbeName\(\);/);
});
