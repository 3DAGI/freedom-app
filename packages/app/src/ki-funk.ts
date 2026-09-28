/**
 * KI über ein Funk-Gateway (Schritt 7.4c2) – die Bausteine ohne Zustand.
 *
 * Ohne Internet geht eine KI-Anfrage über das eigene Funkgerät an ein Gateway
 * mit Netz (7.4b2). Die App funkt zwei Umschläge: den Weiterleitungsauftrag an
 * das Gateway (Kind 25030 – es erfährt nur den Sitzungsschlüssel) und den
 * versiegelten Auftrag an den Provider mit `kurzParam()` (höchstens 500
 * Zeichen, keine Zwischenstände). Die Antwort kommt als Umschlag an den
 * Sitzungsschlüssel über Funk zurück.
 *
 * Gateway und Provider sind derselbe Knoten: Er nennt die Rolle im Angebot
 * (`["funk","gateway"]`). Die App merkt sich, was sie offline davon braucht,
 * solange sie Netz hat – ohne Netz gibt es keine Angebote.
 */
import {
  KIND_GIFT_WRAP, WEITERLEITUNG_MAX_SECS, baueWeiterleitung, buildJobRequest, buildPrivateJobRequest, getTag, kurzParam,
  type NostrEvent, type ProviderCapabilities, type Signer,
} from "@freedomstack/protocol";
import { oeffneAntworten } from "./ki-antworten.js";
import type { KiSitzungen } from "./ki-sitzung.js";

/** Höchstens so viel Rechenarbeit rechnet die App (wie im Agenten). */
const MAX_POW = 16;

/** Was die App vom Angebot des Gateways offline braucht. */
export interface FunkGateway {
  pubkey: string;
  powBits: number;
  /** Kurs für Gutschriften im Zahlkanal (4.4) – ohne ihn keine bezahlte Anfrage. */
  kurs?: { satsProSol: number; quelle: "manuell" | "markt" };
  /** Stand des Angebots (Unix-Sekunden). */
  seit: number;
}

/** Aus einem Angebot – null, wenn es kein Funk-Gateway nennt oder mehr Rechenarbeit verlangt, als die App leistet. */
export function funkGatewayAus(caps: ProviderCapabilities): FunkGateway | null {
  const pow = caps.powBits ?? 0;
  if (!caps.funkGateway || pow > MAX_POW) return null;
  return { pubkey: caps.pubkey, powBits: pow, ...(caps.kurs ? { kurs: caps.kurs } : {}), seit: caps.updatedAt };
}

/** Gemerktes Gateway lesen; Unbrauchbares gilt als keines. */
export function leseFunkGateway(json: string | null): FunkGateway | null {
  try {
    const g = JSON.parse(json ?? "null") as Partial<FunkGateway> | null;
    if (!g || typeof g.pubkey !== "string" || !/^[0-9a-f]{64}$/.test(g.pubkey)) return null;
    if (!Number.isInteger(g.powBits) || g.powBits! < 0 || g.powBits! > MAX_POW || !Number.isSafeInteger(g.seit)) return null;
    const k = g.kurs;
    const kurs = k && Number.isSafeInteger(k.satsProSol) && k.satsProSol > 0 && (k.quelle === "manuell" || k.quelle === "markt") ? k : undefined;
    return { pubkey: g.pubkey, powBits: g.powBits!, ...(kurs ? { kurs } : {}), seit: g.seit! };
  } catch {
    return null;
  }
}

/**
 * Weiterleitung und Auftrag bauen – beide versiegelt vom Sitzungsschlüssel.
 * `zahlTags` (Gutschrift im Zahlkanal) gehören in den Kern, vor dem Versiegeln.
 */
export async function baueFunkAuftrag(p: {
  prompt: string; bidMsat: number; gateway: FunkGateway; sitzung: Signer; zahlTags?: string[][]; nowSecs?: number;
}): Promise<{ weiterleitung: NostrEvent; auftrag: NostrEvent; requestId: string; bis: number }> {
  const request = buildJobRequest({
    customerPubkey: p.sitzung.publicKey(),
    input: p.prompt,
    bidMsat: p.bidMsat,
    providerPubkey: p.gateway.pubkey,
    params: [["tier", p.bidMsat > 0 ? "classic" : "free"], kurzParam()],
    extraTags: p.zahlTags ?? [],
  });
  const { wrap: auftrag, requestId } = await buildPrivateJobRequest({
    request, sessionSigner: p.sitzung, providerPk: p.gateway.pubkey, powBits: p.gateway.powBits, nowSecs: p.nowSecs,
  });
  // Eine Stunde: Über Funk dauert schon der Hinweg Minuten, das Gateway wartet nicht länger
  const { wrap: weiterleitung, weiterleitung: w } = await baueWeiterleitung({
    sitzung: p.sitzung, gatewayPk: p.gateway.pubkey, dauerSecs: WEITERLEITUNG_MAX_SECS, nowSecs: p.nowSecs,
  });
  return { weiterleitung, auftrag, requestId, bis: w.bis };
}

/**
 * Offene Funk-Aufträge und ihre Antworten. Nur im Speicher: Die Frage bleibt
 * nicht liegen, und nach dem Neuladen wartet niemand mehr – das sagt die App.
 */
export class FunkAuftraege {
  private offen = new Map<string, { frage: string; bis: number }>();

  merke(requestId: string, frage: string, bis: number): void {
    this.offen.set(requestId, { frage, bis });
    if (this.offen.size > 20) this.offen.delete(this.offen.keys().next().value!);
  }

  vergiss(requestId: string): void {
    this.offen.delete(requestId);
  }

  get anzahl(): number {
    return this.offen.size;
  }

  /**
   * Ein Umschlag aus dem Funk: Antwort auf einen offenen Auftrag? Ergebnis
   * (Kind 6xxx) schließt ihn; eine Rückmeldung (7000, etwa eine Ablehnung)
   * lässt ihn offen. null, wenn der Umschlag nicht dazugehört.
   */
  async oeffne(wrap: NostrEvent, sitzungen: KiSitzungen, nowSecs = Math.floor(Date.now() / 1000)):
    Promise<{ ev: NostrEvent; frage: string; ergebnis: boolean } | null> {
    for (const [id, o] of this.offen) if (o.bis <= nowSecs) this.offen.delete(id);
    if (this.offen.size === 0 || wrap.kind !== KIND_GIFT_WRAP) return null;
    const { ergebnisse, rueckmeldungen } = await oeffneAntworten([wrap], sitzungen, new Set(this.offen.keys()));
    const ev = ergebnisse[0] ?? rueckmeldungen[0];
    const id = ev ? getTag(ev, "e") : undefined;
    const o = id ? this.offen.get(id) : undefined;
    if (!ev || !id || !o) return null;
    const ergebnis = ergebnisse.length > 0;
    if (ergebnis) this.offen.delete(id);
    return { ev, frage: o.frage, ergebnis };
  }
}
