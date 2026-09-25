/**
 * Streitfall bei Aufträgen und Vergütung für Relays.
 *
 * ZWEI LÜCKEN, DIE DIESELBE URSACHE HABEN
 * Beide entstehen daraus, dass eine Leistung erbracht wird, bevor klar ist, ob
 * sie ankommt.
 *
 * **Streitfall.** Ein Kunde zahlt, der Provider liefert Unsinn oder gar
 * nichts. Es gibt Redundanz und Konsens, aber keinen Rückweg für das Geld. Bei
 * Swaps ist das gelöst — dort liegt das Geld in einem HTLC mit Frist. Bei
 * Rechenaufträgen nicht, und die Asymmetrie fällt jedem auf, der beides
 * benutzt.
 *
 * **Relays.** Provider verdienen, Werber verdienen, der Pool verteilt. Relays
 * tragen die gesamte Koordination und bekommen nichts. Das ist derselbe
 * Fehler, den das Projekt bei Providern vermieden hat — nur eine Ebene tiefer
 * und bisher unbemerkt. Die Folge ist vorhersehbar: Bei Wachstum werfen die
 * unbezahlten Relays zuerst hin.
 *
 * WAS BEIDE LÖSUNGEN GEMEINSAM HABEN
 * Sie kommen ohne Schiedsrichter aus. Beim Streitfall entscheidet ein zweiter
 * Provider, nicht eine Instanz; bei den Relays entscheidet nachgewiesene
 * Zustellung, nicht eine Zuteilung.
 */
import { NostrEvent, UnsignedEvent, buildEvent, getTag } from "./event.js";

/** Reklamation eines Kunden. */
export const KIND_JOB_DISPUTE = 38072;
/** Ergebnis der Nachprüfung. */
export const KIND_DISPUTE_RESOLUTION = 38073;
/** Zustellnachweis eines Relays. */
export const KIND_RELAY_PROOF = 38074;

// ------------------------------------------------------------ Streitfall

export type DisputeReason = "nichts_geliefert" | "unbrauchbar" | "falsches_modell" | "abgebrochen";

export const DISPUTE_LABEL: Record<DisputeReason, string> = {
  nichts_geliefert: "gar keine Antwort",
  unbrauchbar: "Antwort unbrauchbar",
  falsches_modell: "anderes Modell als vereinbart",
  abgebrochen: "mittendrin abgebrochen",
};

export interface Dispute {
  jobId: string;
  customerPubkey: string;
  providerPubkey: string;
  reason: DisputeReason;
  amountMsat: number;
  note: string;
  createdAt: number;
}

/**
 * Frist, innerhalb derer reklamiert werden kann.
 *
 * Kurz gewählt. Eine lange Frist bindet die Einnahmen des Providers und macht
 * ihn erpressbar; eine zu kurze nützt dem Kunden nichts. Eine Stunde reicht,
 * um eine Antwort anzusehen.
 */
export const DISPUTE_WINDOW_SECS = 3600;

export function buildDispute(d: Omit<Dispute, "createdAt">, createdAt?: number): UnsignedEvent {
  return buildEvent(
    d.customerPubkey,
    KIND_JOB_DISPUTE,
    [
      ["d", `dispute:${d.jobId}`],
      ["e", d.jobId],
      ["p", d.providerPubkey],
      ["reason", d.reason],
      ["amount_msat", String(d.amountMsat)],
    ],
    d.note,
    createdAt,
  );
}

export function parseDispute(ev: NostrEvent): Dispute {
  if (ev.kind !== KIND_JOB_DISPUTE) throw new Error(`keine Reklamation: kind ${ev.kind}`);
  const jobId = getTag(ev, "e");
  const provider = getTag(ev, "p");
  const betrag = Number(getTag(ev, "amount_msat") ?? "NaN");
  if (!jobId || !provider || !Number.isFinite(betrag)) throw new Error("Reklamation unvollständig");
  const grund = getTag(ev, "reason") ?? "unbrauchbar";
  return {
    jobId,
    customerPubkey: ev.pubkey,
    providerPubkey: provider,
    reason: (Object.keys(DISPUTE_LABEL).includes(grund) ? grund : "unbrauchbar") as DisputeReason,
    amountMsat: betrag,
    note: ev.content,
    createdAt: ev.created_at,
  };
}

