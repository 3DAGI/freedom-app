/**
 * Modelle im Schwarm: über einen Magnet laden und geprüft teilen (Schritt
 * B-29c2b, MENSCH 12.10.2026 – `docs/E9-ENTWURF.md`). aria2c bewegt die Bytes,
 * geprüft wird hier, gegen das Manifest.
 *
 * - `holeUndTeile()`: Metadaten zum Magnet holen (pausiert), nur die Dateien des
 *   Manifests wählen (Name in der obersten oder zweiten Ebene, Größe gleich), was
 *   im Modellordner schon geprüft liegt, als Verweis vorlegen (aria2 prüft die
 *   Stücke und lädt nur den Rest), laden, jede Datei mit SHA-256 prüfen und in den
 *   Modellordner verlinken. Danach teilt aria2 weiter – auch den Schwarm von
 *   Pirate Face, wenn der Magnet von dort kommt.
 * - `teileModell()`: den Freedom-Torrent (`baueModellTorrent()`) aus dem
 *   geprüften Ordner teilen – jeder Knoten mit demselben Modell baut denselben.
 *
 * Abgelegt wird unter `<basis>/.schwarm/<infohash>/`, in den Modellordner kommen
 * nur Verweise (Hardlinks, auf einem anderen Dateisystem Kopien) auf geprüfte
 * Dateien. Fälle nur als Kennung: `torrent.dateiFehlt`, `torrent.anders`,
 * `torrent.still`, `torrent.fehler`, `datei.summe`.
 */
import { copyFileSync, existsSync, linkSync, mkdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import type { Magnet, ModelFile, ModelManifest } from "@freedomstack/protocol";
import type { Aria2, Aria2Datei } from "./aria2.js";
import { summeDerDatei } from "./modell-hf.js";
import { baueModellTorrent } from "./torrent.js";

export type SchwarmErgebnis =
  | { ok: true; gid: string; infohash: string }
  | { ok: false; fall: "torrent.dateiFehlt" | "torrent.anders" | "torrent.still" | "torrent.fehler" | "datei.summe"; werte?: Record<string, number | string> };

export interface SchwarmOrte {
  /** Modellordner (`hfOrdner()`), aus dem der Antrieb liest. */
  ordner: string;
  /** Wurzel der Ablage im Schwarm: `<MODELL_ORDNER>/.schwarm`. */
  schwarm: string;
}
export interface SchwarmTakt {
  /** Ohne neue Bytes so lange, dann Abbruch. */
  stillMs?: number;
  /** Abstand der Fragen an aria2. */
  taktMs?: number;
  fortschritt?: (bytes: number, gesamt: number) => void;
}

const warte = (ms: number) => new Promise((r) => setTimeout(r, ms));
const zahl = (s: string | undefined) => Number(s ?? 0) || 0;

/** Eine Datei an einen Ort verweisen – Hardlink, auf einem anderen Dateisystem eine Kopie. */
function verweise(von: string, nach: string): void {
  mkdirSync(dirname(nach), { recursive: true, mode: 0o755 });
  if (existsSync(nach)) unlinkSync(nach);
  try { linkSync(von, nach); } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
    copyFileSync(von, nach);
  }
}

/** Liegt die Datei schon geprüft da? Größe und SHA-256. */
async function geprueft(pfad: string, f: ModelFile): Promise<boolean> {
  return existsSync(pfad) && statSync(pfad).size === f.sizeBytes && (await summeDerDatei(pfad)) === f.sha256;
}

/** Je Datei des Manifests der Eintrag im Torrent: der Name in der obersten oder zweiten Ebene, sonst nichts. */
export function waehleDateien(m: ModelManifest, dateien: readonly Aria2Datei[], dir: string): { treffer: Map<string, Aria2Datei>; fehlt: number; anders: number } {
  const treffer = new Map<string, Aria2Datei>();
  let anders = 0;
  for (const f of m.files) {
    const d = dateien.find((x) => {
      const teile = relative(dir, x.path).split(sep);
      return teile.length <= 2 && teile.at(-1) === f.name && !teile.includes("..");
    });
    if (!d) continue;
    if (zahl(d.length) !== f.sizeBytes) { anders++; continue; }
    treffer.set(f.name, d);
  }
  return { treffer, fehlt: m.files.length - treffer.size - anders, anders };
}

async function warteAuf<T>(frage: () => Promise<T | null>, stillMs: number, taktMs: number, fortschritt?: () => Promise<number>): Promise<T | "still"> {
  let zuletzt = -1;
  let seit = Date.now();
  for (;;) {
    const r = await frage();
    if (r !== null) return r;
    const jetzt = fortschritt ? await fortschritt() : 0;
    if (jetzt !== zuletzt) { zuletzt = jetzt; seit = Date.now(); }
    if (Date.now() - seit > stillMs) return "still";
    await warte(taktMs);
  }
}

/**
 * Über einen Magnet holen, was fehlt, und teilen. Nur die Dateien des Manifests,
 * jede mit SHA-256 geprüft, bevor sie in den Modellordner kommt.
 */
