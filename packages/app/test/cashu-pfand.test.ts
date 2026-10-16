/**
 * RM2c1: Pfand-Fenster im Cashu-Topf. Ohne Mint: die Stückelung. Mit einer Mint auf diesem Rechner
 * (`CASHU_TEST_MINT`, `scripts/cashu-testmint.sh`; ohne sie überspringen sich diese Tests): ein Fenster
 * sperren und übergeben – der Provider nimmt die Token mit `pruefePfand()` an, wie der Knoten –, die
 * Deckung je Provider und Sitzungsschlüssel netto wie die `PfandKasse`, nach der Frist zurückholen,
 * was der Provider nicht eingelöst hat, und ein Tausch ohne Antwort der Mint bleibt gemerkt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Wallet, getPubKeyFromPrivKey } from "@cashu/cashu-ts";
import { pruefePfand, type Pfand } from "@freedomstack/protocol";
import { CashuFehler, CashuTopf, LS_CASHU, PFAND_FENSTER_SAT, stueckelung, type CashuSpeicher } from "../src/cashu-topf.js";

const MINT = process.env["CASHU_TEST_MINT"];
const ohneMint = !MINT && "CASHU_TEST_MINT fehlt (scripts/cashu-testmint.sh)";
const fall = (f: string) => (e: unknown) => e instanceof CashuFehler && e.fall === f;

function speicher(): CashuSpeicher & { m: Map<string, string> } {
  const m = new Map<string, string>();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: async (k, v) => void m.set(k, v) };
}

/** Topf mit eigener Uhr (ms) – die Mint rechnet mit der echten. */
async function geladen(betrag: number, uhr: { ms: number } = { ms: Date.now() }, sp = speicher()) {
  const t = new CashuTopf(sp, { tresorOffen: () => true, lokal: true, jetzt: () => uhr.ms });
  await t.waehleMint(MINT!);
  const { quote } = await t.ladeAnfrage(betrag);
  await t.abholen(quote);
  return { t, sp, uhr };
}

/** Pfand-Schlüssel eines Providers. */
function provider() {
  const sk = randomBytes(32);
  return { sk: sk.toString("hex"), an: Buffer.from(getPubKeyFromPrivKey(sk)).toString("hex") };
}

/** So prüft der Knoten (`PfandKasse.nimmAn()`): `pruefePfand()` gegen die Schlüssel der Mint, netto je Token. */
async function wieDerKnoten(p: Pfand, an: string): Promise<{ ok: boolean; nettoMsat: number; fall?: string }> {
  const w = new Wallet(MINT!, { unit: "sat" });
  await w.loadMint();
  const ks = w.keyChain.cache.keysets;
  const r = pruefePfand(p, {
    schluessel: an, mints: [MINT!], jetzt: Math.floor(Date.now() / 1000), gesehen: () => false,
    mintSchluessel: (_m, id, b) => ks.find((k) => k.id === id && k.unit === "sat")?.keys?.[String(b)],
  });
  const netto = p.token.reduce((n, x) => n + x.amount * 1000 - (ks.find((k) => k.id === x.id)?.input_fee_ppk ?? 0), 0);
  return r.ok ? { ok: true, nettoMsat: netto } : { ok: false, nettoMsat: 0, fall: r.fall };
}

test("Stückelung: klein genug zum Übergeben, Summe stimmt, Zweierpotenzen", () => {
  assert.deepEqual(stueckelung(20), [1, 1, 2, 4, 4, 8]);
  assert.deepEqual(stueckelung(1), [1]);
  for (let b = 1; b <= 300; b++) {
    const s = stueckelung(b);
    assert.equal(s.reduce((n, x) => n + x, 0), b);
    assert.ok(s.every((x) => (x & (x - 1)) === 0), `Zweierpotenzen ${b}`);
    assert.ok(s.length <= 2 * Math.ceil(Math.log2(b + 1)), `${b}: ${s.length} Teile`);
  }
});

