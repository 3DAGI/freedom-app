/**
 * Tool-Execution: echte Tool-Ausfuehrung im Provider-Daemon.
 *
 * Bisher wurden Tool-Kinds nur angeboten (Capabilities). Hier werden sie
 * tatsaechlich ausgefuehrt. Jeder Executor ist lokal (kein Cloud-Call),
 * non-custodial, und gibt ein einheitliches Ergebnis zurueck.
 *
 * v1-Executor (lokal, keine externen API-Keys noetig):
 *   - web_search:   DuckDuckGo Instant Answer (kostenlos, kein Key)
 *   - file_io:      lokale Sandbox (read/write im eigenen workspace)
 *   - browser_use:  einfacher HTTP-Fetch + Text-Extraktion (kein Playwright)
 *   - image_gen:    Placeholder (braucht lokales Diffusion-Backend)
 *   - video_gen:    Placeholder (Minimax H3 — spaeter)
 *
 * Wichtig: Die Ausfuehrung ist PROVIDER-seitig — der Provider rechnet
 * die Tool-Kosten in den Job-Preis ein (usage.toolCalls im Result).
 */
import { KIND_DVM_WEB_SEARCH, KIND_DVM_FILE_IO, KIND_DVM_BROWSER, KIND_DVM_IMAGE_GEN, KIND_DVM_VIDEO_GEN } from "@freedomstack/protocol";

export interface ToolCall {
  kind: number;
  name: string;
  /** Tool-Input (Query, Pfad, URL, Prompt). */
  input: string;
}

export interface ToolResult {
  name: string;
  output: string;
  ok: boolean;
  durationMs: number;
}

export interface ToolExecutor {
  canHandle(kind: number): boolean;
  run(call: ToolCall): Promise<ToolResult>;
}

