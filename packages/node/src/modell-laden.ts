/**
 * Modelle laden im Knoten (Schritt E9-3a, Entwurf `docs/E9-ENTWURF.md`, V3 A).
 *
 * Ablauf je Modell: Manifest (38057) nur vom eigenen Schlüssel des Knotens
 * (`vertrautesManifest()`; Kuratoren über Kataloge kommen mit E9-4 dazu –
 * Freigabe vom 08.10.), passt es auf das Gerät (`fitsOnDevice()`), nennt
 * die Registry dieselben Dateien (Vorprüfung, spart einen falschen Download),
 * dann lädt Ollama – und erst wenn die Schichten, die Ollama geladen und
 * geprüft hat, genau die des Manifests sind (`pruefeSchichten()`), steht das
 * Modell im Angebot. Gemerkt wird es mit dem Fingerabdruck, den Ollama dafür
 * nennt (`/api/tags`): Lädt jemand unter demselben Namen etwas anderes, fällt
 * es aus dem Angebot.
 *
 * Gewünscht wird über `npm run modell -- <name>` (`modell.ts`); das schreibt
 * nur `~/.freedom/modell-wunsch.json`. Mit `--aus-registry` hält der Knoten
 * vorher fest, was die Registry jetzt nennt: Er signiert daraus ein eigenes
 * Manifest und veröffentlicht es – spätere Ladevorgänge prüfen dagegen. Geladen wird im laufenden Knoten über
 * seine Relays – Relay-Verbindungen entstehen nur in `main.ts` (Tor, 8.2c).
 * Den Stand schreibt nur der Knoten (`~/.freedom/modelle.json`).
 *
 * Nach außen und ins Log nur Kennungen (`fall`), Zahlen, Fehlernamen und
 * Modellnamen – nie Text aus Ollama oder der Registry.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type ModelFile, type NostrEvent, type OllamaName, type Schicht,
  fitsOnDevice, leseOllamaName, ollamaDateien, pruefeSchichten, registryAdresse, vertrautesManifest,
} from "@freedomstack/protocol";
import { leseBegrenzt } from "./url-guard.js";

export const modellDatei = (home = process.env.HOME ?? "."): string => join(home, ".freedom", "modelle.json");
export const wunschDatei = (home = process.env.HOME ?? "."): string => join(home, ".freedom", "modell-wunsch.json");

export interface GeprueftesModell {
  /** Name bei Ollama und im Angebot, z. B. `qwen2.5:0.5b`. */
  name: string;
  /** Kennung des Manifests (38057) und wer es signiert hat. */
  manifest: string;
  herausgeber: string;
  dateien: number;
  bytes: number;
  /** Fingerabdruck bei Ollama (`/api/tags`, `digest`) zur Zeit der Prüfung. */
  ollama: string;
  geprueft: number;
}
export type Schritt = "manifest" | "vorpruefung" | "laden" | "pruefen";
export interface Ergebnis { name: string; fall: string; werte?: Record<string, number | string>; zeit: number }
export interface ModellStand {
  modelle: GeprueftesModell[];
  laeuft?: { name: string; schritt: Schritt; geladen?: number; gesamt?: number; seit: number };
  /** Je Name das letzte Ergebnis. */
  ergebnisse: Ergebnis[];
}
export interface Wunsch {
  name: string;
  seit: number;
  /** Vorher festhalten, was die Registry jetzt nennt (eigenes Manifest). */
  ausRegistry?: true;
}

function leseJson<T>(datei: string, leer: T): T {
  if (!existsSync(datei)) return leer;
  try { return JSON.parse(readFileSync(datei, "utf8")) as T; } catch { return leer; }
}
function schreibeJson(datei: string, wert: unknown): void {
  mkdirSync(dirname(datei), { recursive: true, mode: 0o700 });
  writeFileSync(`${datei}.tmp`, JSON.stringify(wert), { mode: 0o600 });
  renameSync(`${datei}.tmp`, datei);
}

