/**
 * Schlüsselwechsel: was passiert, wenn ein Schlüssel GESTOHLEN wurde.
 *
 * DIE LÜCKE, DIE DAS SCHLIESST
 * Die Nachfolge löst den Fall „Schlüssel verloren". Für „Schlüssel gestohlen"
 * gab es bisher **gar nichts** — und das ist der schlimmere Fall. Wer deinen
 * Schlüssel hat, ist du: Er schreibt in deinem Namen, kassiert deine
 * Belohnungen, vergibt Rollen in deinen Räumen und kann das für immer tun.
 * Eine Identität ohne Widerrufsmöglichkeit ist eine, die man nur einmal
 * verlieren muss.
 *
 * WARUM DAS SCHWER IST
 * Der Dieb kann dieselben Ereignisse veröffentlichen wie du — auch eine
 * Widerrufserklärung. Aus Sicht der Relays sind beide identisch. Wer zuerst
 * kommt, gewinnt, und der Dieb merkt es zuerst.
 *
 * DIE LÖSUNG: VORBEREITUNG STATT REAKTION
 * Der Widerruf wird **im Voraus** signiert, solange der Schlüssel noch sicher
 * ist, und getrennt aufbewahrt. Er benennt den Nachfolgeschlüssel. Ein Dieb,
 * der nur den laufenden Schlüssel hat, kann keinen gültigen Widerruf
 * erzeugen, weil er den Nachfolger nicht kennt — und einen eigenen Widerruf
 * auf einen eigenen Schlüssel auszustellen nützt ihm nichts, denn das
 * **früheste** Vorabmandat gewinnt.
 *
 * Das ist derselbe Gedanke wie beim Referral-Graphen: Wo zwei
 * widersprüchliche Aussagen möglich sind, entscheidet nicht die lauteste,
 * sondern die älteste.
 *
 * DIE EHRLICHE GRENZE
 * Wer beides hat — laufenden Schlüssel und Widerrufserklärung — kann die
 * Identität übernehmen. Deshalb gehört die Erklärung nicht auf dasselbe
 * Gerät. Und: Wer den Widerruf nie vorbereitet hat, kann nach einem Diebstahl
 * nichts mehr tun. Das steht im Hinweistext, nicht im Kleingedruckten.
 *
 * ZWEI LÜCKEN, DIE 8.6a SCHLIESST (Entscheidung MENSCH 26.09.2026)
 * 1. Das Mandat war ein ersetzbares Event mit festem d-Tag („rotation“) –
 *    ein Dieb mit dem alten Schlüssel konnte es auf den Relays durch sein
 *    eigenes ERSETZEN. Seit 8.6a hat jedes Mandat seine eigene Adresse
 *    (`rotation:<nachfolger>`); ein zweites ersetzt das erste nicht mehr.
 * 2. `created_at` setzt der Absender selbst – ein Dieb kann sein Mandat
 *    zurückdatieren. Die Apps der Kontakte merken sich deshalb das ERSTE
 *    Mandat, das sie zu einer Person sehen (`merkeMandate`), und `resolveKey`
 *    nimmt dieses statt des ältesten Zeitstempels. Wer das echte Mandat nie
 *    gesehen hat, ist erst mit Zeitzeugen (5.10) geschützt.
 */
import { NostrEvent, UnsignedEvent, buildEvent, getTag } from "./event.js";

/** Vorab signiertes Mandat: „dieser Schlüssel darf mich ablösen." */
export const KIND_ROTATION_MANDATE = 38067;
/** Der eigentliche Widerruf, veröffentlicht im Ernstfall. */
export const KIND_KEY_REVOCATION = 38068;

export type RevocationReason = "gestohlen" | "unsicher" | "planmaessig";

export interface RotationMandate {
  /** Der bisherige Schlüssel. */
  oldPubkey: string;
  /** Der Nachfolger. */
  newPubkey: string;
  createdAt: number;
}

/**
 * Mandat erstellen — solange der Schlüssel noch sicher ist.
 *
 * Wird vom ALTEN Schlüssel signiert und benennt den neuen. Ohne dieses
 * Ereignis ist ein späterer Widerruf wertlos, weil niemand unterscheiden
 * kann, ob er vom Eigentümer oder vom Dieb stammt.
 */
