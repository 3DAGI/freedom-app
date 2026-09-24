/**
 * Protokoll-Fee (einzige Stelle, an der die Fee definiert wird).
 *
 * FREEDOM PROTOCOL v1 — DIESE WERTE SIND PROTOKOLL-INVARIANTEN.
 * Nach Launch nicht mehr ändern: Provider, Clients und die Öffentlichkeit
 * vertrauen darauf, dass die Fee im Code fix ist. Keine env-vars, kein
 * Admin-Endpoint, keine Konfiguration. Fix im Code = fix fürs Protokoll.
 *
 * ACHTUNG — HIER LAG EIN FAKTOR-10-FEHLER (behoben):
 * Die frühere Fassung schrieb "5% (5.000 ppm)". 5.000 ppm sind aber 0,5%,
 * nicht 5%. Sämtliche Prozent-Angaben im alten Kommentar waren um Faktor 10
 * zu hoch, während README ("1%") und der Node-Test ("10.000 ppm") noch zwei
 * weitere Werte behaupteten. Damit sich das nicht wiederholen kann, gibt es
 * ab jetzt EINE Quelle — PROTOCOL_FEE_PERCENT — aus der alles abgeleitet wird.
 *
 * Aufteilung der Fee (Anteile AN DER FEE, nicht an der Zahlung):
 *   50% Development — Treasury (rotierende Wochen-Adressen, siehe treasury.ts)
 *   40% Reward-Pool — Season-Distribution an Provider
 *   10% Referral-Pool — Werber-Vergütung
 *
 * Rechtliches Design:
 * - Fee wird AN DER QUELLE aufgeteilt (Lightning-Split / Multi-Output).
 *   Sie fließt nie durch ein vom Gründer kontrolliertes Zwischen-Wallet
 *   -> non-custodial.
 * - Lightning by design privat (kein öffentliches Ledger). SOL-Auszahlungen
 *   laufen über rotierende Wochen-Adressen ohne Bezug zur Person.
 * - Transparent und dokumentiert: Eine offene Protokollfee ist dieselbe
 *   Kategorie wie Uniswap-/OpenSea-Fees; 50% davon fließen ins Netz zurück.
 */

/**
 * DIE EINE STELLSCHRAUBE. Protokollfee in Prozent der Job-Zahlung.
 *
 * WICHTIGE ÄNDERUNG — DER DEV-ANTEIL IST HIER RAUS.
 *
 * Vorher waren es 5 % mit 50 % davon an eine feste Development-Adresse. Damit
 * führte jeder Provider, der diese Software fährt, automatisch an eine Partei
 * ab, die er nicht ändern kann. Das ist die Definition eines Intermediärs —
 * und solange eine Fee nicht entfernt werden KANN, gibt es einen Betreiber.
 *
 * Die Protokollfee finanziert jetzt ausschließlich das Netz selbst:
 * Reward-Pool und Referral. Sie hat keinen privilegierten Empfänger mehr.
 *
 * Der Entwickler-Anteil ist in die CLIENT-Schicht gewandert (client-fee.ts):
 * sichtbar, vom Nutzer nachvollziehbar, und von einem Fork entfernbar. Genau
 * diese Entfernbarkeit ist der Beweis, dass niemand das Protokoll kontrolliert.
 * Für den Nutzer ändert sich der Gesamtbetrag nicht — nur, wofür er zahlt.
 *
 * Beim Setzen die Größenordnung prüfen: 0,5 entspricht 5.000 ppm,
 * 2,5 entspricht 25.000 ppm, 5 entspricht 50.000 ppm.
 */
export const PROTOCOL_FEE_PERCENT = 2.5;

/** Gesamt-Fee in parts-per-million — abgeleitet, nie separat setzen. */
export const PROTOCOL_FEE_PPM = Math.round(PROTOCOL_FEE_PERCENT * 10_000);

/**
 * Anteile AN DER PROTOKOLLFEE in Prozent. Summe muss exakt 100 ergeben.
 *
 * 80/20 ergibt bei 2,5 % exakt dieselben absoluten Beträge wie vorher
 * (2,0 % Pool, 0,5 % Referral) — für Provider und Werber ändert sich nichts.
 */
export const FEE_POOL_SHARE_PERCENT = 80;
export const FEE_REFERRAL_SHARE_PERCENT = 20;

