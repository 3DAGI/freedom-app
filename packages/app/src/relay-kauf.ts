/**
 * Zugang zu einem Relay kaufen (Schritt 8.4c): beim Relay selbst – NIP-11
 * nennt Preis und Kaufadresse –, bezahlt über die Zahlschienen.
 *
 * Vor dem Zahlen geprueft: Das Angebot nennt den eigenen Schluessel und genau
 * den angekuendigten Preis; eine Rechnung lautet auf diesen Betrag
 * (`leseBolt11`), SOL geht mit einer Referenz an eine Adresse. Nie still in der
 * anderen Waehrung. Bestaetigt der Relay noch nicht, bleibt das Angebot
 * gemerkt und laesst sich spaeter erneut pruefen – bezahlt ist bezahlt.
 */
import { leseBolt11, relayHost, type Beleg, type Zahlanfrage } from "@freedomstack/protocol";
import { t } from "./i18n.js";

/** Relays mit gekauftem Zugang (bis wann) und noch nicht bestaetigte Kaeufe. Kein Geheimnis, aber nur hier. */
export const LS_RELAY_ZUGANG = "freedom.relays.zugang";

export type Schiene = "lightning" | "solana";

export interface RelayPreise {
  tage: number;
  msat?: number;
  lamports?: number;
  kaufUrl: string;
  beschraenkt: boolean;
  umschlaegeGeschuetzt: boolean;
}

export interface Zugang {
  bis?: number;
  offen?: { id: string; kaufUrl: string; signatur?: string };
}

const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ganz = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) > 0;

/** HTTP-Adresse eines Relays (wss → https, ws → http). */
export const httpVon = (relay: string): string => relay.replace(/^ws/, "http").replace(/\/+$/, "");

