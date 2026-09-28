/**
 * Leak-Szenario „Ruf mit Kontakten“ (Schritt 5.5c): Die App teilt ihre
 * Zusammenfassung über Provider so, wie `shell/ruf.ts` es tut – `RufVersand`
 * im Abruftakt, gesendet über den Pool. Relays sehen nur Umschläge, je Kontakt
 * einen, nie zwei im selben Augenblick; weder Provider noch Beträge noch den
 * Absender. Ohne Zustimmung geht nichts hinaus.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LocalSigner, generateKeypair, regelAutorNicht, regelKeinKlartext, regelKeineZahlungsdaten, regelKopienEntkoppelt, regelPTagsNur,
  zufallsVerzoegerung, type NostrEvent, type RufZeile,
} from "@freedomstack/protocol";
import { RufVersand } from "../../src/ruf-teilen.js";
import { aufzeichnung } from "./aufzeichnung.js";

const PROVIDER = "e5".repeat(32);
const ZEILEN: RufZeile[] = [{ provider: PROVIDER, auftraege: 12, belegt: 3, umfangMsat: 421_000, umfangLamports: 9_876_543, reklamationen: 1 }];

async function teile(zustimmung: boolean) {
  const { pool, relay } = aufzeichnung();
  const ich = new LocalSigner(generateKeypair().sk);
  const kontakte = [generateKeypair().pk, generateKeypair().pk, generateKeypair().pk];
  const m = new Map<string, string>();
  // Die Uhr des Abruftakts: 30 s ± 50 % je Schlag (wie `abrufTakt`)
  let uhrMs = 1_000_000;
  const zeiten = new Map<string, number>();
  const v = new RufVersand({
    zustimmung: () => zustimmung,
    signer: () => ich,
    kontakte: () => kontakte,
    zeilen: () => ZEILEN,
    sende: async (wrap: NostrEvent) => {
      zeiten.set(wrap.id, uhrMs);
      return (await pool.publish(wrap)).ok;
    },
    speicher: { getItem: (k) => m.get(k) ?? null, setItem: (k, w) => void m.set(k, w) },
    jetzt: () => Math.floor(uhrMs / 1000),
  });
  for (let i = 0; i < 5; i++) {
    uhrMs += 15_000 + zufallsVerzoegerung(30_000);
    await v.takt();
  }
  return { gesendet: relay.gesendet, ich, kontakte, zeiten };
}

test("Ruf mit Kontakten: nur Umschläge, je Kontakt einer, weder Provider noch Beträge noch Absender", async () => {
  const { gesendet, ich, kontakte } = await teile(true);
  assert.deepEqual(gesendet.map((e) => e.kind), [1059, 1059, 1059]);
  assert.deepEqual(regelAutorNicht(gesendet, ich.publicKey()), []);
  assert.deepEqual(regelKeinKlartext(gesendet, [PROVIDER, "421000", "9876543"]), []);
  assert.deepEqual(regelKeineZahlungsdaten(gesendet), []);
  assert.deepEqual(regelPTagsNur(gesendet, kontakte), []);
  assert.deepEqual(gesendet.map((e) => e.tags.find((t) => t[0] === "p")?.[1]), kontakte, "je Kontakt ein eigener Umschlag");
});

test("Ruf mit Kontakten: die Umschläge gehen nie im selben Augenblick hinaus", async () => {
  const { gesendet, zeiten } = await teile(true);
  const sendungen = gesendet.map((ev) => ({ ev, zeitMs: zeiten.get(ev.id)! }));
  assert.deepEqual(regelKopienEntkoppelt(sendungen), []);
  assert.ok(sendungen.every((s, i) => i === 0 || s.zeitMs - sendungen[i - 1].zeitMs >= 15_000), "mindestens ein Schlag dazwischen");
});

test("Ruf mit Kontakten: ohne Zustimmung geht nichts hinaus", async () => {
  const { gesendet } = await teile(false);
  assert.deepEqual(gesendet, []);
});
