/**
 * SessionClient signiert ueber den Signer (Schritt 1.3) – nicht mit dem rohen
 * Schluessel, und der Schluessel steckt in keiner Darstellung des Clients.
 * Seit 3.1 ist das der Sitzungsschluessel je Provider, nie die Identitaet.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LocalSigner, generateKeypair, openPrivateKundenEvent, regelKeineZahlungsdaten, toHex, verifyEvent, type NostrEvent,
  type OutboxPool,
} from "@freedomstack/protocol";
import { SessionClient } from "../src/session-client.js";
import { KiSitzungen } from "../src/ki-sitzung.js";

/** Was der Provider sieht: Umschlag oeffnen (seit 3.2e geht alles versiegelt an ihn). */
async function geoeffnet(wrap: NostrEvent, providerSk: Uint8Array) {
  const r = await openPrivateKundenEvent(wrap, new LocalSigner(providerSk));
  if (!r.ok) throw new Error(r.grund);
  return r.request;
}

function fakePool(): { pool: OutboxPool; gesendet: NostrEvent[] } {
  const gesendet: NostrEvent[] = [];
  const pool = { publish: async (ev: NostrEvent) => { gesendet.push(ev); return { ok: true }; } } as unknown as OutboxPool;
  return { pool, gesendet };
}

test("SessionClient: Session-Eroeffnung ist vom Signer signiert", async () => {
  const kunde = generateKeypair();
  const provider = generateKeypair();
  const { pool, gesendet } = fakePool();
  const sc = new SessionClient({
    signerFuer: () => new LocalSigner(kunde.sk), pool, defaultBudgetSats: 100, settleEverySats: 20, ttlSecs: 3600,
  });
  const s = await sc.openSession(provider.pk);
  assert.equal(gesendet.length, 1);
  assert.equal(verifyEvent(gesendet[0]), true);
  assert.equal(gesendet[0].kind, 1059, "versiegelt an den Provider (3.2e)");
  assert.deepEqual(regelKeineZahlungsdaten(gesendet), []);
  const open = await geoeffnet(gesendet[0], provider.sk);
  assert.equal(open.kind, 38021);
  assert.equal(open.pubkey, kunde.pk);
  assert.ok(s.open.sessionId.startsWith(`sess-${kunde.pk.slice(0, 8)}-`));
});

test("SessionClient: der Schluessel taucht nicht auf, wenn der Client serialisiert wird", () => {
  const kunde = generateKeypair();
  const { pool } = fakePool();
  const signer = new LocalSigner(kunde.sk);
  const sc = new SessionClient({
    signerFuer: () => signer, pool, defaultBudgetSats: 100, settleEverySats: 20, ttlSecs: 3600,
  });
  const json = JSON.stringify(sc);
  assert.ok(!json.includes(toHex(kunde.sk)), "kein Schluessel als Hex");
  // Vorher lag cfg.keypair.sk hier als Zahlenobjekt {"0":…} – jetzt haelt der Client nur eine Funktion
  assert.ok(!/"sk"/.test(json), "kein Feld sk");
});

test("SessionClient mit KiSitzungen: je Provider ein eigener Schluessel, nie die Identitaet", async () => {
  const identitaet = generateKeypair();
  const [a, b] = [generateKeypair(), generateKeypair()];
  const { pool, gesendet } = fakePool();
  const sitzungen = new KiSitzungen();
  const sc = new SessionClient({
    signerFuer: (pk) => sitzungen.fuer(pk), pool, defaultBudgetSats: 100, settleEverySats: 20, ttlSecs: 3600,
    powFuer: () => 4,
  });
  await sc.openSession(a.pk);
  await sc.openSession(b.pk);
  await sc.chargeForResult(a.pk, 5000, "e".repeat(64));
  assert.equal(gesendet.length, 3);
  assert.ok(gesendet.every((ev) => verifyEvent(ev) && ev.kind === 1059 && ev.pubkey !== identitaet.pk));
  assert.ok(gesendet.every((ev) => ev.tags.some((t) => t[0] === "nonce")), "Rechenarbeit laut Angebot");
  const [oa, ob, beleg] = [await geoeffnet(gesendet[0], a.sk), await geoeffnet(gesendet[1], b.sk), await geoeffnet(gesendet[2], a.sk)];
  assert.equal(oa.pubkey, sitzungen.fuer(a.pk).publicKey());
  assert.equal(ob.pubkey, sitzungen.fuer(b.pk).publicKey());
  assert.notEqual(oa.pubkey, ob.pubkey, "zwei Provider sehen nicht denselben Schluessel");
  assert.equal(beleg.kind, 38022);
  assert.equal(beleg.pubkey, oa.pubkey, "Beleg vom Sitzungsschluessel desselben Providers");
  assert.equal(sitzungen.fuer(a.pk), sitzungen.fuer(a.pk), "fester Schluessel je Provider");
  // Der Umschlag an b laesst sich mit a's Schluessel nicht oeffnen
  await assert.rejects(geoeffnet(gesendet[1], a.sk));
});

