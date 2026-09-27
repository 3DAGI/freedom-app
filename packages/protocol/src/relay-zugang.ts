/**
 * Relay-Rolle: Anmeldung und Zugang (Schritt 8.4 mit 5.4c).
 *
 * Ein Knoten mit Relay-Rolle kann für die Zustellung Geld nehmen: Wer Zugang
 * hat, darf schreiben – und an ihn darf jeder schreiben (sein Posteingang).
 * Umschläge (Kind 1059) gibt der Relay nur an den angemeldeten Empfänger
 * heraus (NIP-42); sonst sähe jeder, der fragt, wer wann wie viel Post bekommt.
 *
 * Die Regeln stehen hier ohne Netz und ohne Uhr, damit Relay und App dieselben
 * benutzen und Tests sie ohne Server prüfen.
 */
import { NostrEvent, getTag, hasValidEventShape, verifyEvent } from "./event.js";

export const KIND_RELAY_AUTH = 22242;
/** So weit darf die Zeit einer Anmeldung von der Uhr des Relays abweichen (NIP-42: „etwa zehn Minuten“). */
export const AUTH_FENSTER_SEK = 600;
/** Nur an angemeldete Empfänger: Umschläge. */
export const GESCHUETZTE_KINDS: readonly number[] = [1059];

