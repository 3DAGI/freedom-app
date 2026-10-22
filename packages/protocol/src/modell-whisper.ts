/**
 * Whisper-Modelle über ein Manifest (Schritt B-38b3b1, Entwurf `docs/SPRACHE-ENTWURF.md` V4, Vorgabe SP-W4 C).
 *
 * Text aus Sprache (B-38b2) braucht genau eine Datei: ein ggml-Modell von whisper.cpp. Es kommt wie andere Modelle
 * über ein Manifest (38057) mit Prüfsumme, gewählt über `vertrautesManifest()` mit `whisperQuelle()`, geladen von
 * Hugging Face aus dem Repo, das whisper.cpp selbst nennt (`models/download-ggml-model.sh` in v1.9.5).
 *
 * Konvention: `model` ist `whisper:<name>` (`whisper:large-v3-turbo-q5_0`) – nie ein Name bei Ollama oder Hugging
 * Face –, `upstream` ist `hf:ggerganov/whisper.cpp@<Commit>` (40 Zeichen Hex), und das Manifest nennt genau eine
 * Datei `ggml-<name>.bin`.
 *
 * `.bin` ist hier kein Pickle: whisper.cpp schreibt sein eigenes Format, das mit der Kennung `ggml` beginnt
 * (`0x67676d6c` als Zahl, Kleinendian `lmgg`) – Pickle begänne mit `0x80`. Gelesen wird die Datei nur von `whisper-cli`
 * in der Sandbox ohne Netz (B-38b2). Die Regel „nie Pickle“ für Gewichte von Hugging Face (`HF_DATEI`) bleibt: Dieser
 * Weg nimmt nur `WHISPER_DATEI` und nur aus `WHISPER_HF`.
 *
 * Auch hier gilt die Grenze aus `model-registry.ts`: Die Prüfung sagt, ob die Bytes die angekündigten sind – nicht, ob
 * das Modell gut erkennt.
 */
import { type ModelFile, type ModelManifest } from "./model-registry.js";
import { HF_BASIS, type HfName, leseHfName } from "./modell-hf.js";

/** Das Repo bei Hugging Face, aus dem whisper.cpp seine Modelle lädt – kein anderes. */
export const WHISPER_HF: HfName = leseHfName("ggerganov/whisper.cpp")!;

/** Vorgabe nach SP-W4 C: mit GPU large-v3-turbo-q5_0 (547 MiB), ohne GPU base (142 MiB). */
export const WHISPER_VORGABE = { gpu: "large-v3-turbo-q5_0", cpu: "base" } as const;

/** Größer ist kein Modell von whisper.cpp (large-v3 rund 3,1 GB) – und mehr fasst die Sandbox nicht (`ulimit -d` 4 GiB). */
export const WHISPER_MAX_BYTES = 3_500_000_000;

/** Name wie bei whisper.cpp: `base`, `small.en`, `large-v3-turbo-q5_0`. */
const NAME = /^[a-z0-9](?:[a-z0-9._-]{0,46}[a-z0-9])?$/;
/** Die Datei eines Modells: `ggml-<name>.bin`. */
export const WHISPER_DATEI = /^ggml-[a-z0-9](?:[a-z0-9._-]{0,46}[a-z0-9])?\.bin$/;

/** Ein Name, wie whisper.cpp ihn schreibt (auch mit Vorsatz `whisper:`) – sonst null. */
export function leseWhisperName(s: string): string | null {
  const name = s.startsWith("whisper:") ? s.slice(8) : s;
  return NAME.test(name) && !name.includes("..") ? name : null;
}
/** Kennung im Manifest und im Stand des Knotens. */
export const whisperKennung = (name: string): string => `whisper:${name}`;
/** Die eine Datei des Modells. */
export const whisperDatei = (name: string): string => `ggml-${name}.bin`;

const UPSTREAM = /^hf:ggerganov\/whisper\.cpp@([0-9a-f]{40})$/;
const COMMIT = /^[0-9a-f]{40}$/;

/** Die Datei eines Modells an einem Commit von `WHISPER_HF` – nie an einem Zweig, nie aus einem anderen Repo. */
export function whisperDateiAdresse(commit: string, name: string, basis = HF_BASIS): string | null {
  if (!COMMIT.test(commit) || leseWhisperName(name) !== name) return null;
  return `${basis}/${WHISPER_HF.org}/${WHISPER_HF.repo}/resolve/${commit}/${whisperDatei(name)}`;
}

/** Quelle eines Whisper-Manifests – genau eine Datei `ggml-<name>.bin` aus `WHISPER_HF` an einem Commit; sonst null. */
export function whisperQuelle(m: ModelManifest): { name: string; commit: string; datei: ModelFile } | null {
  const t = UPSTREAM.exec(m.upstream ?? "");
  const name = m.modelId.startsWith("whisper:") ? leseWhisperName(m.modelId) : null;
  const datei = m.files[0];
  if (!t || !name || m.files.length !== 1 || !datei || datei.name !== whisperDatei(name) || datei.sizeBytes > WHISPER_MAX_BYTES) return null;
  return { name, commit: t[1]!, datei };
}

export type WhisperStand =
  | { ok: true; commit: string; datei: ModelFile; lizenz?: string }
  | { ok: false; fall: "whisper.form" | "whisper.fehlt" };

/**
 * Antwort von Hugging Face auf `hfStandAdresse(WHISPER_HF, rev)` lesen: Commit und die eine Datei `ggml-<name>.bin` mit
 * Größe und SHA-256 (LFS). Ohne Summe oder über `WHISPER_MAX_BYTES` gilt sie nicht – rechnen ließe sie sich erst nach dem
 * Laden, und eine Datei dieser Größe ist immer LFS.
 */
export function whisperStand(json: unknown, name: string): WhisperStand {
  const d = json as { sha?: unknown; siblings?: unknown; cardData?: { license?: unknown } } | null;
  if (!d || typeof d.sha !== "string" || !COMMIT.test(d.sha) || !Array.isArray(d.siblings)) return { ok: false, fall: "whisper.form" };
  const s = (d.siblings as Array<{ rfilename?: unknown; size?: unknown; lfs?: { sha256?: unknown; size?: unknown } } | null>)
    .filter((x) => x?.rfilename === whisperDatei(name));
  if (s.length === 0) return { ok: false, fall: "whisper.fehlt" };
  const x = s[0]!;
  const sha = x.lfs?.sha256;
  if (s.length > 1 || !Number.isSafeInteger(x.size) || (x.size as number) <= 0 || (x.size as number) > WHISPER_MAX_BYTES
    || typeof sha !== "string" || !/^[0-9a-f]{64}$/.test(sha) || x.lfs?.size !== x.size) return { ok: false, fall: "whisper.form" };
  const lizenz = typeof d.cardData?.license === "string" && /^[A-Za-z0-9.+-]{1,64}$/.test(d.cardData.license) ? d.cardData.license : undefined;
  return { ok: true, commit: d.sha, datei: { name: whisperDatei(name), sha256: sha, sizeBytes: x.size as number }, ...(lizenz ? { lizenz } : {}) };
}

/** Die Kennung am Anfang jeder Modelldatei von whisper.cpp (`0x67676d6c`, Kleinendian). */
export const GGML_KENNUNG = Uint8Array.of(0x6c, 0x6d, 0x67, 0x67);

/** Beginnt die Datei wie ein Modell von whisper.cpp? Die ersten vier Byte genügen. */
export const istGgml = (kopf: Uint8Array): boolean => kopf.length >= 4 && GGML_KENNUNG.every((b, i) => kopf[i] === b);
