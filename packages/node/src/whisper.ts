/**
 * Text aus Sprache beim eigenen Knoten (Sammlung B-38, SP-W1 A, `docs/SPRACHE-ENTWURF.md`, `docs/PROTOCOL.md` §43):
 * `whisper-cli` aus whisper.cpp (MIT) je Auftrag in der Sandbox (`fuehreAus()`: ohne Netz, Programm und Modell nur
 * lesbar, schreibbar nur der Arbeitsordner mit dem Ton) – kein Server, kein offener Port (Befund B-38b1). Ein Auftrag
 * zur Zeit. Ton und Text sind Inhalt: nur im Speicher und im Arbeitsordner (0700, danach gelöscht), nie ins Log; nach
 * außen nur `SpracheAbgelehnt` mit Kennung.
 */
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { SPRACHE_GRENZEN, type SpracheFall, type SpracheWahl } from "@freedomstack/protocol";
import { neuerArbeitsordner } from "./arbeitskopie.js";
import { fuehreAus } from "./sandbox.js";

/** Ablehnung mit fester Kennung – die App zeigt nur ihren Text dazu (Tag `fall` der Rückmeldung). */
export class SpracheAbgelehnt extends Error {
  constructor(readonly fall: SpracheFall) {
    super(`Text aus Sprache abgelehnt (${fall})`);
    this.name = "SpracheAbgelehnt";
  }
}

/** Ort des Modells und des Programms in der Sandbox – je eine Datei, nur lesbar, nie ein Ordner darüber. */
const MODELL_INNEN = "/modell/whisper.bin";
const CLI_INNEN = "/opt/whisper-cli";
/** Mehr liest der Knoten aus der Ausgabe nicht – 8000 Zeichen sind höchstens 32 000 Byte UTF-8. */
const TEXT_BYTES = 64 * 1024;

export interface WhisperDienst {
  /** `whisper-cli` – absolut; unter `/usr` sieht ihn die Sandbox ohnehin, sonst wird nur die Datei eingebunden (statisch gebaut, B-38b3). */
  cli: string;
  /** ggml-Modell (`.bin`), absolut. */
  modell: string;
  /** GPU in die Sandbox (`WHISPER_GPU=1`); sonst `-ng`. */
  gpu: boolean;
  threads: number;
  /** Frist je Auftrag; die Rechenzeit ist Frist mal Threads. */
  fristSek: number;
  /** Programm für bubblewrap (Test). */
  bwrap?: string;
}

const datei = (p: string): boolean => { try { return statSync(p).isFile(); } catch { return false; } };

/** Aus der Umgebung – nie halb: ohne `WHISPER_MODELL` aus, mit ungültigen Werten aus samt Grund fürs Log. */
export function whisperAusUmgebung(env: {
  WHISPER_MODELL?: string; WHISPER_CLI?: string; WHISPER_GPU?: string; WHISPER_THREADS?: string; WHISPER_FRIST_SEK?: string;
}): { dienst?: WhisperDienst; grund?: string } {
  const modell = (env.WHISPER_MODELL ?? "").trim();
  if (!modell) return { grund: "aus (WHISPER_MODELL setzen)" };
  if (!isAbsolute(modell) || !modell.endsWith(".bin") || !datei(modell)) return { grund: "WHISPER_MODELL ungültig (absoluter Pfad zu einer .bin-Datei)" };
  const cli = (env.WHISPER_CLI ?? "/usr/local/bin/whisper-cli").trim();
  if (!isAbsolute(cli) || !datei(cli)) return { grund: "whisper-cli fehlt (WHISPER_CLI, Vorgabe /usr/local/bin/whisper-cli)" };
  const gpu = (env.WHISPER_GPU ?? "0").trim();
  if (gpu !== "0" && gpu !== "1") return { grund: "WHISPER_GPU ungültig (0 oder 1)" };
  const threads = env.WHISPER_THREADS ? Number(env.WHISPER_THREADS) : 4;
  if (!Number.isSafeInteger(threads) || threads < 1 || threads > 64) return { grund: "WHISPER_THREADS ungültig (1 bis 64)" };
  const frist = env.WHISPER_FRIST_SEK ? Number(env.WHISPER_FRIST_SEK) : 600;
  if (!Number.isSafeInteger(frist) || frist < 10 || frist > 3600) return { grund: "WHISPER_FRIST_SEK ungültig (10 bis 3600)" };
  return { dienst: { cli, modell, gpu: gpu === "1", threads, fristSek: frist } };
}

