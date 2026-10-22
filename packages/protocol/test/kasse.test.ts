/**
 * Gemeinsame Kasse über Squads v4 (A-12a1): Adressen, Arten, Anlegen, Konten lesen; seit A-12c1 Schritte eines Vorschlags,
 * seit A-12a3 Änderungen der Kasse, seit A-12d1 ihre Miete und die Art bei fremden Änderungen.
 * Die erwarteten Adressen hat das SDK von Squads (`@sqds/multisig` 2.1.4) gerechnet, nicht `kasse.ts`;
 * die Bytes der Anweisung halten die Vektoren fest („kasse-anlegen-…“), das echte Programm prüft
 * `contracts/squads/tests/kasse.test.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  auszahlungKontoGroessen, auszahlungsNachricht, auszahlungVorschlagenAnweisungen, ausfuehrbarAb, baueKasseAnlegen, kasseAnlegenAnweisung, kassenAdresse, kassenKontoGroesse, leseNachricht, kassenArt, kassenMitglieder, kassenTransaktionAdresse, kassenTresor,
  kassenVorschlagAdresse, leseAuszahlung, leseAuszahlungVonKette, leseKasse, leseKassenStand, leseProgrammEinstellungen, leseVorschlag,
  leseVorschlaege, leseVorschlagVonKette, mehrheitVon, poolRpc, programmEinstellungenAdresse, RpcPool, SQUADS_PROGRAMM_ID, vorschlagsSchritte,
  kassenAenderungen, kassenKontoGroesseNach, kassenStandNach, konfigurationAusfuehrenAnweisung, konfigurationVorschlagenAnweisungen, leseKonfiguration, leseKonfigurationVonKette,
  behaeltArt, konfigurationKontoGroessen, leseVorgang,
  type KassenAenderung, type KassenStand, type KassenVorschlag,
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

test("A-12b2b: Anlegen mit frischem Create-Key – er hat unterschrieben, der Ersteller noch nicht; Größe des Kontos für die Miete", () => {
  const lebensdauer = { blockhash: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY", letzteHoehe: 100n };
  const p = { ersteller: A, schatzamt: C, art: "mehrheit" as const, gruender: A, weitere: [B], lebensdauer };
  const { tx, kasse } = baueKasseAnlegen(p);
  const n = leseNachricht(tx);
  assert.equal(n.zahler, A, "der Ersteller zahlt");
  assert.equal(n.anweisungen.length, 1);
  const ix = n.anweisungen[0]!;
  assert.equal(ix.programm, SQUADS_PROGRAMM_ID);
  const createKey = ix.konten[3]!;
  assert.equal(createKey.signiert, true);
  assert.notEqual(createKey.adresse, A);
  assert.equal(ix.konten[2]!.adresse, kasse, "die Kasse folgt aus dem Create-Key");
  assert.equal(kasse, kassenAdresse(createKey.adresse));
  assert.deepEqual(ix.daten, Uint8Array.from(kasseAnlegenAnweisung({ ...p, createKey: createKey.adresse }).data!), "dieselben Bytes wie die Anweisung");
  const signaturen = tx.signatures as Record<string, Uint8Array | null>;
  assert.ok(signaturen[createKey.adresse], "der Create-Key hat unterschrieben");
  assert.equal(signaturen[A], null, "der Ersteller noch nicht");
  assert.notEqual(baueKasseAnlegen(p).kasse, kasse, "jedes Mal ein neuer Create-Key");
  assert.throws(() => baueKasseAnlegen({ ...p, weitere: [] }), /mindestens zwei/);

  assert.deepEqual([1, 2, 5].map(kassenKontoGroesse), [165, 198, 297]);
  for (const x of [0, -1, 1.5, Number.NaN]) assert.throws(() => kassenKontoGroesse(x), /Mitglieder/);
});

// ---- A-12c1: Auszahlen in der App ----

test("A-12c1: Miete eines Vorschlags von einem anderen Zahler; Größe der Konten für die Miete", () => {
  const p = { kasse: KASSE, index: 1n, vorschlagender: A, empfaenger: EMPF, lamports: 1n };
  const ohne = auszahlungVorschlagenAnweisungen(p);
  assert.deepEqual(ohne.map((ix) => ix.accounts![3]!.address), [A, A], "ohne Angabe zahlt der Vorschlagende");
  const mit = auszahlungVorschlagenAnweisungen({ ...p, mietZahler: C });
  for (const ix of mit) {
    assert.equal(ix.accounts![2]!.address, A, "Ersteller bleibt der Vorschlagende");
    assert.deepEqual([ix.accounts![3]!.address, ix.accounts![3]!.role], [C, 3], "der Zahler der Miete unterschreibt, beschreibbar");
  }
  assert.deepEqual(mit.map((ix) => ix.data), ohne.map((ix) => ix.data), "die Daten bleiben gleich");
  assert.deepEqual([1, 2, 5].map(auszahlungKontoGroessen), [1, 2, 5].map((n) => ({ transaktion: 221, vorschlag: 70 + 96 * n })));
  for (const x of [0, 1.5, 70_000]) assert.throws(() => auszahlungKontoGroessen(x), /Mitglieder/);
});

const vorschlagAus = (index: bigint, status: KassenVorschlag["status"], s: Partial<KassenVorschlag> = {}): KassenVorschlag => ({
  kasse: KASSE, index, status, seit: status === "wird-ausgefuehrt" ? null : 1000n, dafuer: [], dagegen: [], abgebrochen: [], ...s,
});

test("A-12c1: Schritte nach den Regeln von Squads – abstimmen, ausführen nach dem Zeitschloss, abschließen", () => {
  const mehrheit = { ...stand([{ adresse: A, rechte: 7 }, { adresse: B, rechte: 7 }, { adresse: C, rechte: 7 }], 2), veraltetBis: 0n };
  const AUS = { empfaenger: EMPF, lamports: 5n };
  // `null`: ohne eigene Adresse (ein übergebenes `undefined` nähme den Vorgabewert)
  const schritte = (v: KassenVorschlag, mitglied: string | null = A, jetztSek = 10_000, s: KassenStand = mehrheit, auszahlung: typeof AUS | null = AUS) =>
    vorschlagsSchritte({ stand: s, vorschlag: v, auszahlung, mitglied: mitglied ?? undefined, jetztSek });
  assert.deepEqual(schritte(vorschlagAus(1n, "aktiv")), ["dafuer", "dagegen"]);
  assert.deepEqual(schritte(vorschlagAus(1n, "aktiv", { dafuer: [A] })), ["dagegen"], "dieselbe Stimme nicht zweimal");
  assert.deepEqual(schritte(vorschlagAus(1n, "aktiv", { dagegen: [A] })), ["dafuer"]);
  assert.deepEqual(schritte(vorschlagAus(1n, "aktiv"), null), [], "ohne eigene Adresse nicht abstimmen");
  assert.deepEqual(schritte(vorschlagAus(1n, "aktiv"), adresse(40)), [], "nicht in der Kasse");
  assert.deepEqual(schritte(vorschlagAus(1n, "aktiv"), A, 10_000, mehrheit, null), [], "keine Auszahlung der App: nicht abstimmen");

  // Zeitschloss 1 h ab der Annahme (seit 1000)
  const angenommen = vorschlagAus(1n, "angenommen", { dafuer: [A, B] });
  assert.equal(ausfuehrbarAb(mehrheit, angenommen), 4600n);
  assert.equal(ausfuehrbarAb(mehrheit, vorschlagAus(1n, "aktiv")), null);
  assert.deepEqual(schritte(angenommen, A, 4599), [], "vor Ablauf des Zeitschlosses nicht");
  assert.deepEqual(schritte(angenommen, A, 4600), ["ausfuehren"]);
  assert.deepEqual(schritte(angenommen, A, 4600, mehrheit, null), [], "keine Auszahlung der App: nicht ausführen");
  const gruender = { ...stand([{ adresse: A, rechte: 7 }, { adresse: B, rechte: 1 }], 1), veraltetBis: 0n };
  assert.deepEqual(schritte(angenommen, B, 4600, gruender), [], "wer nur vorschlägt, führt nicht aus");
  assert.deepEqual(schritte(vorschlagAus(1n, "aktiv"), B, 4600, gruender), [], "und stimmt nicht ab");

  for (const status of ["ausgefuehrt", "abgelehnt", "abgebrochen"] as const) {
    assert.deepEqual(schritte(vorschlagAus(1n, status), null), ["abschliessen"], status);
    assert.deepEqual(schritte(vorschlagAus(1n, status), A, 10_000, { ...mehrheit, mieteAn: null }), [], "ohne rent_collector nicht");
  }
  assert.deepEqual(schritte(vorschlagAus(1n, "wird-ausgefuehrt")), []);
  // Veraltet (nach einer Änderung der Konfiguration): nicht mehr abstimmen, aber abschließen; angenommen bleibt ausführbar
  const veraltet = { ...mehrheit, veraltetBis: 1n };
  assert.deepEqual(schritte(vorschlagAus(1n, "aktiv"), A, 10_000, veraltet), ["abschliessen"]);
  assert.deepEqual(schritte(vorschlagAus(1n, "entwurf"), A, 10_000, veraltet), ["abschliessen"]);
  assert.deepEqual(schritte(angenommen, A, 10_000, veraltet), ["ausfuehren"]);
  assert.deepEqual(schritte(vorschlagAus(2n, "entwurf"), A, 10_000, veraltet), [], "ein Entwurf, der nicht veraltet ist");
});

/** Die Kette als Attrappe mit mehreren Konten (Adresse → Konto). */
function ketteMit(konten: Record<string, { eigentuemer: string; daten: Uint8Array }>) {
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const { id, params } = JSON.parse(String(init!.body)) as { id: number; params: [string] };
    const k = konten[params[0]];
    const value = k && { data: [Buffer.from(k.daten).toString("base64"), "base64"], owner: k.eigentuemer, executable: false, lamports: 3_000_000, rentEpoch: 0, space: k.daten.length };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: { context: { slot: 1 }, value: value ?? null } }));
  }) as typeof fetch;
  return poolRpc(new RpcPool([{ url: "https://rpc.test" }], { fetchImpl }));
}

