/**
 * Schritt 11.2a: Werbelink mit eigener Domain. Adresse nur https, ohne
 * Zugangsdaten, nicht lokal; der Werbelink trägt sie, der Geworbene merkt den
 * Werber wie bisher. „Prüfen“ hält die Datei dort gegen die signierten
 * Manifeste (k von n) und liest die Spiegel-Datei – nie geworfen, ehrlich
 * „nicht geprüft“, wenn nichts bürgt oder die Abfrage scheitert.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SICHERUNG_EINTRAEGE, buildReleaseManifest, generateKeypair, hashBytes, parseReleaseManifest, signEvent,
} from "@freedomstack/protocol";
import { KOPIE_MAX_BYTES, LS_EIGENE_ADRESSE, eigeneBasis, pruefeEigeneAdresse, pruefeKopie } from "../src/eigene-adresse.js";
import { LS_WERBER, LS_WERBER_LN, merkeWerber, werbeLink } from "../src/werbung.js";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const speicher = (start: Record<string, string> = {}) => {
  const m = new Map(Object.entries(start));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

test("Adresse: nur https, ohne Zugangsdaten, nicht lokal; Suchteil und Anker fallen weg", () => {
  assert.deepEqual(pruefeEigeneAdresse(" https://Kopie.Example/freedom.html?x=1#oben "), { ok: true, basis: "https://kopie.example/freedom.html" });
  assert.deepEqual(pruefeEigeneAdresse("https://kopie.example"), { ok: true, basis: "https://kopie.example/" });
  assert.deepEqual(pruefeEigeneAdresse("https://93.184.216.34/app/"), { ok: true, basis: "https://93.184.216.34/app/" });
  const fall = (e: string) => { const r = pruefeEigeneAdresse(e); return r.ok ? "ok" : r.fall; };
  assert.equal(fall(""), "leer");
  assert.equal(fall("   "), "leer");
  assert.equal(fall("kopie.example/freedom.html"), "ungueltig");
  assert.equal(fall("http://kopie.example/"), "kein-https");
  assert.equal(fall("javascript:alert(1)"), "kein-https");
  assert.equal(fall("ftp://kopie.example/"), "kein-https");
  assert.equal(fall("https://ich:geheim@kopie.example/"), "zugangsdaten");
  for (const lokal of ["https://localhost/", "https://app.localhost/", "https://127.0.0.1/", "https://192.168.1.20/", "https://10.0.0.1/", "https://[::1]/", "https://intranet/", "https://drucker.local/"]) {
    assert.equal(fall(lokal), "lokal", lokal);
  }
});

test("Werbelink trägt die eigene Adresse; der Geworbene merkt Werber und Lightning-Adresse wie bisher", () => {
  const pk = "ab".repeat(32);
  const s = speicher({ [LS_EIGENE_ADRESSE]: "https://kopie.example/freedom.html" });
  const basis = eigeneBasis(s);
  assert.equal(basis, "https://kopie.example/freedom.html");
  const link = werbeLink(basis!, pk, "werber@kopie.example");
  assert.equal(link, `https://kopie.example/freedom.html?ref=${pk}&ln=werber%40kopie.example`);
  const geworben = speicher();
  merkeWerber(new URL(link).search, geworben);
  assert.equal(geworben.m.get(LS_WERBER), pk);
  assert.equal(geworben.m.get(LS_WERBER_LN), "werber@kopie.example");
  // Eine gespeicherte, inzwischen ungültige Adresse zählt nicht
  assert.equal(eigeneBasis(speicher({ [LS_EIGENE_ADRESSE]: "http://kopie.example/" })), undefined);
  assert.equal(eigeneBasis(speicher()), undefined);
  assert.ok(SICHERUNG_EINTRAEGE.includes(LS_EIGENE_ADRESSE), "ein neues Gerät wirbt mit derselben Adresse (8.12)");
});

/** Server-Attrappe: Pfad → Antwort; alles andere 404. */
function server(dateien: Record<string, Response | (() => never)>) {
  const gefragt: string[] = [];
  return {
    gefragt,
    holen: async (url: string) => {
      gefragt.push(url);
      const d = dateien[new URL(url).pathname];
      if (typeof d === "function") return d();
      return d ? d.clone() : new Response("nicht da", { status: 404 });
    },
  };
}

async function manifeste(html: Uint8Array, anzahl: number) {
  const sha256 = await hashBytes(html);
  const signierer = Array.from({ length: anzahl }, () => generateKeypair());
  const ms = signierer.map((kp) => parseReleaseManifest(signEvent(buildReleaseManifest({
    version: "1.2.3", releasedAt: 1_790_000_000, artifacts: [{ name: "freedom.html", sha256, sizeBytes: html.byteLength }], sources: [],
  }, kp.pk), kp.sk)));
  return { ms, pks: signierer.map((kp) => kp.pk) };
}

