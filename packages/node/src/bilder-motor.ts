/**
 * Bilder für den Motor (VKd2b2, `docs/VIBECODEN-ENTWURF.md` „Freedom statt Nous Portal“: „Bilder | ComfyUI auf dem GX10“):
 * Freedom-MCP gibt Hermes `generate_image`, der Knoten fragt seine ComfyUI (`COMFYUI_URL`, nur dieser Rechner oder das
 * Heimnetz – wie der KI-Antrieb) und legt das PNG in einen Ordner je Projekt (`~/.freedom/bilder/<projekt>`). Den sieht nur
 * die Sandbox dieses Projekts, nur lesbar unter `/freedom/bilder`; ins Projekt kopiert der Agent es selbst. Der Knoten
 * schreibt nie in den Ordner des Projekts – dort könnte der Agent einen Verweis hinlegen, der aus dem Projekt hinauszeigt.
 *
 * Was beschrieben wird, ist Inhalt des eigenen Projekts: nie ins Log; nach außen nur feste Texte.
 */
import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ComfyExecutor } from "./comfy.js";
import { lokaleAntriebAdresse } from "./ki-antrieb.js";
import type { ProjektAblage } from "./projekte.js";
import { WERKZEUG_GRENZEN } from "./tools.js";

/** Wo die Sandbox die Bilder ihres Projekts sieht – nie unter `/arbeit`. */
export const BILDER_IN_SANDBOX = "/freedom/bilder";

export const BILDER_GRENZEN = {
  /** Größtes Bild, das der Knoten von ComfyUI annimmt. */
  bytes: 20 * 1024 * 1024,
  /** So viele Bilder hält ein Projekt – die ältesten fallen heraus. */
  jeProjekt: 50,
} as const;

export interface BilderDienst {
  url: string;
  checkpoint?: string;
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CHECKPOINT = /^[A-Za-z0-9_.\- /]{1,200}$/;

/** Aus der Umgebung: ohne `COMFYUI_URL` keine Bilder; eine Adresse außerhalb des Heimnetzes oder ein kaputter Checkpoint heißt kein Start. */
export function bilderAusUmgebung(env: { COMFYUI_URL?: string; COMFYUI_CHECKPOINT?: string }): { dienst?: BilderDienst } | { ungueltig: string } {
  const roh = env.COMFYUI_URL?.trim();
  if (!roh) return {};
  const url = lokaleAntriebAdresse(roh);
  if (!url) return { ungueltig: "COMFYUI_URL muss auf diesen Rechner oder ins Heimnetz zeigen (http, ohne Zugangsdaten)" };
  const checkpoint = env.COMFYUI_CHECKPOINT?.trim();
  if (checkpoint && (!CHECKPOINT.test(checkpoint) || checkpoint.split("/").some((t) => t === "" || t === "." || t === ".."))) {
    return { ungueltig: "COMFYUI_CHECKPOINT ungültig (Dateiname des Modells in ComfyUI)" };
  }
  return { dienst: { url, ...(checkpoint ? { checkpoint } : {}) } };
}

/** Der Ordner mit den Bildern eines Projekts – neben den Projekten, nie darin. */
export function bilderOrdner(ablage: Pick<ProjektAblage, "ordner">, projekt: string): string {
  return join(dirname(ablage.ordner), "bilder", projekt);
}

/**
 * Ein Bild für das Projekt: ComfyUI fragen, das PNG holen (begrenzt, nur PNG), unter einem neuen Namen ablegen. Wirft nie;
 * das Ergebnis ist Text für das Modell (englisch, wie die übrigen Werkzeuge).
 */
export async function erzeugeBild(d: BilderDienst, ordner: string, prompt: string): Promise<{ ok: boolean; output: string }> {
  if (prompt.length > WERKZEUG_GRENZEN.eingabeZeichen) return { ok: false, output: `prompt: at most ${WERKZEUG_GRENZEN.eingabeZeichen} characters` };
  const comfy = new ComfyExecutor({ baseUrl: d.url, timeoutMs: WERKZEUG_GRENZEN.zeitMsMedien, ...(d.checkpoint ? { checkpoint: d.checkpoint } : {}) });
  if (!(await comfy.up())) return { ok: false, output: "image generation not reachable (ComfyUI)" };
  const r = await comfy.generateImage(prompt);
  const datei = r.ok ? r.files[0] : undefined;
  if (!datei) return { ok: false, output: "image generation failed" };
  const bild = await holeBild(`${d.url}/view?filename=${encodeURIComponent(datei)}&type=output`);
  if (!bild || !PNG.every((b, i) => bild[i] === b)) return { ok: false, output: "image generation failed" };
  const name = `bild-${randomBytes(6).toString("hex")}.png`;
  try {
    mkdirSync(ordner, { recursive: true, mode: 0o700 });
    writeFileSync(join(ordner, name), bild, { mode: 0o600, flag: "wx" });
    raeumeAuf(ordner);
  } catch {
    return { ok: false, output: "image could not be saved" };
  }
  return { ok: true, output: `Image saved: ${BILDER_IN_SANDBOX}/${name} (PNG, read-only). Copy it into the project to use it, e.g. cp ${BILDER_IN_SANDBOX}/${name} assets/` };
}

/** Das Bild von ComfyUI – gelesen höchstens bis zur Grenze, gleich was die Kopfzeilen sagen; sonst null. */
async function holeBild(url: string): Promise<Uint8Array | null> {
  try {
    const a = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
    if (!a.ok || !a.body) return null;
    const leser = a.body.getReader();
    const teile: Uint8Array[] = [];
    let n = 0;
    for (;;) {
      const { value, done } = await leser.read();
      if (done) break;
      n += value.length;
      if (n > BILDER_GRENZEN.bytes) {
        await leser.cancel();
        return null;
      }
      teile.push(value);
    }
    return Buffer.concat(teile);
  } catch {
    return null;
  }
}

/** Höchstens `jeProjekt` Bilder – die ältesten weg. Nur Dateien, die der Knoten selbst so benannt hat. */
function raeumeAuf(ordner: string): void {
  const bilder = readdirSync(ordner).filter((n) => /^bild-[0-9a-f]{12}\.png$/.test(n))
    .map((n) => ({ n, t: lstatSync(join(ordner, n)).mtimeMs }))
    .sort((a, b) => a.t - b.t);
  for (const b of bilder.slice(0, Math.max(0, bilder.length - BILDER_GRENZEN.jeProjekt))) rmSync(join(ordner, b.n), { force: true });
}
