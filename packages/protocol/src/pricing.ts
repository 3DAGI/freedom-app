/**
 * Default-Preisliste (Nous-Portal-Stil): vorgegebene Preise, damit ein Provider
 * mit EINEM Klick startet und sofort im Markt ist.
 *
 * WICHTIG (Invarianten): Das sind DEFAULTS, kein Zwang. Jeder Provider kann
 * ueberschreiben (Markt). Aber der Default macht den Einstieg trivial und
 * gibt Nutzern eine erwartbare Preis-Erwartung. Kein Betreiber erzwingt sie.
 *
 * Einheit: sats pro 1k tokens (Text) bzw. sats pro Call (Tools).
 * In msat umgerechnet wo noetig (x1000).
 */

export interface ModelPrice {
  /** Anzeigename / Ollama-Modell. */
  model: string;
  tier: "free" | "classic" | "pro";
  /** sats pro 1k INPUT tokens. */
  inputSatsPerK: number;
  /** sats pro 1k OUTPUT tokens. */
  outputSatsPerK: number;
}

export interface ToolDefaultPrice {
  kind: number;
  name: string;
  /** sats pro Call. */
  satsPerCall: number;
}

/** Default-Modellpreise — an OpenRouter (openrouter.ai) angelehnt, in sats
 *  (1 sat ~ $0.001, gerundet). OpenRouter-Referenz ($/1M tokens):
 *  Qwen3-235B $0.09/$0.10, DeepSeek-V4-Flash $0.14/$0.28, GLM-4.6 $0.43/$1.74,
 *  Llama-4-Maverick $0.15/$0.60, GLM-4.7 $2.25/$2.75, Qwen3.6-Plus ~$2/$6.
 *  Umrechnung: $X/1M = X sats/1k... d.h. $0.10/1M out = 0.1 sats/1k (gerundet).
 *  Hardware-Tiers: free=Seeker/Phone, classic=Desktop/Mac, pro=GB10/Spark. */
export const DEFAULT_MODEL_PRICES: ModelPrice[] = [
  // ---- free: Seeker/Phone/Edge (lokal providen auf dem Geraet) ----
  { model: "gemma4:e2b", tier: "free", inputSatsPerK: 0, outputSatsPerK: 0 },  // quad-modal, <1.5GB
  { model: "gemma4:e4b", tier: "free", inputSatsPerK: 0, outputSatsPerK: 0 },
  { model: "qwen3:1.7b", tier: "free", inputSatsPerK: 0, outputSatsPerK: 0 },
  { model: "qwen3:0.6b", tier: "free", inputSatsPerK: 0, outputSatsPerK: 0 },
  { model: "phi4-mini:3.8b", tier: "free", inputSatsPerK: 0, outputSatsPerK: 0 },
  // ---- classic: Desktop-GPU (8-24GB) / Mac (MLX) ----
  // OpenRouter: Qwen3-235B $0.09/$0.10, DSv4-Flash $0.14/$0.28 -> 0.1-0.3 sats/1k (auf 1 gerundet)
  { model: "qwen3.5:4b", tier: "classic", inputSatsPerK: 1, outputSatsPerK: 1 },
  { model: "qwen3.5:9b", tier: "classic", inputSatsPerK: 1, outputSatsPerK: 1 },
  { model: "gemma4:12b", tier: "classic", inputSatsPerK: 1, outputSatsPerK: 1 },
  { model: "deepseek-v4:flash", tier: "classic", inputSatsPerK: 1, outputSatsPerK: 2 },  // $0.14/$0.28
  { model: "gemma4:26b-a4b", tier: "classic", inputSatsPerK: 1, outputSatsPerK: 2 },     // MoE
  { model: "qwen3.6:35b-a3b", tier: "classic", inputSatsPerK: 1, outputSatsPerK: 2 },
  // ---- pro: GB10 / DGX Spark (128GB) / Cluster ----
  // OpenRouter: GLM-4.6 $0.43/$1.74, Llama-4-Mav $0.15/$0.60, Qwen3.6-Plus ~$2/$6
  { model: "deepseek-v4:pro", tier: "pro", inputSatsPerK: 1, outputSatsPerK: 2 },      // 1x Spark
  { model: "glm4.6", tier: "pro", inputSatsPerK: 1, outputSatsPerK: 2 },               // $0.43/$1.74
  { model: "qwen3.6:plus", tier: "pro", inputSatsPerK: 2, outputSatsPerK: 6 },          // ~$2/$6, 1x Spark
  { model: "glm5.2", tier: "pro", inputSatsPerK: 2, outputSatsPerK: 3 },               // 2x Spark
  { model: "glm5.2:nvfp4-128k", tier: "pro", inputSatsPerK: 3, outputSatsPerK: 6 },    // 4x Cluster
  { model: "deepseek-v4:pro-8x", tier: "pro", inputSatsPerK: 4, outputSatsPerK: 10 },  // 8x Spark
];

