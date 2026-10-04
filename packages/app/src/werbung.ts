/**
 * Werben nach A+ (Schritt 5.1.3b), ohne DOM.
 *
 * Der Werbelink trägt neben dem Schlüssel die Lightning-Adresse des Werbers
 * (`?ref=<pk>&ln=<lud16>`). Die App des Geworbenen merkt sich beides und zahlt
 * ihm 0,5 % jeder KI-Zahlung direkt – ohne dass die Beziehung öffentlich wird.
 * Öffentlich nennen bleibt freiwillig und zählt nur für die
 * Statistik (8.1b). Es gilt der erste Werber; ein später geöffneter fremder
 * Link verdrängt ihn nicht.
 *
 * Seit 12.2 (E1 A) trägt er auch eine SOL-Adresse (`&sol=`): eine frische aus
 * der eingebauten Wallet, je Kette einmal vergeben und dann immer dieselbe – so
 * kommt der Anteil auch bei Zahlungen per Zahlkanal an, und die Hauptadresse
 * steht nicht im öffentlichen Link. Nichts verwahrt ein Dritter.
 *
 * Seit 11.2b darf statt des Schlüssels ein kurzer Name stehen
 * (`?ref=name@domain`, auf der Domain des Namens `?ref=name`). Er gilt erst mit
 * dem Schlüssel, den die Domain nach NIP-05 dafür nennt; gefragt wird genau
 * einmal (`loeseWerberName()`), denn die Abfrage nennt der Domain die IP.
 */
import {
  adresseFuer, leseNip05, nip05Text,
  type Nip05Ergebnis, type Nip05Fall, type Nip05Kennung, type Zahlziel,
} from "@freedomstack/protocol";

export const LS_WERBER = "freedom.referrer";
export const LS_WERBER_LN = "freedom.referrer.ln";
/** SOL-Adresse des eigenen Werbers aus dem Link (12.2). */
export const LS_WERBER_SOL = "freedom.referrer.sol";
/** Eigene SOL-Adresse für den Werbelink, je Kette (12.2) – über `geheim` (Präfix der Wallet). */
export const LS_WERBE_SOL = "freedom.solWallet.werbelink";
/** Name aus einem Werbelink, noch nicht aufgelöst – nie gesichert, beim Start einmal gefragt. */
export const LS_WERBER_NAME = "freedom.referrer.name";
/** Eigener geprüfter Name für den Werbelink samt Schlüssel, für den er galt (11.2b). */
export const LS_WERBE_NAME = "freedom.werben.name";

type Speicher = Pick<Storage, "getItem" | "setItem">;
const HEX64 = /^[0-9a-f]{64}$/;

/** Werbelink: Schlüssel oder Name, dazu Lightning- und SOL-Adresse – nur plausible. */
export function werbeLink(basis: string, ref: string, lud16?: string, sol?: string): string {
  const url = new URL(basis);
  url.search = "";
  url.hash = "";
  url.searchParams.set("ref", ref);
  const ln = adresseFuer({ lud16 }, "lightning");
  if (ln) url.searchParams.set("ln", ln);
  const solAdresse = adresseFuer({ sol }, "solana");
  if (solAdresse) url.searchParams.set("sol", solAdresse);
  return url.toString();
}

type AsyncSpeicher = { getItem(k: string): string | null; setItem(k: string, v: string): unknown };

/**
 * Eigene SOL-Adresse für den Werbelink (12.2, E1 A): je Kette eine frische aus
 * der eingebauten Wallet, danach immer dieselbe. Ohne eingebaute Wallet keine.
 */
export async function werbeSolAdresse(s: AsyncSpeicher, kette: string, frisch: () => Promise<string | undefined>): Promise<string | undefined> {
  let m: Record<string, unknown> = {};
  try { m = (JSON.parse(s.getItem(LS_WERBE_SOL) ?? "{}") ?? {}) as Record<string, unknown>; } catch { /* neu anlegen */ }
  const da = adresseFuer({ sol: typeof m[kette] === "string" ? m[kette] as string : undefined }, "solana");
  if (da) return da;
  const neu = adresseFuer({ sol: await frisch() }, "solana");
  if (neu) await s.setItem(LS_WERBE_SOL, JSON.stringify({ ...m, [kette]: neu }));
  return neu;
}

/**
 * Werber aus dem Link merken (Suchteil der Adresse). Nie überschreiben; die
 * Adresse nur zum selben Werber und nur, solange noch keine gemerkt ist.
 */
export function merkeWerber(suche: string, s: Speicher, herkunft?: string): void {
  const q = new URLSearchParams(suche);
  const ref = q.get("ref");
  if (!ref) return;
  if (!HEX64.test(ref)) return merkeWerberName(ref, q.get("ln"), q.get("sol"), s, herkunft);
  const gemerkt = s.getItem(LS_WERBER);
  if (gemerkt && gemerkt !== ref) return;
  if (!gemerkt) s.setItem(LS_WERBER, ref);
  const ln = adresseFuer({ lud16: q.get("ln") ?? undefined }, "lightning");
  if (ln && !s.getItem(LS_WERBER_LN)) s.setItem(LS_WERBER_LN, ln);
  const sol = adresseFuer({ sol: q.get("sol") ?? undefined }, "solana");
  if (sol && !s.getItem(LS_WERBER_SOL)) s.setItem(LS_WERBER_SOL, sol);
}

