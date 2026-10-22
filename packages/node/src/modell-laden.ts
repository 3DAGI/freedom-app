/**
 * Modelle laden im Knoten (Schritt E9-3a, Entwurf `docs/E9-ENTWURF.md`, V3 A).
 *
 * Ablauf je Modell: Manifest (38057) vom eigenen Schlüssel des Knotens oder –
 * seit E9-4 – genau das, das ein abonnierter Modellkatalog nennt
 * (`vertrautesManifest()` mit `freigaben()`, `modell-kataloge.ts`), passt es auf das Gerät (`fitsOnDevice()`), nennt
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
  type GeladeneDatei, type HfName, type HfStand, type Magnet, type ModelFile, type ModelManifest, type NostrEvent, type OllamaName,
  type Schicht, fitsOnDevice, hfQuelle, leseHfName, leseMagnet, leseOllamaName, ollamaDateien, pruefeDateien, pruefeSchichten,
  leseWhisperName, registryAdresse, vertrautesManifest, vorpruefeHf, whisperKennung,
} from "@freedomstack/protocol";
import type { Festgehalten } from "./modell-hf.js";
import { type WhisperHilfen, ladeWhisperModell } from "./modell-whisper.js";
import { leseBegrenzt } from "./url-guard.js";

export const modellDatei = (home = process.env.HOME ?? "."): string => join(home, ".freedom", "modelle.json");
export const wunschDatei = (home = process.env.HOME ?? "."): string => join(home, ".freedom", "modell-wunsch.json");
/** Wohin Gewichte von Hugging Face kommen (B-29c1b): `MODELL_ORDNER`, sonst `~/.freedom/modelle`. */
export const modellOrdner = (env: { MODELL_ORDNER?: string; HOME?: string } = process.env): string =>
  env.MODELL_ORDNER?.trim() || join(env.HOME ?? ".", ".freedom", "modelle");

/** Woher ein Modell kommt: Ollama (E9-3a), Hugging Face in einen Ordner (B-29c1b), Whisper für Text aus Sprache (B-38b3b2). */
export type Quelle = "ollama" | "hf" | "whisper";
const whisperName = (s: string): string | undefined => { const n = leseWhisperName(s); return n ? whisperKennung(n) : undefined; };
/** Ein Name, wie die Quelle ihn schreibt – sonst null. Für Whisper immer mit Vorsatz: `whisper:<name>`. */
export const quellName = (quelle: Quelle, s: string): string | null =>
  (quelle === "hf" ? leseHfName(s)?.voll : quelle === "whisper" ? whisperName(s) : leseOllamaName(s)?.voll) ?? null;
const gueltigerName = (n: unknown): n is string => typeof n === "string" && (["ollama", "hf", "whisper"] as const).some((q) => quellName(q, n) === n);

export interface GeprueftesModell {
  /** Name bei Ollama und im Angebot, z. B. `qwen2.5:0.5b`. */
  name: string;
  /** Kennung des Manifests (38057) und wer es signiert hat. */
  manifest: string;
  herausgeber: string;
  dateien: number;
  bytes: number;
  /** Fingerabdruck bei Ollama (`/api/tags`, `digest`) zur Zeit der Prüfung; bei Hugging Face leer. */
  ollama: string;
  geprueft: number;
  /** Seit B-29c1b: aus Hugging Face in diesen Ordner geladen, mit seinem Fingerabdruck (`ordnerAbdruck()`); seit B-38b3b2 für
   * Whisper die eine Datei mit ihrem Abdruck (`dateiAbdruck()`) – nie im Angebot für KI. */
  quelle?: "hf" | "whisper";
  ordner?: string;
  datei?: string;
  abdruck?: string;
  /** Seit B-29c2c: Kennung des Freedom-Torrents, unter dem der Knoten es teilt. */
  torrent?: string;
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
  /** Vorher festhalten, was die Quelle jetzt nennt (eigenes Manifest) – Registry bzw. Hugging Face. */
  ausRegistry?: true;
  /** Seit B-29c1b: Hugging Face statt Ollama; seit B-38b3b2 Whisper (Text aus Sprache). */
  quelle?: "hf" | "whisper";
  /** Seit B-29c2c: ein Magnet vom Betreiber (etwa von Pirate Face), geprüft mit `leseMagnet()`. */
  magnet?: string;
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
  const modell = (m: GeprueftesModell | null) => typeof m?.ollama === "string" && (m.quelle === "hf"
    ? quellName("hf", m.name) === m.name && typeof m.ordner === "string" && typeof m.abdruck === "string"
    : m.quelle === "whisper" ? quellName("whisper", m.name) === m.name && typeof m.datei === "string" && typeof m.abdruck === "string"
      : m.quelle === undefined && quellName("ollama", m.name) === m.name);
  return {
    modelle: Array.isArray(s.modelle) ? s.modelle.filter(modell) : [],
    laeuft: s.laeuft && gueltigerName(s.laeuft.name) ? s.laeuft : undefined,
    ergebnisse: Array.isArray(s.ergebnisse) ? s.ergebnisse.filter((e) => gueltigerName(e?.name) && typeof e.fall === "string") : [],
  };
}

