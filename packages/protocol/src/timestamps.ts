/**
 * Zeitstempel: sie sind frei wählbar, und vier Mechanismen hängen daran.
 *
 * DAS PROBLEM
 * Jedes Nostr-Ereignis trägt ein `created_at`, das der Absender selbst setzt.
 * Normalerweise harmlos. Hier nicht:
 *
 *   · Referral-Graph      — früheste Angabe gewinnt
 *   · Schlüsselwechsel    — frühestes Mandat gewinnt
 *   · Moderatorenliste    — neueste gewinnt
 *   · Aufgaben            — aktive TAGE zählen
 *
 * Der letzte ist der billigste Angriff im ganzen System: Ein Provider setzt
 * dreißig Leistungsnachweise auf dreißig verschiedene Kalendertage, erzeugt
 * sie aber in einer Minute, und kassiert die Monatsprämie. Wegwerf-Identität,
 * beliebig oft wiederholbar.
 *
 * DREI STUFEN, AUFSTEIGEND NACH KOSTEN
 *
 * 1. **Plausibilität** — kostet nichts, fängt die plumpen Fälle. Ereignisse
 *    aus der Zukunft oder aus der Zeit vor dem ersten bekannten Ereignis
 *    dieses Schlüssels werden verworfen.
 * 2. **Relay-Zeugen** — Relays veröffentlichen periodisch, welche Ereignisse
 *    sie gesehen haben. Wer zurückdatiert, kann keinen Zeugen vorweisen. Das
 *    ist der wirksamste Teil, weil er nichts kostet außer Konvention.
 * 3. **Kettenanker** — für Ereignisse, bei denen es um Geld geht. Beweiskräftig,
 *    aber mit Stunden Verzögerung. Hier nur vorbereitet.
 *
 * WAS DAS NICHT LEISTET
 * Eine absolute Zeitwahrheit gibt es ohne zentrale Instanz nicht. Was geht,
 * ist eine **untere Schranke**: „Dieses Ereignis existierte spätestens zu
 * diesem Zeitpunkt." Rückdatieren wird damit unmöglich, Vordatieren bleibt
 * begrenzt möglich — und das ist die Richtung, auf die es bei allen vier
 * Mechanismen ankommt.
 */
import { NostrEvent, UnsignedEvent, buildEvent, getTag } from "./event.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** Relay bezeugt, welche Ereignisse es gesehen hat. */
export const KIND_TIME_WITNESS = 38069;

/** Wie weit ein Ereignis in der Zukunft liegen darf. */
export const MAX_FUTURE_SECS = 300;

export type TimeVerdict = "plausibel" | "zukunft" | "vordatiert" | "bezeugt" | "unbezeugt";

export interface TimeCheck {
  ok: boolean;
  verdict: TimeVerdict;
  /** Untere Schranke, falls bekannt: spätestens dann existierte es. */
  provenBefore?: number;
  message: string;
}

export interface PlausibilityOptions {
  nowSecs?: number;
  /** Frühestes bekanntes Ereignis dieses Schlüssels. */
  keyFirstSeen?: number;
  /** Wie weit vor dem ersten bekannten Ereignis noch zulässig. */
  graceSecs?: number;
}

/**
 * Stufe 1: Plausibilität.
 *
 * Bewusst großzügig. Uhren gehen falsch, und ein Nutzer mit einer um Minuten
 * abweichenden Systemzeit darf nicht ausgesperrt werden. Der Zweck ist, die
 * groben Fälschungen zu fangen — nicht die Genauigkeit zu erzwingen.
 */
export function checkPlausibility(
  ev: NostrEvent,
  opts: PlausibilityOptions = {},
): TimeCheck {
  const now = opts.nowSecs ?? Math.floor(Date.now() / 1000);

  if (ev.created_at > now + MAX_FUTURE_SECS) {
    const minuten = Math.round((ev.created_at - now) / 60);
    return {
      ok: false, verdict: "zukunft",
      message: `Zeitstempel liegt ${minuten} Minuten in der Zukunft.`,
    };
  }

  if (opts.keyFirstSeen) {
    const grace = opts.graceSecs ?? 86400;
    if (ev.created_at < opts.keyFirstSeen - grace) {
      // Ein Ereignis, das älter ist als der Schlüssel, der es signiert hat.
      const tage = Math.round((opts.keyFirstSeen - ev.created_at) / 86400);
      return {
        ok: false, verdict: "vordatiert",
        message:
          `Angeblich ${tage} Tage vor dem ersten bekannten Ereignis dieses ` +
          `Schlüssels entstanden. Das geht nicht mit rechten Dingen zu.`,
      };
    }
  }

  return { ok: true, verdict: "plausibel", message: "Zeitstempel unauffällig." };
}

