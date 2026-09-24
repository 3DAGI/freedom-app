/**
 * Tests fuer das dauerhafte Referral-System.
 *
 * Zwei Fragen stehen im Mittelpunkt, und beide sind wichtiger als die Hoehe
 * der Verguetung:
 *
 * 1. Kostet der Referral den Provider etwas? Er darf es nicht — sonst waere
 *    ein geworbener Provider dauerhaft teurer als ein nicht geworbener.
 * 2. Laesst sich mit blossem Anwerben Geld verdienen? Darf man nicht — genau
 *    das ist der Unterschied zwischen einem Referral- und einem
 *    Schneeballsystem.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitProviderPayment,
  referralShare,
  offlineMeshBounty,
  computeJobReferral,
  tierFor,
  nextTier,
  projectEarnings,
  referralLeaderboard,
  referralBudgetPpm,
  DEFAULT_PROVIDER_REFERRAL_PPM,
  HOSTING_REWARD_PPM,
  REFERRAL_MIN_PAYOUT_MSAT,
  REFERRAL_TIERS,
  ReferrerState,
} from "../src/referral.js";
import { PROTOCOL_FEE_PPM, FEE_REFERRAL_PPM } from "../src/protocol-fee.js";

const state = (pubkey: string, over: Partial<ReferrerState> = {}): ReferrerState => ({
  pubkey, activeReferrals: 0, lifetimePaidMsat: 0, pendingMsat: 0, ...over,
});
const states = (...s: ReferrerState[]) => new Map(s.map((x) => [x.pubkey, x]));

// ------------------------------------------------- Grundrechnung

test("referralShare berechnet ppm korrekt", () => {
  assert.equal(referralShare(1_000_000, 50_000), 50_000);
  assert.equal(referralShare(1_000_000, 100_000), 100_000);
});

test("splitProviderPayment nutzt die EINE Fee-Quelle", () => {
  const s = splitProviderPayment(
    1_000_000,
    { referrerPubkey: "ref", ppm: DEFAULT_PROVIDER_REFERRAL_PPM, kind: "provider" },
    "host",
  );
  const protokoll = Math.floor((1_000_000 * PROTOCOL_FEE_PPM) / 1_000_000);
  assert.equal(s.protocol, protokoll);
  assert.equal(s.host, HOSTING_REWARD_PPM);
  assert.equal(s.protocol + s.referrer + s.host + s.provider, 1_000_000, "kein msat verschwindet");
});

test("offlineMeshBounty teilt gleichmaessig", () => {
  assert.equal(offlineMeshBounty(10_000, 4), 2500);
  assert.equal(offlineMeshBounty(10_000, 0), 10_000, "kein Division-durch-null");
});

// ------------------------------------------- Die zentrale Invariante

test("Referral kostet den Provider NICHTS", () => {
  // Das ist die Eigenschaft, die eine ewige Verguetung ueberhaupt vertretbar
  // macht: Das Budget kommt aus der Fee, die ohnehin faellig ist.
  const mitWerber = computeJobReferral(1_000_000, { level1: "a" }, states(state("a")));
  const ohneWerber = computeJobReferral(1_000_000, {}, new Map());

  assert.equal(mitWerber.budgetMsat, ohneWerber.budgetMsat, "gleiches Budget, egal ob Werber da ist");
  assert.equal(mitWerber.budgetMsat, Math.floor((1_000_000 * FEE_REFERRAL_PPM) / 1_000_000));
});

test("Ohne Werber faellt das Budget in den Reward-Pool, nicht an den Provider", () => {
  const r = computeJobReferral(1_000_000, {}, new Map());
  assert.equal(r.payouts.length, 0);
  assert.equal(r.toRewardPoolMsat, r.budgetMsat);
});

test("Das Budget wird nie ueberschritten — auch nicht auf hoechster Stufe", () => {
  const r = computeJobReferral(
    10_000_000,
    { level1: "gross", level2: "auchgross" },
    states(state("gross", { activeReferrals: 500 }), state("auchgross", { activeReferrals: 500 })),
  );
  const verteilt = r.payouts.reduce((s, p) => s + p.accruedMsat, 0);
  assert.ok(verteilt <= r.budgetMsat, `${verteilt} > ${r.budgetMsat}`);
  assert.equal(verteilt + r.toRewardPoolMsat, r.budgetMsat, "kein msat entsteht oder verschwindet");
});

test("Stufen vergroessern den Topf nicht, sie verschieben nur den Anteil", () => {
  const klein = computeJobReferral(1_000_000, { level1: "a", level2: "b" },
    states(state("a"), state("b")));
  const gross = computeJobReferral(1_000_000, { level1: "a", level2: "b" },
    states(state("a", { activeReferrals: 100 }), state("b")));

  assert.equal(klein.budgetMsat, gross.budgetMsat);
  const a1 = klein.payouts.find((p) => p.pubkey === "a")!.accruedMsat;
  const a2 = gross.payouts.find((p) => p.pubkey === "a")!.accruedMsat;
  assert.ok(a2 > a1, "hoehere Stufe bekommt mehr");
  const b2 = gross.payouts.find((p) => p.pubkey === "b")!.accruedMsat;
  assert.ok(b2 < klein.payouts.find((p) => p.pubkey === "b")!.accruedMsat, "zulasten von Ebene 2");
});

// ------------------------------------------- Kein Schneeballsystem

test("Anwerben allein bringt exakt null", () => {
  // Die Linie, die das System von einem Schneeballsystem trennt: Verguetet
  // wird ausschliesslich ECHTER Umsatz. Hundert Geworbene ohne Arbeit sind
  // hundert mal nichts.
  const r = computeJobReferral(0, { level1: "werber" }, states(state("werber", { activeReferrals: 100 })));
  assert.equal(r.budgetMsat, 0);
  assert.equal(r.payouts.length, 0);
});

test("Nur zwei Ebenen — eine dritte wird nicht beruecksichtigt", () => {
  const r = computeJobReferral(
    10_000_000,
    { level1: "a", level2: "b", ...({ level3: "c" } as object) },
    states(state("a"), state("b"), state("c")),
  );
  assert.equal(r.payouts.length, 2);
  assert.ok(!r.payouts.some((p) => p.pubkey === "c"));
});

test("Derselbe Werber auf beiden Ebenen zaehlt nur einmal", () => {
  // Sonst koennte man sich durch eine Selbstverkettung den doppelten Anteil
  // verschaffen.
  const r = computeJobReferral(10_000_000, { level1: "a", level2: "a" }, states(state("a")));
  assert.equal(r.payouts.length, 1);
  assert.equal(r.payouts[0].accruedMsat + r.toRewardPoolMsat, r.budgetMsat);
});

// ------------------------------------------------------------- Stufen

test("Stufen greifen an den richtigen Schwellen", () => {
  assert.equal(tierFor(0).name, "Starter");
  assert.equal(tierFor(2).name, "Starter");
  assert.equal(tierFor(3).name, "Bronze");
  assert.equal(tierFor(24).name, "Silber");
  assert.equal(tierFor(25).name, "Gold");
  assert.equal(tierFor(1000).name, "Anker", "oberste Stufe ist die Obergrenze");
});

test("Stufen sind monoton — mehr Geworbene sind nie schlechter", () => {
  let letzter = 0;
  for (let n = 0; n <= 100; n++) {
    const m = tierFor(n).multiplier;
    assert.ok(m >= letzter, `bei ${n} fiel der Multiplikator`);
    letzter = m;
  }
});

test("Naechste Stufe wird mit Abstand angezeigt", () => {
  const n = nextTier(1)!;
  assert.equal(n.tier.name, "Bronze");
  assert.equal(n.missing, 2);
  assert.equal(nextTier(1000), null, "auf der obersten Stufe gibt es keine naechste");
});

test("Stufen zaehlen AKTIVE Geworbene, nicht angelegte", () => {
  // Der Wert kommt aus ReferrerState.activeReferrals, das nur zaehlt, wer in
  // den letzten 30 Tagen gearbeitet hat. Karteileichen bringen nichts.
  const mitLeichen = computeJobReferral(1_000_000, { level1: "a" }, states(state("a", { activeReferrals: 0 })));
  const mitAktiven = computeJobReferral(1_000_000, { level1: "a" }, states(state("a", { activeReferrals: 50 })));
  assert.equal(mitLeichen.payouts[0].tier, "Starter");
  assert.equal(mitAktiven.payouts[0].tier, "Anker");
});

// ------------------------------------------------------------- Auszahlung

test("Kleinbetraege werden gesammelt, nicht gekuerzt", () => {
  const r = computeJobReferral(100_000, { level1: "a" }, states(state("a")));
  const p = r.payouts[0];
  assert.equal(p.payableMsat, 0);
  assert.equal(p.pendingMsat, p.accruedMsat, "nichts geht verloren");
});

test("Ab der Schwelle wird die volle Summe ausgezahlt", () => {
  const r = computeJobReferral(
    100_000, { level1: "a" },
    states(state("a", { pendingMsat: REFERRAL_MIN_PAYOUT_MSAT })),
  );
  const p = r.payouts[0];
  assert.ok(p.payableMsat >= REFERRAL_MIN_PAYOUT_MSAT);
  assert.equal(p.pendingMsat, 0);
});

test("Verguetung endet NIE — auch nach sehr hohem Umsatz nicht", () => {
  // Genau der Unterschied zur vorherigen Fassung, die nach 1.000 sats aufhoerte.
  let summe = 0;
  for (let i = 0; i < 1000; i++) {
    const r = computeJobReferral(1_000_000, { level1: "a" }, states(state("a")));
    summe += r.payouts[0].accruedMsat;
  }
  const proJob = computeJobReferral(1_000_000, { level1: "a" }, states(state("a"))).payouts[0].accruedMsat;
  assert.equal(summe, proJob * 1000, "der tausendste Job zahlt so viel wie der erste");
  assert.ok(summe > 0);
});

// ------------------------------------------------------------- Anzeige

test("Hochrechnung nennt ihre Annahme statt eine nackte Zahl", () => {
  const p = projectEarnings({ activeReferrals: 10, avgMonthlySatsPerReferral: 100_000 });
  assert.ok(p.monthlySats > 0);
  assert.equal(p.yearlySats, p.monthlySats * 12);
  assert.equal(p.tier, "Silber");
  // Eine Zahl ohne Annahme waere eine Verkaufszahl.
  assert.match(p.assumption, /Annahme/);
  assert.match(p.assumption, /wer nicht arbeitet, bringt nichts/);
});

test("Hochrechnung: null Geworbene ergibt null", () => {
  assert.equal(projectEarnings({ activeReferrals: 0, avgMonthlySatsPerReferral: 999_999 }).monthlySats, 0);
});

test("Rangliste sortiert nach tatsaechlich Ausgezahltem", () => {
  const l = referralLeaderboard([
    state("viel_geworben", { activeReferrals: 50, lifetimePaidMsat: 1000 }),
    state("viel_verdient", { activeReferrals: 5, lifetimePaidMsat: 900_000 }),
  ]);
  // Wer viele wirbt, die nichts leisten, steht nicht oben — das ist die
  // Botschaft, die das System transportieren soll.
  assert.equal(l[0].pubkey, "viel_verdient");
  assert.equal(l[0].tier, "Bronze");
});

test("Budget-Invariante ist pruefbar", () => {
  assert.equal(referralBudgetPpm(), FEE_REFERRAL_PPM);
  // 20 % der Protokollfee, also weiterhin 0,5 % der Zahlung. Die absolute
  // Verguetung der Werber hat sich durch die Umschichtung NICHT geaendert —
  // nur der Dev-Anteil ist aus der Protokollfee verschwunden.
  assert.equal(FEE_REFERRAL_PPM, PROTOCOL_FEE_PPM / 5);
  assert.equal(FEE_REFERRAL_PPM, 5_000, "0,5 % der Zahlung, wie vorher");
});

test("Stufenliste ist in sich stimmig", () => {
  for (let i = 1; i < REFERRAL_TIERS.length; i++) {
    assert.ok(
      REFERRAL_TIERS[i].minActiveReferrals > REFERRAL_TIERS[i - 1].minActiveReferrals,
      "Schwellen muessen steigen",
    );
    assert.ok(REFERRAL_TIERS[i].multiplier > REFERRAL_TIERS[i - 1].multiplier);
  }
  assert.equal(REFERRAL_TIERS[0].minActiveReferrals, 0, "jeder faengt irgendwo an");
});