export function leseWuensche(datei: string): Wunsch[] {
  const w = leseJson<unknown>(datei, []);
  if (!Array.isArray(w)) return [];
  const quelle = (x: Wunsch): Quelle => (x.quelle === "hf" || x.quelle === "whisper" ? x.quelle : "ollama");
  return w.filter((x) => typeof x?.name === "string" && quellName(quelle(x), x.name) === x.name && Number.isSafeInteger(x.seit))
    .map((x: Wunsch) => ({
      name: x.name, seit: x.seit, ...(x.ausRegistry === true ? { ausRegistry: true as const } : {}), ...(quelle(x) !== "ollama" ? { quelle: quelle(x) as "hf" | "whisper" } : {}),
      ...(x.quelle === "hf" && typeof x.magnet === "string" && leseMagnet(x.magnet) ? { magnet: leseMagnet(x.magnet)!.link } : {}),
    }));
}

/** Für `npm run modell`: den Namen vormerken (ersetzt einen älteren Wunsch desselben Namens). */
export function merkeWunsch(
  datei: string, eingabe: string, jetzt = Math.floor(Date.now() / 1000), ausRegistry = false, quelle: Quelle = "ollama", magnetLink?: string,
): string | null {
  const name = quellName(quelle, eingabe);
  if (!name) return null;
  // Ein Magnet nur für Hugging Face und nur geprüft – ein ungültiger heißt: nichts vormerken
  const magnet = magnetLink === undefined ? undefined : quelle === "hf" ? leseMagnet(magnetLink)?.link : undefined;
  if (magnetLink !== undefined && !magnet) return null;
  const wunsch: Wunsch = {
    name, seit: jetzt, ...(ausRegistry ? { ausRegistry: true as const } : {}), ...(quelle !== "ollama" ? { quelle } : {}), ...(magnet ? { magnet } : {}),
  };
  schreibeJson(datei, [...leseWuensche(datei).filter((w) => w.name !== name), wunsch]);
  return name;
}

/** Was noch zu tun ist: Wünsche ohne Ergebnis seit dem Wunsch. */
export function offeneWuensche(wuensche: readonly Wunsch[], stand: ModellStand): Wunsch[] {
  return wuensche.filter((w) => !stand.ergebnisse.some((e) => e.name === w.name && e.zeit >= w.seit));
}

export interface LaderHilfen {
  /** Manifeste zu `model:<name>` von den Relays des Knotens, dazu die mit diesen Ids (die Wahl trifft `vertrautesManifest()`). */
  manifeste(name: string, ids: readonly string[]): Promise<NostrEvent[]>;
  /** Dateien laut Registry; null, wenn sie nicht zu befragen war. */
  registry(q: OllamaName): Promise<ModelFile[] | null>;
  /** Eigenes Manifest aus diesen Dateien signieren und veröffentlichen (`--aus-registry`, `--aus-hf`). */
  festhalten(name: string, dateien: ModelFile[], upstream: string, lizenz?: string): Promise<NostrEvent>;
  /** Ollama lädt; zurück die Schichten, die es gemeldet hat. */
  pull(name: string, fortschritt: (geladen: number) => void): Promise<Schicht[]>;
  tags(): Promise<Array<{ name: string; digest: string }>>;
  speicherGb: number;
  /** Seit E9-4: Ids der Manifeste, die abonnierte Kataloge (`MODELL_KATALOGE`) für dieses Modell nennen. */
  freigaben(name: string): Promise<ReadonlySet<string>>;
  eigener: string;
  /** Seit B-29c1b, nur mit einem OpenAI-kompatiblen Antrieb: Hugging Face als Quelle. */
  hf?: HfHilfen;
  /** Seit B-38b3b2, mit jedem Antrieb: das Modell für Text aus Sprache (`modell-whisper.ts`). */
  whisper?: WhisperHilfen;
}

