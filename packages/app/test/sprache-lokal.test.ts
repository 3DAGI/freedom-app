/**
 * B-38c3: Text aus Sprache auf diesem Gerät – ein whisper-server auf diesem Rechner (SP-W1 A). Geprüft gegen die Form von
 * whisper.cpp v1.9.5 (`examples/server/server.cpp`: `GET /health`, `POST /inference` mit `file`, `language`,
 * `response_format=json` → `{"text": …}`); den echten Server hat B-38c3 einmal von Hand dagegen laufen lassen.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SPRACHE_GRENZEN, baueWav, pruefeWav } from "@freedomstack/protocol";
import { setLang, t } from "../src/i18n.js";
import {
  LS_SPRACHE_LOKAL, leseSprachServerAntwort, lokaleSprachAdresse, pruefeSprachServer, textAufDiesemGeraet,
} from "../src/sprache-lokal.js";

const speicher = (wert: string | null) => ({ getItem: (k: string) => (k === LS_SPRACHE_LOKAL ? wert : null) });
const antwort = (status: number, json: unknown) => new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });

test("B-38c3: nur eine Adresse dieses Rechners gilt – sonst gibt es „Dieses Gerät“ nicht", () => {
  assert.equal(lokaleSprachAdresse(speicher("http://127.0.0.1:8080")), "http://127.0.0.1:8080");
  assert.equal(lokaleSprachAdresse(speicher("http://localhost:9000/irgendwo")), "http://localhost:9000", "nur der Ursprung");
  for (const fremd of [null, "", "http://192.168.1.5:8080", "https://whisper.example.org", "http://user:pw@127.0.0.1:8080", "file:///etc/passwd"]) {
    assert.equal(lokaleSprachAdresse(speicher(fremd)), null, String(fremd));
  }
});

test("B-38c3: prüfen fragt nur /health – bereit, lädt, nicht erreichbar, fremd ohne Anfrage", async () => {
  const gefragt: string[] = [];
  const holen = (r: Response | Error) => async (url: string) => {
    gefragt.push(url);
    if (r instanceof Error) throw r;
    return r;
  };
  assert.equal(await pruefeSprachServer("http://127.0.0.1:8080", holen(antwort(200, { status: "ok" }))), "bereit");
  assert.equal(await pruefeSprachServer("http://127.0.0.1:8080", holen(antwort(503, { status: "loading model" }))), "laedt");
  assert.equal(await pruefeSprachServer("http://127.0.0.1:8080", holen(antwort(200, { status: "anders" }))), "nicht-erreichbar");
  assert.equal(await pruefeSprachServer("http://127.0.0.1:8080", holen(new TypeError("fetch failed"))), "nicht-erreichbar");
  assert.deepEqual(gefragt, Array(4).fill("http://127.0.0.1:8080/health"));
  assert.equal(await pruefeSprachServer("http://10.0.0.2:8080", holen(antwort(200, { status: "ok" }))), "fremd");
  assert.equal(gefragt.length, 4, "eine fremde Adresse wird nie gefragt");
});

test("B-38c3: der Ton geht als WAV in der Form von baueWav() mit Sprache und JSON-Wunsch nur an den Server", async () => {
  const wav = baueWav(Int16Array.from({ length: 1600 }, (_, i) => (i % 2 ? 1000 : -1000)));
  let gesendet: { url: string; init?: RequestInit } | null = null;
  const text = await textAufDiesemGeraet({
    adresse: "http://127.0.0.1:8080", wav, sprache: "de",
    holen: async (url, init) => { gesendet = { url, init }; return antwort(200, { text: " Hallo Welt\n" }); },
  });
  assert.equal(text, "Hallo Welt");
  const g = gesendet as unknown as { url: string; init: RequestInit };
  assert.equal(g.url, "http://127.0.0.1:8080/inference");
  assert.equal(g.init.method, "POST");
  assert.equal(g.init.credentials, "omit");
  const form = g.init.body as FormData;
  assert.deepEqual([...form.keys()], ["file", "language", "response_format"]);
  assert.equal(form.get("language"), "de");
  assert.equal(form.get("response_format"), "json");
  const datei = form.get("file") as File;
  assert.equal(datei.name, "ton.wav");
  assert.deepEqual(pruefeWav(new Uint8Array(await datei.arrayBuffer())), { ok: true, sekunden: 0.1 });
});

test("B-38c3: Fehler mit eigenem Text – fremde Adresse ohne Anfrage, nicht erreichbar, HTTP, unlesbare Antwort", async () => {
  setLang("de");
  const wav = baueWav(Int16Array.of(1, 2, 3));
  let anfragen = 0;
  const holen = (r: Response | Error) => async () => { anfragen++; if (r instanceof Error) throw r; return r; };
  await assert.rejects(textAufDiesemGeraet({ adresse: "http://10.0.0.2:8080", wav, sprache: "auto", holen: holen(antwort(200, { text: "x" })) }),
    { message: t("set.spracheLokalFremd") });
  assert.equal(anfragen, 0);
  await assert.rejects(textAufDiesemGeraet({ adresse: "http://127.0.0.1:8080", wav, sprache: "auto", holen: holen(new TypeError("fetch failed")) }),
    { message: t("set.spracheLokalNichtErreichbar", { adresse: "http://127.0.0.1:8080" }) });
  await assert.rejects(textAufDiesemGeraet({ adresse: "http://127.0.0.1:8080", wav, sprache: "auto", holen: holen(antwort(400, { error: "<b>x</b>" })) }),
    { message: t("set.spracheLokalHttp", { status: 400 }) }, "nie Text des Servers");
  await assert.rejects(textAufDiesemGeraet({ adresse: "http://127.0.0.1:8080", wav, sprache: "auto", holen: holen(antwort(200, { segments: [] })) }),
    { message: t("komm.alsTextUnlesbarAntwort") });
});

test("B-38c3: die Antwort streng – Text, Länge, keine Steuerzeichen außer Zeilenumbruch", () => {
  assert.equal(leseSprachServerAntwort({ text: " eins\nzwei " }), "eins\nzwei");
  assert.equal(leseSprachServerAntwort({ text: "" }), "", "Stille");
  for (const kaputt of [null, [], "text", { text: 3 }, { text: "a\u0007b" }, { text: "a\tb" }, { text: "x".repeat(SPRACHE_GRENZEN.textZeichen + 1) }]) {
    assert.equal(leseSprachServerAntwort(kaputt), null, JSON.stringify(kaputt)?.slice(0, 40));
  }
});

test("B-38c3: verdrahtet – dieses Gerät vor dem Knoten, Karte nur auf Klick, Texte in beiden Sprachen", () => {
  const ui = readFileSync(new URL("../src/shell/sprache-text-ui.ts", import.meta.url), "utf8");
  const stelle = (s: string) => { const i = ui.indexOf(s); assert.ok(i > 0, s); return i; };
  assert.ok(stelle("alsSpracheWav(bytes, dekoder)") < stelle("textAufDiesemGeraet({ adresse: lokal, wav: ton.wav, sprache })"), "erst wandeln");
  assert.ok(stelle("textAufDiesemGeraet({") < stelle("grundGegenKnoten(k)"), "der Ton verlässt den Rechner nicht, wenn es einen Server gibt");
  assert.match(ui, /if \(!textAusSpracheMoeglich\(\)\) return ton;/);
  const d = readFileSync(new URL("../src/shell/diktieren-ui.ts", import.meta.url), "utf8");
  assert.match(d, /k\.hidden = !textAusSpracheMoeglich\(\)/);
  const karte = readFileSync(new URL("../src/shell/sprache-lokal-ui.ts", import.meta.url), "utf8");
  assert.ok(karte.indexOf("await pruefeSprachServer(roh)") < karte.indexOf("localStorage.setItem(LS_SPRACHE_LOKAL"), "gemerkt erst nach der Antwort");
  assert.match(karte, /if \(s !== "bereit"\) \{/, "nur eine Adresse, die geantwortet hat");
  assert.match(readFileSync(new URL("../src/shell/app.ts", import.meta.url), "utf8"), /wireSpracheLokal\(\);/);
  for (const sprache of ["de", "en"] as const) {
    setLang(sprache);
    for (const k of ["set.spracheLokalTitel", "set.spracheLokalText", "set.spracheLokalAdresse", "set.spracheLokalPruefen", "set.spracheLokalVergessen",
      "set.spracheLokalFragt", "set.spracheLokalBereit", "set.spracheLokalLaedt", "set.spracheLokalNichtErreichbar", "set.spracheLokalFremd",
      "set.spracheLokalHttp", "set.spracheLokalVergessenOk"]) assert.notEqual(t(k), k, `${k} (${sprache})`);
  }
  setLang("de");
});