export type Resolution = "erstattet" | "bestaetigt" | "geteilt" | "unentschieden";

export interface DisputeResolution {
  jobId: string;
  /** Der zweite Provider, der nachgeprüft hat. */
  reviewerPubkey: string;
  resolution: Resolution;
  /** Was an den Kunden zurückgeht. */
  refundMsat: number;
  note: string;
  createdAt: number;
}

export function buildResolution(
  r: Omit<DisputeResolution, "createdAt">,
  createdAt?: number,
): UnsignedEvent {
  return buildEvent(
    r.reviewerPubkey,
    KIND_DISPUTE_RESOLUTION,
    [
      ["d", `resolution:${r.jobId}`],
      ["e", r.jobId],
      ["result", r.resolution],
      ["refund_msat", String(r.refundMsat)],
    ],
    r.note,
    createdAt,
  );
}

export interface DisputeVerdict {
  resolution: Resolution;
  refundMsat: number;
  message: string;
}

export interface DisputeResolveOptions {
  /** Prüfer, deren Urteil zählt — üblicherweise Provider mit Reputation. */
  eligibleReviewers?: Set<string>;
  nowSecs?: number;
}

/**
 * Reklamation entscheiden.
 *
 * Kein Schiedsrichter: Ein zweiter Provider bearbeitet dieselbe Anfrage. Sein
 * Urteil zählt nur, wenn er weder Kunde noch beschuldigter Provider ist —
 * sonst entscheidet eine Partei über sich selbst.
 *
 * Bei „gar keine Antwort" braucht es keine Nachprüfung: Entweder liegt ein
 * Ergebnis vor oder nicht, und das ist nachsehbar.
 */
export function resolveDispute(
  dispute: Dispute,
  resultExists: boolean,
  reviewEvents: NostrEvent[],
  opts: DisputeResolveOptions = {},
): DisputeVerdict {
  if (!resultExists && dispute.reason === "nichts_geliefert") {
    return {
      resolution: "erstattet",
      refundMsat: dispute.amountMsat,
      message: "Kein Ergebnis auffindbar. Voller Rückfluss, ohne Nachprüfung.",
    };
  }

  const urteile: DisputeResolution[] = [];
  for (const ev of reviewEvents) {
    if (ev.kind !== KIND_DISPUTE_RESOLUTION) continue;
    if (getTag(ev, "e") !== dispute.jobId) continue;
    // Eine Partei darf nicht über sich selbst urteilen.
    if (ev.pubkey === dispute.customerPubkey || ev.pubkey === dispute.providerPubkey) continue;
    if (opts.eligibleReviewers && !opts.eligibleReviewers.has(ev.pubkey)) continue;

    const res = getTag(ev, "result") ?? "unentschieden";
    urteile.push({
      jobId: dispute.jobId,
      reviewerPubkey: ev.pubkey,
      resolution: (["erstattet", "bestaetigt", "geteilt", "unentschieden"].includes(res)
        ? res : "unentschieden") as Resolution,
      refundMsat: Number(getTag(ev, "refund_msat") ?? "0"),
      note: ev.content,
      createdAt: ev.created_at,
    });
  }

  if (urteile.length === 0) {
    // Ohne Nachprüfung bleibt es beim Provider. Im Zweifel gegen den
    // Reklamierenden — sonst wäre jede Reklamation ein Gratis-Job.
    return {
      resolution: "unentschieden",
      refundMsat: 0,
      message:
        "Niemand hat nachgeprüft. Die Zahlung bleibt beim Provider — " +
        "sonst wäre jede Reklamation ein kostenloser Auftrag.",
    };
  }

  const fuerErstattung = urteile.filter((u) => u.resolution === "erstattet").length;
  const fuerProvider = urteile.filter((u) => u.resolution === "bestaetigt").length;

  if (fuerErstattung > fuerProvider) {
    return {
      resolution: "erstattet",
      refundMsat: dispute.amountMsat,
      message: `${fuerErstattung} von ${urteile.length} Prüfern geben dem Kunden recht.`,
    };
  }
  if (fuerProvider > fuerErstattung) {
    return {
      resolution: "bestaetigt",
      refundMsat: 0,
      message: `${fuerProvider} von ${urteile.length} Prüfern bestätigen die Leistung.`,
    };
  }

  // Gleichstand: teilen. Bei kreativen Aufgaben gibt es kein „richtig", und
  // ein Münzwurf wäre schlechter als ein Kompromiss.
  return {
    resolution: "geteilt",
    refundMsat: Math.floor(dispute.amountMsat / 2),
    message: "Die Prüfer sind uneins. Der Betrag wird geteilt.",
  };
}

