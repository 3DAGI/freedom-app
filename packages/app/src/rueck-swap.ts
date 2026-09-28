/**
 * Swap SOL → Lightning in der App (Schritt 4.6c) – ohne DOM.
 *
 * Der Kunde gibt SOL und bekommt sats:
 *   1 Rechnung aus der eigenen Lightning-Wallet (NWC `make_invoice`) – das
 *     Preimage bleibt dort; die App kennt nur den Hash.
 *   2 SOL sperren: Swap-ID `rueckSwapId(Rechnung)`, Empfaenger das SOL-Konto
 *     aus dem Angebot, Betrag `rueckSwapLamports(…)` mit dem Kurs aus dem
 *     Angebot, Frist so lang, dass der LP sein ganzes `cltv_limit` nutzen kann.
 *   3 Erst nach bestaetigter Sperre die Anfrage an den LP (Kind 25001) –
 *     versiegelt von einem Wegwerf-Schluessel (`rueckAnfrage()` in
 *     `swap-umschlag.ts`, seit 4.9b), nicht von der eigenen Identitaet.
 *   4 Antwort lesen: `EINGELOEST` → die sats sind da. Alles andere: die SOL
 *     kommen nach Ablauf der Sperre zurueck (Rueckhol-Waechter).
 *
 * Verlieren kann der Kunde dabei nichts: Zahlt der LP nicht, holt er nach der
 * Frist zurueck; zahlt der LP, kennt er das Preimage erst durch die Zahlung.
 */
import {
  type LpOffer,
  SLOW_BLOCK_SECS, leseBolt11, rueckSwapId, rueckSwapLamports, validateReverseTimelock,
} from "@freedomstack/protocol";
import { gebietsschema, t } from "./i18n.js";
import { fristGrund } from "./protokoll-texte.js";

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
  if (!istRueckAngebot(o)) throw new Error(t("zahl.keinRueckAngebot"));
  if (o.expiry <= jetzt) throw new Error(t("zahl.angebotAbgelaufen"));
  if (!Number.isSafeInteger(sats) || sats < o.minSats || sats > o.maxSats) {
    throw new Error(t("zahl.lpTauscht", { min: o.minSats, max: o.maxSats }));
  }
  const r = leseBolt11(bolt11);
  if (r.betragMsat !== sats * 1000) throw new Error(t("zahl.rechnungAndererBetrag"));
  // Der LP zahlt mit cltv_limit ≤ lnCltvDeltaBlocks; seine Regel verlangt
  // cltv_limit · 20 min + 1 h ≤ Restfrist. Mit Puffer fuer Bestaetigung und Weg.
  const frist = o.lnCltvDeltaBlocks * SLOW_BLOCK_SECS + 3600 + RUECK_PUFFER_SECS;
  const regel = validateReverseTimelock({ tSolSecs: frist - RUECK_PUFFER_SECS, lnCltvLimitBlocks: o.lnCltvDeltaBlocks });
  if (!regel.ok) throw new Error(t("zahl.fristenPassenNicht", { grund: fristGrund(regel) }));
  if (frist > MAX_RUECK_FRIST_SECS) throw new Error(t("zahl.sperreUeberWoche"));
  return {
    sats,
    lamports: rueckSwapLamports(sats, o.lamportsPerSat, o.feePpm),
    swapId: rueckSwapId(bolt11),
    paymentHashHex: r.zahlungsHash,
    lpSol: o.solAddress,
    timelockUnix: jetzt + frist,
  };
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
  const ab = new Date(plan.timelockUnix * 1000).toLocaleString(gebietsschema());
  const zurueck = t("zahl.solKommenZurueck", { ab });
  if (!a) return t("zahl.gesperrtWarte", { ab });
  if (a.status === "EINGELOEST") return t("zahl.rueckFertig", { sats: plan.sats });
  // Der LP hat gezahlt, aber die SOL nicht mehr vor der Frist eingeloest: Nach
  // den Regeln der Sperre gehen sie an den zurueck, der gesperrt hat.
  if (a.status === "ZU_SPAET") return t("zahl.rueckZuSpaet", { sats: plan.sats, zurueck });
  const warum = a.status === "ABGELEHNT" ? t("zahl.rueckAbgelehnt", { text: a.text }) : t("zahl.rueckGescheitert");
  return t("zahl.rueckNichtGetauscht", { warum, zurueck });
}