test("Pfand: ein Fenster gesperrt, der Provider nimmt es an; Deckung je Provider und Sitzung, netto, ohne neue Token leer", { skip: ohneMint }, async () => {
  const { t, sp } = await geladen(100);
  const p = provider();
  await assert.rejects(t.pfandFuer({ provider: "p1", sitzung: "s1", an: "kaputt", bedarfMsat: 1000 }), fall("pfand-schluessel"));
  await assert.rejects(t.pfandFuer({ provider: "p1", sitzung: "s1", an: p.an, bedarfMsat: -1 }), fall("betrag"));
  const a = await t.pfandFuer({ provider: "p1", sitzung: "s1", an: p.an, bedarfMsat: 3000 });
  assert.equal(t.imPfand(), PFAND_FENSTER_SAT, "ein Fenster, noch nichts übergeben");
  assert.ok(t.guthaben() <= 100 - PFAND_FENSTER_SAT && t.guthaben() >= 100 - PFAND_FENSTER_SAT - 2, `Guthaben ${t.guthaben()}`);
  const k1 = await wieDerKnoten(a.pfand, p.an);
  assert.ok(k1.ok, `Knoten nimmt an: ${k1.fall}`);
  assert.ok(k1.nettoMsat >= 3000 && k1.nettoMsat < 3000 + 4000, `netto ${k1.nettoMsat} deckt 3000 msat, kaum mehr`);
  assert.equal(a.pfand.mint, MINT);
  assert.equal((await wieDerKnoten(a.pfand, provider().an)).fall, "pfand-sperre", "nur sein Schlüssel");
  await a.merke();
  await a.merke();
  const uebergeben = a.pfand.token.reduce((n, x) => n + x.amount, 0);
  assert.equal(t.imPfand(), PFAND_FENSTER_SAT - uebergeben, "zweimal merken zählt einmal");
  // Gedeckt: leere Liste – gegen das schon Übergebene
  const b = await t.pfandFuer({ provider: "p1", sitzung: "s1", an: p.an, bedarfMsat: 2000 });
  assert.deepEqual(b.pfand.token, []);
  // Abgerechnet höchstens bis zum Übergebenen; danach fehlt wieder etwas – aus demselben Fenster
  assert.equal(await t.pfandVerbucht("p1", "s1", 2500), 2500);
  assert.equal(await t.pfandVerbucht("p2", "s1", 2500), 0, "kein Konto bei einem anderen Provider");
  const vorher = t.guthaben();
  const c = await t.pfandFuer({ provider: "p1", sitzung: "s1", an: p.an, bedarfMsat: 3000 });
  assert.ok(c.pfand.token.length > 0);
  assert.equal(t.guthaben(), vorher, "kein neues Fenster");
  assert.ok((await wieDerKnoten(c.pfand, p.an)).nettoMsat >= 3000 - (k1.nettoMsat - 2500));
  await c.merke();
  // Mehr als das Fenster: ein neues, groß genug
  const d = await t.pfandFuer({ provider: "p1", sitzung: "s1", an: p.an, bedarfMsat: 30_000 });
  assert.ok(t.guthaben() < vorher - 20, "neues Fenster gesperrt");
  assert.ok((await wieDerKnoten(d.pfand, p.an)).ok);
  // Eine andere Sitzung (neue Unterhaltung) bekommt ein eigenes Fenster, nichts aus dem fremden
  const sitz2 = await t.pfandFuer({ provider: "p1", sitzung: "s2", an: p.an, bedarfMsat: 1000 });
  const fremd = new Set(d.pfand.token.map((x) => x.secret));
  assert.ok(sitz2.pfand.token.every((x) => !fremd.has(x.secret)));
  // Alles nur im Tresor-Stand, die Rückweg-Schlüssel eingeschlossen
  const stand = JSON.parse(sp.m.get(LS_CASHU)!) as { pfand: { rueck: string; an: string }[] };
  assert.ok(stand.pfand.length >= 3 && stand.pfand.every((f) => /^[0-9a-f]{64}$/.test(f.rueck) && f.an === p.an));
  assert.equal(new Set(stand.pfand.map((f) => f.rueck)).size, stand.pfand.length, "je Fenster ein frischer Rückweg");
});

test("Pfand: zu wenig im Topf – kein Fenster, nichts verloren", { skip: ohneMint }, async () => {
  const { t } = await geladen(10);
  await assert.rejects(t.pfandFuer({ provider: "p1", sitzung: "s1", an: provider().an, bedarfMsat: 3000 }), fall("zu-wenig"));
  assert.equal(t.guthaben(), 10);
  assert.equal(t.imPfand(), 0);
});

