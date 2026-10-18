/**
 * Einem Gruppenanruf beitreten (B-34c2, Entscheidungen LK2–LK4 A, `docs/GRUPPENANRUF-ENTWURF.md`) – mit `livekit-client`
 * (2.22.4, exakt gepinnt, erst bei Bedarf geladen), Bild und Ton Ende-zu-Ende verschlüsselt:
 *
 * - Schlüssel nur aus der Gruppe (`anrufSchluessel()`, B-34b): je MLS-Epoche einer, im Ring unter `schluesselIndex()`;
 *   nach jedem Abgleich der Gruppe zieht `schluesselNachziehen()` den der neuen Epoche nach. Die Bytes werden nach dem
 *   Übergeben genullt; gemerkt wird nichts.
 * - Nur nach Zustimmung (`"warnung"`, `zustimmungNoetig()`): Die Signalverbindung zeigt dem SFU die IP-Adresse immer.
 *   Bild und Ton danach nach `beitrittsWeg()` – über den eigenen TURN nur relay, sonst direkt.
 * - Der E2EE-Worker kommt als Text aus dem Bundle (`freedom:e2ee-worker`) und startet aus einer blob:-Adresse.
 *
 * Die Oberfläche bekommt Bild und Ton nur als Spuren über `beiMedien()` (B-34d, `gruppenanruf-ui.ts`).
 */
import type { RaumGruppenanruf } from "@freedomstack/protocol";
import type { Room } from "livekit-client";
import { beitrittsWeg, SCHLUESSEL_RING, schluesselIndex } from "../gruppenanruf-ablauf.js";
import { eigenerTurnZugang } from "./anruf.js";
import { mlsKonto } from "./mls-konto.js";

export type Beitritt = "beigetreten" | "warnung" | "kein-zugang" | "kein-schluessel" | "besetzt" | "fehler";

/** Eine Spur im Anruf – eigen oder von einer Kennung (zufällig, nie ein Schlüssel). */
export interface AnrufSpur {
  art: "audio" | "video";
  spur: MediaStreamTrack;
  eigen: boolean;
}

interface Schluesselring {
  setze(roh: Uint8Array, epoche: number): Promise<void>;
}

interface Laufend {
  room: Room;
  worker: Worker;
  ring: Schluesselring;
  gruppe: string;
  anruf: string;
  epoche: number;
}

let laufend: Laufend | null = null;
let beobachter: ((spuren: AnrufSpur[] | null) => void) | null = null;

/** Wer Bild und Ton zeigt (die Oberfläche): bei jeder Änderung alle Spuren, nach dem Ende `null`. */
export function beiMedien(f: (spuren: AnrufSpur[] | null) => void): void {
  beobachter = f;
}

function melde(): void {
  const l = laufend;
  if (!l) return beobachter?.(null);
  const spuren: AnrufSpur[] = [];
  for (const p of [l.room.localParticipant, ...l.room.remoteParticipants.values()]) {
    for (const pub of p.trackPublications.values()) {
      const spur = pub.track?.mediaStreamTrack;
      if (spur && !pub.isMuted && (pub.kind === "audio" || pub.kind === "video")) spuren.push({ art: pub.kind, spur, eigen: p === l.room.localParticipant });
    }
  }
  beobachter?.(spuren);
}

/** Der Schlüssel der aktuellen Epoche aus der Gruppe – oder null (kein Konto, MLS beschäftigt, nicht Mitglied). */
async function schluesselJetzt(gruppe: string, anruf: string): Promise<{ roh: Uint8Array; epoche: number } | null> {
  const k = mlsKonto();
  if (!k) return null;
  try {
    const { mls } = await k;
    const epoche = mls.epoche(gruppe);
    return { roh: mls.anrufSchluessel(gruppe, anruf, epoche), epoche };
  } catch {
    return null;
  }
}

