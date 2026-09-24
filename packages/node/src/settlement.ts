/**
 * Settlement: die Fee wird nicht mehr nur gerechnet, sondern ausgezahlt.
 *
 * DER ZUSTAND VORHER
 * `dvm-provider.ts` berechnete den 5%-Split und schrieb ihn in eine Logzeile:
 *
 *     [dvm] a3f2… -> 1200 msat (provider 1194 / pool 2 / protocol 4)
 *
 * Damit endete es. Es gab im ganzen Projekt keine Stelle, die diese Beträge
 * bewegt — kein Lightning-Multi-Output, keinen SOL-Transfer, keinen
 * Pool-Verteiler. Das Geschäftsmodell existierte als Datenstruktur und sonst
 * nirgends.
 *
 * WAS DIESES MODUL TUT
 * Es führt die drei Fee-Zahlungen tatsächlich aus und erzeugt anschließend
 * einen signierten Fee-Beweis (kind 38051), den jeder Kunde nachprüfen kann.
 *
 * NON-CUSTODIAL BLEIBT GEWAHRT
 * Der Provider zahlt aus seinem eigenen Erlös direkt an drei getrennte Ziele.
 * Es gibt kein Sammelwallet, durch das fremdes Geld fließt — genau das war die
 * Bedingung, unter der die Fee überhaupt vertretbar ist.
 *
 * FEHLERVERHALTEN, BEWUSST GEWÄHLT
 * Schlägt eine Fee-Zahlung fehl, wird der JOB NICHT rückabgewickelt. Der Kunde
 * hat seine Antwort bekommen und schuldet nichts weiter; die offene Fee wird
 * vermerkt und beim nächsten Durchlauf erneut versucht. Die Alternative — dem
 * Kunden das Ergebnis vorzuenthalten, weil eine Zahlung an die Treasury
 * hakt — wäre die falsche Seite zu bestrafen.
 */
import {
  splitFeeV1,
  buildFeeProof,
  FeeLegProof,
  signEvent,
  OutboxPool,
  weekNumber,
} from "@freedomstack/protocol";

export interface PayoutTarget {
  /** Lightning-Adresse (lud16) oder Node-Pubkey für Keysend. */
  lud16?: string;
  nodePubkey?: string;
  /** Solana-Adresse (base58) — für den Dev-Anteil an die Wochen-Adresse. */
  solAddress?: string;
}

export interface SettlementTargets {
  pool: PayoutTarget;
  referral: PayoutTarget;
  /** Fehlt sie, wird die Wochen-Adresse aus dem Treasury-Secret abgeleitet. */
  dev?: PayoutTarget;
}

/** Was der Payer können muss. LND, NWC oder ein Testdouble erfüllen das. */
export interface Payer {
  /** Zahlt an eine Lightning-Adresse. Gibt das Preimage zurück. */
  payToLightningAddress(lud16: string, amountMsat: number, memo: string): Promise<{ preimage: string; paymentHash: string }>;
  /** Direktzahlung an einen Node-Pubkey ohne Rechnung. */
  keysend?(nodePubkey: string, amountMsat: number): Promise<{ preimage: string; paymentHash: string }>;
}

export interface LegOutcome {
  leg: "client" | "pool" | "referral";
  amountMsat: number;
  recipient: string;
  paid: boolean;
  preimage?: string;
  paymentHash?: string;
  error?: string;
}

export interface SettlementResult {
  totalMsat: number;
  workerMsat: number;
  legs: LegOutcome[];
  /** Summe der Beträge, die nicht durchgingen. */
  unsettledMsat: number;
  /** Event-ID des veröffentlichten Fee-Beweises, falls erzeugt. */
  proofEventId?: string;
}

/**
 * Beträge unterhalb dieser Schwelle werden gesammelt statt einzeln gezahlt.
 *
 * Grund: Bei einem 1200-msat-Job sind 5 % Fee 60 msat, davon 6 msat Referral.
 * Eine Lightning-Zahlung über 6 msat ist technisch nicht möglich (Minimum
 * 1 sat = 1000 msat) und wirtschaftlich unsinnig — die Routing-Gebühr wäre ein
 * Vielfaches des Betrags. Deshalb: aufsummieren und zahlen, wenn es sich lohnt.
 */
export const MIN_PAYOUT_MSAT = 10_000; // 10 sats

/**
 * Sammelt Kleinbeträge, bis eine Zahlung sinnvoll ist.
 *
 * Bewusst nur im Arbeitsspeicher plus Datei — das ist KEIN Verwahren fremder
 * Gelder, sondern eine aufgeschobene eigene Verbindlichkeit des Providers.
 */
export class FeeAccumulator {
  private balances = new Map<string, number>();

  constructor(private statePath?: string) {}

  async load(): Promise<void> {
    if (!this.statePath) return;
    try {
      const { readFile } = await import("node:fs/promises");
      const raw = JSON.parse(await readFile(this.statePath, "utf8")) as Record<string, number>;
      this.balances = new Map(Object.entries(raw));
    } catch { /* erster Lauf */ }
  }

