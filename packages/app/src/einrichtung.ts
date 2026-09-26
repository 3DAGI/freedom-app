/**
 * Die Einrichtung beim ersten Start (Schritt 8.1b), ohne DOM.
 *
 * In der Reihenfolge der Karte: Merkphrase und Sicherung, Schutz auf diesem
 * Geraet (Passphrase), Standard-Schiene, private Voreinstellungen – dann das
 * Vorhaben, das bestimmt, wo die App aufgeht. Jede Seite ist ueberspringbar
 * ausser der Merkphrase, die man wenigstens gesehen haben muss.
 *
 * Bis 8.1b stand hier eine Willkommenskarte ohne Funktion: drei Schritte
 * („Verbinden“, „AI testen: 3 Gratis-Antworten“, „Zap senden“), deren Knopf
 * nur die Karte schloss.
 */
import { PRIVACY_FACTS } from "@freedomstack/protocol";
import type { Intent } from "./onboarding.js";

/**
 * Stand der Einrichtung: fehlt = noch nicht begonnen, „laeuft“ = Merkphrase
 * gesehen (beim Fortsetzen nicht noch einmal), „fertig“ = durchlaufen oder
 * uebersprungen – danach nie wieder von selbst.
 */
export const LS_EINRICHTUNG = "freedom.einrichtung";
/** Vorhaben aus der Einrichtung – die Onboarding-Leiste richtet sich danach. */
export const LS_INTENT = "freedom.intent";
/**
 * Zustimmung, den Werber oeffentlich zu nennen (8.1b). Ohne sie veroeffentlicht
 * die App die Werbebeziehung nicht – bis dahin tat sie es beim zweiten Start
 * ungefragt.
 */
export const LS_WERBER_ZUSTIMMUNG = "freedom.referrer.zustimmung";

export type Seite = "sichern" | "schutz" | "zahlen" | "privat" | "los";

/** Welche Seiten diese Einrichtung zeigt. */
export function einrichtungsSeiten(p: { merkphraseOffen: boolean; tresorDa: boolean; mitBunker: boolean }): Seite[] {
  return [
    ...(p.merkphraseOffen ? ["sichern" as const] : []),
    // Mit Bunker liegt kein Schluessel in der App, mit Tresor ist er schon geschuetzt
    ...(p.tresorDa || p.mitBunker ? [] : ["schutz" as const]),
    "zahlen", "privat", "los",
  ];
}

/** Laeuft die Einrichtung noch? Wer vor 8.1b die alte Karte schloss, bekommt sie nicht nachtraeglich. */
export function einrichtungOffen(speicher: Pick<Storage, "getItem">): boolean {
  return speicher.getItem(LS_EINRICHTUNG) !== "fertig" && speicher.getItem("freedom.onboarded") === null;
}

/** Merkphrase beim Fortsetzen zeigen? Nur, wenn sie in dieser Einrichtung noch nie zu sehen war. */
export function merkphraseNochZeigen(speicher: Pick<Storage, "getItem">): boolean {
  return speicher.getItem(LS_EINRICHTUNG) === null;
}

/** Wo die App nach der Einrichtung aufgeht. */
export function zielNachEinrichtung(intent: Intent): "ai" | "comm" | "earn" {
  return intent === "kommunizieren" ? "comm" : intent === "verdienen" ? "earn" : "ai";
}

/** Werbebeziehung veroeffentlichen? Nur mit ausdruecklicher Zustimmung. */
export function darfWerberNennen(speicher: Pick<Storage, "getItem">): boolean {
  return speicher.getItem(LS_WERBER_ZUSTIMMUNG) === "1";
}

/**
 * Was die Seite „privat“ ueber Relays sagt – woertlich aus den Aussagen des
 * Datenschutzberichts, damit sie nie mehr verspricht als der Code haelt.
 */
export function datenschutzKurz(): { belegt: string[]; offen: string[] } {
  const text = (id: string) => PRIVACY_FACTS.find((f) => f.id === id);
  const belegt = ["dm-inhalt", "dm-absender", "ki-prompt"].map(text).filter((f) => f?.status === "belegt").map((f) => f!.aussage);
  const offen = ["ip"].map(text).filter((f) => f && f.status !== "belegt").map((f) => f!.aussage);
  return { belegt, offen };
}
