/**
 * Modelle von Hugging Face, geprüft gegen ein Manifest (Schritt B-29c1a,
 * Entwurf `docs/E9-ENTWURF.md` V3; Quellen entschieden vom MENSCHEN am 12.10.2026).
 *
 * Für Antriebe außer Ollama (B-29a: vLLM, SGLang, TensorFold) liegen die
 * Gewichte als Dateien in einem Ordner. Hugging Face nennt je Commit jede
 * Datei mit Größe: große (LFS) mit SHA-256, kleine mit ihrer Git-Kennung
 * (SHA-1 über „blob <Länge>\0“ und Inhalt). Wer ein Manifest festhält, rechnet
 * die SHA-256 der kleinen selbst – erst nachdem die Git-Kennung stimmt.
 *
 * Konvention für HF-Manifeste: `model` ist die Kennung bei Hugging Face
 * (`Qwen/Qwen2.5-7B-Instruct`) – so nennt der Antrieb das Modell
 * (`--served-model-name`) –, `upstream` ist `hf:<Kennung>@<Commit>` (40 Zeichen
 * Hex, nie ein Zweig), jede Datei heißt wie im Repo.
 *
 * Nur Gewichte ohne ausführbaren Code: `.safetensors`, Konfiguration und
 * Tokenizer (`HF_DATEI`), nur aus der obersten Ebene. Pickle (`.bin`, `.pt`) und
 * Python (`trust_remote_code`) lädt der Knoten nie – beides kann beim Laden
 * Code ausführen.
 *
 * Auch hier gilt die Grenze aus `model-registry.ts`: Die Prüfung sagt, ob die
 * Bytes die angekündigten sind – nicht, ob das Modell gut, sicher oder legal ist.
 */
import { type ModelManifest } from "./model-registry.js";

/** Die einzige Adresse von Hugging Face, die der Knoten befragt. */
export const HF_BASIS = "https://huggingface.co";

export interface HfName {
  org: string;
  repo: string;
  /** `org/repo` – so steht es im Manifest und im Angebot. */
  voll: string;
}

// Regeln von Hugging Face: Buchstaben, Ziffern, „-“, „_“, „.“; nicht am Rand, kein „--“ oder „..“, höchstens 96
const TEIL = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,94}[A-Za-z0-9])?$/;
const gueltigerTeil = (s: string) => TEIL.test(s) && !s.includes("--") && !s.includes("..");

/** `org/repo`, genau zwei Teile; sonst null. */
export function leseHfName(s: string): HfName | null {
  const teile = s.split("/");
  if (teile.length !== 2 || !teile.every(gueltigerTeil)) return null;
  return { org: teile[0]!, repo: teile[1]!, voll: `${teile[0]}/${teile[1]}` };
}

const COMMIT = /^[0-9a-f]{40}$/;
const ZWEIG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Stand eines Commits oder Zweigs samt Dateiangaben (`blobs=true`) – nur aus geprüften Teilen. */
export function hfStandAdresse(n: HfName, rev = "main", basis = HF_BASIS): string | null {
  if (!COMMIT.test(rev) && !ZWEIG.test(rev)) return null;
  return `${basis}/api/models/${encodeURIComponent(n.org)}/${encodeURIComponent(n.repo)}/revision/${encodeURIComponent(rev)}?blobs=true`;
}

/** Was in den Ordner darf: Gewichte als safetensors, Konfiguration, Tokenizer, Vorlage – oberste Ebene. */
export const HF_DATEI = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}\.(safetensors|json|model|txt|tiktoken|jinja)$/;
/** Mehr Dateien hat kein Modell; was mehr nennt, ist kein Modell-Repo. */
export const MAX_HF_DATEIEN = 512;

/** Eine Datei, immer an einem Commit – nie an einem Zweig, der sich ändern kann. */
export function hfDateiAdresse(n: HfName, commit: string, name: string, basis = HF_BASIS): string | null {
  if (!COMMIT.test(commit) || !HF_DATEI.test(name)) return null;
  return `${basis}/${encodeURIComponent(n.org)}/${encodeURIComponent(n.repo)}/resolve/${commit}/${encodeURIComponent(name)}`;
}

export interface HfDatei {
  name: string;
  groesse: number;
  /** Nur bei LFS – die kleinen rechnet, wer festhält, selbst. */
  sha256?: string;
  /** Git-Kennung (SHA-1), für die kleinen die einzige Angabe vorher. */
  git: string;
}
export type HfStand =
  | { ok: true; commit: string; dateien: HfDatei[]; lizenz?: string }
  | { ok: false; fall: "hf.form" | "hf.ohneGewichte" };

/**
 * Antwort auf `hfStandAdresse()` lesen: Commit, und je erlaubter Datei Größe,
 * Git-Kennung und – bei LFS – SHA-256. Andere Dateien bleiben draußen.
 * Ohne `config.json` und ohne safetensors ist es kein Modell, das der Knoten
 * lädt (`hf.ohneGewichte` – etwa nur Pickle oder GGUF).
 */
