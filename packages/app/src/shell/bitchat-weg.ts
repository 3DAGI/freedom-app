/**
 * Bitchat in der App (B-36c2b2, BC-W2 A): der Knoten an der Hülle – nur nach `starteBitchat()` (auf Klick, c3) und nur unter
 * Android. Die Identität kommt aus `geheim` (`bitchatIdentitaet()`), die Kontakte mit ihren Schlüsseln aus dem Buch (38083).
 * Direktnachrichten: Nimmt kein Relay die Kopie an den Empfänger, geht sie über Bitchat, wenn sein Gerät in der Nähe ist
 * (`dmUeberBitchat()` in `zustellenDm()`, vor Reticulum). Umschläge an mich öffnet `nimmPostAusFunk()` – auch ohne Netz.
 */
import { BitchatKnoten, bitchatIdentitaet, type BitchatKontakt, type NostrEvent } from "@freedomstack/protocol";
import { BITCHAT_LAUF, BitchatLauf } from "../bitchat-lauf.js";
import { t } from "../i18n.js";
import { type BitchatStandArt, bitchatAufruf, bitchatHolen, bitchatSenden, bitchatStand, bitchatStarten, bitchatStoppen } from "./bitchat-huelle.js";
import { bitchatSchluesselBuch } from "./bitchat-kontakte.js";
import { kontakteJetzt } from "./quittungen.js";
import { state } from "./state.js";
import { geheim } from "./tresor.js";
import { toast } from "./ui.js";

let lauf: BitchatLauf | null = null;
let zeitgeber: ReturnType<typeof setTimeout> | null = null;

const ausHex = (h: string): Uint8Array => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));

/** Die Kontakte, deren Bitchat-Schlüssel da sind – nur, wer noch Kontakt ist. */
function kontakte(): BitchatKontakt[] {
  return bitchatSchluesselBuch.vonKontakten(new Set(kontakteJetzt())).map(({ pk, adresse }) => {
    const [noise = "", signier = ""] = adresse.split(":");
    return { person: pk, noise: ausHex(noise), signier: ausHex(signier) };
  });
}

async function nimmUmschlag(u: Uint8Array): Promise<void> {
  const { nimmPostAusFunk } = await import("./tabs/posteingang.js");
  await nimmPostAusFunk(JSON.parse(new TextDecoder().decode(u)) as NostrEvent).catch(() => false);
}

/** Der Takt gehört zu genau einem Lauf: Wird während eines Schritts angehalten oder neu gestartet, endet der alte Takt. */
function takt(l: BitchatLauf): void {
  zeitgeber = setTimeout(async () => {
    const weiter = await l.schritt().catch(() => false);
    if (lauf !== l) return;
    if (weiter) takt(l);
    else halt();
  }, BITCHAT_LAUF.schrittMs);
}

function halt(): void {
  if (zeitgeber) clearTimeout(zeitgeber);
  zeitgeber = null;
  lauf = null;
}

/** Bitchat starten – nur auf Klick: Android fragt dann nach den Rechten. Ergebnis: der Stand der Hülle. */
export async function starteBitchat(): Promise<BitchatStandArt | null> {
  const aufruf = bitchatAufruf();
  if (!aufruf) return null;
  const s = await bitchatStarten(aufruf);
  if (s !== "an" || lauf) return s;
  const ich = await bitchatIdentitaet(geheim);
  if (lauf) return s; // zwei Klicks kurz nacheinander: ein Lauf
  const l = new BitchatLauf({
    knoten: new BitchatKnoten(ich, { eigeneSchluessel: state.keypair ? [state.keypair.pk] : [] }),
    stand: () => bitchatStand(aufruf),
    hole: () => bitchatHolen(aufruf),
    sende: (id, wert) => bitchatSenden(id, wert, aufruf),
    kontakte,
    post: (u) => void nimmUmschlag(u).catch(() => undefined),
    spaeter: (ms, f) => void setTimeout(f, ms),
    jetzt: () => Date.now(),
  });
  lauf = l;
  takt(l);
  return s;
}

/** Bitchat anhalten – die Hülle trennt alle Verbindungen. */
export async function stoppeBitchat(): Promise<void> {
  halt();
  await bitchatStoppen();
}

export const bitchatLaeuft = (): boolean => lauf !== null;

/** Personen, deren Gerät gerade über Bitchat in der Nähe ist */
export const bitchatInDerNaehe = (): string[] => lauf?.inDerNaehe() ?? [];

/** Eine Direktnachricht über Bitchat – nur, wenn es läuft und das Gerät des Empfängers in der Nähe ist. */
export function dmUeberBitchat(wrap: NostrEvent, an: string): boolean {
  const hinaus = lauf?.sende(an, new TextEncoder().encode(JSON.stringify(wrap))) ?? false;
  if (hinaus) toast(t("set.bitchatDm"));
  return hinaus;
}
