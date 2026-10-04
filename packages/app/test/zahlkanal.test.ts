/**
 * Schritt 4.3d1: Zahlkanal in der App – Kanal-Buch (Gutschrift je Anfrage,
 * Antwort verbuchen), Rückholen nach Ablauf über den Wächter und die
 * Verdrahtung in `buildJobEvent()`/`handleAnswer()`. Geprüft wird vor allem:
 * Die Gutschrift deckt, was der Knoten verlangt (abgerechnet + Gebot), der
 * Kunde signiert nie mehr als nötig – und nach einer Kanal-Antwort zahlt
 * Lightning nichts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Keypair, PublicKey, type Transaction } from "@solana/web3.js";
import {
  KANAL_KONTO_BYTES, KANAL_PROGRAMM_ID, SICHERUNG_NIE, fromHex, kanalAdresse, leseGutschriftTags, msatZuLamports,
  neuerSitzungsSchluessel, pruefeGutschrift, signiereGutschrift, toHex, type KanalStand,
} from "@freedomstack/protocol";
import {
  KANAL_NUTZBAR_SEK, KanalBuch, LS_KANAELE, bedarfLamports, erstatteKanaele, kanalAufKette, planeKanal, programmBereit, type KanalEintrag,
} from "../src/zahlkanal.js";
import { setzeSperrSpeicher, sweepPendingRefunds, walletRefundRunner, type PendingKind } from "../src/refund-watcher.js";

const JETZT = 1_900_000_000;
const kunde = Keypair.generate().publicKey.toBase58();
const providerSol = Keypair.generate().publicKey.toBase58();
const PROVIDER = "ab".repeat(32);

function speicher() {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
}

function kanal(p: Partial<KanalEintrag> = {}) {
  const sitzung = neuerSitzungsSchluessel();
  const nonce = BigInt(Math.floor(Math.random() * 1e9));
  const eintrag: KanalEintrag = {
    kanal: kanalAdresse(kunde, providerSol, nonce).adresse, provider: PROVIDER, providerSol, kunde, nonce: nonce.toString(),
    ablauf: JETZT + 86_400, eingezahlt: "1000000", empfaenger: [], sitzung: toHex(sitzung.geheim),
    letzte: "0", abgerechnet: "0", offen: [], ...p,
  };
  const stand: KanalStand = {
    kunde, provider: providerSol, sitzungsSchluessel: sitzung.oeffentlich, nonce, eingezahlt: BigInt(eintrag.eingezahlt),
    ausgezahlt: 0n, ablauf: BigInt(eintrag.ablauf), empfaenger: [], bump: 255,
  };
  return { eintrag, stand };
}

async function buchMit(e: KanalEintrag) {
  const s = speicher();
  const buch = new KanalBuch(s);
  await buch.merke(e);
  return { buch, s };
}

/** Wählt, merkt und prüft eine Gutschrift wie der Knoten (Signatur, Kanal, Ablauf, Einlage). */
async function sende(buch: KanalBuch, stand: KanalStand, bedarf: bigint, requestId: string) {
  const w = buch.gutschriftFuer({ provider: PROVIDER, bedarf, jetzt: JETZT });
  assert.equal(w.art, "kanal");
  if (w.art !== "kanal") throw new Error("kein Kanal");
  const g = leseGutschriftTags(w.tags)!;
  assert.equal(g.betrag, w.betrag);
  assert.deepEqual(pruefeGutschrift(g, { adresse: w.eintrag.kanal, stand }, 0n), { ok: true }, "der Knoten nimmt sie an");
  await buch.gesendet(w.eintrag.kanal, w.betrag, requestId);
  return w.betrag;
}

test("Bedarf: Gebot + Werkzeuge zum Kurs des Providers, aufgerundet, mit 2 % Spielraum", () => {
  // 100.000 sats je SOL: 1.000 msat = 10.000 Lamports → + 200
  assert.equal(msatZuLamports(1_000, 100_000), 10_000);
  assert.equal(bedarfLamports(1_000, 100_000), 10_200n);
  assert.equal(bedarfLamports(1, 100_000), 11n, "10 + 1 (aufgerundet)");
});