test("5.1.3: Anteil des Providers per Rechnung – ab dem Fenster, ganze sats, nie über das Budget, nach unklarem Ausgang nie wieder von selbst", async () => {
  const kunde = generateKeypair();
  const provider = generateKeypair();
  const { pool, gesendet } = fakePool();
  const sc = new SessionClient({
    signerFuer: () => new LocalSigner(kunde.sk), pool, defaultBudgetSats: 100, settleEverySats: 20, ttlSecs: 3600,
  });
  const zahlungen: number[] = [];
  let scheitert: "rechnung" | "zahlen" | null = null;
  const wallet = {
    async rechnung(msat: number) { if (scheitert === "rechnung") throw new Error("LNURL weg"); return `lnbc-${msat}`; },
    async zahle(rechnung: string, msat: number) {
      if (scheitert === "zahlen") throw new Error("Zeitüberschreitung");
      assert.equal(rechnung, `lnbc-${msat}`);
      zahlungen.push(msat);
      return "ab".repeat(32);
    },
  };
  const e = "e".repeat(64);
  assert.equal((await sc.chargeForResult(provider.pk, 12_500, e, wallet)).settled, false, "unter 20 sats: nur Beleg");
  const r = await sc.chargeForResult(provider.pk, 12_700, e, wallet);
  assert.deepEqual([r.settled, r.gezahltMsat, r.faelligAbMsat], [true, 25_000, 20_000], "ganze sats – 200 msat bleiben offen");
  assert.equal(r.rechnung, "lnbc-25000", "die bezahlte Rechnung – mit dem Preimage die Quittung (5.5b)");
  // Der Beleg an den Provider nennt, was bezahlt ist
  const beleg = await geoeffnet(gesendet.at(-1)!, provider.sk);
  assert.equal(beleg.tags.find((t) => t[0] === "cumulative_msat")?.[1], "25000");

  scheitert = "rechnung";
  const ohne = await sc.chargeForResult(provider.pk, 30_000, e, wallet);
  assert.deepEqual([ohne.settled, ohne.unklar], [false, false], "vor der Wallet gescheitert – beim nächsten Mal wieder");
  assert.equal(ohne.rechnung, undefined, "ohne Zahlung keine Rechnung");
  scheitert = "zahlen";
  const unklar = await sc.chargeForResult(provider.pk, 1_000, e, wallet);
  assert.deepEqual([unklar.settled, unklar.unklar], [false, true]);
  scheitert = null;
  const danach = await sc.chargeForResult(provider.pk, 20_000, e, wallet);
  assert.equal(danach.settled, false, "nie ein zweites Mal von selbst");
  assert.deepEqual(zahlungen, [25_000]);

  // Neue Sitzung (Budget 100 sats): nie mehr als das Budget – ein fester Schlüssel je Provider wie KiSitzungen
  const k2 = new LocalSigner(generateKeypair().sk);
  const sc2 = new SessionClient({
    signerFuer: () => k2, pool, defaultBudgetSats: 100, settleEverySats: 20, ttlSecs: 3600,
  });
  const gross = await sc2.chargeForResult(provider.pk, 250_000, e, wallet);
  assert.equal(gross.gezahltMsat, 100_000);

  // Zwei Antworten zugleich: dieselbe Schuld wird nur einmal gezahlt
  const k3 = new LocalSigner(generateKeypair().sk);
  const sc3 = new SessionClient({
    signerFuer: () => k3, pool, defaultBudgetSats: 100, settleEverySats: 20, ttlSecs: 3600,
  });
  await sc3.openSession(provider.pk);
  zahlungen.length = 0;
  await Promise.all([sc3.chargeForResult(provider.pk, 30_000, e, wallet), sc3.chargeForResult(provider.pk, 1_000, e, wallet)]);
  assert.deepEqual(zahlungen, [30_000], "die zweite sieht die laufende Zahlung und wartet aufs nächste Mal");
});
