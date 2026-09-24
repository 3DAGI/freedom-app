/**
 * Profil (NIP-01 kind 0) mit Zahlungsadressen.
 *
 * Clawstr-Muster: Jeder Teilnehmer - Mensch ODER KI-Agent - traegt eine
 * Lightning-Adresse im `lud16`-Feld und ist damit sofort zap-empfangsbereit.
 * Zusaetzlich (Whitepaper 4.1) mehrere Chain-Auszahladressen, wodurch die
 * Identitaet chain-agnostisch bleibt: Kommunikation braucht keine Chain,
 * nur das Settlement waehlt eine.
 */
import { UnsignedEvent, buildEvent } from "./event.js";
import { KIND_PROFILE } from "./kinds.js";

export interface ProfileMetadata {
  name?: string;
  about?: string;
  picture?: string;
  /** Lightning-Adresse, z. B. "npub1abc@npub.cash" (Clawstr-Muster). */
  lud16?: string;
  /** Ist dieser Teilnehmer ein autonomer Agent? (fuer Anzeige/Filter) */
  agent?: boolean;
  /** Chain-Auszahladressen, chain-agnostische Identitaet. */
  chains?: {
    solana?: string;
    polygon?: string;
    ton?: string;
  };
  banner?: string;
  website?: string;
  /**
   * Aussehen des Profils.
   *
   * Eigenes Feld mit Praefix, damit andere Nostr-Clients es ignorieren statt
   * darueber zu stolpern.
   */
  freedom_style?: ProfileStyle;
}

export function buildProfile(
  pubkey: string,
  meta: ProfileMetadata,
  createdAt?: number,
): UnsignedEvent {
  const tags: string[][] = [];
  // Chain-Adressen zusaetzlich als Tags, damit Relays/Clients sie
  // ohne JSON-Parsing filtern koennen.
  if (meta.chains?.solana) tags.push(["chain", "solana", meta.chains.solana]);
  if (meta.chains?.polygon) tags.push(["chain", "polygon", meta.chains.polygon]);
  if (meta.chains?.ton) tags.push(["chain", "ton", meta.chains.ton]);
  if (meta.lud16) tags.push(["lud16", meta.lud16]);
  return buildEvent(pubkey, KIND_PROFILE, tags, JSON.stringify(meta), createdAt);
}

export function parseProfile(ev: UnsignedEvent): ProfileMetadata {
  if (ev.kind !== KIND_PROFILE) throw new Error(`kein Profil-Kind: ${ev.kind}`);
  try {
    return JSON.parse(ev.content) as ProfileMetadata;
  } catch {
    throw new Error("Profil-Content ist kein gueltiges JSON");
  }
}

/**
 * Profil einlesen und dabei saeubern.
 *
 * Anders als `parseProfile` wirft das hier nicht: Ein kaputtes oder
 * boesartiges fremdes Profil ist kein Fehler des Betrachters. Es wird leer
 * angezeigt statt als Absturz.
 */
export function parseProfileSafe(ev: UnsignedEvent): SafeProfile {
  let roh: ProfileMetadata = {};
  try {
    roh = parseProfile(ev);
  } catch { /* leer anzeigen */ }

  const text = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;

  const bild = text(roh.picture);
  const banner = text(roh.banner);
  return {
    pubkey: ev.pubkey,
    name: text(roh.name),
    about: inspectAbout(text(roh.about)).clean || undefined,
    // Ein abgelehntes Bild wird weggelassen, nicht durchgereicht.
    picture: inspectPicture(bild).ok ? bild : undefined,
    banner: inspectPicture(banner).ok ? banner : undefined,
    lud16: text(roh.lud16),
    website: text(roh.website),
    agent: roh.agent === true,
    style: normalizeStyle(roh.freedom_style),
    updatedAt: ev.created_at ?? 0,
  };
}

export interface SafeProfile {
  pubkey: string;
  name?: string;
  about?: string;
  picture?: string;
  banner?: string;
  lud16?: string;
  website?: string;
  agent: boolean;
  style: ProfileStyle;
  updatedAt: number;
}

// ------------------------------------------------------------- Aussehen

/**
 * Aussehen — eine feste Auswahl, kein freies Feld.
 *
 * Liesse man freies CSS oder freie Farbwerte zu, waere das eine
 * Einschleusungsstelle mit Ansage: Ein fremdes Profil bestimmt, was im
 * Browser des Betrachters gerendert wird. Jeder Wert wird beim Einlesen gegen
 * die erlaubte Liste gehalten; was nicht darin steht, faellt auf die
 * Voreinstellung zurueck.
 */
export interface ProfileStyle {
  accent: AccentName;
  layout: LayoutName;
  pattern: PatternName;
}

export const ACCENTS = ["messing", "orange", "tinte", "moos", "pflaume", "stahl"] as const;
export const LAYOUTS = ["schlicht", "karte", "breit"] as const;
export const PATTERNS = ["keines", "raster", "wellen", "verlauf"] as const;

export type AccentName = (typeof ACCENTS)[number];
export type LayoutName = (typeof LAYOUTS)[number];
export type PatternName = (typeof PATTERNS)[number];

