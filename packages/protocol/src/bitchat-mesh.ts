/**
 * Fluten im Bitchat-Netz (B-36a4, BC-W2 A, `docs/BITCHAT-ENTWURF.md`): Doppeltes erkennen und entscheiden, ob und mit
 * welcher TTL ein Paket weitergeht – wie `RelayController` und `BLEIngressLinkRegistry` im gemeinfreien Swift-Code
 * (Whitepaper §4.2). Freedom reicht Pakete anderer weiter wie jedes Bitchat-Gerät (sonst trüge es nichts zum Netz bei),
 * gibt sie aber nur roh weiter: `mitBitchatTtl()` setzt das TTL-Byte im empfangenen Paket – Signatur, Polster und gepackte
 * Nutzlast bleiben unberührt. Was der eigenen App gilt, entscheidet der Aufrufer (B-36c); hier gibt es keinen Zufall außer
 * dem Versatz, und den gibt der Aufrufer mit.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { BITCHAT_GRENZEN, BITCHAT_TYP, type BitchatPaket, kodiereBitchat, zerlegeBitchat } from "./bitchat-paket.js";

/** Werte aus `TransportConfig` (Swift) */
export const BITCHAT_FLUTEN = Object.freeze({
  /** Ab so vielen Nachbarn gilt das Netz als dicht */
  dicht: 6,
  doppeltAnzahl: 1000,
  doppeltMs: 5 * 60_000,
  fragmentTtl: 7,
  fragmentTtlDicht: 5,
});

/** Typen, die Bitchat außer Noise gerichtet und immer weiterreicht (`isDirectedEncrypted`) */
const GERICHTET = new Set<number>([BITCHAT_TYP.noiseVerschluesselt, 0x04, 0x26, 0x27, 0x28]); // Kurier, Ping, Pong, Nostr-Träger
const SYNC_ANFRAGE = 0x21;
const SPRACHE = 0x29;

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** Kennung zum Doppelt-Erkennen wie `BLEIngressLinkRegistry.messageID`: Absender, Zeit, Typ, 4 Byte SHA-256 der Nutzlast */
export function bitchatNachrichtId(p: BitchatPaket): string {
  return `${hex(p.absender)}-${p.zeit}-${p.typ}-${hex(sha256(p.nutzlast).subarray(0, 4))}`;
}

/** Schon Gesehenes: höchstens 1000 Kennungen, je 5 Minuten (älteste fallen zuerst). */
export class BitchatDoppel {
  private readonly gesehen = new Map<string, number>();

  /** true, wenn das Paket neu ist – dann ist es ab jetzt gesehen */
  neu(p: BitchatPaket, jetzt: number): boolean {
    for (const [id, zeit] of this.gesehen) {
      if (jetzt - zeit <= BITCHAT_FLUTEN.doppeltMs) break;
      this.gesehen.delete(id);
    }
    const id = bitchatNachrichtId(p);
    if (this.gesehen.has(id)) return false;
    this.gesehen.set(id, jetzt);
    if (this.gesehen.size > BITCHAT_FLUTEN.doppeltAnzahl) this.gesehen.delete(this.gesehen.keys().next().value!);
    return true;
  }

  get anzahl(): number {
    return this.gesehen.size;
  }
}

export interface BitchatWeitergabe {
  weiter: boolean;
  ttl: number;
  /** Versatz in ms – damit Doppeltes oft vorher ankommt und das Weiterreichen entfällt */
  versatzMs: number;
}

const ZUFALL_STANDARD = (): number => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
const zwischen = (z: () => number, a: number, b: number): number => a + Math.floor(z() * (b - a + 1));

/**
 * Ob und wie ein empfangenes Paket weitergeht – `RelayController.decide`. `eigen` ist die eigene Peer-ID, `grad` die
 * Zahl der verbundenen Nachbarn, `zufall` liefert Werte in [0, 1) (im Test fest).
 */
