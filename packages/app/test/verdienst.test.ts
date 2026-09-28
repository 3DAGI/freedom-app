/**
 * Schritt 4.5b: Verdienen in SOL – Kanäle des eigenen Knotens von der Kette.
 * Geprüft wird: Die Abfrage filtert nach genau dieser Provider-Adresse, und
 * die App prüft jedes Konto selbst (fremde und kaputte fallen weg); der Teil
 * des Providers rechnet wie das Programm; Fristen und laufende Kanäle
 * stimmen; die Eingabe des Knotens nimmt nur gültige Schlüssel; die Kette
 * wird nur im geöffneten Tab gefragt, nie beim Start.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Keypair, PublicKey } from "@solana/web3.js";
import { KANAL_KONTO_BYTES, KANAL_PROGRAMM_ID, teileKanalZahlung } from "@freedomstack/protocol";
import { encodeNpub } from "../src/identity.js";
import { fasseKanaeleZusammen, kanaeleDesKnotens, knotenAusEingabe, PROVIDER_OFFSET, type KanalAmKnoten } from "../src/verdienst.js";

const JETZT = 1_900_000_000;
const provider = Keypair.generate().publicKey.toBase58();
const adr = () => Keypair.generate().publicKey.toBase58();

function konto(p: { provider?: string; eingezahlt: bigint; ausgezahlt: bigint; ablauf: number; empfaenger?: { adresse: string; ppm: number }[] }): Buffer {
  const b = Buffer.alloc(KANAL_KONTO_BYTES);
  createHash("sha256").update("account:Channel").digest().subarray(0, 8).copy(b, 0);
  let o = 8;
  for (const a of [adr(), p.provider ?? provider, adr()]) { new PublicKey(a).toBuffer().copy(b, o); o += 32; }
  o = b.writeBigUInt64LE(1n, o); o = b.writeBigUInt64LE(p.eingezahlt, o); o = b.writeBigUInt64LE(p.ausgezahlt, o);
  o = b.writeBigInt64LE(BigInt(p.ablauf), o);
  const e = p.empfaenger ?? [];
  o = b.writeUInt32LE(e.length, o);
  for (const x of e) { new PublicKey(x.adresse).toBuffer().copy(b, o); o += 32; o = b.writeUInt32LE(x.ppm, o); }
  b[o] = 255;
  return b;
}

test("Kanäle des Knotens: gefiltert nach genau dieser Adresse, jedes Konto selbst geprüft", async () => {
  const gut = adr(), fremd = adr(), kaputt = adr();
  let gefragt: { programm: string; opts: unknown } | undefined;
  const conn = {
    getProgramAccounts: async (programm: PublicKey, opts: unknown) => {
      gefragt = { programm: programm.toBase58(), opts };
      return [
        { pubkey: new PublicKey(gut), account: { data: konto({ eingezahlt: 5n, ausgezahlt: 1n, ablauf: JETZT }) } },
        // Ein RPC, der falsch filtert: Kanal eines anderen Providers
        { pubkey: new PublicKey(fremd), account: { data: konto({ provider: adr(), eingezahlt: 5n, ausgezahlt: 1n, ablauf: JETZT }) } },
        { pubkey: new PublicKey(kaputt), account: { data: Buffer.alloc(KANAL_KONTO_BYTES) } },
      ];
    },
  } as unknown as Parameters<typeof kanaeleDesKnotens>[0];
  const k = await kanaeleDesKnotens(conn, provider);
  assert.deepEqual(k.map((x) => x.adresse), [gut]);
  assert.equal(gefragt!.programm, KANAL_PROGRAMM_ID);
  assert.deepEqual(gefragt!.opts, {
    commitment: "confirmed",
    filters: [{ dataSize: KANAL_KONTO_BYTES }, { memcmp: { offset: PROVIDER_OFFSET, bytes: provider } }],
  });
  assert.equal(PROVIDER_OFFSET, 40, "Diskriminator + customer");
  await assert.rejects(kanaeleDesKnotens(conn, "keine-adresse"));
});

test("Übersicht: Teil des Providers wie das Programm, offen, laufende Kanäle und nächste Frist", () => {
  const empfaenger = [{ adresse: adr(), ppm: 25_000 }, { adresse: adr(), ppm: 15_000 }];
  const kanal = (eingezahlt: bigint, ausgezahlt: bigint, ablauf: number, e = empfaenger): KanalAmKnoten => ({
    adresse: adr(),
    stand: { kunde: adr(), provider, sitzungsSchluessel: adr(), nonce: 1n, eingezahlt, ausgezahlt, ablauf: BigInt(ablauf), empfaenger: e, bump: 255 },
  });
  const spaet = kanal(2_000_000n, 1_000_000n, JETZT + 7 * 86_400);
  const frueh = kanal(1_000_000n, 0n, JETZT + 3_600, []);
  const vorbei = kanal(500_000n, 333_333n, JETZT - 60);
  const u = fasseKanaeleZusammen([vorbei, spaet, frueh], JETZT);
  assert.deepEqual(u.kanaele.map((z) => z.adresse), [frueh.adresse, spaet.adresse, vorbei.adresse], "laufende zuerst, nach Frist");
  assert.equal(u.laufend, 2);
  assert.equal(u.naechsteFrist, JETZT + 3_600);
  const z = u.kanaele[1]!;
  assert.equal(z.deins, 960_000n, "Eingelöstes ohne die Anteile (2,5 % + 1,5 %)");
  assert.equal(z.offen, 1_000_000n);
  assert.equal(u.kanaele[2]!.deins, teileKanalZahlung(333_333n, empfaenger).providerLamports, "Rundung zugunsten des Providers wie im Programm");
  assert.equal(u.kanaele[2]!.laeuft, false);
  assert.equal(u.deins, 960_000n + teileKanalZahlung(333_333n, empfaenger).providerLamports);
  // Mehr ausgezahlt als eingezahlt kann es nicht geben – falls ein RPC das behauptet, ist nichts offen
  assert.equal(fasseKanaeleZusammen([kanal(1n, 2n, JETZT + 1)], JETZT).kanaele[0]!.offen, 0n);
  assert.deepEqual(fasseKanaeleZusammen([], JETZT), { kanaele: [], deins: 0n, laufend: 0, naechsteFrist: undefined });
});

test("Eingabe des Knotens: npub oder Hex, leer heißt eigene Identität, sonst abgewiesen", () => {
  const hex = "ab".repeat(32);
  assert.equal(knotenAusEingabe(hex), hex);
  assert.equal(knotenAusEingabe(` ${hex.toUpperCase()} `), hex);
  assert.equal(knotenAusEingabe(encodeNpub(hex)), hex);
  assert.equal(knotenAusEingabe("  "), undefined);
  for (const x of ["ab".repeat(31), "zz".repeat(32), "npub1kaputt", "nsec1abc"]) assert.throws(() => knotenAusEingabe(x), /valid key/, x);
});

test("verdrahtet: Kette nur im geöffneten Tab, nur textContent, Lightning vom eigenen Knoten", () => {
  const app = readFileSync(new URL("../src/shell/app.ts", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../src/shell/verdienst-ui.ts", import.meta.url), "utf8");
  const earn = readFileSync(new URL("../src/shell/tabs/earn.ts", import.meta.url), "utf8");
  const html = readFileSync(new URL("../src/shell/index.html", import.meta.url), "utf8");
  assert.match(app, /if \(name === "earn"\) \{[^}]*void zeigeSolEinnahmen\(\);/);
  assert.equal(app.match(/zeigeSolEinnahmen\(/g)?.length, 1, "sonst nirgends – nicht beim Start");
  assert.match(app, /wireVerdienst\(loadEarnings\);/);
  assert.doesNotMatch(ui, /innerHTML/);
  assert.match(ui, /kanaeleDesKnotens\(conn, adresse\)/);
  assert.match(ui, /angebot\.kanal\.programm !== KANAL_PROGRAMM_ID/);
  assert.match(earn, /authors: \[knotenSchluessel\(\) \?\? state\.keypair\.pk\]/);
  for (const id of ["earn-knoten", "earn-sol-status", "earn-kanaele", "earn-events"]) assert.match(html, new RegExp(`id="${id}"`));
});
