/**
 * NIP-05: kurzer Name statt Schlüssel (Schritt 11.2b), ohne DOM.
 *
 * `name@domain` steht für den Schlüssel, den
 * `https://domain/.well-known/nostr.json?name=name` unter `names[name]` nennt.
 * Ein Name ist nur ein Verweis: Er gilt erst mit dem Schlüssel, den die
 * Domain dafür nennt – und die Abfrage nennt der Domain die eigene
 * IP-Adresse. Deshalb nur https, nur öffentliche DNS-Namen (keine IP, nichts
 * Lokales), Weiterleitungen nicht folgen (verlangt NIP-05), Antwort begrenzt,
 * Schlüssel nur als 64 Zeichen Hex. Nie geworfen – jeder Ausgang ist ein Fall.
 */

export interface Nip05Kennung {
  /** Teil vor dem @, klein geschrieben; `_` ist der Name der Domain selbst. */
  name: string;
  domain: string;
}

/** Größte Antwort, die gelesen wird – manche Dienste liefern alle Namen auf einmal. */
export const NIP05_MAX_BYTES = 256 * 1024;

export type Nip05Fall = "nicht-erreichbar" | "zu-gross" | "ungueltig" | "unbekannt";
export type Nip05Ergebnis = { ok: true; pubkey: string } | { ok: false; fall: Nip05Fall };

const NAME = /^[a-z0-9._-]{1,64}$/;
const TEIL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Öffentlicher DNS-Name: mindestens zwei Teile, keine IP-Adresse, nichts Lokales. */
export function oeffentlicheDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  if (d.length > 253) return false;
  const teile = d.split(".");
  if (teile.length < 2 || !teile.every((t) => TEIL.test(t))) return false;
  const letzter = teile[teile.length - 1];
  if (/^\d+$/.test(letzter)) return false; // IPv4 oder ähnlich
  return letzter !== "localhost" && letzter !== "local";
}

/** `name@domain` lesen – klein geschrieben, sonst `undefined`. */
export function leseNip05(eingabe: string): Nip05Kennung | undefined {
  const s = eingabe.trim().toLowerCase();
  const at = s.indexOf("@");
  if (at <= 0 || s.indexOf("@", at + 1) !== -1) return undefined;
  const name = s.slice(0, at);
  const domain = s.slice(at + 1);
  return NAME.test(name) && oeffentlicheDomain(domain) ? { name, domain } : undefined;
}

export function nip05Text(k: Nip05Kennung): string {
  return `${k.name}@${k.domain}`;
}

/** Die einzige Adresse, die gefragt wird. */
export function nip05Adresse(k: Nip05Kennung): string {
  return `https://${k.domain}/.well-known/nostr.json?name=${encodeURIComponent(k.name)}`;
}

type Holen = (url: string, init: RequestInit) => Promise<Response>;
const holenStandard: Holen = (url, init) => fetch(url, init);

/** Text höchstens `max` Byte – sonst `undefined`, ohne den Rest zu lesen. */
async function leseHoechstens(r: Response, max: number): Promise<string | undefined> {
  if (Number(r.headers.get("content-length") ?? 0) > max) return undefined;
  if (!r.body) return undefined;
  const leser = r.body.getReader();
  const stuecke: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await leser.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      void leser.cancel().catch(() => undefined);
      return undefined;
    }
    stuecke.push(value);
  }
  const alles = new Uint8Array(n);
  let i = 0;
  for (const s of stuecke) {
    alles.set(s, i);
    i += s.byteLength;
  }
  return new TextDecoder().decode(alles);
}

/** Schlüssel zum Namen – nur, was die Domain selbst unter genau diesem Namen nennt. */
export async function loeseNip05(k: Nip05Kennung, holen: Holen = holenStandard): Promise<Nip05Ergebnis> {
  let r: Response;
  try {
    r = await holen(nip05Adresse(k), {
      redirect: "error",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, fall: "nicht-erreichbar" };
  }
  if (!r.ok || r.redirected || r.type === "opaqueredirect") return { ok: false, fall: "nicht-erreichbar" };
  let text: string | undefined;
  try {
    text = await leseHoechstens(r, NIP05_MAX_BYTES);
  } catch {
    return { ok: false, fall: "nicht-erreichbar" };
  }
  if (text === undefined) return { ok: false, fall: "zu-gross" };
  let daten: unknown;
  try {
    daten = JSON.parse(text);
  } catch {
    return { ok: false, fall: "ungueltig" };
  }
  const namen = (daten as { names?: unknown } | null)?.names;
  if (!namen || typeof namen !== "object" || Array.isArray(namen)) return { ok: false, fall: "ungueltig" };
  if (!Object.hasOwn(namen, k.name)) return { ok: false, fall: "unbekannt" };
  const pk = (namen as Record<string, unknown>)[k.name];
  if (typeof pk !== "string" || !/^[0-9a-f]{64}$/.test(pk)) return { ok: false, fall: "ungueltig" };
  return { ok: true, pubkey: pk };
}
