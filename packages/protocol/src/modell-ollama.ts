/**
 * Modelle laden über Ollama, geprüft gegen ein Manifest (Schritt E9-3a,
 * Entwurf `docs/E9-ENTWURF.md`, V3 A).
 *
 * Ollama lädt Modelle als Schichten, jede mit ihrem SHA-256, und prüft die
 * Bytes selbst gegen die Summen, die die Registry nennt. Was dieser Baustein
 * dazutut: Die Summen müssen genau die eines Manifests (38057) sein, das ein
 * Schlüssel signiert hat, dem der Betreiber folgt – nicht bloß die, die die
 * Registry gerade ausliefert. Weicht etwas ab, bietet der Knoten das Modell
 * nicht an.
 *
 * Konvention für Ollama-Manifeste: `model` ist der Name bei Ollama
 * (`qwen2.5:0.5b`, mit Tag), `upstream` ist `ollama:<derselbe Name>`, jede
 * Datei heißt wie ihr Blob bei Ollama (`sha256-<hex>`) – Schichten und die
 * Konfiguration. `ollamaDateien()` baut diese Liste aus dem Manifest der
 * Registry.
 *
 * Auch hier gilt die Grenze aus `model-registry.ts`: Die Prüfung sagt, ob die
 * Bytes die angekündigten sind – nicht, ob das Modell gut, sicher oder legal ist.
 */
import { NostrEvent, getTag, verifyEvent } from "./event.js";
import { KIND_MODEL_MANIFEST, type ModelFile, type ModelManifest, parseModelManifest, verifyFile } from "./model-registry.js";

export interface OllamaName {
  /** Namensraum in der Registry, `library` für die offiziellen Modelle. */
  ns: string;
  name: string;
  tag: string;
  /** So nennt Ollama das Modell in `/api/tags` – und so steht es im Angebot. */
  voll: string;
}

/** Die einzige Registry, die der Knoten befragt – andere Hosts (`hf.co/…`) kennt er nicht. */
export const OLLAMA_REGISTRY = "https://registry.ollama.ai";

const TEIL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const TAG = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** `qwen2.5:0.5b`, `ns/name:tag`, ohne Tag `latest`; ein Host davor (drei Teile) gilt nicht. */
export function leseOllamaName(s: string): OllamaName | null {
  const [pfad = "", tag = "latest", ...rest] = s.split(":");
  const teile = pfad.split("/");
  if (rest.length > 0 || teile.length > 2 || !teile.every((x) => TEIL.test(x)) || !TAG.test(tag)) return null;
  const [ns, name] = teile.length === 2 ? [teile[0]!, teile[1]!] : ["library", teile[0]!];
  return { ns, name, tag, voll: `${ns === "library" ? "" : `${ns}/`}${name}:${tag}` };
}

/** Adresse des Manifests in der Registry – nur aus geprüften Teilen. */
export function registryAdresse(n: OllamaName): string {
  return `${OLLAMA_REGISTRY}/v2/${encodeURIComponent(n.ns)}/${encodeURIComponent(n.name)}/manifests/${encodeURIComponent(n.tag)}`;
}

/** Quelle eines Manifests: `upstream` = `ollama:<Name>`, gleich dem Modellnamen; sonst null. */
export function ollamaQuelle(m: ModelManifest): OllamaName | null {
  if (!m.upstream?.startsWith("ollama:")) return null;
  const quelle = leseOllamaName(m.upstream.slice("ollama:".length));
  return quelle && leseOllamaName(m.modelId)?.voll === quelle.voll ? quelle : null;
}

const DIGEST = /^sha256:([0-9a-f]{64})$/;
/** Mehr Schichten hat kein Modell; was mehr nennt, ist kein Manifest von Ollama. */
export const MAX_SCHICHTEN = 64;

/**
 * Dateien eines Ollama-Manifests (Registry, Docker-Format v2): alle Schichten
 * und die Konfiguration, je mit Summe und Größe – so lädt Ollama sie. Null,
 * wenn die Form nicht stimmt.
 */
export function ollamaDateien(json: unknown): ModelFile[] | null {
  const m = json as { schemaVersion?: unknown; layers?: unknown; config?: unknown } | null;
  if (!m || m.schemaVersion !== 2 || !Array.isArray(m.layers) || m.layers.length === 0 || m.layers.length > MAX_SCHICHTEN) return null;
  const alle = m.config === undefined ? m.layers : [...m.layers, m.config];
  const dateien = new Map<string, ModelFile>();
  for (const s of alle as Array<{ digest?: unknown; size?: unknown } | null>) {
    const hex = typeof s?.digest === "string" ? DIGEST.exec(s.digest)?.[1] : undefined;
    if (!hex || !Number.isSafeInteger(s!.size) || (s!.size as number) <= 0) return null;
    dateien.set(hex, { name: `sha256-${hex}`, sha256: hex, sizeBytes: s!.size as number });
  }
  return [...dateien.values()];
}

