/**
 * Referral auf Dauer — bezahlt aus der Protokollfee, nicht vom Provider.
 *
 * DIE ENTSCHEIDENDE KONSTRUKTION
 * Ein ewiger Referral-Anteil, der ZUSAETZLICH vom Provider abgezogen wird,
 * belastet ihn fuer immer und macht ihn gegenueber nicht-geworbenen Providern
 * dauerhaft teurer. Das haette irgendwann jemand gemerkt und fuer unfair
 * gehalten — zu Recht.
 *
 * Hier laeuft es anders herum: Der Referral-Anteil kommt aus dem Teil der
 * Protokollfee, der ohnehin dafuer vorgesehen ist (FEE_REFERRAL_PPM, 10% der
 * 5% Fee). Fuer den Provider aendert sich dadurch NICHTS — er zahlt dieselbe
 * Fee wie jeder andere. Ist niemand als Werber eingetragen, faellt der Anteil
 * in den Reward-Pool zurueck. Deshalb kann er ohne Nebenwirkung ewig laufen:
 * es gibt keine Kosten, die mit der Zeit wachsen.
 *
 * ZWEI EBENEN, NICHT MEHR — UND WARUM
 * Ebene 2 (wer meine Geworbenen wirbt) erhoeht die Motivation deutlich, weil
 * ein guter Werber dafuer belohnt wird, andere gute Werber zu finden. Tiefer
 * gehe ich bewusst nicht: Ein System mit unbegrenzten Ebenen, in dem der
 * Verdienst hauptsaechlich aus dem Anwerben stammt, ist in Oesterreich und der
 * EU ein Schneeballsystem und damit verboten (§ 168a StGB, UWG Anh. Z14).
 *
 * Die Linie, die das hier klar auf der richtigen Seite haelt:
 * ES GIBT KEINEN CENT FUERS ANWERBEN. Verguetet wird ausschliesslich ein
 * Anteil an ECHTEM Umsatz aus echter Rechenarbeit. Wer hundert Leute wirbt,
 * die nie einen Job liefern, verdient exakt null. Kein Eintrittsgeld, kein
 * Kaufzwang, keine Position, die man erwerben kann.
 */
import { PROTOCOL_FEE_PPM, FEE_REFERRAL_PPM } from "./protocol-fee.js";

export const DEFAULT_PROVIDER_REFERRAL_PPM = 50_000;  // 5%
export const DEFAULT_USER_REFERRAL_PPM = 50_000;      // 5%
export const HOSTING_REWARD_PPM = 20_000;             // 2% an den app-host
export const OFFLINE_MESH_BONUS_PPM = 100_000;        // 10% an den ueberbringer

/**
 * Aufteilung des Referral-Budgets auf die beiden Ebenen, in Prozent.
 * Ebene 1 behaelt den Loewenanteil — wer direkt wirbt, hat die Arbeit gemacht.
 */
export const LEVEL1_SHARE_PERCENT = 75;
export const LEVEL2_SHARE_PERCENT = 25;

/**
 * Mindestbetrag fuer eine Auszahlung.
 *
 * Das ist Auszahlungsmechanik, keine Kuerzung: Unter 1 sat kann Lightning
 * technisch nicht zahlen, und die Routing-Gebuehr waere ein Vielfaches. Alles
 * darunter wird gesammelt und spaeter vollstaendig ausgezahlt — es geht nichts
 * verloren.
 */
export const REFERRAL_MIN_PAYOUT_MSAT = 10_000; // 10 sats

/**
 * Stufen: Wer mehr AKTIVE Provider geworben hat, bekommt einen groesseren
 * Anteil am Referral-Budget.
 *
 * "Aktiv" heisst: hat in den letzten 30 Tagen tatsaechlich gearbeitet. Sonst
 * waere das Anlegen von Karteileichen der Weg nach oben.
 */
export interface ReferralTier {
  name: string;
  minActiveReferrals: number;
  /** Multiplikator auf den eigenen Anteil INNERHALB des Budgets. */
  multiplier: number;
  perk: string;
}

export const REFERRAL_TIERS: ReferralTier[] = [
  { name: "Starter", minActiveReferrals: 0, multiplier: 1.0, perk: "Voller Anteil ab dem ersten Job" },
  { name: "Bronze", minActiveReferrals: 3, multiplier: 1.25, perk: "+25 % Anteil" },
  { name: "Silber", minActiveReferrals: 10, multiplier: 1.5, perk: "+50 % Anteil, Nennung im Dashboard" },
  { name: "Gold", minActiveReferrals: 25, multiplier: 1.75, perk: "+75 % Anteil" },
  { name: "Anker", minActiveReferrals: 50, multiplier: 2.0, perk: "Doppelter Anteil" },
];

