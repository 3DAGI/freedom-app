/**
 * Reward-Pool-Verteiler: der Topf wird jetzt auch ausgeschüttet.
 *
 * WAS FEHLTE
 * 40 % der Protokollfee gehen in den Reward-Pool. `settlement.ts` zahlt sie
 * seit dieser Runde tatsächlich an die Pool-Adresse. Danach lagen sie dort —
 * es gab keinen Prozess, der sie verteilt. Der Knappheitsbonus rechnete aus,
 * wer wie viel bekommen sollte, und niemand führte es aus.
 *
 * WIE ES LÄUFT
 * Einmal pro Epoche (Standard: eine Woche) wird der Graph aus signierten
 * Netz-Ereignissen gebaut, der Bonus gerechnet, ausgezahlt und ein
 * signierter Bericht veröffentlicht. Jeder kann die Rechnung mit denselben
 * öffentlichen Ereignissen nachvollziehen.
 *
 * DREI EIGENSCHAFTEN, DIE NICHT VERHANDELBAR SIND
 *
 * 1. **Der Topf wird nie überschritten.** Ohne eigenen Token gibt es nichts
 *    nachzudrucken. Eine Zusage, die nicht gedeckt ist, wäre ein Versprechen
 *    auf Kosten der Provider.
 * 2. **Keine Epoche wird zweimal ausgezahlt.** Ein Verteiler, der nach einem
 *    Neustart von vorn beginnt, leert den Pool an die zuletzt Aktiven — der
 *    teuerste denkbare Fehler in diesem Modul.
 * 3. **Der Bericht wird veröffentlicht, auch wenn Zahlungen scheitern.**
 *    Eine Verteilung, über die es keine Aufzeichnung gibt, ist von einer
 *    Unterschlagung nicht zu unterscheiden.
 */
import {
  OutboxPool,
  NostrEvent,
  buildEvent,
  signEvent,
  parsePerformance,
  KIND_PERFORMANCE,
  KIND_REFERRAL_CLAIM,
  buildReferralGraph,
  distributeScarcityBonus,
  normalizeRegion,
  computeTrust,
  extractEdges,
  BonusInput,
  Region,
} from "@freedomstack/protocol";
import { Payer } from "./settlement.js";

/** Signierter Verteilungsbericht. */
export const KIND_POOL_DISTRIBUTION = 38053;

export interface DistributorConfig {
  keypair: { pk: string; sk: Uint8Array };
  /** Dauer einer Epoche in Sekunden. Default 7 Tage. */
  epochSeconds?: number;
  /** Datei für den Zustand — verhindert doppelte Auszahlung. */
  statePath?: string;
  /** Untergrenze: unter diesem Betrag wird nicht verteilt, sondern gewartet. */
  minPoolMsat?: number;
  /** Mindestvertrauen und Mindest-Jobs für die Teilnahme. */
  minTrust?: number;
  minJobs?: number;
}

export interface DistributorState {
  /** Letzte vollständig ausgezahlte Epoche. */
  lastEpoch: number;
  /** Summe aller je verteilten Beträge — für den Bericht. */
  totalDistributedMsat: number;
  /** Nicht verteilte Reste, die in die nächste Epoche wandern. */
  carryOverMsat: number;
}

const DEFAULT_EPOCH = 7 * 24 * 3600;

export function epochNumber(nowSecs = Math.floor(Date.now() / 1000), epochSeconds = DEFAULT_EPOCH): number {
  return Math.floor(nowSecs / epochSeconds);
}

export class PoolDistributor {
  private state: DistributorState = { lastEpoch: 0, totalDistributedMsat: 0, carryOverMsat: 0 };

  constructor(
    private cfg: DistributorConfig,
    private pool: OutboxPool,
    private payer?: Payer,
  ) {}

  async load(): Promise<void> {
    if (!this.cfg.statePath) return;
    try {
      const { readFile } = await import("node:fs/promises");
      this.state = JSON.parse(await readFile(this.cfg.statePath, "utf8")) as DistributorState;
    } catch { /* erster Lauf */ }
  }

