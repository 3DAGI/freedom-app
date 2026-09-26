/**
 * Schritt 8.3b: Der Abnahme-Lauf des LP mit Mocks – beide Richtungen, je mit
 * Erfolg und mit Ablauf. Dieselben Faelle laufen gegen Devnet und
 * Lightning-Testnet (`lp-abnahme-lauf.ts`); hier wird die Pruefung selbst
 * geprueft, auch dass sie Fehler meldet.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MockSolana, generatePreimage, hashlock, leseBolt11, toHex, type HoldInvoiceState, type LightningAdapter } from "@freedomstack/protocol";
import { knotenSchluessel, rechnung } from "../../protocol/test/bolt11-hilfe.js";
import { abnahmeBericht, lpAbnahme, type Abnahme } from "../src/lp-abnahme.js";

/** Ein Lightning-Netz fuer beide Seiten: Hold-Invoices des LP, echte signierte Rechnungen des Kunden. */
function lnNetz() {
  const knoten = knotenSchluessel();
  const hold = new Map<string, { sats: number; stand: HoldInvoiceState }>();
  const rechnungen = new Map<string, { preimage: Uint8Array; abgebrochen: boolean; bezahlt: boolean }>();
  const ln: LightningAdapter = {
    async createHoldInvoice(h, sats) { hold.set(toHex(h), { sats, stand: "OPEN" }); return { paymentHash: h, bolt11: `lnhold:${toHex(h)}`, amountSats: sats, cltvDeltaBlocks: 40 }; },
    async payHoldInvoice(bolt11) { const r = hold.get(bolt11.replace("lnhold:", "")); if (!r || r.stand !== "OPEN") throw new Error("nicht zahlbar"); r.stand = "ACCEPTED"; },
    async getInvoiceState(h) { return hold.get(toHex(h))?.stand ?? "OPEN"; },
    async settleHoldInvoice(R) { const r = hold.get(toHex(hashlock(R))); if (r?.stand !== "ACCEPTED") throw new Error("nicht ACCEPTED"); r.stand = "SETTLED"; },
    async cancelHoldInvoice(h) {
      const r = hold.get(toHex(h)); if (r) r.stand = "CANCELED";
      const n = rechnungen.get(toHex(h)); if (n) n.abgebrochen = true;
    },
    async createInvoice(sats) {
      const preimage = generatePreimage();
      const bolt11 = rechnung(knoten, `lnbc${sats / 100}u`, preimage);
      rechnungen.set(toHex(hashlock(preimage)), { preimage, abgebrochen: false, bezahlt: false });
      return { bolt11, paymentHash: hashlock(preimage), amountSats: sats };
    },
    async payInvoice(bolt11) {
      const r = rechnungen.get(leseBolt11(bolt11).zahlungsHash);
      if (!r || r.abgebrochen || r.bezahlt) throw new Error("Zahlung gescheitert");
      r.bezahlt = true;
      return { preimage: r.preimage };
    },
  };
  return { ln, hold, rechnungen };
}

function umgebung(o: { lnKaputt?: boolean } = {}): Abnahme & { uhr: () => number } {
  const zeit = { t: 1_790_000_000 };
  const sol = new MockSolana(10_000_000_000, () => zeit.t);
  const { ln } = lnNetz();
  const lpLn = o.lnKaputt ? { ...ln, settleHoldInvoice: async () => { throw new Error("LND weg"); } } : ln;
  return {
    lp: { ln: lpLn, sol, solAdresse: "LpSoL11111111111111111111111111111111111111" },
    kunde: { ln, sol, solAdresse: "Kunde1111111111111111111111111111111111111" },
    uhr: () => zeit.t,
    warte: async (s) => { zeit.t += s; },
    sats: 10_000, lamportsPerSat: 100, feePpm: 10_000,
    hin: { tSolSecs: 600, lnCltvDeltaBlocks: 8 },
    rueck: { sperrSecs: 8 * 3600, lnCltvDeltaBlocks: 40 },
    takt: 5, geduld: 120,
  };
}

test("8.3b: alle vier Faelle bestehen – Hinrichtung, ihr Ablauf, Gegenrichtung, ihr Ablauf", async () => {
  const faelle = await lpAbnahme(umgebung());
  assert.deepEqual(faelle.map((f) => [f.name, f.ok, f.grund]), [
    ["hin", true, undefined], ["hin-ablauf", true, undefined], ["rueck", true, undefined], ["rueck-ablauf", true, undefined],
  ]);
  const ablauf = faelle.find((f) => f.name === "hin-ablauf")!;
  assert.ok(ablauf.sekunden >= 600 + 120, "wartet die Frist plus Puffer ab");
  assert.ok(faelle.find((f) => f.name === "rueck-ablauf")!.sekunden >= 8 * 3600, "Kunde holt erst nach seiner Frist zurueck");
  assert.match(abnahmeBericht(faelle), /^✓ hin {10}/);
});