export interface TimeWitness {
  relayPubkey: string;
  /** Wurzel über die bezeugten Ereignis-Kennungen. */
  root: string;
  /** Anzahl bezeugter Ereignisse. */
  count: number;
  /** Zeitraum, den der Zeuge abdeckt. */
  fromUnix: number;
  untilUnix: number;
  createdAt: number;
}

/** Einfache Wurzel über sortierte Kennungen. */
export function witnessRoot(eventIds: string[]): string {
  const sortiert = [...eventIds].sort();
  return bytesToHex(sha256(new TextEncoder().encode(sortiert.join(","))));
}

/**
 * Zeuge bauen.
 *
 * Ein Relay veröffentlicht periodisch, welche Ereignisse es gesehen hat. Wer
 * später ein Ereignis mit einem Zeitstempel aus diesem Zeitraum vorlegt, das
 * NICHT in der Wurzel steckt, hat es nachträglich erzeugt.
 */
export function buildTimeWitness(
  relayPubkey: string,
  eventIds: string[],
  fromUnix: number,
  untilUnix: number,
  createdAt?: number,
): UnsignedEvent {
  return buildEvent(
    relayPubkey,
    KIND_TIME_WITNESS,
    [
      ["d", `witness:${untilUnix}`],
      ["root", witnessRoot(eventIds)],
      ["count", String(eventIds.length)],
      ["period", String(fromUnix), String(untilUnix)],
    ],
    "",
    createdAt,
  );
}

export function parseTimeWitness(ev: NostrEvent): TimeWitness {
  if (ev.kind !== KIND_TIME_WITNESS) throw new Error(`kein Zeuge: kind ${ev.kind}`);
  const root = getTag(ev, "root");
  const zeitraum = ev.tags.find((t) => t[0] === "period");
  if (!root || !zeitraum) throw new Error("Zeuge unvollständig");
  return {
    relayPubkey: ev.pubkey,
    root,
    count: Number(getTag(ev, "count") ?? "0"),
    fromUnix: Number(zeitraum[1]),
    untilUnix: Number(zeitraum[2]),
    createdAt: ev.created_at,
  };
}

export interface WitnessCheckOptions {
  /** Relays, deren Zeugnis zählt. */
  trustedWitnesses?: Set<string>;
  nowSecs?: number;
}

/**
 * Stufe 2: gegen Zeugen prüfen.
 *
 * Ein Ereignis, dessen Zeitstempel in einen bezeugten Zeitraum fällt, muss in
 * dessen Wurzel vorkommen. Fehlt es, wurde es nachträglich erzeugt — der
 * Rückdatierungsangriff fällt damit auf.
 *
 * Die Prüfung braucht die Liste der bezeugten Kennungen, nicht nur die Wurzel.
 * Sie lohnt deshalb nur dort, wo es um etwas geht: Aufgaben, Referral,
 * Schlüsselwechsel.
 */
export function checkAgainstWitnesses(
  ev: NostrEvent,
  witnesses: { witness: TimeWitness; eventIds: string[] }[],
  opts: WitnessCheckOptions = {},
): TimeCheck {
  const passend = witnesses.filter((w) => {
    if (opts.trustedWitnesses && !opts.trustedWitnesses.has(w.witness.relayPubkey)) return false;
    return ev.created_at >= w.witness.fromUnix && ev.created_at <= w.witness.untilUnix;
  });

  if (passend.length === 0) {
    return {
      ok: true, verdict: "unbezeugt",
      message: "Kein Zeuge für diesen Zeitraum. Der Zeitstempel bleibt eine Behauptung.",
    };
  }

  for (const w of passend) {
    if (w.eventIds.includes(ev.id)) {
      return {
        ok: true, verdict: "bezeugt",
        provenBefore: w.witness.createdAt,
        message: `Von ${w.witness.relayPubkey.slice(0, 8)}… bezeugt.`,
      };
    }
  }

  return {
    ok: false, verdict: "vordatiert",
    message:
      `Der Zeitstempel fällt in einen bezeugten Zeitraum, aber ${passend.length} ` +
      `Zeuge(n) haben dieses Ereignis damals nicht gesehen. Es wurde nachträglich erzeugt.`,
  };
}

