/**
 * Schritt 4.6b: LP-Daemon in der Gegenrichtung (Kunde gibt SOL, LP zahlt
 * dessen Rechnung). Der LP zahlt echtes Geld, bevor er die SOL hat – geprueft
 * wird deshalb vor allem, wann er NICHT zahlt, und dass ein Neustart oder ein
 * Verbindungsabbruch ihn nicht um die SOL bringt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OutboxPool, MemoryRelay, generateKeypair, signEvent, buildEvent, getTag,
  LpOffer, MockSolana, generatePreimage, hashlock, toHex, rueckSwapId,
} from "@freedomstack/protocol";
import { LpDaemon, FixedRate, KIND_SWAP_REQUEST, KIND_SWAP_RESPONSE, RueckSitzung, rueckSpeicher } from "../src/lp-daemon.js";
import { knotenSchluessel, rechnung } from "../../protocol/test/bolt11-hilfe.js";

const JETZT = 1_790_000_000;
const LP = generateKeypair();
const KUNDE = generateKeypair();
const LP_SOL = "LpSoL11111111111111111111111111111111111111";
const KUNDE_SOL = "Kunde1111111111111111111111111111111111111";
const KNOTEN = knotenSchluessel(); // Lightning-Knoten des Kunden

const angebot: Omit<LpOffer, "expiry"> = {
  offerId: "rueck-1", pair: "LN-BTC/SOL", direction: "buy-sol",
  minSats: 1000, maxSats: 100_000, feePpm: 10_000, tSolSecs: 3600, lnCltvDeltaBlocks: 30,
};
// 10.000 sats · 100 Lamports · (1 + 1 %) = 1.010.000 Lamports
const PREIS = 1_010_000;

/** Lightning des LP: zahlt Rechnungen, deren Preimage der Test kennt. */
function lightning(opts: { scheitert?: string; haengt?: boolean; stand?: () => Promise<{ status: "erfolgreich" | "gescheitert" | "laeuft" | "unbekannt"; preimage?: Uint8Array }>; vorher?: () => void } = {}) {
  const preimages = new Map<string, Uint8Array>();
  const zahlungen: { bolt11: string; cltv: number }[] = [];
  let staende = 0;
  let loesen: (() => void) | undefined;
  const ln = {
    async createHoldInvoice() { throw new Error("nicht im Test"); },
    async payHoldInvoice() { /* nicht im Test */ },
    async getInvoiceState() { return "OPEN" as const; },
    async settleHoldInvoice() { /* nicht im Test */ },
    async cancelHoldInvoice() { /* nicht im Test */ },
    async payInvoice(bolt11: string, cltv: number) {
      zahlungen.push({ bolt11, cltv });
      if (opts.haengt) await new Promise<void>((r) => { loesen = r; });
      opts.vorher?.();
      if (opts.scheitert) throw new Error(opts.scheitert);
      const h = [...preimages.keys()].find((k) => bolt11.includes(k));
      return { preimage: preimages.get(h!)! };
    },
    ...(opts.stand ? { zahlungsstand: async () => { staende++; return opts.stand!(); } } : {}),
  };
  return { ln, preimages, zahlungen, staende: () => staende, loese: () => loesen?.() };
}

function speicher() {
  let daten: RueckSitzung[] = [];
  return { lade: () => structuredClone(daten), speichere: (s: RueckSitzung[]) => { daten = structuredClone(s); }, daten: () => daten };
}

function aufbau(l = lightning(), over: { solAdresse?: string | null; maxOffeneZahlungen?: number; sp?: ReturnType<typeof speicher>; sol?: MockSolana; uhr?: { t: number } } = {}) {
  const uhr = over.uhr ?? { t: JETZT };
  const pool = new OutboxPool([new MemoryRelay("mem://lp")], { minAcks: 1 });
  const sol = over.sol ?? new MockSolana(50_000_000, () => uhr.t); // Initiator = Kunde
  const sp = over.sp ?? speicher();
  const lp = new LpDaemon(
    {
      keypair: LP, offer: angebot, offerTtlSecs: 3600, maxLamportsPerSwap: 1_000_000_000,
      solAdresse: over.solAdresse === null ? undefined : (over.solAdresse ?? LP_SOL),
      maxOffeneZahlungen: over.maxOffeneZahlungen, speicher: sp,
    },
    pool, l.ln as never, sol, new FixedRate(100), () => uhr.t,
  );
  return { pool, sol, lp, l, sp, uhr };
}

