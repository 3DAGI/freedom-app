/**
 * D1a: Platzhalter für persönliche Angaben – nur, was eine klare Form hat, und
 * Namen aus dem eigenen Adressbuch; Rücksetzen in der Antwort; nichts geraten.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Zuordnung, ersetzeAngaben } from "../src/platzhalter.js";

test("Klare Formen werden ersetzt und in der Antwort zurückgesetzt", () => {
  const z = new Zuordnung();
  const frage = "Schreib an anna.mueller@example.org (Tel. +49 170 1234567), IBAN DE89 3704 0044 0532 0130 00, "
    + "Karte 4111 1111 1111 1111, Server 192.168.10.20 und 2001:db8::8a2e:370:7334, npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m, "
    + "Rechnung lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypq.";
  const r = ersetzeAngaben(frage, z);
  for (const w of ["anna.mueller@example.org", "+49 170 1234567", "DE89 3704 0044 0532 0130 00", "4111 1111 1111 1111", "192.168.10.20",
    "2001:db8::8a2e:370:7334", "npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m", "lnbc2500u1pvjluezpp5"]) {
    assert.ok(!r.text.includes(w), `${w} ist ersetzt`);
  }
  assert.equal(r.ersetzt, 8);
  assert.match(r.text, /\[EMAIL_1\].*\[PHONE_1\].*\[IBAN_1\].*\[CARD_1\].*\[IP_1\].*\[IP_2\].*\[NOSTR_KEY_1\].*\[LN_INVOICE_1\]/s);
  assert.equal(z.setzeEin(r.text), frage, "die Antwort bekommt die Werte zurück");
  assert.equal(z.setzeEin("Ich habe [EMAIL_1] und [PHONE_1] notiert, [EMAIL_9] kenne ich nicht."),
    "Ich habe anna.mueller@example.org und +49 170 1234567 notiert, [EMAIL_9] kenne ich nicht.");
});

test("Je Unterhaltung stabil: derselbe Wert ergibt denselben Platzhalter, auch im Verlauf", () => {
  const z = new Zuordnung();
  const a = ersetzeAngaben("Mail an bob@example.com", z).text;
  const b = ersetzeAngaben("Du: Mail an bob@example.com\nKI: ok\n\nUnd an eve@example.com und bob@example.com", z).text;
  assert.equal(a, "Mail an [EMAIL_1]");
  assert.equal(b, "Du: Mail an [EMAIL_1]\nKI: ok\n\nUnd an [EMAIL_2] und [EMAIL_1]");
  assert.equal(z.anzahl, 2);
  assert.equal(new Zuordnung().setzeEin("[EMAIL_1]"), "[EMAIL_1]", "eine neue Unterhaltung kennt die alten nicht");
});

test("Namen nur aus dem Adressbuch, als ganze Wörter, ab drei Zeichen; nichts geraten", () => {
  const z = new Zuordnung();
  const r = ersetzeAngaben("Anna Müller und anna treffen Annabell, Jo und Ed bei Tim.", z, ["Anna Müller", "Jo", " Tim ", "Ed"]);
  assert.equal(r.text, "[NAME_1] und [NAME_2] treffen Annabell, Jo und Ed bei [NAME_3].");
  assert.equal(z.setzeEin(r.text), "Anna Müller und anna treffen Annabell, Jo und Ed bei Tim.");
  assert.equal(ersetzeAngaben("Peter Schmidt wohnt in der Hauptstraße 5.", new Zuordnung()).ersetzt, 0, "ohne Adressbuch kein Name, keine Adresse");
});

test("Prüfsummen und Grenzen: keine Fehltreffer bei Zahlen ohne gültige Form", () => {
  const art = (text: string) => ersetzeAngaben(text, new Zuordnung()).text;
  assert.equal(art("IBAN DE89 3704 0044 0532 0130 00"), "IBAN [IBAN_1]", "Prüfziffer stimmt");
  assert.equal(art("Karte 4111 1111 1111 1111"), "Karte [CARD_1]", "Luhn stimmt");
  assert.equal(art("Nummer 0000 0000 0000 0000"), "Nummer 0000 0000 0000 0000", "lauter gleiche Ziffern sind keine Karte");
  for (const harmlos of [
    "Am 01.02.2024 um 12:30:45 Uhr", "Preis 1999 Euro, 0,5 % Gebühr", "Version 1.2.3 und 10.0", "Bestellnummer 4111 1111 1111 1112",
    "IBAN DE88 3704 0044 0532 0130 00", "Uhrzeit 999.1.1.1", "Hash 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", "[EMAIL_1] steht schon da",
  ]) {
    const z = new Zuordnung();
    assert.equal(ersetzeAngaben(harmlos, z).ersetzt, 0, harmlos);
  }
});
