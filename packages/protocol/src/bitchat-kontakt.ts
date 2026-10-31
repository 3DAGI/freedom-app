/**
 * Bitchat zwischen Freedom-Kontakten (B-36c1, BC-W2 A, BC-W3 A, `docs/BITCHAT-ENTWURF.md`, `docs/PROTOCOL.md` §45):
 *
 * - **Schlüssel an Kontakte:** Wer einem Kontakt über Bitchat schreiben will, braucht dessen Noise-Schlüssel (daraus die
 *   Peer-ID) und Signier-Schlüssel. Die App gibt beide nur versiegelt an Kontakte – je Kontakt ein Umschlag (1059), innen
 *   Kind 38083 mit den Tags `["noise", <64 Hex>]` und `["signier", <64 Hex>]`, wie die Reticulum-Adresse (38082). Nie offen:
 *   Sonst verbände jeder den Nostr-Schlüssel mit einem Gerät im Funk.
 * - **Umschläge in der Noise-Sitzung:** Der Klartext einer Noise-Nachricht beginnt bei Bitchat mit dem Typ der Nutzlast
 *   (`NoisePayloadType`). Freedom nimmt `0xF0`, den Bitchat nicht vergibt (Swift `5e9287f`: 0x01–0x09, 0x10–0x12, 0x20,
 *   0x21), und dahinter genau einen Umschlag als JSON – geprüft wie alles im Mesh (`pruefeMeshInhalt()`).
 * - **Schlüssel beim Treffen** (B-36e1, BC-W5 A, BC-W6 A): eine „Bitchat-Karte“ für den QR-Code – Person, beide Schlüssel,
 *   Zeit und die Signatur der Person über ein Event 38083 mit genau diesen Tags. Das Event geht nie an ein Relay.
 */
import { computeEventId, verifyEvent, type NostrEvent, type UnsignedEvent } from "./event.js";
import { giftUnwrapMitSigner, giftWrapMitSigner } from "./gift-wrap.js";
import { MeshKind, pruefeMeshInhalt } from "./mesh-transport.js";
import type { Signer } from "./signer.js";

export const KIND_BITCHAT_SCHLUESSEL = 38083;
/** Typ der Nutzlast für einen Freedom-Umschlag in einer Noise-Sitzung */
export const BITCHAT_FREEDOM_UMSCHLAG = 0xf0;

const HEX64 = /^[0-9a-f]{64}$/;

/** Je Kontakt ein Umschlag mit den eigenen Bitchat-Schlüsseln – nicht an sich selbst, nichts Ungültiges. */
export async function baueBitchatSchluesselUmschlaege(p: {
  von: Signer; an: readonly string[]; noise: string; signier: string; nowSecs?: number;
}): Promise<NostrEvent[]> {
  const ich = p.von.publicKey();
  const an = [...new Set(p.an)].filter((k) => HEX64.test(k) && k !== ich);
  if (an.length === 0 || !HEX64.test(p.noise) || !HEX64.test(p.signier)) return [];
  const now = p.nowSecs ?? Math.floor(Date.now() / 1000);
  const kern: UnsignedEvent = {
    pubkey: ich, kind: KIND_BITCHAT_SCHLUESSEL, created_at: now, content: "", tags: [["noise", p.noise], ["signier", p.signier]],
  };
  return Promise.all(an.map((k) => giftWrapMitSigner(kern, p.von, k, { nowSecs: now })));
}

/** Anfang der Bitchat-Karte im QR-Code (Fassung 1) */
export const BITCHAT_KARTE_PRAEFIX = "freedom-bitchat:1:";
/** So weit darf die Zeit einer Karte in der Zukunft liegen – Uhren gehen verschieden (Freedom-Wert) */
export const BITCHAT_KARTE_ZUKUNFT_SEK = 600;
const KARTE = /^freedom-bitchat:1:([0-9a-f]{64}):([0-9a-f]{64}):([0-9a-f]{64}):(0|[1-9][0-9]{0,11}):([0-9a-f]{128})$/;

const karteEvent = (person: string, noise: string, signier: string, zeit: number): UnsignedEvent => ({
  pubkey: person, kind: KIND_BITCHAT_SCHLUESSEL, created_at: zeit, content: "", tags: [["noise", noise], ["signier", signier]],
});

/**
 * Die eigene Bitchat-Karte für den QR-Code beim Treffen: `freedom-bitchat:1:<person>:<noise>:<signier>:<zeit>:<signatur>`.
 * Signiert wird ein Event 38083 mit genau den zwei Tags, nur damit die Karte die Person bindet – es geht nie an ein Relay.
 * Ungültige Schlüssel oder ein Signer, der etwas anderes signiert: null.
 */