/** Kunde: Rechnung seiner Wallet, Sperre auf der Kette, Anfrage an den LP. */
async function kunde(a: ReturnType<typeof aufbau>, o: { prefix?: string; lamports?: number; frist?: number; empfaenger?: string; hashDaneben?: boolean; sperren?: boolean; offer?: string; zeit?: number } = {}) {
  const pre = generatePreimage();
  const bolt11 = rechnung(KNOTEN, o.prefix ?? "lnbc100u", pre);
  a.l.preimages.set(bolt11, pre);
  if (o.sperren !== false) {
    await a.sol.lock({
      swapId: rueckSwapId(bolt11), hashlock: o.hashDaneben ? hashlock(generatePreimage()) : hashlock(pre),
      amountLamports: o.lamports ?? PREIS, timelockUnix: JETZT + (o.frist ?? 12 * 3600),
      recipient: o.empfaenger ?? LP_SOL, initiator: KUNDE_SOL,
    });
  }
  await a.pool.publish(signEvent(buildEvent(KUNDE.pk, KIND_SWAP_REQUEST, [
    ["p", LP.pk], ["offer", o.offer ?? "rueck-1"], ["bolt11", bolt11],
  ], "", o.zeit), KUNDE.sk));
  return { pre, bolt11 };
}

async function antworten(a: ReturnType<typeof aufbau>, mitText = false) {
  return (await a.pool.query({ kinds: [KIND_SWAP_RESPONSE], authors: [LP.pk] })).map((e) => (mitText ? `${getTag(e, "status")}: ${e.content}` : getTag(e, "status")));
}

test("Gegenrichtung: gueltige Sperre – LP zahlt mit cltv_limit und loest die SOL ein", async () => {
  const sp = speicher();
  let beimZahlen: string | undefined;
  const a = aufbau(lightning({ vorher: () => { beimZahlen = sp.daten()[0]?.phase; } }), { sp });
  const { bolt11 } = await kunde(a);
  const [s] = await a.lp.pollOnce(JETZT) as RueckSitzung[];
  await a.lp.warteAufZahlungen();
  assert.equal(beimZahlen, "ZAHLT", "gespeichert, BEVOR gezahlt wird");
  assert.equal(s.phase, "EINGELOEST", s.grund ?? "");
  assert.deepEqual(a.l.zahlungen, [{ bolt11, cltv: 30 }], "genau eine Zahlung, cltv_limit aus dem Angebot");
  assert.equal(s.amountSats, 10_000);
  assert.equal(s.amountLamports, PREIS);
  assert.equal(s.kundeSol, KUNDE_SOL, "Konto des Kunden = Initiator der Sperre");
  assert.equal(a.sol.userLamports, PREIS, "LP (Empfaenger) hat die SOL");
  assert.equal(a.sp.daten()[0].phase, "EINGELOEST");
  assert.match(a.sp.daten()[0].preimageHex!, /^[0-9a-f]{64}$/);
  assert.deepEqual(await antworten(a), ["EINGELOEST"]);
});

test("cltv_limit richtet sich nach der Frist der Sperre, nie laenger als erlaubt", async () => {
  // 6 h Frist: (6 h − 1 h) / 20 min = 15 Bloecke – kleiner als die 30 des Angebots
  const a = aufbau();
  await kunde(a, { frist: 6 * 3600 });
  await a.lp.pollOnce(JETZT);
  await a.lp.warteAufZahlungen();
  assert.equal(a.l.zahlungen[0].cltv, 15);
});

