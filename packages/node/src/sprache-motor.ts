/**
 * Sprache für den Motor (VKd2c, `docs/SPRACHE-ENTWURF.md` SP-W6 A „MCP später“, `docs/VIBECODEN-ENTWURF.md` VKd): Freedom-MCP gibt
 * Hermes `transcribe_audio`, wenn der Knoten Whisper hat (`Whisper.bereit()`, B-38). Der Agent nennt eine WAV-Datei im Projekt;
 * der Knoten liest sie selbst aus dem Ordner des Projekts – der Agent schreibt dort, also nur eine echte Datei: jeder Teil des
 * Pfads mit `lstat` (ein Verweis irgendwo heißt „gibt es nicht“), kein Teil mit Punkt am Anfang, geöffnet mit `O_NOFOLLOW |
 * O_NONBLOCK` (ein FIFO hielte den Knoten an), unter Linux danach der echte Ort über `/proc/self/fd` (zwischen `lstat` und `open`
 * könnte er einen Ordner gegen einen Verweis tauschen), höchstens so groß wie der längste erlaubte Ton. Angenommen nur genau in
 * der Form von `pruefeWav()` (16 kHz, mono, 16 Bit) – wie für die App (SP-W5 A: kein ffmpeg im Knoten). Whisper läuft wie dort je
 * Auftrag in der Sandbox (`Whisper.transkribiere()`), ein Auftrag zur Zeit.
 *
 * Ton und Text sind Inhalt des Projekts: nie ins Log; nach außen nur feste Texte (englisch, wie die übrigen Werkzeuge).
 */
import { closeSync, constants, fstatSync, lstatSync, openSync, readlinkSync, readSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { SPRACHE_GRENZEN, pruefeWav, type SpracheWahl } from "@freedomstack/protocol";
import { SpracheAbgelehnt, type Whisper } from "./whisper.js";

/** Wo der Agent das Projekt sieht – ein Pfad darf damit beginnen. */
const ARBEIT = "/arbeit/";

/** Größte Datei, die der Knoten liest: Kopf (44 Byte) und der längste erlaubte Ton (16 kHz, 16 Bit, mono). */
export const TON_BYTES = 44 + SPRACHE_GRENZEN.sekunden * SPRACHE_GRENZEN.abtastrate * 2;

/** Was der Agent über die verlangte Form erfährt – dieselben Zahlen wie `pruefeWav()`. */
export const TON_FORM = `WAV, ${SPRACHE_GRENZEN.abtastrate / 1000} kHz, mono, 16-bit PCM, at most ${SPRACHE_GRENZEN.sekunden} seconds`;

/** Die Teile eines Pfads im Projekt – relativ oder unter `/arbeit/`; null für alles andere. */
export function tonPfad(roh: string): string[] | null {
  const p = roh.trim();
  if (p.length === 0 || p.length > 500 || p.includes("\0") || p.includes("\\")) return null;
  const relativ = p.startsWith(ARBEIT) ? p.slice(ARBEIT.length) : p;
  if (relativ.startsWith("/")) return null;
  const teile = relativ.split("/");
  if (teile.some((t) => t === "" || t.startsWith("."))) return null;
  return teile;
}

/** Den Ton aus dem Projekt lesen – nur eine echte Datei im Ordner, begrenzt; sonst ein fester Text für das Modell. */
export function leseTonImProjekt(ort: string, roh: string): { ton: Uint8Array } | { fehler: string } {
  const teile = tonPfad(roh);
  if (!teile) return { fehler: "path: a file in the project, e.g. audio/note.wav (no hidden parts, no ..)" };
  const fehlt = { fehler: "no such audio file in the project (symbolic links are not followed)" };
  let echt: string;
  try {
    if (!lstatSync(ort).isDirectory()) return fehlt;
    echt = realpathSync(ort);
  } catch {
    return fehlt;
  }
  let p = ort;
  for (let i = 0; i < teile.length; i++) {
    p = join(p, teile[i]!);
    let st;
    try {
      st = lstatSync(p);
    } catch {
      return fehlt;
    }
    if (st.isSymbolicLink() || (i < teile.length - 1 ? !st.isDirectory() : !st.isFile())) return fehlt;
    if (i === teile.length - 1 && st.size > TON_BYTES) return { fehler: `audio too long – ${TON_FORM}` };
  }
  let fd: number;
  try {
    fd = openSync(p, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return fehlt;
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) return fehlt;
    if (process.platform === "linux" && !readlinkSync(`/proc/self/fd/${fd}`).startsWith(echt + sep)) return fehlt;
    if (st.size > TON_BYTES) return { fehler: `audio too long – ${TON_FORM}` };
    const puffer = Buffer.alloc(TON_BYTES + 1);
    let n = 0;
    for (let r; n < puffer.length && (r = readSync(fd, puffer, n, puffer.length - n, null)) > 0;) n += r;
    if (n > TON_BYTES) return { fehler: `audio too long – ${TON_FORM}` };
    const ton = new Uint8Array(puffer.subarray(0, n));
    const wav = pruefeWav(ton);
    if (!wav.ok) return { fehler: wav.fall === "wav-lang" ? `audio too long – ${TON_FORM}` : wav.fall === "wav-leer" ? "the audio file is empty" : `not the required form – ${TON_FORM}` };
    return { ton };
  } catch {
    return fehlt;
  } finally {
    closeSync(fd);
  }
}

/** Feste Texte zu den Ablehnungen von Whisper – nie der Text eines Fehlers. */
const ABGELEHNT: Partial<Record<SpracheAbgelehnt["fall"], string>> = {
  "sprache-belegt": "speech recognition is busy – try again in a minute",
  "sprache-zeit": "speech recognition took too long",
};

/**
 * Text aus einer WAV-Datei des Projekts – Ergebnis für das Modell. Wirft nie; Ton und Text bleiben im Speicher und im
 * Arbeitsordner von Whisper (danach gelöscht), nie im Log.
 */
export async function transkribiereImProjekt(whisper: Pick<Whisper, "transkribiere">, ort: string, pfad: string, sprache: SpracheWahl): Promise<{ ok: boolean; output: string }> {
  const r = leseTonImProjekt(ort, pfad);
  if ("fehler" in r) return { ok: false, output: r.fehler };
  try {
    const text = await whisper.transkribiere(r.ton, sprache);
    return { ok: true, output: text.length > 0 ? text : "(no speech recognized)" };
  } catch (e) {
    return { ok: false, output: (e instanceof SpracheAbgelehnt && ABGELEHNT[e.fall]) || "speech recognition failed" };
  }
}
