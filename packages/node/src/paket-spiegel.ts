/**
 * Pakete über die Brücke (VKd3, `docs/VIBECODEN-ENTWURF.md` VK4 „Pakete holt der Knoten“, W6a): Die Sandbox bleibt ohne
 * Netz. npm und pip im Motor fragen die Brücke (`.npmrc`, `pip.conf` im Home, `hermes-motor.ts`); der Knoten holt nur
 * von der festen Liste (`PAKET_QUELLEN`: registry.npmjs.org, pypi.org, files.pythonhosted.org), nur per GET, ohne
 * Weiterleitung, über den SSRF-Wächter oder – mit `TOR_SOCKS` – durch Tor, je Abruf höchstens `SPIEGEL_GRENZEN.bytesJe`.
 * So machen es Claude Code und Codex: Paket-Registries erlaubt, sonst kein Netz.
 *
 * Seit VKh1 (`docs/ANDROID-ENTWURF.md`, VKh-W3 A) dazu Maven für Gradle: Google Maven (dl.google.com) und Maven Central
 * (repo.maven.apache.org), nur Archive, POMs, Gradle-Metadaten und Prüfsummen. Das Init-Skript im Home des Motors lenkt
 * die Repositories des Projekts dorthin, das Plugin-Portal auf Maven Central.
 *
 * Prüfsummen rechnen npm (`integrity`) und pip (`#sha256=` im Index, `--require-hashes`) selbst; der Knoten schreibt
 * nur die Adressen in Paketlisten und Index auf die Brücke um, damit auch die Archive über sie kommen. Gradle prüft nur
 * mit `verification-metadata.xml` – sonst bürgt allein die TLS-Verbindung des Knotens zur Registry. Archive gehen als
 * Strom weiter, nie ganz im Speicher. Die Registry sieht die IP des Knotens (oder den Ausgang von Tor) und die Namen der
 * Pakete – `PROVIDER.md` sagt das. Ins Log nichts: Paketnamen verraten, woran gebaut wird.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { PAKET_GRENZEN, PaketAbgelehnt, antwortOderFehlt, holeOderFehlt, type PaketOptionen, type PaketQuelle } from "./pakete.js";

export const SPIEGEL_GRENZEN = {
  /** Länge eines Pfads aus der Sandbox. */
  pfad: 1024,
  /** Bytes je Abruf: npm und PyPI wie für Repo-Aufträge; Maven mehr – `kotlin-compiler-embeddable` allein hat 58 MB. */
  bytesJe: { npm: PAKET_GRENZEN.bytesJe, pypi: PAKET_GRENZEN.bytesJe, maven: 128 * 1024 * 1024 },
  /** Abrufe und Bytes je Stunde zusammen – gegen einen Agenten, der in einer Schleife lädt. */
  anfragenJeStunde: 20_000,
  bytesJeStunde: 4 * 1024 * 1024 * 1024,
} as const;

/** Wohin eine Anfrage aus der Sandbox geht: Adresse, Registry und wie die Antwort aussieht. */
export interface SpiegelZiel {
  url: string;
  registry: PaketQuelle;
  art: "paketliste" | "index" | "archiv";
}

/** Ein Teil eines Pfads: Zeichen, die npm und pip in Namen, Versionen und Dateinamen nutzen – nie `.` oder `..`. */
const TEIL = /^[A-Za-z0-9@%._~+-]+$/;

function rest(pfad: string, vorne: string, offenesEnde: boolean): string | null {
  const r = pfad.slice(vorne.length);
  const teile = r.split("/");
  if (offenesEnde && teile[teile.length - 1] === "") teile.pop();
  if (teile.length === 0 || teile.some((t) => !TEIL.test(t) || t === "." || t === ".." || /%2e/i.test(t))) return null;
  return r;
}

/** Die beiden Maven-Repositories (VKh1) – Gradle nennt Google Maven so in `google()`, Maven Central in `mavenCentral()`. */
export const MAVEN_REPOS = {
  google: "https://dl.google.com/dl/android/maven2/",
  central: "https://repo.maven.apache.org/maven2/",
} as const;

