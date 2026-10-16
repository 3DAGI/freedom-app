/**
 * RM2b1: Pfand-Kasse des Knotens. Ohne Mint: Datei (0600, kaputt → kein Start), unbekannte Mint.
 * Mit einer Mint auf diesem Rechner (Nutshell mit FakeWallet, `scripts/cashu-testmint.sh`, Adresse in
 * `CASHU_TEST_MINT`; ohne sie überspringen sich diese Tests): annehmen nur mit Deckung und nie doppelt,
 * auch nach einem Neustart; einlösen vor der Frist, zu spät nie; ein Abbruch mitten im Tausch verliert
 * nichts; die Mint hält die Frist ein (V3) – vorher löst nur der Knoten ein, danach der Rückweg.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { P2PKBuilder, Wallet, getPubKeyFromPrivKey, type Proof } from "@cashu/cashu-ts";
import { randomBytes } from "node:crypto";
import type { Pfand } from "@freedomstack/protocol";
import { PfandKasse, pfandKasseAusUmgebung, pfandSpeicher, type PfandStand } from "../src/pfand-kasse.js";

const MINT = process.env["CASHU_TEST_MINT"];
const ohneMint = !MINT && "CASHU_TEST_MINT fehlt (scripts/cashu-testmint.sh)";
const SITZUNG = "aa".repeat(32);
const jetzt = () => Math.floor(Date.now() / 1000);

function ordner(): string {
  return mkdtempSync(join(tmpdir(), "pfand-"));
}

/** Speicher als Datei; `bricht` lässt ein Schreiben scheitern (Absturz). */
function speicher(pfad = join(ordner(), "pfand.json")) {
  const datei = pfandSpeicher(pfad);
  const sp = {
    pfad,
    bricht: undefined as ((s: PfandStand) => boolean) | undefined,
    lade: () => datei.lade(),
    speichere: (s: PfandStand) => {
      if (sp.bricht?.(s)) throw new Error("Absturz");
      datei.speichere(s);
    },
  };
  return sp;
}

async function kasse(o: { sp?: ReturnType<typeof speicher>; uhr?: () => number } = {}): Promise<PfandKasse> {
  const k = new PfandKasse({ mints: [MINT!], speicher: o.sp ?? speicher(), jetzt: o.uhr });
  assert.deepEqual(await k.ladeMints(), [{ mint: MINT }]);
  const ks = (await (await fetch(`${MINT}/v1/keysets`)).json()) as { keysets: Array<{ input_fee_ppk?: number }> };
  gebuehr = ks.keysets[0]?.input_fee_ppk ?? 0;
  return k;
}

/** Der Kunde: Geld bei der FakeWallet-Mint (sie bezahlt ihre Rechnung selbst), dann gesperrt auf den Knoten. */
async function sperre(an: string, betrag: number, frist: number, rueck = Buffer.from(getPubKeyFromPrivKey(randomBytes(32))).toString("hex")) {
  const w = new Wallet(MINT!, { unit: "sat" });
  await w.loadMint();
  const q = await w.createMintQuoteBolt11(betrag + 8);
  const geld = await w.mintProofsBolt11(betrag + 8, q.quote);
  const r = await w.ops.send(betrag, geld)
    .asP2PK(new P2PKBuilder().addLockPubkey(an).lockUntil(frist).addRefundPubkey(rueck).toOptions())
    .includeFees(true).run();
  return { w, token: r.send };
}

/** Gebühr der Mint je Token in msat (NUT-02, `input_fee_ppk`); die Test-Mint verlangt 100. */
let gebuehr = 0;
const nennwert = (token: Proof[]) => token.reduce((n, p) => n + p.amount.toNumber(), 0);
const netto = (token: Proof[]) => nennwert(token) * 1000 - token.length * gebuehr;

const alsPfand = (token: Proof[]): Pfand => ({
  mint: MINT!,
  token: token.map((p) => ({
    id: p.id, amount: p.amount.toNumber(), secret: p.secret, C: p.C,
    dleq: { e: p.dleq!.e, s: p.dleq!.s, r: p.dleq!.r! },
  })),
});

test("Datei: 0600, ein Neustart behält den Schlüssel; kaputt heißt kein Start", () => {
  const sp = speicher();
  const a = new PfandKasse({ mints: [], speicher: sp });
  assert.equal(statSync(sp.pfad).mode & 0o777, 0o600);
  assert.match(a.schluessel(), /^0[23][0-9a-f]{64}$/);
  assert.equal(new PfandKasse({ mints: [], speicher: speicher(sp.pfad) }).schluessel(), a.schluessel());
  writeFileSync(sp.pfad, "{kaputt");
  assert.throws(() => new PfandKasse({ mints: [], speicher: speicher(sp.pfad) }));
  writeFileSync(sp.pfad, JSON.stringify({ fassung: 1, sk: "zz" }));
  assert.throws(() => new PfandKasse({ mints: [], speicher: speicher(sp.pfad) }), /kein Stand/);
});

