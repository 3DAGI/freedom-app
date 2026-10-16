/**
 * Pakete holen für Repo-Aufträge (Schritt 11.5n, `docs/REPO-AGENTEN-ENTWURF.md` W6 B, W6a „So“):
 * Die Sandbox bleibt ohne Netz. Pakete holt der Knoten vorher – nur, was eine Sperrdatei mit
 * Prüfsumme nennt, nur per GET, nur von der festen Liste (`PAKET_QUELLEN`), ohne Weiterleitungen,
 * über den SSRF-Wächter oder – ist `TOR_SOCKS` gesetzt – nur über Tor (`torGet()`). Jede Prüfsumme
 * wird nachgerechnet; ohne Prüfsumme gibt es kein Paket. Abgelegt wird erst nach der Prüfung, in
 * einen Zwischenspeicher je Auftrag, den die Sandbox nur lesend sieht (11.5c):
 * - npm nach Inhalt (`npm/_cacache/content-v2/sha512/…`, wie der Cache von npm) – installiert mit
 *   `npm ci --offline --ignore-scripts --cache <ziel>/npm`; kein Name aus der Sperrdatei wird Pfad.
 * - PyPI unter dem Dateinamen (`pypi/<datei>`) – `pip install --no-index --find-links <ziel>/pypi
 *   --require-hashes -r requirements.txt`.
 *
 * Ein neues Paket (`paketHolen()`) nur mit Namen und fester Version, höchstens
 * `PAKET_GRENZEN.neueJeAuftrag` – und nur in offenen Räumen (W7); das entscheidet der Aufrufer.
 * Ins Log und nach außen nur Kennungen (`PaketAbgelehnt.fall`) und Zahlen – Paketnamen verraten,
 * woran gearbeitet wird.
 */
import { createHash } from "node:crypto";
import { closeSync, constants, lstatSync, mkdirSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";
import { torGet, type SocksZiel } from "./tor.js";
import { safeFetch } from "./url-guard.js";

/** Die feste Liste: je Registry die Hosts, von denen geholt wird – genau diese, keine Unterdomain. */
export const PAKET_QUELLEN = {
  npm: ["registry.npmjs.org"],
  pypi: ["pypi.org", "files.pythonhosted.org"],
} as const;
export type PaketRegistry = keyof typeof PAKET_QUELLEN;

export const PAKET_GRENZEN = {
  /** Pakete je Auftrag (aus der Sperrdatei). */
  pakete: 500,
  /** Bytes je Auftrag zusammen. */
  bytesGesamt: 200 * 1024 * 1024,
  /** Bytes je Archiv. */
  bytesJe: 50 * 1024 * 1024,
  /** Metadaten (npm-Fassung, PyPI-JSON) je Abruf. */
  bytesMeta: 5 * 1024 * 1024,
  /** Zeit je Auftrag und je Abruf. */
  zeitMs: 10 * 60_000,
  zeitJeAbrufMs: 60_000,
  /** Neue Pakete über `paketHolen()` je Auftrag. */
  neueJeAuftrag: 20,
  /** Größe einer Sperrdatei. */
  sperreBytes: 10 * 1024 * 1024,
} as const;

export type PaketFall =
  | "paket-sperre" | "paket-ohne-pruefsumme" | "paket-quelle" | "paket-name" | "paket-version" | "paket-pruefsumme"
  | "paket-plattform" | "paket-zu-gross" | "paket-zu-viele" | "paket-zeit" | "paket-netz" | "paket-ablage";

export class PaketAbgelehnt extends Error {
  constructor(readonly fall: PaketFall) {
    super(`Paket: ${fall}`);
    this.name = "PaketAbgelehnt";
  }
}

/** Ein Archiv, das geholt werden soll: woher und mit welcher Prüfsumme (`sha512` base64 bei npm, `sha256` hex bei PyPI). */
export interface PaketArchiv {
  registry: PaketRegistry;
  url: string;
  /** Dateiname bei PyPI (pip liest daraus Version und Plattform); bei npm nur zur Anzeige. */
  datei: string;
  pruef: { alg: "sha512" | "sha256"; werte: string[] };
}

/** Ein Paket aus `requirements.txt`: Name, feste Version, erlaubte sha256 – das Archiv nennt erst PyPI. */
export interface PipWunsch { name: string; version: string; sha256: string[] }

/** Die Plattform der Sandbox: Prozessor wie bei npm (`x64`, `arm64`), Linux mit glibc; Python als `cp312`. */
export interface PaketPlattform { cpu: string; python?: string }

const NPM_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const NPM_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const PYPI_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const PYPI_VERSION = /^\d+(?:\.\d+)*(?:(?:a|b|rc)\d+)?(?:\.post\d+)?(?:\.dev\d+)?$/;
const DATEI = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,200}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const SHA512_B64 = /^[A-Za-z0-9+/]{86}==$/;
const RAD_CPU: Record<string, string> = { x64: "x86_64", arm64: "aarch64" };

