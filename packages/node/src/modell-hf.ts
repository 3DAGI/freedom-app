/**
 * Gewichte von Hugging Face in einen Ordner laden, geprüft gegen ein Manifest
 * (Schritt B-29c1a, Bausteine; im Knoten verdrahtet mit B-29c1b). Für Antriebe
 * außer Ollama (B-29a: vLLM, SGLang, TensorFold) – sie lesen das Modell aus
 * einem Ordner (`vllm serve <ordner> --served-model-name <org/repo>`).
 *
 * - `holeHfStand()`: Commit und Dateiangaben (`hfStand()`), ohne Weiterleitung, begrenzt.
 * - `halteHfFest()`: Dateien für ein eigenes Manifest – große mit der SHA-256,
 *   die Hugging Face für LFS nennt; kleine geladen, gegen ihre Git-Kennung
 *   geprüft und selbst gerechnet.
 * - `ladeHfDatei()`: eine Datei in den Ordner, SHA-256 beim Laden, nie mehr als
 *   die Größe im Manifest; unter ihrem Namen erst nach bestandener Prüfung
 *   (vorher `.teil`). Liegt sie schon richtig da, wird nichts geladen.
 *
 * Nach außen und ins Log nur Kennungen, Zahlen und Fehlernamen – nie Text von
 * Hugging Face. Hugging Face ist aus dieser Umgebung nicht erreichbar – die Tests
 * laufen gegen einen Server auf 127.0.0.1, Live-Proben macht der MENSCH.
 */
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { HF_DATEI, type HfName, type HfStand, type ModelFile, hfDateiAdresse, hfStand, hfStandAdresse } from "@freedomstack/protocol";
import { leseBegrenzt } from "./url-guard.js";

type Holen = (url: string, init: RequestInit) => Promise<Response>;
const netz: Holen = (i, o) => fetch(i, o);
const fehler = (name: string): Error => Object.assign(new Error(name), { name });

/** Die Antwort mit den Dateiangaben – auch große Repos bleiben weit darunter. */
export const HF_STAND_MAX = 2 * 1024 * 1024;
/** Kleine Dateien (ohne LFS-Summe) lädt `halteHfFest()` ganz in den Speicher – größere weist es ab. */
export const HF_KLEIN_MAX = 64 * 1024 * 1024;
/** So lange darf ein Download ohne neue Bytes stehen, dann bricht er ab. */
export const HF_STILL_MS = 60_000;

const status = (r: Response): void => {
  if (r.status === 401 || r.status === 403) throw fehler("HfGesperrt");
  if (r.status === 404) throw fehler("HfFehlt");
  if (!r.ok || !r.body) throw fehler("HfAntwort");
};

/** Stand eines Commits oder Zweigs; wirft bei Netz- und HTTP-Fehlern (nur mit Namen). */
export async function holeHfStand(n: HfName, rev = "main", basis?: string, holen: Holen = netz): Promise<HfStand> {
  const adresse = hfStandAdresse(n, rev, basis);
  const json = adresse ? await holeStandJson(adresse, holen) : undefined;
  return json === undefined ? { ok: false, fall: "hf.form" } : hfStand(json);
}

