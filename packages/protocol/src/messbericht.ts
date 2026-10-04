/**
 * Messbericht der Freedom-Prüfung (Kind 38081, E7, `docs/FREEDOM-PRUEFUNG.md`),
 * Schritt P1b – ohne DOM, ohne Netz.
 *
 * Ein Prüfer stellt Providern synthetische Prüffragen (`pruefung.ts`) und
 * veröffentlicht je Provider und Modell einen ersetzbaren Bericht: Zeitraum,
 * Anfragen und Erfolge, Median der Antwortzeit, Durchsatz, Treffer je Prüfart,
 * Stufe. Keine Prüffragen, keine Antworten, nichts über Kunden. Eine Rangliste
 * veröffentlicht niemand – die Rangfolge bildet jede App selbst.
 */
import { type NostrEvent, type UnsignedEvent, buildEvent, getTag, verifyEvent } from "./event.js";
import { PRUEF_ARTEN, PRUEF_GRENZEN, PRUEF_STUFEN, stufeAus, type PruefArt, type Stufe } from "./pruefung.js";

/** Messbericht eines Prüfers je Provider und Modell (ersetzbar, `d` = `<provider>:<modell>`). */
export const KIND_MESSBERICHT = 38081;
/** So lange gilt ein Messbericht (Sekunden, NIP-40). */
export const BERICHT_GUELTIG_SEK = 7_200;

export interface Messbericht {
  pruefer: string;
  provider: string;
  modell: string;
  von: number;
  bis: number;
  anfragen: number;
  erfolge: number;
  medianMs: number;
  /** Durchsatz (Tokens je Sekunde), falls der Provider `usage` nennt. */
  tokensJeSek?: number;
  /** Je Prüfart: geprüfte Antworten und davon richtig. */
  treffer: Partial<Record<PruefArt, { richtig: number; geprueft: number }>>;
  stufe: Stufe;
  zeit: number;
}

const HEX64 = /^[0-9a-f]{64}$/;
const ZAHL = /^(0|[1-9]\d{0,9})$/;
const MODELL = /^[\x21-\x7e]{1,100}$/;

/** Trefferquote über alle Prüfarten (0..1) – undefiniert ohne geprüfte Antwort. */
export function trefferQuote(m: Pick<Messbericht, "treffer">): number | undefined {
  const t = Object.values(m.treffer);
  const geprueft = t.reduce((s, x) => s + (x?.geprueft ?? 0), 0);
  return geprueft > 0 ? t.reduce((s, x) => s + (x?.richtig ?? 0), 0) / geprueft : undefined;
}

/** Unsigniert – der Prüfer signiert mit seinem eigenen Schlüssel. */
export function baueMessbericht(m: Omit<Messbericht, "pruefer" | "zeit">, pruefer: string, jetzt: number): UnsignedEvent {
  if (!HEX64.test(m.provider) || !MODELL.test(m.modell)) throw new Error("Messbericht: Provider oder Modell ungültig");
  const arten = Object.entries(m.treffer) as [PruefArt, { richtig: number; geprueft: number }][];
  const zahlen = [m.von, m.bis, m.anfragen, m.erfolge, m.medianMs, ...(m.tokensJeSek === undefined ? [] : [m.tokensJeSek]), ...arten.flatMap(([, t]) => [t.richtig, t.geprueft])];
  if (zahlen.some((n) => !Number.isSafeInteger(n) || n < 0)) throw new Error("Messbericht: keine ganze Zahl");
  if (m.erfolge > m.anfragen || m.von > m.bis || arten.some(([art, t]) => !PRUEF_ARTEN.includes(art) || t.richtig > t.geprueft)) {
    throw new Error("Messbericht: Zahlen passen nicht");
  }
  return buildEvent(pruefer, KIND_MESSBERICHT, [
    ["d", `${m.provider}:${m.modell}`],
    ["p", m.provider],
    ["modell", m.modell],
    ["zeitraum", String(m.von), String(m.bis)],
    ["anfragen", String(m.anfragen), String(m.erfolge)],
    ["median_ms", String(m.medianMs)],
    ...(m.tokensJeSek === undefined ? [] : [["tokens_s", String(m.tokensJeSek)]]),
    ...PRUEF_ARTEN.filter((a) => m.treffer[a]).map((a) => ["treffer", a, String(m.treffer[a]!.richtig), String(m.treffer[a]!.geprueft)]),
    ["stufe", m.stufe],
    ["expiration", String(jetzt + BERICHT_GUELTIG_SEK)],
  ], "", jetzt);
}