/** Kann noch reklamiert werden? */
export function disputeWindowOpen(
  jobFinishedAt: number,
  nowSecs = Math.floor(Date.now() / 1000),
): { open: boolean; remainingSecs: number; message: string } {
  const rest = jobFinishedAt + DISPUTE_WINDOW_SECS - nowSecs;
  if (rest <= 0) {
    return { open: false, remainingSecs: 0, message: "Reklamationsfrist abgelaufen." };
  }
  return {
    open: true,
    remainingSecs: rest,
    message: `Noch ${Math.ceil(rest / 60)} Minuten Zeit zu reklamieren.`,
  };
}

/**
 * Was das Verfahren leistet — und was nicht.
 *
 * Bei kreativen Aufgaben gibt es kein „richtig". Das Verfahren fängt den
 * Totalausfall ab, nicht die Geschmacksfrage, und das gehört in die
 * Beschreibung statt in die Enttäuschung des ersten Nutzers.
 */
export function disputeInfo(): string {
  return [
    "Reklamation: Sie geht versiegelt an den Provider und, wenn du einen",
    "wählst, an einen zweiten Provider als Prüfer. Relays sehen weder Grund",
    "noch Betrag noch, wer reklamiert.",
    "",
    "Noch nicht automatisch: Nachprüfung und Rückzahlung. Die Reklamation",
    "benachrichtigt beide – eine Erstattung folgt daraus noch nicht von selbst.",
    "",
    "Wofür sie gedacht ist: gar keine Antwort, abgebrochene Jobs, ein anderes",
    "Modell als vereinbart, offensichtlicher Unsinn.",
    "",
    "Was es NICHT abfängt: „Die Antwort gefällt mir nicht.“ Bei kreativen",
    "Aufgaben gibt es kein Richtig, und kein Prüfer kann darüber entscheiden.",
    "",
    `Frist: ${DISPUTE_WINDOW_SECS / 60} Minuten. Länger würde die Einnahmen`,
    "des Providers binden und ihn erpressbar machen.",
  ].join("\n");
}

// ------------------------------------------------------------ Relays

export interface RelayProof {
  relayPubkey: string;
  /** Zeitraum. */
  fromUnix: number;
  untilUnix: number;
  /** Zugestellte Ereignisse. */
  delivered: number;
  /** Verschiedene Clients, die bedient wurden. */
  uniqueClients: number;
  /** Öffentliche Adresse — nur erreichbare Relays werden vergütet. */
  url: string;
  createdAt: number;
}

export function buildRelayProof(p: Omit<RelayProof, "createdAt">, createdAt?: number): UnsignedEvent {
  return buildEvent(
    p.relayPubkey,
    KIND_RELAY_PROOF,
    [
      ["d", `relay-proof:${p.untilUnix}`],
      ["period", String(p.fromUnix), String(p.untilUnix)],
      ["delivered", String(p.delivered)],
      ["clients", String(p.uniqueClients)],
      ["url", p.url],
    ],
    "",
    createdAt,
  );
}

export function parseRelayProof(ev: NostrEvent): RelayProof {
  if (ev.kind !== KIND_RELAY_PROOF) throw new Error(`kein Relay-Nachweis: kind ${ev.kind}`);
  const zeitraum = ev.tags.find((t) => t[0] === "period");
  const url = getTag(ev, "url");
  if (!zeitraum || !url) throw new Error("Relay-Nachweis unvollständig");
  return {
    relayPubkey: ev.pubkey,
    fromUnix: Number(zeitraum[1]),
    untilUnix: Number(zeitraum[2]),
    delivered: Number(getTag(ev, "delivered") ?? "0"),
    uniqueClients: Number(getTag(ev, "clients") ?? "0"),
    url,
    createdAt: ev.created_at,
  };
}

/** Anteil des Reward-Pools für Relays. */
export const RELAY_SHARE_PERCENT = 15;

