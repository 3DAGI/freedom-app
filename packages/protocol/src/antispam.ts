/**
 * Spam- und Flutschutz.
 *
 * DAS PROBLEM
 * Publizieren kostet nichts. Jeder kann beliebig viele Ereignisse schreiben
 * und jedem eine Direktnachricht schicken. Das ist nicht hypothetisch — es ist
 * das Problem, an dem offene Nostr-Clients heute leiden, und die erste Sache,
 * die jemand ausprobiert, der dem Netz schaden will.
 *
 * Für den Provider kommt ein zweites dazu: Ein Knoten, der jede Anfrage
 * annimmt, lässt sich mit sinnlosen beschäftigen, bis er für zahlende Kunden
 * nicht mehr erreichbar ist. Das kostet den Angreifer nichts und den Provider
 * seine Einnahmen.
 *
 * DREI MITTEL, DIE ZUSAMMENWIRKEN
 *
 * 1. **Rechennachweis** — macht Massenversand teuer, Einzelnachrichten nicht.
 * 2. **Vertrauensfilter** — trennt Bekannte von Fremden, statt Fremde zu
 *    sperren.
 * 3. **Deckel je Absender** — begrenzt, was ein Einzelner auslösen kann.
 *
 * WAS BEWUSST NICHT PASSIERT
 * Keine Sperrliste, keine Filterregeln auf Inhalte, keine zentrale
 * Bewertung. Alle drei Mittel wirken beim Empfänger und lassen sich
 * abschalten — ein Spamfilter, den man nicht umgehen kann, ist eine Zensur
 * mit anderem Namen.
 */
import { NostrEvent, UnsignedEvent } from "./event.js";
import { sha256 } from "@noble/hashes/sha2.js";

// ------------------------------------------------------- Rechennachweis

/**
 * Führende Nullbits einer Ereignis-Kennung.
 *
 * NIP-13: Die Kennung ist ein Hash über das Ereignis. Wer viele führende
 * Nullen will, muss viele Varianten durchprobieren — die einzige Währung, die
 * jeder hat und die sich nicht fälschen lässt.
 */
export function difficulty(eventId: string): number {
  let bits = 0;
  for (const zeichen of eventId) {
    const wert = parseInt(zeichen, 16);
    if (Number.isNaN(wert)) break;
    if (wert === 0) {
      bits += 4;
      continue;
    }
    bits += Math.clz32(wert) - 28;
    break;
  }
  return bits;
}

export interface PowRequirement {
  /** Verlangte Bits. */
  bits: number;
  /** Ungefährer Aufwand in Sekunden auf einem normalen Gerät. */
  approxSeconds: number;
  reason: string;
}

/**
 * Wie viel Rechennachweis ist nötig?
 *
 * Die Staffelung ist der eigentliche Entwurf: Für Bekannte gar keiner, für
 * Fremde spürbar, für Massenversand unbezahlbar. Ein fester Wert für alle
 * wäre entweder wirkungslos oder eine Hürde für normale Nutzer.
 */
export function powRequired(opts: {
  /** Steht der Absender im Vertrauensgraphen? */
  known: boolean;
  /** Wie viele Nachrichten dieser Absender zuletzt geschickt hat. */
  recentFromSender?: number;
}): PowRequirement {
  if (opts.known) {
    return { bits: 0, approxSeconds: 0, reason: "Bekannter Absender — kein Nachweis nötig." };
  }

  const zuletzt = opts.recentFromSender ?? 0;
  if (zuletzt === 0) {
    // Etwa eine Sekunde: für einen Menschen unmerklich, für zehntausend
    // Nachrichten drei Stunden.
    return { bits: 20, approxSeconds: 1, reason: "Erste Nachricht von einem Fremden." };
  }
  if (zuletzt < 5) {
    return { bits: 22, approxSeconds: 4, reason: "Mehrere Nachrichten von einem Fremden." };
  }
  // Wächst schnell: Der elfte Versuch kostet Minuten.
  const bits = Math.min(30, 22 + zuletzt);
  return {
    bits,
    approxSeconds: Math.pow(2, bits - 20),
    reason: `${zuletzt} Nachrichten von diesem Fremden — der nächste Versuch kostet spürbar.`,
  };
}

export interface PowCheck {
  ok: boolean;
  actual: number;
  required: number;
  message: string;
}

export function checkPow(ev: NostrEvent, req: PowRequirement): PowCheck {
  const ist = difficulty(ev.id);
  if (ist >= req.bits) {
    return { ok: true, actual: ist, required: req.bits, message: "Nachweis erbracht." };
  }
  return {
    ok: false, actual: ist, required: req.bits,
    message:
      `Rechennachweis fehlt (${ist} statt ${req.bits} Bit). ${req.reason} ` +
      `Die Nachricht landet im zweiten Posteingang, nicht im Papierkorb.`,
  };
}

/**
 * Nachweis erarbeiten.
 *
 * Läuft im Aufrufer-Kontext, deshalb mit Abbruchbedingung: Ein Nachweis, der
 * die Oberfläche minutenlang einfriert, ist schlimmer als keiner.
 */
export function mineNonce(
  base: UnsignedEvent,
  bits: number,
  computeId: (ev: UnsignedEvent) => string,
  maxAttempts = 5_000_000,
): { event: UnsignedEvent; attempts: number; achieved: number } | null {
  const ohneNonce = base.tags.filter((t) => t[0] !== "nonce");
  for (let n = 0; n < maxAttempts; n++) {
    const kandidat: UnsignedEvent = {
      ...base,
      tags: [...ohneNonce, ["nonce", String(n), String(bits)]],
    };
    const id = computeId(kandidat);
    if (difficulty(id) >= bits) {
      return { event: kandidat, attempts: n + 1, achieved: difficulty(id) };
    }
  }
  return null;
}

