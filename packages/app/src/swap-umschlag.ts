/**
 * Swap-Anfragen der App nur im Umschlag (Schritt 4.9b) – ohne DOM.
 *
 * Bis 4.9 ging die Anfrage offen auf die Relays: in der Hinrichtung vom
 * eigenen npub mit der SOL-Empfangsadresse, in der Gegenrichtung mit der
 * Rechnung; die Antworten nannten Swap-ID und Rechnung des LP. Jetzt gehen
 * beide Richtungen versiegelt von einem Wegwerf-Schluessel je Swap an den LP,
 * und die App nimmt nur versiegelte Antworten dieses LP zu dieser Anfrage.
 *
 * Nur LPs, deren Angebot `["versiegelt", "1"]` traegt, lesen Umschlaege
 * (`protocol/swap-versiegelt.ts`, LP ab 4.9a). Andere fragt die App nicht an –
 * ihnen ginge die Anfrage wieder offen zu.
 */
import {
  KIND_GIFT_WRAP, LocalSigner, generateKeypair, oeffneSwapAntwort, versiegleSwapAnfrage,
  type LpOffer, type NostrEvent, type OutboxPool, type UnsignedEvent,
} from "@freedomstack/protocol";

/** Liest dieser LP Anfragen im Umschlag? Sonst fragt die App ihn nicht an. */
export function liestUmschlaege(o: Pick<LpOffer, "versiegelt">): boolean {
  return o.versiegelt === true;
}

/** Eine gesendete Anfrage: ihr Wegwerf-Schluessel und ihre ID – noetig, um die Antwort zu oeffnen. */
export interface SwapPost {
  einmal: LocalSigner;
  anfrageId: string;
  lpPk: string;
  wrap: NostrEvent;
}

async function sende(lpPk: string, tags: string[][], jetzt?: number): Promise<SwapPost> {
  const einmal = new LocalSigner(generateKeypair().sk);
  const { wrap, anfrageId } = await versiegleSwapAnfrage({ tags, kunde: einmal, lpPk, nowSecs: jetzt });
  return { einmal, anfrageId, lpPk, wrap };
}

/** Hinrichtung (sats → SOL): Betrag, Hashlock und Empfangsadresse – nur fuer den LP lesbar. */
export function hinAnfrage(p: { lpPk: string; offerId: string; amountSats: number; hashlockHex: string; solAdresse: string; jetzt?: number }): Promise<SwapPost> {
  return sende(p.lpPk, [
    ["offer", p.offerId],
    ["amount_sats", String(p.amountSats)],
    ["hashlock", p.hashlockHex],
    ["solana_address", p.solAdresse],
  ], p.jetzt);
}

/** Gegenrichtung (SOL → sats): Angebot und Rechnung – nur fuer den LP lesbar. */
export function rueckAnfrage(p: { lpPk: string; offerId: string; bolt11: string; jetzt?: number }): Promise<SwapPost> {
  return sende(p.lpPk, [["offer", p.offerId], ["bolt11", p.bolt11]], p.jetzt);
}

/**
 * Antworten des LP auf diese Anfrage – nur aus Umschlaegen an den
 * Wegwerf-Schluessel, nur vom LP selbst und nur zu dieser Anfrage. Eine
 * fremde „Antwort“ (etwa eine untergeschobene Vorab-Rechnung) faellt heraus.
 */
export async function swapAntworten(
  pool: Pick<OutboxPool, "query">,
  post: Pick<SwapPost, "einmal" | "anfrageId" | "lpPk">,
): Promise<UnsignedEvent[]> {
  const wraps = await pool.query({ kinds: [KIND_GIFT_WRAP], "#p": [post.einmal.publicKey()] });
  const antworten: UnsignedEvent[] = [];
  for (const w of wraps) {
    const a = await oeffneSwapAntwort(w, post.einmal, { lpPk: post.lpPk, anfrageId: post.anfrageId }).catch(() => null);
    if (a) antworten.push(a);
  }
  return antworten;
}