test("Pfand nach der Frist: zurück, was der Provider nicht eingelöst hat – übergeben oder nicht; vorher nichts", { skip: ohneMint }, async () => {
  // Fristen einmal aus der Uhr: das Fenster gilt in der Uhr des Topfs eine Stunde, für die Mint 3 s
  const echt = Date.now();
  const uhr = { ms: echt };
  const { t } = await geladen(64, uhr);
  const p = provider();
  uhr.ms = echt - 3600_000 + 3_000;
  const a = await t.pfandFuer({ provider: "p1", sitzung: "s1", an: p.an, bedarfMsat: 2500 });
  await a.merke();
  assert.equal(await t.holePfandZurueck(), 0, "vor der Frist nichts");
  // Der Provider löst ein Token ein, bevor die Frist kommt
  const [eins] = a.pfand.token;
  const w = new Wallet(MINT!, { unit: "sat" });
  await w.loadMint();
  await w.ops.receive([{ id: eins!.id, amount: eins!.amount, secret: eins!.secret, C: eins!.C }]).privkey(p.sk).run();
  await new Promise((r) => setTimeout(r, Math.max(0, echt + 4_000 - Date.now())));
  uhr.ms = Date.now();
  const vorher = t.guthaben();
  const zurueck = await t.holePfandZurueck();
  const erwartet = PFAND_FENSTER_SAT - eins!.amount;
  assert.ok(zurueck <= erwartet && zurueck >= erwartet - 2, `zurück ${zurueck}, erwartet bis ${erwartet}`);
  assert.equal(t.guthaben(), vorher + zurueck);
  assert.equal(t.imPfand(), 0);
  assert.equal(await t.holePfandZurueck(), 0, "nichts mehr offen");
});

test("Tausch ohne Antwort der Mint: laufend bleibt gemerkt, nachholen() klärt – auch beim Rückweg eines Fensters", { skip: ohneMint }, async () => {
  const echt = globalThis.fetch;
  const ohneAntwort = (weg: "nach" | "vor") => {
    globalThis.fetch = (async (i: RequestInfo | URL, o?: RequestInit) => {
      if (!String(i).endsWith("/v1/swap")) return echt(i, o);
      if (weg === "nach") await echt(i, o);
      throw new TypeError("fetch failed");
    }) as typeof fetch;
  };
  try {
    // Die Mint tauscht, die Antwort geht verloren: die neuen Token kommen über den Zählerbereich zurück
    const { t } = await geladen(64);
    ohneAntwort("nach");
    await assert.rejects(t.sende(10), fall("mint-netz"));
    globalThis.fetch = echt;
    assert.equal(t.guthaben(), 0, "eingesetzt, laufend gemerkt");
    await assert.rejects(t.sende(5), fall("laufend"));
    const zurueck = await t.nachholen();
    assert.ok(zurueck <= 64 && zurueck >= 62, `zurück ${zurueck}`);
    // Rückweg eines Fensters, die Anfrage erreicht die Mint nie: die Token bleiben im Fenster
    const echtMs = Date.now();
    const uhr = { ms: echtMs - 3600_000 + 3_000 };
    const { t: u } = await geladen(64, uhr);
    await u.pfandFuer({ provider: "p1", sitzung: "s1", an: provider().an, bedarfMsat: 1000 });
    await new Promise((r) => setTimeout(r, Math.max(0, echtMs + 4_000 - Date.now())));
    uhr.ms = Date.now();
    ohneAntwort("vor");
    await assert.rejects(u.holePfandZurueck(), fall("mint-netz"));
    globalThis.fetch = echt;
    assert.equal(u.imPfand(), 0, "während des Tauschs nicht im Fenster");
    assert.equal(await u.nachholen(), PFAND_FENSTER_SAT, "nicht getauscht – zurück ins Fenster");
    assert.equal(u.imPfand(), PFAND_FENSTER_SAT);
    const r = await u.holePfandZurueck();
    assert.ok(r >= PFAND_FENSTER_SAT - 2 && r <= PFAND_FENSTER_SAT, `Rückweg ${r}`);
  } finally {
    globalThis.fetch = echt;
  }
});
