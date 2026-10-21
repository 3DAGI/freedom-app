/**
 * Gemeinsame Kasse über Squads v4 (A-12a1): Adressen, Arten, Anlegen, Konten lesen.
 * Die erwarteten Adressen hat das SDK von Squads (`@sqds/multisig` 2.1.4) gerechnet, nicht `kasse.ts`;
 * die Bytes der Anweisung halten die Vektoren fest („kasse-anlegen-…“), das echte Programm prüft
 * `contracts/squads/tests/kasse.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  kasseAnlegenAnweisung, kassenAdresse, kassenArt, kassenMitglieder, kassenTresor, leseKasse, leseKassenStand, leseProgrammEinstellungen,
  mehrheitVon, poolRpc, programmEinstellungenAdresse, RpcPool, SQUADS_PROGRAMM_ID, type KassenStand,
} from "../src/index.js";

const adresse = (n: number) => Keypair.fromSeed(new Uint8Array(32).fill(n)).publicKey.toBase58();
const A = adresse(21), B = adresse(22), C = adresse(23);

test("A-12a1: Adressen wie im SDK von Squads – Kasse, Tresor, Einstellungen des Programms", () => {
  assert.equal(kassenAdresse(adresse(20)), "FJS6xMCEg9Gntmosv3ZKV3fdAnGkk2XxwHp7mcjAyGsR");
  assert.equal(kassenTresor("FJS6xMCEg9Gntmosv3ZKV3fdAnGkk2XxwHp7mcjAyGsR"), "ZgoRNC4GNvDjLL47oYQ52jNA3Nr8brFaT2166iuoUWN");
  assert.equal(kassenTresor(kassenAdresse(adresse(25))), "9EgTQBgEsikH3E3qCYexYykuwhZ4BPUCrFDCtqPf6JRm");
  assert.equal(programmEinstellungenAdresse(), "BSTq9w3kZwNwpBXJEvTZz2G9ZTNyKBvoSeXMvwb4cNZr");
  assert.throws(() => kassenTresor(kassenAdresse(A), 256), /Tresor-Index/);
});

test("A-12a1: zwei Arten (W2) – Gründer entscheidet mit Schwelle 1, Mehrheit mindestens 2", () => {
  assert.deepEqual(kassenMitglieder("gruender", A, [B, C]), {
    mitglieder: [{ adresse: A, rechte: 7 }, { adresse: B, rechte: 1 }, { adresse: C, rechte: 1 }], schwelle: 1,
  });
  assert.deepEqual(kassenMitglieder("gruender", A, []), { mitglieder: [{ adresse: A, rechte: 7 }], schwelle: 1 });
  assert.deepEqual(kassenMitglieder("mehrheit", A, [B, C]).schwelle, 2);
  assert.ok(kassenMitglieder("mehrheit", A, [B]).mitglieder.every((m) => m.rechte === 7));
  assert.deepEqual([2, 3, 4, 5, 6, 10].map(mehrheitVon), [2, 2, 3, 3, 4, 6]);
  assert.throws(() => kassenMitglieder("mehrheit", A, []), /mindestens zwei/);
  assert.throws(() => kassenMitglieder("mehrheit", A, [B, A]), /doppelt/);
  assert.throws(() => kassenMitglieder("gruender", A, ["kein-schluessel"]));
});

test("A-12a1: Anlegen – ohne Verwalter, Miete zurück in den Tresor, Zeitschloss nur 0, 1 h oder 24 h", () => {
  const p = { ersteller: A, createKey: adresse(20), schatzamt: adresse(24), art: "mehrheit" as const, gruender: A, weitere: [B, C] };
  const ix = kasseAnlegenAnweisung(p);
  assert.equal(ix.programAddress, SQUADS_PROGRAMM_ID);
  assert.deepEqual(ix.accounts!.map((k) => [k.address, k.role]), [
    [programmEinstellungenAdresse(), 0], [adresse(24), 1], [kassenAdresse(adresse(20)), 1], [adresse(20), 2], [A, 3], ["11111111111111111111111111111111", 0],
  ]);
  const d = ix.data!;
  assert.equal(d[8], 0, "config_authority: keiner");
  // nach Diskriminator, Option, Schwelle, Länge, drei Mitgliedern (je 33) und Zeitschloss: rent_collector = Tresor
  const o = 8 + 1 + 2 + 4 + 3 * 33 + 4;
  assert.equal(d[o], 1);
  assert.equal(new PublicKey(d.subarray(o + 1, o + 33)).toBase58(), kassenTresor(kassenAdresse(adresse(20))));
  assert.equal(d.length, o + 33 + 1, "ohne Memo");
  for (const zeitschlossSek of [3600, 86_400]) assert.doesNotThrow(() => kasseAnlegenAnweisung({ ...p, zeitschlossSek }));
  for (const zeitschlossSek of [1, 60, 7200, -1]) assert.throws(() => kasseAnlegenAnweisung({ ...p, zeitschlossSek }), /Zeitschloss/);
});

/** Ein Multisig-Konto in der Form des Programms – zum Lesen ohne Kette. */
function kontoBytes(s: Omit<KassenStand, "verwalter"> & { verwalter?: string | null }): Uint8Array {
  const b: number[] = [...sha256(new TextEncoder().encode("account:Multisig")).subarray(0, 8)];
  const pk = (a: string) => b.push(...new PublicKey(a).toBytes());
  const zahl = (n: bigint, bytes: number) => { for (let i = 0; i < bytes; i++) b.push(Number((n >> BigInt(8 * i)) & 0xffn)); };
  pk(s.createKey);
  pk(s.verwalter ?? PublicKey.default.toBase58());
  zahl(BigInt(s.schwelle), 2); zahl(BigInt(s.zeitschlossSek), 4); zahl(s.transaktionsIndex, 8); zahl(s.veraltetBis, 8);
  if (s.mieteAn) { b.push(1); pk(s.mieteAn); } else b.push(0);
  b.push(s.bump);
  zahl(BigInt(s.mitglieder.length), 4);
  for (const m of s.mitglieder) { pk(m.adresse); b.push(m.rechte); }
  return Uint8Array.from(b);
}

