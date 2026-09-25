/**
 * Private Kontaktliste (Schritt 2.5b) – optional, Standard aus.
 *
 * Die Unterhaltungen der App liegen nur lokal im Tresor. Wer sie zwischen
 * Geraeten abgleichen will, kann sie als NIP-51-Liste (Kind 30000) sichern –
 * alle Eintraege privat: als NIP-44-Chiffrat an sich selbst im Inhalt, kein
 * einziger p-Tag offen. Relays sehen nur, dass es die Liste gibt, und an der
 * Groesse des Chiffrats ungefaehr, wie lang sie ist.
 */
import { type NostrEvent, type UnsignedEvent, buildEvent, getTag } from "./event.js";
import type { Signer } from "./signer.js";

export const KIND_KONTAKTLISTE = 30000;
/** d-Tag der Liste – ein Name, kein Inhalt. */
export const D_KONTAKTE = "freedom-kontakte";
export const MAX_KONTAKTE = 1000;
const MAX_NAME = 100;
const HEX64 = /^[0-9a-f]{64}$/;

export interface Kontakt {
  pk: string;
  name: string;
}

/** Liste bauen: alle Eintraege verschluesselt an den eigenen Schluessel. */
export async function buildPrivateKontaktliste(kontakte: readonly Kontakt[], signer: Signer, nowSecs?: number): Promise<UnsignedEvent> {
  if (kontakte.length > MAX_KONTAKTE) throw new Error(`Höchstens ${MAX_KONTAKTE} Kontakte`);
  const eintraege = kontakte.map((k) => {
    if (!HEX64.test(k.pk)) throw new Error("Kontakt-Pubkey ungültig (64 Zeichen hex erwartet)");
    return ["p", k.pk, "", k.name.slice(0, MAX_NAME)];
  });
  const selbst = signer.publicKey();
  const inhalt = await signer.nip44Encrypt(selbst, JSON.stringify(eintraege));
  return buildEvent(selbst, KIND_KONTAKTLISTE, [["d", D_KONTAKTE]], inhalt, nowSecs);
}

/**
 * Eigene Liste oeffnen. Fremde, falsche oder kaputte Listen ergeben einen
 * Fehler; einzelne kaputte Eintraege fallen still heraus.
 */
export async function oeffnePrivateKontaktliste(ev: NostrEvent, signer: Signer): Promise<Kontakt[]> {
  const selbst = signer.publicKey();
  if (ev.kind !== KIND_KONTAKTLISTE || getTag(ev, "d") !== D_KONTAKTE) throw new Error("Keine Kontaktliste");
  if (ev.pubkey !== selbst) throw new Error("Nicht die eigene Kontaktliste");
  if (ev.tags.some((t) => t[0] === "p")) throw new Error("Kontaktliste mit offenen Einträgen");
  let roh: unknown;
  try {
    roh = JSON.parse(await signer.nip44Decrypt(selbst, ev.content));
  } catch {
    throw new Error("Kontaktliste nicht lesbar");
  }
  if (!Array.isArray(roh)) throw new Error("Kontaktliste beschädigt");
  const gesehen = new Set<string>();
  const kontakte: Kontakt[] = [];
  for (const t of roh.slice(0, MAX_KONTAKTE)) {
    if (!Array.isArray(t) || t[0] !== "p" || typeof t[1] !== "string" || !HEX64.test(t[1]) || gesehen.has(t[1])) continue;
    gesehen.add(t[1]);
    kontakte.push({ pk: t[1], name: typeof t[3] === "string" ? t[3].slice(0, MAX_NAME) : "" });
  }
  return kontakte;
}
