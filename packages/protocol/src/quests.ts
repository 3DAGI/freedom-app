/**
 * Aufgaben: Anreize, die sich nicht abfarmen lassen.
 *
 * WARUM NUR NACHWEISBARE AUFGABEN
 * Der naheliegende Entwurf mischt zwei Arten: „folge uns auf X" und „betreibe
 * sieben Tage einen Knoten". Sie sehen gleich aus und verhalten sich
 * gegenteilig.
 *
 * Die zweite Art ist **im Protokoll nachweisbar** — die Leistungsnachweise
 * liegen signiert vor, jeder kann sie nachrechnen, und wer sie fälschen will,
 * muss die Arbeit tatsächlich leisten. Die erste Art braucht einen Prüfer, der
 * bei einer fremden Plattform nachsieht. Damit hat das Projekt:
 *
 *   · eine zentrale Stelle, die entscheidet, wer bezahlt wird,
 *   · eine Abhängigkeit von der API eines Anbieters, gegen den es antritt,
 *   · und ein Farming-Problem: Zehntausend Wegwerf-Konten kosten fast nichts,
 *     eure Auszahlung dagegen echte Sats aus einem Topf, den ihr nicht
 *     nachdrucken könnt.
 *
 * Deshalb kennt dieses Modul **nur Aufgaben, deren Nachweis schon als
 * signiertes Ereignis im System liegt**. Für alles andere gibt es Abzeichen
 * ohne Geld — Status wirkt in solchen Gemeinschaften ohnehin besser als
 * Kleinbeträge, und er kostet nichts, wenn ihn jemand erschwindelt.
 *
 * DIE ZWEITE FALLE: SELBSTGESCHÄFTE
 * „Gib 1.000 sats für KI-Jobs aus" lässt sich trivial ausnutzen — man zahlt an
 * den eigenen Provider und kassiert die Prämie. Deshalb zählt Umsatz nur, wenn
 * Kunde und Provider verschieden sind und der Provider nicht erst für diese
 * Aufgabe entstanden ist.
 */
import { NostrEvent, getTag } from "./event.js";
import { parsePerformance } from "./performance.js";

/** Abgeschlossene Aufgabe, vom Prüfer signiert. */
export const KIND_QUEST_CLAIM = 38066;

export type QuestId =
  | "erster_job"
  | "provider_7_tage"
  | "provider_30_tage"
  | "umsatz_1000"
  | "geworben_aktiv"
  | "relay_betrieben"
  | "modell_gespiegelt"
  | "zugang_gesichert";

export interface Quest {
  id: QuestId;
  title: string;
  description: string;
  /** Belohnung in msat. 0 = nur Abzeichen. */
  rewardMsat: number;
  /** Einmal oder wiederholbar. */
  repeatable: boolean;
  /** Worauf der Nachweis beruht — für die Anzeige. */
  proof: string;
}

/**
 * Der Katalog.
 *
 * Die Beträge sind bewusst gestaffelt nach dem, was dem NETZ nützt, nicht
 * nach Aufwand: Ein Provider, der dreißig Tage durchhält, ist das Vielfache
 * eines wert, der einmal etwas ausprobiert.
 */
