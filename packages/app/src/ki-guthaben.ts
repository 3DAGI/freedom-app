/**
 * KI-Guthaben (RM2d, `docs/RM2-ENTWURF.md` V3, V6): was Kopf, Seitenleiste und Karte über den Cashu-Topf zeigen, und
 * das Laden – ohne DOM. Das Guthaben ist verwahrt: von der Mint, die der Nutzer gewählt hat, nie von FreedomStack.
 *
 * Laden: die Rechnung der Mint (`ladeAnfrage()` prüft sie auf genau den Betrag), bezahlt über die Zahlschienen, dann
 * abholen. Antwortet die Mint nach dem Zahlen nicht, bleibt die Ladung offen und lässt sich später abholen
 * (`holeOffene()`) – ein unklarer Ausgang wird nie von selbst noch einmal bezahlt.
 */
import { CashuFehler, type CashuFall, type CashuTopf } from "./cashu-topf.js";
import { t } from "./i18n.js";
import { fehlerText } from "./protokoll-texte.js";

export interface GuthabenStand {
  /** Adresse der Mint, ohne Wahl `null`. */
  mint: string | null;
  /** Nur der Host – so zeigt die Oberfläche, wer verwahrt. */
  host: string | null;
  /** Frei verfügbar (sat). */
  sats: number;
  /** Auf Provider gesperrt, noch nicht übergeben (sat) – nach der Frist kommt es zurück. */
  imPfand: number;
  /** Bezahlte oder offene Ladungen, noch nicht abgeholt (sat). */
  offen: number;
  /** Gebühr der Mint je Token (ppk). */
  gebuehrPpk: number;
}

type Sicht = Pick<CashuTopf, "mint" | "guthaben" | "imPfand" | "offeneLadungen" | "gebuehrPpk">;

export function mintHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function guthabenStand(topf: Sicht): GuthabenStand {
  const mint = topf.mint() ?? null;
  if (!mint) return { mint: null, host: null, sats: 0, imPfand: 0, offen: 0, gebuehrPpk: 0 };
  return {
    mint, host: mintHost(mint), sats: topf.guthaben(), imPfand: topf.imPfand(),
    offen: topf.offeneLadungen().reduce((n, x) => n + x.betrag, 0), gebuehrPpk: topf.gebuehrPpk(),
  };
}

export type LadeErgebnis = { art: "geladen"; sats: number } | { art: "offen"; fall: CashuFall };

/** Wann eine Ladung nach dem Zahlen offen bleibt statt zu scheitern: Die Mint hat noch nicht gesehen oder nicht geantwortet. */
const NOCH_OFFEN: readonly CashuFall[] = ["unbezahlt", "mint-netz"];

export async function ladeGuthaben(
  w: { topf: Pick<CashuTopf, "ladeAnfrage" | "abholen">; zahle: (rechnung: string, msat: number) => Promise<unknown> }, sats: number,
): Promise<LadeErgebnis> {
  const q = await w.topf.ladeAnfrage(sats);
  // Scheitert das Zahlen, gilt die Ladung bis zu ihrer Frist als offen – nie von selbst noch einmal zahlen
  await w.zahle(q.rechnung, sats * 1000);
  try {
    return { art: "geladen", sats: await w.topf.abholen(q.quote) };
  } catch (e) {
    if (e instanceof CashuFehler && NOCH_OFFEN.includes(e.fall)) return { art: "offen", fall: e.fall };
    throw e;
  }
}

/** Offene Ladungen abholen – was die Mint noch nicht bezahlt sieht oder nicht beantwortet, bleibt offen. */
export async function holeOffene(topf: Pick<CashuTopf, "offeneLadungen" | "abholen">): Promise<{ sats: number; offen: number }> {
  let sats = 0;
  let offen = 0;
  for (const l of topf.offeneLadungen()) {
    try {
      sats += await topf.abholen(l.quote);
    } catch (e) {
      if (e instanceof CashuFehler && NOCH_OFFEN.includes(e.fall)) offen += l.betrag;
      // „ausgegeben“: schon abgeholt (anderes Gerät) – der Topf hat sie vergessen
      else if (!(e instanceof CashuFehler && e.fall === "ausgegeben")) throw e;
    }
  }
  return { sats, offen };
}

/** Je Kennung des Topfs ein Satz – `Record` hält die Liste vollständig. */
export const CASHU_TEXT: Record<CashuFall, string> = {
  tresor: "cashu.fall.tresor", "mint-adresse": "cashu.fall.mint-adresse", "mint-netz": "cashu.fall.mint-netz",
  "mint-ohne-nut11": "cashu.fall.mint-ohne-nut11", "mint-ohne-nut12": "cashu.fall.mint-ohne-nut12", "mint-ohne-sat": "cashu.fall.mint-ohne-sat",
  "mint-wechsel": "cashu.fall.mint-wechsel", "keine-mint": "cashu.fall.keine-mint", betrag: "cashu.fall.betrag", "zu-viel": "cashu.fall.zu-viel",
  "zu-wenig": "cashu.fall.zu-wenig", rechnung: "cashu.fall.rechnung", unbezahlt: "cashu.fall.unbezahlt", token: "cashu.fall.token",
  "fremde-mint": "cashu.fall.fremde-mint", "ohne-dleq": "cashu.fall.ohne-dleq", "nicht-gesperrt": "cashu.fall.nicht-gesperrt",
  ausgegeben: "cashu.fall.ausgegeben", laufend: "cashu.fall.laufend", "pfand-schluessel": "cashu.fall.pfand-schluessel",
};

/** Fehler des Topfs nur über ihre Kennung, alles andere über `fehlerText()`. */
export function cashuFehlerText(e: unknown): string {
  return e instanceof CashuFehler ? t(CASHU_TEXT[e.fall]) : fehlerText(e);
}
