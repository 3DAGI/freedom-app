/**
 * Selbstprüfung eines Provider-Knotens (Schritt 8.2a): Kann er in beiden
 * Schienen verdienen?
 *
 * - Lightning: Die App holt die Rechnung für den Anteil des Providers über
 *   seine Lightning-Adresse (LNURL-pay, aus dem Browser). Geprüft wird, was
 *   die App dafür braucht: `payRequest` mit https-Callback, CORS, ein
 *   Mindestbetrag, der kleine Anteile nicht abweist – und eine echte
 *   Rechnung über den kleinsten Betrag (unbezahlt, sie verfällt).
 * - SOL: Zahlkanal an und Schlüssel passend (`kanalKasseAusUmgebung()`),
 *   Programm auf der Kette, etwas SOL für die Gebühren der Einlösungen,
 *   Auszahlung an die eigene Adresse (4.5a).
 *
 * Nach außen nur eigene Texte und Fehlernamen – nie Antworten fremder Server.
 * Aufgerufen beim Start (`main.ts`) und über `npm run pruefen` (Installer).
 */
import { adresseFuer, leseBolt11 } from "@freedomstack/protocol";
import { teiltSchluessel, type kanalKasseAusUmgebung, type KanalUmgebung } from "./kanal-kasse.js";
import { MIN_RUECKLAGE } from "./sol-auszahlung.js";

export type Stufe = "ok" | "hinweis" | "fehler";
export interface Befund { schiene: "lightning" | "sol"; stufe: Stufe; text: string }

/** Ab diesem Mindestbetrag (msat) weist die Lightning-Adresse kleine Anteile ab. */
export const KLEINSTER_ANTEIL_MSAT = 1_000;

export interface Antwort { status: number; cors: string | null; json: unknown }

export interface PruefHilfen {
  /** HTTP-GET mit JSON-Antwort und der Kopfzeile Access-Control-Allow-Origin. */
  holen(url: string): Promise<Antwort>;
  /** Ergebnis von `kanalKasseAusUmgebung()` – beim Start schon vorhanden. */
  kanal: Awaited<ReturnType<typeof kanalKasseAusUmgebung>>;
  /** Blick auf die Kette; ohne ihn entfallen die Prüfungen dort. */
  kette?: {
    programmBereit(): Promise<boolean>;
    guthaben(adresse: string): Promise<bigint>;
    istProgramm(adresse: string): Promise<boolean>;
  };
}

const fehlerName = (e: unknown): string => (e instanceof Error && e.name) || "Fehler";
const sol = (l: bigint): string => (Number(l) / 1e9).toLocaleString("de-DE", { maximumFractionDigits: 6 });

export async function pruefeLightning(lud16: string | undefined, holen: PruefHilfen["holen"]): Promise<Befund[]> {
  const b = (stufe: Stufe, text: string): Befund => ({ schiene: "lightning", stufe, text });
  const adresse = lud16 ? adresseFuer({ lud16 }, "lightning") : undefined;
  if (!adresse) {
    return [b("fehler", lud16 ? "NODE_LUD16 ist keine Lightning-Adresse (name@domain)" : "NODE_LUD16 fehlt – ohne Lightning-Adresse startet der Knoten nicht")];
  }
  const [name, host] = adresse.split("@") as [string, string];
  const aus: Befund[] = [];
  let d: { tag?: unknown; callback?: unknown; minSendable?: unknown; maxSendable?: unknown };
  try {
    const r = await holen(`https://${host}/.well-known/lnurlp/${encodeURIComponent(name)}`);
    if (r.status !== 200) return [b("fehler", `${adresse} antwortet mit HTTP ${r.status}`)];
    if (r.cors !== "*") aus.push(b("hinweis", `${adresse} erlaubt keine Abfrage aus dem Browser (CORS) – die App kann dort keine Rechnung holen`));
    d = (r.json ?? {}) as typeof d;
  } catch (e) {
    return [b("fehler", `${adresse} nicht erreichbar (${fehlerName(e)})`)];
  }
  if (d.tag !== "payRequest" || typeof d.callback !== "string" || !d.callback.startsWith("https://")) {
    return [...aus, b("fehler", `${adresse} ist keine LNURL-pay-Adresse mit https-Callback`)];
  }
  const min = Number(d.minSendable), max = Number(d.maxSendable);
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 1 || max < min) {
    return [...aus, b("fehler", `${adresse} nennt keine gültigen Beträge`)];
  }
  if (min > KLEINSTER_ANTEIL_MSAT) {
    aus.push(b("hinweis", `${adresse} nimmt erst ab ${Math.ceil(min / 1000)} sats an – kleinere Anteile kommen nicht an`));
  }
  // Eine echte Rechnung über den kleinsten Betrag – unbezahlt, sie verfällt
  const betrag = Math.max(min, KLEINSTER_ANTEIL_MSAT);
  if (betrag > max) return [...aus, b("fehler", `${adresse} nimmt ${Math.ceil(betrag / 1000)} sats nicht an`)];
  try {
    const cb = new URL(d.callback);
    cb.searchParams.set("amount", String(betrag));
    const r = await holen(cb.toString());
    const pr = (r.json as { pr?: unknown } | null)?.pr;
    if (r.status !== 200 || typeof pr !== "string") return [...aus, b("fehler", `${adresse} stellt keine Rechnung aus`)];
    if (leseBolt11(pr).betragMsat !== betrag) return [...aus, b("fehler", `${adresse} stellt eine Rechnung über einen anderen Betrag aus`)];
  } catch (e) {
    return [...aus, b("fehler", `${adresse} stellt keine gültige Rechnung aus (${fehlerName(e)})`)];
  }
  return [...aus, b("ok", `${adresse} stellt Rechnungen aus (${Math.ceil(min / 1000)} bis ${Math.floor(max / 1000)} sats)`)];
}

