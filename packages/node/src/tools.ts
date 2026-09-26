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
 *
 * SANDBOX (Schritt 8.7) – die Eingabe kommt von einem Fremden:
 *   - jede Ausfuehrung ueber `ToolRegistry.run`: Eingabe gekuerzt, feste
 *     Hoechstzeit, Ausgabe gekuerzt (`WERKZEUG_GRENZEN`);
 *   - Netz nur ueber `safeFetch` (SSRF-Waechter, auch bei Weiterleitungen) und
 *     mit begrenzter Antwortgroesse; web_search nur zu api.duckduckgo.com;
 *   - Dateien nur im Workspace – auch nicht ueber Symlinks hinaus –, begrenzt
 *     in der Groesse;
 *   - Bild/Video nur ueber das vom Betreiber konfigurierte ComfyUI; die Eingabe
 *     ist nur der Prompt, sie waehlt kein Ziel.
 * GRENZE (ehrlich): Werkzeuge laufen im Knotenprozess, nicht in einem eigenen
 * Prozess mit eigenen Rechten – Nodes Rechte-Modell (`--permission`) braucht
 * mit tsx `--allow-worker`, und das hebelt es aus. Isolation auf
 * Betriebssystem-Ebene (systemd/Container) gehoert zum Installer (8.2).
 */
import { KIND_DVM_WEB_SEARCH, KIND_DVM_FILE_IO, KIND_DVM_BROWSER, KIND_DVM_IMAGE_GEN, KIND_DVM_VIDEO_GEN } from "@freedomstack/protocol";
import type { UrlGuardOptions } from "./url-guard.js";

/** Grenzen jeder Werkzeug-Ausfuehrung (8.7). */
export const WERKZEUG_GRENZEN = {
  /** Eingabe (Suchanfrage, Pfad, URL, Prompt, Dateiinhalt) hoechstens so lang – laengere werden abgelehnt, nicht gekuerzt. */
  eingabeZeichen: 2000,
  /** Ausgabe an den Kunden hoechstens so lang. */
  ausgabeZeichen: 4000,
  /** Gesamtzeit je Aufruf – Bild/Video brauchen laenger. */
  zeitMs: 20_000,
  zeitMsMedien: 600_000,
  /** Antworten fremder Server hoechstens so gross. */
  abrufBytes: 1_000_000,
  /** Dateien im Workspace hoechstens so gross (lesen und schreiben). */
  dateiBytes: 64 * 1024,
} as const;

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

