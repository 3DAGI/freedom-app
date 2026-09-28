/**
 * Lightning-Rechnung versiegelt erfragen (Schritt 6.3b), ohne DOM.
 *
 * Zahler: Hat der Empfänger keine öffentliche Lightning-Adresse (seit 6.3a der
 * Standard), fragt die App ihn im Umschlag nach einer Rechnung über den Betrag
 * und wartet eine Weile auf die Antwort.
 *
 * Empfänger: beantwortet Anfragen nur von bekannten Kontakten, nur frische,
 * gebremst (jede Rechnung belegt Platz in der eigenen Wallet), und stellt die
 * Rechnung mit der eigenen Wallet aus (NWC `make_invoice`) – kein LNURL-Dienst.
 */
import {
  KIND_GIFT_WRAP, buildRechnungsAnfrage, buildRechnungsAntwort, oeffneRechnungsAnfrage, oeffneRechnungsAntwort,
  type NostrEvent, type OutboxPool, type Signer,
} from "@freedomstack/protocol";

/** Ältere Anfragen beantwortet niemand mehr – der Zahler wartet nicht so lange. */
export const ANFRAGE_GUELTIG_SECS = 15 * 60;
/** So lange wartet der Zahler auf die Antwort. */
export const WARTEN_MS = 75_000;

/**
 * Zahler: versiegelt anfragen und auf die Antwort warten. undefined, wenn in
 * `warteMs` keine gültige kam (Empfänger offline, ohne Wallet, kein Kontakt).
 */
export async function frageRechnungAn(p: {
  pool: Pick<OutboxPool, "publish" | "query">; signer: Signer; empfaenger: string; betragMsat: number;
  /** An den Posteingang des Empfängers (5.4); ohne: an den eigenen Pool. */
  sende?: (wrap: NostrEvent, an: string) => Promise<void>;
  warteMs?: number; pause?: (ms: number) => Promise<void>;
}): Promise<string | undefined> {
  const { wrap, anfrageId } = await buildRechnungsAnfrage({ von: p.signer, anPk: p.empfaenger, betragMsat: p.betragMsat });
  await (p.sende ? p.sende(wrap, p.empfaenger) : p.pool.publish(wrap));
  const pause = p.pause ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const ende = Date.now() + (p.warteMs ?? WARTEN_MS);
  const erwartet = { vonPk: p.empfaenger, anfrageId, betragMsat: p.betragMsat };
  // Erst nachsehen, dann auf die Uhr schauen – eine Antwort aus der letzten Pause zählt noch.
  for (;;) {
    for (const w of await p.pool.query({ kinds: [KIND_GIFT_WRAP], "#p": [p.signer.publicKey()], since: wrap.created_at - 60 })) {
      const a = await oeffneRechnungsAntwort(w, p.signer, erwartet).catch(() => null);
      if (a) return a.bolt11;
    }
    if (Date.now() >= ende) return undefined;
    await pause(3000);
  }
}

/**
 * Bremse des Empfängers: je Kontakt höchstens eine Rechnung je 30 s, insgesamt
 * höchstens zehn je Minute. Nur im Speicher – nach einem Neustart beginnt sie neu.
 */
export class RechnungsBremse {
  #zuletzt = new Map<string, number>();
  #minute: number[] = [];

  erlaubt(von: string, jetztMs = Date.now()): boolean {
    this.#minute = this.#minute.filter((z) => jetztMs - z < 60_000);
    if (this.#minute.length >= 10 || jetztMs - (this.#zuletzt.get(von) ?? -Infinity) < 30_000) return false;
    this.#zuletzt.set(von, jetztMs);
    this.#minute.push(jetztMs);
    return true;
  }
}

/**
 * Empfänger: eine Anfrage im Umschlag beantworten – nur für bekannte Kontakte,
 * nur frische Anfragen, gebremst, mit einer Rechnung der eigenen Wallet. true,
 * wenn es eine Anfrage war (auch wenn nicht geantwortet wurde).
 */
export async function beantworteRechnungsAnfrage(p: {
  wrap: NostrEvent; signer: Signer;
  istKontakt: (pk: string) => boolean;
  /** Rechnung der eigenen Wallet über genau diesen Betrag; undefined ohne Wallet. */
  stelleAus: (betragMsat: number) => Promise<string | undefined>;
  bremse: RechnungsBremse;
  sende: (wrap: NostrEvent, an: string) => Promise<void>;
  jetzt?: number;
}): Promise<boolean> {
  const a = await oeffneRechnungsAnfrage(p.wrap, p.signer).catch(() => null);
  if (!a) return false;
  const jetzt = p.jetzt ?? Math.floor(Date.now() / 1000);
  if (!p.istKontakt(a.von) || jetzt - a.zeit > ANFRAGE_GUELTIG_SECS || a.zeit - jetzt > 60) return true;
  if (!p.bremse.erlaubt(a.von, jetzt * 1000)) return true;
  const bolt11 = await p.stelleAus(a.betragMsat).catch(() => undefined);
  if (!bolt11) return true; // ohne Wallet: keine Antwort, der Zahler sieht nach der Wartezeit den Grund
  await p.sende(await buildRechnungsAntwort({ von: p.signer, anPk: a.von, anfrageId: a.anfrageId, bolt11 }), a.von);
  return true;
}
