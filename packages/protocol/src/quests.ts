/**
 * Aufgaben: Abzeichen aus nachweisbarer Arbeit – ohne Geld.
 *
 * WARUM NUR NACHWEISBARE AUFGABEN
 * Der naheliegende Entwurf mischt zwei Arten: „folge uns auf X" und „betreibe
 * sieben Tage einen Knoten". Sie sehen gleich aus und verhalten sich
 * gegenteilig.
 *
 * Die zweite Art ist **im Protokoll nachweisbar** — die Leistungsnachweise
 * liegen signiert vor, jeder kann sie nachrechnen, und wer sie fälschen will,
 * muss die Arbeit tatsächlich leisten. Die erste Art braucht einen Prüfer, der
 * bei einer fremden Plattform nachsieht – eine zentrale Stelle und eine
 * Abhängigkeit von der API eines Anbieters, gegen den das Projekt antritt.
 *
 * Deshalb kennt dieses Modul **nur Aufgaben, deren Nachweis schon als
 * signiertes Ereignis im System liegt**; alles andere steht in
 * `BADGE_ONLY_TASKS` und wird von Hand vergeben.
 *
 * KEIN GELD (seit 5.1.4c, Gebührenmodell A+)
 * Früher zahlte ein Aufgaben-Topf aus dem Belohnungs-Pool Prämien. Mit A+ gibt
 * es keinen Pool und keine Rücklage mehr – jede Zahlung geht direkt an ihren
 * Empfänger. Aufgaben ergeben nur noch Abzeichen; wer eines erschwindelt,
 * gewinnt nichts. Die Aufgaben „erster bezahlter Job“ und „1.000 sats
 * umgesetzt“ lasen öffentliche Gebühren-Belege des Knotens (38051) – die gibt
 * es seit 5.1.2 nicht mehr, und KI-Aufträge sind seit 3.1 privat.
 */
import { NostrEvent } from "./event.js";
import { parsePerformance } from "./performance.js";

/** Abgeschlossene Aufgabe, vom Prüfer signiert. */
export const KIND_QUEST_CLAIM = 38066;

export type QuestId =
  | "provider_7_tage"
  | "provider_30_tage"
  | "geworben_aktiv"
  | "relay_betrieben"
  | "modell_gespiegelt"
  | "zugang_gesichert";

export interface Quest {
  id: QuestId;
  title: string;
  description: string;
  /** Einmal oder wiederholbar. */
  repeatable: boolean;
  /** Worauf der Nachweis beruht — für die Anzeige. */
  proof: string;
}

/** Der Katalog – nur Abzeichen, keine Beträge. */
export const QUESTS: Quest[] = [
  {
    id: "zugang_gesichert",
    title: "Zugang gesichert",
    description: "Merkphrase notiert und bestätigt.",
    repeatable: false,
    proof: "Lokal geprüft — ohne Sicherung ist alles andere sinnlos.",
  },
  {
    id: "provider_7_tage",
    title: "Eine Woche Provider",
    description: "An sieben verschiedenen Tagen Jobs erledigt.",
    repeatable: false,
    proof: "Leistungsnachweise an sieben Kalendertagen.",
  },
  {
    id: "provider_30_tage",
    title: "Ein Monat Provider",
    description: "An dreißig verschiedenen Tagen Jobs erledigt.",
    repeatable: false,
    proof: "Leistungsnachweise an dreißig Kalendertagen.",
  },
  {
    id: "relay_betrieben",
    title: "Relay betrieben",
    description: "Sieben Tage lang einen erreichbaren Relay angekündigt.",
    repeatable: false,
    proof: "Relay-Ankündigung plus erfolgreiche Erreichbarkeitsprüfungen.",
  },
  {
    id: "modell_gespiegelt",
    title: "Modell gesichert",
    description: "Ein gefährdetes Modell vorgehalten, bis es wieder mehrere Seeder hat.",
    repeatable: true,
    proof: "Seed-Meldung für ein Modell, das vorher unter drei Seedern lag.",
  },
  {
    id: "geworben_aktiv",
    title: "Drei aktive Geworbene",
    description: "Drei geworbene Provider, die tatsächlich arbeiten.",
    repeatable: false,
    proof: "Öffentliche Nennungen (38052) plus Leistungsnachweise der Geworbenen.",
  },
];

