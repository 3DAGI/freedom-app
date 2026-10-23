/**
 * Leak-Szenario „Reticulum-Adresse an Kontakte“ (B-32c1, W2 A): Die App gibt ihre LXMF-Adresse so weiter, wie
 * `shell/funk-kontakte.ts` es tut – `FunkAdressVersand` im Abruftakt, gesendet über den Pool. Relays sehen nur Umschläge,
 * je Kontakt einen, nie zwei im selben Augenblick; weder die Adresse noch den Absender. Ohne Zustimmung geht nichts hinaus.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LocalSigner, generateKeypair, regelAutorNicht, regelKeinKlartext, regelKeineZahlungsdaten, regelKopienEntkoppelt, regelPTagsNur,
  zufallsVerzoegerung, type NostrEvent,
} from "@freedomstack/protocol";
import { FunkAdressVersand } from "../../src/funk-adressen.js";
import { aufzeichnung } from "./aufzeichnung.js";

const ADRESSE = "7f3a".repeat(8);

async function teile(zustimmung: boolean) {
  const { pool, relay } = aufzeichnung();
  const ich = new LocalSigner(generateKeypair().sk);
  const kontakte = [generateKeypair().pk, generateKeypair().pk, generateKeypair().pk];
  const m = new Map<string, string>();
  // Die Uhr des Abruftakts: 30 s ± 50 % je Schlag (wie `abrufTakt`)
  let uhrMs = 1_000_000;
  const zeiten = new Map<string, number>();
  const v = new FunkAdressVersand({
    zustimmung: () => zustimmung,
    signer: () => ich,
    kontakte: () => kontakte,
    adresse: async () => ADRESSE,
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

test("Reticulum-Adresse an Kontakte: nur Umschläge, je Kontakt einer, weder Adresse noch Absender", async () => {
  const { gesendet, ich, kontakte } = await teile(true);
  assert.deepEqual(gesendet.map((e) => e.kind), [1059, 1059, 1059]);
  assert.deepEqual(regelAutorNicht(gesendet, ich.publicKey()), []);
  assert.deepEqual(regelKeinKlartext(gesendet, [ADRESSE]), []);
  assert.deepEqual(regelKeineZahlungsdaten(gesendet), []);
  assert.deepEqual(regelPTagsNur(gesendet, kontakte), []);
  assert.deepEqual(gesendet.map((e) => e.tags), kontakte.map((k) => [["p", k]]), "offen nur der Empfänger, kein Kind, keine Adresse");
});

test("Reticulum-Adresse an Kontakte: die Umschläge gehen nie im selben Augenblick hinaus", async () => {
  const { gesendet, zeiten } = await teile(true);
  const sendungen = gesendet.map((ev) => ({ ev, zeitMs: zeiten.get(ev.id)! }));
  assert.deepEqual(regelKopienEntkoppelt(sendungen), []);
  assert.ok(sendungen.every((s, i) => i === 0 || s.zeitMs - sendungen[i - 1]!.zeitMs >= 15_000), "mindestens ein Schlag dazwischen");
});

test("Reticulum-Adresse an Kontakte: ohne Zustimmung geht nichts hinaus", async () => {
  const { gesendet } = await teile(false);
  assert.deepEqual(gesendet, []);
});