/** Was der Weg über Hugging Face braucht (`modell-hf.ts`, in `main.ts` verdrahtet). */
export interface HfHilfen {
  /** Wohin die Gewichte kommen (`modellOrdner()`). */
  basis: string;
  stand(n: HfName, rev: string): Promise<HfStand>;
  halteFest(n: HfName): Promise<Festgehalten>;
  ladeDatei(n: HfName, commit: string, ordner: string, f: ModelFile, fortschritt: (bytes: number) => void): Promise<unknown>;
  /** Was im Ordner liegt, und sein Fingerabdruck (`ordnerInhalt()`, `ordnerAbdruck()`). */
  inhalt(ordner: string): Array<{ name: string; groesse: number }>;
  abdruck(ordner: string): string | null;
  ordner(n: HfName): string;
  /** Welche Modelle der Antrieb gerade bedient (`/v1/models`); wirft, wenn er nicht antwortet. */
  antrieb(): Promise<string[]>;
  /** Seit B-29c2c, nur mit `TORRENT=1`: der Schwarm (aria2) vor Hugging Face. */
  schwarm?: SchwarmHilfen;
}

/** Was der Weg über den Schwarm braucht (`modell-schwarm.ts`, in `main.ts` verdrahtet). */
export interface SchwarmHilfen {
  /** Magnete zu genau dieser Fassung aus „ich halte vor“ (38058) – `magnetQuellen()`. */
  quellen(m: ModelManifest): Promise<Magnet[]>;
  /** Über einen Magnet holen, prüfen, in den Ordner legen und weiter teilen (`holeUndTeile()`). */
  hole(magnet: Magnet, m: ModelManifest, ordner: string, fortschritt: (bytes: number) => void): Promise<{ ok: boolean; fall?: string }>;
  /** Den Freedom-Torrent teilen und „ich halte vor“ veröffentlichen; liefert seine Kennung. */
  teile(m: ModelManifest, ordner: string): Promise<string>;
}

export type LadeErgebnis = { ok: true; modell: GeprueftesModell } | { ok: false; fall: string; werte?: Record<string, number | string> };
const fehlerName = (e: unknown): string => (e instanceof Error && e.name) || "Fehler";