/** Preise aus NIP-11 – null, wenn der Relay nichts verkauft oder die Kaufadresse nicht bei ihm liegt. */
export async function leseRelayPreise(relay: string, f: typeof fetch = (i, o) => fetch(i, o)): Promise<RelayPreise | null> {
  const host = relayHost(relay);
  if (!host) return null;
  const res = await f(httpVon(relay), { headers: { Accept: "application/nostr+json" }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const info = (await res.json()) as {
    fees?: { subscription?: { amount?: unknown; unit?: unknown; period?: unknown }[] };
    payments_url?: unknown; limitation?: { payment_required?: unknown }; freedom?: { umschlaege_nur_an_angemeldete?: unknown };
  };
  const abos = Array.isArray(info.fees?.subscription) ? info.fees!.subscription! : [];
  const preis = (einheit: string) => abos.find((a) => a.unit === einheit && ganz(a.amount) && ganz(a.period) && (a.period as number) % 86400 === 0);
  const [msat, lamports] = [preis("msat"), preis("lamports")];
  const kaufUrl = typeof info.payments_url === "string" ? info.payments_url : "";
  let kaufHost: string | null = null;
  try {
    kaufHost = new URL(kaufUrl).host.toLowerCase();
  } catch { /* keine Kaufadresse */ }
  // Nur beim Relay selbst kaufen – eine fremde Kaufadresse bekaeme den Schluessel und das Geld
  if ((!msat && !lamports) || kaufHost !== host || !/^https?:$/.test(new URL(kaufUrl).protocol)) return null;
  const perioden = new Set([msat?.period, lamports?.period].filter((p) => p !== undefined));
  if (perioden.size !== 1) return null;
  return {
    tage: ([...perioden][0] as number) / 86400,
    ...(msat ? { msat: msat.amount as number } : {}),
    ...(lamports ? { lamports: lamports.amount as number } : {}),
    kaufUrl: kaufUrl.replace(/\/+$/, ""),
    beschraenkt: info.limitation?.payment_required === true,
    umschlaegeGeschuetzt: info.freedom?.umschlaege_nur_an_angemeldete === true,
  };
}

async function post(f: typeof fetch, url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await f(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  const d = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof d.fehler === "string" ? d.fehler.slice(0, 120) : t("zahl.relayAntwortet", { status: res.status }));
  return d;
}

/** Angebot vor dem Zahlen pruefen – eigener Schluessel, angekuendigter Preis, Rechnung auf genau diesen Betrag. */
export function pruefeAngebot(a: Record<string, unknown>, p: { pubkey: string; schiene: Schiene; preise: RelayPreise }): Zahlanfrage & { id: string } {
  if (typeof a.id !== "string" || !/^[0-9a-f]{32}$/.test(a.id) || a.pubkey !== p.pubkey || a.schiene !== p.schiene) throw new Error(t("zahl.angebotPasstNicht"));
  if (p.schiene === "lightning") {
    if (!p.preise.msat || a.sats !== p.preise.msat / 1000 || typeof a.bolt11 !== "string") throw new Error(t("zahl.angebotAndererPreis"));
    const r = leseBolt11(a.bolt11);
    if (r.betragMsat !== p.preise.msat || r.zahlungsHash !== a.hash) throw new Error(t("zahl.rechnungAndererBetrag"));
    return { id: a.id, ziel: a.bolt11, betrag: { einheit: "msat", wert: p.preise.msat }, zweck: "relay", notiz: "Relay-Zugang" }; // kein UI-Text
  }
  if (!p.preise.lamports || a.lamports !== p.preise.lamports) throw new Error(t("zahl.angebotAndererPreis"));
  if (typeof a.adresse !== "string" || !SOL.test(a.adresse) || typeof a.referenz !== "string" || !SOL.test(a.referenz)) throw new Error(t("zahl.angebotOhneAdresse"));
  return { id: a.id, ziel: a.adresse, betrag: { einheit: "lamports", wert: p.preise.lamports }, zweck: "relay", referenz: a.referenz };
}

/** Beim Relay nachfragen, ob bezahlt ist – einige Male, SOL braucht ein paar Sekunden bis zur Bestaetigung. */
export async function pruefeBeimRelay(
  offen: NonNullable<Zugang["offen"]>,
  p: { f?: typeof fetch; warte?: (ms: number) => Promise<void>; versuche?: number } = {},
): Promise<{ bis: number } | null> {
  const f = p.f ?? ((i, o) => fetch(i, o));
  const warte = p.warte ?? ((ms) => new Promise((ok) => setTimeout(ok, ms)));
  for (let i = 0; i < (p.versuche ?? 6); i++) {
    if (i > 0) await warte(2500);
    const d = await post(f, `${offen.kaufUrl}/${offen.id}`, offen.signatur ? { signatur: offen.signatur } : {});
    if (d.bezahlt === true && ganz(d.bis)) return { bis: d.bis };
  }
  return null;
}

/**
 * Kaufen: Angebot holen und pruefen, ueber die Zahlschienen zahlen, dann
 * bestaetigen lassen. `merke` legt das Angebot ab, BEVOR gezahlt wird, und
 * danach den Beleg – so geht keine Zahlung verloren.
 */
export async function kaufeRelayZugang(p: {
  relay: string; schiene: Schiene; pubkey: string; preise: RelayPreise;
  zahle: (a: Zahlanfrage) => Promise<Beleg>;
  merke: (z: Zugang) => void;
  f?: typeof fetch; warte?: (ms: number) => Promise<void>;
}): Promise<{ bis: number } | null> {
  const f = p.f ?? ((i, o) => fetch(i, o));
  const angebot = pruefeAngebot(await post(f, p.preise.kaufUrl, { pubkey: p.pubkey, schiene: p.schiene }), p);
  const { id, ...anfrage } = angebot;
  const offen = { id, kaufUrl: p.preise.kaufUrl };
  p.merke({ offen });
  const beleg = await p.zahle(anfrage);
  const mitBeleg = { ...offen, ...(p.schiene === "solana" ? { signatur: beleg.ref } : {}) };
  p.merke({ offen: mitBeleg });
  const r = await pruefeBeimRelay(mitBeleg, { f, warte: p.warte });
  if (r) p.merke({ bis: r.bis });
  return r;
}

/** Gemerkte Zugaenge (localStorage) – je Relay. */
export function zugaenge(s: Pick<Storage, "getItem">): Record<string, Zugang> {
  try {
    const d = JSON.parse(s.getItem(LS_RELAY_ZUGANG) ?? "{}") as unknown;
    return typeof d === "object" && d !== null && !Array.isArray(d) ? (d as Record<string, Zugang>) : {};
  } catch {
    return {};
  }
}

export function merkeZugang(s: Pick<Storage, "getItem" | "setItem">, relay: string, z: Zugang): void {
  const alle = zugaenge(s);
  alle[relay] = z.bis ? { bis: z.bis } : { ...alle[relay], ...z };
  s.setItem(LS_RELAY_ZUGANG, JSON.stringify(alle));
}