/** Host eines Relays (`relay.example:443` → `relay.example:443`), null bei allem außer ws/wss. */
export function relayHost(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "ws:" || u.protocol === "wss:" ? u.host.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Anmeldung prüfen (Relay): Form, Signatur, dieselbe Challenge, dieser Relay
 * (Host), Zeit im Fenster. Nur dann gilt der Schlüssel für diese Verbindung.
 */
export function pruefeRelayAuth(
  ev: unknown,
  erwartet: { challenge: string; hosts: readonly string[]; jetzt: number },
): { ok: true; pubkey: string } | { ok: false; grund: string } {
  if (!hasValidEventShape(ev) || ev.kind !== KIND_RELAY_AUTH) return { ok: false, grund: "keine Anmeldung (Kind 22242)" };
  if (!verifyEvent(ev)) return { ok: false, grund: "Signatur ungültig" };
  if (!erwartet.challenge || getTag(ev, "challenge") !== erwartet.challenge) return { ok: false, grund: "Challenge passt nicht" };
  const host = relayHost(getTag(ev, "relay") ?? "");
  if (!host || !erwartet.hosts.some((h) => h.toLowerCase() === host)) return { ok: false, grund: "Anmeldung gilt einem anderen Relay" };
  if (Math.abs(ev.created_at - erwartet.jetzt) > AUTH_FENSTER_SEK) return { ok: false, grund: "Zeit außerhalb des Fensters" };
  return { ok: true, pubkey: ev.pubkey };
}

export interface ZugangsRegel {
  /** Nimmt der Relay nur von und an Schlüssel mit Zugang an? */
  beschraenkt: boolean;
  hatZugang: (pubkey: string) => boolean;
}

/**
 * Darf der Relay dieses (gültig signierte) Event annehmen? Beschränkt: vom
 * Autor mit Zugang, oder an jemanden mit Zugang (ein `p`-Tag) – so erreicht
 * ein Umschlag von einem Wegwerf-Schlüssel den Posteingang, für den der
 * Empfänger bezahlt hat.
 */
export function relayNimmtAn(ev: NostrEvent, r: ZugangsRegel): { ok: true } | { ok: false; grund: string } {
  if (ev.kind === KIND_RELAY_AUTH) return { ok: false, grund: "invalid: Anmeldungen gehen über AUTH, nicht als Event" };
  if (!r.beschraenkt || r.hatZugang(ev.pubkey)) return { ok: true };
  if (ev.tags.some((t) => t[0] === "p" && typeof t[1] === "string" && r.hatZugang(t[1]))) return { ok: true };
  return { ok: false, grund: "restricted: nur mit Zugang zu diesem Relay – oder an jemanden, der ihn hat" };
}

/** Darf der Relay dieses Event an eine Verbindung mit diesen angemeldeten Schlüsseln geben? */
export function darfAusliefern(ev: NostrEvent, angemeldet: ReadonlySet<string>, schuetzen: boolean): boolean {
  if (!schuetzen || !GESCHUETZTE_KINDS.includes(ev.kind)) return true;
  return ev.tags.some((t) => t[0] === "p" && angemeldet.has(t[1]));
}

/**
 * Fragt ein Filter nach Umschlägen, die diese Verbindung nicht lesen darf?
 * Dann antwortet der Relay mit `CLOSED auth-required:` – der Client meldet
 * sich an und fragt erneut. Ohne `#p` (alle Umschläge) nie.
 */
export function brauchtAnmeldung(filter: Record<string, unknown>, angemeldet: ReadonlySet<string>, schuetzen: boolean): boolean {
  if (!schuetzen) return false;
  const kinds = filter.kinds;
  if (!Array.isArray(kinds) || !kinds.some((k) => GESCHUETZTE_KINDS.includes(k as number))) return false;
  const p = filter["#p"];
  return !Array.isArray(p) || p.length === 0 || p.some((x) => !angemeldet.has(String(x)));
}

// ------------------------------------------------------------ Aufbewahrung (NIP-01, NIP-40)

/** Unix-Sekunden aus dem `expiration`-Tag (NIP-40), sonst null. */
export function ablaufVon(ev: NostrEvent): number | null {
  const t = getTag(ev, "expiration");
  if (t === undefined || !/^\d{1,12}$/.test(t)) return null;
  return Number(t);
}

/** Flüchtig (NIP-01, 20000–29999): weiterreichen, nie speichern. */
export const istFluechtig = (kind: number): boolean => kind >= 20000 && kind < 30000;

/**
 * Schlüssel, unter dem nur die neueste Fassung gilt (NIP-01): ersetzbar
 * (0, 3, 10000–19999) je Autor und Art, adressierbar (30000–39999) zusätzlich
 * je `d`. Sonst null.
 */
export function ersetzSchluessel(ev: NostrEvent): string | null {
  const k = ev.kind;
  if (k === 0 || k === 3 || (k >= 10000 && k < 20000)) return `${k}:${ev.pubkey}`;
  if (k >= 30000 && k < 40000) return `${k}:${ev.pubkey}:${getTag(ev, "d") ?? ""}`;
  return null;
}

/** Ist `neu` neuer als `alt` (NIP-01: bei gleicher Zeit gewinnt die kleinere Id)? */
export const istNeuer = (neu: NostrEvent, alt: NostrEvent): boolean =>
  neu.created_at > alt.created_at || (neu.created_at === alt.created_at && neu.id < alt.id);

// ------------------------------------------------------------ NIP-11

export interface RelayInfoEingabe {
  name: string;
  beschreibung: string;
  /** Schlüssel des Betreibers – über sein Profil die Zahladresse (4.0: 1,5 % je Auftrag). */
  pubkey: string;
  maxNachricht: number;
  aufbewahrungTage: number;
  beschraenkt: boolean;
  umschlaegeGeschuetzt: boolean;
}

/** Selbstauskunft nach NIP-11 – was der Relay kann und verlangt. */
export function baueRelayInfo(e: RelayInfoEingabe): Record<string, unknown> {
  return {
    name: e.name,
    description: e.beschreibung,
    pubkey: e.pubkey,
    software: "https://github.com/3DAGI/freedom-app",
    supported_nips: [1, 11, 40, 42],
    limitation: {
      max_message_length: e.maxNachricht,
      auth_required: false,
      payment_required: e.beschraenkt,
      restricted_writes: e.beschraenkt,
    },
    retention: [{ time: e.aufbewahrungTage * 86400 }],
    freedom: { umschlaege_nur_an_angemeldete: e.umschlaegeGeschuetzt },
  };
}
