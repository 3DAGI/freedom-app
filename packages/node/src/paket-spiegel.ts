/**
 * Pakete über die Brücke (VKd3, `docs/VIBECODEN-ENTWURF.md` VK4 „Pakete holt der Knoten“, W6a): Die Sandbox bleibt ohne
 * Netz. npm und pip im Motor fragen die Brücke (`.npmrc`, `pip.conf` im Home, `hermes-motor.ts`); der Knoten holt nur
 * von der festen Liste (`PAKET_QUELLEN`: registry.npmjs.org, pypi.org, files.pythonhosted.org), nur per GET, ohne
 * Weiterleitung, über den SSRF-Wächter oder – mit `TOR_SOCKS` – durch Tor, je Abruf höchstens `PAKET_GRENZEN.bytesJe`.
 * So machen es Claude Code und Codex: Paket-Registries erlaubt, sonst kein Netz.
 *
 * Prüfsummen rechnen npm (`integrity`) und pip (`#sha256=` im Index, `--require-hashes`) selbst; der Knoten schreibt
 * nur die Adressen in Paketlisten und Index auf die Brücke um, damit auch die Archive über sie kommen. Die Registry sieht
 * die IP des Knotens (oder den Ausgang von Tor) und die Namen der Pakete – `PROVIDER.md` sagt das. Ins Log nichts:
 * Paketnamen verraten, woran gebaut wird.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { PAKET_GRENZEN, PaketAbgelehnt, holeOderFehlt, type PaketOptionen, type PaketRegistry } from "./pakete.js";

export const SPIEGEL_GRENZEN = {
  /** Länge eines Pfads aus der Sandbox. */
  pfad: 1024,
  /** Abrufe und Bytes je Stunde zusammen – gegen einen Agenten, der in einer Schleife lädt. */
  anfragenJeStunde: 20_000,
  bytesJeStunde: 4 * 1024 * 1024 * 1024,
} as const;

/** Wohin eine Anfrage aus der Sandbox geht: Adresse, Registry und wie die Antwort aussieht. */
export interface SpiegelZiel {
  url: string;
  registry: PaketRegistry;
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

/**
 * Ziel einer Anfrage – nur drei Wege, sonst null:
 * - `/npm/<paket>` und `/npm/<paket>/-/<archiv>.tgz` → registry.npmjs.org
 * - `/pypi/simple/<name>/` → pypi.org/simple (Index nach PEP 503)
 * - `/pypi/files/<…>` → files.pythonhosted.org (Archive)
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
  let bytes: Uint8Array | null;
  try {
    bytes = await holeOderFehlt(ziel.url, ziel.registry, PAKET_GRENZEN.bytesJe, o.paket);
  } catch (e) {
    const fall = e instanceof PaketAbgelehnt ? e.fall : "paket-netz";
    return absage(res, fall === "paket-zu-gross" ? 413 : fall === "paket-quelle" ? 404 : 502, fall === "paket-zu-gross" ? "zu gross" : "Registry nicht erreichbar");
  }
  if (bytes === null) return absage(res, 404, "gibt es nicht");
  o.konto.zaehle(bytes.length);
  const koerper = ziel.art === "archiv" ? Buffer.from(bytes) : Buffer.from(aufDieBruecke(new TextDecoder().decode(bytes), o.basis), "utf8");
  res.writeHead(200, { "content-type": TYP[ziel.art], "content-length": String(koerper.length) });
  res.end(req.method === "HEAD" ? undefined : koerper);
}
