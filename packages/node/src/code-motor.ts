/**
 * Motor für Code-Aufträge (A-31 VKc2, Entscheidung VK-W1n C): Der Knoten ist
 * ACP-Client (Agent Client Protocol, `@agentclientprotocol/sdk`), der Motor ein
 * ACP-Agent – zuerst Hermes (VKc3), tauschbar gegen jeden anderen, der ACP über
 * stdio spricht. Abgebildet auf VKa (`docs/PROTOCOL.md` 34):
 *   - ein Werkzeug-Aufruf (`tool_call`) → Schritt `befehl`, sein Ende → `ausgabe`;
 *   - eine Freigabe-Anfrage → `befehl` mit `wartet` (Modus „fragen“); die Antwort
 *     `freigabe` wählt „einmal erlauben“ oder „einmal ablehnen“, ohne Antwort nach
 *     `freigabeMs` abgelehnt (wie Hermes); im Modus „frei“ erlaubt der Knoten selbst;
 *   - `stopp` → `session/cancel`, offene Freigaben „cancelled“.
 * Jeder Schritt mit Änderungen wird ein Commit (`ProjektAblage.sichere()`).
 *
 * Der Motor läuft nur in der Sandbox (VK4): gestartet nur über eine `MotorStart`,
 * die `main.ts` erst mit der Sandbox baut (`sandboxMotor()` aus `sandbox.ts`, VKb; gebaut in
 * VKc3) – bis dahin `code-ohne-motor`.
 * Die Sandbox muss `.git` nur lesbar einbinden: Die Commits laufen im Knoten, und
 * ein Filter in `.git/config` liefe dort. Ins Log nur Kennung, Zahlen und
 * Fehlernamen – Befehle, Ausgaben und Gedanken sind Inhalt.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import {
  client, ndJsonStream, PROTOCOL_VERSION, type AgentApp, type PermissionOptionKind, type RequestPermissionRequest,
  type RequestPermissionResponse, type SessionNotification, type StopReason, type Stream, type ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import { CODE_GRENZEN, type CodeEnde, type CodeModus, type CodeSchritt } from "@freedomstack/protocol";
import { CodeAbgelehnt, type ProjektAblage } from "./projekte.js";

export const LAUF_GRENZEN = {
  /** Ohne Antwort auf eine Freigabe abgelehnt – wie Hermes über ACP (60 s, `make_approval_callback`, VKc3). */
  freigabeMs: 60_000,
  /** Höchstens so lange je Lauf, dann bricht der Knoten ab (`grenze`). */
  laufMs: 60 * 60_000,
  /** Nach `stopp` oder Grenze so lange auf den Motor warten, dann beenden. */
  nachlaufMs: 10_000,
  /** Läufe zugleich auf dem Knoten – je Projekt höchstens einer. */
  laeufe: 3,
};

/** Ein gestarteter Motor: ACP-Strom (oder ein Agent im selben Prozess, für Tests) und Ende. */
export interface MotorVerbindung {
  strom: Stream | AgentApp;
  beende(): void;
  /** Der Projektordner, wie der Motor ihn sieht – in der Sandbox `/arbeit` (VKc3); sonst der Ordner selbst. */
  ort?: string;
}
/** Startet den Motor im Ordner des Projekts – nur in der Sandbox (VK4). */
export type MotorStart = (ordner: string) => MotorVerbindung;

/**
 * Läuft der Prozess noch? Nur dann `kill()`. Scheitert `spawn` (Programm fehlt), hat er keine pid – bis zum Ereignis
 * „error“ hält Node aber noch den Griff und schickt `kill()` an eine nie gesetzte Nummer. Steht dort 0 oder -1, trifft
 * SIGTERM die ganze Prozessgruppe oder jeden Prozess des Nutzers: In der CI beendete das den Runner (VKc3b).
 */
export const lebt = (kind: ChildProcess): boolean => kind.pid !== undefined && kind.exitCode === null && kind.signalCode === null;

/**
 * Motor als eigener Prozess: ACP als JSON-Zeilen über stdin/stdout, ohne Shell,
 * die Umgebung leer bis auf PATH, HOME (der Projektordner) und LANG. stderr wird
 * verworfen – es kann Inhalt tragen. Nur mit dem Befehl der Sandbox davor (VKc3).
 */