  private async save(): Promise<void> {
    if (!this.cfg.statePath) return;
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(this.cfg.statePath), { recursive: true });
    // Ohne diesen Zustand faengt der Verteiler nach einem Neustart von vorn an
    // und leert den Pool an die zuletzt Aktiven.
    await writeFile(this.cfg.statePath, JSON.stringify(this.state), { mode: 0o600 });
  }

  get currentState(): DistributorState {
    return { ...this.state };
  }

  /** Steht eine Verteilung an? */
  isDue(nowSecs = Math.floor(Date.now() / 1000)): boolean {
    const epoch = epochNumber(nowSecs, this.cfg.epochSeconds ?? DEFAULT_EPOCH);
    // Die LAUFENDE Epoche wird nie verteilt — sonst bekämen Provider, die
    // später in der Woche arbeiten, systematisch nichts.
    return epoch - 1 > this.state.lastEpoch;
  }

  /**
   * Baut die Teilnehmerliste aus signierten Ereignissen.
   *
   * Bewusst öffentlich zugänglich, damit jeder dieselbe Rechnung anstellen
   * kann. Ein Verteiler, dessen Eingabedaten niemand nachvollziehen kann, ist
   * ein Verwahrer mit Extraschritten.
   */
  async collectParticipants(epoch: number): Promise<{ participants: BonusInput[]; events: NostrEvent[] }> {
    const epochSeconds = this.cfg.epochSeconds ?? DEFAULT_EPOCH;
    const from = epoch * epochSeconds;
    const until = from + epochSeconds;

    const perfs = await this.pool.query({
      kinds: [KIND_PERFORMANCE], since: from, until, limit: 5000,
    });
    const claims = await this.pool.query({ kinds: [KIND_REFERRAL_CLAIM], limit: 2000 });
    void claims; // Referral wird pro Job abgerechnet, nicht aus dem Pool.

    // Vertrauen aus dem Web-of-Trust: eine frische Identität allein
    // qualifiziert nicht, sonst wäre der Pool per Sybil abschöpfbar.
    const trustEvents = await this.pool.query({ kinds: [3], limit: 2000 }).catch(() => []);
    const trust = computeTrust(extractEdges(trustEvents), { roots: [this.cfg.keypair.pk] });

    const byWorker = new Map<string, { jobs: number; earned: number; region: Region }>();
    for (const ev of perfs) {
      let p;
      try {
        p = parsePerformance(ev);
      } catch {
        continue;
      }
      const region = normalizeRegion(ev.tags.find((t) => t[0] === "region")?.[1]);
      const e = byWorker.get(p.workerPubkey) ?? { jobs: 0, earned: 0, region };
      e.jobs += 1;
      e.earned += p.volumeMsat;
      // Region der Mehrheit der Nachweise gewinnt; hier genügt die erste.
      if (e.region === "unknown") e.region = region;
      byWorker.set(p.workerPubkey, e);
    }

    const participants: BonusInput[] = [...byWorker.entries()].map(([pubkey, e]) => ({
      providerPubkey: pubkey,
      region: e.region,
      jobsCompleted: e.jobs,
      earnedMsat: e.earned,
      trust: trust.get(pubkey) ?? 0,
    }));

    return { participants, events: perfs };
  }

  /**
   * Führt eine Verteilung aus.
   *
   * `poolMsat` ist der tatsächlich verfügbare Betrag — der Aufrufer liest ihn
   * aus der Pool-Wallet. Er wird NICHT geschätzt: Ein Verteiler, der mehr
   * zusagt als vorhanden ist, produziert Forderungen, die niemand einlösen kann.
   */
  async distribute(args: {
    poolMsat: number;
    /** Lightning-Adressen der Provider (aus deren Fähigkeiten-Events). */
    lud16Of: Map<string, string>;
    nowSecs?: number;
    dryRun?: boolean;
  }): Promise<{
    epoch: number;
    payouts: { pubkey: string; msat: number; paid: boolean; error?: string }[];
    distributedMsat: number;
    carryOverMsat: number;
    reportEventId?: string;
    skipped?: string;
  }> {
    const now = args.nowSecs ?? Math.floor(Date.now() / 1000);
    const epochSeconds = this.cfg.epochSeconds ?? DEFAULT_EPOCH;
    const epoch = epochNumber(now, epochSeconds) - 1;

    if (epoch <= this.state.lastEpoch) {
      return {
        epoch, payouts: [], distributedMsat: 0, carryOverMsat: this.state.carryOverMsat,
        skipped: `Epoche ${epoch} wurde bereits verteilt.`,
      };
    }

    const verfuegbar = args.poolMsat + this.state.carryOverMsat;
    const minPool = this.cfg.minPoolMsat ?? 100_000; // 100 sats
    if (verfuegbar < minPool) {
      // Nicht verteilen, sondern ansparen: Bei einem winzigen Topf ginge
      // alles in Routing-Gebühren auf.
      this.state.carryOverMsat = verfuegbar;
      this.state.lastEpoch = epoch;
      await this.save();
      return {
        epoch, payouts: [], distributedMsat: 0, carryOverMsat: verfuegbar,
        skipped: `Nur ${verfuegbar} msat im Pool — wird angespart (Schwelle ${minPool}).`,
      };
    }

    const { participants } = await this.collectParticipants(epoch);
    const result = distributeScarcityBonus(participants, {
      poolMsat: verfuegbar,
      minTrust: this.cfg.minTrust,
      minJobs: this.cfg.minJobs,
    });

    const payouts: { pubkey: string; msat: number; paid: boolean; error?: string }[] = [];
    let tatsaechlich = 0;

    for (const p of result.payouts) {
      if (args.dryRun) {
        payouts.push({ pubkey: p.providerPubkey, msat: p.bonusMsat, paid: false, error: "Probelauf" });
        continue;
      }
      const lud16 = args.lud16Of.get(p.providerPubkey);
      if (!this.payer || !lud16) {
        payouts.push({
          pubkey: p.providerPubkey, msat: p.bonusMsat, paid: false,
          error: lud16 ? "kein Zahlweg konfiguriert" : "keine Lightning-Adresse bekannt",
        });
        continue;
      }
      try {
        await this.payer.payToLightningAddress(lud16, p.bonusMsat, `freedomstack pool ${epoch}`);
        payouts.push({ pubkey: p.providerPubkey, msat: p.bonusMsat, paid: true });
        tatsaechlich += p.bonusMsat;
      } catch (e) {
        payouts.push({
          pubkey: p.providerPubkey, msat: p.bonusMsat, paid: false, error: (e as Error).message,
        });
      }
    }

    // Was nicht ausgezahlt wurde, wandert in die nächste Epoche — es bleibt
    // im Pool und geht nicht an den Betreiber.
    const carry = verfuegbar - tatsaechlich;

    if (!args.dryRun) {
      this.state.lastEpoch = epoch;
      this.state.totalDistributedMsat += tatsaechlich;
      this.state.carryOverMsat = carry;
      await this.save();
    }

    let reportEventId: string | undefined;
    if (!args.dryRun) {
      // Auch bei gescheiterten Zahlungen veröffentlichen: eine Verteilung
      // ohne Aufzeichnung ist von einer Unterschlagung nicht zu unterscheiden.
      reportEventId = await this.publishReport(epoch, verfuegbar, tatsaechlich, carry, payouts);
    }

    return { epoch, payouts, distributedMsat: tatsaechlich, carryOverMsat: carry, reportEventId };
  }

  private async publishReport(
    epoch: number,
    poolMsat: number,
    distributedMsat: number,
    carryOverMsat: number,
    payouts: { pubkey: string; msat: number; paid: boolean }[],
  ): Promise<string | undefined> {
    const tags: string[][] = [
      ["d", `pool:${epoch}`],
      ["epoch", String(epoch)],
      ["pool_msat", String(poolMsat)],
      ["distributed_msat", String(distributedMsat)],
      ["carry_msat", String(carryOverMsat)],
      ["recipients", String(payouts.filter((p) => p.paid).length)],
    ];
    for (const p of payouts) {
      tags.push(["payout", p.pubkey, String(p.msat), p.paid ? "paid" : "open"]);
    }
    const ev = signEvent(
      buildEvent(this.cfg.keypair.pk, KIND_POOL_DISTRIBUTION, tags, ""),
      this.cfg.keypair.sk,
    );
    try {
      const report = await this.pool.publish(ev);
      return report.accepted.length > 0 ? ev.id : undefined;
    } catch (e) {
      console.warn(`[pool] Bericht nicht veröffentlicht: ${(e as Error).message}`);
      return undefined;
    }
  }
}

