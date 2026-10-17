/**
 * SessionClient – seit RM2c3 nur noch die Abrechnung mit dem Provider: ein Konto je Provider und
 * Sitzungsschlüssel, gezahlt nach jeder Antwort, sobald ganze sats fällig sind. Keine Sitzung auf
 * Kredit (38021), keine Belege (38022) – der Client sendet nichts. Der Schlüssel steckt in keiner
 * Darstellung des Clients (Schritt 1.3); seit 3.1 ist es der Sitzungsschlüssel je Provider.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LocalSigner, generateKeypair, toHex } from "@freedomstack/protocol";
import { SessionClient, type ProviderZahlung } from "../src/session-client.js";
import { KiSitzungen } from "../src/ki-sitzung.js";

function attrappe(): ProviderZahlung & { zahlungen: number[]; scheitert: "rechnung" | "zahlen" | null } {
  const w = {
    zahlungen: [] as number[],
    scheitert: null as "rechnung" | "zahlen" | null,
    async rechnung(msat: number) {
      if (w.scheitert === "rechnung") throw new Error("LNURL weg");
      return `lnbc-${msat}`;
    },
    async zahle(rechnung: string, msat: number) {
      if (w.scheitert === "zahlen") throw new Error("Zeitüberschreitung");
      assert.equal(rechnung, `lnbc-${msat}`);
      w.zahlungen.push(msat);
      return "ab".repeat(32);
    },
  };
  return w;
}

test("SessionClient: der Schluessel taucht nicht auf, wenn der Client serialisiert wird", async () => {
  const kunde = generateKeypair();
  const signer = new LocalSigner(kunde.sk);
  const sc = new SessionClient({ signerFuer: () => signer });
  await sc.chargeForResult(generateKeypair().pk, 500);
  const json = JSON.stringify(sc);
  assert.ok(!json.includes(toHex(kunde.sk)), "kein Schluessel als Hex");
  // Vorher lag cfg.keypair.sk hier als Zahlenobjekt {"0":…} – jetzt haelt der Client nur eine Funktion
  assert.ok(!/"sk"/.test(json), "kein Feld sk");
});

test("RM2c3: keine Sitzung auf Kredit – der Client kennt kein Relay, eröffnet nichts und schickt keine Belege", () => {
  const quelle = readFileSync(new URL("../src/session-client.ts", import.meta.url), "utf8");
  const code = quelle.replace(/\/\*\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
  assert.doesNotMatch(code, /38021|38022|publish|buildEvent|buildPrivate|OutboxPool|Budget|sessionId/);
  assert.deepEqual(Object.getOwnPropertyNames(SessionClient.prototype).sort(),
    ["begleiche", "chargeForResult", "constructor", "konto", "offeneVon", "zahleFaellig"]);
  assert.match(code, /const ZAHLEN_AB_MSAT = 1000;/, "Lightning-Rechnungen über ganze sats");
});

test("5.1.3/RM2c3: nach jeder Antwort ganze sats – der Rest wartet, nie zweimal zugleich, nach unklarem Ausgang nie wieder von selbst", async () => {
  const provider = generateKeypair().pk;
  const kunde = new LocalSigner(generateKeypair().sk);
  const sc = new SessionClient({ signerFuer: () => kunde });
  const w = attrappe();

  const klein = await sc.chargeForResult(provider, 500, w);
  assert.deepEqual([klein.settled, klein.offenMsat, w.zahlungen], [false, 500, []], "unter einem sat: wartet auf die nächste Antwort");
  assert.deepEqual(sc.offeneVon(kunde.publicKey()), [], "unter einem sat nichts zu begleichen");
  const r = await sc.chargeForResult(provider, 12_700, w);
  assert.deepEqual([r.settled, r.gezahltMsat, r.offenMsat], [true, 13_000, 200], "gleich nach der Antwort, ganze sats – 200 msat bleiben offen");
  assert.equal(r.rechnung, "lnbc-13000", "die bezahlte Rechnung – mit dem Preimage die Quittung (5.5b)");
  assert.equal(r.paymentRef, "ab".repeat(32));

  // Kein Budget mehr, das eine Zahlung kappt: was die Abrechnung (höchstens das Gebot) verbucht, wird gezahlt
  const gross = await sc.chargeForResult(provider, 249_800, w);
  assert.deepEqual([gross.settled, gross.gezahltMsat, gross.offenMsat], [true, 250_000, 0]);

  w.scheitert = "rechnung";
  const ohne = await sc.chargeForResult(provider, 30_000, w);
  assert.deepEqual([ohne.settled, ohne.unklar, ohne.offenMsat], [false, false, 30_000], "vor der Wallet gescheitert – beim nächsten Mal wieder");
  assert.equal(ohne.rechnung, undefined, "ohne Zahlung keine Rechnung");
  assert.deepEqual(sc.offeneVon(kunde.publicKey()), [provider], "offen – beim Wechsel zu begleichen (D1b2)");
  w.scheitert = "zahlen";
  const unklar = await sc.chargeForResult(provider, 1_000, w);
  assert.deepEqual([unklar.settled, unklar.unklar], [false, true]);
  w.scheitert = null;
  const danach = await sc.chargeForResult(provider, 20_000, w);
  assert.equal(danach.settled, false, "nie ein zweites Mal von selbst");
  assert.equal(danach.offenMsat, 51_000);
  assert.deepEqual(sc.offeneVon(kunde.publicKey()), [], "unklar: auch nicht beim Wechsel");
  assert.deepEqual(w.zahlungen, [13_000, 250_000]);

  // Ohne Wallet (keine Lightning-Adresse beim Provider): nur verbucht
  const k2 = new LocalSigner(generateKeypair().sk);
  const ohneWallet = await sc.chargeForResult(provider, 5_000, undefined, k2);
  assert.deepEqual([ohneWallet.settled, ohneWallet.unklar, ohneWallet.offenMsat], [false, false, 5_000]);

  // Zwei Antworten zugleich: dieselbe Schuld wird nur einmal gezahlt, der Rest mit der nächsten
  const k3 = new LocalSigner(generateKeypair().sk);
  w.zahlungen.length = 0;
  await Promise.all([sc.chargeForResult(provider, 30_000, w, k3), sc.chargeForResult(provider, 1_000, w, k3)]);
  assert.deepEqual(w.zahlungen, [30_000], "die zweite sieht die laufende Zahlung und wartet aufs nächste Mal");
  await sc.chargeForResult(provider, 0, w, k3);
  assert.deepEqual(w.zahlungen, [30_000, 1_000]);
});

test("SessionClient mit KiSitzungen: je Provider ein eigener Schlüssel, eigene Konten – nie die Identität", async () => {
  const identitaet = generateKeypair();
  const [a, b] = [generateKeypair().pk, generateKeypair().pk];
  const sitzungen = new KiSitzungen();
  const sc = new SessionClient({ signerFuer: (pk) => sitzungen.fuer(pk) });
  await sc.chargeForResult(a, 5_000);
  await sc.chargeForResult(b, 300);
  const [ka, kb] = [sitzungen.fuer(a).publicKey(), sitzungen.fuer(b).publicKey()];
  assert.notEqual(ka, kb, "zwei Provider, zwei Schlüssel");
  assert.ok(ka !== identitaet.pk && kb !== identitaet.pk);
  assert.deepEqual(sc.offeneVon(ka), [a], "verbucht beim Schlüssel für a");
  assert.deepEqual(sc.offeneVon(kb), [], "b: unter einem sat");
  const w = attrappe();
  const beglichen = await sc.begleiche(a, sitzungen.fuer(a), w);
  assert.deepEqual([beglichen.settled, beglichen.gezahltMsat, w.zahlungen], [true, 5_000, [5_000]]);
  assert.deepEqual(await sc.begleiche(a, sitzungen.fuer(b), w), { settled: false, unklar: false, gezahltMsat: 0 }, "fremder Schlüssel: kein Konto");
});
