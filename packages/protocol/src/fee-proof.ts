/**
 * Fee-Beweis: die 5%-Aufteilung öffentlich nachprüfbar machen.
 *
 * WARUM
 * "Non-custodial, an der Quelle gesplittet" ist bisher eine Behauptung in der
 * README. Ein Nutzer kann sie nicht prüfen — und ein Protokoll, dessen
 * zentrales Versprechen man glauben muss, hat gegenüber einem zentralen
 * Anbieter kein Argument. Dieses Modul macht aus der Behauptung einen Knopf:
 * "diese Zahlung prüfen" zeigt Beträge, Empfänger und Zahlungsbeweise.
 *
 * WAS BEWIESEN WIRD — und was nicht
 *   ✓ Der Provider hat einen Split mit diesen Beträgen ANGEKÜNDIGT (signiert).
 *   ✓ Die Beträge stimmen rechnerisch mit dem Protokoll-Fee überein.
 *   ✓ Die Summe der Teile ergibt exakt die Zahlung (kein Rest verschwindet).
 *   ✓ Der Dev-Anteil geht an die Wochen-Adresse, die das signierte
 *     Treasury-Announcement (kind 38050) für diese Woche nennt.
 *   ✓ Lightning (seit 4.8): Die beigelegte Rechnung ist vom Knoten des
 *     Empfaengers signiert, nennt den angekuendigten Betrag, und das Preimage
 *     passt zu ihrem Payment-Hash. „Belegt“ nur, wenn der Empfaenger als
 *     Knoten angekuendigt ist – eine Lightning-Adresse kann bei einem
 *     Verwahrdienst liegen, dessen Knoten sich viele teilen.
 *   ✓ Solana (seit 4.8): Die Transaktion auf der Kette ueberweist mindestens
 *     die angekuendigten Lamports an den angekuendigten Empfaenger
 *     (`verifyFeeProofMitKette`).
 *
 *   ✗ NICHT bewiesen wird, dass eine Lightning-Zahlung wirklich ankam, wenn
 *     kein Preimage vorliegt. Lightning hat kein öffentliches Ledger — das ist
 *     der Preis für die Privatsphäre. Ohne Preimage bleibt der Status
 *     "angekündigt", und genau so wird er auch angezeigt. Ein Beweis, der
 *     seine eigenen Grenzen verschweigt, ist kein Beweis.
 */
import { UnsignedEvent, NostrEvent, buildEvent, getTag, verifyEvent } from "./event.js";
import { splitFeeV1, PROTOCOL_FEE_PPM, PROTOCOL_FEE_PERCENT } from "./protocol-fee.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { leseBolt11 } from "./bolt11.js";
import { pruefeSolUeberweisung } from "./sol-trinkgeld.js";

/** Kind für den Fee-Beweis (adressierbarer Bereich). */
export const KIND_FEE_PROOF = 38051;

/**
 * Empfaenger einer Teilzahlung.
 *
 * "dev" heisst jetzt "client": Der Anteil geht nicht mehr an eine im Protokoll
 * verankerte Adresse, sondern an den Client, der den Job erstellt hat — und
 * der ihn im Job-Event offen deklariert.
 */
export type FeeLeg = "worker" | "client" | "pool" | "referral";

export interface FeeLegProof {
  leg: FeeLeg;
  amountMsat: number;
  /** lud16, SOL-Adresse oder pubkey — je nach Kanal. */
  recipient: string;
  chain: "lightning" | "solana";
  /** Lightning: payment_hash (hex). Solana: leer. */
  paymentHash?: string;
  /** Lightning: preimage (hex) = Zahlungsbeweis. Solana: leer. */
  preimage?: string;
  /** Solana: Transaktionssignatur (base58) = im Explorer nachschlagbar. */
  txSignature?: string;
  /** Lightning: die bezahlte Rechnung – belegt Empfaengerknoten und Betrag (4.8). */
  bolt11?: string;
  /** Solana: ueberwiesene Lamports – geprueft gegen die Kette (4.8). */
  lamports?: number;
}

export interface FeeProof {
  /** Das Job-Result (kind 6050), auf das sich die Zahlung bezieht. */
  resultEventId: string;
  providerPubkey: string;
  customerPubkey: string;
  /** Gesamtbetrag der Zahlung in msat (vor Split). */
  totalMsat: number;
  legs: FeeLegProof[];
  /** Treasury-Woche, deren Announcement für den dev-leg gilt. */
  treasuryWeek?: number;
}

