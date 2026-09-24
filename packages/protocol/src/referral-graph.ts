/**
 * Referral-Graph: wer hat wen geworben, und wer davon arbeitet noch.
 *
 * WAS BISHER FEHLTE
 * Der Werber wurde ausschließlich lokal in `localStorage` abgelegt und nie
 * veröffentlicht. Damit konnte das Netz keine einzige Referral-Kette
 * auswerten — die Stufen zeigten immer „Starter", und eine Auszahlung wäre
 * nur auf Zuruf möglich gewesen.
 *
 * WER DIE BEZIEHUNG BEHAUPTEN DARF
 * Der GEWORBENE, nicht der Werber. Das ist die einzige Richtung, die
 * funktioniert: Könnte ein Werber behaupten, jemanden geworben zu haben,
 * würde er einfach die Pubkeys aller erfolgreichen Provider eintragen. Umgekehrt
 * hat der Geworbene keinen Anreiz zu lügen — er gewinnt nichts dabei, und die
 * Vergütung kommt ohnehin aus der Protokollfee, nicht aus seiner Tasche.
 *
 * WARUM DIE ERSTE ANGABE ZÄHLT, NICHT DIE NEUESTE
 * Das Event ist ersetzbar. Würde die jüngste Fassung gelten, könnte ein
 * Provider seinen Werber nachträglich austauschen — oder dazu gedrängt werden.
 * Deshalb gewinnt die früheste Angabe, und spätere Änderungen werden
 * ignoriert.
 */
import { NostrEvent, UnsignedEvent, buildEvent, getTag } from "./event.js";
import { parsePerformance } from "./performance.js";
import { ReferrerState, ReferralChain } from "./referral.js";

/** „Ich wurde von X geworben" — signiert vom Geworbenen. */
export const KIND_REFERRAL_CLAIM = 38052;

export function buildReferralClaim(
  referredPubkey: string,
  referrerPubkey: string,
  createdAt?: number,
): UnsignedEvent {
  if (referredPubkey === referrerPubkey) {
    throw new Error("Selbstwerbung ist nicht möglich.");
  }
  return buildEvent(
    referredPubkey,
    KIND_REFERRAL_CLAIM,
    [
      ["d", "referral"], // ersetzbar, aber es zählt die früheste Fassung
      ["referrer", referrerPubkey],
      ["p", referrerPubkey],
    ],
    "",
    createdAt,
  );
}

export interface ReferralClaim {
  referredPubkey: string;
  referrerPubkey: string;
  createdAt: number;
}

export function parseReferralClaim(ev: NostrEvent): ReferralClaim {
  if (ev.kind !== KIND_REFERRAL_CLAIM) throw new Error(`kein Referral-Claim: kind ${ev.kind}`);
  const referrer = getTag(ev, "referrer");
  if (!referrer || !/^[0-9a-f]{64}$/.test(referrer)) {
    throw new Error("Referral-Claim ohne gültigen referrer");
  }
  if (referrer === ev.pubkey) throw new Error("Selbstwerbung ist nicht möglich.");
  return { referredPubkey: ev.pubkey, referrerPubkey: referrer, createdAt: ev.created_at };
}

export interface GraphOptions {
  /** Ab wann ein Provider als „aktiv" gilt (Sekunden). Default 30 Tage. */
  activeWindowSeconds?: number;
  nowSecs?: number;
}

export interface ReferralGraph {
  /** Geworbener -> Werber (Ebene 1). */
  referrerOf: Map<string, string>;
  /** Pubkeys, die im Zeitfenster tatsächlich gearbeitet haben. */
  activeProviders: Set<string>;
  /** Zustand je Werber, fertig für computeJobReferral. */
  states: Map<string, ReferrerState>;
  /** Verworfene Angaben mit Grund — Transparenz statt stiller Filterung. */
  rejected: { pubkey: string; reason: string }[];
}

/**
 * Baut den Graphen aus signierten Netz-Ereignissen.
 *
 * `claims` sind Referral-Claims (38052), `performances` Leistungsnachweise
 * (38010). Beide sind signiert und öffentlich — der Graph ist damit von jedem
 * unabhängig nachrechenbar, was für ein Auszahlungssystem die Mindestanforderung
 * ist.
 */
