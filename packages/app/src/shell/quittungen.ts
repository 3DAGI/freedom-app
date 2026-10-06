/**
 * Quittungen in der App (Schritt 5.5b).
 *
 * Angelegt wird, wo die Zahlung feststeht – in `handleAnswer()`, je Stelle ein
 * Aufruf: Lightning nach der Abrechnung (`quittungNachZahlung()`, eine
 * Quittung je Zahlung über alle Antworten seit der letzten), Zahlkanal nach
 * `kanalAntwort()` (`quittungNachKanal()`, „angekündigt“, bis die Kette die
 * Auszahlung zeigt – `hebeKanalQuittungen()` im Abruftakt). Daraus der Ruf für
 * die Provider-Auswahl (`aktuellerRuf()`); 38010 zählt nicht. Seit 5.5c
 * gehen die Zusammenfassungen der Kontakte ein (`rufVonKontakten`, im Tresor)
 * und die eigene (`eigeneZeilen()`) auf Wunsch an sie (`shell/ruf.ts`).
 */
import { berechneRuf, fasseZusammen, kanalQuittung, lightningQuittung, type Ruf, type RufVonKontakt, type RufZeile } from "@freedomstack/protocol";
import { OffeneAntworten, QuittungsBuch, reklamationenJeProvider } from "../quittungsbuch.js";
import { RufVonKontakten } from "../ruf-teilen.js";
import { LS_REKLAMATIONEN, leseReklamationen } from "../streitfall.js";
import { kanalBuch } from "./ki-zahlung.js";
import { solRpcUrl } from "./state.js";
import { geheim } from "./tresor.js";
import { ankereQuittung } from "./zeitanker-takt.js";

export const quittungsBuch = new QuittungsBuch(geheim);
/** Zusammenfassungen der Kontakte (5.5c) – nur im Tresor. */
export const rufVonKontakten = new RufVonKontakten(geheim);
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
  await quittungNachBegleichen(provider, charge);
}

/** Nach dem Begleichen offener Beträge (D1b2, `SessionClient.begleiche()`): Quittung ohne neue Antwort – über die seit der letzten Zahlung. */
export async function quittungNachBegleichen(provider: string, charge: { settled: boolean; paymentRef?: string; rechnung?: string }): Promise<void> {
  if (!charge.settled || !charge.paymentRef || !charge.rechnung) return;
  const q = lightningQuittung({ provider, rechnung: charge.rechnung, preimage: charge.paymentRef, auftraege: offen.nimm(provider), zeit: jetzt() });
  // Tresor gesperrt: Diese Quittung fehlt dann – nie offen ablegen
  if (q) await quittungsBuch.lege(q).then(() => ankereQuittung(q)).catch(() => {});
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
  if (q) await quittungsBuch.lege(q).then(() => ankereQuittung(q)).catch(() => {});
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

const eigeneReklamationen = () => reklamationenJeProvider(leseReklamationen(geheim.getItem(LS_REKLAMATIONEN), jetzt()));

/** Kontakte: die Direktnachrichten-Unterhaltungen (aus dem Tresor, wie die Chatliste). */
export function kontakteJetzt(): string[] {
  try {
    const l = JSON.parse(geheim.getItem("freedom.chats") ?? "[]") as Array<{ type?: string; id?: unknown }>;
    return Array.isArray(l) ? l.filter((c) => c?.type === "dm" && typeof c.id === "string" && /^[0-9a-f]{64}$/.test(c.id)).map((c) => c.id as string) : [];
  } catch {
    return [];
  }
}

/** Die eigene Zusammenfassung je Provider (für die Kontakte, 5.5c). */
export function eigeneZeilen(): RufZeile[] {
  return fasseZusammen(quittungsBuch.alle(), eigeneReklamationen());
}

/** Ruf je Provider – nur aus Quittungen, bestätigten Reklamationen und den Zusammenfassungen der Kontakte (5.5c). */
export function aktuellerRuf(vonKontakten: readonly RufVonKontakt[] = rufVonKontakten.alle(new Set(kontakteJetzt()))): Map<string, Ruf> {
  return berechneRuf({ quittungen: quittungsBuch.alle(), reklamationen: eigeneReklamationen(), vonKontakten });
}
