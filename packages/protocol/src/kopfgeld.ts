/**
 * Kopfgelder für Aufgaben in Repos (Kind 38061, Entscheidung E10 B vom 04.10.2026).
 *
 * Jemand beschreibt eine Aufgabe – meist ein Issue (NIP-34, 1621) – und sagt
 * einen Betrag zu, in sats, in SOL oder in beiden. Wer sie erledigt, bekommt
 * ihn direkt vom Geldgeber: kein Topf, keine Runde, niemand verwahrt etwas
 * (A+ kennt keinen Topf, die Entwicklung bekommt ihre 2,5 % ohnehin). Bis 04.10.
 * stand hier daneben eine rückwirkende Verteilung aus einem Topf (38059/38060) –
 * die Kinds sind seitdem nicht mehr belegt.
 *
 * Eine feste Zusage ist hier richtig, weil die Aufgabe vorher beschrieben ist.
 * Den Stand (offen, vergeben, erledigt, zurückgezogen) setzt nur der
 * Geldgeber: Das Event ist ersetzbar je Autor und `d` – ein Fremder kann ein
 * Kopfgeld nicht als erledigt melden, er legt höchstens ein eigenes an.
 */
import { type NostrEvent, type UnsignedEvent, buildEvent, getTag, verifyEvent } from "./event.js";

export const KIND_KOPFGELD = 38061;

export type KopfgeldStand = "offen" | "vergeben" | "erledigt" | "zurueckgezogen";
const STAENDE: readonly KopfgeldStand[] = ["offen", "vergeben", "erledigt", "zurueckgezogen"];

export const KOPFGELD_GRENZEN = Object.freeze({ titel: 200, beschreibung: 8_000, kennung: 64 });

export interface Kopfgeld {
  kennung: string;
  titel: string;
  beschreibung: string;
  /** Zugesagt in Lightning (msat) – mindestens eine Währung. */
  msat?: number;
  /** Zugesagt in SOL (Lamports). */
  lamports?: number;
  geldgeber: string;
  stand: KopfgeldStand;
  /** Bei „vergeben“ und „erledigt“: an wen. */
  an?: string;
  /** Das Issue, um das es geht (Id des Events 1621). */
  issue?: string;
  /** Das Repo (`30617:<besitzer>:<kennung>`). */
  repo?: string;
  zeit: number;
}

const HEX64 = /^[0-9a-f]{64}$/;
const ZAHL = /^[1-9]\d{0,15}$/;
const KENNUNG = /^[A-Za-z0-9._-]{1,64}$/;
const REPO = /^30617:[0-9a-f]{64}:[^\s:]{1,256}$/;

function pruefe(k: Omit<Kopfgeld, "zeit">): string | null {
  if (!KENNUNG.test(k.kennung)) return "kennung";
  if (!HEX64.test(k.geldgeber)) return "geldgeber";
  if (!k.titel.trim() || k.titel.length > KOPFGELD_GRENZEN.titel || k.beschreibung.length > KOPFGELD_GRENZEN.beschreibung) return "text";
  if (k.msat === undefined && k.lamports === undefined) return "betrag";
  for (const n of [k.msat, k.lamports]) if (n !== undefined && (!Number.isSafeInteger(n) || n <= 0)) return "betrag";
  if (!STAENDE.includes(k.stand)) return "stand";
  if ((k.stand === "vergeben" || k.stand === "erledigt") !== (k.an !== undefined)) return "an";
  if (k.an !== undefined && (!HEX64.test(k.an) || k.an === k.geldgeber)) return "an";
  if (k.issue !== undefined && !HEX64.test(k.issue)) return "issue";
  if (k.repo !== undefined && !REPO.test(k.repo)) return "repo";
  return null;
}

/** Kopfgeld anlegen oder seinen Stand ändern – unsigniert, der Geldgeber signiert. */
export function baueKopfgeld(k: Omit<Kopfgeld, "zeit">, zeit?: number): UnsignedEvent {
  const fehler = pruefe(k);
  if (fehler) throw new Error(`Kopfgeld ungültig: ${fehler}`);
  const tags: string[][] = [
    ["d", `bounty:${k.kennung}`],
    ["bounty", k.kennung],
    ["title", k.titel],
    ...(k.msat !== undefined ? [["amount_msat", String(k.msat)]] : []),
    ...(k.lamports !== undefined ? [["amount_lamports", String(k.lamports)]] : []),
    ["status", k.stand],
    ...(k.an ? [["p", k.an]] : []),
    ...(k.issue ? [["e", k.issue]] : []),
    ...(k.repo ? [["a", k.repo]] : []),
  ];
  return buildEvent(k.geldgeber, KIND_KOPFGELD, tags, k.beschreibung, zeit);
}

/** Streng lesen: falsche Signatur, kaputte Beträge, unbekannter Stand oder ein `d`, das nicht passt → null. */
export function leseKopfgeld(ev: NostrEvent): Kopfgeld | null {
  if (ev.kind !== KIND_KOPFGELD || !verifyEvent(ev)) return null;
  const kennung = getTag(ev, "bounty") ?? "";
  if (getTag(ev, "d") !== `bounty:${kennung}`) return null;
  const betrag = (n: string) => {
    const s = getTag(ev, n);
    return s === undefined ? undefined : ZAHL.test(s) ? Number(s) : NaN;
  };
  const msat = betrag("amount_msat");
  const lamports = betrag("amount_lamports");
  if (Number.isNaN(msat) || Number.isNaN(lamports)) return null;
  const k: Kopfgeld = {
    kennung,
    titel: getTag(ev, "title") ?? "",
    beschreibung: ev.content,
    ...(msat !== undefined ? { msat } : {}),
    ...(lamports !== undefined ? { lamports } : {}),
    geldgeber: ev.pubkey,
    stand: (getTag(ev, "status") ?? "") as KopfgeldStand,
    ...(getTag(ev, "p") !== undefined ? { an: getTag(ev, "p") } : {}),
    ...(getTag(ev, "e") !== undefined ? { issue: getTag(ev, "e") } : {}),
    ...(getTag(ev, "a") !== undefined ? { repo: getTag(ev, "a") } : {}),
    zeit: ev.created_at,
  };
  return pruefe(k) ? null : k;
}

/** Je Geldgeber und Kennung der neueste Stand – ein anderer Autor ändert ein Kopfgeld nie. */
export function aktuelleKopfgelder(events: readonly NostrEvent[]): Kopfgeld[] {
  const neueste = new Map<string, Kopfgeld>();
  for (const ev of events) {
    const k = leseKopfgeld(ev);
    if (!k) continue;
    const schluessel = `${k.geldgeber}:${k.kennung}`;
    const bisher = neueste.get(schluessel);
    if (!bisher || k.zeit > bisher.zeit) neueste.set(schluessel, k);
  }
  return [...neueste.values()].sort((a, b) => b.zeit - a.zeit);
}

/** Die Kopfgelder zu einem Issue, jeder Stand (neueste zuerst). */
export function kopfgelderZuIssue(events: readonly NostrEvent[], issue: string): Kopfgeld[] {
  return aktuelleKopfgelder(events).filter((k) => k.issue === issue);
}

/** Nur die offenen, neueste zuerst. */
export function offeneKopfgelder(events: readonly NostrEvent[]): Kopfgeld[] {
  return aktuelleKopfgelder(events).filter((k) => k.stand === "offen");
}