test("Gutschrift: erst der Bedarf, nach der Antwort Preis + Bedarf – der Knoten deckt so jede Anfrage", async () => {
  const { eintrag, stand } = kanal();
  const { buch } = await buchMit(eintrag);
  assert.equal(await sende(buch, stand, 10_000n, "a1"), 10_000n);
  assert.deepEqual(buch.alle()[0]!.offen, ["a1"]);
  // Antwort: 5.000 Lamports – die Basis ist jetzt der Preis
  await buch.beantwortet("a1", 5_000);
  assert.equal(buch.alle()[0]!.abgerechnet, "5000");
  assert.deepEqual(buch.alle()[0]!.offen, []);
  assert.equal(await sende(buch, stand, 10_000n, "a2"), 15_000n, "abgerechnet + Bedarf");
  // Kleiner Bedarf: nie unter die letzte Gutschrift (dieselbe noch einmal nimmt der Knoten an)
  await buch.beantwortet("a2", 1_000);
  assert.equal(await sende(buch, stand, 100n, "a3"), 15_000n);
});

test("Gutschrift ohne Antwort: vorsichtig ab der letzten – sonst hinge der Kanal, wenn der Provider gebucht hat", async () => {
  const { eintrag, stand } = kanal();
  const { buch } = await buchMit(eintrag);
  await sende(buch, stand, 10_000n, "a1");
  // a1 bleibt ohne Antwort – der Provider kann bis 10.000 gebucht haben
  assert.equal(await sende(buch, stand, 10_000n, "a2"), 20_000n, "letzte + Bedarf");
  // Spät kommt die Antwort zu a1 (Preis 4.000), a2 bleibt offen: weiter vorsichtig
  await buch.beantwortet("a1", 4_000);
  assert.deepEqual(buch.alle()[0]!.offen, ["a2"]);
  assert.equal(await sende(buch, stand, 1_000n, "a3"), 21_000n);
});

test("Antwort ohne gültigen Preis zählt die ganze Gutschrift; ein Preis über der Gutschrift wird gedeckelt", async () => {
  const { eintrag, stand } = kanal();
  const { buch } = await buchMit(eintrag);
  await sende(buch, stand, 10_000n, "a1");
  await buch.beantwortet("a1", undefined);
  assert.equal(buch.alle()[0]!.abgerechnet, "10000");
  await sende(buch, stand, 10_000n, "a2");
  await buch.beantwortet("a2", 999_999);
  assert.equal(buch.alle()[0]!.abgerechnet, "20000", "höchstens die letzte Gutschrift");
  await sende(buch, stand, 1_000n, "a3");
  await buch.beantwortet("a3", -5);
  assert.equal(buch.alle()[0]!.abgerechnet, "21000", "negativ zählt als ganze Gutschrift");
  assert.equal(await buch.beantwortet("fremd", 1), false, "keine Kanal-Anfrage");
});

test("Kein Kanal, fremder Provider, zu kurze Laufzeit, erschöpft – nie eine Gutschrift über der Einlage", async () => {
  assert.deepEqual(new KanalBuch(speicher()).gutschriftFuer({ provider: PROVIDER, bedarf: 1n, jetzt: JETZT }), { art: "keiner" });
  const { buch } = await buchMit(kanal().eintrag);
  assert.equal(buch.gutschriftFuer({ provider: "cd".repeat(32), bedarf: 1n, jetzt: JETZT }).art, "keiner");
  const kurz = await buchMit(kanal({ ablauf: JETZT + 3_600 }).eintrag);
  assert.equal(kurz.buch.gutschriftFuer({ provider: PROVIDER, bedarf: 1n, jetzt: JETZT }).art, "keiner", "läuft in 1 h ab – der Knoten nähme ihn nicht");
  const voll = await buchMit(kanal({ eingezahlt: "15000", abgerechnet: "6000", letzte: "10000" }).eintrag);
  assert.equal(voll.buch.gutschriftFuer({ provider: PROVIDER, bedarf: 9_000n, jetzt: JETZT }).art, "kanal", "genau die Einlage");
  assert.equal(voll.buch.gutschriftFuer({ provider: PROVIDER, bedarf: 9_001n, jetzt: JETZT }).art, "erschoepft");
});

