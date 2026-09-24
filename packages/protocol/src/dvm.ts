/**
 * NIP-90 Data Vending Machines: bezahlte KI-Jobs.
 *
 * Ablauf:
 *   1 Kunde publiziert Job-Request (kind 5xxx) mit Input + gewuenschtem Preis.
 *   2 Anbieter (Mensch oder Agent) sieht ihn, arbeitet, publiziert Result
 *     (kind 6xxx = Request+1000) mit e-Tag auf den Request.
 *   3 Bezahlung per Zap (NIP-57) auf das Result-Event.
 *   4 Optional Feedback-Events (kind 7000) fuer Status/Fehler.
 *
 * Das ist "KI nutzen und dafuer bezahlen / dafuer bezahlt werden" ohne Konto,
 * ohne Plattform, nur ueber signierte Events.
 */
import { UnsignedEvent, buildEvent, getTag } from "./event.js";
import {
  KIND_DVM_FEEDBACK,
  KIND_DVM_TEXT_GENERATION,
  isDvmRequest,
  isDvmResult,
  resultKindFor,
} from "./kinds.js";

export interface JobRequestParams {
  customerPubkey: string;
  /** Job-Kind, Standard: Textgenerierung (5050). */
  kind?: number;
  /** Eingabe fuer den Job (Prompt, URL, Event-ID ...). */
  input: string;
  inputType?: "text" | "url" | "event" | "job";
  /** Gebotener Preis in Millisatoshi. */
  bidMsat: number;
  /** Optional: gewuenschter Anbieter (p-Tag). */
  providerPubkey?: string;
  /** Freie Parameter, z. B. ["model", "..."]. */
  params?: string[][];
  /** Zusaetzliche rohe Tags (z.B. attach/tool) — VOR der Signatur eingebaut,
   *  damit kein re-sign noetig ist. */
  extraTags?: string[][];
}

export function buildJobRequest(p: JobRequestParams, createdAt?: number): UnsignedEvent {
  const kind = p.kind ?? KIND_DVM_TEXT_GENERATION;
  if (!isDvmRequest(kind)) throw new Error(`kein DVM-Request-Kind: ${kind}`);
  const tags: string[][] = [
    ["i", p.input, p.inputType ?? "text"],
    ["bid", String(p.bidMsat)],
  ];
  if (p.providerPubkey) tags.push(["p", p.providerPubkey]);
  for (const param of p.params ?? []) tags.push(["param", ...param]);
  for (const t of p.extraTags ?? []) tags.push(t);
  return buildEvent(p.customerPubkey, kind, tags, "", createdAt);
}

export interface JobResultParams {
  providerPubkey: string;
  /** Der beantwortete Request. */
  requestId: string;
  requestKind: number;
  customerPubkey: string;
  /** Das Ergebnis (Text, JSON, URL ...). */
  output: string;
  /** Geforderter Betrag in Millisatoshi. */
  amountMsat: number;
  /** Optional: Lightning-Invoice zur direkten Zahlung. */
  bolt11?: string;
  /** Optional: Solana-Adresse fuer SOL-Zahlung (2. Zahloption neben Lightning).
   *  Betrag wird als amount_sol-Tag mitgefuehrt. */
  solanaAddress?: string;
  /** Optional: SOL-Betrag in Lamports (wenn solanaAddress gesetzt). */
  amountLamports?: number;
  /** Optional: Usage-Transparenz (Claude-Stil ausklappbare Bubble). */
  usage?: {
    model?: string;
    promptTokens?: number;
    completionTokens?: number;
    /** Tool-Calls dieser Antwort: [{name, kind, costMsat}] */
    toolCalls?: Array<{ name: string; kind: number; costMsat: number }>;
    /** Kumulierter Session-Verbrauch in msat (wenn Session). */
    sessionTotalMsat?: number;
  };
}

export function buildJobResult(p: JobResultParams, createdAt?: number): UnsignedEvent {
  const kind = resultKindFor(p.requestKind);
  const tags: string[][] = [
    ["e", p.requestId],
    ["p", p.customerPubkey],
    p.bolt11 ? ["amount", String(p.amountMsat), p.bolt11] : ["amount", String(p.amountMsat)],
  ];
  if (p.solanaAddress) {
    tags.push(["solana_address", p.solanaAddress]);
    if (p.amountLamports !== undefined) tags.push(["amount_lamports", String(p.amountLamports)]);
  }
  if (p.usage) {
    // Kompaktes JSON-Tag (einzeilig), vom Client gerendert als aufklappbare Bubble
    tags.push(["usage", JSON.stringify(p.usage)]);
  }
  return buildEvent(p.providerPubkey, kind, tags, p.output, createdAt);
}

export type JobStatus = "payment-required" | "processing" | "error" | "success" | "partial";