export function prozessMotor(befehl: readonly string[]): MotorStart {
  if (befehl.length === 0 || befehl.some((t) => t === "")) throw new Error("Motor-Befehl leer");
  return (ordner) => {
    const kind = spawn(befehl[0]!, befehl.slice(1), {
      cwd: ordner, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: ordner, LANG: "C.UTF-8" },
      stdio: ["pipe", "pipe", "ignore"], windowsHide: true,
    });
    kind.on("error", () => { /* ein fehlender Motor beendet den Strom – der Lauf endet mit „fehler“ */ });
    return {
      strom: ndJsonStream(Writable.toWeb(kind.stdin!) as WritableStream<Uint8Array>, Readable.toWeb(kind.stdout!) as ReadableStream<Uint8Array>),
      beende: () => { if (lebt(kind)) kind.kill("SIGTERM"); },
    };
  };
}

/** Ausgabe auf `CODE_GRENZEN.ausgabe` kürzen – Anfang und Ende bleiben, wie bei mini-swe-agent. */
export function kuerzeAusgabe(text: string): { ausgabe: string; gekuerzt: boolean } {
  if (text.length <= CODE_GRENZEN.ausgabe) return { ausgabe: text, gekuerzt: false };
  const mitte = "\n[…]\n", teil = Math.floor((CODE_GRENZEN.ausgabe - mitte.length) / 2);
  return { ausgabe: text.slice(0, teil) + mitte + text.slice(-teil), gekuerzt: true };
}

const ENDE: Record<StopReason, CodeEnde> = {
  end_turn: "fertig", max_tokens: "grenze", max_turn_requests: "grenze", refusal: "abgelehnt", cancelled: "gestoppt",
};

function befehlText(w: ToolCallUpdate): string {
  const roh = (w.rawInput ?? {}) as { command?: unknown };
  const befehl = typeof roh.command === "string" ? roh.command
    : Array.isArray(roh.command) && roh.command.every((t) => typeof t === "string") ? roh.command.join(" ")
    : w.title ?? "";
  return (befehl.trim() || w.kind || "werkzeug").slice(0, CODE_GRENZEN.befehl);
}

function ausgabeText(w: ToolCallUpdate): string {
  const teile: string[] = [];
  for (const c of w.content ?? []) {
    if (c.type === "content" && c.content.type === "text") teile.push(c.content.text);
    else if (c.type === "diff") teile.push(`--- ${c.path}\n${c.newText}`);
  }
  const roh = w.rawOutput;
  if (typeof roh === "string") teile.push(roh);
  else if (roh && typeof roh === "object") {
    for (const k of ["stdout", "output", "stderr"]) {
      const v = (roh as Record<string, unknown>)[k];
      if (typeof v === "string" && v !== "") teile.push(v);
    }
  }
  return teile.join("\n");
}

/** Rückgabewert, wenn der Motor ihn nennt – sonst 0 bei Erfolg, 1 bei Fehlschlag. */
function rueckgabe(w: ToolCallUpdate): number {
  const roh = w.rawOutput && typeof w.rawOutput === "object" ? (w.rawOutput as Record<string, unknown>) : {};
  for (const k of ["exit_code", "exitCode", "code"]) {
    const v = roh[k];
    if (Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= 255) return v as number;
  }
  return w.status === "failed" ? 1 : 0;
}

const fehlerName = (e: unknown): string => (e instanceof Error ? e.name : "Fehler");
/** Einen Takt warten: Nachrichten, die schon angekommen sind, laufen erst durch ihre Handler. */
const takt = (): Promise<void> => new Promise((weiter) => setImmediate(weiter));

interface Werkzeug { nr: number; stand: ToolCallUpdate; gedanke: string; gezeigt: boolean; fertig: boolean }

interface Lauf {
  id: string; projekt: string; modus: CodeModus; melde: (s: CodeSchritt) => void;
  nr: number; werkzeuge: Map<string, Werkzeug>; gedanke: string; abschluss: string;
  offen: Map<number, (ja: boolean | null) => void>;
  /** Commits nacheinander – zwei `git add` zugleich scheitern am Index. */
  sicherung: Promise<unknown>;
  gestoppt: boolean; grenze: boolean;
  abbrechen?: () => void; beende?: () => void; nachlauf?: NodeJS.Timeout;
}

export interface LaufEnde { ende: CodeEnde; schritte: number; abschluss: string }

/** Die Läufe des Knotens: starten, freigeben, stoppen – je Projekt höchstens einer. */
export class CodeLaeufe {
  private readonly laeufe = new Map<string, Lauf>();
  private readonly g: typeof LAUF_GRENZEN;

  /** `beimAuftrag` sieht den Text jedes Auftrags vor dem Start – für die Lese-Freigaben von Freedom-MCP (VKd-W1, je Projekt seit VKd2b1). */
  constructor(private readonly o: { ablage: ProjektAblage; motor: MotorStart; grenzen?: Partial<typeof LAUF_GRENZEN>; beimAuftrag?: (text: string, projekt: string) => void }) {
    this.g = { ...LAUF_GRENZEN, ...o.grenzen };
  }