test("Vor dem Zahlen geprueft: in keinem dieser Faelle zahlt der LP", async () => {
  const faelle: Array<[RegExp | null, Parameters<typeof kunde>[1], Parameters<typeof aufbau>[1]?]> = [
    [null, { offer: "anderes" }], // anderes Angebot: still uebergangen
    [/anderen Empfänger/, { empfaenger: KUNDE_SOL }],
    [/nur 1000000 statt 1010000/, { lamports: 1_000_000 }],
    [/Hashlock passt nicht/, { hashDaneben: true }],
    [/Frist der Sperre zu kurz/, { frist: 3600 }],
    [/ausserhalb Angebot: 1000000/, { prefix: "lnbc10m" }],
    [/ausserhalb Angebot: 100$/, { prefix: "lnbc1u" }],
    [/ohne ganzen sats-Betrag/, { prefix: "lnbc" }],
    [/ohne SOL-Adresse/, {}, { solAdresse: null }],
  ];
  const orig = console.error;
  try {
    for (const [grund, k, over] of faelle) {
      const fehler: string[] = [];
      console.error = (...x: unknown[]) => { fehler.push(x.map((y) => (y instanceof Error ? y.message : String(y))).join(" ")); };
      const a = aufbau(lightning(), over);
      await kunde(a, k);
      assert.equal((await a.lp.pollOnce(JETZT)).length, 0, String(grund));
      await a.lp.warteAufZahlungen();
      assert.equal(a.l.zahlungen.length, 0, `${grund}: nichts gezahlt`);
      if (grund) {
        assert.match(fehler.join("\n"), grund);
        const antwort = (await antworten(a, true))[0] ?? "";
        assert.match(antwort, /^ABGELEHNT: /, "der Kunde erfaehrt, dass er nach Ablauf zurueckholen muss");
        assert.match(antwort, grund);
      } else {
        assert.deepEqual(fehler, [], "kein Fehler fuer ein fremdes Angebot");
        assert.deepEqual(await antworten(a), []);
      }
    }
  } finally {
    console.error = orig;
  }
});

test("Anfrage vor der bestaetigten Sperre: wird eine Weile erneut geprueft, dann abgelehnt", async () => {
  const a = aufbau();
  await kunde(a, { sperren: false, zeit: JETZT });
  assert.equal((await a.lp.pollOnce(JETZT)).length, 0);
  assert.deepEqual(await antworten(a), [], "noch keine Ablehnung");
  // Die Sperre ist inzwischen bestaetigt – dieselbe Anfrage geht beim naechsten Durchlauf durch.
  const [p] = [...a.l.preimages.values()];
  const [bolt11] = [...a.l.preimages.keys()];
  await a.sol.lock({ swapId: rueckSwapId(bolt11), hashlock: hashlock(p), amountLamports: PREIS, timelockUnix: JETZT + 12 * 3600, recipient: LP_SOL, initiator: KUNDE_SOL });
  const [s] = await a.lp.pollOnce(JETZT + 60) as RueckSitzung[];
  await a.lp.warteAufZahlungen();
  assert.equal(s?.phase, "EINGELOEST");

  // Ohne Sperre nach Ablauf der Wartezeit: einmal ABGELEHNT, danach Ruhe.
  const b = aufbau();
  await kunde(b, { sperren: false, zeit: JETZT });
  await b.lp.pollOnce(JETZT + 599);
  assert.deepEqual(await antworten(b), []);
  const orig = console.error;
  console.error = () => {};
  try {
    await b.lp.pollOnce(JETZT + 600);
    await b.lp.pollOnce(JETZT + 900);
  } finally {
    console.error = orig;
  }
  assert.deepEqual(await antworten(b, true), ["ABGELEHNT: keine Sperre auf der Kette"]);
  assert.equal(b.l.zahlungen.length, 0);
});