/** Die Antwort mit den Dateiangaben als JSON – undefined, wenn sie zu lang oder kein JSON ist; wirft bei Netz- und HTTP-Fehlern. */
export async function holeStandJson(adresse: string, holen: Holen = netz): Promise<unknown> {
  const r = await holen(adresse, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  status(r);
  const { text, abgeschnitten } = await leseBegrenzt(r, HF_STAND_MAX);
  if (abgeschnitten) return undefined;
  try { return JSON.parse(text) as unknown; } catch { return undefined; }
}

/** Git-Kennung einer Datei (SHA-1 über „blob <Länge>\0“ und Inhalt) – so nennt Hugging Face kleine Dateien. */
export const gitKennung = (bytes: Uint8Array): string =>
  createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");

/** Antwort einer Datei-Adresse: Weiterleitungen (LFS → Speicher) ja, aber nie von https zu http. */
async function holeDatei(url: string, holen: Holen, signal?: AbortSignal): Promise<Response> {
  const r = await holen(url, { redirect: "follow", ...(signal ? { signal } : {}) });
  if (r.url && new URL(r.url).protocol !== new URL(url).protocol) throw fehler("HfWeiterleitung");
  status(r);
  return r;
}

/** Genau `groesse` Bytes – mehr bricht sofort ab, weniger ergibt null. */
async function leseBytes(r: Response, groesse: number): Promise<Uint8Array | null> {
  const bytes = new Uint8Array(groesse);
  let n = 0;
  for await (const stueck of r.body as unknown as AsyncIterable<Uint8Array>) {
    if (n + stueck.length > groesse) return null;
    bytes.set(stueck, n);
    n += stueck.length;
  }
  return n === groesse ? bytes : null;
}

export type Festgehalten =
  | { ok: true; commit: string; dateien: ModelFile[]; lizenz?: string }
  | { ok: false; fall: "hf.form" | "hf.ohneGewichte" | "hf.anders" | "hf.zuGross" };

/**
 * Was ein eigenes Manifest nennen soll: die Dateien am Commit von `rev`. Die
 * Summe der kleinen erst, wenn ihre Git-Kennung stimmt – sonst kein Manifest.
 */
export async function halteHfFest(n: HfName, rev = "main", basis?: string, holen: Holen = netz): Promise<Festgehalten> {
  const s = await holeHfStand(n, rev, basis, holen);
  if (!s.ok) return s;
  const dateien: ModelFile[] = [];
  for (const d of s.dateien) {
    if (d.sha256) { dateien.push({ name: d.name, sha256: d.sha256, sizeBytes: d.groesse }); continue; }
    if (d.groesse > HF_KLEIN_MAX) return { ok: false, fall: "hf.zuGross" };
    const r = await holeDatei(hfDateiAdresse(n, s.commit, d.name, basis)!, holen, AbortSignal.timeout(HF_STILL_MS));
    const bytes = await leseBytes(r, d.groesse);
    if (!bytes || gitKennung(bytes) !== d.git) return { ok: false, fall: "hf.anders" };
    dateien.push({ name: d.name, sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: d.groesse });
  }
  return { ok: true, commit: s.commit, dateien, ...(s.lizenz ? { lizenz: s.lizenz } : {}) };
}

/** SHA-256 einer Datei auf der Platte, gestreamt. */
export async function summeDerDatei(pfad: string): Promise<string> {
  const h = createHash("sha256");
  for await (const teil of createReadStream(pfad)) h.update(teil as Buffer);
  return h.digest("hex");
}

/** Ordner eines Modells unter der Basis: `<basis>/<org>/<repo>` – die Teile hat `leseHfName()` geprüft. */
export const hfOrdner = (basis: string, n: HfName): string => join(basis, n.org, n.repo);

/** Was im Ordner liegt (oberste Ebene): Name und Größe je Eintrag – Unterordner mit Größe -1. */
export function ordnerInhalt(ordner: string): Array<{ name: string; groesse: number }> {
  if (!existsSync(ordner)) return [];
  return readdirSync(ordner, { withFileTypes: true }).map((e) => ({ name: e.name, groesse: e.isFile() ? statSync(join(ordner, e.name)).size : -1 }));
}

/**
 * Fingerabdruck eines Ordners ohne ihn zu lesen (B-29c1b): Name, Größe und Zeit
 * der letzten Änderung jedes Eintrags. Ändert jemand eine Datei, legt eine dazu
 * oder löscht eine, ändert er sich – dann bietet der Knoten das Modell nicht
 * mehr an, bis es neu geprüft ist. Null, wenn der Ordner fehlt.
 */
export function ordnerAbdruck(ordner: string): string | null {
  if (!existsSync(ordner)) return null;
  const zeilen = readdirSync(ordner, { withFileTypes: true }).map((e) => {
    const s = statSync(join(ordner, e.name));
    return `${e.name}\0${e.isFile() ? s.size : -1}\0${Math.floor(s.mtimeMs)}`;
  }).sort();
  return createHash("sha256").update(zeilen.join("\n")).digest("hex");
}

/**
 * Eine Datei des Manifests in den Ordner laden und dabei prüfen. „vorhanden“,
 * wenn sie schon mit Größe und Summe dort liegt. Wirft `DateiZuGross` (mehr Bytes
 * als angekündigt, sofort abgebrochen), `DateiAnders` (Summe oder Größe falsch),
 * `HfStill` (zu lange keine Bytes) – das Bruchstück wird gelöscht.
 */
export async function ladeHfDatei(
  n: HfName, commit: string, ordner: string, f: ModelFile,
  o: { basis?: string; holen?: Holen; fortschritt?: (bytes: number) => void; stillMs?: number } = {},
): Promise<"vorhanden" | "geladen"> {
  const url = hfDateiAdresse(n, commit, f.name, o.basis);
  if (!url || !HF_DATEI.test(f.name)) throw fehler("DateiName");
  return ladeGepruefteDatei(url, ordner, f, o);
}

/**
 * Der Teil von `ladeHfDatei()`, der für jede Quelle gleich ist (seit B-38b3b2 auch für Whisper): die Adresse hat der
 * Aufrufer geprüft, `f.name` ist ein Name ohne Pfad.
 */
export async function ladeGepruefteDatei(
  url: string, ordner: string, f: ModelFile, o: { holen?: Holen; fortschritt?: (bytes: number) => void; stillMs?: number } = {},
): Promise<"vorhanden" | "geladen"> {
  const ziel = join(ordner, f.name);
  if (existsSync(ziel) && statSync(ziel).size === f.sizeBytes && (await summeDerDatei(ziel)) === f.sha256) return "vorhanden";
  mkdirSync(ordner, { recursive: true, mode: 0o755 });
  const teil = `${ziel}.teil`;
  const abbruch = new AbortController();
  let still: NodeJS.Timeout | undefined;
  const wache = () => { clearTimeout(still); still = setTimeout(() => abbruch.abort(fehler("HfStill")), o.stillMs ?? HF_STILL_MS); };
  const aus = createWriteStream(teil, { mode: 0o644 });
  try {
    wache();
    const r = await holeDatei(url, o.holen ?? netz, abbruch.signal);
    const h = createHash("sha256");
    let gelesen = 0;
    for await (const stueck of r.body as unknown as AsyncIterable<Uint8Array>) {
      wache();
      gelesen += stueck.length;
      if (gelesen > f.sizeBytes) throw fehler("DateiZuGross");
      h.update(stueck);
      if (!aus.write(stueck)) await once(aus, "drain");
      o.fortschritt?.(gelesen);
    }
    aus.end();
    await once(aus, "finish");
    if (gelesen !== f.sizeBytes || h.digest("hex") !== f.sha256) throw fehler("DateiAnders");
    renameSync(teil, ziel);
    return "geladen";
  } catch (e) {
    aus.destroy();
    rmSync(teil, { force: true });
    throw abbruch.signal.aborted && abbruch.signal.reason instanceof Error ? abbruch.signal.reason : e;
  } finally {
    clearTimeout(still);
  }
}
