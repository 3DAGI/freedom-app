/**
 * Gratis-Start in der App (A-14b, G1): das Kontingent dieses Geräts und die
 * Gratis-Angebote der Provider. Das Kontingent liegt nur in `geheim` – der
 * Stand verrät, wie viel man fragt – und nie in der Sicherung.
 */
import type { GratisAngebot, ProviderCapabilities } from "@freedomstack/protocol";
import { GERAET_GRATIS, GeraeteKontingent, LS_AUTO_BEZAHLEN, gratisKandidaten, kontingentRest, tokensDerAntwort, zustimmungFuer, zustimmungGilt } from "../gratis-kontingent.js";
import { gebietsschema, t } from "../i18n.js";
import { geheim } from "./tresor.js";

export const geraeteKontingent = new GeraeteKontingent(geheim);

/** Gratis-Angebot je Provider (Tag `gratis`, A-14a) – aus der Auswahl, nur im Speicher. */
export const gratisJeProvider = new Map<string, GratisAngebot>();

/** Eine Gratis-Antwort zählen – scheitert das Merken (Tresor gesperrt), fehlt der Eintrag, nie die Antwort. */
export async function zaehleGratisAntwort(usage: { promptTokens?: number; completionTokens?: number } | undefined): Promise<void> {
  await geraeteKontingent.buche(tokensDerAntwort(usage)).catch(() => undefined);
  zeigeGratisStand();
}

/**
 * Was heute auf diesem Gerät gratis noch geht (C-27) – unter der Eingabe des Agenten, nur in den
 * Tarifen „Automatisch“ und „Free“. Nur aus dem Kontingent (`kontingentRest()`): nichts neu zählen,
 * nichts ins Netz, nichts merken. Eine Fairness-Regel je Gerät, keine Sperre – so steht es im Tooltip.
 */
export function zeigeGratisStand(): void {
  const ziel = document.getElementById("ai-gratis");
  if (!ziel) return;
  const tarif = (document.getElementById("ai-tier") as HTMLSelectElement | null)?.value ?? "auto";
  ziel.hidden = tarif !== "auto" && tarif !== "free";
  if (ziel.hidden) return;
  const rest = kontingentRest(geraeteKontingent.stand());
  const zahl = (n: number): string => n.toLocaleString(gebietsschema());
  const leer = rest.antworten === 0 || rest.tokens === 0;
  // Als Chip (C-49c): kurz im Text, der ganze Satz samt Regel im Tooltip und für Vorleser
  const satz = leer
    ? t("agent.gratisHeuteLeer")
    : t("agent.gratisHeute", { antworten: rest.antworten, max: GERAET_GRATIS.antworten, tokens: zahl(rest.tokens), maxTokens: zahl(GERAET_GRATIS.tokens) });
  ziel.textContent = leer ? t("agent.gratisChipLeer") : t("agent.gratisChip", { antworten: rest.antworten, max: GERAET_GRATIS.antworten });
  ziel.title = `${satz}. ${t("agent.gratisRegel")}`;
  ziel.setAttribute("aria-label", satz);
  ziel.classList.toggle("leer", leer);
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