test("Kaputte oder gefaelschte Rechnung wird nicht bezahlt", async () => {
  const a = aufbau();
  const { bolt11 } = await kunde(a);
  const gefaelscht = bolt11.slice(0, -8) + (bolt11.slice(-8, -7) === "q" ? "p" : "q") + bolt11.slice(-7);
  for (const b of ["lnbc1xyz", gefaelscht, "x".repeat(2100)]) {
    await a.pool.publish(signEvent(buildEvent(KUNDE.pk, KIND_SWAP_REQUEST, [["p", LP.pk], ["offer", "rueck-1"], ["bolt11", b]], ""), KUNDE.sk));
  }
  const orig = console.error;
  const log: string[] = [];
  console.error = (...x: unknown[]) => { log.push(x.map(String).join(" ")); };
  const r = await a.lp.pollOnce(JETZT).finally(() => { console.error = orig; });
  await a.lp.warteAufZahlungen();
  assert.equal(r.length, 1, "nur die echte Anfrage");
  assert.equal(log.length, 3);
  assert.ok(!log.some((z) => z.includes(gefaelscht.slice(10, 40))), "fremde Rechnung nicht im Log");
  assert.equal(a.l.zahlungen.length, 1);
  assert.equal(a.l.zahlungen[0].bolt11, bolt11);
});

test("Vorwegnahme: fremde Rechnung mit demselben Hash wird nicht bezahlt", async () => {
  // Wer die Sperre auf der Kette sieht, kennt H und koennte eine eigene
  // Rechnung mit H an seinen Knoten schicken: Der LP zahlte, die Zahlung hinge
  // bis zum cltv_limit, und der echte Kunde bekaeme „schon bearbeitet“. Die
  // Swap-ID ist der Hash der Rechnung – fuer die fremde gibt es keine Sperre.
  const a = aufbau();
  const pre = generatePreimage();
  const echt = rechnung(KNOTEN, "lnbc100u", pre);
  const fremd = rechnung(knotenSchluessel(), "lnbc100u", pre);
  a.l.preimages.set(echt, pre);
  await a.sol.lock({ swapId: rueckSwapId(echt), hashlock: hashlock(pre), amountLamports: PREIS, timelockUnix: JETZT + 12 * 3600, recipient: LP_SOL, initiator: KUNDE_SOL });
  const angreifer = generateKeypair();
  await a.pool.publish(signEvent(buildEvent(angreifer.pk, KIND_SWAP_REQUEST, [["p", LP.pk], ["offer", "rueck-1"], ["bolt11", fremd]], ""), angreifer.sk));
  assert.equal((await a.lp.pollOnce(JETZT)).length, 0);
  assert.equal(a.l.zahlungen.length, 0, "fremde Rechnung nicht bezahlt");
  await a.pool.publish(signEvent(buildEvent(KUNDE.pk, KIND_SWAP_REQUEST, [["p", LP.pk], ["offer", "rueck-1"], ["bolt11", echt]], ""), KUNDE.sk));
  const [s] = await a.lp.pollOnce(JETZT) as RueckSitzung[];
  await a.lp.warteAufZahlungen();
  assert.equal(s.phase, "EINGELOEST", "der echte Kunde wird bedient");
});

test("Dieselbe Rechnung wird nur einmal bezahlt – auch in einer zweiten Anfrage", async () => {
  const a = aufbau();
  const { bolt11 } = await kunde(a);
  await a.pool.publish(signEvent(buildEvent(KUNDE.pk, KIND_SWAP_REQUEST, [["p", LP.pk], ["offer", "rueck-1"], ["bolt11", bolt11.toUpperCase()], ["x", "2"]], ""), KUNDE.sk));
  await a.lp.pollOnce(JETZT);
  await a.lp.pollOnce(JETZT);
  await a.lp.warteAufZahlungen();
  assert.equal(a.l.zahlungen.length, 1);
});