test("Kanal-Buch: der am längsten laufende Kanal des Providers; kaputte Einträge fallen weg", async () => {
  const s = speicher();
  const buch = new KanalBuch(s);
  const kurz = kanal({ ablauf: JETZT + 10_000 }).eintrag;
  const lang = kanal({ ablauf: JETZT + 90_000 }).eintrag;
  await buch.merke(kurz);
  await buch.merke(lang);
  assert.equal(buch.fuerProvider(PROVIDER, JETZT)?.kanal, lang.kanal);
  s.m.set(LS_KANAELE, JSON.stringify([...buch.alle(), { kanal: "x", sitzung: "zz" }, null]));
  assert.equal(buch.alle().length, 2);
  s.m.set(LS_KANAELE, "{kaputt");
  assert.deepEqual(buch.alle(), []);
});

// ------------------------------------------------ Rückholen nach Ablauf

function kontoDaten(k: string, eingezahlt = 1_000_000n): Buffer {
  const b = Buffer.alloc(KANAL_KONTO_BYTES);
  createHash("sha256").update("account:Channel").digest().subarray(0, 8).copy(b, 0);
  let o = 8;
  for (const a of [k, providerSol, Keypair.generate().publicKey.toBase58()]) { new PublicKey(a).toBuffer().copy(b, o); o += 32; }
  o = b.writeBigUInt64LE(1n, o); o = b.writeBigUInt64LE(eingezahlt, o); o = b.writeBigUInt64LE(0n, o);
  o = b.writeBigInt64LE(BigInt(JETZT), o); o = b.writeUInt32LE(0, o);
  b[o] = 255;
  return b;
}

function kette(konten: Map<string, { owner: string; data: Buffer }>) {
  const gesendet: Transaction[] = [];
  const conn = {
    getAccountInfo: async (p: PublicKey) => {
      const k = konten.get(p.toBase58());
      return k ? { owner: new PublicKey(k.owner), data: k.data, executable: false, lamports: 1, rentEpoch: 0 } : null;
    },
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 }),
    sendRawTransaction: async () => `sig${gesendet.length}`,
    confirmTransaction: async () => ({ value: { err: null } }),
  };
  const wallet = {
    publicKey: { toBase58: () => kunde },
    signTransaction: async (tx: unknown) => { gesendet.push(tx as Transaction); return { serialize: () => Buffer.alloc(0) }; },
  };
  return { conn: conn as unknown as import("@solana/web3.js").Connection, wallet, gesendet };
}

test("Rückholen: offen ist ein Kanal, solange sein Konto beim Programm liegt; refund ohne Unterschrift des Kunden (Z1)", async () => {
  const offen = Keypair.generate().publicKey.toBase58();
  const fremdesProgramm = Keypair.generate().publicKey.toBase58();
  const weg = Keypair.generate().publicKey.toBase58();
  const k = kette(new Map([
    [offen, { owner: KANAL_PROGRAMM_ID, data: kontoDaten(kunde) }],
    [fremdesProgramm, { owner: Keypair.generate().publicKey.toBase58(), data: kontoDaten(kunde) }],
  ]));
  assert.equal((await kanalAufKette(k.conn, offen))?.kunde, kunde);
  assert.equal(await kanalAufKette(k.conn, fremdesProgramm), null);
  const runner = walletRefundRunner(k.conn, k.wallet);
  assert.deepEqual(await runner.offen!([offen, fremdesProgramm, weg], "kanal"), [offen]);
  const r = await runner.refund([offen], "kanal");
  assert.deepEqual(r, { signature: "sig1", refunded: [offen], failed: [] });
  const [ix] = k.gesendet[0]!.instructions;
  assert.equal(ix!.programId.toBase58(), KANAL_PROGRAMM_ID);
  assert.deepEqual(ix!.keys.map((x) => [x.pubkey.toBase58(), x.isSigner]), [[kunde, false], [offen, false]]);
});

