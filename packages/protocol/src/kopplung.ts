/**
 * Knoten mit seinem Besitzer koppeln (Sammlung B-8, Entscheidung L1 A).
 *
 * DAS PROBLEM
 * KI-Anfragen kommen absichtlich von Wegwerf-Schlüsseln (3.1) – der Knoten
 * kann seinen Besitzer daran nicht erkennen und behandelt ihn wie jeden
 * Fremden: Kontingent, Gebot, Bezahlung.
 *
 * WAS HIER GEBAUT IST
 * Ein Kopplungsgeheimnis: Der Knoten erzeugt es (`neueKopplung()`) und zeigt
 * es als Kopplungscode (QR); die App legt es im Tresor ab. Jede Anfrage an den
 * eigenen Knoten trägt im versiegelten Kern einen Nachweis
 * (`mitBesitzerNachweis()`): HMAC-SHA256 mit dem Geheimnis über
 * Sitzungsschlüssel und Zeit der Anfrage – nie das Geheimnis selbst. Der
 * Knoten prüft ihn mit `istBesitzer()` (Zeitfenster, Vergleich in fester
 * Zeit) und nur bei Anfragen aus einem Umschlag; offen steht der Nachweis nie
 * (Leak-Regel „besitzer-versiegelt“).
 *
 * Kopplungscode: `freedom-kopplung:1:<knoten-hex>:<geheimnis-hex>`.
 */
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import { type UnsignedEvent, getTag } from "./event.js";
import { ProtokollFehler } from "./fehler.js";

export const KOPPLUNG_PRAEFIX = "freedom-kopplung:1:";
/** Tag des Nachweises – nur im versiegelten Kern. */
export const BESITZER_TAG = "besitzer";
/** So weit (Sekunden) darf die Zeit der Anfrage von der Uhr des Knotens abweichen. */
export const BESITZER_FENSTER = 600;

export interface Kopplung {
  /** Schlüssel des Knotens (hex). */
  knoten: string;
  /** 32 Byte, hex – liegt beim Knoten in einer Datei, in der App im Tresor. */
  geheimnis: string;
}

const HEX64 = /^[0-9a-f]{64}$/;
const CODE = /^freedom-kopplung:1:([0-9a-f]{64}):([0-9a-f]{64})$/;

/** Neue Kopplung für diesen Knoten – frisches Geheimnis. Ein neues ersetzt das alte (so widerruft der Besitzer). */
export function neueKopplung(knoten: string): Kopplung {
  if (!HEX64.test(knoten)) throw new ProtokollFehler("kopplung-knoten", "Kopplung: kein gültiger Schlüssel des Knotens");
  return { knoten, geheimnis: bytesToHex(randomBytes(32)) };
}

export const kopplungscode = (k: Kopplung): string => `${KOPPLUNG_PRAEFIX}${k.knoten}:${k.geheimnis}`;

/** Kopplungscode lesen (eingefügt oder gescannt) – streng; sonst null. */
export function leseKopplungscode(text: string): Kopplung | null {
  const m = CODE.exec(text.trim());
  return m ? { knoten: m[1]!, geheimnis: m[2]! } : null;
}

/** Der Nachweis: HMAC-SHA256(Geheimnis, „freedomstack-besitzer-v1:<sitzung>:<zeit>“), hex. */
export function besitzerNachweis(geheimnis: string, sitzung: string, zeit: number): string {
  if (!HEX64.test(geheimnis)) throw new ProtokollFehler("kopplung-geheimnis", "Kopplung: kein gültiges Geheimnis");
  return bytesToHex(hmac(sha256, hexToBytes(geheimnis), new TextEncoder().encode(`freedomstack-besitzer-v1:${sitzung}:${zeit}`)));
}

/**
 * Den Nachweis in den Kern einer Anfrage an den eigenen Knoten setzen – vor
 * dem Versiegeln (der Kern wird danach signiert). Nur an den gekoppelten
 * Knoten: Steht ein anderer im p-Tag, wirft es.
 */
export function mitBesitzerNachweis<T extends UnsignedEvent>(kern: T, k: Kopplung): T {
  if (getTag(kern, "p") !== k.knoten) throw new ProtokollFehler("kopplung-fremd", "Besitzer-Nachweis nur an den gekoppelten Knoten");
  return { ...kern, tags: [...kern.tags.filter((t) => t[0] !== BESITZER_TAG), [BESITZER_TAG, besitzerNachweis(k.geheimnis, kern.pubkey, kern.created_at)]] };
}

function gleich(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!;
  return d === 0;
}

/**
 * Kommt die Anfrage vom gekoppelten Besitzer? Genau ein Nachweis, die Zeit im
 * Fenster, und er passt zu einem der Geheimnisse (Vergleich in fester Zeit).
 * Nur für Anfragen aus einem Umschlag aufrufen – offen gilt er nie.
 */
export function istBesitzer(kern: UnsignedEvent, geheimnisse: readonly string[], jetzt: number): boolean {
  const tags = kern.tags.filter((t) => t[0] === BESITZER_TAG);
  if (tags.length !== 1 || !HEX64.test(tags[0]![1] ?? "")) return false;
  if (!Number.isSafeInteger(kern.created_at) || Math.abs(kern.created_at - jetzt) > BESITZER_FENSTER) return false;
  const gesendet = hexToBytes(tags[0]![1]!);
  return geheimnisse.filter((g) => HEX64.test(g)).some((g) => gleich(hexToBytes(besitzerNachweis(g, kern.pubkey, kern.created_at)), gesendet));
}