test("8.3b: die Abnahme meldet Fehler, statt sie zu uebersehen – und ein Fall stoppt nicht die anderen", async () => {
  const faelle = await lpAbnahme(umgebung({ lnKaputt: true }), ["hin", "rueck"]);
  assert.equal(faelle[0]!.ok, false);
  assert.match(faelle[0]!.grund!, /Zeit abgelaufen: Abrechnung des LP|LND weg/);
  assert.equal(faelle[1]!.ok, true, "die Gegenrichtung braucht kein settle");
  assert.match(abnahmeBericht(faelle), /✗ hin/);
});

test("8.3b: unsichere Fristen fallen auf, bevor Geld bewegt wird", async () => {
  const u = umgebung();
  u.hin = { tSolSecs: 600, lnCltvDeltaBlocks: 2 }; // Lightning-Frist kuerzer als Solana-Frist plus Puffer
  const [f] = await lpAbnahme(u, ["hin"]);
  assert.equal(f!.ok, false);
  assert.match(f!.grund!, /nicht gesperrt/);
});

// ------------------------------------------------------------- echter Lauf (Einstellungen)

import { readFileSync } from "node:fs";
import { abnahmeEinstellungen, istTestnetRechnung } from "../src/lp-abnahme-lauf.js";

const ENV = {
  LND_LP_REST: "https://lp:8080", LND_LP_MACAROON: "/lp.macaroon", LND_KUNDE_REST: "https://kunde:8080", LND_KUNDE_MACAROON: "/k.macaroon",
  SOLANA_KEYPAIR_LP: "/lp.json", SOLANA_KEYPAIR_KUNDE: "/k.json",
};

test("8.3b: echter Lauf – nie Mainnet, fehlende Angaben werden genannt", () => {
  const e = abnahmeEinstellungen(ENV);
  assert.equal(e.rpc, "https://api.devnet.solana.com");
  assert.deepEqual(e.faelle, ["hin", "hin-ablauf", "rueck", "rueck-ablauf"]);
  assert.deepEqual([e.sats, e.cltv, e.hinSperrSecs], [10_000, 144, 600]);
  assert.throws(() => abnahmeEinstellungen({ ...ENV, SOLANA_RPC: "https://api.mainnet-beta.solana.com" }), /nie Mainnet/);
  assert.throws(() => abnahmeEinstellungen({ ...ENV, SOLANA_RPC: "https://mein-rpc.example" }), /nie Mainnet/);
  assert.throws(() => abnahmeEinstellungen({ LND_LP_REST: "x" }), /Es fehlt: LND_LP_MACAROON, LND_KUNDE_REST, LND_KUNDE_MACAROON, SOLANA_KEYPAIR_LP, SOLANA_KEYPAIR_KUNDE/);
  assert.throws(() => abnahmeEinstellungen({ ...ENV, ABNAHME_CLTV: "5" }), /ABNAHME_CLTV=5: ganze Zahl ab 18/);
  assert.throws(() => abnahmeEinstellungen(ENV, ["hin", "mainnet"]), /Unbekannte Faelle: mainnet/);
  assert.deepEqual(abnahmeEinstellungen(ENV, ["rueck"]).faelle, ["rueck"]);
});

test("8.3b: Lightning nur Testnet, Signet oder Regtest", () => {
  for (const r of ["lntb100u1p…", "lntbs1p…", "lnbcrt500n1p…", "LNTB1P…"]) assert.equal(istTestnetRechnung(r), true, r);
  for (const r of ["lnbc100u1p…", "lnbc1p…", "", "lnurl1…"]) assert.equal(istTestnetRechnung(r), false, r);
  const lauf = readFileSync(new URL("../src/lp-abnahme-lauf.ts", import.meta.url), "utf8");
  assert.match(lauf, /if \(!istTestnetRechnung\(probe\.bolt11\)\) throw new Error/, "vor jedem Swap gepruefte Probe-Rechnung");
  assert.match(lauf, /const mac = pruefeLpMacaroon\(lpMacaroon\);\s*if \(!mac\.ok\) throw/, "wie im Betrieb nur eingeschraenkte Macaroon");
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts["lp-abnahme"], "node --import tsx src/lp-abnahme-lauf.ts");
});