  async save(): Promise<void> {
    if (!this.statePath) return;
    try {
      const { writeFile, mkdir } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(this.statePath), { recursive: true });
      await writeFile(this.statePath, JSON.stringify(Object.fromEntries(this.balances)), { mode: 0o600 });
    } catch (e) {
      // Verloren geht hier eine Verbindlichkeit des Providers, kein Kundengeld.
      console.warn(`[settle] Rücklage nicht speicherbar: ${(e as Error).message}`);
    }
  }

  add(key: string, msat: number): number {
    const next = (this.balances.get(key) ?? 0) + msat;
    this.balances.set(key, next);
    return next;
  }

  /** Nimmt den gesammelten Betrag heraus, wenn er die Schwelle erreicht. */
  takeIfDue(key: string, threshold = MIN_PAYOUT_MSAT): number {
    const bal = this.balances.get(key) ?? 0;
    if (bal < threshold) return 0;
    this.balances.set(key, 0);
    return bal;
  }

  pending(key: string): number {
    return this.balances.get(key) ?? 0;
  }

  totalPending(): number {
    let sum = 0;
    for (const v of this.balances.values()) sum += v;
    return sum;
  }
}

/**
 * ENTFERNT: devTarget().
 *
 * Der Dev-Anteil kommt nicht mehr aus dem Protokoll, sondern aus der
 * Client-Deklaration im Job-Event. Es gibt keine abzuleitende Adresse mehr —
 * und keinen Grund, dass ein Provider-Knoten ein Treasury-Secret kennt.
 */

function targetLabel(t: PayoutTarget): string {
  return t.lud16 ?? t.nodePubkey ?? t.solAddress ?? "unbekannt";
}

/**
 * Führt den Fee-Split aus und veröffentlicht den Beweis.
 *
 * `payer` fehlt oder kann nicht zahlen -> die Beträge landen in der Rücklage
 * und der Beweis wird trotzdem erzeugt, mit den Legs als "angekündigt". Das
 * ist ehrlicher, als gar nichts zu veröffentlichen: der Kunde sieht dann, dass
 * gerechnet, aber noch nicht überwiesen wurde.
 */
export async function settleJobFees(args: {
  totalMsat: number;
  resultEventId: string;
  providerKeypair: { pk: string; sk: Uint8Array };
  providerLud16: string;
  customerPubkey: string;
  targets: SettlementTargets;
  payer?: Payer;
  pool?: OutboxPool;
  accumulator?: FeeAccumulator;
  publishProof?: boolean;
  /** Vom Client deklarierte Gebuehr in msat (aus dem Job-Event). */
  clientFeeMsat?: number;
  /** Empfaenger der Client-Gebuehr — ebenfalls aus dem Job-Event. */
  clientFeeRecipient?: string;
}): Promise<SettlementResult> {
  const split = splitFeeV1(args.totalMsat);

  // Die Client-Gebuehr steht NICHT im Protokoll — sie kommt aus dem Job-Event
  // des Clients und ist gedeckelt. Ist keine deklariert, faellt sie weg und der
  // Provider behaelt den Betrag; es gibt keinen Empfaenger, der sie erzwingt.
  const plan: { leg: "client" | "pool" | "referral"; msat: number; target: PayoutTarget }[] = [
    { leg: "pool", msat: split.poolMsat, target: args.targets.pool },
    { leg: "referral", msat: split.referralMsat, target: args.targets.referral },
  ];
  if (args.clientFeeMsat && args.clientFeeMsat > 0 && args.clientFeeRecipient) {
    plan.unshift({
      leg: "client",
      msat: args.clientFeeMsat,
      target: { lud16: args.clientFeeRecipient },
    });
  }

  const legs: LegOutcome[] = [];
  let unsettledMsat = 0;

  for (const p of plan) {
    const recipient = targetLabel(p.target);
    const acc = args.accumulator;

    // Kleinbeträge sammeln, bis sich eine Zahlung lohnt.
    let payable = p.msat;
    if (acc) {
      acc.add(`${p.leg}:${recipient}`, p.msat);
      payable = acc.takeIfDue(`${p.leg}:${recipient}`);
    }

    if (payable === 0) {
      legs.push({
        leg: p.leg, amountMsat: p.msat, recipient, paid: false,
        error: `unter Auszahlungsschwelle, gesammelt (${acc?.pending(`${p.leg}:${recipient}`) ?? p.msat} msat offen)`,
      });
      unsettledMsat += p.msat;
      continue;
    }

    if (!args.payer || !p.target.lud16) {
      legs.push({
        leg: p.leg, amountMsat: payable, recipient, paid: false,
        error: args.payer ? "kein Lightning-Ziel hinterlegt" : "kein Zahlweg konfiguriert",
      });
      unsettledMsat += payable;
      // Zurück in die Rücklage — der Betrag darf nicht verschwinden.
      acc?.add(`${p.leg}:${recipient}`, payable);
      continue;
    }

    try {
      const res = await args.payer.payToLightningAddress(
        p.target.lud16, payable, `freedomstack ${p.leg} fee`,
      );
      legs.push({
        leg: p.leg, amountMsat: payable, recipient, paid: true,
        preimage: res.preimage, paymentHash: res.paymentHash,
      });
    } catch (e) {
      legs.push({ leg: p.leg, amountMsat: payable, recipient, paid: false, error: (e as Error).message });
      unsettledMsat += payable;
      acc?.add(`${p.leg}:${recipient}`, payable);
    }
  }

  await args.accumulator?.save();

  let proofEventId: string | undefined;
  if (args.publishProof !== false && args.pool) {
    const proofLegs: FeeLegProof[] = [
      {
        leg: "worker",
        // Die Client-Gebuehr geht vom Worker-Anteil ab, nicht von Pool oder
        // Referral: Netz-Anteile duerfen von einer Client-Entscheidung nicht
        // geschmaelert werden.
        amountMsat: split.workerMsat - (args.clientFeeMsat ?? 0),
        recipient: args.providerLud16,
        chain: "lightning",
      },
      ...legs.map((l) => ({
        leg: l.leg,
        amountMsat: l.amountMsat,
        recipient: l.recipient,
        chain: "lightning" as const,
        paymentHash: l.paymentHash,
        preimage: l.preimage,
      })),
    ];
    const unsigned = buildFeeProof({
      resultEventId: args.resultEventId,
      providerPubkey: args.providerKeypair.pk,
      customerPubkey: args.customerPubkey,
      totalMsat: args.totalMsat,
      legs: proofLegs,
      treasuryWeek: weekNumber(),
    });
    const ev = signEvent(unsigned, args.providerKeypair.sk);
    const report = await args.pool.publish(ev);
    if (report.accepted.length > 0) proofEventId = ev.id;
    else console.warn("[settle] Fee-Beweis konnte auf keinem Relay veröffentlicht werden");
  }

  return {
    totalMsat: args.totalMsat,
    workerMsat: split.workerMsat,
    legs,
    unsettledMsat,
    proofEventId,
  };
}

