/**
 * Anrufe in der App (Sammlung B-13d2, Entscheidungen T1 A, T2 A, T3 B) – was
 * ohne DOM und ohne WebRTC geht, damit testbar.
 *
 * - Gesprochen wird nur über einen Vermittler (TURN, `iceTransportPolicy:
 *   "relay"`): der eigene (gekoppelter Knoten) zuerst; hat die Angerufene
 *   keinen, der Zugang aus dem Angebot der Anruferin (T3 B) – dann sieht deren
 *   Knoten die IP, und die App sagt das vor dem Annehmen.
 * - Was hinausgeht, nur mit Relay-Kandidaten (`nurRelaySdp()`,
 *   `sendbarerKandidat()`) – geprüft wie beim Empfänger.
 * - Der Zustand eines Anrufs ist eine reine Funktion der Ereignisse
 *   (`naechsterZustand()`), mit festen Fristen.
 * - Damit ein Anruf sofort klingelt (B-13e, T4 A), hält die App ein Abo an
 *   den eigenen Schlüssel offen; entschlüsselt wird daraus nur, was
 *   `vielleichtAnruf()` am offenen Umschlag durchlässt.
 */
import {
  ANRUF_GRENZEN, istRelayKandidat, pruefeSdpNurRelay, type AnrufNachricht, type EndeGrund, type Medium, type TurnZugang,
} from "@freedomstack/protocol";

/**
 * So lange klingelt es, bevor der Anruf als „zeit“ endet – drei Minuten (T4 A), damit auch ein per „Wecken“
 * geöffneter Browser rechtzeitig ist; das Angebot selbst gilt fünf Minuten.
 */
export const KLINGELN_SEK = 180;
/** So lange darf der Aufbau nach dem Annehmen dauern (ICE über den Vermittler). */
export const VERBINDEN_SEK = 30;

/**
 * Vorfilter am offenen Umschlag (B-13e): Nur was wie ein Anruf aussieht, wird entschlüsselt – jetzt
 * erstellt (Anrufe tragen keinen Zeitversatz) und mit einem Ablauf von höchstens fünf Minuten. Chat-Umschläge
 * sind zurückdatiert (6.4) oder laufen länger; sie kommen weiter mit dem Abgleich des Posteingangs. So kostet
 * das Abo auch mit einem entfernten Signer (Bunker) keine Entschlüsselung je Nachricht.
 */
export function vielleichtAnruf(w: { kind: number; created_at: number; tags: string[][] }, jetzt: number): boolean {
  if (w.kind !== 1059 || w.created_at < jetzt - ANRUF_GRENZEN.ablaufSek || w.created_at > jetzt + 60) return false;
  const ablauf = Number(w.tags.find((t) => t[0] === "expiration")?.[1]);
  return Number.isSafeInteger(ablauf) && ablauf > jetzt && ablauf <= w.created_at + ANRUF_GRENZEN.ablaufSek;
}

/** `RTCIceServer` aus einem Zugang – nur die geprüften `turn:`/`turns:`-Adressen, mit Nutzer und Passwort. */
export function iceServerAus(z: TurnZugang): { urls: string[]; username: string; credential: string } {
  return { urls: [...z.urls], username: z.nutzer, credential: z.passwort };
}

/**
 * Welcher Vermittler: der eigene zuerst; sonst der Zugang aus dem Angebot
 * (`fremd` – vor dem Annehmen sagen, dass der Knoten der Anruferin die IP
 * sieht); sonst keiner – dann geht kein Anruf.
 */
export function waehleVermittler(eigener: TurnZugang | null, ausAngebot?: TurnZugang): { zugang: TurnZugang; fremd: boolean } | null {
  if (eigener) return { zugang: eigener, fremd: false };
  return ausAngebot ? { zugang: ausAngebot, fremd: true } : null;
}

/**
 * SDP vor dem Senden: nur Relay-Kandidaten behalten (mit `iceTransportPolicy:
 * "relay"` sammelt der Browser ohnehin nur die), danach geprüft wie beim
 * Empfänger. null, wenn es so nicht hinausdarf (etwa ohne Fingerabdruck).
 */
export function nurRelaySdp(sdp: string): string | null {
  const zeilen = sdp.split(/\r?\n/).filter((z) => !z.startsWith("a=candidate:") || istRelayKandidat(z.slice(2)));
  const neu = zeilen.join("\r\n");
  return pruefeSdpNurRelay(neu) ? neu : null;
}

/** Ein gesammelter Kandidat als Nachricht – nur vom Typ `relay`; das leere Ende der Sammlung geht nicht hinaus. */
export function sendbarerKandidat(
  anruf: string, c: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null },
): Extract<AnrufNachricht, { typ: "kandidat" }> | null {
  if (!c.candidate || !istRelayKandidat(c.candidate)) return null;
  return { anruf, typ: "kandidat", kandidat: { candidate: c.candidate, sdpMid: c.sdpMid ?? null, sdpMLineIndex: c.sdpMLineIndex ?? null } };
}

export type AnrufPhase = "klingelt" | "eingehend" | "verbindet" | "verbunden" | "beendet";

export interface Anruf {
  kennung: string;
  /** Person auf der anderen Seite (nicht der Geräteschlüssel). */
  partner: string;
  richtung: "aus" | "ein";
  medien: Medium[];
  phase: AnrufPhase;
  /** Nur bei eingehenden: läuft über den Vermittler der Anruferin (T3 B). */
  fremderVermittler: boolean;
  /** Sekunden – Beginn der aktuellen Phase. */
  seit: number;
  grund?: EndeGrund;
}

export type AnrufEreignis =
  | { art: "angenommen"; jetzt: number }
  | { art: "antwort"; jetzt: number }
  | { art: "verbunden"; jetzt: number }
  | { art: "ende"; grund: EndeGrund; jetzt: number }
  | { art: "takt"; jetzt: number };

/** Nächster Zustand – Ende ist endgültig; Fristen beenden mit „zeit“. Unpassende Ereignisse ändern nichts. */
export function naechsterZustand(a: Anruf, e: AnrufEreignis): Anruf {
  if (a.phase === "beendet") return a;
  const neu = (phase: AnrufPhase, grund?: EndeGrund): Anruf => ({ ...a, phase, seit: e.jetzt, ...(grund ? { grund } : {}) });
  switch (e.art) {
    case "ende":
      return neu("beendet", e.grund);
    case "angenommen":
      return a.phase === "eingehend" ? neu("verbindet") : a;
    case "antwort":
      return a.phase === "klingelt" ? neu("verbindet") : a;
    case "verbunden":
      return a.phase === "verbindet" ? neu("verbunden") : a;
    case "takt": {
      const frist = a.phase === "klingelt" || a.phase === "eingehend" ? KLINGELN_SEK : a.phase === "verbindet" ? VERBINDEN_SEK : Infinity;
      return e.jetzt - a.seit >= frist ? neu("beendet", "zeit") : a;
    }
  }
}

/**
 * Ein eingehendes Angebot annehmen? Nur von einem Kontakt; läuft schon ein
 * Anruf, ist besetzt. Von Fremden kommt keine Antwort – nicht einmal
 * „besetzt“, das verriete, dass die App offen ist.
 */
export function eingehendesAngebot(p: { vonKontakt: boolean; laufend: Anruf | null }): "klingeln" | "besetzt" | "still" {
  if (!p.vonKontakt) return "still";
  return p.laufend && p.laufend.phase !== "beendet" ? "besetzt" : "klingeln";
}