export async function holeUndTeile(aria2: Aria2, magnet: Magnet, m: ModelManifest, orte: SchwarmOrte, t: SchwarmTakt = {}): Promise<SchwarmErgebnis> {
  const stillMs = t.stillMs ?? 10 * 60_000;
  const taktMs = t.taktMs ?? 2_000;
  const dir = join(orte.schwarm, magnet.infohash);
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  // 1. Metadaten – der Download danach bleibt pausiert, bis die Auswahl steht
  const meta = await aria2.addUri([magnet.link], { dir, "pause-metadata": "true", "bt-tracker": magnet.tracker.join(",") });
  const gid = await warteAuf(async () => {
    const s = await aria2.status(meta);
    if (s.status === "error") return { fehler: s.errorCode ?? "?" };
    const folgt = s.followedBy?.[0];
    return s.status === "complete" && folgt ? { gid: folgt } : null;
  }, stillMs, taktMs);
  if (gid === "still") { await aria2.entferne(meta).catch(() => {}); return { ok: false, fall: "torrent.still" }; }
  if ("fehler" in gid) return { ok: false, fall: "torrent.fehler", werte: { fehler: gid.fehler ?? "?" } };
  const g = gid.gid;
  const raus = async (e: SchwarmErgebnis): Promise<SchwarmErgebnis> => { await aria2.entferne(g).catch(() => {}); return e; };

  // 2. Auswahl: nur die Dateien des Manifests, Name und Größe gleich
  const { treffer, fehlt, anders } = waehleDateien(m, await aria2.dateien(g), dir);
  if (anders) return raus({ ok: false, fall: "torrent.anders", werte: { anzahl: anders } });
  if (fehlt) return raus({ ok: false, fall: "torrent.dateiFehlt", werte: { anzahl: fehlt } });
  // Schon Geprüftes vorlegen – aria2 prüft die Stücke und lädt nur den Rest
  for (const f of m.files) {
    const quelle = join(orte.ordner, f.name);
    if (existsSync(quelle) && statSync(quelle).size === f.sizeBytes) verweise(quelle, treffer.get(f.name)!.path);
  }
  await aria2.aendere(g, { "select-file": [...treffer.values()].map((d) => d.index).join(",") });
  await aria2.weiter(g);

  // 3. Laden, bis jede gewählte Datei vollständig ist
  const gesamt = m.totalBytes;
  const geladen = async () => (await aria2.dateien(g)).filter((d) => [...treffer.values()].some((x) => x.index === d.index)).reduce((s, d) => s + zahl(d.completedLength), 0);
  const fertig = await warteAuf(async () => {
    const s = await aria2.status(g);
    if (s.status === "error") return { fehler: s.errorCode ?? "?" };
    const n = await geladen();
    t.fortschritt?.(n, gesamt);
    return n >= gesamt ? { ok: true as const } : null;
  }, stillMs, taktMs, geladen);
  if (fertig === "still") return raus({ ok: false, fall: "torrent.still" });
  if ("fehler" in fertig) return raus({ ok: false, fall: "torrent.fehler", werte: { fehler: fertig.fehler ?? "?" } });

  // 4. Jede Datei gegen das Manifest, erst dann in den Modellordner
  let falsch = 0;
  for (const f of m.files) if (!(await geprueft(treffer.get(f.name)!.path, f))) falsch++;
  if (falsch) {
    await raus({ ok: false, fall: "datei.summe" });
    rmSync(dir, { recursive: true, force: true });
    return { ok: false, fall: "datei.summe", werte: { anzahl: falsch } };
  }
  for (const f of m.files) {
    const ziel = join(orte.ordner, f.name);
    if (!(existsSync(ziel) && statSync(ziel).size === f.sizeBytes && (await summeDerDatei(ziel)) === f.sha256)) verweise(treffer.get(f.name)!.path, ziel);
  }
  return { ok: true, gid: g, infohash: magnet.infohash };
}

/**
 * Den Freedom-Torrent eines geprüften Modells teilen: aus dem Modellordner gebaut
 * (prüft dabei jede SHA-256), in der Ablage als Verweise ausgelegt, aria2 teilt
 * ohne erneutes Lesen (`bt-seed-unverified` – gerade geprüft). Teilt aria2 ihn
 * schon, nichts Neues.
 */
export async function teileModell(aria2: Aria2, m: ModelManifest, orte: SchwarmOrte, tracker: readonly string[] = []): Promise<{ infohash: string; magnet: string; gid?: string }> {
  const t = await baueModellTorrent(m, orte.ordner);
  const laeuft = [...await aria2.aktive(), ...await aria2.wartende()].find((s) => s.infoHash === t.infohash);
  if (laeuft) return { infohash: t.infohash, magnet: t.magnet, gid: laeuft.gid };
  const dir = join(orte.schwarm, t.infohash);
  for (const f of m.files) verweise(join(orte.ordner, f.name), join(dir, t.name, f.name));
  const gid = await aria2.addTorrent(t.datei, { dir, "bt-seed-unverified": "true", "check-integrity": "false", ...(tracker.length ? { "bt-tracker": tracker.join(",") } : {}) });
  return { infohash: t.infohash, magnet: t.magnet, gid };
}