test("Rückholen (Z1): Kanal einer anderen Wallet – das Geld geht an deren Adresse, diese Wallet zahlt nur die Gebühr", async () => {
  const fremd = Keypair.generate().publicKey.toBase58();
  const kanalFremd = Keypair.generate().publicKey.toBase58();
  const k = kette(new Map([[kanalFremd, { owner: KANAL_PROGRAMM_ID, data: kontoDaten(fremd) }]]));
  const r = await erstatteKanaele(k.conn, k.wallet, [kanalFremd]);
  assert.deepEqual(r, { signature: "sig1", refunded: [kanalFremd], failed: [] });
  const tx = k.gesendet[0]!;
  const [ix] = tx.instructions;
  assert.deepEqual(ix!.keys.map((x) => [x.pubkey.toBase58(), x.isSigner, x.isWritable]), [[fremd, false, true], [kanalFremd, false, true]], "Empfänger ist der Kunde auf der Kette");
  assert.notEqual(fremd, kunde);
  assert.equal(tx.feePayer?.toBase58(), kunde, "die Gebühr zahlt diese Wallet");
});

test("Wächter: gibt die Art der Sperre an den Runner – ein Kanal wird wie ein Kanal zurückgeholt", async () => {
  const m = new Map<string, string>();
  setzeSperrSpeicher({ getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); }, keys: () => [...m.keys()] });
  const { rememberLock } = await import("../src/refund-watcher.js");
  await rememberLock({ kind: "kanal", reference: "K1", swapIds: ["K1"], timelockUnix: JETZT - 1, amountLamports: 5, createdAt: JETZT - 100 });
  const arten: Array<PendingKind | undefined> = [];
  const r = await sweepPendingRefunds({
    offen: async (ids, kind) => { arten.push(kind); return ids; },
    refund: async (ids, kind) => { arten.push(kind); return { refunded: ids, failed: [] }; },
  }, JETZT);
  assert.deepEqual(arten, ["kanal", "kanal"]);
  assert.equal(r.zurueckgeholt, 1);
});

// ------------------------------------------------ Verdrahtung

test("Verdrahtung: Gutschrift vor dem Versiegeln statt Deklaration, gemerkt vor dem Senden; Kanal-Antworten zahlt Lightning nicht", () => {
  const agent = readFileSync(new URL("../src/shell/tabs/agent.ts", import.meta.url), "utf8");
  const zahlung = readFileSync(new URL("../src/shell/ki-zahlung.ts", import.meta.url), "utf8");
  const tresor = readFileSync(new URL("../src/shell/tresor.ts", import.meta.url), "utf8");
  const bau = agent.slice(agent.indexOf("async function buildJobEvent("));
  const i = (s: string) => { const n = bau.indexOf(s); assert.ok(n >= 0, s); return n; };
  // Seit B-8c: an den eigenen Knoten kein Kanal (er rechnet gratis)
  assert.ok(i("const kanal = eigen ? undefined : await kanalGutschrift(targetPubkey, hoechst);") < i("buildPrivateJobRequest({"));
  i("extraTags.push(...(eigen ? [] : kanal ? kanal.tags : deklaration(empfaenger)));");
  i("const useSession = !eigen && !kanal && sc.activeFor(targetPubkey);");
  assert.ok(i("buildPrivateJobRequest({") < i("if (kanal) await kanal.merke(auftrag.requestId);"));
  assert.ok(i("if (kanal) await kanal.merke(auftrag.requestId);") < i("return auftrag;"));
  const antwort = agent.slice(agent.indexOf("async function handleAnswer("));
  const j = (s: string) => { const n = antwort.indexOf(s); assert.ok(n >= 0, s); return n; };
  assert.ok(j("const kanal = perKanal(r.requestId);") < j("rechneAntwortAb(r.requestId"));
  assert.ok(j("await kanalAntwort(r.requestId, r.amountLamports);") < j("await providerZahlung(r.providerPubkey)"));
  assert.match(zahlung, /if \(wahl\.art === "erschoepft"\) throw new Error\(t\("zahl\.kanalErschoepft"\)\);/, "nie still auf Lightning");
  assert.match(tresor, /const GEHEIM_FEST = \[[^\]]*"freedom\.kanaele"/, "im Tresor");
  assert.ok(SICHERUNG_NIE.some((r) => r.test(LS_KANAELE)), "nie in der Zustandssicherung");
});

