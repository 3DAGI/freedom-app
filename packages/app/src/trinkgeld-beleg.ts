/**
 * SOL-Trinkgeld-Beleg in der App (Schritt 4.7b) – ohne DOM.
 *
 * Nach einem SOL-Trinkgeld geht der Beleg (Kind 9736) versiegelt an den
 * Empfaenger und als eigene Kopie; oeffentlich nur, wenn der Nutzer es
 * ausdruecklich will. Empfangene Belege prueft die App gegen die Kette –
 * angezeigt wird „belegt“ erst, wenn Empfaenger und Betrag dort stimmen.
 */
import {
  type NostrEvent, type SolPruefung, type SolTrinkgeld, type Signer,
  buildPrivateSolTrinkgeld, buildSolTrinkgeld, pruefeSolUeberweisung,
} from "@freedomstack/protocol";
import { ausLamports } from "./preis-anzeige.js";
import { t } from "./i18n.js";
import { solGrund } from "./protokoll-texte.js";

type Veroeffentlicher = { publish(ev: NostrEvent): Promise<unknown> };

/** Beleg senden: versiegelt immer, oeffentlich nur auf Wunsch. Liefert die Zahl der Events. */
export async function sendeTrinkgeldBeleg(pool: Veroeffentlicher, signer: Signer, tg: SolTrinkgeld, oeffentlich: boolean): Promise<number> {
  const wraps = await buildPrivateSolTrinkgeld(tg, signer);
  for (const w of wraps) await pool.publish(w);
  if (!oeffentlich) return wraps.length;
  await pool.publish(await signer.signEvent(buildSolTrinkgeld(signer.publicKey(), tg)));
  return wraps.length + 1;
}

/**
 * Prueft einen Beleg gegen die Kette, die die App gerade anspricht. Ein Beleg
 * fuer eine andere Kette laesst sich hier nicht pruefen – dann „unbestaetigt“.
 */
export async function pruefeTrinkgeld(
  tg: SolTrinkgeld,
  kette: string,
  ladeTransaktion: (signatur: string) => Promise<unknown>,
): Promise<SolPruefung> {
  if (tg.kette !== kette) return { status: "unbestaetigt", grund: t("zahl.belegAndereKette", { beleg: tg.kette, kette }) };
  try {
    return pruefeSolUeberweisung(await ladeTransaktion(tg.signatur), { an: tg.an, lamports: tg.lamports });
  } catch (e) {
    return { status: "unbestaetigt", grund: t("zahl.ketteNichtErreichbar", { fehler: (e as Error).name }) };
  }
}

/** Anzeige im Chat, z. B. „◎ Trinkgeld 0,002 SOL ≈ 310 sats · belegt ✓“. */
export function trinkgeldText(tg: SolTrinkgeld, p: SolPruefung | undefined, kurs?: { satsProSol: number }, notiz = tg.notiz): string {
  const stand = !p ? t("zahl.wirdGeprueft")
    : p.status === "belegt" ? t("zahl.belegt")
    : p.status === "unbestaetigt" ? t("zahl.unbestaetigt", { grund: solGrund(p) })
    : t("zahl.falsch", { grund: solGrund(p) });
  return t("zahl.trinkgeldZeile", { betrag: ausLamports(tg.lamports, kurs), stand }) + (notiz ? t("zahl.trinkgeldNotiz", { notiz }) : "");
}
