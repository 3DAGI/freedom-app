/**
 * Dev-Server für die Vorschau (VKg1c, Entscheidung VKg-W1 vom 18.10.2026: wie Replit, mit Hot Reload). Hat ein Projekt in
 * `package.json` ein Skript `dev`, startet der Knoten `npm run dev` in der Sandbox – ohne Netz, wie jeden Code des
 * Projekts. Der Server lauscht dort auf `127.0.0.1:5173` (Vite von selbst, andere über `PORT`); `freedom_motor.py
 * --zurueck` reicht einen Socket in einem Ordner, den nur der Knoten und diese Sandbox sehen, dorthin weiter. Die
 * Vorschau (`vorschau.ts`) leitet an diesen Socket weiter, auch WebSocket für Hot Reload.
 *
 * Grenzen: je Projekt einer, auf dem Knoten höchstens `DEV_GRENZEN.gesamt`; nach `leerlaufMs` ohne Anfrage endet er.
 * Seine Ausgabe geht nirgends hin, ins Log nur Zahlen – Projektnamen sind Inhalt.
 */
import { lstatSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STARTSKRIPT } from "./hermes-motor.js";
import type { ProjektAblage } from "./projekte.js";
import { sandboxDienst } from "./sandbox.js";

export const DEV_GRENZEN = {
  /** Dev-Server auf dem Knoten zusammen. */
  gesamt: 3,
  /** So lange darf der Start dauern, bis der Server antwortet. */
  startMs: 60_000,
  /** Ohne Anfrage endet er danach. */
  leerlaufMs: 30 * 60_000,
  /** `package.json` größer als das liest der Knoten nicht. */
  paketBytes: 1024 * 1024,
} as const;

/** Port des Dev-Servers in der Sandbox – der von Vite; andere Server bekommen ihn über `PORT`. */
export const DEV_PORT = 5173;
export const DEV_IN_SANDBOX = { ordner: "/vorschau", sockel: "/vorschau/dev.sock" } as const;
const STARTSKRIPT_IN_SANDBOX = "/freedom/motor.py";

/**
 * Der Befehl für ein Projekt: `npm run dev`, wenn `package.json` eine echte Datei ist und ein Skript `dev` nennt – sonst
 * null (dann zeigt die Vorschau die Dateien). Was das Skript tut, prüft der Knoten nicht; es läuft in der Sandbox.
 */
export function devBefehl(projektOrdner: string): string[] | null {
  const datei = join(projektOrdner, "package.json");
  try {
    const st = lstatSync(datei);
    if (!st.isFile() || st.size > DEV_GRENZEN.paketBytes) return null;
    const paket = JSON.parse(readFileSync(datei, "utf8")) as { scripts?: Record<string, unknown> } | null;
    return typeof paket?.scripts?.dev === "string" && paket.scripts.dev.trim() !== "" ? ["npm", "run", "dev"] : null;
  } catch {
    return null;
  }
}

/** Ein laufender Dev-Server. */
interface Laufend {
  ordner: string;
  sockel: string;
  beende: () => void;
  zuletzt: number;
  bereit: Promise<boolean>;
}

/** Ob am Socket jemand antwortet – der Rückweg verbindet erst, wenn der Server lauscht; sonst schließt er sofort. */
function antwortet(sockel: string): Promise<boolean> {
  return new Promise((fertig) => {
    const s = connect(sockel);
    let ok = false;
    s.setTimeout(2000, () => s.destroy());
    s.on("connect", () => s.write("HEAD / HTTP/1.0\r\nHost: localhost\r\n\r\n"));
    s.on("data", () => { ok = true; s.destroy(); });
    s.on("error", () => undefined);
    s.on("close", () => fertig(ok));
  });
}

export class DevServer {
  private readonly laufend = new Map<string, Laufend>();
  private readonly jetzt: () => number;
  private readonly starte: (befehl: readonly string[], ort: Parameters<typeof sandboxDienst>[1]) => ReturnType<typeof sandboxDienst>;
  private readonly befehl: (projektOrdner: string) => readonly string[] | null;