// ------------------------------------------------ Öffnen (4.3d2)

test("4.3d2: Kanal planen – Adresse nach den Seeds, Anweisung nach docs/ZAHLKANAL.md, Sitzungsschlüssel passt", () => {
  const empfaenger = [{ adresse: Keypair.generate().publicKey.toBase58(), ppm: 25_000 }];
  const { eintrag, ix } = planeKanal({ provider: PROVIDER, providerSol, kunde, lamports: 50_000_000n, laufzeitSek: 7 * 86_400, empfaenger, jetzt: JETZT });
  assert.equal(eintrag.kanal, kanalAdresse(kunde, providerSol, BigInt(eintrag.nonce)).adresse);
  assert.deepEqual([eintrag.ablauf, eintrag.eingezahlt, eintrag.letzte, eintrag.abgerechnet, eintrag.offen], [JETZT + 7 * 86_400, "50000000", "0", "0", []]);
  assert.equal(ix.programId.toBase58(), KANAL_PROGRAMM_ID);
  assert.deepEqual(ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]).slice(0, 3), [[kunde, true, true], [providerSol, false, false], [eintrag.kanal, false, true]]);
  // Daten: Diskriminator, nonce, Betrag, Ablauf, Sitzungsschlüssel, Empfänger
  const d = Buffer.from(ix.data);
  assert.equal(d.readBigUInt64LE(8), BigInt(eintrag.nonce));
  assert.equal(d.readBigUInt64LE(16), 50_000_000n);
  assert.equal(d.readBigInt64LE(24), BigInt(JETZT + 7 * 86_400));
  const sitzungOeffentlich = new PublicKey(d.subarray(32, 64)).toBase58();
  // Der gemerkte Schlüssel signiert, was das Programm mit dem Schlüssel aus der Anweisung prüft
  const g = signiereGutschrift(fromHex(eintrag.sitzung), eintrag.kanal, 1_000n, BigInt(eintrag.ablauf));
  const stand: KanalStand = {
    kunde, provider: providerSol, sitzungsSchluessel: sitzungOeffentlich, nonce: BigInt(eintrag.nonce), eingezahlt: 50_000_000n,
    ausgezahlt: 0n, ablauf: BigInt(eintrag.ablauf), empfaenger, bump: 255,
  };
  assert.deepEqual(pruefeGutschrift(g, { adresse: eintrag.kanal, stand }, 0n), { ok: true });
  assert.equal(d.readUInt32LE(64), 1);
  // Jeder Kanal eine eigene Nonce
  assert.notEqual(planeKanal({ provider: PROVIDER, providerSol, kunde, lamports: 1n, laufzeitSek: KANAL_NUTZBAR_SEK, empfaenger: [], jetzt: JETZT }).eintrag.nonce, eintrag.nonce);
});