test("Zahlung scheitert: nichts eingeloest, Kunde holt nach T_sol zurueck", async () => {
  const a = aufbau(lightning({ scheitert: "FAILURE_REASON_NO_ROUTE" }));
  await kunde(a);
  const [s] = await a.lp.pollOnce(JETZT) as RueckSitzung[];
  await a.lp.warteAufZahlungen();
  assert.equal(s.phase, "GESCHEITERT");
  assert.match(s.grund!, /NO_ROUTE/);
  assert.equal(a.sol.userLamports, 0, "LP hat nichts eingeloest");
  a.uhr.t = JETZT + 12 * 3600 + 1;
  await a.sol.refund(s.swapId);
  assert.equal(a.sol.lpLamports, 50_000_000, "Kunde wieder voll");
  assert.deepEqual(await antworten(a, true), ["GESCHEITERT: Zahlung gescheitert – SOL nach Ablauf der Sperre zurückholen"], "keine Meldung von LND nach aussen");
  assert.match(a.sp.daten()[0].grund!, /NO_ROUTE/, "der Grund bleibt beim LP");
});

test("Zu spaet bezahlt: LP loest nicht mehr ein, wenn T_sol minus 10 Minuten erreicht ist", async () => {
  const uhr = { t: JETZT };
  const a = aufbau(lightning({ vorher: () => { uhr.t = JETZT + 12 * 3600 - 600; } }), { uhr });
  await kunde(a);
  const [s] = await a.lp.pollOnce(JETZT) as RueckSitzung[];
  await a.lp.warteAufZahlungen();
  assert.equal(s.phase, "ZU_SPAET");
  assert.equal(a.sol.userLamports, 0, "kein Einloese-Versuch so knapp vor der Frist");
});

test("Verbindungsabbruch ist kein Scheitern: LND kennt das Ergebnis, LP loest ein", async () => {
  let pre: Uint8Array | undefined;
  const a = aufbau(lightning({ scheitert: "fetch failed", stand: async () => ({ status: "erfolgreich", preimage: pre }) }));
  ({ pre } = await kunde(a));
  const [s] = await a.lp.pollOnce(JETZT) as RueckSitzung[];
  await a.lp.warteAufZahlungen();
  assert.equal(s.phase, "EINGELOEST");
  assert.equal(a.sol.userLamports, PREIS);
});

test("Falsches Preimage von LND wird nicht uebernommen", async () => {
  const a = aufbau(lightning({ scheitert: "fetch failed", stand: async () => ({ status: "erfolgreich", preimage: generatePreimage() }) }));
  await kunde(a);
  const [s] = await a.lp.pollOnce(JETZT) as RueckSitzung[];
  await a.lp.warteAufZahlungen();
  assert.equal(s.phase, "ZAHLT", "bleibt offen");
  assert.equal(s.preimageHex, undefined);
});

test("Neustart waehrend der Zahlung: Preimage bei LND nachgeholt, SOL trotzdem eingeloest", async () => {
  const sp = speicher();
  const uhr = { t: JETZT };
  const sol = new MockSolana(50_000_000, () => uhr.t);
  const l1 = lightning({ haengt: true, stand: async () => ({ status: "laeuft" }) });
  const a = aufbau(l1, { sp, sol, uhr });
  const { pre } = await kunde(a);
  await a.lp.pollOnce(JETZT);
  await a.lp.nachholen();
  assert.equal(l1.staende(), 0, "eine hier laufende Zahlung wird nicht nachgeschlagen");
  assert.equal(sp.daten()[0].phase, "ZAHLT");

  // Prozess stirbt; der neue kennt die Sitzung nur aus dem Speicher.
  let stand: "laeuft" | "erfolgreich" = "laeuft";
  const l2 = lightning({ stand: async () => ({ status: stand, preimage: stand === "erfolgreich" ? pre : undefined }) });
  const b = aufbau(l2, { sp, sol, uhr });
  assert.deepEqual(await b.lp.nachholen(), [], "laeuft noch – nichts zu tun");
  stand = "erfolgreich";
  const [s] = await b.lp.nachholen();
  assert.equal(s.phase, "EINGELOEST");
  assert.equal(sol.userLamports, PREIS);
  assert.equal(l2.zahlungen.length, 0, "nicht ein zweites Mal gezahlt");
  // Dieselbe Anfrage kommt nach dem Neustart nicht noch einmal durch
  assert.equal((await b.lp.pollOnce(JETZT)).length, 0);
  l1.loese();
});

