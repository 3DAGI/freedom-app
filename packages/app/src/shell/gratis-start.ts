/**
 * Gratis-Start in der App (A-14b, G1): das Kontingent dieses Geräts und die
 * Gratis-Angebote der Provider. Das Kontingent liegt nur in `geheim` – der
 * Stand verrät, wie viel man fragt – und nie in der Sicherung.
 */
import type { GratisAngebot, ProviderCapabilities } from "@freedomstack/protocol";
import { GeraeteKontingent, LS_AUTO_BEZAHLEN, gratisKandidaten, tokensDerAntwort, zustimmungFuer, zustimmungGilt } from "../gratis-kontingent.js";
import { geheim } from "./tresor.js";

export const geraeteKontingent = new GeraeteKontingent(geheim);

/** Gratis-Angebot je Provider (Tag `gratis`, A-14a) – aus der Auswahl, nur im Speicher. */
export const gratisJeProvider = new Map<string, GratisAngebot>();

/** Eine Gratis-Antwort zählen – scheitert das Merken (Tresor gesperrt), fehlt der Eintrag, nie die Antwort. */
export async function zaehleGratisAntwort(usage: { promptTokens?: number; completionTokens?: number } | undefined): Promise<void> {
  await geraeteKontingent.buche(tokensDerAntwort(usage)).catch(() => undefined);
}

/**
 * Provider, die heute `gratis-leer` gemeldet haben (A-14b2) – ihr Angebot sagt
 * es erst mit der nächsten Erneuerung. Nur im Speicher, je Tag (UTC).
 */
const leerHeute = new Map<string, string>();
const heute = (): string => new Date().toISOString().slice(0, 10);

export function merkeGratisLeer(pk: string): void {
  leerHeute.set(pk, heute());
}

/** Wer gerade eine Gratis-Frage bekommt: Gratis-Anbieter mit machbaren Bits, ohne die heute leeren. */
export function gratisAnbieter<T extends { caps: Pick<ProviderCapabilities, "pubkey" | "currentlyFree" | "powBits" | "gratis"> }>(
  kandidaten: readonly T[],
  maxPow: number,
): T[] {
  return gratisKandidaten(kandidaten, maxPow).filter((c) => leerHeute.get(c.caps.pubkey) !== heute());
}

/** Zustimmung zum Bezahlen im Tarif „Automatisch“ – gilt nur heute (UTC), morgen wird neu gefragt (A-14b3). */
export function autoZugestimmt(): boolean {
  return zustimmungGilt(localStorage.getItem(LS_AUTO_BEZAHLEN), Math.floor(Date.now() / 1000));
}

export function merkeAutoZustimmung(): void {
  localStorage.setItem(LS_AUTO_BEZAHLEN, zustimmungFuer(Math.floor(Date.now() / 1000)));
}
