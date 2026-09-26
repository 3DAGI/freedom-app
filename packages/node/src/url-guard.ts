/**
 * Schutz gegen SSRF (Server-Side Request Forgery).
 *
 * DAS PROBLEM
 * Ein Provider-Knoten holt auf Zuruf eines FREMDEN eine URL und schickt den
 * Inhalt zurück. Ohne Prüfung ist das eine Fernabfrage in das private Netz des
 * Betreibers: `http://127.0.0.1:11434` (Ollama), `http://127.0.0.1:8080`
 * (LND-REST), `http://192.168.1.1` (Router-Oberfläche), und in der Cloud
 * `http://169.254.169.254/` — die Metadaten-Schnittstelle, über die auf vielen
 * Anbietern Zugangsdaten der Instanz abrufbar sind. Der Angreifer braucht dafür
 * nichts weiter als einen Job im offenen Marktplatz.
 *
 * WARUM EINE DNS-AUFLÖSUNG NÖTIG IST
 * Eine reine String-Prüfung auf "localhost" reicht nicht: ein Angreifer
 * registriert `evil.example` mit A-Record 127.0.0.1 und umgeht damit jede
 * Namensprüfung. Deshalb wird der Name aufgelöst und die ADRESSE geprüft.
 *
 * VERBLEIBENDE LÜCKE (ehrlich benannt)
 * Zwischen Prüfung und Verbindung kann sich die Auflösung ändern
 * (DNS-Rebinding). Vollständig dicht wäre nur ein eigener Socket, der an die
 * geprüfte IP bindet. Für den vollen Schutz gehört der Knoten zusätzlich in
 * ein Netz ohne Zugriff auf private Bereiche — die systemd-Unit im Installer
 * ist dafür der richtige Ort.
 */
// Adressbereiche seit 8.7 im Protokoll – dieselbe Pruefung fuer App und Knoten.
import { isPrivateAddress } from "@freedomstack/protocol";
export { isPrivateAddress, isPrivateIPv4, isPrivateIPv6 } from "@freedomstack/protocol";

export interface UrlGuardOptions {
  /** Nur diese Hosts erlauben. Leer = alle öffentlichen Hosts. */
  allowHosts?: string[];
  /** Private Ziele zulassen — ausschließlich für lokale Tests. */
  allowPrivate?: boolean;
  maxRedirects?: number;
  /** Namensaufloesung – nur fuer Tests austauschbar (ohne Netz); Standard ist das System-DNS. */
  aufloesen?: (host: string) => Promise<string[]>;
}

export interface GuardVerdict {
  allowed: boolean;
  reason: string;
  resolvedAddresses?: string[];
}

/**
 * Prüft eine URL vor dem Abruf.
 *
 * Reihenfolge bewusst: erst die billigen Prüfungen (Schema, Form), dann die
 * teure DNS-Auflösung. Ein Angreifer soll für einen Fehlversuch keine
 * Namensauflösung auslösen können.
 */
export async function checkUrlSafe(raw: string, opts: UrlGuardOptions = {}): Promise<GuardVerdict> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { allowed: false, reason: "Keine gültige URL." };
  }

  // file:, gopher:, ftp: und Konsorten haben hier nichts zu suchen.
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { allowed: false, reason: `Schema ${url.protocol} ist nicht erlaubt (nur http/https).` };
  }

  // Zugangsdaten in der URL sind ein typisches Umgehungsmuster.
  if (url.username || url.password) {
    return { allowed: false, reason: "URLs mit eingebetteten Zugangsdaten sind nicht erlaubt." };
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");

  if (opts.allowHosts && opts.allowHosts.length > 0) {
    const ok = opts.allowHosts.some((h) => host === h || host.endsWith("." + h));
    if (!ok) return { allowed: false, reason: `Host ${host} steht nicht auf der Freigabeliste.` };
  }

  if (opts.allowPrivate) return { allowed: true, reason: "Private Ziele ausdrücklich erlaubt (Testmodus)." };

  // Ist der Host bereits eine IP-Adresse, direkt prüfen — ohne DNS.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")) {
    if (isPrivateAddress(host)) {
      return { allowed: false, reason: `${host} liegt in einem privaten Bereich.`, resolvedAddresses: [host] };
    }
    return { allowed: true, reason: "Öffentliche IP-Adresse.", resolvedAddresses: [host] };
  }

  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return { allowed: false, reason: `${host} zeigt auf das lokale System.` };
  }

  // Namen auflösen: eine String-Prüfung allein ist umgehbar, indem ein
  // Angreifer einen öffentlichen Namen auf 127.0.0.1 zeigen lässt.
  try {
    const addresses = opts.aufloesen
      ? await opts.aufloesen(host)
      : (await (await import("node:dns/promises")).lookup(host, { all: true })).map((r) => r.address);
    if (addresses.length === 0) {
      return { allowed: false, reason: `${host} ließ sich nicht auflösen.` };
    }
    // ALLE Adressen müssen öffentlich sein — eine private genügt zum Ablehnen.
    const bad = addresses.filter((a) => isPrivateAddress(a));
    if (bad.length > 0) {
      return {
        allowed: false,
        reason: `${host} löst auf einen privaten Bereich auf (${bad[0]}).`,
        resolvedAddresses: addresses,
      };
    }
    return { allowed: true, reason: "Öffentlich erreichbares Ziel.", resolvedAddresses: addresses };
  } catch (e) {
    return { allowed: false, reason: `Auflösung von ${host} fehlgeschlagen: ${(e as Error).message}` };
  }
}

/**
 * Geprüfter Abruf. Folgt Weiterleitungen manuell, weil sonst die Prüfung nur
 * das erste Ziel abdeckt — eine Umleitung auf 127.0.0.1 wäre der einfachste Weg
 * daran vorbei.
 */
export async function safeFetch(
  raw: string,
  opts: UrlGuardOptions & { timeoutMs?: number } = {},
): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? 3;
  let current = raw;

  for (let i = 0; i <= maxRedirects; i++) {
    const verdict = await checkUrlSafe(current, opts);
    if (!verdict.allowed) throw new Error(`Abruf abgelehnt: ${verdict.reason}`);

    const res = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      headers: { "user-agent": "freedomstack-node/1.0" },
    });

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  throw new Error(`Zu viele Weiterleitungen (>${maxRedirects}).`);
}

/**
 * Antwort hoechstens bis `maxBytes` lesen (8.7) – ein fremder Server darf den
 * Knoten nicht mit einer endlosen Antwort fuellen. Was darueber liegt, wird
 * verworfen und die Verbindung geschlossen.
 */
export async function leseBegrenzt(res: Response, maxBytes: number): Promise<{ text: string; abgeschnitten: boolean }> {
  const leser = res.body?.getReader();
  if (!leser) return { text: "", abgeschnitten: false };
  const teile: Uint8Array[] = [];
  let n = 0;
  let abgeschnitten = false;
  for (;;) {
    const { done, value } = await leser.read();
    if (done) break;
    const rest = maxBytes - n;
    if (value.length > rest) {
      teile.push(value.subarray(0, rest));
      n += rest;
      abgeschnitten = true;
      await leser.cancel().catch(() => undefined);
      break;
    }
    teile.push(value);
    n += value.length;
  }
  const alles = new Uint8Array(n);
  let o = 0;
  for (const t of teile) { alles.set(t, o); o += t.length; }
  return { text: new TextDecoder().decode(alles), abgeschnitten };
}