/** Ring mit einem Schlüssel je Epoche (gemeinsam für alle, ohne eigenes Weiterdrehen – wie der „shared key“ von livekit-client). */
async function neuerRing(lk: typeof import("livekit-client")): Promise<Schluesselring & InstanceType<typeof lk.BaseKeyProvider>> {
  class Ring extends lk.BaseKeyProvider {
    constructor() {
      super({ sharedKey: true, ratchetWindowSize: 0, failureTolerance: -1, keyringSize: SCHLUESSEL_RING });
    }
    async setze(roh: Uint8Array, epoche: number): Promise<void> {
      const kopie = roh.slice().buffer;
      roh.fill(0);
      this.onSetEncryptionKey(await lk.createKeyMaterialFromBuffer(kopie), undefined, schluesselIndex(epoche));
      new Uint8Array(kopie).fill(0);
    }
  }
  return new Ring();
}

/**
 * Beitreten: `zugestimmt` erst nach der Warnung, dass der Knoten des Anrufenden die IP sieht (nur ohne eigenen TURN).
 * `medien`: was man selbst sendet; empfangen wird alles im Anruf.
 */
export async function trittBei(gruppe: string, a: RaumGruppenanruf, p: { zugestimmt?: boolean; medien?: ("audio" | "video")[] } = {}): Promise<Beitritt> {
  if (laufend) return "besetzt";
  if (!a.zugang) return "kein-zugang";
  // Erst fragen, dann den eigenen Vermittler holen – die Signalverbindung zeigt dem SFU die IP-Adresse in jedem Fall
  if (p.zugestimmt !== true) return "warnung";
  const weg = beitrittsWeg(await eigenerTurnZugang());
  const schluessel = await schluesselJetzt(gruppe, a.anruf);
  if (!schluessel) return "kein-schluessel";

  const lk = await import("livekit-client");
  const { default: quelle } = await import("freedom:e2ee-worker");
  const ring = await neuerRing(lk);
  await ring.setze(schluessel.roh, schluessel.epoche);
  const adresse = URL.createObjectURL(new Blob([quelle], { type: "text/javascript" }));
  const worker = new Worker(adresse);
  URL.revokeObjectURL(adresse);
  const room = new lk.Room({ e2ee: { keyProvider: ring, worker } });
  for (const e of ["trackSubscribed", "trackUnsubscribed", "trackMuted", "trackUnmuted", "localTrackPublished", "localTrackUnpublished", "participantDisconnected"] as const) {
    room.on(e, melde);
  }
  // Getrennt (Knoten weg, Anruf beendet): wie verlassen
  room.on("disconnected", () => void (laufend?.room === room ? verlasse() : undefined));
  try {
    await room.setE2EEEnabled(true);
    await room.connect(a.url, a.zugang.token, { rtcConfig: weg.rtc, autoSubscribe: true });
    const medien = p.medien ?? ["audio"];
    await room.localParticipant.setMicrophoneEnabled(medien.includes("audio"));
    if (medien.includes("video")) await room.localParticipant.setCameraEnabled(true);
  } catch {
    await room.disconnect().catch(() => undefined);
    worker.terminate();
    return "fehler";
  }
  laufend = { room, worker, ring, gruppe, anruf: a.anruf, epoche: schluessel.epoche };
  melde();
  return "beigetreten";
}

/** Nach jedem Abgleich der Gruppe: neue Epoche → Schlüssel der neuen Epoche dazu (der alte bleibt im Ring). */
export async function schluesselNachziehen(gruppe: string): Promise<void> {
  const l = laufend;
  if (!l || l.gruppe !== gruppe) return;
  const s = await schluesselJetzt(l.gruppe, l.anruf);
  if (!s || s.epoche === l.epoche) {
    s?.roh.fill(0);
    return;
  }
  await l.ring.setze(s.roh, s.epoche);
  l.epoche = s.epoche;
}

/** Den Anruf verlassen – Verbindung, Worker und Schlüssel weg. */
export async function verlasse(): Promise<void> {
  const l = laufend;
  laufend = null;
  if (!l) return;
  await l.room.disconnect().catch(() => undefined);
  l.worker.terminate();
  melde();
}

/** Eigenes Mikrofon an oder aus (stumm) – nur im laufenden Anruf. */
export async function mikrofon(an: boolean): Promise<void> {
  await laufend?.room.localParticipant.setMicrophoneEnabled(an).catch(() => undefined);
  melde();
}

/** Ob und in welchem Anruf man gerade ist. */
export function imGruppenanruf(): { gruppe: string; anruf: string; room: Room } | null {
  return laufend ? { gruppe: laufend.gruppe, anruf: laufend.anruf, room: laufend.room } : null;
}