/** Anteile in ppm der GESAMTEN Zahlung — abgeleitet. */
export const FEE_POOL_PPM = Math.round((PROTOCOL_FEE_PPM * FEE_POOL_SHARE_PERCENT) / 100);
export const FEE_REFERRAL_PPM = PROTOCOL_FEE_PPM - FEE_POOL_PPM;

/** Pool-Anteil in Prozent DER FEE (von computeFeeSplit genutzt). */
export const PROTOCOL_POOL_SHARE_PERCENT = FEE_POOL_SHARE_PERCENT;

// Selbstprüfung beim Import: fängt widersprüchliche Werte sofort ab, statt
// sie still in Auszahlungen durchzureichen.
if (FEE_POOL_SHARE_PERCENT + FEE_REFERRAL_SHARE_PERCENT !== 100) {
  throw new Error("protocol-fee: Fee-Anteile ergeben nicht 100%");
}
if (PROTOCOL_FEE_PPM <= 0 || PROTOCOL_FEE_PPM > 100_000) {
  throw new Error(`protocol-fee: PROTOCOL_FEE_PPM=${PROTOCOL_FEE_PPM} unplausibel (>10%?)`);
}

/**
 * ENTFERNT: TREASURY_SOL_PUBKEY.
 *
 * Hier stand eine im Protokoll verankerte Development-Adresse. Sie wird nicht
 * mehr gebraucht, seit der Entwickler-Anteil in die Client-Schicht gewandert
 * ist — und eine ungenutzte Verankerung ist schlimmer als keine: Sie stellt
 * genau die Angriffsflaeche wieder her, die die Umschichtung beseitigt hat.
 * Wer eine Empfaengeradresse braucht, deklariert sie im Client (client-fee.ts).
 */

/**
 * Treasury-Nostr-Key (pubkey): Signiert die wöchentlichen Payout-Announcements
 * (kind 38050). Der zugehörige Secret Key liegt NUR auf dem Treasury-Node.
 */
export const TREASURY_NOSTR_PUBKEY =
  process.env.TREASURY_NOSTR_PUBKEY ?? "9a7cb46eda84d6b16c1764fecfc9a7120238cf9ca0ab28685ec227501bf2724a";

/**
 * Legacy: lud16 für reine Lightning-Fee-Splits (kleine Beträge, wo ein
 * Multi-Output-Split unpraktisch ist). Zeigt auf den Treasury-LNURL-Endpunkt,
 * der intern auf die aktuelle Wochen-Adresse mappt.
 */
export const PROTOCOL_FEE_RECIPIENT_LUD16 =
  process.env.PROTOCOL_FEE_LUD16 ?? "SET_BEFORE_MAINNET@walletofsatoshi.com";

export function assertProtocolFeeConfigured(): void {
  if (PROTOCOL_FEE_RECIPIENT_LUD16.startsWith("SET_BEFORE_MAINNET")) {
    throw new Error(
      "PROTOCOL_FEE_LUD16 nicht gesetzt. Vor Mainnet-Betrieb konfigurieren " +
        "(einmalig — danach unveränderbar, siehe PROTOCOL.md v1).",
    );
  }
}

/**
 * Fee-Split nach Protokoll v2 (Fee-Anteile: 80 pool / 20 referral).
 *
 * `devMsat` gibt es nicht mehr — der Entwickler-Anteil ist in die Client-
 * Schicht gewandert. Wer ihn sucht: client-fee.ts.
 */
export interface ProtocolFeeSplit {
  /** Reward-Pool in msat. */
  poolMsat: number;
  /** Referral-Pool in msat. */
  referralMsat: number;
  /** Was beim Worker verbleibt (amount - fee), in msat. */
  workerMsat: number;
}

/**
 * Berechnet den Fee-Split nach Protokoll v1 (eigene Signatur, keine Kollision
 * mit rewards.ts FeeSplit).
 */
export function splitFeeV1(amountMsat: number): ProtocolFeeSplit {
  const totalFee = Math.floor((amountMsat * PROTOCOL_FEE_PPM) / 1_000_000);
  const poolMsat = Math.floor((totalFee * FEE_POOL_PPM) / PROTOCOL_FEE_PPM);
  // Rundungsrest geht an Referral, nie an den Worker — sonst könnte ein
  // Provider durch geschickt gewählte Beträge die Fee unterlaufen.
  const referralMsat = Math.max(0, totalFee - poolMsat);
  return {
    poolMsat,
    referralMsat,
    workerMsat: amountMsat - totalFee,
  };
}
