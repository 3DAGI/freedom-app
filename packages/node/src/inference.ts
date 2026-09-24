/**
 * Inference-Backend-Interface.
 *
 * Der Provider-Knoten ist modell-agnostisch: Alles, was Text rein/raus kann,
 * ist ein Backend. Erste Implementierung: Ollama (lokal, GX10). Spaeter:
 * beliebige OpenAI-kompatible Endpunkte.
 *
 * Wichtig: On-Device-Inferenz ist der Resistenz-Fallback des Protokolls —
 * KI-Jobs muessen ohne jede Cloud-Abhaengigkeit funktionieren.
 */
export interface InferenceRequest {
  jobId: string;
  prompt: string;
  model?: string;
  maxTokens?: number;
  /** Konversations-Kontext (Live-Chat): bisherige Messages der Session.
   *  Aufbau: [{role:'user'|'assistant', content}] — aelteste zuerst. */
  history?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  /** Swarm-Modus: mehrere Modelle parallel befragen und synthetisieren. */
  swarm?: boolean;
  /** Live-Fortschritt (z.B. "tool:web_search") — Provider publiziert als
   *  kind-7000 progress an den Kunden. Optional, fire-and-forget. */
  onProgress?: (step: string) => void;
}

export interface InferenceResult {
  output: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
}

export interface InferenceBackend {
  name(): string;
  /** true, wenn das Backend lokal und ohne Cloud erreichbar ist. */
  available(): Promise<boolean>;
  complete(req: InferenceRequest): Promise<InferenceResult>;
  /** Optional: Streaming (SSE-artig, tokenweise). Fuer Live-Chat-UX. */
  stream?(req: InferenceRequest, onToken: (t: string) => void): Promise<InferenceResult>;
}

/** Tool-Definition fuer Ollama Tool-Calling (JSON Schema). */
interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string; enum?: string[] }>;
      required: string[];
    };
  };
}

/** Lokale Inferenz ueber Ollama (Standard auf dem GX10, Port 11434). */
export class OllamaBackend implements InferenceBackend {
  constructor(
    private baseUrl = process.env.OLLAMA_URL ?? "http://localhost:11434",
    private defaultModel = process.env.OLLAMA_MODEL ?? "nemotron-3.5-lightning:30b-a3b-nvfp4",
  ) {}

  name(): string {
    return `ollama(${this.defaultModel})`;
  }

  async available(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Swarm-Modus: beide Modelle parallel befragen und synthetisieren. */
  private async completeSwarm(req: InferenceRequest): Promise<InferenceResult> {
    const start = Date.now();
    const models = ["nemotron-3.5-lightning:30b-a3b-nvfp4", "qwen3.8:27b"];

    // System-prompt fuer Swarm
    const SYS = `Du bist ein KI-Agent im Freedom Protocol. Beantworte die Frage direkt und hilfreich.`;

    const messages = [
      { role: "system" as const, content: SYS },
      ...(req.history ?? []),
      { role: "user" as const, content: req.prompt },
    ];

    // Beide Modelle parallel befragen
    const results = await Promise.all(
      models.map(async (model) => {
        try {
          const res = await fetch(`${this.baseUrl}/api/chat`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model,
              messages,
              stream: false,
              options: req.maxTokens ? { num_predict: req.maxTokens } : undefined,
            }),
            signal: AbortSignal.timeout(120_000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = (await res.json()) as {
            message?: { content?: string };
            prompt_eval_count?: number;
            eval_count?: number;
          };
          return {
            model,
            output: data.message?.content ?? "",
            promptTokens: data.prompt_eval_count ?? 0,
            completionTokens: data.eval_count ?? 0,
          };
        } catch (e) {
          return {
            model,
            output: `fehler: ${(e as Error).message}`,
            promptTokens: 0,
            completionTokens: 0,
          };
        }
      })
    );

    // Synthese: qwen3.8:27b als Judge (besseres Reasoning)
    const judgeModel = "qwen3.8:27b";
    const combined = results.map((r, i) => `[Antwort ${i + 1} von ${r.model}]:\n${r.output}`).join("\n\n");
    const judgePrompt = `Bewerte diese ${results.length} Antworten auf die Frage "${req.prompt}" und gib die beste/synthetisierte Antwort. Sei direkt und praegnant:\n\n${combined}`;

    const judgeRes = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: judgeModel,
        messages: [
          { role: "system", content: "Du bist ein Judge der Antworten bewertet und synthetisiert." },
          { role: "user", content: judgePrompt },
        ],
        stream: false,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!judgeRes.ok) throw new Error(`Judge HTTP ${judgeRes.status}`);
    const judgeData = (await judgeRes.json()) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };

