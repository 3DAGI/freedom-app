/**
 * Gratis-Start (A-14, Entscheidung G1 vom 08.10.2026).
 *
 * Ein Kontingent je Person kann ein Knoten nicht durchsetzen, ohne Anfragen
 * zu verknüpfen: Schlüssel kosten nichts, und die App wechselt sie je
 * Unterhaltung (D1b2). Deshalb verschenkt jeder Knoten ein Budget für alle
 * zusammen, je Tag, und nennt es im Angebot – Tag
 * `["gratis", <Tokens am Tag>, <Tokens je Antwort>, <Bits>]`:
 * - Tokens am Tag: so viel rechnet er gratis, Frage samt Verlauf und Antwort
 *   (aus seiner eigenen Abrechnung); danach lehnt er mit `gratis-leer` ab.
 * - Tokens je Antwort: höchstens so lang wird eine Gratis-Antwort (er
 *   begrenzt beim Modell). Werkzeuge gibt es gratis nicht.
 * - Bits: so viel Rechenarbeit trägt der Umschlag einer Gratis-Anfrage –
 *   mehr als die für bezahlte (`pow`), damit Gratis-Fragen etwas kosten.
 *
 * Die Zahl je Gerät zählt die App selbst (A-14b) – eine Fairness-Regel, keine
 * Sperre. Wer keinen Tag nennt, verschenkt nichts nach dieser Regel.
 */
import { MAX_POW_BITS } from "./private-job.js";

export interface GratisAngebot {
  tokensProTag: number;
  tokensJeAntwort: number;
  powBits: number;
}

/** Vorgabe für Knoten (G1): 100 000 Tokens am Tag, 2 000 je Antwort, 16 Bit. */
export const GRATIS_VORGABE: Readonly<GratisAngebot> = Object.freeze({
  tokensProTag: 100_000,
  tokensJeAntwort: 2_000,
  powBits: 16,
});

/** Kennung der Ablehnung, wenn das Budget des Tages verbraucht ist (Tag `fall` der Rückmeldung). */
export const GRATIS_LEER = "gratis-leer";

/** Obergrenzen beim Lesen fremder Angebote – mehr verspricht kein Knoten ernsthaft. */
const GRENZEN = { tokensProTag: 1_000_000_000, tokensJeAntwort: 1_000_000 };

function ganz(roh: string | undefined, max: number): number | undefined {
  if (roh === undefined || !/^\d{1,10}$/.test(roh)) return undefined;
  const n = Number(roh);
  return n <= max ? n : undefined;
}

/** Prüft ein Angebot auf ganze Zahlen im Bereich – sonst `undefined`. */
export function pruefeGratis(g: GratisAngebot): GratisAngebot | undefined {
  const ok = Number.isInteger(g.tokensProTag) && g.tokensProTag >= 1 && g.tokensProTag <= GRENZEN.tokensProTag
    && Number.isInteger(g.tokensJeAntwort) && g.tokensJeAntwort >= 1 && g.tokensJeAntwort <= GRENZEN.tokensJeAntwort
    && Number.isInteger(g.powBits) && g.powBits >= 0 && g.powBits <= MAX_POW_BITS;
  return ok ? { tokensProTag: g.tokensProTag, tokensJeAntwort: g.tokensJeAntwort, powBits: g.powBits } : undefined;
}

/** Tag fürs Angebot – `undefined`, wenn die Werte nicht taugen (dann verschenkt der Knoten nichts). */
export function gratisTag(g: GratisAngebot): string[] | undefined {
  const p = pruefeGratis(g);
  return p ? ["gratis", String(p.tokensProTag), String(p.tokensJeAntwort), String(p.powBits)] : undefined;
}

/** Liest den Tag aus fremden Tags – streng: drei ganze Zahlen im Bereich, sonst `undefined`. */
export function leseGratisTag(tags: readonly (readonly string[])[]): GratisAngebot | undefined {
  const t = tags.find((x) => x[0] === "gratis");
  if (!t) return undefined;
  const tokensProTag = ganz(t[1], GRENZEN.tokensProTag);
  const tokensJeAntwort = ganz(t[2], GRENZEN.tokensJeAntwort);
  const powBits = ganz(t[3], MAX_POW_BITS);
  if (tokensProTag === undefined || tokensJeAntwort === undefined || powBits === undefined) return undefined;
  return pruefeGratis({ tokensProTag, tokensJeAntwort, powBits });
}

/**
 * Werte aus der Umgebung des Knotens: `GRATIS_TOKENS_TAG` (0 = aus),
 * `GRATIS_TOKENS_JE_ANTWORT`, `GRATIS_POW_BITS`; leer heißt Vorgabe. Ein
 * unbrauchbarer Wert ergibt einen Grund – der Knoten startet dann nicht still
 * mit etwas anderem.
 */
export function gratisAusUmgebung(env: Readonly<Record<string, string | undefined>>):
  { gratis?: GratisAngebot; grund?: string } {
  const wert = (name: string, vorgabe: number): number | undefined => {
    const roh = (env[name] ?? "").trim();
    if (roh === "") return vorgabe;
    return /^\d{1,10}$/.test(roh) ? Number(roh) : undefined;
  };
  const tokensProTag = wert("GRATIS_TOKENS_TAG", GRATIS_VORGABE.tokensProTag);
  const tokensJeAntwort = wert("GRATIS_TOKENS_JE_ANTWORT", GRATIS_VORGABE.tokensJeAntwort);
  const powBits = wert("GRATIS_POW_BITS", GRATIS_VORGABE.powBits);
  if (tokensProTag === undefined || tokensJeAntwort === undefined || powBits === undefined) {
    return { grund: "GRATIS_* ist keine ganze Zahl" };
  }
  if (tokensProTag === 0) return {};
  const gratis = pruefeGratis({ tokensProTag, tokensJeAntwort, powBits });
  return gratis ? { gratis } : { grund: `GRATIS_* außerhalb des Bereichs (Bits höchstens ${MAX_POW_BITS})` };
}