export interface DayCountOptions {
  nowSecs?: number;
  /** Mindestabstand zwischen zwei Ereignissen desselben Tages. */
  minSpacingSecs?: number;
}

export interface DayCountResult {
  /** Tage, die nach Prüfung übrig bleiben. */
  days: number;
  /** Verworfene Tage mit Grund. */
  rejected: { day: string; reason: string }[];
  suspicious: boolean;
  message: string;
}

/**
 * Aktive Tage zählen — gegen den billigsten Angriff im System abgesichert.
 *
 * Der naive Weg (Kalendertage aus `created_at` sammeln) lässt sich in einer
 * Minute fälschen. Hier zusätzlich: Die Ereignisse eines Tages müssen auch
 * zeitlich verteilt EINGEGANGEN sein. Wer dreißig Tage in einer Minute
 * erzeugt, hat dreißig Kalendertage, aber alle mit derselben Eingangszeit.
 *
 * `receivedAt` ist der Zeitpunkt, zu dem der Prüfende das Ereignis zuerst
 * gesehen hat — eine lokale Beobachtung, die der Absender nicht fälschen kann.
 */
export function countActiveDays(
  events: { id: string; created_at: number; receivedAt?: number }[],
  opts: DayCountOptions = {},
): DayCountResult {
  const now = opts.nowSecs ?? Math.floor(Date.now() / 1000);
  const minSpacing = opts.minSpacingSecs ?? 3600;

  const proTag = new Map<string, { created: number[]; received: number[] }>();
  for (const ev of events) {
    if (ev.created_at > now + MAX_FUTURE_SECS) continue;
    const tag = new Date(ev.created_at * 1000).toISOString().slice(0, 10);
    const e = proTag.get(tag) ?? { created: [], received: [] };
    e.created.push(ev.created_at);
    if (ev.receivedAt) e.received.push(ev.receivedAt);
    proTag.set(tag, e);
  }

  const rejected: { day: string; reason: string }[] = [];
  let gueltig = 0;

  for (const [tag, e] of proTag) {
    // Wenn Eingangszeiten vorliegen, müssen sie zum behaupteten Tag passen.
    if (e.received.length > 0) {
      const frueheste = Math.min(...e.received);
      const behauptet = Math.max(...e.created);
      // Mehr als einen Tag nach dem behaupteten Datum eingegangen: Das Ereignis
      // wurde später erzeugt, als es vorgibt.
      if (frueheste - behauptet > 86400) {
        rejected.push({ day: tag, reason: "erst deutlich später eingegangen" });
        continue;
      }
    }
    gueltig++;
  }

  // Alle Eingangszeiten dicht beieinander bei vielen verschiedenen Tagen ist
  // das Signal für einen Massenwurf.
  const alleEingaenge = events.map((e) => e.receivedAt).filter((x): x is number => x !== undefined);
  let suspicious = false;
  if (alleEingaenge.length >= 5 && proTag.size >= 5) {
    const spanne = Math.max(...alleEingaenge) - Math.min(...alleEingaenge);
    if (spanne < minSpacing) suspicious = true;
  }

  return {
    days: suspicious ? 0 : gueltig,
    rejected,
    suspicious,
    message: suspicious
      ? `${proTag.size} verschiedene Kalendertage, aber alle Ereignisse binnen ` +
        `${Math.round((Math.max(...alleEingaenge) - Math.min(...alleEingaenge)) / 60)} Minuten eingegangen. ` +
        `Nicht anerkannt.`
      : rejected.length > 0
        ? `${gueltig} Tage anerkannt, ${rejected.length} verworfen.`
        : `${gueltig} Tage.`,
  };
}

/**
 * Welche Reihenfolge gilt zwischen zwei Ereignissen?
 *
 * Für alle Mechanismen, bei denen „früheste gewinnt" oder „neueste gewinnt"
 * entscheidet. Liegt für eines ein Zeugnis vor und für das andere nicht,
 * gewinnt das bezeugte — sonst wäre eine unbelegte Behauptung stärker als ein
 * Beleg.
 */
export function compareTrusted(
  a: { event: NostrEvent; check?: TimeCheck },
  b: { event: NostrEvent; check?: TimeCheck },
): number {
  const rang = (x: { check?: TimeCheck }): number =>
    x.check?.verdict === "bezeugt" ? 0 : x.check?.verdict === "unbezeugt" ? 1 : 2;

  const ra = rang(a);
  const rb = rang(b);
  if (ra !== rb) return ra - rb;
  return a.event.created_at - b.event.created_at;
}