export function hfStand(json: unknown): HfStand {
  const d = json as { sha?: unknown; siblings?: unknown; cardData?: { license?: unknown } } | null;
  if (!d || typeof d.sha !== "string" || !COMMIT.test(d.sha) || !Array.isArray(d.siblings)) return { ok: false, fall: "hf.form" };
  const dateien: HfDatei[] = [];
  for (const s of d.siblings as Array<{ rfilename?: unknown; size?: unknown; blobId?: unknown; lfs?: { sha256?: unknown; size?: unknown } } | null>) {
    if (typeof s?.rfilename !== "string" || !HF_DATEI.test(s.rfilename)) continue;
    const groesse = s.size;
    if (groesse === 0) continue; // leer – ein Manifest kennt keine leeren Dateien
    if (!Number.isSafeInteger(groesse) || (groesse as number) <= 0 || typeof s.blobId !== "string" || !COMMIT.test(s.blobId)) return { ok: false, fall: "hf.form" };
    const datei: HfDatei = { name: s.rfilename, groesse: groesse as number, git: s.blobId };
    if (s.lfs !== undefined) {
      if (typeof s.lfs?.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(s.lfs.sha256) || s.lfs.size !== groesse) return { ok: false, fall: "hf.form" };
      datei.sha256 = s.lfs.sha256;
    }
    dateien.push(datei);
  }
  if (dateien.length > MAX_HF_DATEIEN || new Set(dateien.map((x) => x.name)).size !== dateien.length) return { ok: false, fall: "hf.form" };
  if (!dateien.some((x) => x.name === "config.json") || !dateien.some((x) => x.name.endsWith(".safetensors"))) return { ok: false, fall: "hf.ohneGewichte" };
  const lizenz = typeof d.cardData?.license === "string" && /^[A-Za-z0-9.+-]{1,64}$/.test(d.cardData.license) ? d.cardData.license : undefined;
  return { ok: true, commit: d.sha, dateien, ...(lizenz ? { lizenz } : {}) };
}

/** Quelle eines Manifests: `upstream` = `hf:<Kennung>@<Commit>`, gleich dem Modellnamen; sonst null. */
export function hfQuelle(m: ModelManifest): { name: HfName; commit: string } | null {
  const t = /^hf:([^@]+)@([0-9a-f]{40})$/.exec(m.upstream ?? "");
  const name = t ? leseHfName(t[1]!) : null;
  return name && name.voll === m.modelId && m.files.every((f) => HF_DATEI.test(f.name)) ? { name, commit: t![2]! } : null;
}

/** Eine Datei, wie sie geladen im Ordner liegt (Summe selbst gerechnet). */
export interface GeladeneDatei { name: string; sha256: string; groesse: number }

export type DateiPruefung =
  | { ok: true; dateien: number; bytes: number }
  | { ok: false; fall: "datei.fremd" | "datei.summe" | "datei.groesse" | "datei.fehlt"; werte: { anzahl: number } };

/** Sind es genau die Dateien des Manifests? Je Name dieselbe Summe und Größe, keine fremde, keine fehlende. */
export function pruefeDateien(m: ModelManifest, dateien: readonly GeladeneDatei[]): DateiPruefung {
  const gesehen = new Set<string>();
  const fehler = { fremd: 0, summe: 0, groesse: 0 };
  for (const d of dateien) {
    const f = m.files.find((x) => x.name === d.name);
    if (!f) { fehler.fremd++; continue; }
    if (f.sha256 !== d.sha256.toLowerCase()) { fehler.summe++; continue; }
    if (f.sizeBytes !== d.groesse) { fehler.groesse++; continue; }
    gesehen.add(d.name);
  }
  if (fehler.fremd) return { ok: false, fall: "datei.fremd", werte: { anzahl: fehler.fremd } };
  if (fehler.summe) return { ok: false, fall: "datei.summe", werte: { anzahl: fehler.summe } };
  if (fehler.groesse) return { ok: false, fall: "datei.groesse", werte: { anzahl: fehler.groesse } };
  const fehlt = m.files.filter((f) => !gesehen.has(f.name)).length;
  if (fehlt) return { ok: false, fall: "datei.fehlt", werte: { anzahl: fehlt } };
  return { ok: true, dateien: m.files.length, bytes: m.totalBytes };
}

/**
 * Vorprüfung vor dem Laden: Nennt Hugging Face am Commit des Manifests dieselben
 * Dateien? Namen und Größen immer, Summen der großen (LFS); die kleinen prüft
 * erst die Summe nach dem Laden.
 */
export function vorpruefeHf(m: ModelManifest, s: Extract<HfStand, { ok: true }>): DateiPruefung {
  return pruefeDateien(m, s.dateien.map((d) => ({ name: d.name, groesse: d.groesse, sha256: d.sha256 ?? m.files.find((f) => f.name === d.name)?.sha256 ?? "" })));
}