/** Der Stand – streng gelesen: Einträge ohne gültigen Namen fallen weg. */
export function leseStand(datei: string): ModellStand {
  const s = leseJson<Partial<ModellStand>>(datei, {});
  const gueltig = (n: unknown) => typeof n === "string" && leseOllamaName(n)?.voll === n;
  return {
    modelle: Array.isArray(s.modelle) ? s.modelle.filter((m) => gueltig(m?.name) && typeof m.ollama === "string") : [],
    laeuft: s.laeuft && gueltig(s.laeuft.name) ? s.laeuft : undefined,
    ergebnisse: Array.isArray(s.ergebnisse) ? s.ergebnisse.filter((e) => gueltig(e?.name) && typeof e.fall === "string") : [],
  };
}

export function leseWuensche(datei: string): Wunsch[] {
  const w = leseJson<unknown>(datei, []);
  if (!Array.isArray(w)) return [];
  return w.filter((x) => typeof x?.name === "string" && leseOllamaName(x.name)?.voll === x.name && Number.isSafeInteger(x.seit))
    .map((x: Wunsch) => (x.ausRegistry === true ? { name: x.name, seit: x.seit, ausRegistry: true } : { name: x.name, seit: x.seit }));
}

/** Für `npm run modell`: den Namen vormerken (ersetzt einen älteren Wunsch desselben Namens). */
export function merkeWunsch(datei: string, eingabe: string, jetzt = Math.floor(Date.now() / 1000), ausRegistry = false): string | null {
  const name = leseOllamaName(eingabe)?.voll;
  if (!name) return null;
  const wunsch: Wunsch = ausRegistry ? { name, seit: jetzt, ausRegistry: true } : { name, seit: jetzt };
  schreibeJson(datei, [...leseWuensche(datei).filter((w) => w.name !== name), wunsch]);
  return name;
}

/** Was noch zu tun ist: Wünsche ohne Ergebnis seit dem Wunsch. */
export function offeneWuensche(wuensche: readonly Wunsch[], stand: ModellStand): Wunsch[] {
  return wuensche.filter((w) => !stand.ergebnisse.some((e) => e.name === w.name && e.zeit >= w.seit));
}

export interface LaderHilfen {
  /** Manifeste zu `model:<name>` von den Relays des Knotens (die Wahl trifft `vertrautesManifest()`). */
  manifeste(name: string): Promise<NostrEvent[]>;
  /** Dateien laut Registry; null, wenn sie nicht zu befragen war. */
  registry(q: OllamaName): Promise<ModelFile[] | null>;
  /** Eigenes Manifest aus diesen Dateien signieren und veröffentlichen (`--aus-registry`). */
  festhalten(name: string, dateien: ModelFile[]): Promise<NostrEvent>;
  /** Ollama lädt; zurück die Schichten, die es gemeldet hat. */
  pull(name: string, fortschritt: (geladen: number) => void): Promise<Schicht[]>;
  tags(): Promise<Array<{ name: string; digest: string }>>;
  speicherGb: number;
  /** Kuratoren – bis E9-4 (Kataloge) leer: es zählt nur der eigene Schlüssel. */
  vertraut: ReadonlySet<string>;
  eigener: string;
}

export type LadeErgebnis = { ok: true; modell: GeprueftesModell } | { ok: false; fall: string; werte?: Record<string, number | string> };
const fehlerName = (e: unknown): string => (e instanceof Error && e.name) || "Fehler";

