/**
 * Leak-Szenario „Bitchat-Schlüssel an Kontakte“ (B-36c2b1, BC-W3 A): Die App gibt ihre Bitchat-Schlüssel so weiter, wie
 * `shell/bitchat-kontakte.ts` es tut – `FunkAdressVersand` mit `BITCHAT_SCHLUESSEL` im Abruftakt, gesendet über den Pool. Relays
 * sehen nur Umschläge, je Kontakt einen, nie zwei im selben Augenblick; weder die Schlüssel noch den Absender. Ohne Zustimmung
 * geht nichts hinaus.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LocalSigner, generateKeypair, regelAutorNicht, regelKeinKlartext, regelKeineZahlungsdaten, regelKopienEntkoppelt, regelPTagsNur,
  zufallsVerzoegerung, type NostrEvent,
} from "@freedomstack/protocol";
import { BITCHAT_SCHLUESSEL, FunkAdressVersand } from "../../src/funk-adressen.js";
import { aufzeichnung } from "./aufzeichnung.js";

const NOISE = "5a".repeat(32);
const SIGNIER = "c3".repeat(32);

async function teile(zustimmung: boolean) {
  const { pool, relay } = aufzeichnung();
  const ich = new LocalSigner(generateKeypair().sk);
  const kontakte = [generateKeypair().pk, generateKeypair().pk, generateKeypair().pk];
  const m = new Map<string, string>();
  let uhrMs = 1_000_000;
  const zeiten = new Map<string, number>();
  const v = new FunkAdressVersand({
    art: BITCHAT_SCHLUESSEL,
    zustimmung: () => zustimmung,
    signer: () => ich,
    kontakte: () => kontakte,
    adresse: async () => `${NOISE}:${SIGNIER}`,
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

test("Bitchat-Schlüssel an Kontakte: nur Umschläge, je Kontakt einer, weder Schlüssel noch Absender", async () => {
  const { gesendet, ich, kontakte } = await teile(true);
  assert.deepEqual(gesendet.map((e) => e.kind), [1059, 1059, 1059]);
  assert.deepEqual(regelAutorNicht(gesendet, ich.publicKey()), []);
  assert.deepEqual(regelKeinKlartext(gesendet, [NOISE, SIGNIER]), []);
  assert.deepEqual(regelKeineZahlungsdaten(gesendet), []);
  assert.deepEqual(regelPTagsNur(gesendet, kontakte), []);
  assert.deepEqual(gesendet.map((e) => e.tags), kontakte.map((k) => [["p", k]]), "offen nur der Empfänger, kein Kind, keine Schlüssel");
});

test("Bitchat-Schlüssel an Kontakte: die Umschläge gehen nie im selben Augenblick hinaus, ohne Zustimmung gar nicht", async () => {
  const { gesendet, zeiten } = await teile(true);
  const sendungen = gesendet.map((ev) => ({ ev, zeitMs: zeiten.get(ev.id)! }));
  assert.deepEqual(regelKopienEntkoppelt(sendungen), []);
  assert.deepEqual((await teile(false)).gesendet, []);
});
