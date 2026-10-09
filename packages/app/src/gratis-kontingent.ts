/**
 * Gratis-Start in der App (A-14b, Entscheidung G1 vom 08.10.2026).
 *
 * Kontingent je Gerät: je Tag (UTC) höchstens 20 Gratis-Antworten und
 * 20 000 Tokens – was zuerst erreicht ist. Gezählt werden Frage samt Verlauf
 * und Antwort aus der Abrechnung des Providers (`usage`). Das ist eine
 * Fairness-Regel, keine Sperre: Wer die App neu einrichtet, fängt neu an, und
 * die Texte versprechen nichts anderes. Ein Kontingent je Person kann es nicht
 * geben – Schlüssel kosten nichts.
 *
 * Der Stand liegt nur auf dem Gerät (`geheim`, nie in der Sicherung): Er
 * verrät, wie viel man fragt. Gratis gehen Fragen nur an Provider, die gerade
 * gratis anbieten, mit der Rechenarbeit aus ihrem Angebot (Tag `gratis`, A-14a).
 */
import type { GratisAngebot, ProviderCapabilities } from "@freedomstack/protocol";
import type { GeheimSpeicher } from "./vault.js";

/** G1: je Gerät und Tag. */
export const GERAET_GRATIS = Object.freeze({ antworten: 20, tokens: 20_000 });

export const LS_GRATIS_KONTINGENT = "freedom.gratis.kontingent";

/** Mehr zählt eine einzelne Antwort nie – eine fremde Angabe könnte sonst alles auf einmal verbrauchen. */
const MAX_TOKENS_JE_ANTWORT = 1_000_000;

export interface KontingentStand {
  tag: string;
  antworten: number;
  tokens: number;
}

const tagVon = (jetztSek: number): string => new Date(jetztSek * 1000).toISOString().slice(0, 10);
const ganz = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;

/** Gespeicherten Stand streng lesen – Unsinn oder ein anderer Tag heißt: heute noch nichts verbraucht. */
export function leseKontingent(roh: string | null, jetztSek: number): KontingentStand {
  const tag = tagVon(jetztSek);
  const leer = { tag, antworten: 0, tokens: 0 };
  if (!roh) return leer;
  try {
    const o = JSON.parse(roh) as Record<string, unknown>;
    if (!o || o.tag !== tag || !ganz(o.antworten) || !ganz(o.tokens)) return leer;
    return { tag, antworten: o.antworten, tokens: o.tokens };
  } catch {
    return leer;
  }
}

/** Was heute noch geht. */
export function kontingentRest(s: KontingentStand): { antworten: number; tokens: number } {
  return {
    antworten: Math.max(0, GERAET_GRATIS.antworten - s.antworten),
    tokens: Math.max(0, GERAET_GRATIS.tokens - s.tokens),
  };
}

/** Aufgebraucht, sobald eine der beiden Grenzen erreicht ist. */
export function kontingentErschoepft(s: KontingentStand): boolean {
  const r = kontingentRest(s);
  return r.antworten === 0 || r.tokens === 0;
}

/** Tokens einer Gratis-Antwort aus der (schon bereinigten) Abrechnung – fehlt sie, zählt die Antwort mit 0 Tokens. */
export function tokensDerAntwort(usage: { promptTokens?: number; completionTokens?: number } | undefined): number {
  const summe = (ganz(usage?.promptTokens) ? usage!.promptTokens! : 0) + (ganz(usage?.completionTokens) ? usage!.completionTokens! : 0);
  return Math.min(summe, MAX_TOKENS_JE_ANTWORT);
}

