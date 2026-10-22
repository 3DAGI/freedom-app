/**
 * Text aus Sprache beim eigenen Knoten (Sammlung B-38, Entscheidungen SP-W1 A, SP-W5 A, `docs/SPRACHE-ENTWURF.md`):
 * Die App wandelt eine Aufnahme selbst in WAV – 16 kHz, mono, 16 Bit, genau die Form aus `baueWav()` –, verschlüsselt
 * sie und legt sie ins Blob-Netz (`uploadAnhang()`). Der Auftrag nennt nur Blob, Manifest und Schlüssel, nur im
 * versiegelten Kern, mit Besitzer-Nachweis, nur an den gekoppelten Knoten (docs/PROTOCOL.md 43). Der Knoten nimmt nur,
 * was `pruefeWav()` durchlässt – keine fremden Container, kein ffmpeg.
 *
 * Ton und Text sind Inhalt: nie offen, nie ins Log, beim Knoten nicht über die Antwort hinaus.
 */
import { type DateiSchluessel, istDateiSchluessel } from "./datei-krypto.js";
import { KIND_DVM_TEXT_AUS_SPRACHE } from "./kinds.js";
import { type Kopplung, mitBesitzerNachweis } from "./kopplung.js";
import { buildJobRequest } from "./dvm.js";
import { buildPrivateJobRequest } from "./private-job.js";
import type { NostrEvent } from "./event.js";
import type { Signer } from "./signer.js";

/** Grenzen – was darüber liegt, nehmen weder Knoten noch App. 120 s wie eine Sprachnachricht (C-7). */
export const SPRACHE_GRENZEN = { sekunden: 120, abtastrate: 16_000, textZeichen: 8_000 } as const;

/** Sprachen, die ein Auftrag nennen darf – `auto` lässt das Modell raten. */
export const SPRACHE_WAHL = ["de", "en", "auto"] as const;
export type SpracheWahl = (typeof SPRACHE_WAHL)[number];

/** Wo der Ton liegt: verschlüsselt im Blob-Netz (Blob-Id = SHA-256 des Chiffrats, Manifest-Id, Schlüssel). */
export interface TonVerweis {
  blob: string;
  manifest: string;
  schluessel: DateiSchluessel;
}

export interface SpracheAuftrag {
  ton: TonVerweis;
  sprache: SpracheWahl;
}

const HEX64 = /^[0-9a-f]{64}$/;

/** Den Auftrag bauen – versiegelt, mit Nachweis, ohne Gebot (der eigene Knoten rechnet den Besitzer gratis). */
export async function baueSpracheAuftrag(p: {
  sitzung: Signer; kopplung: Kopplung; auftrag: SpracheAuftrag; powBits?: number; nowSecs?: number;
}): Promise<{ wrap: NostrEvent; requestId: string }> {
  const input = spracheAuftragText(p.auftrag);
  if (!leseSpracheAuftrag(input)) throw new Error("Auftrag ungültig");
  const kern = buildJobRequest({
    kind: KIND_DVM_TEXT_AUS_SPRACHE, customerPubkey: p.sitzung.publicKey(), input, bidMsat: 0, providerPubkey: p.kopplung.knoten,
  }, p.nowSecs);
  const request = mitBesitzerNachweis(kern, p.kopplung);
  return buildPrivateJobRequest({ request, sessionSigner: p.sitzung, providerPk: p.kopplung.knoten, powBits: p.powBits, nowSecs: p.nowSecs });
}

function spracheAuftragText(a: SpracheAuftrag): string {
  const s = a.ton.schluessel;
  return JSON.stringify({
    ton: { blob: a.ton.blob, manifest: a.ton.manifest, schluessel: { alg: s.alg, key: s.key, nonce: s.nonce, ox: s.ox } },
    sprache: a.sprache,
  });
}

/** Die Eingabe streng lesen – sonst null: Blob und Manifest als 64 Zeichen Hex, ein gültiger Schlüssel, eine Sprache. */
export function leseSpracheAuftrag(text: string): SpracheAuftrag | null {
  let roh: unknown;
  try {
    roh = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof roh !== "object" || roh === null || Array.isArray(roh)) return null;
  const { ton, sprache } = roh as Record<string, unknown>;
  if (typeof ton !== "object" || ton === null || Array.isArray(ton)) return null;
  const { blob, manifest, schluessel } = ton as Record<string, unknown>;
  if (typeof blob !== "string" || !HEX64.test(blob) || typeof manifest !== "string" || !HEX64.test(manifest)) return null;
  if (!istDateiSchluessel(schluessel) || !SPRACHE_WAHL.includes(sprache as SpracheWahl)) return null;
  const s = schluessel;
  return { ton: { blob, manifest, schluessel: { alg: s.alg, key: s.key, nonce: s.nonce, ox: s.ox } }, sprache: sprache as SpracheWahl };
}

/**
 * Warum der Knoten ablehnt – nur über die Kennung (Tag `fall` der Rückmeldung), nie Text vom Knoten: Auftrag unlesbar,
 * Ton nicht vollständig zu holen oder zu öffnen, keine WAV in der Form von `baueWav()`, Whisper scheitert, Frist um,
 * schon ein Auftrag in Arbeit.
 */