const stand = (mitglieder: KassenStand["mitglieder"], schwelle: number, verwalter: string | null = null): KassenStand => ({
  createKey: adresse(20), verwalter, schwelle, zeitschlossSek: 3600, transaktionsIndex: 5n, veraltetBis: 2n, mieteAn: adresse(30), bump: 254, mitglieder,
});

test("A-12a1: Konto der Kasse lesen – alle Felder, falsche Art und abgeschnittene Daten werfen", () => {
  const s = stand([{ adresse: A, rechte: 7 }, { adresse: B, rechte: 1 }], 1);
  const bytes = kontoBytes(s);
  assert.deepEqual(leseKassenStand(bytes), s);
  assert.deepEqual(leseKassenStand(kontoBytes({ ...s, mieteAn: null, verwalter: C })), { ...s, mieteAn: null, verwalter: C });
  assert.throws(() => leseKassenStand(bytes.subarray(0, bytes.length - 1)), /zu kurz/);
  const falsch = Uint8Array.from(bytes); falsch[0] ^= 1;
  assert.throws(() => leseKassenStand(falsch), /kein Multisig/);
  const option = Uint8Array.from(bytes); option[8 + 64 + 2 + 4 + 16] = 2;
  assert.throws(() => leseKassenStand(option), /Option/);
  assert.throws(() => leseProgrammEinstellungen(bytes), /kein ProgramConfig/);
});

test("A-12a1: die Art nur aus dem Stand auf der Kette – mit Verwalter oder anderen Rechten keine Kasse dieser App", () => {
  assert.equal(kassenArt(stand([{ adresse: A, rechte: 7 }, { adresse: B, rechte: 1 }], 1)), "gruender");
  assert.equal(kassenArt(stand([{ adresse: A, rechte: 7 }], 1)), "gruender");
  assert.equal(kassenArt(stand([{ adresse: A, rechte: 7 }, { adresse: B, rechte: 7 }, { adresse: C, rechte: 7 }], 2)), "mehrheit");
  assert.equal(kassenArt(stand([{ adresse: A, rechte: 7 }, { adresse: B, rechte: 7 }, { adresse: C, rechte: 7 }], 3)), null, "Schwelle ist nicht die Mehrheit");
  assert.equal(kassenArt(stand([{ adresse: A, rechte: 7 }, { adresse: B, rechte: 7 }], 1)), null, "zwei mit allen Rechten, Schwelle 1");
  assert.equal(kassenArt(stand([{ adresse: A, rechte: 7 }, { adresse: B, rechte: 2 }], 1)), null, "abstimmen ohne vorschlagen");
  assert.equal(kassenArt(stand([{ adresse: A, rechte: 7 }, { adresse: B, rechte: 1 }], 1, C)), null, "mit Verwalter");
  assert.equal(kassenArt(stand([], 1)), null);
});

/** Die Kette als JSON-RPC-Attrappe hinter einem echten Pool: ein Konto mit diesem Eigentümer und diesen Daten. */
function kette(konto: { eigentuemer: string; daten: Uint8Array } | null) {
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const { id } = JSON.parse(String(init!.body)) as { id: number };
    const value = konto && {
      data: [Buffer.from(konto.daten).toString("base64"), "base64"], owner: konto.eigentuemer, executable: false, lamports: 3_000_000, rentEpoch: 0, space: konto.daten.length,
    };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: { context: { slot: 1 }, value } }));
  }) as typeof fetch;
  return poolRpc(new RpcPool([{ url: "https://rpc.test" }], { fetchImpl }));
}

test("A-12a1: leseKasse – nur Konten von Squads, fehlend ist null", async () => {
  const s = stand([{ adresse: A, rechte: 7 }, { adresse: B, rechte: 7 }], 2);
  assert.deepEqual(await leseKasse(kette({ eigentuemer: SQUADS_PROGRAMM_ID, daten: kontoBytes(s) }), kassenAdresse(adresse(20))), s);
  assert.equal(await leseKasse(kette(null), kassenAdresse(adresse(20))), null);
  await assert.rejects(leseKasse(kette({ eigentuemer: adresse(40), daten: kontoBytes(s) }), kassenAdresse(adresse(20))), /nicht Squads/);
});
