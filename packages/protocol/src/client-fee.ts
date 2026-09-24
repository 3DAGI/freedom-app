/**
 * Client-Gebühr: die Fee, die eine Anwendung für sich selbst nimmt.
 *
 * WARUM ES DIESE SCHICHT GIBT
 * Vorher lag der Entwickler-Anteil im Protokoll: 50 % der Fee gingen an eine
 * feste Adresse, die kein Provider ändern konnte. Damit führte jeder, der die
 * Software betrieb, automatisch an eine identifizierbare Partei ab — die
 * Definition eines Intermediärs. Und solange eine Fee nicht entfernt werden
 * KANN, gibt es einen Betreiber, egal was in der README steht.
 *
 * Jetzt deklariert der CLIENT seine Gebühr selbst, im Job-Event, sichtbar für
 * jeden. Drei Folgen:
 *
 * 1. Das Protokoll hat keinen privilegierten Empfänger mehr. Ein Fork, der
 *    diese Zeile weglässt, funktioniert vollständig — und genau diese
 *    Entfernbarkeit ist der einzige belastbare Beweis, dass niemand das
 *    Protokoll kontrolliert.
 * 2. Der Nutzer sieht, wofür er zahlt. Eine sichtbare Gebühr, die man umgehen
 *    kann, ist etwas anderes als eine unvermeidbare Protokollsteuer.
 * 3. Rechtlich ist es ein Entgelt für eine Leistung (die App), nicht die
 *    Abschöpfung aus einem Zahlungsnetz.
 *
 * Für den Nutzer ändert sich der Gesamtbetrag nicht. Nur die Frage, an wen und
 * wofür — und dass er die Antwort jetzt sehen kann.
 *
 * GRENZEN, DIE DER PROVIDER DURCHSETZT
 * Ein Client könnte 90 % für sich deklarieren. Deshalb ist die Gebühr
 * gedeckelt: Provider lehnen alles darüber ab. Ohne diese Grenze wäre die
 * Freiheit des Clients ein Werkzeug gegen den Nutzer.
 */

/** Obergrenze, die Provider akzeptieren. Alles darüber wird abgelehnt. */
export const MAX_CLIENT_FEE_PERCENT = 10;

/** Voreinstellung der Referenz-App. Jeder Client darf einen eigenen Wert wählen. */
export const DEFAULT_CLIENT_FEE_PERCENT = 2.5;

export interface ClientFee {
  /** Empfänger: Lightning-Adresse (lud16) oder Solana-Adresse. */
  recipient: string;
  /** Anteil in ppm der Job-Zahlung. */
  ppm: number;
  /** Name des Clients — steht in der Anzeige, damit der Nutzer weiß, wer nimmt. */
  clientName: string;
}

export function clientFeePpm(percent: number): number {
  return Math.round(percent * 10_000);
}

/**
 * Tag für das Job-Event.
 *
 * Bewusst im Klartext und nicht versteckt: Eine Gebühr, die man erst finden
 * muss, ist keine offene Gebühr.
 */
export function clientFeeTag(fee: ClientFee): string[] {
  return ["client_fee", fee.recipient, String(fee.ppm), fee.clientName];
}

export function parseClientFee(tags: string[][]): ClientFee | null {
  const t = tags.find((x) => x[0] === "client_fee");
  if (!t || t.length < 3) return null;
  const ppm = Number(t[2]);
  if (!Number.isFinite(ppm) || ppm <= 0) return null;
  return { recipient: t[1], ppm, clientName: t[3] ?? "unbekannt" };
}

export interface ClientFeeVerdict {
  accepted: boolean;
  ppm: number;
  reason: string;
}

/**
 * Prüft eine deklarierte Client-Gebühr.
 *
 * Der Provider entscheidet — nicht der Client. Sonst könnte eine
 * manipulierte App den Nutzer ausnehmen, und die Offenheit der Schicht wäre
 * ein Nachteil statt eines Vorteils.
 */
export function checkClientFee(
  fee: ClientFee | null,
  maxPercent = MAX_CLIENT_FEE_PERCENT,
): ClientFeeVerdict {
  if (!fee) return { accepted: true, ppm: 0, reason: "Keine Client-Gebühr deklariert." };

  const maxPpm = clientFeePpm(maxPercent);
  if (fee.ppm > maxPpm) {
    return {
      accepted: false,
      ppm: 0,
      reason:
        `Client-Gebühr ${(fee.ppm / 10_000).toFixed(2)} % übersteigt die Obergrenze ` +
        `von ${maxPercent} %. Der Job wird abgelehnt.`,
    };
  }
  if (!fee.recipient || fee.recipient.length < 3) {
    return { accepted: false, ppm: 0, reason: "Client-Gebühr ohne brauchbaren Empfänger." };
  }
  return {
    accepted: true,
    ppm: fee.ppm,
    reason: `${(fee.ppm / 10_000).toFixed(2)} % an ${fee.clientName}.`,
  };
}

export interface FullSplit {
  /** Was beim Provider bleibt. */
  workerMsat: number;
  poolMsat: number;
  referralMsat: number;
  clientMsat: number;
  /** Gesamtabzug in Prozent — die Zahl, die den Nutzer interessiert. */
  totalFeePercent: number;
}

/**
 * Rechnet die vollständige Aufteilung einer Zahlung.
 *
 * Reihenfolge: erst die Protokollfee (Netz), dann die Client-Gebühr. Beide vom
 * Bruttobetrag, damit die Client-Gebühr die Netz-Anteile nicht schmälern kann.
 */
export function splitWithClientFee(
  amountMsat: number,
  protocolSplit: { poolMsat: number; referralMsat: number; workerMsat: number },
  clientPpm: number,
): FullSplit {
  const clientMsat = Math.floor((amountMsat * Math.max(0, clientPpm)) / 1_000_000);
  const workerMsat = protocolSplit.workerMsat - clientMsat;
  const gesamt = amountMsat - workerMsat;
  return {
    workerMsat,
    poolMsat: protocolSplit.poolMsat,
    referralMsat: protocolSplit.referralMsat,
    clientMsat,
    totalFeePercent: amountMsat > 0 ? (gesamt / amountMsat) * 100 : 0,
  };
}

/**
 * Text für die Oberfläche.
 *
 * Ein Nutzer soll den Satz lesen und verstanden haben, wohin sein Geld geht —
 * ohne Dokumentation und ohne Nachrechnen.
 */
export function explainFees(split: FullSplit, clientName: string): string {
  const sats = (msat: number): string => (msat / 1000).toFixed(msat < 10_000 ? 2 : 0);
  return (
    `${sats(split.workerMsat)} sats an den Provider, ` +
    `${sats(split.poolMsat)} in den Reward-Pool, ` +
    `${sats(split.referralMsat)} an Werber` +
    (split.clientMsat > 0 ? `, ${sats(split.clientMsat)} an ${clientName}` : "") +
    ` (${split.totalFeePercent.toFixed(1)} % gesamt).`
  );
}