test("A-12c1: die jüngsten Vorschläge von der Kette – neueste zuerst, abgeschlossene fehlen, ohne Transaktion keine Auszahlung", async () => {
  const vorschlag = (index: bigint, status: number) => bytes("Proposal").pk(KASSE).zahl(index, 8).u8(status).zahl(1000n, 8).u8(255).zahl(0n, 4).zahl(0n, 4).zahl(0n, 4).fertig();
  const sq = (daten: Uint8Array) => ({ eigentuemer: SQUADS_PROGRAMM_ID, daten });
  const rpc = ketteMit({
    [kassenVorschlagAdresse(KASSE, 3n)]: sq(vorschlag(3n, 1)),
    [kassenVorschlagAdresse(KASSE, 1n)]: sq(vorschlag(1n, 3)),
    [kassenTransaktionAdresse(KASSE, 1n)]: sq(transaktionBytes()),
  });
  const s = { ...stand([{ adresse: A, rechte: 7 }], 1), transaktionsIndex: 3n };
  const liste = await leseVorschlaege(rpc, KASSE, s);
  assert.deepEqual(liste.map((v) => [v.index, v.vorschlag.status, v.auszahlung]), [
    [3n, "aktiv", null], [1n, "angenommen", { empfaenger: EMPF, lamports: 100_000_000n }],
  ]);
  assert.deepEqual((await leseVorschlaege(rpc, KASSE, s, 2)).map((v) => v.index), [3n], "höchstens zwei Nummern gefragt");
  assert.deepEqual(await leseVorschlaege(rpc, KASSE, { ...s, transaktionsIndex: 0n }), []);
});