/** Farbwerte zu den Namen. Der Client rechnet nie mit fremden Farbangaben. */
export const ACCENT_HEX: Record<AccentName, string> = {
  messing: "#C9A227",
  orange: "#FF6B2C",
  tinte: "#2E5C8A",
  moos: "#5F8A54",
  pflaume: "#8A5A7A",
  stahl: "#7A8894",
};

export const DEFAULT_STYLE: ProfileStyle = {
  accent: "messing", layout: "schlicht", pattern: "keines",
};

function einerVon<T extends string>(wert: unknown, erlaubt: readonly T[], fallback: T): T {
  return typeof wert === "string" && (erlaubt as readonly string[]).includes(wert)
    ? (wert as T) : fallback;
}

export function normalizeStyle(raw: unknown): ProfileStyle {
  const s = (raw ?? {}) as Record<string, unknown>;
  return {
    accent: einerVon(s.accent, ACCENTS, DEFAULT_STYLE.accent),
    layout: einerVon(s.layout, LAYOUTS, DEFAULT_STYLE.layout),
    pattern: einerVon(s.pattern, PATTERNS, DEFAULT_STYLE.pattern),
  };
}

// ------------------------------------------------------------- Pruefungen

/**
 * Prueft eine Bild-Adresse.
 *
 * `freedom-blob:` ist der gute Fall — das Bild liegt im eigenen Netz, und der
 * Abruf verraet nichts an Dritte. Eine fremde https-URL wird zugelassen, aber
 * als das gekennzeichnet, was sie ist: Wer sie dort ablegt, sieht die
 * IP-Adresse aller, die das Profil ansehen. Fuer ein Projekt, dessen Nutzer
 * teils in Laendern sitzen, wo das zaehlt, ist das kein Schoenheitsfehler.
 */
export function inspectPicture(url: string | undefined): {
  ok: boolean;
  kind: "blob" | "extern" | "keines" | "abgelehnt";
  warning?: string;
} {
  if (!url) return { ok: true, kind: "keines" };

  // Steuerzeichen raus, sonst rutscht "java\nscript:" durch.
  const clean = url.replace(/[\u0000-\u0020]/g, "");
  if (clean.startsWith("freedom-blob:")) return { ok: true, kind: "blob" };
  if (/^data:image\/(png|jpeg|jpg|gif|webp);/i.test(clean)) return { ok: true, kind: "blob" };

  if (/^https:\/\//i.test(clean)) {
    return {
      ok: true,
      kind: "extern",
      warning:
        "Das Bild liegt auf einem fremden Server. Wer es dort ablegt, sieht die " +
        "IP-Adresse aller, die dein Profil ansehen.",
    };
  }
  return {
    ok: false,
    kind: "abgelehnt",
    warning: "Nur Bilder aus dem Netz oder https-Adressen — alles andere wird nicht geladen.",
  };
}

/** Kuerzt und saeubert eine Beschreibung. */
export function inspectAbout(text: string | undefined): { clean: string; truncated: boolean } {
  if (!text) return { clean: "", truncated: false };
  // Unsichtbare Zeichen raus — derselbe Trick wie bei Namen, hier zum
  // Verstecken von Text in der Anzeige.
  const ohne = text.replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, "").trim();
  const max = 500;
  return { clean: ohne.slice(0, max), truncated: ohne.length > max };
}

/**
 * Was ein Profil ueber seinen Inhaber preisgibt.
 *
 * Bewusst eine eigene Funktion: Der Nutzer soll VOR dem Speichern sehen, was
 * er offenlegt, statt es danach herauszufinden.
 */
export function profileDisclosure(p: Partial<ProfileMetadata>): string[] {
  const zeilen: string[] = [];
  if (p.name) zeilen.push("Dein Name ist öffentlich und mit deinem Schlüssel verknüpft.");
  if (p.about) zeilen.push("Deine Beschreibung ist öffentlich und bleibt auf den Relays.");

  const bild = inspectPicture(p.picture);
  if (bild.kind === "extern") zeilen.push(bild.warning!);
  if (bild.kind === "blob") zeilen.push("Das Bild liegt im eigenen Netz — der Abruf verrät nichts an Dritte.");

  if (p.lud16) zeilen.push("Deine Lightning-Adresse ist öffentlich. Wer sie kennt, kann dir zahlen.");
  if (p.website) zeilen.push("Die Webseite verknüpft dein Profil mit einer anderen Identität.");
  if (p.chains?.solana) zeilen.push("Deine Solana-Adresse ist öffentlich — mitsamt ihrer gesamten Historie.");

  if (zeilen.length === 0) {
    zeilen.push("Ein leeres Profil gibt nichts preis. Das ist eine gültige Wahl.");
  }
  return zeilen;
}

/** Auszahladresse fuer eine Chain aus dem Profil holen. */
export function payoutAddress(p: ProfileMetadata, chain: "lightning" | "solana" | "polygon" | "ton"): string | undefined {
  if (chain === "lightning") return p.lud16;
  return p.chains?.[chain];
}
