/**
 * Spiegel der App (Schritt 5.3).
 *
 * Jede Auslieferung von `freedom.html` kann daneben eine `freedom-spiegel.json`
 * legen: wohin der Hosting-Anteil (1 %, Entscheidung 4.0) geht. Die App liest
 * sie von ihrer eigenen Herkunft – dort ablegen kann nur, wer den Spiegel
 * betreibt. So bekommt jeder Betreiber seinen Anteil, ohne dass jemand eine
 * Liste pflegen oder freigeben muss.
 *
 * Werte, die der MENSCH noch eintragen muss (docs/KONTEN.md), beginnen mit
 * `PLATZHALTER:` – sie gelten als nicht gesetzt: kein Anteil, keine Quelle.
 */
import { adresseFuer, type Zahlziel } from "./aufteilung.js";

export const PLATZHALTER_PRAEFIX = "PLATZHALTER:";
export const istPlatzhalter = (v: unknown): boolean => typeof v === "string" && v.trim().startsWith(PLATZHALTER_PRAEFIX);

/** Liegt neben freedom.html. */
export const SPIEGEL_DATEI = "freedom-spiegel.json";

/**
 * Hosting-Zahlziel aus der Spiegel-Datei – nur gültige, selbst eingetragene
 * Adressen (Lightning-Adresse ohne lokalen Host, SOL-Adresse); Platzhalter
 * und Unlesbares zählen nicht. null, wenn keine Adresse bleibt.
 */
export function leseSpiegelDatei(roh: unknown): Zahlziel | null {
  if (typeof roh !== "object" || roh === null) return null;
  const d = roh as { version?: unknown; zahlziel?: { lud16?: unknown; sol?: unknown } };
  if (d.version !== 1 || typeof d.zahlziel !== "object" || d.zahlziel === null) return null;
  const roh2 = {
    ...(typeof d.zahlziel.lud16 === "string" && !istPlatzhalter(d.zahlziel.lud16) ? { lud16: d.zahlziel.lud16 } : {}),
    ...(typeof d.zahlziel.sol === "string" && !istPlatzhalter(d.zahlziel.sol) ? { sol: d.zahlziel.sol } : {}),
  };
  const lud16 = adresseFuer(roh2, "lightning");
  const sol = adresseFuer(roh2, "solana");
  return lud16 || sol ? { ...(lud16 ? { lud16 } : {}), ...(sol ? { sol } : {}) } : null;
}

export type QuellenArt = "offiziell" | "codeberg" | "onion" | "radicle" | "ipfs" | "arweave" | "blossom" | "torrent";

export interface Quelle {
  art: QuellenArt;
  url: string;
}

/** Wie eine Quelle je Art aussehen muss – alles andere ist ein Tippfehler oder ein Platzhalter. */
const FORM: Record<QuellenArt, RegExp> = {
  offiziell: /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[^\s"<>]*)?$/i,
  codeberg: /^https:\/\/[a-z0-9-]+\.codeberg\.page\/[^\s"<>]*$/i,
  onion: /^https?:\/\/[a-z2-7]{56}\.onion(\/[^\s"<>]*)?$/,
  radicle: /^rad:z[1-9A-HJ-NP-Za-km-z]{20,60}$/,
  ipfs: /^ipfs:\/\/(baf[ky][a-z2-7]{50,}|Qm[1-9A-HJ-NP-Za-km-z]{44})$/,
  arweave: /^ar:\/\/[A-Za-z0-9_-]{43}$/,
  blossom: /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}\/[0-9a-f]{64}(\.html)?$/i,
  torrent: /^magnet:\?xt=urn:btih:[0-9a-f]{40}(&[^\s"<>]*)?$/i,
};

/**
 * Bezugsquellen aus `spiegel/quellen.json`: gesetzt (Form geprüft) und noch
 * offen (Platzhalter oder unbrauchbar) – die Startseite zeigt beides ehrlich,
 * das Release-Manifest nennt nur die gesetzten.
 */
export function leseQuellen(roh: unknown): { gesetzt: Quelle[]; offen: QuellenArt[] } {
  const liste = (roh as { quellen?: unknown } | null)?.quellen;
  const gesetzt: Quelle[] = [];
  const offen: QuellenArt[] = [];
  for (const q of Array.isArray(liste) ? liste : []) {
    const { art, url } = (q ?? {}) as { art?: unknown; url?: unknown };
    if (typeof art !== "string" || !(art in FORM)) continue;
    const a = art as QuellenArt;
    if (typeof url === "string" && !istPlatzhalter(url) && FORM[a].test(url.trim())) gesetzt.push({ art: a, url: url.trim() });
    else offen.push(a);
  }
  return { gesetzt, offen };
}
