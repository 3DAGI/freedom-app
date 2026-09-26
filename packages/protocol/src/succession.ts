/**
 * Nachfolge: was passiert, wenn jemand nicht mehr kann.
 *
 * DIE LÜCKE
 * Heute gilt: Schlüssel weg, alles weg. Für eure Zielgruppe ist das keine
 * theoretische Frage. Ein Journalist wird verhaftet. Ein Provider mit
 * laufenden Einnahmen stirbt. Jemand verliert auf der Flucht sein Gerät. Eine
 * Community, deren Gründer nicht mehr da ist, hat keine Moderatoren mehr.
 *
 * Für alle vier Fälle gibt es in Nostr keine Antwort — und das ist die Stelle,
 * an der „du behältst deine Schlüssel" von einem Versprechen zu einem Risiko
 * wird.
 *
 * ZWEI VERSCHIEDENE DINGE
 *
 * *Wiederherstellung*: Du bist da, dein Gerät nicht. Vertraute helfen dir
 * zurück an deinen eigenen Schlüssel.
 *
 * *Nachfolge*: Du bist nicht mehr da. Jemand anderes übernimmt — und zwar
 * nachweislich erst dann.
 *
 * Beide brauchen dieselbe Technik, aber verschiedene Auslöser und
 * verschiedene Wartezeiten. Sie zusammenzuwerfen wäre gefährlich: Ein
 * Wiederherstellungsverfahren, das so leicht auslöst wie eines für den
 * Todesfall, ist eine Einladung zur Übernahme.
 *
 * DIE EHRLICHE GRENZE
 * Genug Vertraute, die sich absprechen, können übernehmen, solange der
 * Besitzer lebt. Dagegen hilft keine Technik, nur die Auswahl der Personen —
 * plus Schwelle, Wartezeit und öffentliche Ankündigung, damit es nicht
 * unbemerkt geht. Das steht so auch im Hinweistext und nicht im
 * Kleingedruckten.
 */
import { NostrEvent, UnsignedEvent, buildEvent, getTag } from "./event.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** Lebenszeichen des Besitzers. */
export const KIND_HEARTBEAT = 38063;
/** Nachfolgeplan: wer darf wann übernehmen. */
export const KIND_SUCCESSION_PLAN = 38064;
/** Ein Vertrauter meldet: „Ich halte den Auslöser für erfüllt." */
export const KIND_RECOVERY_CLAIM = 38065;

// --------------------------------------------------- Shamir über GF(256)

// Generator 2 mit dem Polynom 0x11d. Die Kombination ist nicht beliebig:
// 0x11d mit Generator 3 erreicht nur 51 der 255 Werte, und dann fallen
// verschiedene Anteile zusammen — das Geheimnis liesse sich aus weniger
// Teilen rekonstruieren als vorgesehen. Die Selbstpruefung unten faengt eine
// falsche Kombination ab, statt sie still durchzulassen.
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x = (x << 1) ^ (x & 0x80 ? 0x11d : 0);
    x &= 0xff;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];

  // Ein echter Generator erreicht jeden Wert ausser 0 genau einmal.
  if (new Set(EXP.slice(0, 255)).size !== 255) {
    throw new Error("succession: GF(256)-Tabelle unvollstaendig — Generator falsch gewaehlt");
  }
})();

const mul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
const div = (a: number, b: number): number => {
  if (b === 0) throw new Error("Division durch null");
  return a === 0 ? 0 : EXP[LOG[a] + 255 - LOG[b]];
};

export interface Share {
  /** 1..255, nie 0 — bei 0 stünde das Geheimnis im Klartext. */
  index: number;
  data: Uint8Array;
}

/**
 * Zerlegt ein Geheimnis in n Teile, von denen k zur Rekonstruktion genügen.
 *
 * Unter k Teilen ist mathematisch nichts über das Geheimnis bekannt — nicht
 * „schwer zu berechnen", sondern nichts.
 */
export function splitSecret(secret: Uint8Array, n: number, k: number): Share[] {
  if (k < 2) throw new Error("Schwelle muss mindestens 2 sein — bei 1 genügt ein Vertrauter allein.");
  if (n < k) throw new Error(`${n} Teile reichen für eine Schwelle von ${k} nicht.`);
  if (n > 255) throw new Error("Höchstens 255 Teile.");

  const shares: Share[] = Array.from({ length: n }, (_, i) => ({
    index: i + 1,
    data: new Uint8Array(secret.length),
  }));

  for (let byteIdx = 0; byteIdx < secret.length; byteIdx++) {
    // Zufälliges Polynom vom Grad k-1 mit dem Geheimnis als konstantem Glied.
    const coeff = new Uint8Array(k);
    coeff[0] = secret[byteIdx];
    const rnd = crypto.getRandomValues(new Uint8Array(k - 1));
    coeff.set(rnd, 1);

    for (const s of shares) {
      let y = 0;
      for (let d = k - 1; d >= 0; d--) y = mul(y, s.index) ^ coeff[d];
      s.data[byteIdx] = y;
    }
  }
  return shares;
}