export function buildFeeProof(p: FeeProof, createdAt?: number): UnsignedEvent {
  const tags: string[][] = [
    ["d", `feeproof:${p.resultEventId}`],
    ["e", p.resultEventId],
    ["p", p.customerPubkey],
    ["total_msat", String(p.totalMsat)],
    ["fee_ppm", String(PROTOCOL_FEE_PPM)],
  ];
  if (p.treasuryWeek !== undefined) tags.push(["treasury_week", String(p.treasuryWeek)]);
  for (const l of p.legs) {
    tags.push([
      "leg",
      l.leg,
      String(l.amountMsat),
      l.recipient,
      l.chain,
      l.paymentHash ?? "",
      l.preimage ?? "",
      l.txSignature ?? "",
      l.bolt11 ?? "",
      l.lamports !== undefined ? String(l.lamports) : "",
    ]);
  }
  return buildEvent(p.providerPubkey, KIND_FEE_PROOF, tags, "", createdAt);
}

export function parseFeeProof(ev: UnsignedEvent): FeeProof {
  if (ev.kind !== KIND_FEE_PROOF) throw new Error(`kein fee-proof: kind ${ev.kind}`);
  const resultEventId = getTag(ev, "e");
  const customerPubkey = getTag(ev, "p");
  const totalMsat = Number(getTag(ev, "total_msat") ?? "NaN");
  if (!resultEventId || !customerPubkey || Number.isNaN(totalMsat)) {
    throw new Error("fee-proof ohne e/p/total_msat");
  }
  const week = getTag(ev, "treasury_week");
  const legs: FeeLegProof[] = ev.tags
    .filter((t) => t[0] === "leg" && t.length >= 5)
    .map((t) => ({
      leg: t[1] as FeeLeg,
      amountMsat: Number(t[2]),
      recipient: t[3],
      chain: t[4] === "solana" ? "solana" : "lightning",
      paymentHash: t[5] || undefined,
      preimage: t[6] || undefined,
      txSignature: t[7] || undefined,
      bolt11: t[8] || undefined,
      lamports: /^\d{1,16}$/.test(t[9] ?? "") ? Number(t[9]) : undefined,
    }));
  return {
    resultEventId,
    providerPubkey: ev.pubkey,
    customerPubkey,
    totalMsat,
    legs,
    treasuryWeek: week ? Number(week) : undefined,
  };
}

export type LegStatus = "settled" | "announced" | "invalid";

export interface LegVerdict {
  leg: FeeLeg;
  amountMsat: number;
  expectedMsat: number;
  recipient: string;
  status: LegStatus;
  /** Klartext für die UI — auch im Fehlerfall verständlich. */
  detail: string;
}

export interface FeeProofVerdict {
  ok: boolean;
  /** Signatur des Beweis-Events gültig? */
  signatureValid: boolean;
  /** Ergeben die Teile exakt die Gesamtzahlung? */
  sumsMatch: boolean;
  /** Stimmen die Beträge mit dem Protokoll-Fee überein? */
  amountsMatch: boolean;
  /** Geht der Dev-Anteil an die angekündigte Wochen-Adresse? */
  treasuryMatches: boolean | null;
  legs: LegVerdict[];
  /** Was ein Nutzer daraus lesen soll. */
  summary: string;
}

export interface VerifyOptions {
  /**
   * Die für treasuryWeek signiert angekündigte Empfangsadresse (aus kind 38050).
   * Fehlt sie, bleibt treasuryMatches null — "nicht prüfbar", nicht "falsch".
   */
  announcedTreasuryAddress?: string;
  /**
   * Vom Client deklarierte Gebuehr in msat.
   *
   * Muss der Pruefer kennen, weil sie nicht aus dem Protokoll folgt — sie
   * steht im Job-Event des Clients.
   */
  clientFeeMsat?: number;
}