// ---- A-12a3: Konfiguration ändern ----

test("A-12a3: Änderung bauen und lesen – nur Mitglied dazu oder weg, Schwelle, Wartezeit; andere Varianten keine Änderung der App", () => {
  const aenderungen: KassenAenderung[] = [
    { art: "mitglied-dazu", adresse: C, rechte: 7 }, { art: "mitglied-weg", adresse: B }, { art: "schwelle", schwelle: 2 }, { art: "zeitschloss", sek: 86_400 },
  ];
  const [anlegen, vorschlag] = konfigurationVorschlagenAnweisungen({ kasse: KASSE, index: 6n, vorschlagender: A, aenderungen });
  assert.deepEqual(anlegen!.accounts!.map((k) => [k.address, k.role]), [
    [KASSE, 1], [kassenTransaktionAdresse(KASSE, 6n), 1], [A, 2], [A, 3], [SYSTEM, 0],
  ]);
  assert.equal(vorschlag!.accounts![1]!.address, kassenVorschlagAdresse(KASSE, 6n));
  const d = anlegen!.data!;
  assert.equal(d[d.length - 1], 0, "ohne Memo");
  // Das Konto, wie das Programm es speichert: Kasse, Ersteller, Index, Bump, dann dieselbe Liste wie in der Anweisung
  const konto = Uint8Array.from([...bytes("ConfigTransaction").pk(KASSE).pk(A).zahl(6n, 8).u8(254).fertig(), ...d.subarray(8, d.length - 1)]);
  assert.deepEqual(leseKonfiguration(konto), { kasse: KASSE, ersteller: A, index: 6n, aenderungen });
  const limit = bytes("ConfigTransaction").pk(KASSE).pk(A).zahl(6n, 8).u8(254).zahl(1n, 4).u8(6, 0).fertig(); // SetRentCollector(None)
  assert.equal(leseKonfiguration(limit).aenderungen, null, "eine Variante, die die App nicht anbietet");
  assert.throws(() => leseKonfiguration(konto.subarray(0, konto.length - 1)), /zu kurz/);
  assert.throws(() => leseKonfiguration(transaktionBytes()), /kein ConfigTransaction/);

  assert.throws(() => konfigurationVorschlagenAnweisungen({ kasse: KASSE, index: 6n, vorschlagender: A, aenderungen: [] }), /keine Änderung/);
  for (const falsch of [
    { art: "mitglied-dazu", adresse: C, rechte: 0 }, { art: "mitglied-dazu", adresse: C, rechte: 8 }, { art: "schwelle", schwelle: 0 }, { art: "zeitschloss", sek: 60 },
  ] as KassenAenderung[]) {
    assert.throws(() => konfigurationVorschlagenAnweisungen({ kasse: KASSE, index: 6n, vorschlagender: A, aenderungen: [falsch] }), /ungültig|Zeitschloss/, JSON.stringify(falsch));
  }
  const ausfuehren = konfigurationAusfuehrenAnweisung({ kasse: KASSE, index: 6n, mitglied: B, mietZahler: C });
  assert.deepEqual(ausfuehren.accounts!.map((k) => [k.address, k.role]), [
    [KASSE, 1], [B, 2], [kassenVorschlagAdresse(KASSE, 6n), 1], [kassenTransaktionAdresse(KASSE, 6n), 0], [C, 3], [SYSTEM, 0],
  ]);
});