test("4.3d2: Kanal planen lehnt ab – Betrag 0, zu kurze Laufzeit, zu hohe Anteile", () => {
  const p = { provider: PROVIDER, providerSol, kunde, lamports: 1n, laufzeitSek: 86_400, empfaenger: [], jetzt: JETZT };
  assert.throws(() => planeKanal({ ...p, lamports: 0n }));
  assert.throws(() => planeKanal({ ...p, laufzeitSek: KANAL_NUTZBAR_SEK - 1 }));
  assert.throws(() => planeKanal({ ...p, empfaenger: [{ adresse: Keypair.generate().publicKey.toBase58(), ppm: 100_001 }] }), /10 %/);
});

test("4.3d2: Programm bereit nur, wenn es ausführbar auf der Kette liegt; Kanal-Buch räumt lange Abgelaufene weg", async () => {
  const kette = (i: unknown) => ({ getAccountInfo: async () => i }) as unknown as import("@solana/web3.js").Connection;
  assert.equal(await programmBereit(kette({ executable: true })), true);
  assert.equal(await programmBereit(kette({ executable: false })), false);
  assert.equal(await programmBereit(kette(null)), false, "bis zum Deploy: Platzhalter ohne Programm");
  const { buch } = await buchMit(kanal({ ablauf: JETZT - 31 * 86_400 }).eintrag);
  const frisch = kanal({ ablauf: JETZT - 86_400 }).eintrag;
  await buch.merke(frisch);
  await buch.raeumeAuf(JETZT);
  assert.deepEqual(buch.alle().map((e) => e.kanal), [frisch.kanal], "vor 31 Tagen abgelaufen: weg; gestern: bleibt");
  await buch.entferne(frisch.kanal);
  assert.deepEqual(buch.alle(), []);
});

test("4.3d2 Verdrahtung: Programm und Angebot prüfen, Tresor, merken, dann einzahlen; gescheitert und nicht auf der Kette → aus dem Kanal-Buch", () => {
  const ui = readFileSync(new URL("../src/shell/zahlkanal-ui.ts", import.meta.url), "utf8");
  const f = ui.slice(ui.indexOf("export async function oeffneZahlkanal("), ui.indexOf("export async function zeigeKanaele("));
  const i = (s: string) => { const n = f.indexOf(s); assert.ok(n >= 0, s); return n; };
  assert.ok(i("if (angebot.kanal.programm !== KANAL_PROGRAMM_ID)") < i("await programmBereit(conn)"));
  assert.ok(i("await programmBereit(conn)") < i("await verlangeTresor("));
  i("kanalEmpfaenger(await empfaengerFuer(providerPk), [angebot.kanal.adresse, kunde])");
  assert.ok(i("await verlangeTresor(") < i("await kanalBuch.merke(plan.eintrag);"));
  assert.ok(i("await kanalBuch.merke(plan.eintrag);") < i("await rememberLock({"));
  assert.ok(i("await rememberLock({") < i("await sendeMitWallet(conn, signer, [plan.ix]"));
  i('kind: "kanal", reference: plan.eintrag.kanal, swapIds: [plan.eintrag.kanal]');
  i("=== null) await kanalBuch.entferne(kanal)");
  assert.doesNotMatch(ui, /innerHTML/, "Übersicht nur über textContent");
  const app = readFileSync(new URL("../src/shell/app.ts", import.meta.url), "utf8");
  assert.match(app, /if \(name === "wallet"\) \{ loadWallet\(\); void zeigeKanaele\(\); \}/);
  assert.match(app, /\$\("#kanal-start"\)\.onclick = \(\) => void oeffneZahlkanal\(\);/);
  const waehrung = readFileSync(new URL("../src/shell/tabs/hinterlegen.ts", import.meta.url), "utf8");
  assert.match(waehrung, /return activeSwap !== null \|\| activeDeposit !== null \|\| kanalEinzahlung;/, "Tresor sperrt nicht während der Einzahlung");
  assert.ok(i("setzeKanalEinzahlung(true);") < i("await sendeMitWallet(") && i("await sendeMitWallet(") < i("setzeKanalEinzahlung(false);"));
  const html = readFileSync(new URL("../src/shell/index.html", import.meta.url), "utf8");
  const lp = html.slice(html.indexOf('data-subpane="wallet:lp"'), html.indexOf("<!-- EARN -->"));
  for (const id of ["kanal-karte", "kanal-betrag", "kanal-laufzeit", "kanal-status", "kanal-start", "kanal-liste"]) assert.match(lp, new RegExp(`id="${id}"`));
});