export function buildRotationMandate(
  oldPubkey: string,
  newPubkey: string,
  createdAt?: number,
): UnsignedEvent {
  if (oldPubkey === newPubkey) {
    throw new Error("Der Nachfolger darf nicht derselbe Schlüssel sein.");
  }
  return buildEvent(
    oldPubkey,
    KIND_ROTATION_MANDATE,
    // Eigene Adresse je Nachfolger (8.6a) – ein spaeteres Mandat ersetzt dieses nicht.
    [["d", `rotation:${newPubkey}`], ["p", newPubkey, "", "successor"]],
    "",
    createdAt,
  );
}

/** Zuerst gesehene Mandate: alter Schluessel → Nachfolger und wann gesehen. */
export type GemerkteMandate = Record<string, { neu: string; gesehen: number }>;

/**
 * Mandate merken (8.6a): je altem Schluessel nur das erste, das diese App
 * sieht – spaetere oder zurueckdatierte aendern nichts mehr. Liefert eine
 * neue Karte und ob sie sich geaendert hat.
 */
export function merkeMandate(
  bekannt: GemerkteMandate, events: readonly NostrEvent[], nowSecs = Math.floor(Date.now() / 1000),
): { gemerkt: GemerkteMandate; neu: boolean } {
  const gemerkt: GemerkteMandate = { ...bekannt };
  let neu = false;
  // Kommen mehrere zugleich zum ersten Mal, entscheidet mangels Besserem der Zeitstempel (bis 5.10).
  const kandidaten = new Map<string, RotationMandate>();
  for (const ev of events) {
    if (ev.kind !== KIND_ROTATION_MANDATE) continue;
    let m: RotationMandate;
    try { m = parseRotationMandate(ev); } catch { continue; }
    if (gemerkt[m.oldPubkey]) continue;
    const k = kandidaten.get(m.oldPubkey);
    if (!k || m.createdAt < k.createdAt) kandidaten.set(m.oldPubkey, m);
  }
  for (const m of kandidaten.values()) {
    gemerkt[m.oldPubkey] = { neu: m.newPubkey, gesehen: nowSecs };
    neu = true;
  }
  return { gemerkt, neu };
}

export function parseRotationMandate(ev: NostrEvent): RotationMandate {
  if (ev.kind !== KIND_ROTATION_MANDATE) throw new Error(`kein Mandat: kind ${ev.kind}`);
  const successor = ev.tags.find((t) => t[0] === "p" && t[3] === "successor")?.[1];
  if (!successor) throw new Error("Mandat ohne Nachfolger");
  if (successor === ev.pubkey) throw new Error("Mandat auf sich selbst");
  return { oldPubkey: ev.pubkey, newPubkey: successor, createdAt: ev.created_at };
}

export interface Revocation {
  oldPubkey: string;
  newPubkey: string;
  reason: RevocationReason;
  /** Ab wann dem alten Schlüssel nicht mehr zu trauen ist. */
  compromisedSince?: number;
  note: string;
  createdAt: number;
}

/**
 * Widerruf veröffentlichen.
 *
 * Signiert vom NEUEN Schlüssel: Der alte ist möglicherweise in fremder Hand,
 * und eine Erklärung mit ihm zu unterschreiben wäre ein Widerspruch in sich.
 */
export function buildRevocation(
  r: Omit<Revocation, "createdAt">,
  createdAt?: number,
): UnsignedEvent {
  const tags: string[][] = [
    ["d", `revoke:${r.oldPubkey}`],
    ["p", r.oldPubkey, "", "revoked"],
    ["reason", r.reason],
  ];
  if (r.compromisedSince) tags.push(["since", String(r.compromisedSince)]);
  return buildEvent(r.newPubkey, KIND_KEY_REVOCATION, tags, r.note, createdAt);
}

export function parseRevocation(ev: NostrEvent): Revocation {
  if (ev.kind !== KIND_KEY_REVOCATION) throw new Error(`kein Widerruf: kind ${ev.kind}`);
  const old = ev.tags.find((t) => t[0] === "p" && t[3] === "revoked")?.[1];
  if (!old) throw new Error("Widerruf ohne widerrufenen Schlüssel");
  const reason = getTag(ev, "reason") ?? "unsicher";
  const since = Number(getTag(ev, "since") ?? "");
  return {
    oldPubkey: old,
    newPubkey: ev.pubkey,
    reason: (["gestohlen", "unsicher", "planmaessig"].includes(reason)
      ? reason : "unsicher") as RevocationReason,
    compromisedSince: Number.isFinite(since) && since > 0 ? since : undefined,
    note: ev.content,
    createdAt: ev.created_at,
  };
}