    return {
      output: judgeData.message?.content ?? "Keine Synthese moeglich.",
      model: `swarm(${models.join("+")})`,
      promptTokens: results.reduce((s, r) => s + r.promptTokens, 0) + (judgeData.prompt_eval_count ?? 0),
      completionTokens: results.reduce((s, r) => s + r.completionTokens, 0) + (judgeData.eval_count ?? 0),
      durationMs: Date.now() - start,
    };
  }

  /** Tool-Schemas fuer Ollama Tool-Calling. */
  private getTools(): ToolSchema[] {
    return [
      {
        type: "function",
        function: {
          name: "web_search",
          description: "Search the web for current information. Use for facts, news, prices, events.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query (be specific)" },
            },
            required: ["query"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "image_gen",
          description: "Generate an image from a text prompt using local AI.",
          parameters: {
            type: "object",
            properties: {
              prompt: { type: "string", description: "Image description (detailed)" },
            },
            required: ["prompt"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "video_gen",
          description: "Generate a video from a text prompt using local ComfyUI/H3.",
          parameters: {
            type: "object",
            properties: {
              prompt: { type: "string", description: "Video description (detailed)" },
            },
            required: ["prompt"],
          },
        },
      },
    ];
  }

  async complete(req: InferenceRequest): Promise<InferenceResult> {
    // Swarm-Modus: beide Modelle parallel befragen und synthetisieren
    if (req.swarm) {
      return this.completeSwarm(req);
    }

    // System-prompt: Freedom-Protocol-Agent mit Tool-Calling.
    const SYS = `Du bist ein KI-Agent im Freedom Protocol — einem dezentralen, betreiberlosen Netzwerk fuer Kommunikation, KI-Nutzung und Werttransfer.

KORREKTE DEFINITIONEN:
- Nostr: "Notes and Other Stuff Transmitted by Relays" — dezentrales Protokoll fuer zensurresistente Kommunikation.
- DVM: "Data Vending Machine" (NIP-90) — System fuer bezahlte KI-Jobs (kind 5050 Request, 6050 Result).
- Zaps: NIP-57 — Lightning-Zahlungen in Nostr-Events.
- Streaming-Sats: Session-basierte Zahlungen (kind 38020-38022).
- Non-custodial: Das Protokoll haelt NIE fremde Gelder.

HOSTING: Freedom ist ein PROTOKOLL, kein Server. Laeuft ueber MEHRERE Relays. GX10 ist nur EIN Provider von vielen.

DEINE ROLLE:
- Du laeuffst auf EINEM Provider-Knoten (GX10) im Freedom-Netz
- Du kannst Fragen zum Freedom Protocol beantworten
- Du hast Tools: web_search, image_gen, video_gen — nutze sie wenn noetig!

WICHTIG:
- Antworte direkt und hilfreich in der Sprache des Nutzers
- Wenn du etwas nicht weisst: sage es ehrlich — "Das weiss ich nicht" ist besser als eine falsche Antwort
- Kurze, praegnante Antworten
- Keine JSON-Ausgabe, keine Quizzes, keine Werbung
- Fuer AKTUELLE Infos (Datum, Preise, News): IMMER web_search nutzen, nicht aus dem Gedaechtnis antworten!
- Dein Knowledge-Cutoff ist Ende 2024 — alles danach musst du suchen!
- Wenn das Suchergebnis nicht klar ist: sage "Das Suchergebnis ist nicht eindeutig" statt zu raten`;

    const model = req.model ?? this.defaultModel;
    const start = Date.now();
    const messages = [
      { role: "system" as const, content: SYS },
      ...(req.history ?? []),
      { role: "user" as const, content: req.prompt },
    ];

    // Tool-Calling Loop: LLM entscheidet selbst, welche Tools es nutzt
    const tools = this.getTools();
    let finalOutput = "";
    let promptTokens = 0;
    let completionTokens = 0;

    // Max 5 Tool-Runden (verhindert Endlos-Loop)
    for (let round = 0; round < 5; round++) {
      console.log(`[tool-loop] Runde ${round + 1}, messages: ${messages.length}`);
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          tools,
          options: req.maxTokens ? { num_predict: req.maxTokens } : undefined,
        }),
        signal: AbortSignal.timeout(120_000),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => "unlesbar");
        throw new Error(`Ollama HTTP ${res.status}: ${errBody.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        message?: {
          content?: string;
          tool_calls?: Array<{
            function: { name: string; arguments: Record<string, string> };
          }>;
        };
        prompt_eval_count?: number;
        eval_count?: number;
      };

      promptTokens += data.prompt_eval_count ?? 0;
      completionTokens += data.eval_count ?? 0;

      const msg = data.message;
      if (!msg) break;

      // Keine Tool-Aufrufe? Fertig!
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        console.log(`[tool-loop] Keine tool_calls, finale Antwort: ${msg.content?.slice(0, 100)}`);
        finalOutput = msg.content ?? "";
        break;
      }

      console.log(`[tool-loop] ${msg.tool_calls.length} tool_calls:`, msg.tool_calls.map((c) => c.function.name));

      // Tool-Aufrufe ausfuehren und zur History hinzufuegen
      for (const call of msg.tool_calls) {
        const toolName = call.function.name;
        const args = call.function.arguments;
        // Live-Fortschritt an den Kunden (kind-7000 progress)
        try { req.onProgress?.(`tool:${toolName}`); } catch { /* best-effort */ }

        // Tool ausfuehren (lokal, kein externer Call)
        const toolResult = await this.executeTool(toolName, args);

        // Assistant-Message mit tool_call (wie Ollama es erwartet)
        messages.push({
          role: "assistant",
          content: msg.content ?? "",
          tool_calls: [call],
        } as never);
        // Tool-Ergebnis als tool-Message
        messages.push({
          role: "tool",
          content: toolResult,
          name: toolName,
        } as never);

        // NEU: Nach web_search explizit sagen, dass das Ergebnis reicht
        if (toolName === "web_search") {
          messages.push({
            role: "user",
            content: "Das web_search Ergebnis ist ausreichend. Bitte antworte jetzt direkt mit diesem Wissen, ohne weitere Tool-Aufrufe.",
          });
        }

        // NEU: Nach image_gen/video_gen direkt zur Antwort zwingen
        if (toolName === "image_gen" || toolName === "video_gen") {
          messages.push({
            role: "user",
            content: `Das ${toolName} Ergebnis ist da. Bitte antworte jetzt mit dem Link/Ergebnis.`,
          });
        }
      }
      // Weiter zum naechsten Loop-Durchlauf — LLM antwortet auf Tool-Ergebnis
    }

    return {
      output: finalOutput || "Keine Antwort generiert.",
      model,
      promptTokens,
      completionTokens,
      durationMs: Date.now() - start,
    };
  }

  /** Tool lokal ausfuehren (kein externer API-Call). */
  private async executeTool(name: string, args: Record<string, string>): Promise<string> {
    switch (name) {
      case "web_search":
        return this.webSearch(args.query ?? "");
      case "image_gen":
        return this.imageGen(args.prompt ?? "");
      case "video_gen":
        return this.videoGen(args.prompt ?? "");
      default:
        return `Unbekanntes Tool: ${name}`;
    }
  }

  /** Playwright-Browser (always-on, lazy-start). */
  private browser: import("playwright").Browser | null = null;
  private browserStarting: Promise<import("playwright").Browser> | null = null;

  /** Startet den Browser im Hintergrund (sofort beim ersten Aufruf). */
  private async ensureBrowser(): Promise<import("playwright").Browser> {
    if (this.browser) return this.browser;
    if (this.browserStarting) return this.browserStarting;

    this.browserStarting = (async () => {
      // Playwright ist eine OPTIONALE Abhaengigkeit (~300 MB inkl. Browser).
      // Die meisten Provider brauchen keine Browser-Automatisierung; ihnen
      // das beim Installieren aufzuzwingen war der falsche Standardfall.
      // Fehlt sie, gibt es eine klare Anleitung statt eines Stacktrace.
      let chromium;
      try {
        ({ chromium } = await import("playwright"));
      } catch {
        this.browserStarting = null;
        throw new Error(
          "Browser-Automatisierung ist nicht installiert. Bei Bedarf nachruesten: " +
          "npm install playwright && npx playwright install chromium",
        );
      }
      try {
        const browser = await chromium.launch({ headless: true });
        this.browser = browser;
        return browser;
      } catch (e) {
        this.browserStarting = null;
        throw new Error(
          `Browser liess sich nicht starten (${(e as Error).message}). ` +
          "Fehlt evtl. der Browser selbst: npx playwright install chromium",
        );
      }
    })();

    return this.browserStarting;
  }

  /** Schliesst den Browser (beim Provider-Stop). */
  async closeBrowser(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.browserStarting = null;
    }
  }

  /** web_search: DuckDuckGo HTML + Playwright-Fallback (echte Browser-Suche). */
  private async webSearch(query: string): Promise<string> {
    // Versuch 1: DuckDuckGo Instant Answer (kostenlos, kein Key)
    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&no_redirect=1`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const d = (await res.json()) as { AbstractText?: string; AbstractURL?: string; Heading?: string; Answer?: string; AnswerType?: string };
        if (d.AbstractText) {
          return `${d.Heading ?? ""}: ${d.AbstractText} (${d.AbstractURL ?? ""})`.trim();
        }
        if (d.Answer) {
          return `Antwort: ${d.Answer}`;
        }
      }
    } catch (e) {
      console.warn(`[web_search] DuckDuckGo Instant Answer fehlgeschlagen: ${(e as Error).message}`);
    }

    // Versuch 2: DuckDuckGo HTML (scraping, falls Instant Answer leer)
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const html = await res.text();
        const results = html.match(/result__a[^>]*>([^<]+)<\/a>/g)?.slice(0, 3) ?? [];
        if (results.length > 0) {
          const links = results.map((r) => {
            const m = r.match(/href="([^"]+)"[^>]*>([^<]+)/);
            return m ? `${m[2]}: ${m[1]}` : null;
          }).filter(Boolean);
          return `Top-Ergebnisse:\n${links.join("\n")}`;
        }
      }
    } catch (e) {
      console.warn(`[web_search] DuckDuckGo HTML fehlgeschlagen: ${(e as Error).message}`);
    }

    // Versuch 3: Playwright (echte Browser-Suche mit JavaScript-Rendering)
    try {
      const browser = await this.ensureBrowser();
      const page = await browser.newPage();
      await page.goto(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { timeout: 15000 });
      await page.waitForSelector(".result__a", { timeout: 10000 });
      const results = await page.$$eval(".result__a", (els) =>
        els.slice(0, 3).map((el) => {
          const a = el as HTMLAnchorElement;
          return `${a.textContent}: ${a.href}`;
        })
      );
      await page.close();
      if (results.length > 0) {
        return `Top-Ergebnisse (Playwright):\n${results.join("\n")}`;
      }
    } catch (e) {
      console.warn(`[web_search] Playwright fehlgeschlagen: ${(e as Error).message}`);
    }

    return "Keine Suchergebnisse gefunden. Versuche eine spezifischere Query oder pruefe die offizielle Website direkt.";
  }

  /** image_gen: Stable Diffusion via ComfyUI (lokal). */
  private async imageGen(prompt: string): Promise<string> {
    try {
      // ComfyUI Workflow fuer einfaches Text-zu-Bild
      const workflow = {
        "1": {
          class_type: "CheckpointLoaderSimple",
          inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" },
        },
        "2": {
          class_type: "CLIPTextEncode",
          inputs: { text: prompt, clip: ["1", 1] },
        },
        "3": {
          class_type: "CLIPTextEncode",
          inputs: { text: "blurry, low quality, distorted", clip: ["1", 1] },
        },
        "4": {
          class_type: "EmptyLatentImage",
          inputs: { width: 1024, height: 1024, batch_size: 1 },
        },
        "5": {
          class_type: "KSampler",
          inputs: {
            seed: Math.floor(Math.random() * 1000000),
            steps: 20,
            cfg: 7.0,
            sampler_name: "euler",
            scheduler: "normal",
            denoise: 1.0,
            model: ["1", 0],
            positive: ["2", 0],
            negative: ["3", 0],
            latent_image: ["4", 0],
          },
        },
        "6": {
          class_type: "VAEDecode",
          inputs: { samples: ["5", 0], vae: ["1", 2] },
        },
        "7": {
          class_type: "SaveImage",
          inputs: { images: ["6", 0], filename_prefix: "freedom_gen" },
        },
      };

      const res = await fetch("http://localhost:8188/prompt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: workflow }),
        signal: AbortSignal.timeout(300_000), // 5min fuer grosse Modelle
      });

      if (!res.ok) throw new Error(`ComfyUI HTTP ${res.status}`);
      const data = (await res.json()) as { prompt_id?: string };
      const promptId = data.prompt_id;
      if (!promptId) throw new Error("kein prompt_id von ComfyUI");

      // Warte auf Fertigstellung (polling)
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 5000)); // 5s warten
        const statusRes = await fetch(`http://localhost:8188/history/${promptId}`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!statusRes.ok) continue;
        const status = (await statusRes.json()) as Record<string, { status?: { completed?: boolean; messages?: Array<[string, { exception_message?: string }]> } }>;
        const entry = status[promptId];
        if (entry?.status?.completed) {
          // Erfolg! Finde das generierte Bild
          const outputs = entry as unknown as { outputs?: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }> };
          const images = outputs.outputs?.["7"]?.images;
          if (images && images.length > 0) {
            const img = images[0];
            const url = `http://localhost:8188/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`;
            return `Bild generiert: ${url}`;
          }
          return "Bild generiert, aber kein Output gefunden.";
        }
        if (entry?.status?.messages?.some((m) => m[0] === "execution_error")) {
          const err = entry.status.messages.find((m) => m[0] === "execution_error");
          throw new Error(`ComfyUI Fehler: ${err?.[1]?.exception_message ?? "unbekannt"}`);
        }
      }
      throw new Error("Timeout — Bild-Generierung dauert zu lange");
    } catch (e) {
      return `fehler: ${(e as Error).message}`;
    }
  }

  /** video_gen: Minimax H3 via ComfyUI (lokal). Nativer Workflow — kein RH-Plugin. */
  private async videoGen(prompt: string): Promise<string> {
    try {
      // Nativer ComfyUI Workflow fuer Minimax H3 Video (fp8_scaled)
      // Basierend auf dem erfolgreichen h3test.mp4 Workflow
      const workflow = {
        "1": {
          class_type: "UNETLoader",
          inputs: { unet_name: "minimax_h3_fl2va_pruned_fp8_scaled.safetensors", weight_dtype: "default" },
        },
        "2": {
          class_type: "CLIPLoader",
          inputs: { clip_name: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", type: "minimax" },
        },
        "3": {
          class_type: "VAELoader",
          inputs: { vae_name: "minimax_h3_video_vae_fp16.safetensors" },
        },
        "4": {
          class_type: "MiniMaxH3ImageToVideo",
          inputs: {
            clip: ["2", 0],
            vae: ["3", 0],
            prompt: prompt,
            width: 768,
            height: 432,
            length: 25,
          },
        },
        "5": {
          class_type: "KSampler",
          inputs: {
            seed: Math.floor(Math.random() * 1000000),
            steps: 20,
            cfg: 7.0,
            sampler_name: "euler",
            scheduler: "normal",
            denoise: 1.0,
            model: ["1", 0],
            positive: ["4", 0],
            negative: ["4", 0],
            latent_image: ["4", 1],
          },
        },
        "6": {
          class_type: "VAEDecode",
          inputs: { samples: ["5", 0], vae: ["3", 0] },
        },
        "7": {
          class_type: "CreateVideo",
          inputs: { images: ["6", 0], fps: 8.0 },
        },
        "8": {
          class_type: "SaveVideo",
          inputs: { video: ["7", 0], filename_prefix: "freedom_video", format: "mp4", codec: "h264" },
        },
      };

      const res = await fetch("http://localhost:8188/prompt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: workflow }),
        signal: AbortSignal.timeout(600_000), // 10min fuer Video
      });

      if (!res.ok) throw new Error(`ComfyUI HTTP ${res.status}`);
      const data = (await res.json()) as { prompt_id?: string };
      const promptId = data.prompt_id;
      if (!promptId) throw new Error("kein prompt_id von ComfyUI");

      // Warte auf Fertigstellung (polling)
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 5000)); // 5s warten
        const statusRes = await fetch(`http://localhost:8188/history/${promptId}`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!statusRes.ok) continue;
        const status = (await statusRes.json()) as Record<string, { status?: { completed?: boolean; messages?: Array<[string, { exception_message?: string }]> } }>;
        const entry = status[promptId];
        if (entry?.status?.completed) {
          // Erfolg! Finde das generierte Video
          const outputs = entry as unknown as { outputs?: Record<string, { videos?: Array<{ filename: string; subfolder: string; type: string }> }> };
          const videos = outputs.outputs?.["12"]?.videos;
          if (videos && videos.length > 0) {
            const vid = videos[0];
            const url = `http://localhost:8188/view?filename=${encodeURIComponent(vid.filename)}&subfolder=${encodeURIComponent(vid.subfolder)}&type=${vid.type}`;
            return `Video generiert: ${url}`;
          }
          return "Video generiert, aber kein Output gefunden.";
        }
        if (entry?.status?.messages?.some((m) => m[0] === "execution_error")) {
          const err = entry.status.messages.find((m) => m[0] === "execution_error");
          throw new Error(`ComfyUI Fehler: ${err?.[1]?.exception_message ?? "unbekannt"}`);
        }
      }
      throw new Error("Timeout — Video-Generierung dauert zu lange");
    } catch (e) {
      return `fehler: ${(e as Error).message}`;
    }
  }

  /** Streaming-Variante (tokenweise via onToken). */
  async stream(req: InferenceRequest, onToken: (t: string) => void): Promise<InferenceResult> {
    return this.chat(req, true, onToken);
  }

  /** Ollama /api/chat: Messages-Format (history + prompt als letzte user-Message). */
  private async chat(
    req: InferenceRequest,
    stream: boolean,
    onToken?: (t: string) => void,
  ): Promise<InferenceResult> {
    const model = req.model ?? this.defaultModel;
    const start = Date.now();
    const messages = [
      ...(req.history ?? []),
      { role: "user" as const, content: req.prompt },
    ];
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream,
        options: req.maxTokens ? { num_predict: req.maxTokens } : undefined,
      }),
    });
    if (!res.ok) throw new Error(`Ollama chat HTTP ${res.status}`);

    // Nemotron & Co: Reasoning-Trace aus der Antwort entfernen. Das Modell
    // schreibt "Here's a thinking process: ... 4. Final answer: X" — der
    // Kunde will nur X. Stripping gilt für non-stream und stream.
    const stripThinking = (s: string): string => {
      let out = s;
      // <think>...</think> blocks (deepseek-style)
      out = out.replace(/<think>[\s\S]*?<\/think>\s*/g, "");
      // "Here's a thinking process: ... Final[ly]*[ answer]*:" prose-trace
      const traceRe = /(?:here'?s|here is)?\s*(?:a\s+)?thinking process[\s\S]*?(?:final(?:ly)?(?:\s+answer)?|answer)\s*[:：]\s*/i;
      const m = out.match(traceRe);
      if (m && m.index !== undefined) out = out.slice(m.index + m[0].length);
      return out.trim();
    };

    if (!stream) {
      const data = (await res.json()) as {
        message?: { content?: string };
        prompt_eval_count?: number;
        eval_count?: number;
      };
      return {
        output: stripThinking(data.message?.content ?? ""),
        model,
        promptTokens: data.prompt_eval_count ?? 0,
        completionTokens: data.eval_count ?? 0,
        durationMs: Date.now() - start,
      };
    }

    // Streaming: newline-delimited JSON
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let output = "";
    let promptTokens = 0;
    let completionTokens = 0;
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const d = JSON.parse(line) as {
            message?: { content?: string };
            done?: boolean;
            prompt_eval_count?: number;
            eval_count?: number;
          };
          const tok = d.message?.content ?? "";
          if (tok) {
            output += tok;
            onToken?.(tok);
          }
          if (d.done) {
            promptTokens = d.prompt_eval_count ?? 0;
            completionTokens = d.eval_count ?? 0;
          }
        } catch {
          /* unvollstaendige Zeile */
        }
      }
    }
    // Trace im Gesamtoutput strippen; onToken wurde bereits gestreamt (kunde
    // sieht den trace live — akzeptabel, das finale result ist sauber).
    const cleaned = stripThinking(output);
    return {
      output: cleaned,
      model,
      promptTokens,
      completionTokens: completionTokens || Math.ceil(cleaned.length / 4),
      durationMs: Date.now() - start,
    };
  }
}