  /** Lauf beginnen (Id = Id des Auftrags). Wirft `code-belegt`; das Versprechen selbst scheitert nie. */
  starte(id: string, a: { projekt: string; text: string; modus: CodeModus }, melde: (s: CodeSchritt) => void): Promise<LaufEnde> {
    if (this.laeufe.has(id) || this.laeufe.size >= this.g.laeufe || [...this.laeufe.values()].some((l) => l.projekt === a.projekt)) {
      throw new CodeAbgelehnt("code-belegt");
    }
    const lauf: Lauf = {
      id, projekt: a.projekt, modus: a.modus, melde, nr: 0, werkzeuge: new Map(), gedanke: "", abschluss: "",
      offen: new Map(), sicherung: Promise.resolve(), gestoppt: false, grenze: false,
    };
    this.laeufe.set(id, lauf);
    this.o.beimAuftrag?.(a.text, a.projekt);
    return this.fuehre(lauf, a.text).finally(() => {
      this.laeufe.delete(id);
      for (const f of [...lauf.offen.values()]) f(null);
    });
  }

  /** Läuft in diesem Projekt gerade ein Lauf? (VKe2: „zurück“ nur ohne Lauf) */
  laeuftIn(projekt: string): boolean {
    return [...this.laeufe.values()].some((l) => l.projekt === projekt);
  }

  /** Antwort auf eine wartende Freigabe – false, wenn dieser Schritt nicht wartet. */
  freigabe(id: string, nr: number, ja: boolean): boolean {
    const f = this.laeufe.get(id)?.offen.get(nr);
    if (!f) return false;
    f(ja);
    return true;
  }

  /** Lauf abbrechen – false, wenn er nicht (mehr) läuft. */
  stopp(id: string): boolean {
    const lauf = this.laeufe.get(id);
    if (!lauf) return false;
    lauf.gestoppt = true;
    this.halteAn(lauf);
    return true;
  }

  private halteAn(lauf: Lauf): void {
    for (const f of [...lauf.offen.values()]) f(null);
    lauf.abbrechen?.();
    lauf.nachlauf ??= setTimeout(() => lauf.beende?.(), this.g.nachlaufMs);
  }

  private async fuehre(lauf: Lauf, text: string): Promise<LaufEnde> {
    let ende: CodeEnde = "fehler";
    // Beide Uhren halten den Knoten wach, solange der Lauf läuft – und enden mit ihm
    const uhr = setTimeout(() => { lauf.grenze = true; this.halteAn(lauf); }, this.g.laufMs);
    try {
      await this.o.ablage.neu(lauf.projekt);
      const ordner = this.o.ablage.ort(lauf.projekt);
      const motor = this.o.motor(ordner);
      lauf.beende = () => motor.beende();
      // Updates direkt im Handler, in der Reihenfolge der Ankunft – ohne Datei- und Terminal-Fähigkeiten: der Motor arbeitet selbst, in der Sandbox
      const app = client({ name: "freedom-knoten" })
        .onNotification("session/update", ({ params }) => this.verarbeite(lauf, params))
        .onRequest("session/request_permission", ({ params }) => this.frage(lauf, params));
      const ablauf = async (ctx: Parameters<Parameters<typeof app.connectWith>[1]>[0]): Promise<StopReason> => {
        await ctx.request("initialize", {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
          clientInfo: { name: "freedom-knoten", version: "1" },
        });
        const { sessionId } = await ctx.request("session/new", { cwd: motor.ort ?? ordner, mcpServers: [] });
        lauf.abbrechen = () => void ctx.notify("session/cancel", { sessionId }).catch(() => {});
        if (lauf.gestoppt || lauf.grenze) lauf.abbrechen();
        const { stopReason } = await ctx.request("session/prompt", { sessionId, prompt: [{ type: "text", text }] });
        await takt(); // Updates, die vor der Antwort kamen, fertig verarbeiten
        return stopReason;
      };
      try {
        const grund = await ("readable" in motor.strom ? app.connectWith(motor.strom, ablauf) : app.connectWith(motor.strom, ablauf));
        ende = lauf.grenze ? "grenze" : lauf.gestoppt ? "gestoppt" : ENDE[grund] ?? "fehler";
      } finally {
        motor.beende();
        await lauf.sicherung;
      }
    } catch (e) {
      ende = lauf.grenze ? "grenze" : lauf.gestoppt ? "gestoppt" : "fehler";
      if (ende === "fehler") console.warn(`[code] Lauf ${lauf.id.slice(0, 8)}: ${fehlerName(e)}`);
    } finally {
      clearTimeout(uhr);
      clearTimeout(lauf.nachlauf);
    }
    return { ende, schritte: lauf.nr, abschluss: lauf.abschluss.trim() };
  }

