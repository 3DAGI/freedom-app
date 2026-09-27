/**
 * Schritt 5.1.3b: Der Werbelink trägt die Lightning-Adresse des Werbers; die
 * App des Geworbenen merkt sie und zahlt ihm seinen Anteil direkt. Der erste
 * Werber bleibt; fremde Links verdrängen ihn nicht, auch nicht seine Adresse.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SICHERUNG_EINTRAEGE } from "@freedomstack/protocol";
import { LS_WERBER, LS_WERBER_LN, merkeWerber, werbeLink, werberZahlziel } from "../src/werbung.js";

const pk = (c: string) => c.repeat(64);
const speicher = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

test("Werbelink: Schlüssel und Lightning-Adresse; ungültige Adresse fehlt; alte Parameter weg", () => {
  const mit = new URL(werbeLink("https://app.example/freedom.html?ref=alt#x", pk("a"), "Ich@Wallet.example"));
  assert.equal(mit.searchParams.get("ref"), pk("a"));
  assert.equal(mit.searchParams.get("ln"), "ich@wallet.example");
  assert.equal(mit.hash, "");
  assert.equal(new URL(werbeLink("https://app.example/", pk("a"))).searchParams.has("ln"), false);
  assert.equal(new URL(werbeLink("https://app.example/", pk("a"), "ich@localhost")).searchParams.has("ln"), false, "kein lokaler Host");
});

test("Merken: der erste Werber gilt, seine Adresse nur zu ihm; Unsinn wird nicht gemerkt", () => {
  const s = speicher();
  merkeWerber("?ref=nichthex&ln=a@b.example", s);
  assert.equal(s.m.size, 0);
  merkeWerber(`?ref=${pk("a")}`, s);
  assert.equal(s.getItem(LS_WERBER), pk("a"));
  merkeWerber(`?ref=${pk("b")}&ln=boese@evil.example`, s);
  assert.equal(s.getItem(LS_WERBER), pk("a"), "ein fremder Link verdrängt ihn nicht");
  assert.equal(s.getItem(LS_WERBER_LN), null, "und schiebt keine Adresse unter");
  merkeWerber(`?ref=${pk("a")}&ln=anna@wallet.example`, s);
  assert.equal(s.getItem(LS_WERBER_LN), "anna@wallet.example", "Adresse nachgereicht vom selben Werber");
  merkeWerber(`?ref=${pk("a")}&ln=andere@wallet.example`, s);
  assert.equal(s.getItem(LS_WERBER_LN), "anna@wallet.example", "nicht überschrieben");
  const t = speicher();
  merkeWerber(`?ref=${pk("c")}&ln=x@127.0.0.1`, t);
  assert.equal(t.getItem(LS_WERBER_LN), null, "nur plausible Lightning-Adressen");
});

test("Zahlziel des Werbers: nur mit Adresse, nie an sich selbst; auf neuen Geräten über die Sicherung", () => {
  const s = speicher();
  assert.equal(werberZahlziel(s), undefined);
  merkeWerber(`?ref=${pk("a")}`, s);
  assert.equal(werberZahlziel(s), undefined, "ohne Adresse bleibt der Anteil beim Provider");
  merkeWerber(`?ref=${pk("a")}&ln=anna@wallet.example`, s);
  assert.deepEqual(werberZahlziel(s, pk("d")), { lud16: "anna@wallet.example" });
  assert.equal(werberZahlziel(s, pk("a")), undefined, "wer sich selbst wirbt, zahlt sich nichts");
  assert.ok(SICHERUNG_EINTRAEGE.includes(LS_WERBER) && SICHERUNG_EINTRAEGE.includes(LS_WERBER_LN));
});