export const istNpmName = (n: string): boolean => n.length <= 214 && NPM_NAME.test(n);
export const istPypiName = (n: string): boolean => n.length <= 100 && PYPI_NAME.test(n);

export const standardPlattform = (): PaketPlattform => ({ cpu: process.arch });

/** Nur https und genau ein Host der Liste – die Prüfung vor jedem Abruf, auch für Adressen aus Sperrdatei oder Metadaten. */
function aufDerListe(url: string, registry: PaketRegistry): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password && !u.port
      && (PAKET_QUELLEN[registry] as readonly string[]).includes(u.hostname);
  } catch {
    return false;
  }
}

/** Letzter Teil des Pfads als Dateiname – nur einfache Namen, nie ein Pfad. */
function dateiAus(url: string): string | null {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    return DATEI.test(name) && !name.includes("..") ? name : null;
  } catch {
    return null;
  }
}

/** `os`/`cpu`/`libc` eines npm-Pakets wie npm-install-checks: `!x` schließt aus, sonst muss der Wert genannt sein. */
function passtListe(wert: string, liste: unknown): boolean {
  const l = typeof liste === "string" ? [liste] : liste;
  if (!Array.isArray(l) || l.length === 0 || (l.length === 1 && l[0] === "any")) return true;
  if (l.includes(`!${wert}`)) return false;
  const genannt = l.filter((x) => typeof x === "string" && !x.startsWith("!"));
  return genannt.length === 0 || genannt.includes(wert);
}

/**
 * `package-lock.json` (Fassung 2 und 3) lesen: jedes installierte Paket (`node_modules/…`) mit
 * `resolved` von der Liste und `integrity` als sha512. Verweise (`link`), mitgelieferte Pakete
 * (`inBundle`), Ordner von Arbeitsbereichen und Pakete für eine andere Plattform (`os`, `cpu`, `libc`
 * wie bei npm, das sie auch nicht installiert) bleiben weg. Fehlt einem Paket die Prüfsumme oder
 * kommt es von woanders, ist die ganze Sperrdatei abgelehnt – lieber nichts als ein Teil.
 */
