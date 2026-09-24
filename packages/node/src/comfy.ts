/**
 * ComfyUI-Executor: echtes image_gen + video_gen gegen ein lokales ComfyUI.
 *
 * Reicht einen Workflow als Prompt-Graph an die ComfyUI-API (/prompt) und
 * pollt /history bis das Ergebnis (Bild/Video) fertig ist. Lokal, kein Cloud-Call.
 *
 * v1: image_gen via CheckpointLoaderSimple + KSampler (SDXL, vorhanden).
 *     video_gen via Minimax H3 (Workflow vom Provider, sobald H3-Nodes aktiv).
 */

export interface ComfyConfig {
  baseUrl: string;         // z.B. http://127.0.0.1:8188
  checkpoint?: string;     // z.B. sd_xl_base_1.0.safetensors
  timeoutMs?: number;
}

export interface ComfyResult {
  ok: boolean;
  /** Dateiname(n) der Ausgabe in ComfyUI output/. */
  files: string[];
  /** Vollstaendige URLs (baseUrl/view?filename=...). */
  urls: string[];
  error?: string;
  durationMs: number;
}

/** Baut einen minimalen SDXL-Text2Img-Workflow. */
function sdxlWorkflow(prompt: string, checkpoint: string, seed: number, steps = 20): Record<string, unknown> {
  return {
    "3": { class_type: "KSampler", inputs: { seed, steps, cfg: 7.0, sampler_name: "euler", scheduler: "normal", denoise: 1.0, model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } },
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: checkpoint } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["4", 1] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: "lowres, bad anatomy, blurry, watermark", clip: ["4", 1] } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
    "9": { class_type: "SaveImage", inputs: { filename_prefix: "freedom", images: ["8", 0] } },
  };
}

export class ComfyExecutor {
  constructor(private cfg: ComfyConfig) {}

  async up(): Promise<boolean> {
    try {
      const r = await fetch(`${this.cfg.baseUrl}/system_stats`, { signal: AbortSignal.timeout(4000) });
      return r.ok;
    } catch { return false; }
  }