  private verarbeite(lauf: Lauf, n: SessionNotification): void {
    const u = n.update;
    if (u.sessionUpdate === "agent_thought_chunk" || u.sessionUpdate === "agent_message_chunk") {
      if (u.content.type !== "text") return;
      lauf.gedanke = (lauf.gedanke + u.content.text).slice(-CODE_GRENZEN.gedanke);
      if (u.sessionUpdate === "agent_message_chunk") lauf.abschluss = (lauf.abschluss + u.content.text).slice(-CODE_GRENZEN.abschluss);
      return;
    }
    if (u.sessionUpdate !== "tool_call" && u.sessionUpdate !== "tool_call_update") return;
    const w = this.werkzeug(lauf, u);
    if (!w) return;
    const status = w.stand.status;
    if (status === "in_progress" || status === "completed" || status === "failed") this.zeige(lauf, w, false);
    if ((status === "completed" || status === "failed") && !w.fertig) {
      w.fertig = true;
      lauf.melde({ nr: w.nr, art: "ausgabe", ...kuerzeAusgabe(ausgabeText(w.stand)), code: rueckgabe(w.stand) });
      const nr = w.nr;
      lauf.sicherung = lauf.sicherung.then(() => this.o.ablage.sichere(lauf.projekt, nr)).catch((e) => console.warn(`[code] Commit: ${fehlerName(e)}`));
    }
  }

  /** Werkzeug-Aufruf nachführen – ein neuer ist ein neuer Schritt; über der Grenze bricht der Lauf ab. */
  private werkzeug(lauf: Lauf, u: ToolCallUpdate): Werkzeug | null {
    let w = lauf.werkzeuge.get(u.toolCallId);
    if (!w) {
      if (lauf.nr >= CODE_GRENZEN.schritte) {
        lauf.grenze = true;
        this.halteAn(lauf);
        return null;
      }
      w = { nr: ++lauf.nr, stand: { toolCallId: u.toolCallId }, gedanke: lauf.gedanke, gezeigt: false, fertig: false };
      lauf.gedanke = "";
      lauf.abschluss = "";
      lauf.werkzeuge.set(u.toolCallId, w);
    }
    for (const k of ["title", "kind", "status", "content", "rawInput", "rawOutput"] as const) {
      if (u[k] !== undefined && u[k] !== null) (w.stand as Record<string, unknown>)[k] = u[k];
    }
    return w;
  }

  /** Befehl melden – ein zweites Mal nur, wenn er jetzt auf Freigabe wartet (er wartet bis zu seiner `ausgabe`). */
  private zeige(lauf: Lauf, w: Werkzeug, wartet: boolean): void {
    if (w.gezeigt && !wartet) return;
    w.gezeigt = true;
    lauf.melde({ nr: w.nr, art: "befehl", gedanke: w.gedanke, befehl: befehlText(w.stand), wartet });
  }

  private async frage(lauf: Lauf, p: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const waehle = (arten: PermissionOptionKind[]): RequestPermissionResponse => {
      for (const art of arten) {
        const o = p.options.find((x) => x.kind === art);
        if (o) return { outcome: { outcome: "selected", optionId: o.optionId } };
      }
      return { outcome: { outcome: "cancelled" } };
    };
    await takt(); // den Werkzeug-Aufruf davor zuerst verarbeiten – sonst fehlten Titel und Befehl
    const w = this.werkzeug(lauf, p.toolCall);
    if (!w || lauf.gestoppt || lauf.grenze) return { outcome: { outcome: "cancelled" } };
    if (lauf.modus === "frei") {
      this.zeige(lauf, w, false);
      return waehle(["allow_once", "allow_always"]);
    }
    const ja = await new Promise<boolean | null>((fertig) => {
      const antwort = (a: boolean | null) => {
        clearTimeout(uhr);
        lauf.offen.delete(w.nr);
        fertig(a);
      };
      const uhr = setTimeout(() => antwort(false), this.g.freigabeMs);
      // erst eintragen, dann melden – eine Freigabe oder ein Stopp kann sofort kommen
      lauf.offen.set(w.nr, antwort);
      this.zeige(lauf, w, true);
    });
    // „fragen“ heißt jeder Befehl einzeln – nie „immer erlauben“ für den Motor
    return ja === null ? { outcome: { outcome: "cancelled" } } : waehle(ja ? ["allow_once"] : ["reject_once", "reject_always"]);
  }
}