export function leseNpmSperre(text: string, plattform: PaketPlattform = standardPlattform()): PaketArchiv[] {
  let roh: unknown;
  try {
    roh = JSON.parse(text);
  } catch {
    throw new PaketAbgelehnt("paket-sperre");
  }
  const lock = roh as { lockfileVersion?: unknown; packages?: unknown } | null;
  if (!lock || (lock.lockfileVersion !== 2 && lock.lockfileVersion !== 3) || typeof lock.packages !== "object" || lock.packages === null) {
    throw new PaketAbgelehnt("paket-sperre");
  }
  const archive = new Map<string, PaketArchiv>();
  for (const [pfad, eintrag] of Object.entries(lock.packages as Record<string, unknown>)) {
    if (!/(^|\/)node_modules\//.test(pfad)) continue;
    if (typeof eintrag !== "object" || eintrag === null) throw new PaketAbgelehnt("paket-sperre");
    const e = eintrag as { link?: unknown; inBundle?: unknown; resolved?: unknown; integrity?: unknown; os?: unknown; cpu?: unknown; libc?: unknown };
    if (e.link === true || e.inBundle === true) continue;
    if (!passtListe("linux", e.os) || !passtListe(plattform.cpu, e.cpu) || !passtListe("glibc", e.libc)) continue;
    if (typeof e.resolved !== "string" || !aufDerListe(e.resolved, "npm")) throw new PaketAbgelehnt("paket-quelle");
    const sha512 = typeof e.integrity === "string"
      ? e.integrity.split(/\s+/).filter((x) => x.startsWith("sha512-")).map((x) => x.slice(7)).filter((x) => SHA512_B64.test(x))
      : [];
    if (sha512.length === 0) throw new PaketAbgelehnt("paket-ohne-pruefsumme");
    // Dasselbe Archiv an mehreren Stellen im Baum: einmal holen
    archive.set(sha512[0]!, { registry: "npm", url: e.resolved, datei: dateiAus(e.resolved) ?? "", pruef: { alg: "sha512", werte: sha512 } });
  }
  if (archive.size > PAKET_GRENZEN.pakete) throw new PaketAbgelehnt("paket-zu-viele");
  return [...archive.values()];
}

/**
 * `requirements.txt` nur mit `--hash` lesen, wie pip: bis zur ersten Option die Anforderung
 * `name==version` (Extras und Marker nach `;` erlaubt), danach nur `--hash=sha256:…`, mindestens
 * eine. Zeilen mit anderen Optionen (`--index-url`, `-r`, `-e` …) und Bereiche statt fester
 * Versionen lehnen die ganze Datei ab.
 */
export function lesePipAnforderungen(text: string): PipWunsch[] {
  const out: PipWunsch[] = [];
  for (const zeile of text.replace(/\\\r?\n/g, " ").split(/\r?\n/)) {
    const teile = zeile.replace(/(^|\s)#.*$/, "").trim().split(/\s+/).filter(Boolean);
    if (teile.length === 0) continue;
    const ab = teile.findIndex((t) => t.startsWith("-"));
    const anforderung = (ab < 0 ? teile : teile.slice(0, ab)).join("");
    if (!anforderung) throw new PaketAbgelehnt("paket-sperre");
    const m = /^([A-Za-z0-9._-]+)(?:\[[A-Za-z0-9._,-]+\])?(?:==([^;]+)|[<>=!~][^;]*)?(?:;.*)?$/.exec(anforderung);
    if (!m || !istPypiName(m[1]!)) throw new PaketAbgelehnt("paket-name");
    if (!m[2] || !PYPI_VERSION.test(m[2])) throw new PaketAbgelehnt("paket-version");
    const sha256: string[] = [];
    for (const t of ab < 0 ? [] : teile.slice(ab)) {
      const h = /^--hash=sha256:([0-9a-f]{64})$/.exec(t);
      if (!h) throw new PaketAbgelehnt("paket-sperre");
      sha256.push(h[1]!);
    }
    if (sha256.length === 0) throw new PaketAbgelehnt("paket-ohne-pruefsumme");
    out.push({ name: m[1]!, version: m[2]!, sha256 });
  }
  if (out.length > PAKET_GRENZEN.pakete) throw new PaketAbgelehnt("paket-zu-viele");
  return out;
}

/** Tags eines Rads (`name-version[-build]-py-abi-plattform.whl`), je Teil mit Punkten getrennt. */
function radTags(datei: string): { py: string[]; abi: string[]; plat: string[] } | null {
  const t = datei.slice(0, -".whl".length).split("-");
  return t.length < 5 ? null : { py: t.at(-3)!.split("."), abi: t.at(-2)!.split("."), plat: t.at(-1)!.split(".") };
}

/**
 * Welche Dateien einer PyPI-Version die Sandbox braucht – nicht alle, deren Prüfsumme die
 * Sperrdatei nennt (oft Räder für jede Plattform und Python-Fassung): ein reines Rad
 * (`py3-none-any`), sonst Räder für Linux mit glibc, den Prozessor und die Python-Fassung
 * (`cp312`, auch `abi3` ab älterer Fassung), sonst das Quellarchiv.
 */
export function passendeDateien(dateien: PaketArchiv[], plattform: PaketPlattform): PaketArchiv[] {
  const raeder = dateien.filter((a) => a.datei.endsWith(".whl"));
  const rein = raeder.find((a) => {
    const r = radTags(a.datei);
    return !!r && r.abi.includes("none") && r.plat.includes("any") && r.py.some((p) => p === "py3" || p === "py2.py3");
  });
  if (rein) return [rein];
  const cpu = RAD_CPU[plattform.cpu];
  const py = plattform.python && /^cp3\d{1,2}$/.test(plattform.python) ? plattform.python : undefined;
  if (cpu && py) {
    const linux = new RegExp(`^manylinux(?:1|2010|2014|_\\d+_\\d+)_${cpu}$`);
    const fassung = Number(py.slice(3));
    const passend = raeder.filter((a) => {
      const r = radTags(a.datei);
      if (!r || !r.plat.some((p) => linux.test(p))) return false;
      return (r.py.includes(py) && (r.abi.includes(py) || r.abi.includes("none")))
        || (r.abi.includes("abi3") && r.py.some((p) => /^cp3\d{1,2}$/.test(p) && Number(p.slice(3)) <= fassung));
    });
    if (passend.length > 0) return passend;
  }
  const quelle = dateien.find((a) => a.datei.endsWith(".tar.gz") || a.datei.endsWith(".zip"));
  return quelle ? [quelle] : [];
}

/** Wie der Knoten abruft – in Tests eine Attrappe; sonst `safeFetch()` bzw. `torGet()`, ohne Weiterleitung. */
export type PaketAbruf = (url: string, registry: PaketRegistry) => Promise<Response>;

const direktAbruf: PaketAbruf = (url, registry) =>
  safeFetch(url, { allowHosts: [...PAKET_QUELLEN[registry]], timeoutMs: PAKET_GRENZEN.zeitJeAbrufMs, maxRedirects: 0 });
const torAbruf = (proxy: SocksZiel): PaketAbruf => (url) => torGet(proxy, url, PAKET_GRENZEN.zeitJeAbrufMs);

/** Antwort als Bytes, höchstens `max` – darüber `paket-zu-gross`, ohne den Rest zu lesen. */
async function bytesBegrenzt(res: Response, max: number): Promise<Uint8Array> {
  if (Number(res.headers.get("content-length") ?? "0") > max) {
    await res.body?.cancel().catch(() => undefined);
    throw new PaketAbgelehnt("paket-zu-gross");
  }
  const leser = res.body?.getReader();
  if (!leser) return new Uint8Array(0);
  const teile: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await leser.read();
    if (done) break;
    n += value.length;
    if (n > max) {
      await leser.cancel().catch(() => undefined);
      throw new PaketAbgelehnt("paket-zu-gross");
    }
    teile.push(value);
  }
  const alles = new Uint8Array(n);
  let o = 0;
  for (const t of teile) { alles.set(t, o); o += t.length; }
  return alles;
}

export interface PaketOptionen {
  /** Ist Tor eingestellt (`TOR_SOCKS`, `torAusUmgebung()`), geht jeder Abruf durch Tor – der Aufrufer muss es sagen, ohne Vorgabe. */
  tor: SocksZiel | null;
  /** Nur für Tests: statt des Netzes. */
  abruf?: PaketAbruf;
  plattform?: PaketPlattform;
  jetzt?: () => number;
}

/** Ein GET von der Liste – Status 200, sonst `paket-netz`; Fehler des Netzes nur als Kennung. */
async function hole(url: string, registry: PaketRegistry, max: number, o: PaketOptionen): Promise<Uint8Array> {
  if (!aufDerListe(url, registry)) throw new PaketAbgelehnt("paket-quelle");
  try {
    const res = await (o.abruf ?? (o.tor ? torAbruf(o.tor) : direktAbruf))(url, registry);
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => undefined);
      throw new PaketAbgelehnt("paket-netz");
    }
    return await bytesBegrenzt(res, max);
  } catch (e) {
    throw e instanceof PaketAbgelehnt ? e : new PaketAbgelehnt("paket-netz");
  }
}