/** web_search: DuckDuckGo Instant Answer API (kostenlos, kein Key) – nur dieser Host. */
export class WebSearchExecutor implements ToolExecutor {
  constructor(private guard: UrlGuardOptions = {}) {}
  canHandle(kind: number): boolean { return kind === KIND_DVM_WEB_SEARCH; }
  async run(call: ToolCall): Promise<ToolResult> {
    const start = Date.now();
    try {
      const { leseBegrenzt, safeFetch } = await import("./url-guard.js");
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(call.input)}&format=json&no_html=1&no_redirect=1`;
      const res = await safeFetch(url, { ...this.guard, allowHosts: ["api.duckduckgo.com"], timeoutMs: 8000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { text } = await leseBegrenzt(res, WERKZEUG_GRENZEN.abrufBytes);
      const d = JSON.parse(text) as { AbstractText?: string; AbstractURL?: string; Heading?: string };
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
      const { lstat, readFile, realpath, writeFile } = await import("node:fs/promises");
      const { dirname, join, normalize } = await import("node:path");
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
      // Symlinks (8.7): der echte Pfad muss im echten Workspace liegen – ein Link
      // im Workspace auf /etc wuerde die Pruefung oben sonst umgehen.
      const echteWurzel = (await realpath(this.workspaceDir)).replace(/\/+$/, "") + "/";
      const echterOrdner = await realpath(dirname(target)).catch(() => null);
      if (!echterOrdner || !(echterOrdner + "/").startsWith(echteWurzel)) throw new Error("pfad ausserhalb workspace");
      const info = await lstat(target).catch(() => null);
      if (info?.isSymbolicLink()) throw new Error("symlinks sind nicht erlaubt");
      if (op === "read") {
        if (!info?.isFile()) throw new Error("keine datei");
        if (info.size > WERKZEUG_GRENZEN.dateiBytes) throw new Error("datei zu gross");
        const content = await readFile(target, "utf8");
        return { name: call.name, output: content.slice(0, 4000), ok: true, durationMs: Date.now() - start };
      }
      if (op === "write") {
        const content = rest.slice(1).join(" ");
        if (Buffer.byteLength(content) > WERKZEUG_GRENZEN.dateiBytes) throw new Error("inhalt zu gross");
        if (info && !info.isFile()) throw new Error("keine datei");
        await writeFile(target, content, "utf8");
        // Nur der Pfad im Workspace (8.7) – der absolute Pfad beim Betreiber geht den Kunden nichts an
        return { name: call.name, output: `geschrieben: ${requested} (${content.length} bytes)`, ok: true, durationMs: Date.now() - start };
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
  constructor(private allowHosts?: string[], private guard: UrlGuardOptions = {}) {}
  canHandle(kind: number): boolean { return kind === KIND_DVM_BROWSER; }
  async run(call: ToolCall): Promise<ToolResult> {
    const start = Date.now();
    try {
      const { leseBegrenzt, safeFetch } = await import("./url-guard.js");
      const res = await safeFetch(call.input.trim(), { ...this.guard, allowHosts: this.allowHosts, timeoutMs: 10000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Nur Text (8.7): Binaerdateien, Archive und Medien gehen nicht in den Prompt
      const typ = (res.headers.get("content-type") ?? "").toLowerCase();
      if (typ && !/^(text\/|application\/(json|xml|xhtml\+xml))/.test(typ)) throw new Error(`kein Text (${typ.split(";")[0]})`);
      const { text: html } = await leseBegrenzt(res, WERKZEUG_GRENZEN.abrufBytes);
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
      // Nur Dateinamen (8.7): die ComfyUI-Adresse ist ein internes Ziel des Betreibers
      return { name: call.name, output: `Bild erzeugt: ${r.files.join(", ")}`, ok: true, durationMs: Date.now() - start };
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
      return { name: call.name, output: `Video (${secs}s, ${width}x${height}, mit Audio): ${r.files.join(", ")}`, ok: true, durationMs: Date.now() - start };
    } catch (e) {
      return { name: call.name, output: `video_gen fehler: ${(e as Error).message}`, ok: false, durationMs: Date.now() - start };
    }
  }
}

/**
 * Registry: findet den Executor fuer ein Tool-Kind und fuehrt ihn in den
 * Grenzen aus (8.7): zu lange Eingabe abgelehnt (gekuerzt schriebe file_io
 * still eine halbe Datei), Hoechstzeit, Ausgabe gekuerzt.
 */
export class ToolRegistry {
  private executors: ToolExecutor[] = [];
  constructor(private grenzen: { zeitMs: number; zeitMsMedien: number } = WERKZEUG_GRENZEN) {}
  register(e: ToolExecutor): void { this.executors.push(e); }
  async run(call: ToolCall): Promise<ToolResult> {
    const ex = this.executors.find((e) => e.canHandle(call.kind));
    if (!ex) {
      return { name: call.name, output: `kein Executor fuer kind ${call.kind}`, ok: false, durationMs: 0 };
    }
    const start = Date.now();
    if (call.input.length > WERKZEUG_GRENZEN.eingabeZeichen) {
      return { name: call.name, output: `eingabe zu lang (hoechstens ${WERKZEUG_GRENZEN.eingabeZeichen} zeichen)`, ok: false, durationMs: 0 };
    }
    const medien = call.kind === KIND_DVM_IMAGE_GEN || call.kind === KIND_DVM_VIDEO_GEN;
    const zeit = medien ? this.grenzen.zeitMsMedien : this.grenzen.zeitMs;
    let uhr: ReturnType<typeof setTimeout> | undefined;
    const abbruch = new Promise<ToolResult>((res) => {
      uhr = setTimeout(() => res({ name: call.name, output: `zeitlimit ${Math.round(zeit / 1000)} s ueberschritten`, ok: false, durationMs: Date.now() - start }), zeit);
    });
    try {
      const r = await Promise.race([ex.run(call), abbruch]);
      return { ...r, output: r.output.slice(0, WERKZEUG_GRENZEN.ausgabeZeichen) };
    } finally {
      clearTimeout(uhr);
    }
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