export async function ladeModell(
  name: string, h: LaderHilfen, melde: (schritt: Schritt, geladen?: number, gesamt?: number) => void,
  jetzt = () => Math.floor(Date.now() / 1000), ausRegistry = false,
): Promise<LadeErgebnis> {
  melde("manifest");
  let events: NostrEvent[];
  let reg: ModelFile[] | null | undefined;
  if (ausRegistry) {
    // Festhalten, was die Registry jetzt nennt – ohne sie gibt es nichts festzuhalten
    const q = leseOllamaName(name);
    reg = q ? await h.registry(q).catch(() => null) : null;
    if (!reg) return { ok: false, fall: "registry.nichtErreichbar" };
    try {
      events = [await h.festhalten(name, reg)];
    } catch (e) {
      return { ok: false, fall: "manifest.nichtVeroeffentlicht", werte: { fehler: fehlerName(e) } };
    }
  } else {
    events = await h.manifeste(name);
  }
  const wahl = vertrautesManifest(events, name, h.vertraut, h.eigener);
  if (!wahl.ok) return { ok: false, fall: wahl.fall, werte: wahl.werte };
  const { manifest: m, quelle } = wahl;
  const passt = fitsOnDevice(m, h.speicherGb);
  if (!passt.fits) return { ok: false, fall: "passt.nicht", werte: { brauchtGb: Math.ceil(passt.neededGb), hatGb: Math.floor(h.speicherGb) } };
  // Vorprüfung: nennt die Registry andere Dateien, wird nichts geladen. Ist sie nicht
  // zu befragen, entscheidet die Prüfung nach dem Laden allein.
  melde("vorpruefung");
  if (reg === undefined) reg = await h.registry(quelle).catch(() => null);
  if (reg) {
    const vor = pruefeSchichten(m, reg.map((f) => ({ digest: `sha256:${f.sha256}`, groesse: f.sizeBytes })));
    if (!vor.ok) return { ok: false, fall: "registry.anders", werte: vor.werte };
  }
  melde("laden", 0, m.totalBytes);
  let schichten: Schicht[];
  try {
    schichten = await h.pull(quelle.voll, (geladen) => melde("laden", geladen, m.totalBytes));
  } catch (e) {
    return { ok: false, fall: "ollama.laden", werte: { fehler: fehlerName(e) } };
  }
  melde("pruefen");
  const p = pruefeSchichten(m, schichten);
  if (!p.ok) return { ok: false, fall: p.fall, werte: p.werte };
  const bei = (await h.tags().catch(() => [])).find((t) => t.name === quelle.voll);
  if (!bei) return { ok: false, fall: "ollama.fehlt" };
  return {
    ok: true,
    modell: { name: quelle.voll, manifest: wahl.id, herausgeber: m.publisherPubkey, dateien: p.dateien, bytes: p.bytes, ollama: bei.digest, geprueft: jetzt() },
  };
}

/** Wünsche abarbeiten, Stand führen, Angebot bestimmen – verdrahtet in `main.ts`. */
export class ModellDienst {
  /** Geprüfte Modelle, die Ollama noch unverändert hat – zuletzt bestimmt über `imAngebot()`. */
  angebot: string[] = [];
  private beschaeftigt = false;

  constructor(
    private h: LaderHilfen,
    private dateien = { stand: modellDatei(), wunsch: wunschDatei() },
    private log: (zeile: string) => void = console.log,
    private jetzt = () => Math.floor(Date.now() / 1000),
  ) {}

  /** Geprüft und bei Ollama unter demselben Fingerabdruck – sonst nicht im Angebot. */
  async imAngebot(): Promise<string[]> {
    const tags = await this.h.tags().catch(() => null);
    this.angebot = tags ? leseStand(this.dateien.stand).modelle.filter((m) => tags.some((t) => t.name === m.name && t.digest === m.ollama)).map((m) => m.name) : [];
    return this.angebot;
  }