/** web_search: DuckDuckGo Instant Answer API (kostenlos, kein Key). */
export class WebSearchExecutor implements ToolExecutor {
  canHandle(kind: number): boolean { return kind === KIND_DVM_WEB_SEARCH; }
  async run(call: ToolCall): Promise<ToolResult> {
    const start = Date.now();
    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(call.input)}&format=json&no_html=1&no_redirect=1`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as { AbstractText?: string; AbstractURL?: string; Heading?: string };
      const out = d.AbstractText
        ? `${d.Heading ?? ""}: ${d.AbstractText} (${d.AbstractURL ?? ""})`.trim()
        : "keine Instant-Answer gefunden";
      return { name: call.name, output: out, ok: true, durationMs: Date.now() - start };
    } catch (e) {
      return { name: call.name, output: `fehler: ${(e as Error).message}`, ok: false, durationMs: Date.now() - start };
    }
  }
}

/** file_io: lokale Sandbox (nur im erlaubten workspace-Verzeichnis). */
export class FileIoExecutor implements ToolExecutor {
  constructor(private workspaceDir: string) {}
  canHandle(kind: number): boolean { return kind === KIND_DVM_FILE_IO; }
  async run(call: ToolCall): Promise<ToolResult> {
    const start = Date.now();
    try {
      const { readFile, writeFile } = await import("node:fs/promises");
      const { join, normalize } = await import("node:path");
      // call.input Format: "read <path>" oder "write <path> <content>"
      const [op, ...rest] = call.input.split(" ");
      const requested = rest[0] ?? "";
      // Absolute Pfade wuerden join() umgehen ("/etc/passwd" gewinnt gegen die Basis).
      if (requested.startsWith("/") || /^[a-zA-Z]:/.test(requested)) {
        throw new Error("absolute pfade sind nicht erlaubt");
      }
      if (requested.includes("\0")) throw new Error("ungueltiger pfad");
      const root = normalize(this.workspaceDir).replace(/\/+$/, "") + "/";
      const target = normalize(join(this.workspaceDir, requested));
      // startsWith(root) MIT Trennzeichen: sonst passiert "/tmp/ws-evil" die
      // Pruefung gegen die Basis "/tmp/ws".
      if (!(target + "/").startsWith(root)) {
        throw new Error("pfad ausserhalb workspace");
      }
      if (op === "read") {
        const content = await readFile(target, "utf8");
        return { name: call.name, output: content.slice(0, 4000), ok: true, durationMs: Date.now() - start };
      }
      if (op === "write") {
        const content = rest.slice(1).join(" ");
        await writeFile(target, content, "utf8");
        return { name: call.name, output: `geschrieben: ${target} (${content.length} bytes)`, ok: true, durationMs: Date.now() - start };
      }
      throw new Error(`unbekannte op: ${op} (read|write)`);
    } catch (e) {
      return { name: call.name, output: `fehler: ${(e as Error).message}`, ok: false, durationMs: Date.now() - start };
    }
  }
}

/**
 * browser_use: HTTP-Fetch + Text-Extraktion.
 *
 * SICHERHEIT: Die URL kommt von einem FREMDEN aus dem offenen Marktplatz.
 * Ohne Pruefung waere das eine Fernabfrage in das private Netz des Betreibers
 * — Ollama, LND-REST, Router-Oberflaeche, Cloud-Metadaten. Deshalb laeuft
 * jeder Abruf durch safeFetch(): Schema-Pruefung, DNS-Aufloesung, Abgleich
 * gegen private Adressbereiche, und dieselbe Pruefung erneut bei jeder
 * Weiterleitung.
 */
export class BrowserExecutor implements ToolExecutor {
  constructor(private allowHosts?: string[]) {}
  canHandle(kind: number): boolean { return kind === KIND_DVM_BROWSER; }
  async run(call: ToolCall): Promise<ToolResult> {
    const start = Date.now();
    try {
      const { safeFetch } = await import("./url-guard.js");
      const res = await safeFetch(call.input, { allowHosts: this.allowHosts, timeoutMs: 10000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      // Grobe Text-Extraktion (Tags strippen)
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return { name: call.name, output: text.slice(0, 4000), ok: true, durationMs: Date.now() - start };
    } catch (e) {
      return { name: call.name, output: `fehler: ${(e as Error).message}`, ok: false, durationMs: Date.now() - start };
    }
  }
}

/** image_gen: lokale ComfyUI (SDXL text2img). */
export class ImageGenExecutor implements ToolExecutor {
  constructor(private comfyUrl?: string) {}
  canHandle(kind: number): boolean { return kind === KIND_DVM_IMAGE_GEN; }
  async run(call: ToolCall): Promise<ToolResult> {
    const start = Date.now();
    if (!this.comfyUrl) {
      return { name: call.name, output: "image_gen nicht konfiguriert (kein ComfyUI-Backend)", ok: false, durationMs: Date.now() - start };
    }
    try {
      const { ComfyExecutor } = await import("./comfy.js");
      const comfy = new ComfyExecutor({ baseUrl: this.comfyUrl });
      if (!(await comfy.up())) {
        return { name: call.name, output: "ComfyUI nicht erreichbar", ok: false, durationMs: Date.now() - start };
      }
      const r = await comfy.generateImage(call.input);
      if (!r.ok) {
        return { name: call.name, output: `image_gen fehler: ${r.error}`, ok: false, durationMs: Date.now() - start };
      }
      return { name: call.name, output: `Bild erzeugt: ${r.urls.join(", ")}`, ok: true, durationMs: Date.now() - start };
    } catch (e) {
      return { name: call.name, output: `image_gen fehler: ${(e as Error).message}`, ok: false, durationMs: Date.now() - start };
    }
  }
}

/** video_gen: Minimax H3 Text-to-Video (mit Audio) via ComfyUI. */
export class VideoGenExecutor implements ToolExecutor {
  constructor(private comfyUrl?: string) {}
  canHandle(kind: number): boolean { return kind === KIND_DVM_VIDEO_GEN; }
  async run(call: ToolCall): Promise<ToolResult> {
    const start = Date.now();
    if (!this.comfyUrl) {
      return { name: call.name, output: "video_gen nicht konfiguriert (kein ComfyUI-Backend)", ok: false, durationMs: Date.now() - start };
    }
    try {
      const { ComfyExecutor } = await import("./comfy.js");
      const comfy = new ComfyExecutor({ baseUrl: this.comfyUrl });
      if (!(await comfy.up())) {
        return { name: call.name, output: "ComfyUI nicht erreichbar", ok: false, durationMs: Date.now() - start };
      }
      // call.input Format: "<prompt>" oder "<prompt> | seconds=5 | res=768p"
      const parts = call.input.split("|").map((s) => s.trim());
      const prompt = parts[0];
      let length = 56; // frames @24fps ~ 2.3s
      let width = 608, height = 352;
      for (const p of parts.slice(1)) {
        const sec = p.match(/seconds?=(\d+)/i);
        if (sec) length = Math.min(240, Number(sec[1]) * 24); // frames, max 10s
        const res = p.match(/res(?:olution)?=(\d+)p/i);
        if (res) {
          const rp = Number(res[1]);
          if (rp >= 1080) { width = 1280; height = 720; }
          else if (rp >= 768) { width = 960; height = 544; }
          else { width = 608; height = 352; }
        }
      }
      const r = await comfy.generateVideo(prompt, { width, height, length });
      if (!r.ok) {
        return { name: call.name, output: `video_gen fehler: ${r.error}`, ok: false, durationMs: Date.now() - start };
      }
      const secs = Math.round(length / 24);
      return { name: call.name, output: `Video (${secs}s, ${width}x${height}, mit Audio): ${r.urls.join(", ")}`, ok: true, durationMs: Date.now() - start };
    } catch (e) {
      return { name: call.name, output: `video_gen fehler: ${(e as Error).message}`, ok: false, durationMs: Date.now() - start };
    }
  }
}

/** Registry: findet den Executor fuer ein Tool-Kind. */
export class ToolRegistry {
  private executors: ToolExecutor[] = [];
  register(e: ToolExecutor): void { this.executors.push(e); }
  async run(call: ToolCall): Promise<ToolResult> {
    const ex = this.executors.find((e) => e.canHandle(call.kind));
    if (!ex) {
      return { name: call.name, output: `kein Executor fuer kind ${call.kind}`, ok: false, durationMs: 0 };
    }
    return ex.run(call);
  }
}

/** Default-Registry mit allen lokalen Executors. */
export function defaultToolRegistry(workspaceDir = "/tmp/freedom-workspace", comfyUrl?: string): ToolRegistry {
  const r = new ToolRegistry();
  r.register(new WebSearchExecutor());
  r.register(new FileIoExecutor(workspaceDir));
  r.register(new BrowserExecutor());
  r.register(new ImageGenExecutor(comfyUrl));
  r.register(new VideoGenExecutor(comfyUrl));
  return r;
}
