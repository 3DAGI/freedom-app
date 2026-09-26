/**
 * Kosten je Werkzeug in beiden Einheiten (Schritt 8.7), ohne DOM.
 *
 * Preis eines Werkzeugs: der guenstigste, den ein Anbieter in seinem Angebot
 * nennt; ohne Angebot der Richtpreis aus `DEFAULT_TOOL_PRICES`. Angezeigt in
 * sats und SOL ueber den Marktkurs (`ausMsat`) – ohne Kurs steht „kein Kurs“.
 */
import { DEFAULT_TOOL_PRICES, type MarktKurs, type ToolPrice } from "@freedomstack/protocol";
import { ausMsat } from "./preis-anzeige.js";

export interface WerkzeugPreis {
  msat: number;
  /** true: aus einem Anbieter-Angebot, false: Richtpreis */
  angeboten: boolean;
}

/** Guenstigster angebotener Preis je Werkzeug-Kind, sonst der Richtpreis. */
export function werkzeugPreise(angebote: ReadonlyArray<{ tools?: readonly ToolPrice[] }>): Map<number, WerkzeugPreis> {
  const m = new Map<number, WerkzeugPreis>();
  for (const d of DEFAULT_TOOL_PRICES) m.set(d.kind, { msat: d.satsPerCall * 1000, angeboten: false });
  for (const a of angebote) {
    for (const t of a.tools ?? []) {
      if (!Number.isSafeInteger(t.kind) || !Number.isFinite(t.priceMsat) || t.priceMsat < 0) continue;
      const alt = m.get(t.kind);
      if (!alt || !alt.angeboten || t.priceMsat < alt.msat) m.set(t.kind, { msat: t.priceMsat, angeboten: true });
    }
  }
  return m;
}

/** „5 sats ≈ 0,00003 SOL je Aufruf“ bzw. mit „Richtpreis“. */
export function werkzeugPreisText(p: WerkzeugPreis | undefined, kurs?: Pick<MarktKurs, "satsProSol">): string {
  if (!p) return "Preis unbekannt";
  return `${ausMsat(p.msat, kurs)} je Aufruf${p.angeboten ? "" : " (Richtpreis)"}`;
}