/** Wohin ein Archiv kommt: npm nach Inhalt wie im Cache von npm, PyPI unter dem Dateinamen. */
export function paketPfad(ziel: string, a: PaketArchiv): string {
  if (a.registry === "pypi") return join(ziel, "pypi", a.datei);
  const hex = Buffer.from(a.pruef.werte[0]!, "base64").toString("hex");
  return join(ziel, "npm", "_cacache", "content-v2", "sha512", hex.slice(0, 2), hex.slice(2, 4), hex.slice(4));
}

/** Eine neue Datei (0600) – nie über einen Verweis, nie über eine vorhandene. */
function lege(pfad: string, bytes: Uint8Array): void {
  try {
    mkdirSync(join(pfad, ".."), { recursive: true, mode: 0o700 });
    const fd = openSync(pfad, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      for (let ab = 0; ab < bytes.length;) ab += writeSync(fd, bytes, ab);
    } finally {
      closeSync(fd);
    }
  } catch {
    throw new PaketAbgelehnt("paket-ablage");
  }
}

/** Was ein Auftrag bisher geholt hat – für die Grenzen über mehrere Aufrufe. */
export class PaketKonto {
  bytes = 0;
  pakete = 0;
  neue = 0;
  readonly bis: number;
  constructor(jetzt: number = Date.now()) {
    this.bis = jetzt + PAKET_GRENZEN.zeitMs;
  }
}

