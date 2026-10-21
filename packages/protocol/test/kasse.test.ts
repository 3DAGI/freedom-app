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
  auszahlungsNachricht, kasseAnlegenAnweisung, kassenAdresse, kassenArt, kassenMitglieder, kassenTransaktionAdresse, kassenTresor,
  kassenVorschlagAdresse, leseAuszahlung, leseAuszahlungVonKette, leseKasse, leseKassenStand, leseProgrammEinstellungen, leseVorschlag,
  leseVorschlagVonKette, mehrheitVon, poolRpc, programmEinstellungenAdresse, RpcPool, SQUADS_PROGRAMM_ID, type KassenStand,
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

// ---- A-12a2: Auszahlen ----

const KASSE = kassenAdresse(adresse(20)), TRESOR = kassenTresor(KASSE), EMPF = adresse(26), SYSTEM = "11111111111111111111111111111111";

test("A-12a2: Adressen von Transaktion und Vorschlag wie im SDK von Squads; die Nachricht nimmt nur echte Auszahlungen", () => {
  assert.equal(kassenTransaktionAdresse(KASSE, 1n), "2y9SpG5AZFCAcfJMeRDPgNx4GsTWxxCgTik3QAHZW2Cr");
  assert.equal(kassenVorschlagAdresse(KASSE, 1n), "7Fshby9GkHVJvULxgMfPFdSmTbdnUZAmHnrnJjwfwn2a");
  assert.notEqual(kassenTransaktionAdresse(KASSE, 2n), kassenTransaktionAdresse(KASSE, 1n));
  assert.throws(() => auszahlungsNachricht(TRESOR, { empfaenger: EMPF, lamports: 0n }), /größer als 0/);
  assert.throws(() => auszahlungsNachricht(TRESOR, { empfaenger: TRESOR, lamports: 1n }), /Empfänger/);
  assert.throws(() => auszahlungsNachricht(TRESOR, { empfaenger: SYSTEM, lamports: 1n }), /Empfänger/);
});

/** Kleine Borsh-Schreibhilfe für Konten in der Form des Programms. */
function bytes(art: string) {
  const b: number[] = [...sha256(new TextEncoder().encode(`account:${art}`)).subarray(0, 8)];
  const w = {
    pk: (a: string) => { b.push(...new PublicKey(a).toBytes()); return w; },
    zahl: (n: bigint, len: number) => { for (let i = 0; i < len; i++) b.push(Number((BigInt.asUintN(64, n) >> BigInt(8 * i)) & 0xffn)); return w; },
    u8: (...n: number[]) => { b.push(...n); return w; },
    vec: (teile: number[]) => { w.zahl(BigInt(teile.length), 4); b.push(...teile); return w; },
    fertig: () => Uint8Array.from(b),
  };
  return w;
}

function vorschlagBytes(status: number, mit = true) {
  const w = bytes("Proposal").pk(KASSE).zahl(1n, 8).u8(status);
  if (mit) w.zahl(1_800_000_000n, 8);
  w.u8(255).zahl(2n, 4).pk(adresse(21)).pk(adresse(22)).zahl(1n, 4).pk(adresse(23)).zahl(0n, 4);
  return w.fertig();
}

test("A-12a2: Vorschlag lesen – Status mit Zeit, Stimmen dafür und dagegen; unbekannter Status und abgeschnitten werfen", () => {
  assert.deepEqual(leseVorschlag(vorschlagBytes(3)), {
    kasse: KASSE, index: 1n, status: "angenommen", seit: 1_800_000_000n, dafuer: [adresse(21), adresse(22)], dagegen: [adresse(23)], abgebrochen: [],
  });
  assert.deepEqual([0, 1, 2, 5, 6].map((n) => leseVorschlag(vorschlagBytes(n)).status), ["entwurf", "aktiv", "abgelehnt", "ausgefuehrt", "abgebrochen"]);
  const laufend = leseVorschlag(vorschlagBytes(4, false));
  assert.equal(laufend.status, "wird-ausgefuehrt");
  assert.equal(laufend.seit, null);
  assert.throws(() => leseVorschlag(vorschlagBytes(7)), /Status unbekannt/);
  const b = vorschlagBytes(1);
  assert.throws(() => leseVorschlag(b.subarray(0, b.length - 2)), /zu kurz/);
});