test("A-12a3: Änderungen, mit denen die Kasse ihre Art behält – und der Stand danach wie beim Programm", () => {
  const D = adresse(24), E = adresse(25);
  const mehrheit = { ...stand([{ adresse: A, rechte: 7 }, { adresse: B, rechte: 7 }], 2), zeitschlossSek: 0 };
  assert.deepEqual(kassenAenderungen(mehrheit, { dazu: [C] }), [{ art: "mitglied-dazu", adresse: C, rechte: 7 }], "Mehrheit von drei bleibt 2");
  assert.deepEqual(kassenAenderungen(mehrheit, { dazu: [C, D] }), [
    { art: "mitglied-dazu", adresse: C, rechte: 7 }, { art: "mitglied-dazu", adresse: D, rechte: 7 }, { art: "schwelle", schwelle: 3 },
  ]);
  assert.deepEqual(kassenAenderungen({ ...mehrheit, mitglieder: [A, B, C, D].map((adresse) => ({ adresse, rechte: 7 })), schwelle: 3 }, { weg: [D] }), [
    { art: "mitglied-weg", adresse: D }, { art: "schwelle", schwelle: 2 },
  ]);
  assert.deepEqual(kassenAenderungen(mehrheit, { zeitschlossSek: 3600 }), [{ art: "zeitschloss", sek: 3600 }]);
  assert.throws(() => kassenAenderungen(mehrheit, {}), /keine Änderung/);
  assert.throws(() => kassenAenderungen(mehrheit, { zeitschlossSek: 0 }), /keine Änderung/);
  assert.throws(() => kassenAenderungen(mehrheit, { weg: [B] }), /Schwelle|Art/, "eine Mehrheit braucht zwei");
  assert.throws(() => kassenAenderungen(mehrheit, { dazu: [A] }), /doppelt/);
  assert.throws(() => kassenAenderungen(mehrheit, { weg: [E] }), /kein Mitglied/);

  const gruender = { ...stand([{ adresse: A, rechte: 7 }, { adresse: B, rechte: 1 }], 1), zeitschlossSek: 0 };
  assert.deepEqual(kassenAenderungen(gruender, { dazu: [C] }), [{ art: "mitglied-dazu", adresse: C, rechte: 1 }], "dazu nur mit vorschlagen");
  assert.deepEqual(kassenAenderungen(gruender, { weg: [B] }), [{ art: "mitglied-weg", adresse: B }]);
  assert.throws(() => kassenAenderungen(gruender, { weg: [A] }), /Rechte fehlen|Art/, "der Gründer bleibt");
  assert.throws(() => kassenAenderungen({ ...gruender, verwalter: C }, { dazu: [D] }), /keine Kasse dieser App/);

  const nach = kassenStandNach(mehrheit, kassenAenderungen(mehrheit, { dazu: [C, D], zeitschlossSek: 86_400 }));
  assert.equal(kassenArt(nach), "mehrheit");
  assert.deepEqual([nach.schwelle, nach.zeitschlossSek, nach.mitglieder.length, nach.veraltetBis], [3, 86_400, 4, mehrheit.transaktionsIndex], "offene Vorschläge veraltet");
  assert.equal(mehrheit.mitglieder.length, 2, "der alte Stand bleibt unverändert");
  assert.throws(() => kassenStandNach(mehrheit, [{ art: "schwelle", schwelle: 3 }]), /Schwelle ungültig/, "mehr als Abstimmende");
  assert.throws(() => kassenStandNach(gruender, [{ art: "mitglied-weg", adresse: A }]), /Rechte fehlen/);

  // Das Konto wächst um zehn Plätze auf einmal und schrumpft nie (im Validator gegen beide Programme geprüft)
  assert.equal(kassenKontoGroesseNach(kassenKontoGroesse(2), 4), kassenKontoGroesse(2) + 330);
  assert.equal(kassenKontoGroesseNach(kassenKontoGroesse(2), 3), kassenKontoGroesse(2) + 330);
  assert.equal(kassenKontoGroesseNach(kassenKontoGroesse(2), 20), kassenKontoGroesse(20), "mehr als zehn dazu");
  assert.equal(kassenKontoGroesseNach(kassenKontoGroesse(5), 3), kassenKontoGroesse(5), "weniger Mitglieder: gleich groß");
});