export async function baueBitchatKarte(p: { von: Signer; noise: string; signier: string; nowSecs?: number }): Promise<string | null> {
  if (!HEX64.test(p.noise) || !HEX64.test(p.signier) || p.noise === p.signier) return null;
  const zeit = p.nowSecs ?? Math.floor(Date.now() / 1000);
  const ev = await p.von.signEvent(karteEvent(p.von.publicKey(), p.noise, p.signier, zeit));
  const karte = `${BITCHAT_KARTE_PRAEFIX}${ev.pubkey}:${p.noise}:${p.signier}:${zeit}:${ev.sig}`;
  return leseBitchatKarte(karte, zeit)?.von === p.von.publicKey() ? karte : null;
}

/**
 * Eine gescannte Bitchat-Karte lesen: genau die Form (Kleinbuchstaben, keine führenden Nullen), zwei verschiedene Schlüssel,
 * Zeit höchstens `BITCHAT_KARTE_ZUKUNFT_SEK` voraus, Signatur der genannten Person – sonst null. Ob die Person schon Kontakt
 * ist, entscheidet die App (BC-W6 A: nach Rückfrage anlegen).
 */
export function leseBitchatKarte(text: string, nowSecs = Math.floor(Date.now() / 1000)): BitchatSchluesselVonKontakt | null {
  const m = KARTE.exec(text.trim());
  if (!m) return null;
  const [, von = "", noise = "", signier = "", z = "", sig = ""] = m;
  const zeit = Number(z);
  if (noise === signier || !Number.isSafeInteger(zeit) || zeit > nowSecs + BITCHAT_KARTE_ZUKUNFT_SEK) return null;
  const e = karteEvent(von, noise, signier, zeit);
  return verifyEvent({ ...e, id: computeEventId(e), sig }) ? { von, zeit, noise, signier } : null;
}

/** Empfangene Bitchat-Schlüssel eines Kontakts: von wem, wann geschrieben, Noise- und Signier-Schlüssel (Hex). */
export interface BitchatSchluesselVonKontakt {
  von: string;
  zeit: number;
  noise: string;
  signier: string;
}

/**
 * Umschlag öffnen: die Bitchat-Schlüssel eines der eigenen Kontakte? Sonst null – Fremde zählen nicht, der Kern stammt vom
 * Siegel-Autor und trägt genau die zwei Tags in dieser Reihenfolge und sonst nichts.
 */
export async function oeffneBitchatSchluesselUmschlag(
  wrap: NostrEvent, signer: Signer, kontakte: ReadonlySet<string>,
): Promise<BitchatSchluesselVonKontakt | null> {
  const u = await giftUnwrapMitSigner(wrap, signer).catch(() => null);
  if (!u?.ok || !u.inner || !u.senderPubkey || u.inner.kind !== KIND_BITCHAT_SCHLUESSEL || u.inner.pubkey !== u.senderPubkey) return null;
  if (!kontakte.has(u.senderPubkey) || !Number.isSafeInteger(u.inner.created_at) || u.inner.content !== "") return null;
  const [n, s, ...mehr] = u.inner.tags;
  if (mehr.length > 0 || n?.length !== 2 || s?.length !== 2 || n[0] !== "noise" || s[0] !== "signier") return null;
  if (!HEX64.test(n[1] ?? "") || !HEX64.test(s[1] ?? "") || n[1] === s[1]) return null;
  return { von: u.senderPubkey, zeit: u.inner.created_at, noise: n[1]!, signier: s[1]! };
}

/**
 * Klartext für die Noise-Sitzung: Typ `0xF0` und der Umschlag als JSON – nur, was `pruefeMeshInhalt()` als Umschlag
 * durchlässt (mit den eigenen Schlüsseln: Die eigene Kopie geht nie hinaus). Sonst null.
 */
export function bitchatUmschlagKlartext(umschlag: Uint8Array, eigeneSchluessel: readonly string[]): Uint8Array | null {
  const r = pruefeMeshInhalt(umschlag, MeshKind.NostrEvent, { eigeneSchluessel });
  if (!r.ok || r.art !== "umschlag") return null;
  const aus = new Uint8Array(umschlag.length + 1);
  aus[0] = BITCHAT_FREEDOM_UMSCHLAG;
  aus.set(umschlag, 1);
  return aus;
}

/** Der Umschlag aus dem Klartext einer Noise-Nachricht – nur Typ `0xF0` mit einem gültigen Umschlag, sonst null. */
export function leseBitchatUmschlag(klartext: Uint8Array): Uint8Array | null {
  if (klartext[0] !== BITCHAT_FREEDOM_UMSCHLAG) return null;
  const umschlag = klartext.slice(1);
  const r = pruefeMeshInhalt(umschlag, MeshKind.NostrEvent);
  return r.ok && r.art === "umschlag" ? umschlag : null;
}