test("Prüfen: echt nur mit k Signierern; Hosting-Anteil aus der Spiegel-Datei dort", async () => {
  const html = new TextEncoder().encode("<!doctype html><title>FreedomStack</title>");
  const spiegel = { version: 1, zahlziel: { lud16: "hosting@kopie.example" } };
  const s = server({ "/freedom.html": new Response(html), "/freedom-spiegel.json": Response.json(spiegel) });
  const { ms, pks } = await manifeste(html, 2);
  const echt = await pruefeKopie("https://kopie.example/freedom.html", ms, pks, s.holen);
  assert.equal(echt.pruefung?.status, "echt");
  assert.equal(echt.pruefung?.version, "1.2.3");
  assert.deepEqual(echt.hosting, { lud16: "hosting@kopie.example" });
  assert.deepEqual(s.gefragt, ["https://kopie.example/freedom-spiegel.json", "https://kopie.example/freedom.html"]);

  // Ein Signierer reicht nicht; ohne vertraute Signierer „kein Manifest“ – beides nicht „echt“
  const einer = await manifeste(html, 1);
  assert.equal((await pruefeKopie("https://kopie.example/freedom.html", einer.ms, einer.pks, s.holen)).pruefung?.fall, "zu-wenig");
  const ohne = await pruefeKopie("https://kopie.example/freedom.html", ms, [], s.holen);
  assert.equal(ohne.pruefung?.status, "unbekannt");
  assert.equal(ohne.pruefung?.fall, "kein-manifest");

  // Eine veränderte Datei ist „abweichend“
  const falsch = server({ "/freedom.html": new Response("<!doctype html><title>anders</title>") });
  const abw = await pruefeKopie("https://kopie.example/freedom.html", ms, pks, falsch.holen);
  assert.equal(abw.pruefung?.status, "abweichend");
  assert.equal(abw.hosting, null, "ohne Spiegel-Datei kein Hosting-Anteil");
});

test("Prüfen: Platzhalter, nicht erreichbar (CORS), Fehlerstatus und zu groß – nie geworfen", async () => {
  const platzhalter = server({
    "/freedom.html": new Response("x"),
    "/freedom-spiegel.json": Response.json({ version: 1, zahlziel: { lud16: "PLATZHALTER:hosting-lightning-adresse" } }),
  });
  assert.equal((await pruefeKopie("https://kopie.example/freedom.html", [], [], platzhalter.holen)).hosting, null);

  const cors = server({ "/freedom.html": () => { throw new TypeError("Failed to fetch"); }, "/freedom-spiegel.json": () => { throw new TypeError("Failed to fetch"); } });
  assert.deepEqual(await pruefeKopie("https://kopie.example/freedom.html", [], [], cors.holen), { pruefung: null, fall: "nicht-erreichbar", hosting: null });

  const fehler = server({ "/freedom.html": new Response("kaputt", { status: 500 }) });
  assert.equal((await pruefeKopie("https://kopie.example/freedom.html", [], [], fehler.holen)).fall, "nicht-erreichbar");

  const riesig = new Response("x", { headers: { "content-length": String(KOPIE_MAX_BYTES + 1) } });
  const z = await pruefeKopie("https://kopie.example/freedom.html", [], [], async (url) => (url.endsWith("/freedom.html") ? riesig : new Response("", { status: 404 })));
  assert.equal(z.fall, "zu-gross");
  assert.equal(riesig.bodyUsed, false, "zu groß angekündigt: gar nicht erst gelesen");
});

test("Verdrahtet: Werbelink mit eigener Adresse, Prüfen nur auf Knopfdruck, Signierer an einer Stelle", () => {
  const earn = src("../src/shell/tabs/earn.ts");
  assert.match(earn, /link\.value = werbeLink\(eigeneBasis\(localStorage\) \?\? window\.location\.origin \+ window\.location\.pathname, pub, lud16\);/);
  const ui = src("../src/shell/werben-ui.ts");
  assert.equal((ui.match(/pruefeKopie\(/g) ?? []).length, 1);
  assert.ok(ui.indexOf("pruefeKopie(") > ui.indexOf('pruefen.addEventListener("click"'), "nur im Klick – die Abfrage nennt dem Server die IP");
  assert.match(ui, /const r = pruefeEigeneAdresse\(feld\.value\);\s*if \(!r\.ok\) return melde\(t\(FALL\[r\.fall\]\), "err"\);\s*localStorage\.setItem\(LS_EIGENE_ADRESSE, r\.basis\);/, "gemerkt wird nur Geprüftes");
  assert.doesNotMatch(ui, /innerHTML/);
  assert.match(src("../src/shell/app.ts"), /setupReferral\(\);\s*wireEigeneAdresse\(\);/);
  const settings = src("../src/shell/tabs/settings.ts");
  assert.doesNotMatch(settings, /const TRUSTED_SIGNERS/, "die Liste steht nur in release-signierer.ts");
  assert.match(settings, /import \{ TRUSTED_SIGNERS, ladeManifeste \} from "\.\.\/\.\.\/release-signierer\.js";/);
});