  /** image_gen: SDXL text2img. Gibt URLs der erzeugten Bilder. */
  async generateImage(prompt: string): Promise<ComfyResult> {
    const start = Date.now();
    const timeout = this.cfg.timeoutMs ?? 120_000;
    const checkpoint = this.cfg.checkpoint ?? "sd_xl_base_1.0.safetensors";
    const seed = Math.floor(Math.random() * 2 ** 32);
    try {
      const wf = sdxlWorkflow(prompt, checkpoint, seed);
      const res = await fetch(`${this.cfg.baseUrl}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: wf }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`prompt HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const { prompt_id } = (await res.json()) as { prompt_id: string };
      // Poll history bis fertig
      const deadline = start + timeout;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        const h = await fetch(`${this.cfg.baseUrl}/history/${prompt_id}`, { signal: AbortSignal.timeout(8000) });
        if (!h.ok) continue;
        const hd = (await h.json()) as Record<string, { status?: { completed?: boolean }; outputs?: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }> }>;
        const entry = hd[prompt_id];
        if (entry?.status?.completed || (entry?.outputs && Object.keys(entry.outputs).length > 0)) {
          const files: string[] = [];
          for (const out of Object.values(entry.outputs ?? {})) {
            for (const img of out.images ?? []) files.push(img.filename);
          }
          const urls = files.map((f) => `${this.cfg.baseUrl}/view?filename=${encodeURIComponent(f)}`);
          return { ok: files.length > 0, files, urls, durationMs: Date.now() - start };
        }
      }
      return { ok: false, files: [], urls: [], error: "timeout", durationMs: Date.now() - start };
    } catch (e) {
      return { ok: false, files: [], urls: [], error: (e as Error).message, durationMs: Date.now() - start };
    }
  }

  /** video_gen (MiniMax H3, Text-to-Video MIT Audio) via NATIVE ComfyUI nodes.
   *  fp8_scaled DiT + nvfp4 TE + video_vae fp16 + audio_vae fp32.
   *  length_frames @24fps (33 = ~1.4s). */
  async generateVideo(prompt: string, opts: { width?: number; height?: number; length?: number; steps?: number; seed?: number } = {}): Promise<ComfyResult> {
    const start = Date.now();
    const timeout = this.cfg.timeoutMs ?? 600_000;
    const length = opts.length ?? 33;
    const steps = opts.steps ?? 20;
    const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 32);
    const w = opts.width ?? 768, h = opts.height ?? 432;
    const wf: Record<string, unknown> = {
      "1": { class_type: "UNETLoader", inputs: { unet_name: "minimax_h3_fl2va_pruned_fp8_scaled.safetensors", weight_dtype: "default" } },
      "2": { class_type: "CLIPLoader", inputs: { clip_name: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", type: "minimax" } },
      "3": { class_type: "VAELoader", inputs: { vae_name: "minimax_h3_video_vae_fp16.safetensors" } },
      "4": { class_type: "VAELoader", inputs: { vae_name: "minimax_h3_audio_vae_fp32.safetensors" } },
      "5": { class_type: "MiniMaxH3ImageToVideo", inputs: { clip: ["2", 0], vae: ["3", 0], prompt, width: w, height: h, length } },
      "6": { class_type: "EmptyMiniMaxH3LatentAV", inputs: { width: w, height: h, length, batch_size: 1 } },
      "7": { class_type: "KSampler", inputs: { model: ["1", 0], positive: ["5", 0], negative: ["5", 0], latent_image: ["6", 0], seed, steps, cfg: 5.0, sampler_name: "euler", scheduler: "normal", denoise: 1.0 } },
      "8": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["3", 0] } },
      "9": { class_type: "CreateVideo", inputs: { images: ["8", 0], fps: 24 } },
      "10": { class_type: "SaveVideo", inputs: { video: ["9", 0], filename_prefix: "freedom_h3", format: "mp4", codec: "h264" } },
    };
    try {
      const res = await fetch(`${this.cfg.baseUrl}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: wf }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`prompt HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const { prompt_id } = (await res.json()) as { prompt_id: string };
      const deadline = start + timeout;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 5000));
        const h = await fetch(`${this.cfg.baseUrl}/history/${prompt_id}`, { signal: AbortSignal.timeout(10000) });
        if (!h.ok) continue;
        const hd = (await h.json()) as Record<string, { status?: { completed?: boolean; status_str?: string; messages?: Array<[string, { exception_message?: string }?]> }; outputs?: Record<string, { videos?: Array<{ filename: string }>; gifs?: Array<{ filename: string }>; images?: Array<{ filename: string }> }> }>;
        const entry = hd[prompt_id];
        if (entry?.status?.status_str === "error") {
          const errMsg = entry.status.messages?.find((m) => m[0] === "execution_error")?.[1]?.exception_message ?? "execution error";
          return { ok: false, files: [], urls: [], error: errMsg, durationMs: Date.now() - start };
        }
        if (entry?.status?.completed || (entry?.outputs && Object.keys(entry.outputs).length > 0)) {
          const files: string[] = [];
          for (const out of Object.values(entry.outputs ?? {})) {
            for (const v of out.videos ?? []) files.push(v.filename);
            for (const g of out.gifs ?? []) files.push(g.filename);
            for (const i of out.images ?? []) files.push(i.filename);
          }
          const urls = files.map((f) => `${this.cfg.baseUrl}/view?filename=${encodeURIComponent(f)}`);
          return { ok: files.length > 0, files, urls, durationMs: Date.now() - start };
        }
      }
      return { ok: false, files: [], urls: [], error: "timeout", durationMs: Date.now() - start };
    } catch (e) {
      return { ok: false, files: [], urls: [], error: (e as Error).message, durationMs: Date.now() - start };
    }
  }
}
