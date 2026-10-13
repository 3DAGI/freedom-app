/**
 * Ein Kopfgeld bezahlen (Schritt E10b2, Entscheidung E10 B) – ohne DOM.
 *
 * Nur der Geldgeber, direkt an den, der die Aufgabe erledigt hat; nichts wird verwahrt. Je
 * zugesagter Währung genau eine Zahlung über die Zahlschienen (`zahle()`, Zweck „kopfgeld“). Was
 * schon bezahlt ist, merkt sich das Gerät (`freedom.kopfgeld.bezahlt` in `geheim`): Scheitert die
 * zweite Währung, zahlt ein neuer Klick nur sie – nie die erste ein zweites Mal. Von selbst wird nie
 * wiederholt.
 *
 * Ziele nur aus vorhandenen Quellen: Lightning über die Adresse im Profil (die Schiene holt die
 * Rechnung und prüft ihren Betrag) oder versiegelt erfragt (`frageRechnungAn()`); SOL über die
 * gemerkte oder versiegelt erfragte Adresse (`frageAdresseAn()`), die öffentliche aus dem Profil nur
 * nach Warnung. Eine andere Quelle gibt es hier nicht.
 */
import type { Beleg, Kopfgeld, Zahlanfrage } from "@freedomstack/protocol";
import { t } from "./i18n.js";
import type { GeheimSpeicher } from "./vault.js";

export const LS_KOPFGELD_BEZAHLT = "freedom.kopfgeld.bezahlt";

/** Was je Kopfgeld schon bezahlt ist: Beleg-Referenz je Währung. */
export interface KopfgeldBezahlt { msat?: string; lamports?: string }

export interface KopfgeldZahlWege {
  /** Lightning-Adresse aus dem Profil des Empfängers – leer, wenn er keine nennt. */
  lud16(): Promise<string>;
  /** Rechnung versiegelt beim Empfänger erfragen – leer, wenn keine kommt. */
  frageRechnung(msat: number): Promise<string | null | undefined>;
  /** SOL-Adresse: gemerkt oder versiegelt erfragt – leer, wenn keine. */
  solAdresse(): Promise<string | null | undefined>;
  /** Öffentliche SOL-Adresse aus dem Profil – nur nach Warnung; null, wenn keine oder nicht gewollt. */
  solAusProfil(): Promise<string | null>;
  zahle(a: Zahlanfrage): Promise<Beleg>;
  speicher: Pick<GeheimSpeicher, "getItem" | "setItem">;
}

/** Je Geldgeber, Kennung und Empfänger – ein neu vergebenes Kopfgeld beginnt von vorn. */
export const kopfgeldSchluessel = (kg: Pick<Kopfgeld, "geldgeber" | "kennung" | "an">): string => `${kg.geldgeber}:${kg.kennung}:${kg.an ?? ""}`;

function lies(speicher: Pick<GeheimSpeicher, "getItem">): Record<string, KopfgeldBezahlt> {
  try {
    const o = JSON.parse(speicher.getItem(LS_KOPFGELD_BEZAHLT) ?? "{}") as unknown;
    return o && typeof o === "object" && !Array.isArray(o) ? o as Record<string, KopfgeldBezahlt> : {};
  } catch {
    return {};
  }
}

/** Schon bezahlt (je Währung) – für die Anzeige und den nächsten Klick. */
export function schonBezahlt(kg: Pick<Kopfgeld, "geldgeber" | "kennung" | "an">, speicher: Pick<GeheimSpeicher, "getItem">): KopfgeldBezahlt {
  return lies(speicher)[kopfgeldSchluessel(kg)] ?? {};
}

async function merke(kg: Kopfgeld, bezahlt: KopfgeldBezahlt, speicher: Pick<GeheimSpeicher, "getItem" | "setItem">): Promise<void> {
  const alle = lies(speicher);
  alle[kopfgeldSchluessel(kg)] = bezahlt;
  await speicher.setItem(LS_KOPFGELD_BEZAHLT, JSON.stringify(alle));
}

/** Bezahlen, was noch offen ist – wirft beim ersten Fehlschlag; was bis dahin bezahlt ist, bleibt gemerkt. */
export async function bezahleKopfgeld(kg: Kopfgeld, wege: KopfgeldZahlWege): Promise<KopfgeldBezahlt> {
  if (!kg.an || (kg.stand !== "vergeben" && kg.stand !== "erledigt")) throw new Error(t("kopf.nichtVergeben"));
  const bezahlt = { ...schonBezahlt(kg, wege.speicher) };
  if (kg.msat !== undefined && !bezahlt.msat) {
    let ziel = await wege.lud16();
    if (!ziel) {
      // Ohne Adresse im Profil: versiegelt anfragen – das geht nur in ganzen sats (wie beim Zap)
      if (kg.msat % 1000 !== 0) throw new Error(t("zahl.nurGanzeSats"));
      ziel = (await wege.frageRechnung(kg.msat)) ?? "";
      if (!ziel) throw new Error(t("kopf.keineRechnung"));
    }
    const beleg = await wege.zahle({ ziel, betrag: { einheit: "msat", wert: kg.msat }, zweck: "kopfgeld" });
    bezahlt.msat = beleg.ref;
    await merke(kg, bezahlt, wege.speicher);
  }
  if (kg.lamports !== undefined && !bezahlt.lamports) {
    const ziel = (await wege.solAdresse()) || (await wege.solAusProfil());
    if (!ziel) throw new Error(t("kopf.keineSolAdresse"));
    const beleg = await wege.zahle({ ziel, betrag: { einheit: "lamports", wert: kg.lamports }, zweck: "kopfgeld" });
    bezahlt.lamports = beleg.ref;
    await merke(kg, bezahlt, wege.speicher);
  }
  return bezahlt;
}
