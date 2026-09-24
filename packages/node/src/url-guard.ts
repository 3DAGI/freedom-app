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

export interface UrlGuardOptions {
  /** Nur diese Hosts erlauben. Leer = alle öffentlichen Hosts. */
  allowHosts?: string[];
  /** Private Ziele zulassen — ausschließlich für lokale Tests. */
  allowPrivate?: boolean;
  maxRedirects?: number;
}

/** Prüft, ob eine IPv4-Adresse in einem nicht-öffentlichen Bereich liegt. */
export function isPrivateIPv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 10) return true;                        // 10.0.0.0/8
  if (a === 127) return true;                       // Loopback
  if (a === 0) return true;                         // "dieses Netz"
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true;          // 192.168.0.0/16
  if (a === 169 && b === 254) return true;          // Link-local INKL. Cloud-Metadaten
  if (a === 100 && b >= 64 && b <= 127) return true;// CGNAT
  if (a >= 224) return true;                        // Multicast + reserviert
  return false;
}

/** Dasselbe für IPv6, inklusive der eingebetteten IPv4-Formen. */
export function isPrivateIPv6(ip: string): boolean {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (s === "::1" || s === "::") return true;
  // IPv4-mapped (::ffff:127.0.0.1) und IPv4-compatible: innere Adresse prüfen.
  const embedded = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (embedded) return isPrivateIPv4(embedded[1]);
  if (/^f[cd]/.test(s)) return true;   // fc00::/7 unique local
  if (/^fe[89ab]/.test(s)) return true; // fe80::/10 link-local
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  return ip.includes(":") ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
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
    const { lookup } = await import("node:dns/promises");
    const records = await lookup(host, { all: true });
    const addresses = records.map((r) => r.address);
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