export const SPRACHE_FAELLE = ["sprache-auftrag", "sprache-ton", "sprache-wav", "sprache-whisper", "sprache-zeit", "sprache-belegt"] as const;
export type SpracheFall = (typeof SPRACHE_FAELLE)[number];

/** Was der Knoten zurückgibt (6083). */
export interface Transkript {
  text: string;
  /** Länge des Tons in Sekunden (aus der WAV-Datei, nicht vom Modell). */
  sekunden: number;
}

/** Antwort des Knotens – dasselbe Format, das `leseTranskript()` liest. */
export function transkriptText(t: Transkript): string {
  return JSON.stringify({ text: t.text, sekunden: t.sekunden });
}

/** Die Antwort streng lesen – sonst null: Text bis `textZeichen` ohne Steuerzeichen außer Zeilenumbruch, Länge im Rahmen. */
export function leseTranskript(output: string): Transkript | null {
  let roh: unknown;
  try {
    roh = JSON.parse(output);
  } catch {
    return null;
  }
  if (typeof roh !== "object" || roh === null || Array.isArray(roh)) return null;
  const { text, sekunden } = roh as Record<string, unknown>;
  if (typeof text !== "string" || text.length > SPRACHE_GRENZEN.textZeichen || /[\u0000-\u0009\u000b-\u001f\u007f]/.test(text)) return null;
  if (typeof sekunden !== "number" || !Number.isFinite(sekunden) || sekunden <= 0 || sekunden > SPRACHE_GRENZEN.sekunden) return null;
  return { text, sekunden };
}

/** Warum eine WAV-Datei nicht angenommen wird – nur über die Kennung. */
export type WavFall = "wav-form" | "wav-format" | "wav-leer" | "wav-lang";

const KOPF = 44;
const BYTES_JE_SEKUNDE = SPRACHE_GRENZEN.abtastrate * 2;

/** Ton als WAV in genau der Form, die `pruefeWav()` annimmt: 44 Byte Kopf, PCM, mono, 16 kHz, 16 Bit. */
export function baueWav(proben: Int16Array): Uint8Array {
  const n = proben.length * 2;
  const aus = new Uint8Array(KOPF + n);
  const d = new DataView(aus.buffer);
  const ascii = (an: number, s: string) => { for (let i = 0; i < s.length; i++) aus[an + i] = s.charCodeAt(i); };
  ascii(0, "RIFF"); d.setUint32(4, 36 + n, true); ascii(8, "WAVE");
  ascii(12, "fmt "); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
  d.setUint32(24, SPRACHE_GRENZEN.abtastrate, true); d.setUint32(28, BYTES_JE_SEKUNDE, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true);
  ascii(36, "data"); d.setUint32(40, n, true);
  // Kleinendian wie RIFF – über DataView, nicht über die Byte-Reihenfolge des Rechners
  for (let i = 0; i < proben.length; i++) d.setInt16(KOPF + i * 2, proben[i]!, true);
  return aus;
}

/**
 * Eine WAV-Datei prüfen – nur die Form aus `baueWav()`: RIFF/WAVE, ein `fmt `-Abschnitt mit 16 Byte (PCM, mono, 16 kHz,
 * 16 Bit), danach genau ein `data`-Abschnitt bis zum Ende der Datei, höchstens `SPRACHE_GRENZEN.sekunden`. Alles andere
 * nimmt der Knoten nicht – so liest das Modell nie einen fremden Container.
 */
export function pruefeWav(b: Uint8Array): { ok: true; sekunden: number } | { ok: false; fall: WavFall } {
  if (b.length < KOPF) return { ok: false, fall: "wav-form" };
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const ascii = (an: number, s: string) => s.split("").every((c, i) => b[an + i] === c.charCodeAt(0));
  if (!ascii(0, "RIFF") || !ascii(8, "WAVE") || !ascii(12, "fmt ") || !ascii(36, "data")) return { ok: false, fall: "wav-form" };
  const n = d.getUint32(40, true);
  if (d.getUint32(4, true) !== b.length - 8 || d.getUint32(16, true) !== 16 || n !== b.length - KOPF) return { ok: false, fall: "wav-form" };
  if (d.getUint16(20, true) !== 1 || d.getUint16(22, true) !== 1 || d.getUint32(24, true) !== SPRACHE_GRENZEN.abtastrate
    || d.getUint32(28, true) !== BYTES_JE_SEKUNDE || d.getUint16(32, true) !== 2 || d.getUint16(34, true) !== 16) {
    return { ok: false, fall: "wav-format" };
  }
  if (n === 0 || n % 2 !== 0) return { ok: false, fall: n === 0 ? "wav-leer" : "wav-form" };
  if (n > SPRACHE_GRENZEN.sekunden * BYTES_JE_SEKUNDE) return { ok: false, fall: "wav-lang" };
  return { ok: true, sekunden: n / BYTES_JE_SEKUNDE };
}