/** Ein Teil eines Maven-Pfads (Gruppe, Artefakt, Version, Datei) – enger als `TEIL`: kein `%`, kein `@`, kein `~`. */
const MAVEN_TEIL = /^[A-Za-z0-9._+-]+$/;
/** Nur Archive, POMs, Gradle-Metadaten, Verzeichnis der Versionen – und ihre Prüfsummen und Signaturen. */
const MAVEN_DATEI = /^(?:.+\.(?:pom|jar|aar|module|klib|zip)|maven-metadata\.xml)(?:\.(?:sha1|sha256|sha512|md5|asc))?$/;

function mavenRest(pfad: string, vorne: string): string | null {
  const r = pfad.slice(vorne.length);
  const teile = r.split("/");
  if (teile.length < 3 || teile.some((t) => !MAVEN_TEIL.test(t) || /^\.+$/.test(t))) return null;
  return MAVEN_DATEI.test(teile[teile.length - 1]!) ? r : null;
}

/**
 * Ziel einer Anfrage – nur diese Wege, sonst null:
 * - `/npm/<paket>` und `/npm/<paket>/-/<archiv>.tgz` → registry.npmjs.org
 * - `/pypi/simple/<name>/` → pypi.org/simple (Index nach PEP 503)
 * - `/pypi/files/<…>` → files.pythonhosted.org (Archive)
 * - `/maven/google/<gruppe>/<artefakt>/<version>/<datei>` → Google Maven, `/maven/central/…` → Maven Central (seit VKh1)
 */
