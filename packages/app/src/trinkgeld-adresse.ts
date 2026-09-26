/**
 * Adresse fuer ein SOL-Trinkgeld – versiegelt angefragt (Schritt 4.9d), ohne DOM.
 *
 * Geber: zuerst die Adresse, die dieser Empfaenger ihm frueher gegeben hat
 * (gemerkt im Tresor-Speicher); sonst versiegelt anfragen und eine Weile auf
 * die Antwort warten. Das oeffentliche Profilfeld `sol` nur noch mit Warnung
 * (Entscheidung 4.9 A).
 *
 * Empfaenger: beantwortet Anfragen nur von bekannten Kontakten und nur mit
 * einer eigenen Adresse je Kontakt aus dem Vorrat der eingebauten Wallet –
 * stabil, damit kein Fremder den Vorrat leeren kann und keine zwei Kontakte
 * dieselbe Adresse sehen.
 */
import {
  KIND_GIFT_WRAP, buildAdressAnfrage, buildAdressAntwort, oeffneAdressAnfrage, oeffneAdressAntwort,
  type NostrEvent, type OutboxPool, type Signer,
} from "@freedomstack/protocol";
import type { WalletSpeicher } from "./sol-wallet.js";

/** Geber: Empfaenger (npub-hex) -> Kette -> Adresse, die er uns gab. Tresor-Praefix „freedom.solWallet“. */
export const LS_ADRESSEN_VON = "freedom.solWallet.adressenVon";
/** Empfaenger: Kontakt (npub-hex) -> Kette -> Adresse, die er von uns bekam. */
export const LS_ADRESSE_JE_KONTAKT = "freedom.solWallet.jeKontakt";
/** Aeltere Anfragen beantwortet niemand mehr – der Geber wartet nicht so lange. */
export const ANFRAGE_GUELTIG_SECS = 15 * 60;
/** So lange wartet der Geber auf die Antwort. */
export const WARTEN_MS = 75_000;

type Karte = Record<string, Record<string, string>>;

function lies(s: Pick<WalletSpeicher, "getItem">, key: string): Karte {
  try {
    const k = JSON.parse(s.getItem(key) ?? "{}") as unknown;
    return k && typeof k === "object" && !Array.isArray(k) ? (k as Karte) : {};
  } catch {
    return {};
  }
}

async function schreibe(s: WalletSpeicher, key: string, pk: string, kette: string, adresse: string): Promise<void> {
  const k = lies(s, key);
  k[pk] = { ...(k[pk] ?? {}), [kette]: adresse };
  await s.setItem(key, JSON.stringify(k));
}

/** Geber: die Adresse, die dieser Empfaenger uns auf dieser Kette gab – oder undefined. */
export function gemerkteAdresse(s: Pick<WalletSpeicher, "getItem">, empfaenger: string, kette: string): string | undefined {
  const a = lies(s, LS_ADRESSEN_VON)[empfaenger]?.[kette];
  return typeof a === "string" ? a : undefined;
}

/**
 * Geber: versiegelt anfragen und auf die Antwort warten. Die Antwort wird
 * gemerkt – das naechste Trinkgeld an denselben Empfaenger braucht keine
 * Anfrage mehr. undefined, wenn in `warteMs` keine kam.
 */
export async function frageAdresseAn(p: {
  pool: Pick<OutboxPool, "publish" | "query">; speicher: WalletSpeicher; signer: Signer; empfaenger: string; kette: string;
  warteMs?: number; pause?: (ms: number) => Promise<void>;
}): Promise<string | undefined> {
  const { wrap, anfrageId } = await buildAdressAnfrage({ von: p.signer, anPk: p.empfaenger, kette: p.kette });
  await p.pool.publish(wrap);
  const pause = p.pause ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const ende = Date.now() + (p.warteMs ?? WARTEN_MS);
  // Erst nachsehen, dann auf die Uhr schauen – eine Antwort aus der letzten Pause zaehlt noch.
  for (;;) {
    for (const w of await p.pool.query({ kinds: [KIND_GIFT_WRAP], "#p": [p.signer.publicKey()], since: wrap.created_at - 60 })) {
      const a = await oeffneAdressAntwort(w, p.signer, { vonPk: p.empfaenger, anfrageId }).catch(() => null);
      if (a && a.kette === p.kette) {
        await schreibe(p.speicher, LS_ADRESSEN_VON, p.empfaenger, p.kette, a.adresse);
        return a.adresse;
      }
    }
    if (Date.now() >= ende) return undefined;
    await pause(3000);
  }
}

/**
 * Empfaenger: eine Anfrage im Umschlag beantworten – nur fuer bekannte
 * Kontakte, nur frische Anfragen, und mit der Adresse, die dieser Kontakt
 * schon hat, sonst einer neuen aus dem Vorrat. true, wenn es eine Anfrage war
 * (auch wenn nicht geantwortet wurde).
 */
export async function beantworteAdressAnfrage(p: {
  wrap: NostrEvent; signer: Signer; speicher: WalletSpeicher;
  istKontakt: (pk: string) => boolean;
  frischeAdresse: () => Promise<string | undefined>;
  kette: string;
  sende: (wrap: NostrEvent, an: string) => Promise<void>;
  jetzt?: number;
}): Promise<boolean> {
  const a = await oeffneAdressAnfrage(p.wrap, p.signer).catch(() => null);
  if (!a) return false;
  const jetzt = p.jetzt ?? Math.floor(Date.now() / 1000);
  if (a.kette !== p.kette || !p.istKontakt(a.von) || jetzt - a.zeit > ANFRAGE_GUELTIG_SECS) return true;
  let adresse: string | undefined = lies(p.speicher, LS_ADRESSE_JE_KONTAKT)[a.von]?.[a.kette];
  if (!adresse) {
    adresse = await p.frischeAdresse();
    if (!adresse) return true; // ohne eingebaute Wallet oder Vorrat: keine Antwort, der Geber faellt zurueck
    await schreibe(p.speicher, LS_ADRESSE_JE_KONTAKT, a.von, a.kette, adresse);
  }
  await p.sende(await buildAdressAntwort({ von: p.signer, anPk: a.von, anfrageId: a.anfrageId, adresse, kette: a.kette }), a.von);
  return true;
}
