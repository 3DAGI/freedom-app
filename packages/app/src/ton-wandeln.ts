/**
 * Ton im Browser wandeln (Sammlung B-38c, SP-W5 A, `docs/SPRACHE-ENTWURF.md` V3): Eine Sprachnachricht – Opus in WebM
 * oder Ogg, AAC in MP4 – dekodiert der Browser selbst; daraus wird WAV in genau der Form, die der Knoten annimmt
 * (`baueWav()`, 16 kHz, mono, 16 Bit). So braucht der Knoten kein ffmpeg und liest nie einen fremden Container.
 *
 * Ohne DOM: Der Dekoder kommt von außen (im Browser `decodeAudioData` eines Kontexts mit 16 kHz).
 */
import { SPRACHE_GRENZEN, baueWav, pruefeWav } from "@freedomstack/protocol";

/** Was der Dekoder liefert: Proben je Kanal (−1 … 1) und ihre Rate. */
export interface DekodierterTon {
  rate: number;
  kanaele: Float32Array[];
}

/** Warum aus dem Ton keine WAV-Datei wird – nur über die Kennung. */
export type TonFall = "ton-unlesbar" | "ton-leer" | "ton-lang";

/** Eine Aufnahme endet bei 120 s (C-7); der Kodierer hängt ein paar Millisekunden an – die schneidet die App ab. */
export const TON_SPIELRAUM_SEK = 1;

/** Kanäle zu einem mischen – der Mittelwert, wie der Browser Stereo auf Mono bringt. */
export function mono(kanaele: Float32Array[]): Float32Array {
  const n = Math.min(...kanaele.map((k) => k.length));
  const aus = new Float32Array(n);
  for (const k of kanaele) for (let i = 0; i < n; i++) aus[i] = aus[i]! + k[i]! / kanaele.length;
  return aus;
}

/** Proben in 16 Bit – begrenzt auf −1 … 1, NaN als Stille. */
export function alsInt16(proben: Float32Array): Int16Array {
  const aus = new Int16Array(proben.length);
  for (let i = 0; i < proben.length; i++) {
    const p = Math.max(-1, Math.min(1, proben[i] || 0));
    aus[i] = Math.round(p < 0 ? p * 0x8000 : p * 0x7fff);
  }
  return aus;
}

/**
 * Eine Aufnahme als WAV für den Knoten: dekodieren (16 kHz), mischen, höchstens 120 s. Länger als 120 s plus Spielraum
 * gilt nicht – die App schneidet keine fremde Nachricht still ab. Das Ergebnis besteht `pruefeWav()`.
 */
export async function alsSpracheWav(
  bytes: Uint8Array, dekodiere: (b: Uint8Array) => Promise<DekodierterTon>,
): Promise<{ ok: true; wav: Uint8Array; sekunden: number } | { ok: false; fall: TonFall }> {
  let ton: DekodierterTon;
  try {
    ton = await dekodiere(bytes);
  } catch {
    return { ok: false, fall: "ton-unlesbar" };
  }
  if (ton.rate !== SPRACHE_GRENZEN.abtastrate || ton.kanaele.length === 0) return { ok: false, fall: "ton-unlesbar" };
  const proben = mono(ton.kanaele);
  const hoechstens = SPRACHE_GRENZEN.sekunden * SPRACHE_GRENZEN.abtastrate;
  if (proben.length > hoechstens + TON_SPIELRAUM_SEK * SPRACHE_GRENZEN.abtastrate) return { ok: false, fall: "ton-lang" };
  if (proben.length === 0) return { ok: false, fall: "ton-leer" };
  const wav = baueWav(alsInt16(proben.subarray(0, hoechstens)));
  const geprueft = pruefeWav(wav);
  return geprueft.ok ? { ok: true, wav, sekunden: geprueft.sekunden } : { ok: false, fall: "ton-unlesbar" };
}

/**
 * Der Dekoder im Browser: `decodeAudioData` eines Offline-Kontexts mit 16 kHz – er bringt den Ton selbst auf seine Rate
 * und spielt nichts ab. `null` ohne Web Audio.
 */
export function browserDekoder(): ((b: Uint8Array) => Promise<DekodierterTon>) | null {
  const Kontext = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
  if (!Kontext) return null;
  return async (b) => {
    // decodeAudioData übernimmt den Puffer – eine Kopie, damit der Abspieler seinen behält
    const puffer = await new Kontext(1, 1, SPRACHE_GRENZEN.abtastrate).decodeAudioData(b.slice().buffer);
    return { rate: puffer.sampleRate, kanaele: Array.from({ length: puffer.numberOfChannels }, (_, i) => puffer.getChannelData(i)) };
  };
}