/** Eine VaultTransaction mit einer Nachricht in Borsh-Form; `aendere` verbiegt einzelne Teile. */
function transaktionBytes(aendere: Partial<{ tresorIndex: number; signer: number[]; kopf: number[]; konten: string[]; programm: number; konto: number[]; daten: number[]; tabellen: number; extra: boolean }> = {}) {
  const daten = aendere.daten ?? [2, 0, 0, 0, ...[0x00, 0xe1, 0xf5, 0x05, 0, 0, 0, 0]]; // Transfer 100 000 000
  const konten = aendere.konten ?? [TRESOR, EMPF, SYSTEM];
  const w = bytes("VaultTransaction").pk(KASSE).pk(adresse(21)).zahl(1n, 8).u8(254, aendere.tresorIndex ?? 0, 253)
    .vec(aendere.signer ?? []).u8(...(aendere.kopf ?? [1, 1, 1])).zahl(BigInt(konten.length), 4);
  for (const k of konten) w.pk(k);
  const ix = () => { w.u8(aendere.programm ?? 2).vec(aendere.konto ?? [0, 1]).vec(daten); };
  w.zahl(aendere.extra ? 2n : 1n, 4); ix(); if (aendere.extra) ix();
  w.zahl(BigInt(aendere.tabellen ?? 0), 4);
  for (let i = 0; i < (aendere.tabellen ?? 0); i++) w.pk(adresse(40)).vec([0]).vec([]);
  return w.fertig();
}

test("A-12a2: Auszahlung lesen – nur genau die Form dieser App, sonst keine Auszahlung", () => {
  assert.deepEqual(leseAuszahlung(transaktionBytes()), {
    kasse: KASSE, ersteller: adresse(21), index: 1n, auszahlung: { empfaenger: EMPF, lamports: 100_000_000n },
  });
  const keine: Array<Parameters<typeof transaktionBytes>[0]> = [
    { tresorIndex: 1 }, { signer: [255] }, { kopf: [2, 1, 1] }, { konten: [adresse(41), EMPF, SYSTEM] }, { konten: [TRESOR, EMPF, adresse(42)] },
    { konten: [TRESOR, TRESOR, SYSTEM] }, { programm: 1 }, { konto: [1, 0] }, { daten: [3, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0] },
    { daten: [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }, { daten: [2, 0, 0, 0, 1] }, { tabellen: 1 }, { extra: true },
  ];
  for (const a of keine) assert.equal(leseAuszahlung(transaktionBytes(a)).auszahlung, null, JSON.stringify(a));
  const b = transaktionBytes();
  assert.throws(() => leseAuszahlung(b.subarray(0, b.length - 1)), /zu kurz/);
  assert.throws(() => leseAuszahlung(vorschlagBytes(1)), /kein VaultTransaction/);
});

test("A-12a2: von der Kette nur Konten von Squads und nur zur genannten Kasse", async () => {
  const t = transaktionBytes();
  assert.equal((await leseAuszahlungVonKette(kette({ eigentuemer: SQUADS_PROGRAMM_ID, daten: t }), KASSE, 1n))?.auszahlung?.empfaenger, EMPF);
  assert.equal(await leseAuszahlungVonKette(kette(null), KASSE, 1n), null);
  await assert.rejects(leseAuszahlungVonKette(kette({ eigentuemer: SQUADS_PROGRAMM_ID, daten: t }), kassenAdresse(adresse(25)), 1n), /nicht zu dieser Kasse/);
  await assert.rejects(leseAuszahlungVonKette(kette({ eigentuemer: SQUADS_PROGRAMM_ID, daten: t }), KASSE, 2n), /nicht zu dieser Kasse/);
  await assert.rejects(leseVorschlagVonKette(kette({ eigentuemer: adresse(40), daten: vorschlagBytes(1) }), KASSE, 1n), /nicht Squads/);
  assert.equal((await leseVorschlagVonKette(kette({ eigentuemer: SQUADS_PROGRAMM_ID, daten: vorschlagBytes(1) }), KASSE, 1n))?.status, "aktiv");
});