export function questById(id: QuestId): Quest | undefined {
  return QUESTS.find((q) => q.id === id);
}

export interface QuestProgress {
  quest: Quest;
  done: boolean;
  /** 0..1, für die Anzeige. */
  progress: number;
  detail: string;
  /** Zählerstand der zählbaren Aufgaben – damit eine Oberfläche `detail` in ihrer Sprache bilden kann (8.16f). */
  zaehler?: { ist: number; soll: number };
}

export interface EvaluateInput {
  pubkey: string;
  /** Leistungsnachweise (kind 38010) — eigene und fremde. */
  performances: NostrEvent[];
  /** Geworbene mit aktiver Arbeit, aus den öffentlichen Nennungen (38052). */
  activeReferrals?: number;
  /** Erreichbarkeitstage des eigenen Relays. */
  relayDays?: number;
  backedUp?: boolean;
  nowSecs?: number;
}

const TAG = 86400;

function aktiveTage(events: NostrEvent[], pubkey: string): number {
  const tage = new Set<string>();
  for (const ev of events) {
    try {
      const p = parsePerformance(ev);
      if (p.workerPubkey !== pubkey) continue;
      tage.add(new Date(ev.created_at * 1000).toISOString().slice(0, 10));
    } catch { /* ungültig */ }
  }
  return tage.size;
}

/**
 * Wertet den Stand aus.
 *
 * Alles stammt aus signierten Ereignissen — jeder kann dieselbe Rechnung
 * anstellen und ein Ergebnis anzweifeln. Ein Aufgabensystem, dessen Stand nur
 * der Betreiber kennt, ist eine Behauptung.
 */
export function evaluateQuests(input: EvaluateInput): QuestProgress[] {
  const tage = aktiveTage(input.performances, input.pubkey);
  const geworben = input.activeReferrals ?? 0;
  const relayTage = input.relayDays ?? 0;

  const stand = (id: QuestId): QuestProgress => {
    const q = questById(id)!;
    switch (id) {
      case "zugang_gesichert":
        return { quest: q, done: !!input.backedUp, progress: input.backedUp ? 1 : 0,
          detail: input.backedUp ? "Gesichert." : "Noch nicht bestätigt." };
      case "provider_7_tage":
        return { quest: q, done: tage >= 7, progress: Math.min(1, tage / 7),
          detail: `${tage} von 7 Tagen.`, zaehler: { ist: tage, soll: 7 } };
      case "provider_30_tage":
        return { quest: q, done: tage >= 30, progress: Math.min(1, tage / 30),
          detail: `${tage} von 30 Tagen.`, zaehler: { ist: tage, soll: 30 } };
      case "relay_betrieben":
        return { quest: q, done: relayTage >= 7, progress: Math.min(1, relayTage / 7),
          detail: `${relayTage} von 7 Tagen erreichbar.`, zaehler: { ist: relayTage, soll: 7 } };
      case "geworben_aktiv":
        return { quest: q, done: geworben >= 3, progress: Math.min(1, geworben / 3),
          detail: `${geworben} von 3 aktiv.`, zaehler: { ist: geworben, soll: 3 } };
      default:
        return { quest: q, done: false, progress: 0, detail: "Noch offen." };
    }
  };

  return QUESTS.filter((q) => q.id !== "modell_gespiegelt").map((q) => stand(q.id));
}

/**
 * Nicht nachweisbare Aufgaben — von Hand vergeben, nicht berechnet.
 *
 * Steht hier, damit die Trennlinie im Code sichtbar ist: Diese Abzeichen
 * beruhen auf Vertrauen in den, der sie vergibt.
 */
export const BADGE_ONLY_TASKS = [
  { id: "geteilt", title: "App weitergegeben", note: "Ehrensache, nicht nachprüfbar." },
  { id: "rueckmeldung", title: "Fehler gemeldet", note: "Wird von Hand vergeben." },
  { id: "uebersetzt", title: "Übersetzung beigesteuert", note: "Über ein Kopfgeld, nicht über Aufgaben." },
] as const;