/** Eine Schicht, wie Ollama sie beim Laden meldet (`/api/pull`: `digest`, `total`). */
export interface Schicht { digest: string; groesse: number }

export type SchichtPruefung =
  | { ok: true; dateien: number; bytes: number }
  | { ok: false; fall: "schicht.form" | "schicht.fremd" | "schicht.groesse" | "schicht.fehlt"; werte: { anzahl: number } };

/**
 * Sind die Schichten genau die Dateien des Manifests? Jede über `verifyFile()`
 * mit passender Größe, keine fremde, keine fehlende.
 */
export function pruefeSchichten(m: ModelManifest, schichten: readonly Schicht[]): SchichtPruefung {
  const gesehen = new Set<string>();
  const fehler = { form: 0, fremd: 0, groesse: 0 };
  for (const s of schichten) {
    const hex = DIGEST.exec(s.digest)?.[1];
    if (!hex) { fehler.form++; continue; }
    const datei = m.files.find((f) => f.sha256 === hex);
    if (!verifyFile(m, `sha256-${hex}`, hex).ok || !datei) { fehler.fremd++; continue; }
    if (datei.sizeBytes !== s.groesse) { fehler.groesse++; continue; }
    gesehen.add(hex);
  }
  if (fehler.form) return { ok: false, fall: "schicht.form", werte: { anzahl: fehler.form } };
  if (fehler.fremd) return { ok: false, fall: "schicht.fremd", werte: { anzahl: fehler.fremd } };
  if (fehler.groesse) return { ok: false, fall: "schicht.groesse", werte: { anzahl: fehler.groesse } };
  const fehlt = m.files.filter((f) => !gesehen.has(f.sha256)).length;
  if (fehlt) return { ok: false, fall: "schicht.fehlt", werte: { anzahl: fehlt } };
  return { ok: true, dateien: m.files.length, bytes: m.totalBytes };
}

export type ManifestWahl =
  | { ok: true; manifest: ModelManifest; id: string; quelle: OllamaName }
  | { ok: false; fall: "manifest.keins" | "manifest.uneinig" | "manifest.keineQuelle"; werte?: { herausgeber: number } };

/**
 * Das Manifest, nach dem der Knoten ein Modell lädt: nur von vertrauten
 * Schlüsseln (eigener oder vom Betreiber genannte Kuratoren, F5 – kein
 * voreingestellter), je Schlüssel das neueste. Das eigene geht vor; sonst
 * müssen alle vertrauten dieselben Dateien nennen – bei Streit keine Wahl.
 */
export function vertrautesManifest(
  events: readonly NostrEvent[], kennung: string, vertraut: ReadonlySet<string>, eigener: string,
): ManifestWahl {
  const neueste = new Map<string, { ev: NostrEvent; m: ModelManifest }>();
  for (const ev of events) {
    if (ev.kind !== KIND_MODEL_MANIFEST || getTag(ev, "d") !== `model:${kennung}`) continue;
    if (ev.pubkey !== eigener && !vertraut.has(ev.pubkey)) continue;
    if (!verifyEvent(ev)) continue;
    let m: ModelManifest;
    try { m = parseModelManifest(ev); } catch { continue; }
    if (m.modelId !== kennung) continue;
    const bisher = neueste.get(ev.pubkey);
    if (!bisher || ev.created_at > bisher.ev.created_at) neueste.set(ev.pubkey, { ev, m });
  }
  const kandidaten = neueste.has(eigener) ? [neueste.get(eigener)!] : [...neueste.values()];
  if (kandidaten.length === 0) return { ok: false, fall: "manifest.keins" };
  const fingerabdruck = (m: ModelManifest) => m.files.map((f) => `${f.sha256}:${f.sizeBytes}`).sort().join(",");
  if (new Set(kandidaten.map((k) => fingerabdruck(k.m))).size > 1) return { ok: false, fall: "manifest.uneinig", werte: { herausgeber: kandidaten.length } };
  const { ev, m } = kandidaten.sort((a, b) => b.ev.created_at - a.ev.created_at)[0]!;
  const quelle = ollamaQuelle(m);
  return quelle ? { ok: true, manifest: m, id: ev.id, quelle } : { ok: false, fall: "manifest.keineQuelle" };
}