export function buildReferralGraph(
  claims: NostrEvent[],
  performances: NostrEvent[],
  opts: GraphOptions = {},
): ReferralGraph {
  const now = opts.nowSecs ?? Math.floor(Date.now() / 1000);
  const window = opts.activeWindowSeconds ?? 30 * 24 * 3600;
  const rejected: { pubkey: string; reason: string }[] = [];

  // 1. Früheste gültige Angabe je Geworbenem.
  const earliest = new Map<string, ReferralClaim>();
  for (const ev of claims) {
    let c: ReferralClaim;
    try {
      c = parseReferralClaim(ev);
    } catch (e) {
      rejected.push({ pubkey: ev.pubkey, reason: (e as Error).message });
      continue;
    }
    const bisher = earliest.get(c.referredPubkey);
    if (!bisher || c.createdAt < bisher.createdAt) earliest.set(c.referredPubkey, c);
  }

  // 2. Kreise auflösen. A wirbt B, B wirbt A wäre sonst eine Kette, in der
  //    beide unbegrenzt aneinander verdienen, ohne dass jemand hinzukommt.
  //
  //    Aufbau in zeitlicher Reihenfolge und Prüfung gegen die BEREITS
  //    akzeptierten Kanten: So gewinnt die frühere Angabe, und nur die
  //    Kante, die den Kreis schließt, fällt weg. Prüfte man gegen alle
  //    Angaben auf einmal, würden beide Seiten verworfen — und ein
  //    Angreifer könnte eine fremde, gültige Beziehung zerstören, indem er
  //    einfach die Gegenrichtung behauptet.
  const referrerOf = new Map<string, string>();
  const inReihenfolge = [...earliest.values()].sort((a, b) => a.createdAt - b.createdAt);
  for (const claim of inReihenfolge) {
    if (bildetKreis(claim.referredPubkey, claim.referrerPubkey, referrerOf)) {
      rejected.push({ pubkey: claim.referredPubkey, reason: "Werbe-Kette bildet einen Kreis" });
      continue;
    }
    referrerOf.set(claim.referredPubkey, claim.referrerPubkey);
  }

  // 3. Wer hat im Zeitfenster gearbeitet?
  const activeProviders = new Set<string>();
  for (const ev of performances) {
    if (ev.created_at < now - window) continue;
    try {
      activeProviders.add(parsePerformance(ev).workerPubkey);
    } catch { /* kein gültiger Nachweis */ }
  }

  // 4. Aktive Geworbene je Werber zählen.
  const states = new Map<string, ReferrerState>();
  for (const [referred, referrer] of referrerOf) {
    const s = states.get(referrer) ?? {
      pubkey: referrer, activeReferrals: 0, lifetimePaidMsat: 0, pendingMsat: 0,
    };
    if (activeProviders.has(referred)) s.activeReferrals += 1;
    states.set(referrer, s);
  }

  return { referrerOf, activeProviders, states, rejected };
}

/** Prüft, ob eine neue Kante gegen die bestehenden einen Kreis schließt. */
function bildetKreis(
  referred: string,
  referrer: string,
  bestehend: Map<string, string>,
): boolean {
  let aktuell: string | undefined = referrer;
  const gesehen = new Set<string>([referred]);
  // Tiefe begrenzen: eine sehr lange Kette ist kein Kreis, aber auch kein
  // Grund, hier ewig zu laufen.
  for (let i = 0; i < 100 && aktuell; i++) {
    if (gesehen.has(aktuell)) return true;
    gesehen.add(aktuell);
    aktuell = bestehend.get(aktuell);
  }
  return false;
}

/**
 * Die Kette für einen Provider: wer ihn geworben hat und wer wiederum diesen.
 *
 * Ebene 3 und tiefer wird bewusst nicht zurückgegeben — das Protokoll vergütet
 * nur zwei Ebenen (siehe referral.ts).
 */
export function chainFor(pubkey: string, graph: ReferralGraph): ReferralChain {
  const level1 = graph.referrerOf.get(pubkey);
  if (!level1) return {};
  const level2 = graph.referrerOf.get(level1);
  // Selbstbezug abfangen: level2 === pubkey hiesse, der Geworbene verdient an
  // sich selbst mit.
  return { level1, level2: level2 && level2 !== pubkey ? level2 : undefined };
}

/**
 * Übersicht für einen einzelnen Werber — das, was die App anzeigt.
 */
export function referrerOverview(
  pubkey: string,
  graph: ReferralGraph,
): {
  activeReferrals: number;
  totalReferrals: number;
  level2Count: number;
  referredPubkeys: string[];
} {
  const direkt = [...graph.referrerOf.entries()]
    .filter(([, r]) => r === pubkey)
    .map(([referred]) => referred);

  const level2 = new Set<string>();
  for (const d of direkt) {
    for (const [referred, r] of graph.referrerOf) {
      if (r === d && referred !== pubkey) level2.add(referred);
    }
  }

  return {
    activeReferrals: direkt.filter((d) => graph.activeProviders.has(d)).length,
    totalReferrals: direkt.length,
    level2Count: level2.size,
    referredPubkeys: direkt,
  };
}