export interface RelayPayout {
  relayPubkey: string;
  url: string;
  amountMsat: number;
  share: number;
  basis: string;
}

export interface RelayDistributionOptions {
  /** Relays, deren Erreichbarkeit geprüft wurde. */
  reachable?: Set<string>;
  minPayoutMsat?: number;
  nowSecs?: number;
}

/**
 * Pool-Anteil auf Relays verteilen.
 *
 * Gewichtet nach **verschiedenen Clients**, nicht nach zugestellten
 * Ereignissen. Die Zahl der Ereignisse kann ein Relay selbst erzeugen; die
 * Zahl verschiedener Clients zu fälschen kostet dagegen, weil jeder Client
 * ein Schlüssel ist, den jemand benutzen muss.
 *
 * Der Wurzelfaktor dämpft zusätzlich: Ein Relay mit hundertfacher Reichweite
 * bekommt das Zehnfache, nicht das Hundertfache. Sonst drängt der größte
 * Anbieter alle anderen heraus — und eine Handvoll großer Relays ist genau
 * die Zentralisierung, die vermieden werden soll.
 */
export function distributeToRelays(
  poolMsat: number,
  proofs: NostrEvent[],
  opts: RelayDistributionOptions = {},
): { payouts: RelayPayout[]; unallocatedMsat: number; note: string } {
  const min = opts.minPayoutMsat ?? 10_000;
  const anteilMsat = Math.floor((poolMsat * RELAY_SHARE_PERCENT) / 100);

  const proRelay = new Map<string, RelayProof>();
  for (const ev of proofs) {
    let p: RelayProof;
    try {
      p = parseRelayProof(ev);
    } catch {
      continue;
    }
    // Nur erreichbare Relays. Ein Nachweis ist eine Behauptung; die
    // Erreichbarkeit lässt sich nachsehen.
    if (opts.reachable && !opts.reachable.has(p.relayPubkey)) continue;
    const bisher = proRelay.get(p.relayPubkey);
    if (!bisher || p.untilUnix > bisher.untilUnix) proRelay.set(p.relayPubkey, p);
  }

  const gewichtet = [...proRelay.values()].map((p) => ({
    p,
    gewicht: Math.sqrt(Math.max(0, p.uniqueClients)),
  })).filter((x) => x.gewicht > 0);

  const gesamt = gewichtet.reduce((s, x) => s + x.gewicht, 0);
  if (gesamt === 0 || anteilMsat <= 0) {
    return {
      payouts: [], unallocatedMsat: anteilMsat,
      note: "Keine erreichbaren Relays mit Nachweis.",
    };
  }

  const payouts = gewichtet.map((x) => ({
    relayPubkey: x.p.relayPubkey,
    url: x.p.url,
    amountMsat: Math.floor((anteilMsat * x.gewicht) / gesamt),
    share: x.gewicht / gesamt,
    basis: `${x.p.uniqueClients} verschiedene Clients, ${x.p.delivered} Ereignisse`,
  })).filter((x) => x.amountMsat >= min)
    .sort((a, b) => b.amountMsat - a.amountMsat);

  const verteilt = payouts.reduce((s, x) => s + x.amountMsat, 0);
  return {
    payouts,
    unallocatedMsat: anteilMsat - verteilt,
    note:
      `${Math.floor(verteilt / 1000)} sats an ${payouts.length} Relay(s) — ` +
      `${RELAY_SHARE_PERCENT} % des Pools, gewichtet nach Reichweite mit Dämpfung.`,
  };
}

export function relayEconomicsInfo(): string {
  return [
    `Relays bekommen ${RELAY_SHARE_PERCENT} % des Reward-Pools.`,
    "",
    "Gewichtet nach verschiedenen Clients, nicht nach zugestellten",
    "Ereignissen: Ereignisse kann ein Relay selbst erzeugen, Clients nicht",
    "ohne Aufwand.",
    "",
    "Gedämpft mit der Wurzel: Hundertfache Reichweite bringt das Zehnfache,",
    "nicht das Hundertfache. Eine Handvoll großer Relays wäre genau die",
    "Zentralisierung, die das Protokoll vermeiden soll.",
    "",
    "Nur erreichbare Relays werden vergütet — ein Nachweis ist eine",
    "Behauptung, die Erreichbarkeit lässt sich nachsehen.",
  ].join("\n");
}
