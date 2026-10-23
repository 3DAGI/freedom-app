/**
 * Reticulum-Adresse für Kontakte (B-32c1, `docs/RETICULUM-ENTWURF.md` V4, W2 A, `docs/PROTOCOL.md` §44): die eigene
 * LXMF-Adresse versiegelt an Kontakte – je Kontakt ein Umschlag (1059), innen Kind 38082 mit genau einem Tag
 * `["lxmf", <32 Zeichen Hex>]`. Nie offen im Profil: Sonst verbände jeder den Nostr-Schlüssel mit einer Funk-Adresse.
 * Relays sehen nur, dass Kontakte Post bekommen. Gelesen nur von Kontakten, der Kern muss vom Siegel-Autor stammen.
 */
import type { NostrEvent, UnsignedEvent } from "./event.js";
import { giftUnwrapMitSigner, giftWrapMitSigner } from "./gift-wrap.js";
import type { Signer } from "./signer.js";

export const KIND_FUNK_ADRESSE = 38082;

const HEX64 = /^[0-9a-f]{64}$/;
/** Eine LXMF-Adresse: 16 Byte, als Hex in Kleinbuchstaben (so baut und liest die App sie). */
const LXMF = /^[0-9a-f]{32}$/;

/** Je Kontakt ein Umschlag mit der eigenen LXMF-Adresse – nicht an sich selbst, nichts Ungültiges. */
export async function baueFunkAdresseUmschlaege(p: {
  von: Signer; an: readonly string[]; adresse: string; nowSecs?: number;
}): Promise<NostrEvent[]> {
  const ich = p.von.publicKey();
  const an = [...new Set(p.an)].filter((k) => HEX64.test(k) && k !== ich);
  if (an.length === 0 || !LXMF.test(p.adresse)) return [];
  const now = p.nowSecs ?? Math.floor(Date.now() / 1000);
  const kern: UnsignedEvent = { pubkey: ich, kind: KIND_FUNK_ADRESSE, created_at: now, content: "", tags: [["lxmf", p.adresse]] };
  return Promise.all(an.map((k) => giftWrapMitSigner(kern, p.von, k, { nowSecs: now })));
}

/** Eine empfangene Adresse: von wem, wann geschrieben, die Adresse (32 Zeichen Hex). */
export interface FunkAdresseVonKontakt {
  von: string;
  zeit: number;
  adresse: string;
}

/**
 * Umschlag öffnen: die Adresse eines der eigenen Kontakte? Sonst null – Fremde zählen nicht, der Kern muss vom
 * Siegel-Autor stammen, und er trägt genau ein `lxmf`-Tag und sonst nichts.
 */
export async function oeffneFunkAdresseUmschlag(
  wrap: NostrEvent, signer: Signer, kontakte: ReadonlySet<string>,
): Promise<FunkAdresseVonKontakt | null> {
  const u = await giftUnwrapMitSigner(wrap, signer).catch(() => null);
  if (!u?.ok || !u.inner || !u.senderPubkey || u.inner.kind !== KIND_FUNK_ADRESSE || u.inner.pubkey !== u.senderPubkey) return null;
  if (!kontakte.has(u.senderPubkey) || !Number.isSafeInteger(u.inner.created_at) || u.inner.content !== "") return null;
  const [tag, ...mehr] = u.inner.tags;
  if (mehr.length > 0 || tag?.length !== 2 || tag[0] !== "lxmf" || !LXMF.test(tag[1] ?? "")) return null;
  return { von: u.senderPubkey, zeit: u.inner.created_at, adresse: tag[1]! };
}