/** Default-Toolpreise (sats pro Call) — an Nous Portal angelehnt:
 *  web_search $0.0053 -> ~5 sats; browser $0.0147 -> ~15; image flux2pro $0.0315 -> ~30.
 *  (Auf ganze sats gerundet; Provider kann ueberschreiben.) */
export const DEFAULT_TOOL_PRICES: ToolDefaultPrice[] = [
  { kind: 5060, name: "web_search", satsPerCall: 5 },
  { kind: 5061, name: "file_io", satsPerCall: 1 },
  { kind: 5062, name: "browser_use", satsPerCall: 15 },
  { kind: 5070, name: "image_gen", satsPerCall: 30 },
  // video_gen: Basis-Preis (Referenz 6s @768p = 180 sats). Echter Preis
  // = videoPriceSats(sekunden, aufloesung) — siehe DEFAULT_VIDEO_PRICES.
  { kind: 5071, name: "video_gen_minimax_h3", satsPerCall: 180 },
];

/** Video-Preise: PRO SEKUNDE + Aufloesung (Qualitaet/Laenge machen den
 *  Leistungs-Unterschied — flat-Preis waere unfair). Referenz Minimax/OpenRouter:
 *  512p ~$0.01/s, 768p ~$0.03/s, 1080p ~$0.047/s (Hailuo-2.3). In sats
 *  (1 sat ~ $0.001): 512p 10/s, 768p 30/s, 1080p 47/s. */
export interface VideoPrice {
  resolution: string;      // "512p" | "768p" | "1080p"
  satsPerSecond: number;
}
export const DEFAULT_VIDEO_PRICES: VideoPrice[] = [
  { resolution: "512p", satsPerSecond: 10 },
  { resolution: "768p", satsPerSecond: 30 },
  { resolution: "1080p", satsPerSecond: 47 },
];

/** Video-Preis berechnen: Sekunden * Rate der Aufloesung. */
export function videoPriceSats(seconds: number, resolution = "768p"): number {
  const p = DEFAULT_VIDEO_PRICES.find((v) => v.resolution === resolution)
    ?? DEFAULT_VIDEO_PRICES[1];
  return Math.max(1, Math.round(seconds * p.satsPerSecond));
}

/** Preis eines Tools nach Kind (Default-Liste). */
export function defaultToolPrice(kind: number): ToolDefaultPrice | undefined {
  return DEFAULT_TOOL_PRICES.find((t) => t.kind === kind);
}

/** Preis fuer ein Modell (Default; Provider kann ueberschreiben). */
export function defaultPriceFor(model: string): ModelPrice | undefined {
  return DEFAULT_MODEL_PRICES.find((m) => m.model === model);
}

/** Berechnet den Preis einer Text-Antwort in sats (Default-Liste). */
export function textPriceSats(model: string, promptTokens: number, completionTokens: number): number {
  const p = defaultPriceFor(model);
  if (!p) return Math.ceil((promptTokens + completionTokens) / 1000); // fallback 1 sat/1k
  return Math.ceil((promptTokens / 1000) * p.inputSatsPerK + (completionTokens / 1000) * p.outputSatsPerK);
}