export function tierFor(activeReferrals: number): ReferralTier {
  let current = REFERRAL_TIERS[0];
  for (const t of REFERRAL_TIERS) {
    if (activeReferrals >= t.minActiveReferrals) current = t;
  }
  return current;
}

/** Naechste Stufe und wie weit es noch ist — fuer die Anzeige. */
export function nextTier(activeReferrals: number): { tier: ReferralTier; missing: number } | null {
  const next = REFERRAL_TIERS.find((t) => t.minActiveReferrals > activeReferrals);
  return next ? { tier: next, missing: next.minActiveReferrals - activeReferrals } : null;
}

export interface Referral {
  referrerPubkey: string;
  ppm: number;
  kind: "provider" | "user";
}

export function referralShare(amountMsat: number, ppm: number): number {
  return Math.floor((amountMsat * ppm) / 1_000_000);
}

/**
 * Split einer Provider-Zahlung: Protokollfee + Referral + Hosting + Provider.
 *
 * ACHTUNG — HIER STAND EIN ZWEITES FEE-MODELL: Diese Funktion rechnete mit
 * fest verdrahteten 1%, waehrend protocol-fee.ts 5% vorgibt.
 */
export function splitProviderPayment(
  amountMsat: number,
  referral: Referral | null,
  hostPubkey: string | null,
): { protocol: number; referrer: number; host: number; provider: number } {
  const protocol = Math.floor((amountMsat * PROTOCOL_FEE_PPM) / 1_000_000);
  const referrer = referral ? referralShare(amountMsat, referral.ppm) : 0;
  const host = hostPubkey ? referralShare(amountMsat, HOSTING_REWARD_PPM) : 0;
  const provider = amountMsat - protocol - referrer - host;
  return { protocol, referrer, host, provider };
}

// ------------------------------------------------------- Dauerhafte Kette

export interface ReferralChain {
  /** Wer den Provider direkt geworben hat. */
  level1?: string;
  /** Wer wiederum level1 geworben hat. */
  level2?: string;
}

export interface ReferrerState {
  pubkey: string;
  /** Geworbene, die in den letzten 30 Tagen gearbeitet haben. */
  activeReferrals: number;
  /** Bereits ausgezahlt, gesamt. */
  lifetimePaidMsat: number;
  /** Aufgelaufen, aber noch unter der Auszahlungsschwelle. */
  pendingMsat: number;
}

export interface ReferralPayout {
  pubkey: string;
  level: 1 | 2;
  accruedMsat: number;
  payableMsat: number;
  pendingMsat: number;
  tier: string;
}

export interface JobReferralResult {
  payouts: ReferralPayout[];
  /**
   * Referral-Budget ohne Empfaenger.
   *
   * Faellt in den Reward-Pool zurueck, statt beim Provider zu bleiben — sonst
   * waere ein Job mit Werber teurer als einer ohne, und die Fee waere nicht
   * mehr fuer alle gleich.
   */
  toRewardPoolMsat: number;
  budgetMsat: number;
}

/**
 * Rechnet die Referral-Anteile eines Jobs aus — dauerhaft, ohne Enddatum.
 *
 * Die Stufen-Multiplikatoren wirken INNERHALB des Budgets: Ein hoeherer Rang
 * verschiebt den Anteil zugunsten von Ebene 1, er vergroessert den Topf nicht.
 * Andernfalls wuerden erfolgreiche Werber den Reward-Pool leerziehen.
 */