test("A-12a3: Schritte einer Änderung – veraltet nicht mehr ausführen, angenommen dafür abschließen; unbekannte Form nur abschließen", () => {
  const mehrheit = { ...stand([{ adresse: A, rechte: 7 }, { adresse: B, rechte: 7 }, { adresse: C, rechte: 7 }], 2), veraltetBis: 0n, zeitschlossSek: 0 };
  const veraltet = { ...mehrheit, veraltetBis: 1n };
  const aenderung: KassenAenderung[] = [{ art: "zeitschloss", sek: 3600 }];
  const schritte = (v: KassenVorschlag, s: KassenStand, konfiguration: KassenAenderung[] | null = aenderung) =>
    vorschlagsSchritte({ stand: s, vorschlag: v, auszahlung: null, konfiguration, mitglied: A, jetztSek: 10_000 });
  assert.deepEqual(schritte(vorschlagAus(1n, "aktiv"), mehrheit), ["dafuer", "dagegen"]);
  assert.deepEqual(schritte(vorschlagAus(1n, "aktiv"), mehrheit, null), [], "unbekannte Änderung: nicht abstimmen");
  assert.deepEqual(schritte(vorschlagAus(1n, "angenommen"), mehrheit), ["ausfuehren"]);
  assert.deepEqual(schritte(vorschlagAus(1n, "angenommen"), veraltet), ["abschliessen"], "veraltet: nur noch abschließen");
  assert.deepEqual(schritte(vorschlagAus(1n, "aktiv"), veraltet), ["abschliessen"]);
  assert.deepEqual(schritte(vorschlagAus(1n, "ausgefuehrt"), mehrheit, null), ["abschliessen"]);
  // eine Auszahlung, angenommen und veraltet, bleibt ausführbar (A-12c1)
  assert.deepEqual(vorschlagsSchritte({ stand: veraltet, vorschlag: vorschlagAus(1n, "angenommen"), auszahlung: { empfaenger: EMPF, lamports: 1n }, mitglied: A, jetztSek: 10_000 }), ["ausfuehren"]);
});