test("Umgebung (RM2b2): nur mit PFAND=1 und gültigen Mints; Ungültiges und Tor heißen kein Start", () => {
  const datei = join(ordner(), "pfand.json");
  assert.equal(pfandKasseAusUmgebung({}, datei), undefined);
  assert.equal(pfandKasseAusUmgebung({ PFAND: "0", PFAND_MINTS: "https://mint.example.org" }, datei), undefined);
  const kasse = pfandKasseAusUmgebung({ PFAND: "1", PFAND_MINTS: " https://mint.example.org, http://abcdefghijklmnop.onion ,https://mint.example.org" }, datei);
  assert.ok(kasse instanceof PfandKasse);
  assert.deepEqual(kasse.bereit(), [], "erst nach ladeMints() im Angebot");
  assert.equal(statSync(datei).mode & 0o777, 0o600);
  const kaputt: Array<Record<string, string>> = [
    { PFAND: "ja", PFAND_MINTS: "https://mint.example.org" },
    { PFAND: "1" },
    { PFAND: "1", PFAND_MINTS: " , " },
    { PFAND: "1", PFAND_MINTS: "http://mint.example.org" },
    { PFAND: "1", PFAND_MINTS: "https://mint.example.org/" },
    { PFAND: "1", PFAND_MINTS: "https://nutzer:pw@mint.example.org" },
    { PFAND: "1", PFAND_MINTS: "http://127.0.0.1:3338" },
    { PFAND: "1", PFAND_MINTS: Array.from({ length: 6 }, (_, i) => `https://m${i}.example.org`).join(",") },
    { PFAND: "1", PFAND_MINTS: "https://mint.example.org", TOR_SOCKS: "127.0.0.1:9050" },
  ];
  for (const env of kaputt) assert.throws(() => pfandKasseAusUmgebung(env, join(ordner(), "pfand.json")), JSON.stringify(env));
});

test("Ohne bereite Mint kein Pfand; eine Mint ohne Netz meldet sich", async () => {
  const k = new PfandKasse({ mints: ["http://127.0.0.1:9"], speicher: speicher() });
  assert.deepEqual(k.bereit(), []);
  assert.deepEqual(await k.ladeMints(), [{ mint: "http://127.0.0.1:9", fall: "mint-netz" }]);
  const r = await k.nimmAn({ mint: "https://mint.example.org", token: [] }, SITZUNG, 0);
  assert.deepEqual(r, { ok: false, fall: "pfand-mint" });
});

test("Annehmen: nur mit Deckung, je Sitzung, nie doppelt – auch nach einem Neustart", { skip: ohneMint }, async () => {
  const sp = speicher();
  const k = await kasse({ sp });
  const { token } = await sperre(k.schluessel(), 16, jetzt() + 3600);
  const pfand = alsPfand(token);
  const n = netto(token);
  assert.ok(n >= 16_000, `netto ${n}: die Gebühr fürs Einlösen trägt der Kunde`);
  assert.deepEqual(await k.nimmAn(pfand, SITZUNG, n + 1), { ok: false, fall: "pfand-deckung" }, "der Nennwert zählt nicht");
  assert.equal(k.summen().offen, 0, "ohne Deckung bleibt alles, wie es war");
  assert.deepEqual(await k.nimmAn(pfand, SITZUNG, 10_000), { ok: true, guthabenMsat: n });
  assert.equal(k.verbuche(SITZUNG, 9_000), 9_000);
  // Ohne neue Token reicht, was übrig ist
  assert.deepEqual(await k.nimmAn({ mint: MINT!, token: [] }, SITZUNG, n - 9_000), { ok: true, guthabenMsat: n - 9_000 });
  assert.deepEqual(await k.nimmAn({ mint: MINT!, token: [] }, SITZUNG, n - 8_999), { ok: false, fall: "pfand-deckung" });
  assert.deepEqual(await k.nimmAn({ mint: MINT!, token: [] }, "bb".repeat(32), 1), { ok: false, fall: "pfand-deckung" }, "fremde Sitzung");
  assert.equal(k.konto("bb".repeat(32)), undefined);
  assert.equal(k.verbuche(SITZUNG, 99_000), n - 9_000, "höchstens bis zum Übergebenen");
  assert.deepEqual(await k.nimmAn(pfand, SITZUNG, 0), { ok: false, fall: "pfand-doppelt" });
  const neu = await kasse({ sp: speicher(sp.pfad) });
  assert.deepEqual(await neu.nimmAn(pfand, "cc".repeat(32), 0), { ok: false, fall: "pfand-doppelt" }, "nach dem Neustart");
  assert.deepEqual(neu.konto(SITZUNG), { uebergeben: n, abgerechnet: n });
  assert.equal(neu.summen().offen, nennwert(token));
  assert.ok(!readFileSync(sp.pfad, "utf8").includes("\"dleq\""), "ohne Beweis gemerkt (V5)");
  // Gesperrt auf einen anderen Schlüssel
  const fremd = await sperre(Buffer.from(getPubKeyFromPrivKey(randomBytes(32))).toString("hex"), 4, jetzt() + 3600);
  assert.deepEqual(await neu.nimmAn(alsPfand(fremd.token), SITZUNG, 0), { ok: false, fall: "pfand-sperre" });
});