export const QUESTS: Quest[] = [
  {
    id: "zugang_gesichert",
    title: "Zugang gesichert",
    description: "Merkphrase notiert und bestätigt.",
    rewardMsat: 0,
    repeatable: false,
    proof: "Lokal geprüft — ohne Sicherung ist alles andere sinnlos.",
  },
  {
    id: "erster_job",
    title: "Erster bezahlter Job",
    description: "Eine Anfrage gestellt und bezahlt.",
    rewardMsat: 500_000,
    repeatable: false,
    proof: "Fee-Beweis mit gültigem Preimage.",
  },
  {
    id: "provider_7_tage",
    title: "Eine Woche Provider",
    description: "An sieben verschiedenen Tagen Jobs erledigt.",
    rewardMsat: 3_000_000,
    repeatable: false,
    proof: "Leistungsnachweise an sieben Kalendertagen.",
  },
  {
    id: "provider_30_tage",
    title: "Ein Monat Provider",
    description: "An dreißig verschiedenen Tagen Jobs erledigt.",
    rewardMsat: 15_000_000,
    repeatable: false,
    proof: "Leistungsnachweise an dreißig Kalendertagen.",
  },
  {
    id: "relay_betrieben",
    title: "Relay betrieben",
    description: "Sieben Tage lang einen erreichbaren Relay angekündigt.",
    rewardMsat: 5_000_000,
    repeatable: false,
    proof: "Relay-Ankündigung plus erfolgreiche Erreichbarkeitsprüfungen.",
  },
  {
    id: "modell_gespiegelt",
    title: "Modell gesichert",
    description: "Ein gefährdetes Modell vorgehalten, bis es wieder mehrere Seeder hat.",
    rewardMsat: 4_000_000,
    repeatable: true,
    proof: "Seed-Meldung für ein Modell, das vorher unter drei Seedern lag.",
  },
  {
    id: "umsatz_1000",
    title: "1.000 sats umgesetzt",
    description: "Für tausend sats Rechenzeit bei fremden Providern gekauft.",
    rewardMsat: 1_000_000,
    repeatable: false,
    proof: "Fee-Beweise über 1.000 sats — eigene Provider zählen nicht.",
  },
  {
    id: "geworben_aktiv",
    title: "Drei aktive Geworbene",
    description: "Drei geworbene Provider, die tatsächlich arbeiten.",
    rewardMsat: 5_000_000,
    repeatable: false,
    proof: "Referral-Graph plus Leistungsnachweise der Geworbenen.",
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
}

export interface EvaluateInput {
  pubkey: string;
  /** Leistungsnachweise (kind 38010) — eigene und fremde. */
  performances: NostrEvent[];
  /** Fee-Beweise (kind 38051), in denen dieser Pubkey Kunde war. */
  feeProofs: NostrEvent[];
  /** Geworbene mit aktiver Arbeit, aus dem Referral-Graphen. */
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

  // Umsatz: nur bei FREMDEN Providern. Sonst zahlt man an sich selbst und
  // kassiert die Prämie — der klassische Weg, so ein System zu melken.
  let fremdUmsatzMsat = 0;
  for (const ev of input.feeProofs) {
    const kunde = getTag(ev, "customer");
    const worker = getTag(ev, "worker") ?? ev.pubkey;
    if (kunde !== input.pubkey) continue;
    if (worker === input.pubkey) continue;
    const total = Number(getTag(ev, "total_msat") ?? "0");
    if (Number.isFinite(total)) fremdUmsatzMsat += total;
  }

  const ersterJob = fremdUmsatzMsat > 0;
  const geworben = input.activeReferrals ?? 0;
  const relayTage = input.relayDays ?? 0;

  const stand = (id: QuestId): QuestProgress => {
    const q = questById(id)!;
    switch (id) {
      case "zugang_gesichert":
        return { quest: q, done: !!input.backedUp, progress: input.backedUp ? 1 : 0,
          detail: input.backedUp ? "Gesichert." : "Noch nicht bestätigt." };
      case "erster_job":
        return { quest: q, done: ersterJob, progress: ersterJob ? 1 : 0,
          detail: ersterJob ? "Erledigt." : "Noch kein belegter Job." };
      case "provider_7_tage":
        return { quest: q, done: tage >= 7, progress: Math.min(1, tage / 7),
          detail: `${tage} von 7 Tagen.` };
      case "provider_30_tage":
        return { quest: q, done: tage >= 30, progress: Math.min(1, tage / 30),
          detail: `${tage} von 30 Tagen.` };
      case "relay_betrieben":
        return { quest: q, done: relayTage >= 7, progress: Math.min(1, relayTage / 7),
          detail: `${relayTage} von 7 Tagen erreichbar.` };
      case "umsatz_1000":
        return { quest: q, done: fremdUmsatzMsat >= 1_000_000,
          progress: Math.min(1, fremdUmsatzMsat / 1_000_000),
          detail: `${Math.floor(fremdUmsatzMsat / 1000)} von 1.000 sats bei fremden Providern.` };
      case "geworben_aktiv":
        return { quest: q, done: geworben >= 3, progress: Math.min(1, geworben / 3),
          detail: `${geworben} von 3 aktiv.` };
      default:
        return { quest: q, done: false, progress: 0, detail: "Noch offen." };
    }
  };

  return QUESTS.filter((q) => q.id !== "modell_gespiegelt").map((q) => stand(q.id));
}

export interface QuestBudget {
  /** Topf für diese Epoche. */
  poolMsat: number;
  /** Bereits ausgezahlt. */
  spentMsat: number;
}

/**
 * Anteil des Reward-Pools, der in Aufgaben fließt.
 *
 * Der Aufgaben-Topf wächst mit dem Umsatz: Je mehr im Netz passiert, desto
 * mehr kann verteilt werden. Das ist die Richtung, die ein wachsendes Netz
 * braucht — ein fester Betrag wäre am Anfang zu groß und später zu klein.
 */
export const QUEST_SHARE_OF_POOL_PERCENT = 40;

/**
 * Anschubfinanzierung, solange der Umsatz die Belohnungen nicht trägt.
 *
 * Ein Prozentsatz von fast nichts ist fast nichts — am Anfang, wenn Anreize
 * am wichtigsten sind, wäre ein rein prozentualer Topf leer. Diese Summe
 * kommt aus dem Entwickler-Anteil, ist **befristet**, und das gehört offen
 * gesagt: Es ist eine Investition, kein Ertrag des Netzes.
 */
export const BOOTSTRAP_FLOOR_MSAT = 2_000_000_000; // 2 Mio sats je Epoche

/**
 * Obergrenze je Epoche, unabhängig vom Umsatz.
 *
 * Das ist die einzige Sicherung gegen Farmen. Ohne sie öffnet ein
 * Umsatzsprung — oder ein Angreifer, der Umsatz mit sich selbst erzeugt —
 * den Hahn genau dann, wenn er zuschlägt. Mit ihr konkurrieren die
 * Teilnehmer untereinander statt gegen die Kasse.
 */
export const HARD_CAP_PER_EPOCH_MSAT = 20_000_000_000; // 20 Mio sats

export interface BudgetPlan {
  poolMsat: number;
  /** Woraus er sich speist — gehört in die Anzeige. */
  source: "anschub" | "umsatz" | "gedeckelt";
  /** Wie viele Teilnehmer der Topf im schlimmsten Fall trägt. */
  fundsParticipants: number;
  note: string;
}

/**
 * Rechnet den Aufgaben-Topf einer Epoche aus.
 *
 * Gibt ausdrücklich mit aus, wie viele Teilnehmer gedeckt sind. Das ist die
 * Zahl, die zählt: Ein Topf, der bei fünfzig neuen Teilnehmern leer ist,
 * enttäuscht ab dem einundfünfzigsten — und Enttäuschung verbreitet sich
 * schneller als Belohnung.
 */
export function questBudgetFor(
  rewardPoolMsat: number,
  opts: { bootstrap?: boolean; sharePercent?: number } = {},
): BudgetPlan {
  const anteil = Math.floor((rewardPoolMsat * (opts.sharePercent ?? QUEST_SHARE_OF_POOL_PERCENT)) / 100);
  const maxProKopf = maxCostPerParticipant().msat;

  let poolMsat = anteil;
  let source: BudgetPlan["source"] = "umsatz";

  if (opts.bootstrap !== false && anteil < BOOTSTRAP_FLOOR_MSAT) {
    poolMsat = BOOTSTRAP_FLOOR_MSAT;
    source = "anschub";
  }
  if (poolMsat > HARD_CAP_PER_EPOCH_MSAT) {
    poolMsat = HARD_CAP_PER_EPOCH_MSAT;
    source = "gedeckelt";
  }

  const fundsParticipants = Math.floor(poolMsat / Math.max(1, maxProKopf));
  const note =
    source === "anschub"
      ? `Anschub: ${Math.floor(poolMsat / 1000)} sats aus dem Entwickler-Anteil, ` +
        `weil ${Math.floor(anteil / 1000)} sats Umsatzanteil nicht tragen. Befristet.`
      : source === "gedeckelt"
        ? `Auf ${Math.floor(poolMsat / 1000)} sats gedeckelt. Der Umsatzanteil wäre ` +
          `${Math.floor(anteil / 1000)} sats — der Rest bleibt im Reward-Pool für Provider.`
        : `${Math.floor(poolMsat / 1000)} sats aus dem Umsatz (${opts.sharePercent ?? QUEST_SHARE_OF_POOL_PERCENT} % des Reward-Pools).`;

  return { poolMsat, source, fundsParticipants, note };
}

/**
 * Welcher Umsatz trägt wie viele Teilnehmer?
 *
 * Zum Rechnen VOR dem Festlegen des Prozentsatzes. Die Zahl ist unbequem und
 * deshalb wichtig: Belohnungen, die sich lohnen, brauchen Umsatz, der sie
 * trägt — sonst zahlt der Entwickler-Anteil sie dauerhaft, und das ist keine
 * Anschubfinanzierung mehr, sondern ein Zuschussgeschäft.
 */
export function sustainability(
  monthlyVolumeSats: number,
  sharePercent = QUEST_SHARE_OF_POOL_PERCENT,
): { participants: number; neededForTen: number; note: string } {
  // Der Reward-Pool bekommt 2 % der Zahlung (80 % der 2,5 % Protokollfee).
  const poolMsat = monthlyVolumeSats * 1000 * 0.02;
  const questMsat = (poolMsat * sharePercent) / 100;
  const proKopf = maxCostPerParticipant().msat;

  const participants = Math.floor(questMsat / proKopf);
  const neededForTen = Math.ceil((10 * proKopf) / (1000 * 0.02 * (sharePercent / 100)));

  return {
    participants,
    neededForTen,
    note:
      `Bei ${monthlyVolumeSats.toLocaleString("de-DE")} sats Monatsumsatz trägt der ` +
      `Aufgaben-Topf ${participants} Teilnehmer voll. Für zehn wären ` +
      `${neededForTen.toLocaleString("de-DE")} sats Umsatz nötig. Alles darunter ` +
      `zahlt die Anschubfinanzierung — also ihr.`,
  };
}

export interface PayoutDecision {
  pay: boolean;
  amountMsat: number;
  reason: string;
}

/**
 * Entscheidet über eine Auszahlung.
 *
 * WICHTIG: gedeckelt je Epoche, NICHT als Prozentsatz vom Umsatz.
 *
 * Ein Prozentsatz klingt fair und ist die falsche Richtung: Je mehr Leute
 * Aufgaben abarbeiten, desto mehr zahlt ihr — genau dann, wenn Farmer
 * auftauchen, öffnet sich der Hahn. Ein fester Topf lässt die Teilnehmer
 * miteinander konkurrieren statt gegen eure Kasse.
 */
export function decidePayout(
  progress: QuestProgress,
  budget: QuestBudget,
  bereitsErhalten: QuestId[],
): PayoutDecision {
  const q = progress.quest;

  if (!progress.done) {
    return { pay: false, amountMsat: 0, reason: `Noch offen: ${progress.detail}` };
  }
  if (q.rewardMsat === 0) {
    return { pay: false, amountMsat: 0, reason: "Abzeichen ohne Auszahlung." };
  }
  if (!q.repeatable && bereitsErhalten.includes(q.id)) {
    return { pay: false, amountMsat: 0, reason: "Bereits erhalten." };
  }

  const rest = budget.poolMsat - budget.spentMsat;
  if (rest <= 0) {
    return {
      pay: false, amountMsat: 0,
      reason: "Aufgaben-Topf dieser Epoche ist leer. Nächste Epoche abwarten.",
    };
  }
  if (rest < q.rewardMsat) {
    // Anteilig auszahlen statt ablehnen: Wer die Arbeit geleistet hat, soll
    // nicht leer ausgehen, weil er zufällig der Letzte war.
    return { pay: true, amountMsat: rest, reason: `Topf fast leer — anteilig ${rest} msat.` };
  }
  return { pay: true, amountMsat: q.rewardMsat, reason: progress.detail };
}

/**
 * Was ein Aufgaben-Topf im schlimmsten Fall kostet.
 *
 * Zum Rechnen VOR dem Festlegen: Ein System, dessen Obergrenze man nicht
 * kennt, kann man nicht verantworten.
 */
export function maxCostPerParticipant(): { msat: number; sats: number; note: string } {
  const einmalig = QUESTS.filter((q) => !q.repeatable).reduce((s, q) => s + q.rewardMsat, 0);
  return {
    msat: einmalig,
    sats: Math.floor(einmalig / 1000),
    note:
      `Ein Teilnehmer kann höchstens ${Math.floor(einmalig / 1000)} sats aus den ` +
      `einmaligen Aufgaben holen — und muss dafür einen Monat lang Jobs liefern. ` +
      `Wiederholbare Aufgaben sind zusätzlich durch den Epochen-Topf gedeckelt.`,
  };
}

/**
 * Nicht nachweisbare Aufgaben — ausdrücklich ohne Geld.
 *
 * Steht hier, damit die Trennlinie im Code sichtbar ist und niemand später
 * versehentlich eine Auszahlung daran hängt.
 */
export const BADGE_ONLY_TASKS = [
  { id: "geteilt", title: "App weitergegeben", note: "Ehrensache, nicht nachprüfbar." },
  { id: "rueckmeldung", title: "Fehler gemeldet", note: "Wird von Hand vergeben." },
  { id: "uebersetzt", title: "Übersetzung beigesteuert", note: "Über ein Kopfgeld, nicht über Aufgaben." },
] as const;