/** Bericht lesen – null bei falscher Signatur, kaputten Zahlen, abgelaufen oder unpassendem `d`. */
export function leseMessbericht(ev: NostrEvent, jetzt: number): Messbericht | null {
  if (ev.kind !== KIND_MESSBERICHT || !verifyEvent(ev)) return null;
  const tag = (n: string) => ev.tags.find((t) => t[0] === n);
  const zahl = (s: string | undefined) => (s !== undefined && ZAHL.test(s) ? Number(s) : NaN);
  const provider = getTag(ev, "p") ?? "";
  const modell = getTag(ev, "modell") ?? "";
  const ablauf = zahl(getTag(ev, "expiration"));
  if (!HEX64.test(provider) || !MODELL.test(modell) || getTag(ev, "d") !== `${provider}:${modell}`) return null;
  if (!(ablauf > jetzt)) return null;
  const [von, bis] = [zahl(tag("zeitraum")?.[1]), zahl(tag("zeitraum")?.[2])];
  const [anfragen, erfolge] = [zahl(tag("anfragen")?.[1]), zahl(tag("anfragen")?.[2])];
  const medianMs = zahl(getTag(ev, "median_ms"));
  const tokensTag = getTag(ev, "tokens_s");
  const tokensJeSek = tokensTag === undefined ? undefined : zahl(tokensTag);
  const stufe = getTag(ev, "stufe") as Stufe | undefined;
  if ([von, bis, anfragen, erfolge, medianMs, tokensJeSek ?? 0].some((n) => !Number.isFinite(n))) return null;
  if (erfolge > anfragen || von > bis || !stufe || !PRUEF_STUFEN.includes(stufe)) return null;
  // Je Prüfart höchstens ein Tag; unbekannte Arten (neuere Prüfer) zählen nicht, kaputte Zahlen verwerfen den Bericht
  const treffer: Messbericht["treffer"] = {};
  for (const t of ev.tags.filter((x) => x[0] === "treffer")) {
    const art = t[1] as PruefArt;
    if (!PRUEF_ARTEN.includes(art)) continue;
    const [richtig, geprueft] = [zahl(t[2]), zahl(t[3])];
    if (!Number.isFinite(richtig) || !Number.isFinite(geprueft) || richtig > geprueft || treffer[art]) return null;
    treffer[art] = { richtig, geprueft };
  }
  return {
    pruefer: ev.pubkey, provider, modell, von, bis, anfragen, erfolge, medianMs,
    ...(tokensJeSek === undefined ? {} : { tokensJeSek }), treffer, stufe, zeit: ev.created_at,
  };
}

// ------------------------------------------------------------ lesen in der App (P2b)

/**
 * Standard-Prüfer des Projekts (E7, „Freedom-Prüfer“) – leer, bis der MENSCH
 * den Schlüssel einträgt (wie `TRUSTED_SIGNERS`). Weitere wählt der Nutzer.
 */
export const FREEDOM_PRUEFER: readonly string[] = [
  // VOR DEM RELEASE SETZEN: Pubkey des Freedom-Prüfers (MENSCH, nach P3).
];

/** Abfrage aller Messberichte – nie nach Prüfer gefiltert: Ein Filter verriete den Relays, wem die App folgt (wie bei den Katalogen, 5.7). */
export function messberichtFilter(limit = 500): { kinds: number[]; limit: number } {
  return { kinds: [KIND_MESSBERICHT], limit };
}

/** Stand eines Providers aus den Berichten der gewählten Prüfer. */
export interface PruefStand {
  anfragen: number;
  erfolge: number;
  /** Aus den Zahlen neu gerechnet (`stufeAus()`, ab `PRUEF_GRENZEN.minPruefer`) – nicht die Stufe aus dem Bericht. */
  stufe: Stufe;
  /** Trefferquote über alle Prüfarten und Modelle (0..1). */
  qualitaet?: number;
  /** Median der Mediane der Berichte. */
  medianMs?: number;
  /** Von wie vielen Prüfern. */
  pruefer: number;
}

/**
 * Je Provider der Stand aus den Berichten der gewählten Prüfer: je Prüfer,
 * Provider und Modell der neueste gültige Bericht (`leseMessbericht()`),
 * Anfragen, Erfolge und Treffer summiert. Berichte anderer Prüfer zählen nicht.
 */
export function pruefStaende(events: readonly NostrEvent[], pruefer: readonly string[], jetzt: number): Map<string, PruefStand> {
  const gewaehlt = new Set(pruefer);
  const neueste = new Map<string, Messbericht>();
  for (const ev of events) {
    if (!gewaehlt.has(ev.pubkey)) continue;
    const m = leseMessbericht(ev, jetzt);
    if (!m) continue;
    const schluessel = `${m.pruefer}:${m.provider}:${m.modell}`;
    const alt = neueste.get(schluessel);
    if (!alt || m.zeit > alt.zeit) neueste.set(schluessel, m);
  }
  const jeProvider = new Map<string, Messbericht[]>();
  for (const m of neueste.values()) jeProvider.set(m.provider, [...(jeProvider.get(m.provider) ?? []), m]);
  const staende = new Map<string, PruefStand>();
  for (const [provider, berichte] of jeProvider) {
    const anfragen = berichte.reduce((s, m) => s + m.anfragen, 0);
    const erfolge = berichte.reduce((s, m) => s + m.erfolge, 0);
    const treffer: Messbericht["treffer"] = {};
    for (const m of berichte) {
      for (const art of PRUEF_ARTEN) {
        const t = m.treffer[art];
        if (t) treffer[art] = { richtig: (treffer[art]?.richtig ?? 0) + t.richtig, geprueft: (treffer[art]?.geprueft ?? 0) + t.geprueft };
      }
    }
    const qualitaet = trefferQuote({ treffer });
    const mediane = berichte.filter((m) => m.erfolge > 0).map((m) => m.medianMs).sort((a, b) => a - b);
    staende.set(provider, {
      anfragen, erfolge,
      stufe: stufeAus(anfragen, erfolge, PRUEF_GRENZEN.minPruefer),
      ...(qualitaet === undefined ? {} : { qualitaet }),
      ...(mediane.length > 0 ? { medianMs: mediane[Math.floor((mediane.length - 1) / 2)] } : {}),
      pruefer: new Set(berichte.map((m) => m.pruefer)).size,
    });
  }
  return staende;
}