test("Einlösen: gesammelt vor der Frist; zu spät nie – das gehört dem Rückweg", { skip: ohneMint }, async () => {
  const frist = jetzt() + 20 * 60;
  let uhr = jetzt();
  const k = await kasse({ uhr: () => uhr });
  const a = await sperre(k.schluessel(), 8, frist);
  const b = await sperre(k.schluessel(), 4, frist);
  assert.equal((await k.nimmAn(alsPfand(a.token), SITZUNG, 0)).ok, true);
  assert.equal((await k.nimmAn(alsPfand(b.token), SITZUNG, 0)).ok, true);
  // Noch 20 Minuten: im Vorlauf (30 Minuten) – beide zusammen, die Gebühr je Token aufgerundet für den Tausch
  const alle = [...a.token, ...b.token];
  const [r, zweiter] = await Promise.all([k.loeseFaelligeEin(), k.loeseFaelligeEin()]);
  assert.deepEqual(zweiter, [], "eine Einlösung zur Zeit");
  assert.equal(r.length, 1);
  assert.equal(r[0]!.fehler, undefined);
  assert.equal(r[0]!.betrag, nennwert(alle) - Math.ceil((alle.length * gebuehr) / 1000));
  assert.deepEqual(k.summen(), { offen: 0, erloes: r[0]!.betrag });
  const staende = await a.w.checkProofsStates(a.token);
  assert.ok(staende.every((s) => s.state === "SPENT"));
  // Zu spät: noch fünf Minuten bis zur Frist
  const c = await sperre(k.schluessel(), 4, frist);
  assert.equal((await k.nimmAn(alsPfand(c.token), SITZUNG, 0)).ok, true);
  uhr = frist - 300;
  const spaet = await k.loeseFaelligeEin();
  assert.deepEqual(spaet, [{ mint: MINT, betrag: nennwert(c.token), fehler: "abgelaufen" }]);
  assert.equal(k.summen().offen, 0);
  assert.ok((await c.w.checkProofsStates(c.token)).every((s) => s.state === "UNSPENT"), "nicht eingelöst");
});

test("Abbruch nach der Antwort der Mint: der nächste Lauf holt genau diesen Tausch zurück", { skip: ohneMint }, async () => {
  const sp = speicher();
  const k = await kasse({ sp });
  const { token } = await sperre(k.schluessel(), 16, jetzt() + 20 * 60);
  assert.equal((await k.nimmAn(alsPfand(token), SITZUNG, 0)).ok, true);
  // Das Schreiben nach dem Tausch scheitert – wie ein Absturz
  sp.bricht = (s) => s.laufend === undefined && Object.keys(s.erloes).length > 0;
  const r = await k.loeseFaelligeEin();
  assert.ok(r[0]!.fehler, "gescheitert");
  sp.bricht = undefined;
  const neu = await kasse({ sp: speicher(sp.pfad) });
  assert.deepEqual(neu.summen(), { offen: 0, erloes: 0 }, "laufend gemerkt");
  assert.deepEqual(await neu.loeseFaelligeEin(), []);
  const zurueck = nennwert(token) - Math.ceil((token.length * gebuehr) / 1000);
  assert.deepEqual(neu.summen(), { offen: 0, erloes: zurueck });
  assert.ok((await new Wallet(MINT!, { unit: "sat" }).checkProofsStates(token)).every((s) => s.state === "SPENT"));
  assert.deepEqual(await neu.loeseFaelligeEin(), []);
  assert.deepEqual(neu.summen(), { offen: 0, erloes: zurueck }, "nichts doppelt");
});

test("Die Mint hält die Frist ein (V3): vorher löst nur der Knoten ein, danach der Rückweg", { skip: ohneMint }, async () => {
  const k = await kasse();
  const rueckSk = randomBytes(32).toString("hex");
  const rueck = Buffer.from(getPubKeyFromPrivKey(Buffer.from(rueckSk, "hex"))).toString("hex");
  const frist = jetzt() + 4;
  const { w, token } = await sperre(k.schluessel(), 4, frist, rueck);
  await assert.rejects(w.ops.receive(token).privkey(rueckSk).run(), "vor der Frist nicht über den Rückweg");
  await new Promise((r) => setTimeout(r, (frist - jetzt() + 2) * 1000));
  const zurueck = await w.ops.receive(token).privkey(rueckSk).run();
  assert.ok(zurueck.length > 0, "nach der Frist über den Rückweg");
});
