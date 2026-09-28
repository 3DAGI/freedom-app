/**
 * Schritt 5.5a: Quittungen und Ruf. Eine Quittung gibt es nur mit Nachweis
 * nach 4.8; „belegt“ nur mit dem angekündigten Knoten bzw. der Auszahlung auf
 * der Kette. Der Ruf kommt nur aus eigenen Quittungen und aus versiegelten
 * Zusammenfassungen der Kontakte.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateKeypair, type NostrEvent } from "../src/event.js";
import { LocalSigner } from "../src/signer.js";
import { giftWrapMitSigner } from "../src/gift-wrap.js";
import {
  KIND_RUF_ZUSAMMENFASSUNG, RUF_KONTAKT_DECKEL, RUF_MAX_PROVIDER, baueRufUmschlaege, berechneRuf, fasseZusammen,
  kanalBelegt, kanalQuittung, leseQuittung, lightningQuittung, oeffneRufUmschlag, type KanalQuittung, type Quittung,
} from "../src/quittung.js";
import { knotenSchluessel, rechnung } from "./bolt11-hilfe.js";

const JETZT = 1_800_000_000;
const PROVIDER = generateKeypair().pk;
const KANAL = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

function bezahlt(sats = 21) {
  const knoten = knotenSchluessel();
  const preimage = crypto.getRandomValues(new Uint8Array(32));
  // „n“ = 100 msat je Einheit: 21 sats = 210n
  return { knoten: bytesToHex(secp256k1.getPublicKey(knoten, true)), rechnung: rechnung(knoten, `lnbc${sats * 10}n`, preimage), preimage: bytesToHex(preimage) };
}

test("5.5a: Lightning-Quittung nur mit passendem Preimage – belegt nur beim angekündigten Knoten", () => {
  const z = bezahlt();
  const ohne = lightningQuittung({ provider: PROVIDER, rechnung: z.rechnung, preimage: z.preimage, auftraege: 3, zeit: JETZT })!;
  assert.equal(ohne.betragMsat, 21_000);
  assert.equal(ohne.stand, "angekuendigt", "Lightning-Adresse: wer den Knoten betreibt, steht nicht fest");
  assert.equal(lightningQuittung({ provider: PROVIDER, rechnung: z.rechnung, preimage: z.preimage, auftraege: 3, zeit: JETZT, providerKnoten: z.knoten })!.stand, "belegt");
  assert.equal(lightningQuittung({ provider: PROVIDER, rechnung: z.rechnung, preimage: z.preimage, auftraege: 3, zeit: JETZT, providerKnoten: bezahlt().knoten })!.stand, "angekuendigt", "anderer Knoten");

  // Ohne Nachweis keine Quittung
  const fremd = bezahlt();
  assert.equal(lightningQuittung({ provider: PROVIDER, rechnung: z.rechnung, preimage: fremd.preimage, auftraege: 1, zeit: JETZT }), null, "Preimage passt nicht");
  const ohneBetrag = rechnung(knotenSchluessel(), "lnbc", crypto.getRandomValues(new Uint8Array(32)));
  assert.equal(lightningQuittung({ provider: PROVIDER, rechnung: ohneBetrag, preimage: z.preimage, auftraege: 1, zeit: JETZT }), null, "Rechnung ohne Betrag");
  assert.equal(lightningQuittung({ provider: PROVIDER, rechnung: "lnbc1kaputt", preimage: z.preimage, auftraege: 1, zeit: JETZT }), null);
  assert.equal(lightningQuittung({ provider: "ab", rechnung: z.rechnung, preimage: z.preimage, auftraege: 1, zeit: JETZT }), null);
  assert.equal(lightningQuittung({ provider: PROVIDER, rechnung: z.rechnung, preimage: z.preimage, auftraege: 0, zeit: JETZT }), null);
});

test("5.5a: Zahlkanal-Quittung ist angekündigt, bis die Kette mindestens bis zur Gutschrift ausgezahlt hat", () => {
  const anfrage = "a".repeat(64);
  const q = kanalQuittung({ provider: PROVIDER, kanal: KANAL, gutschrift: 5_000_000n, preisLamports: 1_200_000, anfrage, zeit: JETZT })!;
  assert.equal(q.stand, "angekuendigt");
  assert.equal(kanalBelegt(q, 4_999_999n).stand, "angekuendigt");
  assert.equal(kanalBelegt(q, 5_000_000n).stand, "belegt");
  assert.equal(kanalBelegt(q, 9_000_000n).stand, "belegt");
  for (const kaputt of [
    { gutschrift: 0n }, { preisLamports: 0 }, { preisLamports: 1.5 }, { kanal: "nicht-base58!" }, { anfrage: "zz" }, { provider: "ab" },
  ]) {
    assert.equal(kanalQuittung({ provider: PROVIDER, kanal: KANAL, gutschrift: 5n, preisLamports: 1, anfrage, zeit: JETZT, ...kaputt }), null, JSON.stringify(kaputt, (_, v) => typeof v === "bigint" ? String(v) : v));
  }
});

test("5.5a: gespeicherte Quittungen lesen – Unbrauchbares und Verändertes gilt als keine", () => {
  const z = bezahlt();
  const l = lightningQuittung({ provider: PROVIDER, rechnung: z.rechnung, preimage: z.preimage, auftraege: 2, zeit: JETZT, providerKnoten: z.knoten })!;
  const k = kanalBelegt(kanalQuittung({ provider: PROVIDER, kanal: KANAL, gutschrift: 7n, preisLamports: 3, anfrage: "b".repeat(64), zeit: JETZT })!, 7n);
  const zurueck = JSON.parse(JSON.stringify([l, k])).map(leseQuittung);
  assert.deepEqual(zurueck, [l, k]);
  assert.equal(leseQuittung({ ...l, preimage: bezahlt().preimage }), null, "Preimage verändert");
  assert.equal(leseQuittung({ ...l, stand: "bezahlt" }), null);
  assert.equal(leseQuittung({ ...k, gutschrift: "-1" }), null);
  assert.equal(leseQuittung({ ...k, art: "bar" }), null);
  assert.equal(leseQuittung(null), null);
  assert.equal(leseQuittung("text"), null);
});

function quittungen(): Quittung[] {
  const z = bezahlt(50);
  const l = lightningQuittung({ provider: PROVIDER, rechnung: z.rechnung, preimage: z.preimage, auftraege: 4, zeit: JETZT, providerKnoten: z.knoten })!;
  const k: KanalQuittung[] = [1, 2].map((i) => kanalQuittung({ provider: PROVIDER, kanal: KANAL, gutschrift: BigInt(i * 10), preisLamports: 10, anfrage: String(i).repeat(64), zeit: JETZT })!);
  return [l, kanalBelegt(k[0]!, 10n), k[1]!];
}

test("5.5a: Zusammenfassung je Provider – versiegelt an Kontakte, Relays sehen weder Provider noch Zahlen", async () => {
  const ich = new LocalSigner(generateKeypair().sk);
  const kontakt = new LocalSigner(generateKeypair().sk);
  const zeilen = fasseZusammen(quittungen(), new Map([[PROVIDER, 1], ["c".repeat(64), 5]]));
  assert.deepEqual(zeilen, [{ provider: PROVIDER, auftraege: 6, belegt: 5, umfangMsat: 50_000, umfangLamports: 20, reklamationen: 1 }], "Reklamationen nur zu bezahlten Providern");

  const wraps = await baueRufUmschlaege({ von: ich, an: [kontakt.publicKey(), ich.publicKey(), "zz"], zeilen, nowSecs: JETZT });
  assert.equal(wraps.length, 1, "nicht an sich selbst, nichts Ungültiges");
  const offen = JSON.stringify(wraps[0]);
  for (const nadel of [PROVIDER, ich.publicKey(), "50000", String(KIND_RUF_ZUSAMMENFASSUNG)]) assert.ok(!offen.includes(nadel), nadel);
  assert.equal(wraps[0]!.kind, 1059);

  const gelesen = await oeffneRufUmschlag(wraps[0]!, kontakt, new Set([ich.publicKey()]));
  assert.deepEqual(gelesen, { von: ich.publicKey(), zeit: JETZT, zeilen });
  assert.equal(await oeffneRufUmschlag(wraps[0]!, kontakt, new Set()), null, "nur von eigenen Kontakten");
  assert.equal(await oeffneRufUmschlag(wraps[0]!, new LocalSigner(generateKeypair().sk), new Set([ich.publicKey()])), null, "nicht für mich");
  assert.deepEqual(await baueRufUmschlaege({ von: ich, an: [kontakt.publicKey()], zeilen: [], nowSecs: JETZT }), []);
});

test("5.5a: fremde Zusammenfassungen – falscher Autor, kaputte Zeilen, zu viele Provider", async () => {
  const kontakt = new LocalSigner(generateKeypair().sk);
  const ich = new LocalSigner(generateKeypair().sk);
  const kontakte = new Set([kontakt.publicKey()]);
  const zeile = (pk: string, ...n: string[]) => ["provider", pk, ...n];
  const umschlag = (tags: string[][], von = kontakt) =>
    giftWrapMitSigner({ pubkey: kontakt.publicKey(), kind: KIND_RUF_ZUSAMMENFASSUNG, created_at: JETZT, tags, content: "" }, von, ich.publicKey(), { nowSecs: JETZT });
  // Ein Fremder gibt sich im Kern als Kontakt aus – das Siegel verrät ihn (NIP-59), er zählt nicht
  const fremder = new LocalSigner(generateKeypair().sk);
  assert.equal(await oeffneRufUmschlag(await umschlag([zeile(PROVIDER, "1", "1", "0", "0", "0")], fremder), ich, kontakte), null, "Fremder statt Kontakt");
  const gemischt = await oeffneRufUmschlag(await umschlag([
    zeile(PROVIDER, "3", "4", "0", "0", "0"), // mehr belegt als bezahlt
    zeile("zz", "1", "1", "0", "0", "0"),
    zeile(PROVIDER, "-1", "0", "0", "0", "0"),
    zeile(PROVIDER, "0", "0", "0", "0", "0"),
    zeile(PROVIDER, "2", "1", "10", "0", "0"),
    zeile(PROVIDER, "9", "9", "0", "0", "0"), // doppelt
  ]), ich, kontakte);
  assert.deepEqual(gemischt?.zeilen, [{ provider: PROVIDER, auftraege: 2, belegt: 1, umfangMsat: 10, umfangLamports: 0, reklamationen: 0 }]);
  const viele = await oeffneRufUmschlag(await umschlag(Array.from({ length: RUF_MAX_PROVIDER + 5 }, () => zeile(generateKeypair().pk, "1", "1", "0", "0", "0"))), ich, kontakte);
  assert.equal(viele?.zeilen.length, RUF_MAX_PROVIDER);
  const anderesKind: NostrEvent = await giftWrapMitSigner({ pubkey: kontakt.publicKey(), kind: 14, created_at: JETZT, tags: [], content: "hallo" }, kontakt, ich.publicKey());
  assert.equal(await oeffneRufUmschlag(anderesKind, ich, kontakte), null, "eine Direktnachricht ist keine Zusammenfassung");
});

test("5.5a: Ruf nur aus Quittungen und Kontakten – belegt zählt voll, Kontakte halb und gedeckelt, Reklamationen ziehen ab", () => {
  const eigene = berechneRuf({ quittungen: quittungen() }).get(PROVIDER)!;
  assert.deepEqual(eigene, { provider: PROVIDER, auftraege: 5.5, reklamationen: 0, eigene: 6, kontakte: 0, vertrauen: 11 });
  assert.equal(berechneRuf({ quittungen: [] }).size, 0, "ohne Quittung kein Ruf – egal, was jemand über sich behauptet");

  const anderer = generateKeypair().pk;
  const kontakt = (von: string, zeit: number, auftraege: number, reklamationen = 0) =>
    ({ von, zeit, zeilen: [{ provider: anderer, auftraege, belegt: auftraege, umfangMsat: 0, umfangLamports: 0, reklamationen }] });
  const a = generateKeypair().pk;
  const b = generateKeypair().pk;
  const r = berechneRuf({ quittungen: [], vonKontakten: [kontakt(a, 1, 10), kontakt(a, 2, 4), kontakt(b, 1, 10_000)] }).get(anderer)!;
  assert.equal(r.kontakte, 2, "je Kontakt die neueste");
  assert.equal(r.auftraege, 4 / 2 + RUF_KONTAKT_DECKEL / 2, "Kontakte halb, einer allein gedeckelt");
  assert.equal(r.vertrauen, 100);
  const reklamiert = berechneRuf({ quittungen: [], vonKontakten: [kontakt(a, 1, 10, 4)] }).get(anderer)!;
  assert.equal(reklamiert.vertrauen, 0, "5 gewichtete Aufträge, 2 gewichtete Reklamationen");
  const eigeneReklamation = berechneRuf({ quittungen: quittungen(), reklamationen: new Map([[PROVIDER, 1]]) }).get(PROVIDER)!;
  assert.equal(eigeneReklamation.vertrauen, 1);
});