export function spiegelZiel(pfad: string | undefined): SpiegelZiel | null {
  if (!pfad || pfad.length > SPIEGEL_GRENZEN.pfad || /[?#\\]/.test(pfad)) return null;
  if (pfad.startsWith("/npm/")) {
    const r = rest(pfad, "/npm/", false);
    return r === null ? null : { url: `https://registry.npmjs.org/${r}`, registry: "npm", art: r.includes("/-/") ? "archiv" : "paketliste" };
  }
  if (pfad.startsWith("/pypi/simple/")) {
    const r = rest(pfad, "/pypi/simple/", true);
    return r === null ? null : { url: `https://pypi.org/simple/${r}`, registry: "pypi", art: "index" };
  }
  if (pfad.startsWith("/pypi/files/")) {
    const r = rest(pfad, "/pypi/files/", false);
    return r === null ? null : { url: `https://files.pythonhosted.org/${r}`, registry: "pypi", art: "archiv" };
  }
  for (const [name, basis] of Object.entries(MAVEN_REPOS)) {
    if (!pfad.startsWith(`/maven/${name}/`)) continue;
    const r = mavenRest(pfad, `/maven/${name}/`);
    return r === null ? null : { url: `${basis}${r}`, registry: "maven", art: "archiv" };
  }
  return null;
}

/** Adressen in Paketlisten und Index zeigen auf die Brücke – sonst holte npm oder pip die Archive am Spiegel vorbei. */
export function aufDieBruecke(text: string, basis: string): string {
  return text
    .replaceAll("https://registry.npmjs.org/", `${basis}/npm/`)
    .replaceAll("https://files.pythonhosted.org/", `${basis}/pypi/files/`);
}

/** Abrufe und Bytes der laufenden Stunde – für alle Läufe des Knotens zusammen. */
export class SpiegelKonto {
  private seit = 0;
  private anfragen = 0;
  private bytes = 0;

  constructor(private readonly jetzt: () => number = Date.now) {}

  private stunde(): void {
    if (this.jetzt() - this.seit >= 3_600_000) {
      this.seit = this.jetzt();
      this.anfragen = 0;
      this.bytes = 0;
    }
  }

  /** Noch Platz für eine Anfrage? Zählt sie gleich mit. */
  darf(): boolean {
    this.stunde();
    if (this.anfragen >= SPIEGEL_GRENZEN.anfragenJeStunde || this.bytes >= SPIEGEL_GRENZEN.bytesJeStunde) return false;
    this.anfragen += 1;
    return true;
  }

  zaehle(n: number): void {
    this.bytes += n;
  }
}

const TYP: Record<SpiegelZiel["art"], string> = {
  paketliste: "application/json",
  index: "text/html; charset=utf-8",
  archiv: "application/octet-stream",
};

function absage(res: ServerResponse, status: number, text: string): void {
  if (res.headersSent) return void res.destroy();
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", connection: "close" }).end(text);
}

/**
 * Eine Anfrage aus der Sandbox beantworten. `basis` ist die Adresse der Brücke in der Sandbox
 * (`http://127.0.0.1:<port>`). Antworten nur mit festen Texten – nie Meldungen von Registry oder System.
 */
export async function beantworteSpiegel(
  req: Pick<IncomingMessage, "method" | "url" | "resume">, res: ServerResponse,
  o: { basis: string; paket: PaketOptionen; konto: SpiegelKonto },
): Promise<void> {
  req.resume();
  if (req.method !== "GET" && req.method !== "HEAD") return absage(res, 405, "nur lesen");
  const ziel = spiegelZiel(req.url);
  if (!ziel) return absage(res, 404, "nicht über die Brücke");
  if (!o.konto.darf()) return absage(res, 429, "zu viele Pakete in dieser Stunde");
  const max = SPIEGEL_GRENZEN.bytesJe[ziel.registry];
  try {
    if (ziel.art === "archiv") {
      const antwort = await antwortOderFehlt(ziel.url, ziel.registry, max, o.paket);
      if (antwort === null) return absage(res, 404, "gibt es nicht");
      return await leiteWeiter(antwort, res, max, o.konto, req.method === "HEAD");
    }
    const bytes = await holeOderFehlt(ziel.url, ziel.registry, max, o.paket);
    if (bytes === null) return absage(res, 404, "gibt es nicht");
    o.konto.zaehle(bytes.length);
    const koerper = Buffer.from(aufDieBruecke(new TextDecoder().decode(bytes), o.basis), "utf8");
    res.writeHead(200, { "content-type": TYP[ziel.art], "content-length": String(koerper.length) });
    res.end(req.method === "HEAD" ? undefined : koerper);
  } catch (e) {
    const fall = e instanceof PaketAbgelehnt ? e.fall : "paket-netz";
    absage(res, fall === "paket-zu-gross" ? 413 : fall === "paket-quelle" ? 404 : 502, fall === "paket-zu-gross" ? "zu gross" : "Registry nicht erreichbar");
  }
}

/**
 * Ein Archiv als Strom weiterreichen (seit VKh1): Stück für Stück, mit Gegendruck der Sandbox, gezählt im Konto; über
 * `max` oder bei einem Fehler wird die Verbindung abgebrochen – ein halbes Archiv sieht der Client nie als ganzes. Die
 * Länge nur, wenn die Registry sie für genau diese Bytes nennt (ohne `content-encoding` – `fetch` entpackt selbst).
 */
async function leiteWeiter(antwort: Response, res: ServerResponse, max: number, konto: SpiegelKonto, nurKopf: boolean): Promise<void> {
  const laenge = antwort.headers.get("content-length");
  const genau = laenge !== null && /^\d{1,12}$/.test(laenge) && !antwort.headers.get("content-encoding");
  res.writeHead(200, { "content-type": TYP.archiv, ...(genau ? { "content-length": laenge } : {}) });
  const leser = antwort.body?.getReader();
  if (nurKopf || !leser) {
    await leser?.cancel().catch(() => undefined);
    return void res.end();
  }
  let n = 0;
  try {
    for (;;) {
      const { done, value } = await leser.read();
      if (done) break;
      n += value.length;
      konto.zaehle(value.length);
      if (n > max) throw new PaketAbgelehnt("paket-zu-gross");
      if (!res.write(value)) await platzFrei(res);
      if (res.destroyed) throw new PaketAbgelehnt("paket-netz");
    }
    res.end();
  } catch {
    await leser.cancel().catch(() => undefined);
    res.destroy();
  }
}

/** Bis die Sandbox wieder liest – oder die Verbindung zu ist; beide Zuhörer gehen danach wieder weg. */
function platzFrei(res: ServerResponse): Promise<void> {
  return new Promise((weiter) => {
    const fertig = () => {
      res.off("drain", fertig);
      res.off("close", fertig);
      weiter();
    };
    res.on("drain", fertig);
    res.on("close", fertig);
  });
}