/** Das Kontingent dieses Geräts – gelesen und geschrieben nur über `geheim`. */
export class GeraeteKontingent {
  constructor(
    private readonly speicher: GeheimSpeicher,
    private readonly uhr: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  stand(): KontingentStand {
    return leseKontingent(this.speicher.getItem(LS_GRATIS_KONTINGENT), this.uhr());
  }

  erschoepft(): boolean {
    return kontingentErschoepft(this.stand());
  }

  /** Eine Gratis-Antwort verbuchen. */
  async buche(tokens: number): Promise<KontingentStand> {
    const s = this.stand();
    const neu = { tag: s.tag, antworten: s.antworten + 1, tokens: s.tokens + (ganz(tokens) ? Math.min(tokens, MAX_TOKENS_JE_ANTWORT) : 0) };
    await this.speicher.setItem(LS_GRATIS_KONTINGENT, JSON.stringify(neu));
    return neu;
  }
}

/**
 * Rechenarbeit einer Anfrage: Gratis-Anfragen (Gebot 0) tragen die Bits aus
 * dem Gratis-Angebot, wenn sie höher sind als die für bezahlte.
 */
export function powFuerAnfrage(pow: number, gratis: GratisAngebot | undefined): number {
  return gratis ? Math.max(pow, gratis.powBits) : pow;
}

/**
 * Wer eine Gratis-Frage bekommt: nur Provider, die gerade gratis anbieten
 * (`free` im Angebot), und nur, wenn die verlangte Rechenarbeit auf dem Gerät
 * machbar ist. Knoten ohne Tag `gratis` (vor A-14a) bleiben dabei.
 */
export function gratisKandidaten<T extends { caps: Pick<ProviderCapabilities, "currentlyFree" | "powBits" | "gratis"> }>(
  kandidaten: readonly T[],
  maxPow: number,
): T[] {
  return kandidaten.filter((c) => c.caps.currentlyFree && powFuerAnfrage(c.caps.powBits ?? 0, c.caps.gratis) <= maxPow);
}

/** Zustimmung zum Bezahlen im Tarif „Automatisch“ (A-14b2) – nur auf diesem Gerät, als Tag (UTC). */
export const LS_AUTO_BEZAHLEN = "freedom.gratis.bezahlenOk";

/**
 * Die Zustimmung gilt nur an dem Tag (UTC), an dem sie gegeben wurde – jeden Tag
 * wechselt „Automatisch“ neu von gratis auf bezahlt, und jeden Tag wird gefragt
 * (MENSCH 09.10.2026, A-14b3). Was anderes gespeichert ist (auch die frühere „1“), gilt nicht.
 */
export function zustimmungGilt(roh: string | null, jetztSek: number): boolean {
  return roh === tagVon(jetztSek);
}

/** Was für die Zustimmung gemerkt wird: der heutige Tag (UTC). */
export function zustimmungFuer(jetztSek: number): string {
  return tagVon(jetztSek);
}

export type AutoWahl =
  | { art: "gratis" }
  | { art: "bezahlt" }
  | { art: "fragen"; grund: "kontingent" | "keinGratis" }
  | { art: "wallet"; grund: "kontingent" | "keinGratis" };

/**
 * Tarif „Automatisch“ (A-14b2, G1): gratis, solange das Gerät Kontingent hat
 * und ein Provider gratis anbietet. Sonst bezahlt – an jedem Tag erst nach
 * Rückfrage (A-14b3), ohne Wallet gar nicht. Nie still bezahlen.
 */
export function waehleAuto(o: { kontingentLeer: boolean; gratisAnbieter: number; zugestimmt: boolean; wallet: boolean }): AutoWahl {
  if (!o.kontingentLeer && o.gratisAnbieter > 0) return { art: "gratis" };
  const grund = o.kontingentLeer ? "kontingent" : "keinGratis";
  if (!o.wallet) return { art: "wallet", grund };
  return o.zugestimmt ? { art: "bezahlt" } : { art: "fragen", grund };
}

/** Für die Modell-Liste: „Automatisch“ zeigt, was gratis geht – und alles darüber (A-14b2). */
export function tierFuerListe(wahl: string): string {
  return wahl === "auto" ? "free" : wahl;
}