// ------------------------------------------------------- Posteingänge

export type Inbox = "haupt" | "zweit" | "verworfen";

export interface SortResult {
  inbox: Inbox;
  reason: string;
}

export interface SortOptions {
  /** Wem der Empfänger vertraut. */
  trusted: Set<string>;
  /** Zählstand je Absender. */
  recentBySender?: Map<string, number>;
  /** Prüfung ganz abschalten — der Nutzer entscheidet. */
  disabled?: boolean;
}

/**
 * Wohin eine Nachricht von einem Fremden gehört.
 *
 * **Nicht in den Papierkorb.** Der zweite Posteingang ist der wesentliche
 * Unterschied zu einem Spamfilter: Nichts geht verloren, der Empfänger sieht
 * es nur nicht sofort. Für jemanden, der Hinweise von Unbekannten bekommt —
 * und das ist ein Teil eurer Zielgruppe —, wäre ein löschender Filter das
 * Gegenteil von hilfreich.
 */
export function sortIncoming(ev: NostrEvent, opts: SortOptions): SortResult {
  if (opts.disabled) {
    return { inbox: "haupt", reason: "Filter abgeschaltet." };
  }
  if (opts.trusted.has(ev.pubkey)) {
    return { inbox: "haupt", reason: "Bekannter Absender." };
  }

  const zuletzt = opts.recentBySender?.get(ev.pubkey) ?? 0;
  const req = powRequired({ known: false, recentFromSender: zuletzt });
  const pow = checkPow(ev, req);

  if (pow.ok) {
    return {
      inbox: "zweit",
      reason: `Unbekannt, aber mit Rechennachweis (${pow.actual} Bit).`,
    };
  }
  return {
    inbox: "zweit",
    reason: `Unbekannt und ohne ausreichenden Nachweis (${pow.actual} von ${req.bits} Bit).`,
  };
}

// --------------------------------------------------------- Ratenbegrenzung

export interface RateLimitConfig {
  /** Anfragen je Fenster. */
  maxPerWindow: number;
  windowSecs: number;
  /** Bezahlte Anfragen zählen anders — wer zahlt, ist kein Angreifer. */
  paidMultiplier?: number;
}

export interface RateDecision {
  allowed: boolean;
  remaining: number;
  resetIn: number;
  message: string;
}

/**
 * Gleitendes Fenster je Absender.
 *
 * Bewusst pro Pubkey und nicht pro IP: Ein Angreifer wechselt IPs leichter als
 * Identitäten, und eine IP-Sperre trifft auch alle, die hinter demselben
 * Anschluss sitzen — in manchen Ländern ein ganzes Mobilfunknetz.
 */
export class RateLimiter {
  private fenster = new Map<string, number[]>();

  constructor(private cfg: RateLimitConfig) {}

  check(pubkey: string, paid = false, nowSecs = Math.floor(Date.now() / 1000)): RateDecision {
    const grenze = paid
      ? this.cfg.maxPerWindow * (this.cfg.paidMultiplier ?? 10)
      : this.cfg.maxPerWindow;

    const bisher = (this.fenster.get(pubkey) ?? []).filter(
      (t) => nowSecs - t < this.cfg.windowSecs,
    );

    if (bisher.length >= grenze) {
      const aeltestes = Math.min(...bisher);
      const resetIn = this.cfg.windowSecs - (nowSecs - aeltestes);
      this.fenster.set(pubkey, bisher);
      return {
        allowed: false, remaining: 0, resetIn,
        message: paid
          ? `Auch bezahlte Anfragen sind begrenzt. Wieder frei in ${resetIn}s.`
          : `${grenze} Gratis-Anfragen je ${this.cfg.windowSecs}s erreicht. ` +
            `Wieder frei in ${resetIn}s — bezahlte Anfragen gehen weiter.`,
      };
    }

    bisher.push(nowSecs);
    this.fenster.set(pubkey, bisher);
    return {
      allowed: true,
      remaining: grenze - bisher.length,
      resetIn: 0,
      message: `${grenze - bisher.length} von ${grenze} übrig.`,
    };
  }

  /** Alte Einträge entfernen. Ohne das wächst die Karte unbegrenzt. */
  prune(nowSecs = Math.floor(Date.now() / 1000)): number {
    let entfernt = 0;
    for (const [pk, zeiten] of this.fenster) {
      const frisch = zeiten.filter((t) => nowSecs - t < this.cfg.windowSecs);
      if (frisch.length === 0) {
        this.fenster.delete(pk);
        entfernt++;
      } else if (frisch.length !== zeiten.length) {
        this.fenster.set(pk, frisch);
      }
    }
    return entfernt;
  }

  get trackedSenders(): number {
    return this.fenster.size;
  }
}

/** Was der Nutzer über den Filter wissen soll. */
export function spamFilterInfo(zweitEingang: number): string {
  return [
    `${zweitEingang} Nachricht(en) von Unbekannten liegen im zweiten Posteingang.`,
    "",
    "Sie werden nicht gelöscht und nicht gemeldet — sie liegen nur nicht",
    "im Hauptposteingang. Sobald du jemandem antwortest, gilt er als bekannt.",
    "",
    "Der Filter ist abschaltbar. Dann siehst du alles sofort.",
  ].join("\n");
}

/** Hilfsfunktion: Hash über beliebige Bytes, für Tests und Nonce-Suche. */
export function hashHex(data: Uint8Array): string {
  return Array.from(sha256(data)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