export function bitchatWeiterreichen(
  p: BitchatPaket,
  o: { eigen: Uint8Array; grad: number; zufall?: () => number },
): BitchatWeitergabe {
  const z = o.zufall ?? ZUFALL_STANDARD;
  const ttl = Math.min(p.ttl, BITCHAT_GRENZEN.ttl);
  const nicht = { weiter: false, ttl, versatzMs: 0 };
  if (p.typ === SYNC_ANFRAGE) return nicht;
  const vonMir = hex(p.absender) === hex(o.eigen);
  const anMich = p.empfaenger !== undefined && hex(p.empfaenger) === hex(o.eigen);
  if (ttl <= 1 || vonMir || anMich) return nicht;
  const gerichtet = p.empfaenger !== undefined && (GERICHTET.has(p.typ) || p.typ === BITCHAT_TYP.fragment);
  if (p.typ === BITCHAT_TYP.noiseHandshake || gerichtet) {
    const versatz = p.typ === BITCHAT_TYP.noiseHandshake ? zwischen(z, 10, 35) : zwischen(z, 20, 60);
    return { weiter: true, ttl: ttl - 1, versatzMs: versatz };
  }
  const dicht = o.grad >= BITCHAT_FLUTEN.dicht;
  if (p.typ === BITCHAT_TYP.fragment || p.typ === SPRACHE) {
    const grenze = Math.min(ttl, dicht ? BITCHAT_FLUTEN.fragmentTtlDicht : BITCHAT_FLUTEN.fragmentTtl);
    if (grenze <= 1) return { ...nicht, ttl: grenze };
    return { weiter: true, ttl: grenze - 1, versatzMs: zwischen(z, 8, 25) };
  }
  const grenze = dicht
    ? Math.max(2, Math.min(ttl, 5))
    : o.grad <= 2
      ? ttl
      : Math.max(2, Math.min(ttl, p.typ === BITCHAT_TYP.ankuendigung ? 7 : 6));
  const versatz =
    o.grad <= 2 ? zwischen(z, 10, 40) : o.grad <= 5 ? zwischen(z, 60, 150) : o.grad <= 9 ? zwischen(z, 80, 180) : zwischen(z, 100, 220);
  return { weiter: true, ttl: grenze - 1, versatzMs: versatz };
}

/**
 * Was über eine Verbindung hinausgeht, die je Schreiben oder Meldung `grenze` Byte fasst (MTU − 3): das Paket ganz, sonst
 * seine Fragmente – wie `fragmentChunkSize(forLinkLimit:)`. Bitchat liest jeden Wert als ein Paket (bitchat-android setzt
 * keine Stücke zusammen), also verteilt die Hülle nie ein Paket auf zwei Werte. Aufgefüllt werden nur Noise-Pakete
 * (`padsBLEFrame`); zerlegt wird dann das gepolsterte Paket. Bei einem Rundruf über mehrere Verbindungen gilt die kleinste
 * Grenze, damit alle dieselben Fragmente bekommen. Weitergereichtes (`mitBitchatTtl()`) geht roh und nur über
 * Verbindungen, die es fassen.
 */
export function bitchatFuerVerbindung(p: BitchatPaket, o: { grenze: number; kennung: Uint8Array }): Uint8Array[] {
  const polster = p.typ === BITCHAT_TYP.noiseHandshake || p.typ === BITCHAT_TYP.noiseVerschluesselt;
  const ganz = kodiereBitchat(p, { polster });
  if (ganz.length <= o.grenze) return [ganz];
  return zerlegeBitchat(p, o.kennung, { grenze: o.grenze, polster }).map((f) => kodiereBitchat(f));
}

/** Das empfangene Paket mit neuer TTL – nur das dritte Byte ändert sich (die Signatur schließt die TTL aus). */
export function mitBitchatTtl(roh: Uint8Array, ttl: number): Uint8Array {
  if (roh.length < 3 || !Number.isInteger(ttl) || ttl < 0 || ttl > 0xff) throw new RangeError("ttl");
  const aus = roh.slice();
  aus[2] = ttl;
  return aus;
}