async function holeArchiv(a: PaketArchiv, ziel: string, konto: PaketKonto, o: PaketOptionen): Promise<void> {
  const mit = (h: string): PaketArchiv => ({ ...a, pruef: { alg: a.pruef.alg, werte: [h] } });
  // Schon geprüft abgelegt (dasselbe Archiv in npm und einer zweiten Anfrage): nicht noch einmal holen
  for (const h of a.pruef.werte) {
    try {
      if (lstatSync(paketPfad(ziel, mit(h))).isFile()) return;
    } catch { /* noch nicht da */ }
  }
  if ((o.jetzt ?? Date.now)() > konto.bis) throw new PaketAbgelehnt("paket-zeit");
  if (konto.pakete >= PAKET_GRENZEN.pakete) throw new PaketAbgelehnt("paket-zu-viele");
  const bytes = await hole(a.url, a.registry, Math.min(PAKET_GRENZEN.bytesJe, PAKET_GRENZEN.bytesGesamt - konto.bytes), o);
  const h = createHash(a.pruef.alg).update(bytes).digest(a.pruef.alg === "sha512" ? "base64" : "hex");
  if (!a.pruef.werte.includes(h)) throw new PaketAbgelehnt("paket-pruefsumme");
  // npm liest nach der Summe, die passt – nicht nach der ersten genannten
  lege(paketPfad(ziel, mit(h)), bytes);
  konto.bytes += bytes.length;
  konto.pakete += 1;
}

/** PyPI-JSON einer Version: die Dateien mit sha256 – nur Archive vom Archiv-Host der Liste. */
async function pypiDateien(name: string, version: string, o: PaketOptionen): Promise<PaketArchiv[]> {
  if (!istPypiName(name)) throw new PaketAbgelehnt("paket-name");
  if (!PYPI_VERSION.test(version)) throw new PaketAbgelehnt("paket-version");
  // Der Name in der Form nach PEP 503 – sonst antwortet PyPI mit einer Weiterleitung
  const norm = name.toLowerCase().replace(/[-_.]+/g, "-");
  const meta = await hole(`https://pypi.org/pypi/${norm}/${version}/json`, "pypi", PAKET_GRENZEN.bytesMeta, o);
  let urls: unknown;
  try {
    urls = (JSON.parse(new TextDecoder().decode(meta)) as { urls?: unknown }).urls;
  } catch {
    throw new PaketAbgelehnt("paket-netz");
  }
  if (!Array.isArray(urls)) throw new PaketAbgelehnt("paket-netz");
  const out: PaketArchiv[] = [];
  for (const f of urls as unknown[]) {
    const d = (typeof f === "object" && f !== null ? f : {}) as { url?: unknown; filename?: unknown; digests?: { sha256?: unknown } };
    const url = typeof d.url === "string" ? d.url : "";
    const sha = d.digests?.sha256;
    if (!aufDerListe(url, "pypi") || typeof sha !== "string" || !SHA256_HEX.test(sha)) continue;
    const datei = dateiAus(url);
    if (datei && datei === d.filename) out.push({ registry: "pypi", url, datei, pruef: { alg: "sha256", werte: [sha] } });
  }
  return out;
}