/** Wohin der Anteil des Werbers geht – nicht an sich selbst, nie ohne Werber. */
export function werberZahlziel(s: Pick<Storage, "getItem">, ich?: string): Zahlziel | undefined {
  const werber = s.getItem(LS_WERBER);
  if (!werber || werber === ich) return undefined;
  const lud16 = adresseFuer({ lud16: s.getItem(LS_WERBER_LN) ?? undefined }, "lightning");
  const sol = adresseFuer({ sol: s.getItem(LS_WERBER_SOL) ?? undefined }, "solana");
  return lud16 || sol ? { ...(lud16 ? { lud16 } : {}), ...(sol ? { sol } : {}) } : undefined;
}

/**
 * Name aus dem Link vormerken (11.2b) – nur, solange es keinen Werber gibt.
 * Ohne @ gilt die Domain, von der die App geladen wurde (`herkunft`).
 */
function merkeWerberName(ref: string, ln: string | null, sol: string | null, s: Speicher, herkunft?: string): void {
  if (s.getItem(LS_WERBER) || s.getItem(LS_WERBER_NAME)) return;
  const k = leseNip05(ref.includes("@") ? ref : herkunft ? `${ref}@${herkunft}` : "");
  if (!k) return;
  const adresse = adresseFuer({ lud16: ln ?? undefined }, "lightning");
  const solAdresse = adresseFuer({ sol: sol ?? undefined }, "solana");
  s.setItem(LS_WERBER_NAME, JSON.stringify({ name: nip05Text(k), ...(adresse ? { ln: adresse } : {}), ...(solAdresse ? { sol: solAdresse } : {}) }));
}

export type WerberNameAusgang = "kein" | "schon-werber" | "gemerkt" | Nip05Fall;

/**
 * Den vorgemerkten Namen einmal auflösen: Die Abfrage nennt der Domain die IP
 * (Datenschutzbericht „werbe-name“), deshalb ist er danach vergessen – gleich,
 * wie sie ausgeht. Der erste Werber bleibt; die Lightning-Adresse kommt aus
 * dem Link, sonst aus dem signierten Profil des Werbers.
 */
export async function loeseWerberName(
  s: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  loese: (k: Nip05Kennung) => Promise<Nip05Ergebnis>,
  profilLn: (pk: string) => Promise<string | undefined>,
): Promise<WerberNameAusgang> {
  const roh = s.getItem(LS_WERBER_NAME);
  if (roh === null) return "kein";
  s.removeItem(LS_WERBER_NAME);
  let vorgemerkt: { name?: unknown; ln?: unknown; sol?: unknown };
  try {
    vorgemerkt = JSON.parse(roh) as typeof vorgemerkt;
  } catch {
    return "ungueltig";
  }
  const k = typeof vorgemerkt.name === "string" ? leseNip05(vorgemerkt.name) : undefined;
  if (!k) return "ungueltig";
  if (s.getItem(LS_WERBER)) return "schon-werber";
  const r = await loese(k);
  if (!r.ok) return r.fall;
  if (s.getItem(LS_WERBER)) return "schon-werber";
  s.setItem(LS_WERBER, r.pubkey);
  const ausLink = adresseFuer({ lud16: typeof vorgemerkt.ln === "string" ? vorgemerkt.ln : undefined }, "lightning");
  const ln = ausLink ?? adresseFuer({ lud16: await profilLn(r.pubkey).catch(() => undefined) }, "lightning");
  if (ln && !s.getItem(LS_WERBER_LN)) s.setItem(LS_WERBER_LN, ln);
  // SOL nur aus dem Link – das Profilfeld `sol` steht dort nur nach Warnung (4.9d)
  const sol = adresseFuer({ sol: typeof vorgemerkt.sol === "string" ? vorgemerkt.sol : undefined }, "solana");
  if (sol && !s.getItem(LS_WERBER_SOL)) s.setItem(LS_WERBER_SOL, sol);
  return "gemerkt";
}

/** Eigenen Namen merken – nur nachdem die Domain ihn zu genau diesem Schlüssel aufgelöst hat. */
export function merkeWerbeName(s: Pick<Storage, "setItem">, k: Nip05Kennung, pk: string): void {
  s.setItem(LS_WERBE_NAME, JSON.stringify({ name: nip05Text(k), pk }));
}

/** Der gemerkte eigene Name – nur für den Schlüssel, für den er geprüft wurde. */
export function eigenerWerbeName(s: Pick<Storage, "getItem">, pk?: string): Nip05Kennung | undefined {
  try {
    const p = JSON.parse(s.getItem(LS_WERBE_NAME) ?? "null") as { name?: unknown; pk?: unknown } | null;
    if (!p || typeof p.name !== "string" || (pk !== undefined && p.pk !== pk)) return undefined;
    return leseNip05(p.name);
  } catch {
    return undefined;
  }
}

/** Was im Link als Werber steht: der eigene Name, sonst der Schlüssel; auf seiner Domain nur der Teil vor dem @. */
export function werbeRef(s: Pick<Storage, "getItem">, pk: string, basis: string): string {
  const k = eigenerWerbeName(s, pk);
  if (!k) return pk;
  return new URL(basis).hostname.toLowerCase() === k.domain ? k.name : nip05Text(k);
}