export type KeyStatus = "gueltig" | "abgeloest" | "widerrufen" | "streitig";

export interface KeyState {
  pubkey: string;
  status: KeyStatus;
  /** Der aktuelle Schlüssel dieser Person, falls abgelöst. */
  currentPubkey: string;
  /** Wie viele Schritte die Kette lang ist. */
  chainLength: number;
  /** Ab wann Ereignisse des alten Schlüssels unglaubwürdig sind. */
  distrustFrom?: number;
  message: string;
}

export interface RotationOptions {
  /** Höchstlänge der Kette. Ohne Grenze wäre eine Schleife eine Endlosschleife. */
  maxChain?: number;
  nowSecs?: number;
  /** Zuerst gesehene Mandate (8.6a) – haben Vorrang vor dem ältesten Zeitstempel. */
  gemerkt?: GemerkteMandate;
}

/**
 * Verfolgt, welcher Schlüssel heute für eine Person gilt.
 *
 * Das **früheste** Mandat gewinnt. Ein Dieb, der nachträglich ein eigenes
 * Mandat auf seinen Schlüssel ausstellt, kommt damit nicht durch — sein
 * Mandat ist jünger. Nur wer nie vorgesorgt hat, ist dem ausgeliefert, und
 * genau das sagt die Meldung dann auch.
 */
export function resolveKey(
  pubkey: string,
  events: NostrEvent[],
  opts: RotationOptions = {},
): KeyState {
  const maxChain = opts.maxChain ?? 10;

  // Mandate je Vorgänger, das früheste gewinnt.
  const mandate = new Map<string, RotationMandate>();
  for (const ev of events) {
    if (ev.kind !== KIND_ROTATION_MANDATE) continue;
    let m: RotationMandate;
    try {
      m = parseRotationMandate(ev);
    } catch {
      continue;
    }
    // Ein gemerktes Mandat gilt; andere fuer denselben Schluessel werden ignoriert (8.6a)
    const fest = opts.gemerkt?.[m.oldPubkey];
    if (fest && fest.neu !== m.newPubkey) continue;
    const bisher = mandate.get(m.oldPubkey);
    if (!bisher || m.createdAt < bisher.createdAt) mandate.set(m.oldPubkey, m);
  }
  // Gemerkte Mandate gelten auch, wenn die Relays das Event nicht mehr liefern –
  // die App hat es gesehen und geprueft, als es kam.
  for (const [alt, fest] of Object.entries(opts.gemerkt ?? {})) {
    if (!mandate.has(alt)) mandate.set(alt, { oldPubkey: alt, newPubkey: fest.neu, createdAt: fest.gesehen });
  }

  const widerrufe = new Map<string, Revocation>();
  for (const ev of events) {
    if (ev.kind !== KIND_KEY_REVOCATION) continue;
    let r: Revocation;
    try {
      r = parseRevocation(ev);
    } catch {
      continue;
    }
    // Ein Widerruf zählt nur, wenn ein Mandat ihn deckt. Sonst könnte jeder
    // jeden für ungültig erklären.
    const m = mandate.get(r.oldPubkey);
    if (!m || m.newPubkey !== r.newPubkey) continue;
    const bisher = widerrufe.get(r.oldPubkey);
    if (!bisher || r.createdAt < bisher.createdAt) widerrufe.set(r.oldPubkey, r);
  }

  // Kette verfolgen.
  let aktuell = pubkey;
  let schritte = 0;
  let letzterWiderruf: Revocation | undefined;
  const gesehen = new Set<string>([pubkey]);

  while (schritte < maxChain) {
    const w = widerrufe.get(aktuell);
    if (!w) break;
    if (gesehen.has(w.newPubkey)) {
      // Ringschluss: A widerruft auf B, B auf A. Weiterlaufen wäre eine
      // Endlosschleife, stillschweigend abbrechen wäre irreführend.
      return {
        pubkey, status: "streitig", currentPubkey: aktuell, chainLength: schritte,
        message: "Die Schlüsselkette führt im Kreis. Hier stimmt etwas nicht — nichts annehmen.",
      };
    }
    gesehen.add(w.newPubkey);
    aktuell = w.newPubkey;
    letzterWiderruf = w;
    schritte++;
  }

  if (schritte >= maxChain) {
    return {
      pubkey, status: "streitig", currentPubkey: aktuell, chainLength: schritte,
      message: `Mehr als ${maxChain} Wechsel — unglaubwürdig.`,
    };
  }

  if (!letzterWiderruf) {
    const vorbereitet = mandate.has(pubkey);
    return {
      pubkey, status: "gueltig", currentPubkey: pubkey, chainLength: 0,
      message: vorbereitet
        ? "Gültig. Ein Nachfolger ist vorbereitet."
        : "Gültig. Kein Nachfolger vorbereitet — nach einem Diebstahl wäre nichts mehr zu machen.",
    };
  }

  const gestohlen = letzterWiderruf.reason === "gestohlen";
  return {
    pubkey,
    status: gestohlen ? "widerrufen" : "abgeloest",
    currentPubkey: aktuell,
    chainLength: schritte,
    distrustFrom: letzterWiderruf.compromisedSince,
    message: gestohlen
      ? `Dieser Schlüssel gilt als gestohlen${
          letzterWiderruf.compromisedSince
            ? ` (seit ${new Date(letzterWiderruf.compromisedSince * 1000).toISOString().slice(0, 10)})`
            : ""
        }. Alles danach stammt möglicherweise von jemand anderem.`
      : "Dieser Schlüssel wurde planmäßig abgelöst.",
  };
}

