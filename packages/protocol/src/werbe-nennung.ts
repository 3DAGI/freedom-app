/**
 * Öffentliche Nennung des Werbers (Kind 38052) – nach Gebührenmodell A+
 * (Schritt 5.1.4b).
 *
 * Seit A+ zahlt die App des Geworbenen ihrem Werber 0,5 % jeder KI-Zahlung
 * direkt (Werbelink, `werbung.ts` der App) – dafür braucht es keine
 * öffentliche Beziehung. Wer will, nennt seinen Werber trotzdem öffentlich
 * (nur mit Zustimmung, 8.1b); daraus zählt die App, wie viele Geworbene
 * jemanden nennen. Keine Stufen, keine zweite Ebene, keine Rangliste.
 *
 * Signiert vom Geworbenen: Niemand kann fremde Schlüssel als eigene Geworbene
 * eintragen. Je Geworbenem zählt die früheste Angabe – ein späterer Wechsel
 * des Werbers wird ignoriert.
 */
import { NostrEvent, UnsignedEvent, buildEvent, getTag, verifyEvent } from "./event.js";
import { ProtokollFehler } from "./fehler.js";

/** „Ich wurde von X geworben" — signiert vom Geworbenen. */
export const KIND_REFERRAL_CLAIM = 38052;

export function buildReferralClaim(
  referredPubkey: string,
  referrerPubkey: string,
  createdAt?: number,
): UnsignedEvent {
  if (referredPubkey === referrerPubkey) {
    throw new ProtokollFehler("selbstwerbung", "Selbstwerbung ist nicht möglich.");
  }
  return buildEvent(
    referredPubkey,
    KIND_REFERRAL_CLAIM,
    [
      ["d", "referral"], // ersetzbar, aber es zählt die früheste Fassung
      ["referrer", referrerPubkey],
      ["p", referrerPubkey],
    ],
    "",
    createdAt,
  );
}

export interface ReferralClaim {
  referredPubkey: string;
  referrerPubkey: string;
  createdAt: number;
}

export function parseReferralClaim(ev: NostrEvent): ReferralClaim {
  if (ev.kind !== KIND_REFERRAL_CLAIM) throw new Error(`kein Referral-Claim: kind ${ev.kind}`);
  const referrer = getTag(ev, "referrer");
  if (!referrer || !/^[0-9a-f]{64}$/.test(referrer)) {
    throw new Error("Referral-Claim ohne gültigen referrer");
  }
  if (referrer === ev.pubkey) throw new Error("Selbstwerbung ist nicht möglich.");
  return { referredPubkey: ev.pubkey, referrerPubkey: referrer, createdAt: ev.created_at };
}

/**
 * Wie viele Geworbene nennen `werber` öffentlich? Nur gültig signierte
 * Angaben; je Geworbenem die früheste.
 */
export function zaehleNennungen(claims: readonly NostrEvent[], werber: string): number {
  const frueheste = new Map<string, ReferralClaim>();
  for (const ev of claims) {
    if (!verifyEvent(ev)) continue;
    let c: ReferralClaim;
    try {
      c = parseReferralClaim(ev);
    } catch {
      continue;
    }
    const bisher = frueheste.get(c.referredPubkey);
    if (!bisher || c.createdAt < bisher.createdAt) frueheste.set(c.referredPubkey, c);
  }
  return [...frueheste.values()].filter((c) => c.referrerPubkey === werber).length;
}
