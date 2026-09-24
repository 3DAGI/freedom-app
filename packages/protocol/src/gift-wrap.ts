/**
 * Geschenkumschlag (NIP-59): verbergen, WER mit WEM schreibt.
 *
 * DAS PROBLEM, DAS BLEIBT, WENN DER INHALT VERSCHLÜSSELT IST
 * NIP-44 schützt, was drinsteht. Nicht geschützt ist alles andere: Ein Relay
 * sieht `pubkey: A`, `tags: [["p", B]]` und den Zeitpunkt. Daraus lässt sich
 * der vollständige Sozialgraph rekonstruieren — wer mit wem, wie oft, wann.
 *
 * Für die meisten Anwendungen ist das verschmerzbar. Für einen Journalisten
 * und seine Quelle ist genau das die Information, die beide gefährdet. Der
 * Inhalt ist oft nachrangig: Dass ein bestimmter Beamter regelmäßig mit einer
 * bestimmten Redaktion schreibt, reicht bereits.
 *
 * DER AUFBAU: DREI SCHICHTEN
 *
 *   1. **Kern** — die eigentliche Nachricht, unsigniert. Unsigniert ist
 *      Absicht: Ein signierter Kern wäre ein Beweis, den der Empfänger gegen
 *      den Absender verwenden kann.
 *   2. **Siegel** — der Kern, verschlüsselt und vom echten Absender signiert.
 *      Nur der Empfänger sieht es je.
 *   3. **Umschlag** — das Siegel, verschlüsselt und mit einem
 *      **Wegwerfschlüssel** signiert. Das ist, was die Relays sehen: ein
 *      Ereignis von einem Schlüssel, der nur einmal existiert.
 *
 * WAS DAS ERREICHT
 * Ein Relay sieht: „ein unbekannter Schlüssel hat etwas an B geschickt."
 * Nicht, von wem. Bei tausend Nachrichten sieht es tausend verschiedene
 * Absender.
 *
 * WAS ES NICHT ERREICHT
 * Der **Empfänger** steht weiterhin im Klartext — sonst könnte er seine Post
 * nicht finden. Wer alle Relays beobachtet, sieht also weiterhin, wer wie viel
 * Post bekommt, und kann über Zeitkorrelation Vermutungen anstellen. Das
 * vollständig zu lösen braucht ein Mixnetz.
 *
 * Und: Der Zeitstempel des Umschlags wird **zufällig verschoben**, weil sonst
 * die exakte Gleichzeitigkeit von Absenden und Empfangen die Beziehung
 * verrät.
 */
import { NostrEvent, UnsignedEvent, buildEvent, getTag, generateKeypair, signEvent, verifyEvent } from "./event.js";
import { encryptDM, decryptDM } from "./dm.js";

/** Das Siegel: Absender bekannt, nur für den Empfänger sichtbar. */
export const KIND_SEAL = 13;
/** Der Umschlag: von einem Wegwerfschlüssel signiert. */
export const KIND_GIFT_WRAP = 1059;

/**
 * Wie weit der Zeitstempel des Umschlags zurückdatiert wird.
 *
 * Zwei Tage: genug, damit Absende- und Empfangszeit sich nicht mehr
 * zuordnen lassen, wenig genug, dass Nachrichten in vernünftiger Reihenfolge
 * ankommen.
 */
export const MAX_TIME_JITTER_SECS = 172_800;

export interface GiftWrapOptions {
  /** Feste Verschiebung statt Zufall — nur für Tests. */
  fixedJitter?: number;
  nowSecs?: number;
}

function jitter(opts: GiftWrapOptions): number {
  if (opts.fixedJitter !== undefined) return opts.fixedJitter;
  const b = crypto.getRandomValues(new Uint32Array(1))[0];
  return b % MAX_TIME_JITTER_SECS;
}

/**
 * Nachricht in einen Umschlag packen.
 *
 * Der innere Kern bleibt **unsigniert**. Das ist der Unterschied zwischen
 * „nur der Empfänger weiß, dass ich es war" und „der Empfänger kann jedem
 * beweisen, dass ich es war". Für eine Quelle ist das der Unterschied
 * zwischen Vertraulichkeit und einem unterschriebenen Geständnis.
 */
export async function giftWrap(
  inner: UnsignedEvent,
  senderSk: Uint8Array,
  senderPk: string,
  recipientPk: string,
  opts: GiftWrapOptions = {},
): Promise<NostrEvent> {
  const now = opts.nowSecs ?? Math.floor(Date.now() / 1000);

  // 1. Kern verschlüsseln und versiegeln — signiert vom echten Absender.
  const kern = JSON.stringify({ ...inner, pubkey: senderPk, sig: undefined, id: undefined });
  const siegelInhalt = await encryptDM(kern, senderSk, recipientPk);
  const siegel = signEvent(
    buildEvent(senderPk, KIND_SEAL, [], siegelInhalt, now - jitter(opts)),
    senderSk,
  );

  // 2. Siegel verschlüsseln und mit einem Wegwerfschlüssel signieren.
  const wegwerf = generateKeypair();
  const umschlagInhalt = await encryptDM(JSON.stringify(siegel), wegwerf.sk, recipientPk);

  return signEvent(
    buildEvent(
      wegwerf.pk,
      KIND_GIFT_WRAP,
      [["p", recipientPk]],
      umschlagInhalt,
      now - jitter(opts),
    ),
    wegwerf.sk,
  );
}