test("A-12a3: die jüngsten Vorschläge erkennen Änderungen – die Auszahlung ist dann null", async () => {
  const sq = (daten: Uint8Array) => ({ eigentuemer: SQUADS_PROGRAMM_ID, daten });
  const vorschlag = (index: bigint) => bytes("Proposal").pk(KASSE).zahl(index, 8).u8(1).zahl(1000n, 8).u8(255).zahl(0n, 4).zahl(0n, 4).zahl(0n, 4).fertig();
  const aenderung = bytes("ConfigTransaction").pk(KASSE).pk(A).zahl(2n, 8).u8(254).zahl(1n, 4).u8(2).zahl(1n, 2).fertig();
  const rpc = ketteMit({
    [kassenVorschlagAdresse(KASSE, 2n)]: sq(vorschlag(2n)), [kassenTransaktionAdresse(KASSE, 2n)]: sq(aenderung),
    [kassenVorschlagAdresse(KASSE, 1n)]: sq(vorschlag(1n)), [kassenTransaktionAdresse(KASSE, 1n)]: sq(transaktionBytes()),
  });
  const liste = await leseVorschlaege(rpc, KASSE, { ...stand([{ adresse: A, rechte: 7 }], 1), transaktionsIndex: 2n });
  assert.deepEqual(liste[0], { index: 2n, vorschlag: leseVorschlag(vorschlag(2n)), auszahlung: null, konfiguration: [{ art: "schwelle", schwelle: 1 }] });
  assert.equal("konfiguration" in liste[1]!, false, "eine Auszahlung hat keine Konfiguration");
  assert.equal((await leseKonfigurationVonKette(rpc, KASSE, 2n))?.ersteller, A);
  await assert.rejects(leseKonfigurationVonKette(rpc, KASSE, 1n), /kein ConfigTransaction/);
  await assert.rejects(leseAuszahlungVonKette(rpc, KASSE, 2n), /kein VaultTransaction/, "eine Änderung ist keine Auszahlung");
});

// ---- A-12d1: Mitglieder und Wartezeit in der App ändern ----