/** Prüft, ob ein Preimage zum Payment-Hash passt (Lightning-Zahlungsbeweis). */
export function preimageMatches(preimageHex: string, paymentHashHex: string): boolean {
  try {
    return bytesToHex(sha256(hexToBytes(preimageHex))) === paymentHashHex.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Prüft einen Fee-Beweis vollständig.
 *
 * Nimmt das rohe Event, damit die Signatur mitgeprüft wird — ein Beweis, den
 * man ohne Signaturprüfung akzeptiert, kann jeder fälschen.
 */
export function verifyFeeProof(ev: NostrEvent, opts: VerifyOptions = {}): FeeProofVerdict {
  const signatureValid = verifyEvent(ev);
  const proof = parseFeeProof(ev);
  const expected = splitFeeV1(proof.totalMsat);

  // Die Client-Gebuehr steht NICHT in der Protokollrechnung — sie wird vom
  // Client deklariert. Geprueft wird deshalb ihr angekuendigter Betrag gegen
  // die Obergrenze, nicht gegen eine feste Protokollkonstante.
  const expectedFor: Record<FeeLeg, number> = {
    worker: expected.workerMsat - (opts.clientFeeMsat ?? 0),
    client: opts.clientFeeMsat ?? 0,
    pool: expected.poolMsat,
    referral: expected.referralMsat,
  };

  const legs: LegVerdict[] = proof.legs.map((l) => {
    const exp = expectedFor[l.leg] ?? 0;
    let status: LegStatus;
    let detail: string;

    if (l.amountMsat !== exp) {
      status = "invalid";
      detail = `Betrag weicht ab: angekündigt ${l.amountMsat} msat, nach Protokoll ${exp} msat.`;
    } else if (l.chain === "solana") {
      // Belegt erst nach dem Blick auf die Kette (verifyFeeProofMitKette).
      status = "announced";
      detail = l.txSignature
        ? `Transaktion ${l.txSignature.slice(0, 12)}… angegeben – belegt erst, wenn die Kette Empfänger und Betrag zeigt.`
        : "Angekündigt, aber keine Transaktionssignatur beigelegt — nicht nachprüfbar.";
    } else {
      ({ status, detail } = pruefeLightningLeg(l));
    }
    return { leg: l.leg, amountMsat: l.amountMsat, expectedMsat: exp, recipient: l.recipient, status, detail };
  });

  const sum = proof.legs.reduce((s, l) => s + l.amountMsat, 0);
  const sumsMatch = sum === proof.totalMsat;
  const amountsMatch = legs.every((l) => l.amountMsat === l.expectedMsat);

  // Fehlen legs komplett, ist "alle vorhandenen stimmen" wertlos.
  const present = new Set(proof.legs.map((l) => l.leg));
  // "client" ist optional: Ein Job ohne Client-Gebuehr ist vollstaendig gueltig.
  const complete = (["worker", "pool", "referral"] as FeeLeg[]).every((l) => present.has(l));

  const devLeg = proof.legs.find((l) => l.leg === "client");
  const treasuryMatches =
    opts.announcedTreasuryAddress === undefined || !devLeg
      ? null
      : devLeg.recipient === opts.announcedTreasuryAddress;

  const settled = legs.filter((l) => l.status === "settled").length;
  const invalid = legs.filter((l) => l.status === "invalid").length;

  const ok =
    signatureValid && sumsMatch && amountsMatch && complete && invalid === 0 && treasuryMatches !== false;

  let summary: string;
  if (!signatureValid) {
    summary = "Signatur ungültig — dieser Beweis stammt nicht vom angegebenen Provider.";
  } else if (!complete) {
    summary = `Unvollständig: es fehlen Angaben zu ${(["worker", "pool", "referral"] as FeeLeg[])
      .filter((l) => !present.has(l))
      .join(", ")}.`;
  } else if (invalid > 0) {
    summary = `${invalid} von ${legs.length} Teilzahlungen sind fehlerhaft — Beträge oder Beweise stimmen nicht.`;
  } else if (!sumsMatch) {
    summary = `Die Teile ergeben ${sum} msat, die Zahlung war ${proof.totalMsat} msat. Differenz: ${proof.totalMsat - sum} msat.`;
  } else if (treasuryMatches === false) {
    summary = "Der Development-Anteil geht an eine andere Adresse als die signiert angekündigte.";
  } else {
    summary =
      `Aufteilung korrekt (${PROTOCOL_FEE_PERCENT} % Protokollfee): ${settled} von ${legs.length} ` +
      `Teilzahlungen sind belegt, ${legs.length - settled} nur angekündigt.`;
  }

  return { ok, signatureValid, sumsMatch, amountsMatch, treasuryMatches, legs, summary };
}

const KNOTEN = /^0[23][0-9a-f]{64}$/;

/**
 * Lightning-Teilzahlung (4.8): Preimage, Rechnung, Empfaengerknoten, Betrag.
 * Ohne Rechnung belegt ein Preimage nicht, an wen gezahlt wurde.
 */
function pruefeLightningLeg(l: FeeLegProof): { status: LegStatus; detail: string } {
  if (!l.preimage) {
    return { status: "announced", detail: "Lightning ohne Preimage: angekündigt, nicht bewiesen. Lightning hat kein " +
      "öffentliches Ledger — ohne Preimage ist der Empfang nicht belegbar." };
  }
  if (!l.bolt11) {
    if (l.paymentHash && !preimageMatches(l.preimage, l.paymentHash)) {
      return { status: "invalid", detail: "Preimage passt NICHT zum Payment-Hash — der Beweis ist ungültig." };
    }
    return { status: "announced", detail: "Preimage ohne Rechnung: Eine Zahlung ist belegt, aber nicht, an wen – dafür fehlt die Rechnung." };
  }
  let r: ReturnType<typeof leseBolt11>;
  try {
    r = leseBolt11(l.bolt11);
  } catch (e) {
    return { status: "invalid", detail: `Rechnung ungültig: ${(e as Error).message}.` };
  }
  if (l.paymentHash && l.paymentHash.toLowerCase() !== r.zahlungsHash) {
    return { status: "invalid", detail: "Payment-Hash im Beleg passt nicht zur Rechnung." };
  }
  if (!preimageMatches(l.preimage, r.zahlungsHash)) {
    return { status: "invalid", detail: "Preimage passt NICHT zur Rechnung — der Beweis ist ungültig." };
  }
  if (r.betragMsat !== null && r.betragMsat !== l.amountMsat) {
    return { status: "invalid", detail: `Die Rechnung lautet auf ${r.betragMsat} msat, angekündigt sind ${l.amountMsat} msat.` };
  }
  const knoten = `${r.empfaengerKnoten.slice(0, 8)}…${r.empfaengerKnoten.slice(-4)}`;
  if (KNOTEN.test(l.recipient)) {
    return l.recipient === r.empfaengerKnoten
      ? r.betragMsat === null
        ? { status: "announced", detail: `Gezahlt an den angekündigten Knoten ${knoten}, aber die Rechnung nennt keinen Betrag.` }
        : { status: "settled", detail: `Belegt: Rechnung vom angekündigten Knoten ${knoten}, Betrag stimmt, Preimage passt.` }
      : { status: "invalid", detail: `Die Rechnung stammt von Knoten ${knoten}, nicht vom angekündigten Empfänger.` };
  }
  return { status: "announced", detail: `Zahlung an Knoten ${knoten} belegt. Der Empfänger ist eine Lightning-Adresse ohne Knotenangabe – ` +
    "bei Verwahrdiensten teilen sich viele einen Knoten, deshalb nur angekündigt." };
}

/**
 * Wie verifyFeeProof, prueft aber zusaetzlich Solana-Teilzahlungen gegen die
 * Kette (4.8): Die Transaktion muss mindestens die angekuendigten Lamports an
 * den angekuendigten Empfaenger ueberweisen.
 */
export async function verifyFeeProofMitKette(
  ev: NostrEvent,
  opts: VerifyOptions,
  ladeTransaktion: (signatur: string) => Promise<unknown>,
): Promise<FeeProofVerdict> {
  const v = verifyFeeProof(ev, opts);
  const proof = parseFeeProof(ev);
  const legs = await Promise.all(v.legs.map(async (lv, i) => {
    const l = proof.legs[i];
    if (l.chain !== "solana" || !l.txSignature || lv.status === "invalid") return lv;
    if (!l.lamports) return { ...lv, detail: "Solana-Teilzahlung ohne Lamport-Betrag – gegen die Kette nicht prüfbar." };
    let tx: unknown;
    try {
      tx = await ladeTransaktion(l.txSignature);
    } catch (e) {
      return { ...lv, detail: `Kette nicht erreichbar (${(e as Error).name}) – noch nicht belegt.` };
    }
    const p = pruefeSolUeberweisung(tx, { an: l.recipient, lamports: l.lamports });
    return p.status === "belegt"
      ? { ...lv, status: "settled" as const, detail: `Belegt: Die Kette zeigt ${l.lamports} Lamports an den angekündigten Empfänger.` }
      : p.status === "falsch"
        ? { ...lv, status: "invalid" as const, detail: `Auf der Kette: ${p.grund}.` }
        : { ...lv, detail: `${p.grund} – noch nicht belegt.` };
  }));
  const invalid = legs.filter((l) => l.status === "invalid").length;
  const settled = legs.filter((l) => l.status === "settled").length;
  if (v.ok && invalid > 0) {
    return { ...v, legs, ok: false, summary: `${invalid} von ${legs.length} Teilzahlungen sind fehlerhaft — Beträge oder Beweise stimmen nicht.` };
  }
  return {
    ...v,
    legs,
    summary: v.ok
      ? `Aufteilung korrekt (${PROTOCOL_FEE_PERCENT} % Protokollfee): ${settled} von ${legs.length} Teilzahlungen sind belegt, ${legs.length - settled} nur angekündigt.`
      : v.summary,
  };
}

/** Hilfe für Provider: Legs aus einem Betrag erzeugen, ohne selbst zu rechnen. */
export function feeLegsFor(
  totalMsat: number,
  recipients: { worker: string; dev: string; pool: string; referral: string },
  chain: "lightning" | "solana" = "lightning",
  clientFeeMsat?: number,
): FeeLegProof[] {
  const s = splitFeeV1(totalMsat);
  return [
    { leg: "worker", amountMsat: s.workerMsat - (clientFeeMsat ?? 0), recipient: recipients.worker, chain },
    ...(clientFeeMsat && clientFeeMsat > 0
      ? [{ leg: "client" as const, amountMsat: clientFeeMsat, recipient: recipients.dev, chain }]
      : []),
    { leg: "pool", amountMsat: s.poolMsat, recipient: recipients.pool, chain },
    { leg: "referral", amountMsat: s.referralMsat, recipient: recipients.referral, chain },
  ];
}