/**
 * Payer auf Basis einer LNURL-Adresse (LUD-16).
 *
 * Holt beim Empfänger eine Rechnung und bezahlt sie über den übergebenen
 * Lightning-Knoten. Der Umweg ist nötig, weil Lightning keine Zahlung an eine
 * Adresse kennt — nur an eine Rechnung.
 */
export class LnurlPayer implements Payer {
  constructor(
    private payInvoice: (bolt11: string) => Promise<{ preimage: string }>,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async payToLightningAddress(
    lud16: string,
    amountMsat: number,
    memo: string,
  ): Promise<{ preimage: string; paymentHash: string }> {
    const [name, domain] = lud16.split("@");
    if (!name || !domain) throw new Error(`ungültige Lightning-Adresse: ${lud16}`);

    const metaRes = await this.fetchImpl(`https://${domain}/.well-known/lnurlp/${name}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!metaRes.ok) throw new Error(`LNURL-Abruf fehlgeschlagen: HTTP ${metaRes.status}`);
    const meta = (await metaRes.json()) as { callback?: string; minSendable?: number; maxSendable?: number };
    if (!meta.callback) throw new Error("LNURL-Antwort ohne callback");

    if (meta.minSendable && amountMsat < meta.minSendable) {
      throw new Error(`Betrag ${amountMsat} msat unter dem Minimum des Empfängers (${meta.minSendable})`);
    }
    if (meta.maxSendable && amountMsat > meta.maxSendable) {
      throw new Error(`Betrag ${amountMsat} msat über dem Maximum des Empfängers (${meta.maxSendable})`);
    }

    const cb = new URL(meta.callback);
    cb.searchParams.set("amount", String(amountMsat));
    cb.searchParams.set("comment", memo.slice(0, 128));
    const invRes = await this.fetchImpl(cb.toString(), { signal: AbortSignal.timeout(10_000) });
    if (!invRes.ok) throw new Error(`Rechnungsabruf fehlgeschlagen: HTTP ${invRes.status}`);
    const inv = (await invRes.json()) as { pr?: string; reason?: string };
    if (!inv.pr) throw new Error(`keine Rechnung erhalten: ${inv.reason ?? "unbekannt"}`);

    const { preimage } = await this.payInvoice(inv.pr);
    const { sha256 } = await import("@noble/hashes/sha2.js");
    const { hexToBytes, bytesToHex } = await import("@noble/hashes/utils.js");
    // Payment-Hash aus dem Preimage ableiten — damit ist der Beweis prüfbar,
    // ohne dem Empfänger glauben zu müssen.
    const paymentHash = preimage ? bytesToHex(sha256(hexToBytes(preimage))) : "";
    return { preimage, paymentHash };
  }
}