  /** Einen offenen Wunsch abarbeiten. true, wenn ein Modell dazukam (dann das Angebot neu veröffentlichen). */
  async arbeite(): Promise<boolean> {
    if (this.beschaeftigt) return false;
    const [w] = offeneWuensche(leseWuensche(this.dateien.wunsch), leseStand(this.dateien.stand));
    if (!w) return false;
    this.beschaeftigt = true;
    let zuletzt = 0;
    const melde = (schritt: Schritt, geladen?: number, gesamt?: number) => {
      // Fortschritt höchstens alle fünf Sekunden in die Datei
      if (schritt === "laden" && geladen && this.jetzt() - zuletzt < 5) return;
      zuletzt = this.jetzt();
      const s = leseStand(this.dateien.stand);
      schreibeJson(this.dateien.stand, { ...s, laeuft: { name: w.name, schritt, geladen, gesamt, seit: w.seit } });
    };
    try {
      this.log(`[modell] ${w.name}: suche Manifest, prüfe, lade`);
      const r = await ladeModell(w.name, this.h, melde, this.jetzt, w.ausRegistry === true).catch((e): LadeErgebnis => ({ ok: false, fall: "fehler", werte: { fehler: fehlerName(e) } }));
      const s = leseStand(this.dateien.stand);
      const ergebnis: Ergebnis = r.ok ? { name: w.name, fall: "ok", zeit: this.jetzt() } : { name: w.name, fall: r.fall, werte: r.werte, zeit: this.jetzt() };
      schreibeJson(this.dateien.stand, {
        modelle: r.ok ? [...s.modelle.filter((m) => m.name !== w.name), r.modell] : s.modelle,
        ergebnisse: [...s.ergebnisse.filter((e) => e.name !== w.name), ergebnis],
      });
      this.log(`[modell] ${w.name}: ${r.ok ? "geprüft, im Angebot" : `nicht angeboten (${r.fall})`}`);
      return r.ok;
    } finally {
      this.beschaeftigt = false;
    }
  }
}

/** `/api/tags` von Ollama: Name und Fingerabdruck je Modell. */
export async function ollamaTags(basis: string): Promise<Array<{ name: string; digest: string }>> {
  const r = await fetch(`${basis}/api/tags`, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = (await r.json()) as { models?: Array<{ name?: unknown; digest?: unknown }> };
  return (d.models ?? []).filter((m) => typeof m.name === "string" && typeof m.digest === "string").map((m) => ({ name: m.name as string, digest: m.digest as string }));
}

/**
 * `/api/pull` von Ollama, Zeile für Zeile (NDJSON): je Schicht `digest` und
 * `total`, am Ende `success`. Ollama prüft jede neu geladene Schicht selbst
 * gegen ihre Summe; ein Fehler (`error`) bricht ab – sein Text bleibt draußen.
 */
export async function ollamaPull(basis: string, name: string, fortschritt: (geladen: number) => void): Promise<Schicht[]> {
  const r = await fetch(`${basis}/api/pull`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: name, stream: true }) });
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
  const schichten = new Map<string, { total: number; completed: number }>();
  let fertig = false;
  let rest = "";
  const leser = r.body.getReader();
  const dekoder = new TextDecoder();
  const zeile = (z: string) => {
    if (!z.trim()) return;
    const d = JSON.parse(z) as { status?: unknown; digest?: unknown; total?: unknown; completed?: unknown; error?: unknown };
    if (d.error !== undefined) throw Object.assign(new Error("Ollama meldet einen Fehler"), { name: "OllamaFehler" });
    if (typeof d.digest === "string" && Number.isSafeInteger(d.total)) {
      schichten.set(d.digest, { total: d.total as number, completed: Number.isSafeInteger(d.completed) ? (d.completed as number) : 0 });
      fortschritt([...schichten.values()].reduce((s, x) => s + x.completed, 0));
    }
    if (d.status === "success") fertig = true;
  };
  for (;;) {
    const { done, value } = await leser.read();
    if (done) break;
    rest += dekoder.decode(value, { stream: true });
    const zeilen = rest.split("\n");
    rest = zeilen.pop() ?? "";
    if (rest.length > 65_536) throw Object.assign(new Error("Zeile zu lang"), { name: "OllamaFehler" });
    for (const z of zeilen) zeile(z);
  }
  zeile(rest);
  if (!fertig) throw Object.assign(new Error("ohne Erfolg beendet"), { name: "OllamaAbbruch" });
  return [...schichten].map(([digest, s]) => ({ digest, groesse: s.total }));
}

/** Dateien laut Registry (Docker-Format v2); null bei Fehler, Weiterleitung oder fremder Form. */
export async function registryDateien(q: OllamaName): Promise<ModelFile[] | null> {
  const r = await fetch(registryAdresse(q), {
    headers: { accept: "application/vnd.docker.distribution.manifest.v2+json" },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) return null;
  const { text, abgeschnitten } = await leseBegrenzt(r, 256 * 1024);
  if (abgeschnitten) return null;
  try { return ollamaDateien(JSON.parse(text)); } catch { return null; }
}
