/**
 * Quittungen in der App (Schritt 5.5b).
 *
 * Angelegt wird, wo die Zahlung feststeht – in `handleAnswer()`, je Stelle ein
 * Aufruf: Lightning nach der Abrechnung (`quittungNachZahlung()`, eine
 * Quittung je Zahlung über alle Antworten seit der letzten), Zahlkanal nach
 * `kanalAntwort()` (`quittungNachKanal()`, „angekündigt“, bis die Kette die
 * Auszahlung zeigt – `hebeKanalQuittungen()` im Abruftakt). Daraus der Ruf für
 * die Provider-Auswahl (`aktuellerRuf()`); 38010 zählt nicht.
 */
import { berechneRuf, kanalQuittung, lightningQuittung, type Ruf, type RufVonKontakt } from "@freedomstack/protocol";
import { OffeneAntworten, QuittungsBuch, reklamationenJeProvider } from "../quittungsbuch.js";
import { LS_REKLAMATIONEN, leseReklamationen } from "../streitfall.js";
import { kanalBuch } from "./ki-zahlung.js";
import { solRpcUrl } from "./state.js";
import { geheim } from "./tresor.js";

export const quittungsBuch = new QuittungsBuch(geheim);
const offen = new OffeneAntworten();
const jetzt = (): number => Math.floor(Date.now() / 1000);

/**
 * Lightning, nach der Abrechnung einer Antwort: Eine bezahlte Antwort zählt;
 * ist gezahlt (`settled`), entsteht die Quittung über alle Antworten seit der
 * letzten Zahlung. Gratis-Antworten und Belege ohne Zahlung sind keine Quittung.
 */
export async function quittungNachZahlung(
  provider: string, providerMsat: number, charge: { settled: boolean; paymentRef?: string; rechnung?: string },
): Promise<void> {
  if (!(providerMsat > 0)) return;
  offen.zaehle(provider);
  if (!charge.settled || !charge.paymentRef || !charge.rechnung) return;
  const q = lightningQuittung({ provider, rechnung: charge.rechnung, preimage: charge.paymentRef, auftraege: offen.nimm(provider), zeit: jetzt() });
  // Tresor gesperrt: Diese Quittung fehlt dann – nie offen ablegen
  if (q) await quittungsBuch.lege(q).catch(() => {});
}

/**
 * Zahlkanal, nach `kanalAntwort()`: Quittung über den Preis, gedeckt von der
 * höchsten Gutschrift an den Kanal dieses Providers – vorsichtig, „belegt“ also
 * eher später als zu früh.
 */
export async function quittungNachKanal(provider: string, requestId: string, preisLamports: number | undefined): Promise<void> {
  const e = kanalBuch.fuerProvider(provider, jetzt());
  if (!e || !preisLamports) return;
  const q = kanalQuittung({ provider, kanal: e.kanal, gutschrift: BigInt(e.letzte), preisLamports, anfrage: requestId, zeit: jetzt() });
  if (q) await quittungsBuch.lege(q).catch(() => {});
}

/** Zahlkanal-Quittungen mit der Auszahlung auf der Kette auf „belegt“ heben. */
export async function hebeKanalQuittungen(): Promise<void> {
  const kanaele = quittungsBuch.offeneKanaele();
  if (kanaele.length === 0) return;
  const { Connection } = await import("@solana/web3.js");
  const { kanalAufKette } = await import("../zahlkanal.js");
  const conn = new Connection(await solRpcUrl(), "confirmed");
  for (const k of kanaele) {
    const stand = await kanalAufKette(conn, k).catch(() => null);
    if (stand) await quittungsBuch.hebe(k, stand.ausgezahlt).catch(() => 0);
  }
}

/** Ruf je Provider – nur aus Quittungen, bestätigten Reklamationen und (ab 5.5c) den Zusammenfassungen der Kontakte. */
export function aktuellerRuf(vonKontakten: readonly RufVonKontakt[] = []): Map<string, Ruf> {
  const reklamationen = reklamationenJeProvider(leseReklamationen(geheim.getItem(LS_REKLAMATIONEN), jetzt()));
  return berechneRuf({ quittungen: quittungsBuch.alle(), reklamationen, vonKontakten });
}