test("A-12d1: Miete einer Änderung, die Art bei fremden Änderungen, ein Vorgang von der Kette", async () => {
  const D = adresse(24);
  const alle: KassenAenderung[] = [
    { art: "mitglied-dazu", adresse: C, rechte: 7 }, { art: "mitglied-weg", adresse: B }, { art: "schwelle", schwelle: 2 }, { art: "zeitschloss", sek: 3600 },
  ];
  // Kopf 85, dann je Änderung ihre Borsh-Länge: dazu 34, weg 33, Schwelle 3, Wartezeit 5 (im Validator gegen beide Programme geprüft)
  assert.deepEqual(konfigurationKontoGroessen(alle, 3), { transaktion: 160, vorschlag: auszahlungKontoGroessen(3).vorschlag });
  assert.equal(konfigurationKontoGroessen([{ art: "zeitschloss", sek: 0 }], 1).transaktion, 90);
  const [anlegen] = konfigurationVorschlagenAnweisungen({ kasse: KASSE, index: 6n, vorschlagender: A, aenderungen: alle });
  assert.equal(konfigurationKontoGroessen(alle, 3).transaktion, 8 + 32 + 32 + 8 + 1 + (anlegen!.data!.length - 8 - 1), "Kopf des Kontos und die Liste der Anweisung");
  assert.throws(() => konfigurationKontoGroessen([{ art: "schwelle", schwelle: 0 }], 2), /Schwelle ungültig/);

  // Die Art bleibt nur, wenn die Kasse danach dieselbe Form hat – was ein anderes Programm vorschlägt, kann sie ändern
  const mehrheit = { ...stand([{ adresse: A, rechte: 7 }, { adresse: B, rechte: 7 }, { adresse: C, rechte: 7 }], 2), zeitschlossSek: 0 };
  const gruender = { ...stand([{ adresse: A, rechte: 7 }, { adresse: B, rechte: 1 }], 1), zeitschlossSek: 0 };
  assert.equal(behaeltArt(mehrheit, kassenAenderungen(mehrheit, { dazu: [D] })), true);
  assert.equal(behaeltArt(gruender, kassenAenderungen(gruender, { dazu: [C], zeitschlossSek: 86_400 })), true);
  assert.equal(behaeltArt(mehrheit, [{ art: "schwelle", schwelle: 1 }]), false, "Schwelle 1 bei dreien ist keine Mehrheit");
  assert.equal(behaeltArt(mehrheit, [{ art: "mitglied-dazu", adresse: D, rechte: 1 }]), false, "bei der Mehrheit hat jeder alle Rechte");
  assert.equal(behaeltArt(mehrheit, [{ art: "schwelle", schwelle: 4 }]), false, "das Programm lehnte ab");
  assert.equal(behaeltArt(gruender, [{ art: "mitglied-dazu", adresse: C, rechte: 7 }]), false, "ein zweiter mit allen Rechten");
  assert.equal(behaeltArt({ ...gruender, verwalter: C }, [{ art: "zeitschloss", sek: 3600 }]), false, "keine Kasse dieser App");

  // Ein Vorgang von der Kette: Änderung oder Auszahlung unter derselben Adresse, ohne Vorschlag keiner
  const sq = (daten: Uint8Array) => ({ eigentuemer: SQUADS_PROGRAMM_ID, daten });
  const vorschlag = (index: bigint) => bytes("Proposal").pk(KASSE).zahl(index, 8).u8(1).zahl(1000n, 8).u8(255).zahl(0n, 4).zahl(0n, 4).zahl(0n, 4).fertig();
  const rpc = ketteMit({
    [kassenVorschlagAdresse(KASSE, 2n)]: sq(vorschlag(2n)),
    [kassenTransaktionAdresse(KASSE, 2n)]: sq(bytes("ConfigTransaction").pk(KASSE).pk(A).zahl(2n, 8).u8(254).zahl(1n, 4).u8(3).zahl(3600n, 4).fertig()),
    [kassenVorschlagAdresse(KASSE, 1n)]: sq(vorschlag(1n)), [kassenTransaktionAdresse(KASSE, 1n)]: sq(transaktionBytes()),
    [kassenTransaktionAdresse(KASSE, 3n)]: sq(transaktionBytes()),
  });
  assert.deepEqual((await leseVorgang(rpc, KASSE, 2n))?.konfiguration, [{ art: "zeitschloss", sek: 3600 }]);
  assert.deepEqual((await leseVorgang(rpc, KASSE, 1n))?.auszahlung, { empfaenger: EMPF, lamports: 100_000_000n });
  assert.equal(await leseVorgang(rpc, KASSE, 3n), null, "ohne Vorschlag kein Vorgang");
});