/** Setzt das Geheimnis aus k Teilen wieder zusammen. */
export function combineShares(shares: Share[]): Uint8Array {
  if (shares.length < 2) throw new Error("Mindestens zwei Teile nötig.");
  const len = shares[0].data.length;
  if (shares.some((s) => s.data.length !== len)) throw new Error("Teile haben verschiedene Längen.");
  if (new Set(shares.map((s) => s.index)).size !== shares.length) {
    throw new Error("Doppelte Teile — sie tragen nichts bei.");
  }

  const out = new Uint8Array(len);
  for (let byteIdx = 0; byteIdx < len; byteIdx++) {
    let summe = 0;
    for (let i = 0; i < shares.length; i++) {
      let lagrange = 1;
      for (let j = 0; j < shares.length; j++) {
        if (i === j) continue;
        lagrange = mul(lagrange, div(shares[j].index, shares[i].index ^ shares[j].index));
      }
      summe ^= mul(shares[i].data[byteIdx], lagrange);
    }
    out[byteIdx] = summe;
  }
  return out;
}

// ------------------------------------------------------------- Plan

export type Trigger = "inaktivitaet" | "manuell";

export interface SuccessionPlan {
  ownerPubkey: string;
  /** Vertraute, die je einen Teil halten. */
  guardians: string[];
  /** Wie viele zusammenkommen müssen. */
  threshold: number;
  /** Nach wie vielen Tagen ohne Lebenszeichen der Auslöser greift. */
  inactivityDays: number;
  /** Wartezeit nach dem Auslösen, bevor es wirksam wird. */
  graceDays: number;
  /** Prüfsumme des Geheimnisses — damit klar ist, ob die Teile zusammenpassen. */
  secretHash: string;
  createdAt: number;
}

export function buildSuccessionPlan(p: Omit<SuccessionPlan, "createdAt">, createdAt?: number): UnsignedEvent {
  return buildEvent(
    p.ownerPubkey,
    KIND_SUCCESSION_PLAN,
    [
      ["d", "succession"],
      ...p.guardians.map((g) => ["p", g, "guardian"]),
      ["threshold", String(p.threshold)],
      ["inactivity_days", String(p.inactivityDays)],
      ["grace_days", String(p.graceDays)],
      ["secret_hash", p.secretHash],
    ],
    "",
    createdAt,
  );
}

export function parseSuccessionPlan(ev: NostrEvent): SuccessionPlan {
  if (ev.kind !== KIND_SUCCESSION_PLAN) throw new Error(`kein Nachfolgeplan: kind ${ev.kind}`);
  const guardians = ev.tags.filter((t) => t[0] === "p" && t[2] === "guardian").map((t) => t[1]);
  const threshold = Number(getTag(ev, "threshold") ?? "NaN");
  if (guardians.length === 0 || !Number.isFinite(threshold)) throw new Error("Plan unvollständig");
  if (threshold > guardians.length) throw new Error("Schwelle höher als die Zahl der Vertrauten");
  if (threshold < 2) throw new Error("Schwelle unter 2 — ein Einzelner könnte übernehmen");
  return {
    ownerPubkey: ev.pubkey,
    guardians,
    threshold,
    inactivityDays: Number(getTag(ev, "inactivity_days") ?? "180"),
    graceDays: Number(getTag(ev, "grace_days") ?? "30"),
    secretHash: getTag(ev, "secret_hash") ?? "",
    createdAt: ev.created_at,
  };
}

export function buildHeartbeat(ownerPubkey: string, createdAt?: number): UnsignedEvent {
  return buildEvent(ownerPubkey, KIND_HEARTBEAT, [["d", "alive"]], "", createdAt);
}

export function buildRecoveryClaim(
  guardianPubkey: string, ownerPubkey: string, reason: string, createdAt?: number,
): UnsignedEvent {
  return buildEvent(
    guardianPubkey, KIND_RECOVERY_CLAIM,
    [["d", `claim:${ownerPubkey}`], ["p", ownerPubkey]],
    reason, createdAt,
  );
}

export type SuccessionStatus = "aktiv" | "still" | "ausgeloest" | "wartefrist" | "freigegeben";

export interface SuccessionState {
  status: SuccessionStatus;
  /** Tage seit dem letzten Lebenszeichen. */
  daysSinceHeartbeat: number;
  /** Vertraute, die den Auslöser für erfüllt halten. */
  claims: string[];
  /** Tage, bis die Freigabe wirksam wird. */
  daysUntilRelease?: number;
  message: string;
}

/**
 * Wertet den Stand aus.
 *
 * Die Wartezeit nach dem Auslösen ist der eigentliche Schutz: Sie gibt dem
 * Besitzer Gelegenheit zu widersprechen, indem er einfach ein Lebenszeichen
 * veröffentlicht. Ohne sie wäre eine Absprache unter Vertrauten sofort
 * wirksam und unbemerkt.
 */