  constructor(private readonly ablage: Pick<ProjektAblage, "ort">, o: {
    bwrap?: string; jetzt?: () => number;
    /** Nur für Tests: statt `npm run dev` aus `package.json`. */
    befehl?: (projektOrdner: string) => readonly string[] | null;
    /** Nur für Tests: statt `sandboxDienst()`. */
    starte?: DevServer["starte"];
    /** Zusätzlich nur lesbar (Tests: Node außerhalb von `/usr`). */
    nurLesbar?: ReadonlyArray<{ quelle: string; ziel: string }>;
  } = {}) {
    this.jetzt = o.jetzt ?? Date.now;
    this.befehl = o.befehl ?? devBefehl;
    const nurLesbar = [{ quelle: STARTSKRIPT, ziel: STARTSKRIPT_IN_SANDBOX }, ...(o.nurLesbar ?? [])];
    this.starte = o.starte ?? ((befehl, ort) => sandboxDienst(befehl, { ...ort, nurLesbar: [...(ort.nurLesbar ?? []), ...nurLesbar], ...(o.bwrap ? { bwrap: o.bwrap } : {}) }));
  }

  /** Läuft für das Projekt ein Dev-Server (oder startet er)? */
  hat(projekt: string): boolean {
    return this.laufend.has(projekt);
  }

  /**
   * Der Socket des Dev-Servers – startet ihn, wenn das Projekt einen hat und Platz ist, und wartet, bis er antwortet.
   * null: kein Skript `dev`, kein Platz, oder er antwortet nicht – dann zeigt die Vorschau die Dateien.
   */
  async sockel(projekt: string): Promise<string | null> {
    this.raeumeAuf();
    let l = this.laufend.get(projekt);
    if (!l) {
      const ort = this.ablage.ort(projekt);
      const befehl = this.befehl(ort);
      if (!befehl || this.laufend.size >= DEV_GRENZEN.gesamt) return null;
      const ordner = mkdtempSync(join(tmpdir(), "freedom-dev-"));
      const sockel = join(ordner, "dev.sock");
      const dienst = this.starte(
        ["python3", STARTSKRIPT_IN_SANDBOX, "--zurueck", DEV_IN_SANDBOX.sockel, String(DEV_PORT), "--", "/usr/bin/env", `PORT=${DEV_PORT}`, "HOST=127.0.0.1", ...befehl],
        { arbeit: ort, schreibbar: [{ quelle: ordner, ziel: DEV_IN_SANDBOX.ordner }] },
      );
      const neu: Laufend = { ordner, sockel, beende: dienst.beende, zuletzt: this.jetzt(), bereit: Promise.resolve(false) };
      neu.bereit = this.warteAuf(sockel, dienst.ende);
      void dienst.ende.then(() => {
        if (this.laufend.get(projekt) === neu) this.laufend.delete(projekt);
        rmSync(ordner, { recursive: true, force: true });
      });
      this.laufend.set(projekt, neu);
      console.log(`[vorschau] Dev-Server gestartet (${this.laufend.size} von ${DEV_GRENZEN.gesamt})`);
      l = neu;
    }
    l.zuletzt = this.jetzt();
    return (await l.bereit) ? l.sockel : null;
  }

  private async warteAuf(sockel: string, ende: Promise<void>): Promise<boolean> {
    let vorbei = false;
    void ende.then(() => { vorbei = true; });
    const bis = this.jetzt() + DEV_GRENZEN.startMs;
    while (!vorbei && this.jetzt() < bis) {
      if (await antwortet(sockel)) return true;
      await new Promise((r) => setTimeout(r, 300));
    }
    return false;
  }

  /** Dev-Server ohne Anfrage seit `leerlaufMs` beenden. */
  raeumeAuf(): void {
    for (const [projekt, l] of this.laufend) {
      if (this.jetzt() - l.zuletzt >= DEV_GRENZEN.leerlaufMs) this.beende(projekt);
    }
  }

  beende(projekt: string): void {
    const l = this.laufend.get(projekt);
    if (!l) return;
    this.laufend.delete(projekt);
    l.beende();
  }

  beendeAlle(): void {
    for (const p of [...this.laufend.keys()]) this.beende(p);
  }
}