export async function pruefeSol(env: KanalUmgebung, h: Pick<PruefHilfen, "kanal" | "kette">): Promise<Befund[]> {
  const b = (stufe: Stufe, text: string): Befund => ({ schiene: "sol", stufe, text });
  const { kasse, grund, auszahlungGrund } = h.kanal;
  if (!kasse) {
    // Ohne ZAHLKANAL=1 ist das eine Wahl, sonst ein Fehler in der Einrichtung
    return [b(env.ZAHLKANAL === "1" ? "fehler" : "hinweis", `Zahlkanal ${grund} – Kunden zahlen dann nur mit Lightning`)];
  }
  const adresse = env.NODE_SOL_ADDRESS!;
  const aus = [b("ok", `Zahlkanal an, Adresse des Knotens ${adresse}`)];
  if (h.kette) {
    try {
      if (!(await h.kette.programmBereit())) aus.push(b("hinweis", "Das Kanal-Programm liegt auf dieser Kette noch nicht – Kunden können noch keine Kanäle öffnen"));
      const g = await h.kette.guthaben(adresse);
      aus.push(g < MIN_RUECKLAGE
        ? b("hinweis", `Die Adresse des Knotens hat ${sol(g)} SOL – für die Gebühren der Einlösungen braucht sie mindestens ${sol(MIN_RUECKLAGE)} SOL`)
        : b("ok", `Guthaben der Adresse des Knotens: ${sol(g)} SOL`));
    } catch (e) {
      aus.push(b("hinweis", `Kette nicht erreichbar (${fehlerName(e)}) – Programm und Guthaben ungeprüft`));
    }
  }
  if (!auszahlungGrund) {
    const an = env.NODE_SOL_PAYOUT!;
    const programm = await h.kette?.istProgramm(an).catch(() => false);
    aus.push(programm ? b("fehler", `NODE_SOL_PAYOUT ${an} ist ein Programm – dorthin zahlt der Knoten nicht aus`) : b("ok", `Auszahlung an ${an}`));
  } else if (!env.NODE_SOL_PAYOUT || teiltSchluessel(env)) {
    aus.push(b("hinweis", `Auszahlung ${auszahlungGrund} – Eingelöstes bleibt auf dem Schlüssel des Knotens`));
  } else {
    aus.push(b("fehler", `Auszahlung: ${auszahlungGrund}`));
  }
  return aus;
}

export async function pruefeEinrichtung(env: KanalUmgebung & { NODE_LUD16?: string }, h: PruefHilfen): Promise<Befund[]> {
  const [ln, so] = await Promise.all([pruefeLightning(env.NODE_LUD16, h.holen), pruefeSol(env, h)]);
  return [...ln, ...so];
}

const ZEICHEN: Record<Stufe, string> = { ok: "✓", hinweis: "!", fehler: "✗" };

export function befundeText(befunde: readonly Befund[]): string {
  return befunde.map((x) => `${ZEICHEN[x.stufe]} ${x.schiene === "lightning" ? "Lightning" : "SOL"}: ${x.text}`).join("\n");
}

/** `fetch` mit Zeitgrenze – nur Status, CORS-Kopfzeile und JSON. */
export async function holeJson(url: string, zeitMs = 10_000): Promise<Antwort> {
  const r = await fetch(url, { signal: AbortSignal.timeout(zeitMs), redirect: "error" });
  const json = await r.json().catch(() => null);
  return { status: r.status, cors: r.headers.get("access-control-allow-origin"), json };
}

/**
 * Blick auf die Kette für die Prüfung – Programm, Guthaben, ist eine Adresse
 * ein Programm. Wirft bei unbrauchbarem Endpunkt; dann ohne Kette prüfen.
 */
export async function kettenBlick(rpcUrl: string): Promise<NonNullable<PruefHilfen["kette"]>> {
  const { Connection, PublicKey } = await import("@solana/web3.js");
  const { KANAL_PROGRAMM_ID } = await import("@freedomstack/protocol");
  const conn = new Connection(rpcUrl, "confirmed");
  const ausfuehrbar = async (a: string) => (await conn.getAccountInfo(new PublicKey(a), "confirmed"))?.executable === true;
  return {
    programmBereit: () => ausfuehrbar(KANAL_PROGRAMM_ID),
    guthaben: async (a) => BigInt(await conn.getBalance(new PublicKey(a), "confirmed")),
    istProgramm: ausfuehrbar,
  };
}