/**
 * Alles aus den Sperrdateien holen und in `ziel` ablegen. Scheitert ein Paket, scheitert der
 * Aufruf – der Agent sagt im Raum, dass die Pakete fehlen.
 */
export async function holeAusSperre(
  sperre: { npm?: string; pip?: string }, ziel: string, konto: PaketKonto, o: PaketOptionen,
): Promise<void> {
  for (const t of [sperre.npm, sperre.pip]) if (t !== undefined && Buffer.byteLength(t) > PAKET_GRENZEN.sperreBytes) throw new PaketAbgelehnt("paket-sperre");
  const plattform = o.plattform ?? standardPlattform();
  const npm = sperre.npm === undefined ? [] : leseNpmSperre(sperre.npm, plattform);
  const pip = sperre.pip === undefined ? [] : lesePipAnforderungen(sperre.pip);
  if (npm.length + pip.length > PAKET_GRENZEN.pakete) throw new PaketAbgelehnt("paket-zu-viele");
  for (const a of npm) await holeArchiv(a, ziel, konto, o);
  for (const w of pip) {
    // Nur Dateien, deren sha256 die Sperrdatei nennt – davon die für diese Plattform
    const genannt = (await pypiDateien(w.name, w.version, o)).filter((a) => w.sha256.includes(a.pruef.werte[0]!));
    if (genannt.length === 0) throw new PaketAbgelehnt("paket-pruefsumme");
    const passend = passendeDateien(genannt, plattform);
    if (passend.length === 0) throw new PaketAbgelehnt("paket-plattform");
    for (const a of passend) await holeArchiv(a, ziel, konto, o);
  }
}

/**
 * Ein neues Paket mit Namen und fester Version (Werkzeug `paket_holen`, nur offene Räume): npm über
 * die Metadaten der Version (`dist.tarball`, `dist.integrity`), PyPI über das JSON der Version
 * (`passendeDateien()`). Zurück je Datei Adresse und Prüfsumme in der Form der Sperrdatei
 * (`sha512-…` für `integrity`, `sha256:…` für `--hash`) – die schreibt der Agent danach offline.
 */
export async function paketHolen(
  registry: PaketRegistry, name: string, version: string, ziel: string, konto: PaketKonto, o: PaketOptionen,
): Promise<Array<{ url: string; pruefsumme: string }>> {
  if (konto.neue >= PAKET_GRENZEN.neueJeAuftrag) throw new PaketAbgelehnt("paket-zu-viele");
  let archive: PaketArchiv[];
  if (registry === "npm") {
    if (!istNpmName(name)) throw new PaketAbgelehnt("paket-name");
    if (!NPM_VERSION.test(version)) throw new PaketAbgelehnt("paket-version");
    const meta = await hole(`https://registry.npmjs.org/${name.replace("/", "%2f")}/${version}`, "npm", PAKET_GRENZEN.bytesMeta, o);
    let dist: { tarball?: unknown; integrity?: unknown } | undefined;
    try {
      dist = (JSON.parse(new TextDecoder().decode(meta)) as { dist?: typeof dist } | null)?.dist;
    } catch {
      throw new PaketAbgelehnt("paket-netz");
    }
    const sha512 = typeof dist?.integrity === "string" && dist.integrity.startsWith("sha512-") ? dist.integrity.slice(7) : "";
    if (!SHA512_B64.test(sha512)) throw new PaketAbgelehnt("paket-ohne-pruefsumme");
    const url = typeof dist?.tarball === "string" ? dist.tarball : "";
    if (!aufDerListe(url, "npm")) throw new PaketAbgelehnt("paket-quelle");
    archive = [{ registry: "npm", url, datei: dateiAus(url) ?? "", pruef: { alg: "sha512", werte: [sha512] } }];
  } else {
    archive = passendeDateien(await pypiDateien(name, version, o), o.plattform ?? standardPlattform());
    if (archive.length === 0) throw new PaketAbgelehnt("paket-plattform");
  }
  konto.neue += 1;
  for (const a of archive) await holeArchiv(a, ziel, konto, o);
  return archive.map((a) => ({ url: a.url, pruefsumme: a.pruef.alg === "sha512" ? `sha512-${a.pruef.werte[0]}` : `sha256:${a.pruef.werte[0]}` }));
}