/**
 * Darf einem Ereignis noch geglaubt werden?
 *
 * Der entscheidende Teil: Ereignisse VOR dem Zeitpunkt der Kompromittierung
 * bleiben gültig. Alles nachträglich für ungültig zu erklären würde die
 * gesamte Vorgeschichte einer Person löschen — auch die Belege, auf die sich
 * andere gestützt haben.
 */
export function trustEvent(
  ev: NostrEvent,
  state: KeyState,
): { trust: boolean; reason: string } {
  if (state.status === "gueltig") return { trust: true, reason: "Schlüssel gültig." };
  if (state.status === "streitig") {
    return { trust: false, reason: "Schlüsselkette widersprüchlich." };
  }
  if (state.status === "abgeloest") {
    return { trust: true, reason: "Planmäßig abgelöst — Altes bleibt gültig." };
  }

  if (state.distrustFrom && ev.created_at < state.distrustFrom) {
    return { trust: true, reason: "Vor der Kompromittierung entstanden." };
  }
  return { trust: false, reason: "Nach der Kompromittierung — könnte vom Dieb stammen." };
}

/**
 * Hinweistext beim Einrichten.
 *
 * Die Grenze gehört nach vorn: Wer nicht vorsorgt, hat später keine Option.
 * Das ist eine der wenigen Stellen, an denen Nichtstun unumkehrbar ist.
 */
export function rotationWarning(): string {
  return [
    "Schlüsseldiebstahl ist der einzige Fall, den du NUR VORHER lösen kannst.",
    "",
    "Wir erzeugen jetzt einen Ersatzschlüssel und eine vorab signierte",
    "Erklärung: „Wenn dieser Ersatz sich meldet, bin ich das.“",
    "",
    "Bewahre beides GETRENNT von diesem Gerät auf.",
    "Wer den laufenden Schlüssel und die Erklärung zusammen hat, ist du.",
    "",
    "Ohne diese Vorbereitung gilt: Wer deinen Schlüssel stiehlt, ist",
    "dauerhaft du — und du hast keine Möglichkeit zu widersprechen.",
    "",
    "Die Grenze: Die Apps deiner Kontakte merken sich diese Erklärung, sobald",
    "sie sie sehen. Wer sie vor einem Diebstahl nie gesehen hat, kann auf eine",
    "zurückdatierte des Diebs hereinfallen – bis es Zeitzeugen gibt.",
  ].join("\n");
}

/** Anleitung für den Ernstfall. */
export function revocationInstructions(): string {
  return [
    "So widerrufst du einen gestohlenen Schlüssel:",
    "",
    "1. Ersatzschlüssel und Erklärung heraussuchen.",
    "2. Widerruf veröffentlichen — mit dem Zeitpunkt, ab dem du den",
    "   Diebstahl vermutest. Lieber zu früh als zu spät ansetzen.",
    "3. Deine Kontakte direkt informieren. Der Widerruf wirkt nur bei",
    "   Clients, die ihn sehen.",
    "",
    "Was der Widerruf NICHT kann: Ereignisse zurückholen, die der Dieb",
    "bereits veröffentlicht hat. Sie bleiben auf den Relays — sie werden",
    "nur als unglaubwürdig markiert.",
  ].join("\n");
}