export interface UnwrapResult {
  ok: boolean;
  /** Der Kern, falls lesbar. */
  inner?: UnsignedEvent;
  /** Der echte Absender — aus dem Siegel, nicht aus dem Umschlag. */
  senderPubkey?: string;
  message: string;
}

/**
 * Umschlag öffnen.
 *
 * Prüft, dass der Absender im Kern derselbe ist wie der des Siegels. Ohne
 * diese Prüfung könnte jemand ein fremdes Siegel weiterreichen und einen
 * beliebigen Absender hineinschreiben — die Signatur des Siegels würde das
 * nicht auffangen, weil sie nur den verschlüsselten Inhalt deckt.
 */
export async function giftUnwrap(
  wrap: NostrEvent,
  recipientSk: Uint8Array,
): Promise<UnwrapResult> {
  if (wrap.kind !== KIND_GIFT_WRAP) {
    return { ok: false, message: "Kein Umschlag." };
  }

  let siegel: NostrEvent;
  try {
    const roh = await decryptDM(wrap.content, recipientSk, wrap.pubkey);
    siegel = JSON.parse(roh) as NostrEvent;
  } catch {
    return { ok: false, message: "Umschlag nicht für dich oder beschädigt." };
  }

  if (siegel.kind !== KIND_SEAL) {
    return { ok: false, message: "Inhalt ist kein Siegel." };
  }

  // Das Siegel muss vom angegebenen Absender signiert sein (NIP-59). Die
  // Verschluesselung allein belegt nur, dass einer der beiden Beteiligten es
  // gebaut hat – die Signatur legt fest, welcher.
  if (!verifyEvent(siegel)) {
    return { ok: false, message: "Siegel-Signatur ungültig — verworfen." };
  }

  let inner: UnsignedEvent;
  try {
    const roh = await decryptDM(siegel.content, recipientSk, siegel.pubkey);
    inner = JSON.parse(roh) as UnsignedEvent;
  } catch {
    return { ok: false, message: "Siegel nicht lesbar." };
  }

  if (inner.pubkey !== siegel.pubkey) {
    // Jemand hat ein fremdes Siegel weitergereicht und den Absender im Kern
    // geändert.
    return {
      ok: false,
      message: "Absender im Kern stimmt nicht mit dem Siegel überein — weitergereicht oder gefälscht.",
    };
  }

  return {
    ok: true,
    inner,
    senderPubkey: siegel.pubkey,
    message: "Geöffnet.",
  };
}

/**
 * Was ein Umschlag nach außen verrät.
 *
 * Als Funktion, damit die Oberfläche keine Versprechen macht, die der Aufbau
 * nicht hält.
 */
export function wrapDisclosure(): { hidden: string[]; visible: string[] } {
  return {
    hidden: [
      "Wer die Nachricht geschrieben hat",
      "Was darin steht",
      "Ob zwei Nachrichten vom selben Absender stammen",
      "Der genaue Absendezeitpunkt",
    ],
    visible: [
      "Wer sie bekommt",
      "Ungefähr wann (bis zu zwei Tage verschoben)",
      "Dass es eine Nachricht ist",
      "Wie groß sie ist",
    ],
  };
}

export function wrapInfo(): string {
  const d = wrapDisclosure();
  return [
    "Mit Umschlag sehen Relays nicht mehr, wer dir schreibt.",
    "",
    "Verborgen:",
    ...d.hidden.map((x) => `  · ${x}`),
    "",
    "Weiterhin sichtbar:",
    ...d.visible.map((x) => `  · ${x}`),
    "",
    "Der Empfänger steht im Klartext — sonst könnte er seine Post nicht",
    "finden. Wer alle Relays beobachtet, sieht also weiterhin, wer wie viel",
    "Post bekommt. Das vollständig zu verbergen bräuchte ein Mixnetz.",
  ].join("\n");
}

/**
 * Lohnt der Umschlag hier?
 *
 * Er kostet eine zusätzliche Ver- und Entschlüsselung je Nachricht und macht
 * sie etwa dreimal so groß. In einem öffentlichen Kanal ist er sinnlos — dort
 * ist ohnehin alles sichtbar.
 */
export function shouldWrap(context: {
  kind: "dm" | "kanal" | "oeffentlich";
  /** Nutzer hat es ausdrücklich verlangt. */
  forced?: boolean;
}): { wrap: boolean; reason: string } {
  if (context.forced) return { wrap: true, reason: "Ausdrücklich verlangt." };
  switch (context.kind) {
    case "dm":
      return { wrap: true, reason: "Direktnachricht — der Absender bleibt verborgen." };
    case "kanal":
      return {
        wrap: false,
        reason: "Im Kanal wissen die Mitglieder ohnehin, wer schreibt.",
      };
    default:
      return { wrap: false, reason: "Öffentlich — es gibt nichts zu verbergen." };
  }
}
