/**
 * Helles oder dunkles Design (C-57b, Oberflächen-Review 15.10.2026) – ohne DOM. Bis jetzt gab es nur Dunkel.
 *
 * Gewählt wird System · Hell · Dunkel, Standard System: Die App folgt dann dem Gerät (`prefers-color-scheme`, das
 * CSS allein). Eine feste Wahl steht als `data-theme` an `<html>` und in `freedom.thema` – nur auf diesem Gerät,
 * nicht in der Sicherung (ein zweites Gerät darf anders aussehen).
 */
export type Thema = "system" | "hell" | "dunkel";

export const THEMA_SCHLUESSEL = "freedom.thema";
export const THEMEN: readonly Thema[] = ["system", "hell", "dunkel"];

/** Gespeicherte Wahl; Unbekanntes oder nichts ist „System“. */
export function leseThema(wert: string | null | undefined): Thema {
  return wert === "hell" || wert === "dunkel" ? wert : "system";
}

/** Wert für `data-theme` – bei „System“ keiner, dann entscheidet das CSS nach dem Gerät. */
export function themaAttribut(thema: Thema): "hell" | "dunkel" | null {
  return thema === "system" ? null : thema;
}