/** Den Text aus der Ausgabedatei lesen – nur eine echte Datei (`lstat`, `O_NOFOLLOW`), begrenzt, Steuerzeichen weg. */
function leseText(pfad: string): string | null {
  let st;
  try {
    st = lstatSync(pfad);
  } catch {
    return null;
  }
  if (!st.isFile() || st.size > TEXT_BYTES) return null;
  const fd = openSync(pfad, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!fstatSync(fd).isFile()) return null;
    const puffer = Buffer.alloc(TEXT_BYTES + 1);
    let n = 0;
    for (let r; n < puffer.length && (r = readSync(fd, puffer, n, puffer.length - n, null)) > 0;) n += r;
    if (n > TEXT_BYTES) return null;
    return puffer.subarray(0, n).toString("utf8")
      .replace(/\r/g, "")
      .replace(/\u001b\[[0-9;?]*[ -\/]*[@-~]/g, "") // Farben und Steuerfolgen des Terminals
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
      .split("\n").map((z) => z.trim()).filter((z) => z.length > 0).join("\n")
      .slice(0, SPRACHE_GRENZEN.textZeichen);
  } finally {
    closeSync(fd);
  }
}

export class Whisper {
  private belegt = false;
  constructor(private readonly d: WhisperDienst, private readonly basis?: string) {}

  /** Ton (schon mit `pruefeWav()` geprüft) in Text – eine Datei hinein, eine heraus; der Ordner ist danach weg. */
  async transkribiere(wav: Uint8Array, sprache: SpracheWahl): Promise<string> {
    if (this.belegt) throw new SpracheAbgelehnt("sprache-belegt");
    this.belegt = true;
    const { ordner, weg } = neuerArbeitsordner(...(this.basis ? [this.basis] : []));
    try {
      writeFileSync(join(ordner, "ton.wav"), wav, { mode: 0o600, flag: "wx" });
      const unterUsr = this.d.cli.startsWith("/usr/");
      const befehl = [
        unterUsr ? this.d.cli : CLI_INNEN, "-m", MODELL_INNEN, "-f", "/arbeit/ton.wav", "-l", sprache, "-t", String(this.d.threads),
        "-nt", "-np", "-otxt", "-of", "/arbeit/text", ...(this.d.gpu ? [] : ["-ng"]),
      ];
      let r;
      try {
        r = await fuehreAus(befehl, {
          arbeit: ordner, gpu: this.d.gpu, rechenzeitSek: this.d.fristSek * this.d.threads,
          nurLesbar: [{ quelle: this.d.modell, ziel: MODELL_INNEN }, ...(unterUsr ? [] : [{ quelle: this.d.cli, ziel: CLI_INNEN }])],
          ...(this.d.bwrap ? { bwrap: this.d.bwrap } : {}),
        }, this.d.fristSek * 1000);
      } catch {
        throw new SpracheAbgelehnt("sprache-whisper"); // bubblewrap startet nicht
      }
      if (r.zeitUm) throw new SpracheAbgelehnt("sprache-zeit");
      const text = r.code === 0 ? leseText(join(ordner, "text.txt")) : null;
      if (text === null) throw new SpracheAbgelehnt("sprache-whisper");
      return text;
    } finally {
      weg();
      this.belegt = false;
    }
  }
}