test("E8: „knapp“, sobald der Rest weniger als drei weitere Anfragen dieser Größe deckt; Aufstocken erhöht nur die Einlage", async () => {
  const { eintrag } = kanal({ eingezahlt: "1000000" });
  const { buch } = await buchMit(eintrag);
  const w1 = buch.gutschriftFuer({ provider: PROVIDER, bedarf: 200_000n, jetzt: JETZT });
  assert.equal(w1.art === "kanal" && w1.knapp, false, "800 000 frei – reicht für vier weitere");
  const w2 = buch.gutschriftFuer({ provider: PROVIDER, bedarf: 300_000n, jetzt: JETZT });
  assert.equal(w2.art === "kanal" && w2.knapp, true, "700 000 frei – weniger als drei weitere zu 300 000");
  await buch.aufgestockt(eintrag.kanal, 2_000_000n);
  const nachher = buch.alle().find((x) => x.kanal === eintrag.kanal)!;
  assert.equal(nachher.eingezahlt, "3000000");
  assert.deepEqual({ ...nachher, eingezahlt: eintrag.eingezahlt }, eintrag, "sonst unverändert");
  const w3 = buch.gutschriftFuer({ provider: PROVIDER, bedarf: 300_000n, jetzt: JETZT });
  assert.equal(w3.art === "kanal" && w3.knapp, false, "nach dem Aufstocken wieder genug");
  await buch.aufgestockt(eintrag.kanal, 0n);
  await buch.aufgestockt("fremd", 5n);
  assert.equal(buch.alle().find((x) => x.kanal === eintrag.kanal)!.eingezahlt, "3000000", "0 und fremde Kanäle ändern nichts");
});

test("E8 Verdrahtung: Aufstocken nur mit der Wallet des Kunden, erst bestätigen, Einlage erst nach der Kette; Warnung einmal je Kanal", () => {
  const ui = readFileSync(new URL("../src/shell/zahlkanal-ui.ts", import.meta.url), "utf8");
  const fn = ui.slice(ui.indexOf("export async function stockeKanalAuf("));
  assert.ok(fn.indexOf("signer.publicKey.toBase58() !== e.kunde") < fn.indexOf("await dialog("), "die Wallet zuerst prüfen");
  assert.ok(fn.indexOf("await bestaetige(") < fn.indexOf("await sendeMitWallet("), "erst bestätigen");
  assert.ok(fn.indexOf("await sendeMitWallet(") < fn.indexOf("await kanalBuch.aufgestockt("), "Einlage erst nach der Kette");
  assert.match(fn, /stockeKanalAufIx\(\{ kunde: e\.kunde, kanal, betrag: lamports \}\)/);
  assert.match(fn, /solZuLamports\(String\(w\.sol\)\)/, "Betrag ohne Gleitkomma");
  assert.match(ui, /if \(e\.ablauf - jetzt >= KANAL_NUTZBAR_SEK\) \{\s*const knopf = el\("button", t\("waehr\.kanalAufstocken"\)/, "Knopf nur, solange der Kanal taugt");
  const kz = readFileSync(new URL("../src/shell/ki-zahlung.ts", import.meta.url), "utf8");
  assert.match(kz, /if \(wahl\.knapp && !knappGemeldet\.has\(wahl\.eintrag\.kanal\)\) \{\s*knappGemeldet\.add\(wahl\.eintrag\.kanal\);/);
});