/** Prüft einen veröffentlichten Verteilungsbericht auf Stimmigkeit. */
export function verifyDistributionReport(ev: NostrEvent): {
  ok: boolean;
  problems: string[];
  epoch: number;
  poolMsat: number;
  distributedMsat: number;
} {
  const num = (t: string): number => Number(ev.tags.find((x) => x[0] === t)?.[1] ?? "NaN");
  const epoch = num("epoch");
  const poolMsat = num("pool_msat");
  const distributedMsat = num("distributed_msat");
  const carry = num("carry_msat");
  const problems: string[] = [];

  if (ev.kind !== KIND_POOL_DISTRIBUTION) problems.push(`falscher kind: ${ev.kind}`);
  if (!Number.isFinite(epoch) || !Number.isFinite(poolMsat)) problems.push("Bericht ohne epoch/pool_msat");

  const summe = ev.tags
    .filter((t) => t[0] === "payout" && t[3] === "paid")
    .reduce((s, t) => s + Number(t[2] || 0), 0);

  if (Number.isFinite(distributedMsat) && summe !== distributedMsat) {
    problems.push(`Einzelposten ergeben ${summe} msat, ausgewiesen sind ${distributedMsat}`);
  }
  if (Number.isFinite(carry) && distributedMsat + carry !== poolMsat) {
    problems.push(
      `Verteilt (${distributedMsat}) plus Übertrag (${carry}) ergibt nicht den Topf (${poolMsat})`,
    );
  }
  if (distributedMsat > poolMsat) problems.push("Es wurde mehr verteilt als vorhanden war");

  return { ok: problems.length === 0, problems, epoch, poolMsat, distributedMsat };
}
