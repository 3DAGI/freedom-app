/**
 * Das Modell für Text aus Sprache laden (Schritt B-38b3b2, Entwurf `docs/SPRACHE-ENTWURF.md` V4, `docs/PROTOCOL.md` §43).
 *
 * Wie andere Modelle (E9-3a, B-29c1b): Wunsch über `npm run modell -- --whisper [name]`, Manifest (38057) vom eigenen
 * Schlüssel oder aus einem abonnierten Katalog (`vertrautesManifest()` mit `whisperQuelle()`), mit `--aus-hf` vorher
 * festgehalten, was Hugging Face jetzt nennt. Geladen wird genau die eine Datei `ggml-<name>.bin` aus dem Repo von
 * whisper.cpp am Commit des Manifests – SHA-256 beim Laden, nie mehr Bytes als angekündigt –, und sie muss mit der
 * Kennung `ggml` beginnen (`istGgml()`). Gemerkt mit dem Abdruck der Datei (`dateiAbdruck()`): Ändert sie sich, gilt sie
 * nicht mehr als geprüft.
 *
 * Ein Whisper-Modell steht nie im Angebot für KI – es gehört nur zu Text aus Sprache (B-38b2). Nach außen und ins Log nur
 * Kennungen, Zahlen und Fehlernamen.
 */
import { lstatSync, openSync, readSync, closeSync, rmSync, constants } from "node:fs";
import { join } from "node:path";
import {
  type ModelFile, type NostrEvent, type WhisperStand, hfStandAdresse, istGgml, leseWhisperName, vertrautesManifest,
  whisperDatei, whisperDateiAdresse, whisperKennung, whisperQuelle, whisperStand, WHISPER_HF,
} from "@freedomstack/protocol";
import { holeStandJson, ladeGepruefteDatei } from "./modell-hf.js";
import type { LadeErgebnis, LaderHilfen, Schritt } from "./modell-laden.js";

type Holen = (url: string, init: RequestInit) => Promise<Response>;
const fehler = (name: string): Error => Object.assign(new Error(name), { name });
const fehlerName = (e: unknown): string => (e instanceof Error && e.name) || "Fehler";

/** Was der Weg für Whisper braucht (in `main.ts` verdrahtet) – unabhängig vom KI-Antrieb. */
export interface WhisperHilfen {
  /** Wohin die Modelle kommen: `<MODELL_ORDNER>/whisper`. */
  ordner: string;
  stand(name: string, rev: string): Promise<WhisperStand>;
  ladeDatei(commit: string, name: string, ordner: string, f: ModelFile, fortschritt: (bytes: number) => void): Promise<unknown>;
  abdruck(datei: string): string | null;
}

/** Stand am Commit oder Zweig `rev` – die eine Datei des Modells; wirft bei Netz- und HTTP-Fehlern (nur mit Namen). */
export async function holeWhisperStand(name: string, rev = "main", basis?: string, holen?: Holen): Promise<WhisperStand> {
  const adresse = hfStandAdresse(WHISPER_HF, rev, basis);
  const json = adresse ? await holeStandJson(adresse, holen) : undefined;
  return json === undefined ? { ok: false, fall: "whisper.form" } : whisperStand(json, name);
}

/** Die ersten vier Byte einer Datei – ohne einem Verweis zu folgen. */
function kopf(datei: string): Uint8Array {
  const fd = openSync(datei, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const b = new Uint8Array(4);
    return b.subarray(0, readSync(fd, b, 0, 4, 0));
  } finally {
    closeSync(fd);
  }
}

/**
 * Die Datei des Modells laden und prüfen: Adresse nur am Commit (`whisperDateiAdresse()`), SHA-256 und Größe beim Laden
 * (`ladeGepruefteDatei()`), danach die Kennung `ggml` – sonst wird sie gelöscht (`KeinGgml`).
 */