export function evaluateSuccession(
  plan: SuccessionPlan,
  events: NostrEvent[],
  nowSecs = Math.floor(Date.now() / 1000),
): SuccessionState {
  const TAG = 86400;

  let letztes = plan.createdAt;
  for (const ev of events) {
    if (ev.kind === KIND_HEARTBEAT && ev.pubkey === plan.ownerPubkey) {
      letztes = Math.max(letztes, ev.created_at);
    }
  }
  // Geht die eigene Uhr etwas nach, waere das sonst „vor -1 Tagen“
  const tageStill = Math.max(0, Math.floor((nowSecs - letztes) / TAG));

  // Nur Meldungen von benannten Vertrauten, und nur solche NACH dem letzten
  // Lebenszeichen: Eine alte Meldung darf nicht wieder aufleben, wenn sich
  // der Besitzer zwischenzeitlich gemeldet hat.
  const claims: { by: string; at: number }[] = [];
  for (const ev of events) {
    if (ev.kind !== KIND_RECOVERY_CLAIM) continue;
    if (getTag(ev, "p") !== plan.ownerPubkey) continue;
    if (!plan.guardians.includes(ev.pubkey)) continue;
    if (ev.created_at <= letztes) continue;
    if (!claims.some((c) => c.by === ev.pubkey)) claims.push({ by: ev.pubkey, at: ev.created_at });
  }
  const claimPubkeys = claims.map((c) => c.by);

  if (tageStill < plan.inactivityDays) {
    return {
      status: claims.length > 0 ? "still" : "aktiv",
      daysSinceHeartbeat: tageStill,
      claims: claimPubkeys,
      message:
        claims.length > 0
          ? `${claims.length} Vertraute haben gemeldet, aber das letzte Lebenszeichen ist erst ` +
            `${tageStill} Tage her. Der Auslöser greift nach ${plan.inactivityDays} Tagen.`
          : `Lebenszeichen vor ${tageStill} Tagen. Alles normal.`,
    };
  }

  if (claims.length < plan.threshold) {
    return {
      status: "ausgeloest",
      daysSinceHeartbeat: tageStill,
      claims: claimPubkeys,
      message:
        `Seit ${tageStill} Tagen kein Lebenszeichen. ${claims.length} von ${plan.threshold} ` +
        `nötigen Meldungen liegen vor.`,
    };
  }

  // Wartefrist ab der Meldung, die die Schwelle erreicht hat.
  const ausloesend = claims.sort((a, b) => a.at - b.at)[plan.threshold - 1].at;
  const tageSeitAusloesung = Math.floor((nowSecs - ausloesend) / TAG);
  if (tageSeitAusloesung < plan.graceDays) {
    return {
      status: "wartefrist",
      daysSinceHeartbeat: tageStill,
      claims: claimPubkeys,
      daysUntilRelease: plan.graceDays - tageSeitAusloesung,
      message:
        `Schwelle erreicht. Freigabe in ${plan.graceDays - tageSeitAusloesung} Tagen. ` +
        `Ein einziges Lebenszeichen des Besitzers bricht den Vorgang ab.`,
    };
  }

  return {
    status: "freigegeben",
    daysSinceHeartbeat: tageStill,
    claims: claimPubkeys,
    message: `Freigegeben. ${plan.threshold} Vertraute können den Schlüssel zusammensetzen.`,
  };
}

/** Passen die Teile zum angekündigten Geheimnis? */
export function verifyRecovered(secret: Uint8Array, plan: SuccessionPlan): boolean {
  return bytesToHex(sha256(secret)) === plan.secretHash;
}

export function secretHashOf(secret: Uint8Array): string {
  return bytesToHex(sha256(secret));
}

/**
 * Hinweistext vor dem Einrichten.
 *
 * Die Grenze gehört nach vorn: Wer die Vertrauten schlecht wählt, hilft ihm
 * keine Technik. Eine Zustimmung ohne Verständnis ist keine.
 */
export function successionWarning(plan: { guardians: number; threshold: number; graceDays: number }): string {
  return [
    `${plan.threshold} von ${plan.guardians} Vertrauten können deinen Schlüssel zusammensetzen.`,
    "",
    "Was das schützt:",
    "  · Verlierst du dein Gerät, kommst du zurück an deine Identität.",
    "  · Bist du nicht mehr da, kann jemand übernehmen — nachweislich erst dann.",
    "",
    "Was es NICHT schützt:",
    `  · Sprechen sich ${plan.threshold} Vertraute ab, können sie übernehmen,`,
    "    solange du lebst. Dagegen hilft keine Technik, nur die Auswahl.",
    `  · Du hast ${plan.graceDays} Tage Zeit zu widersprechen — aber nur, wenn du`,
    "    mitbekommst, dass es läuft.",
    "  · Der Plan ist öffentlich: Wer deine Vertrauten sind, sieht jeder –",
    "    damit Meldungen und Lebenszeichen für alle prüfbar bleiben.",
    "",
    "Wähle Menschen, die sich nicht kennen. Eine Familie zählt als einer.",
  ].join("\n");
}