export async function ladeModell(
  name: string, h: LaderHilfen, melde: (schritt: Schritt, geladen?: number, gesamt?: number) => void,
  jetzt = () => Math.floor(Date.now() / 1000), ausRegistry = false,
): Promise<LadeErgebnis> {
  melde("manifest");
  let events: NostrEvent[];
  let frei: ReadonlySet<string> = new Set();
  let reg: ModelFile[] | null | undefined;
  if (ausRegistry) {
    // Festhalten, was die Registry jetzt nennt – ohne sie gibt es nichts festzuhalten
    const q = leseOllamaName(name);
    reg = q ? await h.registry(q).catch(() => null) : null;
    if (!reg) return { ok: false, fall: "registry.nichtErreichbar" };
    try {
      events = [await h.festhalten(name, reg, `ollama:${name}`)];
    } catch (e) {
      return { ok: false, fall: "manifest.nichtVeroeffentlicht", werte: { fehler: fehlerName(e) } };
    }
  } else {
    frei = await h.freigaben(name).catch(() => new Set<string>());
    events = await h.manifeste(name, [...frei]);
  }
  const wahl = vertrautesManifest(events, name, frei, h.eigener);
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

/**
 * Laden von Hugging Face (B-29c1b) für einen OpenAI-kompatiblen Antrieb: dasselbe Manifest-Vertrauen
 * wie bei Ollama (`vertrautesManifest()` mit `hfQuelle()`), Vorprüfung am Commit des Manifests, jede
 * Datei mit SHA-256 beim Laden (`ladeHfDatei()`), dann der ganze Ordner gegen das Manifest – keine
 * fremde Datei darin (der Antrieb läse sonst mehr als geprüft). Gemerkt mit dem Fingerabdruck des Ordners.
 */
export async function ladeHfModell(
  name: string, h: LaderHilfen, melde: (schritt: Schritt, geladen?: number, gesamt?: number) => void,
  jetzt = () => Math.floor(Date.now() / 1000), ausHf = false, wunschMagnet?: string,
): Promise<LadeErgebnis> {
  const hf = h.hf;
  const n = leseHfName(name);
  if (!hf || !n) return { ok: false, fall: "hf.form" };
  melde("manifest");
  let events: NostrEvent[];
  let frei: ReadonlySet<string> = new Set();
  if (ausHf) {
    let f: Festgehalten;
    try { f = await hf.halteFest(n); } catch (e) { return { ok: false, fall: "hf.nichtErreichbar", werte: { fehler: fehlerName(e) } }; }
    if (!f.ok) return { ok: false, fall: f.fall };
    try {
      events = [await h.festhalten(n.voll, f.dateien, `hf:${n.voll}@${f.commit}`, f.lizenz)];
    } catch (e) {
      return { ok: false, fall: "manifest.nichtVeroeffentlicht", werte: { fehler: fehlerName(e) } };
    }
  } else {
    frei = await h.freigaben(n.voll).catch(() => new Set<string>());
    events = await h.manifeste(n.voll, [...frei]);
  }
  const wahl = vertrautesManifest(events, n.voll, frei, h.eigener, hfQuelle);
  if (!wahl.ok) return { ok: false, fall: wahl.fall, werte: wahl.werte };
  const { manifest: m, quelle } = wahl;
  const passt = fitsOnDevice(m, h.speicherGb);
  if (!passt.fits) return { ok: false, fall: "passt.nicht", werte: { brauchtGb: Math.ceil(passt.neededGb), hatGb: Math.floor(h.speicherGb) } };
  // Vorprüfung am Commit des Manifests: nennt Hugging Face dort andere Dateien, wird nichts geladen.
  // Ist es nicht zu befragen, entscheidet die Prüfung beim Laden allein.
  melde("vorpruefung");
  const stand = await hf.stand(quelle.name, quelle.commit).catch(() => null);
  if (stand?.ok) {
    const vor = vorpruefeHf(m, stand);
    if (!vor.ok) return { ok: false, fall: "hf.anders", werte: vor.werte };
  }
  const ordner = hf.ordner(quelle.name);
  const geladen: GeladeneDatei[] = [];
  let bisher = 0;
  melde("laden", 0, m.totalBytes);
  // B-29c2c: zuerst der Schwarm – Freedom-Knoten (38058), dann der Magnet aus dem Wunsch (etwa Pirate
  // Face); `holeUndTeile()` legt nur geprüfte Dateien in den Ordner. Scheitert alles, Hugging Face direkt.
  const vomBetreiber = wunschMagnet ? leseMagnet(wunschMagnet) : null;
  const magnete = hf.schwarm ? [...await hf.schwarm.quellen(m).catch(() => []), ...(vomBetreiber ? [vomBetreiber] : [])] : [];
  let ausSchwarm = false;
  for (const mg of magnete.filter((x, i, a) => a.findIndex((y) => y.infohash === x.infohash) === i)) {
    const r = await hf.schwarm!.hole(mg, m, ordner, (b) => melde("laden", b, m.totalBytes)).catch(() => ({ ok: false }));
    if (r.ok) { ausSchwarm = true; break; }
  }
  if (ausSchwarm) geladen.push(...m.files.map((f) => ({ name: f.name, sha256: f.sha256, groesse: f.sizeBytes })));
  else for (const f of m.files) {
    try {
      await hf.ladeDatei(quelle.name, quelle.commit, ordner, f, (b) => melde("laden", bisher + b, m.totalBytes));
    } catch (e) {
      return { ok: false, fall: "hf.laden", werte: { fehler: fehlerName(e) } };
    }
    // `ladeHfDatei()` legt eine Datei nur mit genau dieser Summe und Größe unter ihren Namen
    geladen.push({ name: f.name, sha256: f.sha256, groesse: f.sizeBytes });
    bisher += f.sizeBytes;
  }
  melde("pruefen");
  // Der ganze Ordner: was nicht im Manifest steht, läse der Antrieb mit – dann nicht im Angebot
  const fremd = hf.inhalt(ordner).filter((d) => !m.files.some((f) => f.name === d.name)).map((d) => ({ name: d.name, sha256: "", groesse: d.groesse }));
  const p = pruefeDateien(m, [...geladen, ...fremd]);
  if (!p.ok) return { ok: false, fall: p.fall, werte: p.werte };
  // Teilen und bekanntgeben (B-29c2c) – gelingt es nicht, ist das Modell trotzdem geprüft
  const torrent = hf.schwarm ? await hf.schwarm.teile(m, ordner).catch(() => undefined) : undefined;
  const abdruck = hf.abdruck(ordner);
  if (!abdruck) return { ok: false, fall: "datei.fehlt", werte: { anzahl: m.files.length } };
  return {
    ok: true,
    modell: {
      name: n.voll, manifest: wahl.id, herausgeber: m.publisherPubkey, dateien: p.dateien, bytes: p.bytes, ollama: "", geprueft: jetzt(), quelle: "hf", ordner, abdruck,
      ...(torrent ? { torrent } : {}),
    },
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

  /**
   * Geprüft und bei Ollama unter demselben Fingerabdruck – sonst nicht im Angebot. Von Hugging Face
   * (B-29c1b): nur mit diesem Weg, der Antrieb nennt das Modell, und der Ordner ist unverändert.
   */
  async imAngebot(): Promise<string[]> {
    // Whisper gehört zu Text aus Sprache, nie ins Angebot für KI (B-38b3b2)
    const modelle = leseStand(this.dateien.stand).modelle.filter((m) => m.quelle !== "whisper");
    const tags = modelle.some((m) => m.quelle !== "hf") ? await this.h.tags().catch(() => null) : null;
    const hf = this.h.hf;
    const namen = hf && modelle.some((m) => m.quelle === "hf") ? await hf.antrieb().catch(() => null) : null;
    this.angebot = modelle.filter((m) => (m.quelle === "hf"
      ? !!namen?.includes(m.name) && !!m.ordner && hf!.abdruck(m.ordner) === m.abdruck
      : !!tags?.some((t) => t.name === m.name && t.digest === m.ollama))).map((m) => m.name);
    return this.angebot;
  }

  /** Welche Quelle dieser Knoten laden kann: Hugging Face mit OpenAI-kompatiblem Antrieb, sonst Ollama. */
  private get quelle(): Quelle { return this.h.hf ? "hf" : "ollama"; }

  /** Einen offenen Wunsch abarbeiten. true, wenn ein Modell dazukam (dann das Angebot neu veröffentlichen). */
  async arbeite(): Promise<boolean> {
    if (this.beschaeftigt) return false;
    // Nur Wünsche, die dieser Antrieb laden kann – die übrigen nennt `pruefeModelle()`
    // Whisper lädt jeder Knoten mit `whisper` – gleich welcher Antrieb
    const [w] = offeneWuensche(leseWuensche(this.dateien.wunsch), leseStand(this.dateien.stand))
      .filter((x) => (x.quelle === "whisper" ? !!this.h.whisper : (x.quelle ?? "ollama") === this.quelle));
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
      const r = await (w.quelle === "hf"
        ? ladeHfModell(w.name, this.h, melde, this.jetzt, w.ausRegistry === true, w.magnet)
        : w.quelle === "whisper" ? ladeWhisperModell(w.name, this.h, melde, this.jetzt, w.ausRegistry === true)
          : ladeModell(w.name, this.h, melde, this.jetzt, w.ausRegistry === true)).catch((e): LadeErgebnis => ({ ok: false, fall: "fehler", werte: { fehler: fehlerName(e) } }));
      const s = leseStand(this.dateien.stand);
      const ergebnis: Ergebnis = r.ok ? { name: w.name, fall: "ok", zeit: this.jetzt() } : { name: w.name, fall: r.fall, werte: r.werte, zeit: this.jetzt() };
      schreibeJson(this.dateien.stand, {
        modelle: r.ok ? [...s.modelle.filter((m) => m.name !== w.name), r.modell] : s.modelle,
        ergebnisse: [...s.ergebnisse.filter((e) => e.name !== w.name), ergebnis],
      });
      this.log(`[modell] ${w.name}: ${r.ok ? (w.quelle === "whisper" ? "geprüft, für Text aus Sprache" : "geprüft, im Angebot") : `nicht angeboten (${r.fall})`}`);
      return r.ok;
    } finally {
      this.beschaeftigt = false;
    }
  }
}

/**
 * Nur anbieten, was Ollama hat (B-41, Lauf 2 des lokalen Agenten): ein Modell
 * aus `PROVIDER_MODELS` nur, wenn Ollama es unter genau diesem Namen kennt (ohne
 * Tag wie Ollama selbst: `:latest`) – sonst scheitert jeder Auftrag dafür. Bliebe
 * nichts übrig, bleibt die Liste, wie sie war: Der Knoten geht nie still vom Netz,
 * das Log nennt, was fehlt.
 */
export function nurBeiOllama(angeboten: readonly string[], ollama: readonly string[]): { modelle: string[]; fehlen: string[] } {
  const da = new Set(ollama);
  const hat = (m: string) => da.has(m) || (!m.includes(":") && da.has(`${m}:latest`));
  const modelle = angeboten.filter(hat);
  return { modelle: modelle.length > 0 ? modelle : [...angeboten], fehlen: angeboten.filter((m) => !hat(m)) };
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
