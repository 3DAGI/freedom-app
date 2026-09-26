/**
 * Swap SOL → Lightning in der App (Schritt 4.6c) – ohne DOM.
 *
 * Der Kunde gibt SOL und bekommt sats:
 *   1 Rechnung aus der eigenen Lightning-Wallet (NWC `make_invoice`) – das
 *     Preimage bleibt dort; die App kennt nur den Hash.
 *   2 SOL sperren: Swap-ID `rueckSwapId(Rechnung)`, Empfaenger das SOL-Konto
 *     aus dem Angebot, Betrag `rueckSwapLamports(…)` mit dem Kurs aus dem
 *     Angebot, Frist so lang, dass der LP sein ganzes `cltv_limit` nutzen kann.
 *   3 Erst nach bestaetigter Sperre die Anfrage an den LP (Kind 25001) – von
 *     einem Wegwerf-Schluessel, nicht von der eigenen Identitaet.
 *   4 Antwort lesen: `EINGELOEST` → die sats sind da. Alles andere: die SOL
 *     kommen nach Ablauf der Sperre zurueck (Rueckhol-Waechter).
 *
 * Verlieren kann der Kunde dabei nichts: Zahlt der LP nicht, holt er nach der
 * Frist zurueck; zahlt der LP, kennt er das Preimage erst durch die Zahlung.
 */
import {
  type LpOffer, type UnsignedEvent,
  SLOW_BLOCK_SECS, buildEvent, leseBolt11, rueckSwapId, rueckSwapLamports, validateReverseTimelock,
} from "@freedomstack/protocol";

/** Ephemere Swap-Signale (wie im LP-Daemon). */
export const KIND_RUECK_ANFRAGE = 25001;
export const KIND_RUECK_ANTWORT = 25002;

/** Zeit fuer Bestaetigung der Sperre und Weg der Anfrage zum LP. */
export const RUECK_PUFFER_SECS = 1800;
/** Laenger als eine Woche bleibt kein Geld liegen, falls der LP nicht zahlt. */
export const MAX_RUECK_FRIST_SECS = 7 * 86_400;

export interface RueckPlan {
  sats: number;
  lamports: number;
  swapId: string;
  /** Hash der Rechnung = Hashlock der Sperre. */
  paymentHashHex: string;
  /** Empfaenger der Sperre: das SOL-Konto des LP. */
  lpSol: string;
  timelockUnix: number;
}

/** Ist das ein Angebot, mit dem die App SOL gegen sats tauschen kann? */
export function istRueckAngebot(o: LpOffer): o is LpOffer & { solAddress: string; lamportsPerSat: number } {
  return o.direction === "buy-sol" && !!o.solAddress && !!o.lamportsPerSat;
}

/**
 * Plant den Swap aus Angebot und eigener Rechnung – bevor irgendetwas
 * gesperrt wird. Wirft mit einem Satz fuer den Nutzer, wenn etwas nicht passt.
 */
export function planeRueckSwap(o: LpOffer, bolt11: string, sats: number, jetzt: number): RueckPlan {
  if (!istRueckAngebot(o)) throw new Error("Dieses Angebot tauscht nicht SOL gegen sats.");
  if (o.expiry <= jetzt) throw new Error("Das Angebot ist abgelaufen.");
  if (!Number.isSafeInteger(sats) || sats < o.minSats || sats > o.maxSats) {
    throw new Error(`Der LP tauscht ${o.minSats}–${o.maxSats} sats.`);
  }
  const r = leseBolt11(bolt11);
  if (r.betragMsat !== sats * 1000) throw new Error("Die Rechnung nennt einen anderen Betrag.");
  // Der LP zahlt mit cltv_limit ≤ lnCltvDeltaBlocks; seine Regel verlangt
  // cltv_limit · 20 min + 1 h ≤ Restfrist. Mit Puffer fuer Bestaetigung und Weg.
  const frist = o.lnCltvDeltaBlocks * SLOW_BLOCK_SECS + 3600 + RUECK_PUFFER_SECS;
  const regel = validateReverseTimelock({ tSolSecs: frist - RUECK_PUFFER_SECS, lnCltvLimitBlocks: o.lnCltvDeltaBlocks });
  if (!regel.ok) throw new Error(`Die Fristen des Angebots passen nicht: ${regel.reason}`);
  if (frist > MAX_RUECK_FRIST_SECS) throw new Error("Das Angebot verlangt eine Sperre von mehr als einer Woche.");
  return {
    sats,
    lamports: rueckSwapLamports(sats, o.lamportsPerSat, o.feePpm),
    swapId: rueckSwapId(bolt11),
    paymentHashHex: r.zahlungsHash,
    lpSol: o.solAddress,
    timelockUnix: jetzt + frist,
  };
}

/** Anfrage an den LP (unsigniert; signiert wird mit einem Wegwerf-Schluessel). */
export function baueRueckAnfrage(von: string, lpPubkey: string, offerId: string, bolt11: string, jetzt: number): UnsignedEvent {
  return buildEvent(von, KIND_RUECK_ANFRAGE, [["p", lpPubkey], ["offer", offerId], ["bolt11", bolt11]], "", jetzt);
}

export type RueckStatus = "EINGELOEST" | "GESCHEITERT" | "ZU_SPAET" | "ABGELEHNT";

/** Antwort des LP lesen – nur bekannte Stati, Text gekuerzt (Anzeige nur als Text). */
export function leseRueckAntwort(ev: { tags: string[][]; content: string }): { status: RueckStatus; text: string } | undefined {
  const s = ev.tags.find((t) => t[0] === "status")?.[1];
  if (s !== "EINGELOEST" && s !== "GESCHEITERT" && s !== "ZU_SPAET" && s !== "ABGELEHNT") return undefined;
  return { status: s, text: ev.content.slice(0, 200) };
}

/** Was der Nutzer zum Stand erfaehrt. */
export function rueckText(a: { status: RueckStatus; text: string } | undefined, plan: RueckPlan): string {
  const zurueck = `Deine SOL kommen nach Ablauf der Sperre zurück (ab ${new Date(plan.timelockUnix * 1000).toLocaleString("de-DE")}); ` +
    "solange die App offen ist, holt sie sie selbst zurück.";
  if (!a) return `Gesperrt. Warte auf den LP … ${zurueck.replace("Deine SOL kommen", "Zahlt er nicht, kommen deine SOL")}`;
  if (a.status === "EINGELOEST") return `Fertig: ${plan.sats} sats sind in deiner Lightning-Wallet.`;
  // Der LP hat gezahlt, aber die SOL nicht mehr vor der Frist eingeloest: Nach
  // den Regeln der Sperre gehen sie an den zurueck, der gesperrt hat.
  if (a.status === "ZU_SPAET") return `Der LP hat deine Rechnung bezahlt (${plan.sats} sats), die SOL aber nicht rechtzeitig eingelöst. ${zurueck}`;
  const warum = a.status === "ABGELEHNT" ? `abgelehnt: ${a.text}` : "Zahlung gescheitert";
  return `Der LP hat nicht getauscht (${warum}). ${zurueck}`;
}