export function computeJobReferral(
  jobAmountMsat: number,
  chain: ReferralChain,
  states: Map<string, ReferrerState>,
  minPayoutMsat = REFERRAL_MIN_PAYOUT_MSAT,
): JobReferralResult {
  const budget = Math.floor((jobAmountMsat * FEE_REFERRAL_PPM) / 1_000_000);
  if (budget <= 0) return { payouts: [], toRewardPoolMsat: 0, budgetMsat: 0 };

  const empfaenger: { pubkey: string; level: 1 | 2; gewicht: number; tier: ReferralTier }[] = [];
  if (chain.level1) {
    const t = tierFor(states.get(chain.level1)?.activeReferrals ?? 0);
    empfaenger.push({ pubkey: chain.level1, level: 1, gewicht: LEVEL1_SHARE_PERCENT * t.multiplier, tier: t });
  }
  if (chain.level2 && chain.level2 !== chain.level1) {
    const t = tierFor(states.get(chain.level2)?.activeReferrals ?? 0);
    empfaenger.push({ pubkey: chain.level2, level: 2, gewicht: LEVEL2_SHARE_PERCENT * t.multiplier, tier: t });
  }
  if (empfaenger.length === 0) {
    return { payouts: [], toRewardPoolMsat: budget, budgetMsat: budget };
  }

  const gewichtSumme = empfaenger.reduce((s, e) => s + e.gewicht, 0);
  const payouts: ReferralPayout[] = [];
  let verteilt = 0;

  for (const e of empfaenger) {
    const anteil = Math.floor((budget * e.gewicht) / gewichtSumme);
    verteilt += anteil;
    const offen = (states.get(e.pubkey)?.pendingMsat ?? 0) + anteil;
    const zahlbar = offen >= minPayoutMsat ? offen : 0;
    payouts.push({
      pubkey: e.pubkey,
      level: e.level,
      accruedMsat: anteil,
      payableMsat: zahlbar,
      pendingMsat: zahlbar > 0 ? 0 : offen,
      tier: e.tier.name,
    });
  }

  // Rundungsreste in den Pool, nie an einen Einzelnen — sonst entschiede die
  // Reihenfolge der Empfaenger ueber einen Vorteil.
  return { payouts, toRewardPoolMsat: budget - verteilt, budgetMsat: budget };
}

/**
 * Hochrechnung fuer die Anzeige.
 *
 * Bewusst als Rechnung mit klar benannter Annahme, nicht als Versprechen. Eine
 * Zahl ohne Annahme waere eine Verkaufszahl; eine Zahl mit Annahme kann der
 * Nutzer selbst nachvollziehen.
 */
export function projectEarnings(args: {
  activeReferrals: number;
  avgMonthlySatsPerReferral: number;
}): { monthlySats: number; yearlySats: number; tier: string; assumption: string } {
  const t = tierFor(args.activeReferrals);
  const budgetAnteil = FEE_REFERRAL_PPM / 1_000_000;
  const ebene1Anteil = (LEVEL1_SHARE_PERCENT * t.multiplier) /
    (LEVEL1_SHARE_PERCENT * t.multiplier + LEVEL2_SHARE_PERCENT);

  const monatlich = Math.floor(
    args.activeReferrals * args.avgMonthlySatsPerReferral * budgetAnteil * ebene1Anteil,
  );
  return {
    monthlySats: monatlich,
    yearlySats: monatlich * 12,
    tier: t.name,
    assumption:
      `Annahme: ${args.activeReferrals} aktive Provider mit je ` +
      `${args.avgMonthlySatsPerReferral.toLocaleString("de-DE")} sats Monatsumsatz. ` +
      `Verdient wird nur an tatsaechlicher Arbeit — wer nicht arbeitet, bringt nichts.`,
  };
}

/** Rangliste fuer das Dashboard. */
export function referralLeaderboard(
  states: Iterable<ReferrerState>,
  limit = 20,
): { pubkey: string; activeReferrals: number; lifetimePaidMsat: number; tier: string }[] {
  return [...states]
    .map((s) => ({
      pubkey: s.pubkey,
      activeReferrals: s.activeReferrals,
      lifetimePaidMsat: s.lifetimePaidMsat,
      tier: tierFor(s.activeReferrals).name,
    }))
    .sort((a, b) => b.lifetimePaidMsat - a.lifetimePaidMsat || b.activeReferrals - a.activeReferrals)
    .slice(0, limit);
}

/** Referral-Budget in ppm der Zahlung — die pruefbare Invariante. */
export function referralBudgetPpm(): number {
  return FEE_REFERRAL_PPM;
}

/** Offline-mesh: priority-payment fuer die ersten X ueberbringer einer
 *  nachricht. Der ersteller legt eine belohnung in escrow; die ersten X, die
 *  ein gueltiges delivery-receipt liefern, teilen sie. */
export function offlineMeshBounty(totalMsat: number, maxCouriers: number): number {
  return Math.floor(totalMsat / Math.max(1, maxCouriers));
}