test("Nach dem Neustart gescheitert oder nie angekommen: Sitzung wird abgeschlossen", async () => {
  const sp = speicher();
  const uhr = { t: JETZT };
  const sol = new MockSolana(50_000_000, () => uhr.t);
  const a = aufbau(lightning({ haengt: true }), { sp, sol, uhr });
  await kunde(a);
  await kunde(a);
  await a.lp.pollOnce(JETZT);
  const [x, y] = sp.daten();
  const b = aufbau(lightning({ stand: async () => ({ status: "unbekannt" }) }), { sp, sol, uhr });
  assert.deepEqual(await b.lp.nachholen(), [], "unbekannt, aber Frist offen: abwarten");
  uhr.t = x.timelockUnix - 600;
  const fertig = await b.lp.nachholen();
  assert.deepEqual(fertig.map((s) => s.phase), ["GESCHEITERT", "GESCHEITERT"]);
  assert.deepEqual(sp.daten().map((s) => s.requestId).sort(), [x.requestId, y.requestId].sort());
  assert.equal(sol.userLamports, 0);
});

test("Blockadeschutz: hoechstens maxOffeneZahlungen Zahlungen gleichzeitig in der Schwebe", async () => {
  const l = lightning({ haengt: true });
  const a = aufbau(l, { maxOffeneZahlungen: 1 });
  await kunde(a);
  await a.lp.pollOnce(JETZT);
  await kunde(a);
  assert.equal((await a.lp.pollOnce(JETZT)).length, 0, "zweite Zahlung abgelehnt, solange die erste haengt");
  assert.equal(l.zahlungen.length, 1);
  l.loese();
  await a.lp.warteAufZahlungen();
});

test("Dateispeicher: nur fuer den Nutzer lesbar, ueberdauert den Neustart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "freedom-lp-"));
  try {
    const pfad = join(dir, "sub", "lp-rueck.json");
    const sp = rueckSpeicher(pfad);
    assert.deepEqual(sp.lade(), [], "noch keine Datei");
    const s = { requestId: "r1", phase: "BEZAHLT", preimageHex: "ab".repeat(32) } as RueckSitzung;
    sp.speichere([s]);
    sp.speichere([{ ...s, phase: "EINGELOEST" }]);
    assert.equal((await stat(pfad)).mode & 0o777, 0o600);
    assert.deepEqual(rueckSpeicher(pfad).lade(), [{ ...s, phase: "EINGELOEST" }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Swap-ID der Gegenrichtung: Hash der Rechnung, unabhaengig von Gross-/Kleinschreibung", () => {
  const b = rechnung(KNOTEN, "lnbc100u", generatePreimage());
  assert.match(rueckSwapId(b), /^[0-9a-f]{64}$/);
  assert.equal(rueckSwapId(b.toUpperCase()), rueckSwapId(b));
  assert.notEqual(rueckSwapId(rechnung(KNOTEN, "lnbc100u", generatePreimage())), rueckSwapId(b));
  assert.equal(toHex(hashlock(new Uint8Array(0))).length, 64);
});

test("Verdrahtung (4.6b): main.ts startet die Gegenrichtung mit Speicher, SOL-Konto und Nachholen", async () => {
  const { readFileSync } = await import("node:fs");
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /process\.env\.LP_DIRECTION \?\? "sell-sol"/);
  assert.match(main, /solAdresse: lpSolAdresse,/);
  assert.match(main, /lpSolAdresse = solKp\.publicKey\.toBase58\(\)/, "Empfaenger der Sperre = Konto, mit dem eingeloest wird");
  assert.match(main, /rueckSpeicher\(join\(process\.env\.HOME \?\? "\.", "\.freedom", "lp-rueck\.json"\)\)/);
  assert.match(main, /for \(const s of await lp\.nachholen\(\)\)/);
});