export async function ladeWhisperDatei(
  commit: string, name: string, ordner: string, f: ModelFile,
  o: { basis?: string; holen?: Holen; fortschritt?: (bytes: number) => void; stillMs?: number } = {},
): Promise<"vorhanden" | "geladen"> {
  const url = whisperDateiAdresse(commit, name, o.basis);
  if (!url || f.name !== whisperDatei(name)) throw fehler("DateiName");
  const r = await ladeGepruefteDatei(url, ordner, f, o);
  const ziel = join(ordner, f.name);
  if (!istGgml(kopf(ziel))) {
    rmSync(ziel, { force: true });
    throw fehler("KeinGgml");
  }
  return r;
}

/**
 * Abdruck einer Datei ohne sie zu lesen: Größe, Zeit der letzten Änderung und Inode. Null, wenn sie fehlt oder keine
 * gewöhnliche Datei ist (ein Verweis zählt nicht).
 */
export function dateiAbdruck(datei: string): string | null {
  try {
    const s = lstatSync(datei);
    return s.isFile() ? `${s.size}:${Math.floor(s.mtimeMs)}:${s.ino}` : null;
  } catch {
    return null;
  }
}

/** Ein Whisper-Modell laden: Manifest wählen (oder festhalten), vorprüfen, laden, prüfen. */
export async function ladeWhisperModell(
  name: string, h: LaderHilfen, melde: (schritt: Schritt, geladen?: number, gesamt?: number) => void,
  jetzt = () => Math.floor(Date.now() / 1000), ausHf = false,
): Promise<LadeErgebnis> {
  const w = h.whisper;
  const n = leseWhisperName(name);
  if (!w || !n) return { ok: false, fall: "whisper.form" };
  const kennung = whisperKennung(n);
  melde("manifest");
  let events: NostrEvent[];
  let frei: ReadonlySet<string> = new Set();
  if (ausHf) {
    let s: WhisperStand;
    try { s = await w.stand(n, "main"); } catch (e) { return { ok: false, fall: "whisper.nichtErreichbar", werte: { fehler: fehlerName(e) } }; }
    if (!s.ok) return { ok: false, fall: s.fall };
    try {
      events = [await h.festhalten(kennung, [s.datei], `hf:${WHISPER_HF.voll}@${s.commit}`, s.lizenz)];
    } catch (e) {
      return { ok: false, fall: "manifest.nichtVeroeffentlicht", werte: { fehler: fehlerName(e) } };
    }
  } else {
    frei = await h.freigaben(kennung).catch(() => new Set<string>());
    events = await h.manifeste(kennung, [...frei]);
  }
  const wahl = vertrautesManifest(events, kennung, frei, h.eigener, whisperQuelle);
  if (!wahl.ok) return { ok: false, fall: wahl.fall, werte: wahl.werte };
  const { manifest: m, quelle } = wahl;
  // Vorprüfung am Commit des Manifests: nennt Hugging Face dort eine andere Datei, wird nichts geladen
  melde("vorpruefung");
  const stand = await w.stand(n, quelle.commit).catch(() => null);
  if (stand?.ok && (stand.datei.sha256 !== quelle.datei.sha256 || stand.datei.sizeBytes !== quelle.datei.sizeBytes)) {
    return { ok: false, fall: "whisper.anders" };
  }
  melde("laden", 0, m.totalBytes);
  try {
    await w.ladeDatei(quelle.commit, n, w.ordner, quelle.datei, (b) => melde("laden", b, m.totalBytes));
  } catch (e) {
    return { ok: false, fall: fehlerName(e) === "KeinGgml" ? "whisper.keinGgml" : "whisper.laden", werte: { fehler: fehlerName(e) } };
  }
  melde("pruefen");
  const datei = join(w.ordner, quelle.datei.name);
  const abdruck = w.abdruck(datei);
  if (!abdruck) return { ok: false, fall: "datei.fehlt", werte: { anzahl: 1 } };
  return {
    ok: true,
    modell: {
      name: kennung, manifest: wahl.id, herausgeber: m.publisherPubkey, dateien: 1, bytes: m.totalBytes, ollama: "", geprueft: jetzt(),
      quelle: "whisper", datei, abdruck,
    },
  };
}