export function buildJobFeedback(
  providerPubkey: string,
  requestId: string,
  customerPubkey: string,
  status: JobStatus,
  info = "",
  createdAt?: number,
): UnsignedEvent {
  return buildEvent(
    providerPubkey,
    KIND_DVM_FEEDBACK,
    [["e", requestId], ["p", customerPubkey], ["status", status]],
    info,
    createdAt,
  );
}

export interface ParsedJobResult {
  requestId: string;
  customerPubkey: string;
  providerPubkey: string;
  output: string;
  amountMsat: number;
  bolt11?: string;
  /** Solana-Zahloption (wenn der Provider sie anbietet). */
  solanaAddress?: string;
  amountLamports?: number;
  /** Usage-Transparenz (aus dem usage-Tag, wenn vorhanden). */
  usage?: {
    model?: string;
    promptTokens?: number;
    completionTokens?: number;
    toolCalls?: Array<{ name: string; kind: number; costMsat: number }>;
    sessionTotalMsat?: number;
  };
}

const MAX_USAGE_TOOLS = 50;
const MAX_USAGE_TEXT = 200;

function safeCount(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return undefined;
  return Math.min(Math.floor(v), Number.MAX_SAFE_INTEGER);
}

function safeText(v: unknown, max = MAX_USAGE_TEXT): string | undefined {
  if (typeof v !== "string") return undefined;
  // Steuerzeichen raus, Laenge begrenzen. Das Escaping bleibt Aufgabe der Anzeige.
  const clean = v.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max);
  return clean.length > 0 ? clean : undefined;
}

/**
 * Prueft das usage-Tag eines Provider-Ergebnisses gegen ein festes Schema.
 *
 * DIE LUECKE, DIE DAS SCHLIESST
 * Das Tag stammt vom Provider und wurde per JSON.parse ungeprueft
 * durchgereicht. Die App setzte promptTokens und completionTokens in
 * innerHTML ein – ein Provider konnte dort HTML mit Skript liefern und damit
 * Schluessel und NWC-Verbindung aus dem localStorage lesen.
 *
 * Jetzt: Zahlen nur als endliche, nicht negative Zahlen, Texte begrenzt,
 * unbekannte Felder verworfen. Das schuetzt jede Oberflaeche, die
 * parseJobResult() benutzt – auch spaetere Neufassungen der Anzeige.
 */
export function sanitizeUsage(raw: unknown): ParsedJobResult["usage"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: NonNullable<ParsedJobResult["usage"]> = {};
  const model = safeText(r.model, 100);
  if (model !== undefined) out.model = model;
  const pt = safeCount(r.promptTokens);
  if (pt !== undefined) out.promptTokens = pt;
  const ct = safeCount(r.completionTokens);
  if (ct !== undefined) out.completionTokens = ct;
  const st = safeCount(r.sessionTotalMsat);
  if (st !== undefined) out.sessionTotalMsat = st;
  if (Array.isArray(r.toolCalls)) {
    const tools: Array<{ name: string; kind: number; costMsat: number }> = [];
    for (const t of r.toolCalls.slice(0, MAX_USAGE_TOOLS)) {
      if (!t || typeof t !== "object") continue;
      const tt = t as Record<string, unknown>;
      const name = safeText(tt.name, 80);
      const kind = safeCount(tt.kind);
      const costMsat = safeCount(tt.costMsat);
      if (name === undefined || kind === undefined || costMsat === undefined) continue;
      tools.push({ name, kind, costMsat });
    }
    if (tools.length > 0) out.toolCalls = tools;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function parseJobResult(ev: UnsignedEvent): ParsedJobResult {
  if (!isDvmResult(ev.kind)) throw new Error(`kein DVM-Result-Kind: ${ev.kind}`);
  const e = getTag(ev, "e");
  const p = getTag(ev, "p");
  const amountTag = ev.tags.find((t) => t[0] === "amount");
  if (!e || !p || !amountTag) throw new Error("Result ohne e/p/amount-Tag");
  const solAddr = getTag(ev, "solana_address");
  const solAmt = getTag(ev, "amount_lamports");
  const usageTag = getTag(ev, "usage");
  let usage: ParsedJobResult["usage"];
  if (usageTag) {
    try {
      // Das Tag kommt vom Provider und ist damit Fremddaten. Nur das feste
      // Schema kommt durch – sonst landet z. B. HTML statt einer Zahl in der UI.
      usage = sanitizeUsage(JSON.parse(usageTag));
    } catch {
      usage = undefined;
    }
  }
  return {
    requestId: e,
    customerPubkey: p,
    providerPubkey: ev.pubkey,
    output: ev.content,
    amountMsat: Number(amountTag[1]),
    bolt11: amountTag[2],
    solanaAddress: solAddr,
    amountLamports: solAmt !== undefined ? Number(solAmt) : undefined,
    usage,
  };
}
