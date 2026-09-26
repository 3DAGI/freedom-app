/**
 * Modellkataloge als NIP-51-Listen (Schritt 5.7 mit 8.8).
 *
 * Ein Katalog ist die Liste eines Kurators: „diese Modelle empfehle ich“,
 * wahlweise mit einer kurzen Notiz je Modell. Er ist ein NIP-51-Set – ein
 * ersetzbares Event mit `d`, `title`, `description` und je Eintrag einem Tag
 * – mit eigenem Kind, damit ihn nur liest, wer Kataloge sucht.
 *
 * Wer einen Katalog abonniert, entscheidet der Nutzer; das Projekt gibt keinen
 * vor und bevorzugt keinen. Jeder kann Kurator sein. Verglichen werden die
 * abonnierten Kataloge mit dem, was Provider gerade anbieten (Anzahl und
 * günstigster Preis je 1.000 Tokens – in der App in sats und SOL).
 *
 * Der Katalog sagt nicht, ob ein Modell gut, sicher oder legal ist – nur, wer
 * es empfiehlt. Ob die Gewichte echt sind, prüft der Modell-Katalog der
 * Manifeste (`model-registry.ts`).
 */
import { NostrEvent, UnsignedEvent, buildEvent, getTag } from "./event.js";
import type { ProviderCapabilities } from "./tiers.js";

/** Modellkatalog eines Kurators (NIP-51-Set, ersetzbar über `d`). */
export const KIND_MODELL_KATALOG = 38080;
export const KATALOG_MAX_MODELLE = 200;
const TITEL_MAX = 80;
const BESCHREIBUNG_MAX = 280;
const NOTIZ_MAX = 140;

/** Modell-Kennung wie bei Ollama oder im Manifest, z. B. `qwen3.5:9b-q4_K_M`. */
const MODELL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,99}$/;
const D_WERT = /^[A-Za-z0-9._-]{1,64}$/;
const PUBKEY = /^[0-9a-f]{64}$/;

export interface KatalogEintrag {
  modell: string;
  notiz?: string;
}

export interface ModellKatalog {
  /** `38080:<kurator>:<d>` – so wird ein Katalog abonniert. */
  adresse: string;
  kurator: string;
  d: string;
  titel: string;
  beschreibung?: string;
  modelle: KatalogEintrag[];
  createdAt: number;
}

export function katalogAdresse(kurator: string, d: string): string {
  return `${KIND_MODELL_KATALOG}:${kurator}:${d}`;
}

/** Adresse lesen – `null`, wenn sie kein Modellkatalog ist. */
export function leseKatalogAdresse(adresse: string): { kurator: string; d: string } | null {
  const m = /^(\d+):([0-9a-f]{64}):(.+)$/.exec(adresse);
  if (!m || Number(m[1]) !== KIND_MODELL_KATALOG || !D_WERT.test(m[3]!)) return null;
  return { kurator: m[2]!, d: m[3]! };
}

/** Zeichen, die in einer Anzeige nichts verloren haben (Steuerzeichen, Richtungswechsel). */
const unsichtbar = /[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g;
const text = (s: string, max: number) => s.replace(unsichtbar, " ").trim().slice(0, max);
const schluessel = (modell: string) => modell.toLowerCase();

/** Einen Katalog bauen. Wirft, statt Unbrauchbares still zu veröffentlichen. */
export function baueModellKatalog(
  k: { kurator: string; d: string; titel: string; beschreibung?: string; modelle: KatalogEintrag[] },
  createdAt?: number,
): UnsignedEvent {
  if (!PUBKEY.test(k.kurator)) throw new Error("Kurator: kein Pubkey");
  if (!D_WERT.test(k.d)) throw new Error("Kennung: 1–64 Zeichen aus Buchstaben, Ziffern, . _ -");
  const titel = text(k.titel, TITEL_MAX + 1);
  if (titel.length === 0 || titel.length > TITEL_MAX) throw new Error(`Titel: 1–${TITEL_MAX} Zeichen`);
  const beschreibung = k.beschreibung === undefined ? "" : text(k.beschreibung, BESCHREIBUNG_MAX + 1);
  if (beschreibung.length > BESCHREIBUNG_MAX) throw new Error(`Beschreibung: höchstens ${BESCHREIBUNG_MAX} Zeichen`);
  if (k.modelle.length > KATALOG_MAX_MODELLE) throw new Error(`Höchstens ${KATALOG_MAX_MODELLE} Modelle je Katalog`);
  const gesehen = new Set<string>();
  const tags: string[][] = [["d", k.d], ["title", titel]];
  if (beschreibung) tags.push(["description", beschreibung]);
  for (const e of k.modelle) {
    if (!MODELL_ID.test(e.modell)) throw new Error(`Keine Modell-Kennung: ${e.modell.slice(0, 40)}`);
    if (gesehen.has(schluessel(e.modell))) throw new Error(`Doppelt: ${e.modell}`);
    gesehen.add(schluessel(e.modell));
    const notiz = e.notiz === undefined ? "" : text(e.notiz, NOTIZ_MAX + 1);
    if (notiz.length > NOTIZ_MAX) throw new Error(`Notiz zu ${e.modell}: höchstens ${NOTIZ_MAX} Zeichen`);
    tags.push(notiz ? ["model", e.modell, notiz] : ["model", e.modell]);
  }
  return buildEvent(k.kurator, KIND_MODELL_KATALOG, tags, "", createdAt);
}

/**
 * Einen fremden Katalog lesen – streng: unbrauchbare Einträge fallen weg,
 * Texte werden gekürzt, höchstens `KATALOG_MAX_MODELLE`. Die Signatur prüft
 * der Aufrufer (`verifyEvent`); ein leerer Katalog ist erlaubt (der Kurator
 * hat ihn geleert).
 */
export function leseModellKatalog(ev: NostrEvent): ModellKatalog {
  if (ev.kind !== KIND_MODELL_KATALOG) throw new Error(`kein Modellkatalog: kind ${ev.kind}`);
  if (!PUBKEY.test(ev.pubkey)) throw new Error("Kurator: kein Pubkey");
  const d = getTag(ev, "d");
  if (d === undefined || !D_WERT.test(d)) throw new Error("Katalog ohne gültige Kennung");
  const gesehen = new Set<string>();
  const modelle: KatalogEintrag[] = [];
  for (const t of ev.tags) {
    if (modelle.length >= KATALOG_MAX_MODELLE) break;
    if (t[0] !== "model" || typeof t[1] !== "string" || !MODELL_ID.test(t[1])) continue;
    if (gesehen.has(schluessel(t[1]))) continue;
    gesehen.add(schluessel(t[1]));
    const notiz = typeof t[2] === "string" ? text(t[2], NOTIZ_MAX) : "";
    modelle.push(notiz ? { modell: t[1], notiz } : { modell: t[1] });
  }
  const titel = text(getTag(ev, "title") ?? "", TITEL_MAX) || d;
  const beschreibung = text(getTag(ev, "description") ?? "", BESCHREIBUNG_MAX);
  return {
    adresse: katalogAdresse(ev.pubkey, d),
    kurator: ev.pubkey,
    d,
    titel,
    ...(beschreibung ? { beschreibung } : {}),
    modelle,
    createdAt: ev.created_at,
  };
}

/** Je Adresse der neueste Katalog (bei Gleichstand die kleinere Event-ID, wie NIP-01). */
export function neuesteKataloge(events: readonly NostrEvent[]): Map<string, ModellKatalog> {
  const beste = new Map<string, { ev: NostrEvent; k: ModellKatalog }>();
  for (const ev of events) {
    let k: ModellKatalog;
    try {
      k = leseModellKatalog(ev);
    } catch {
      continue;
    }
    const bisher = beste.get(k.adresse);
    if (!bisher || ev.created_at > bisher.ev.created_at || (ev.created_at === bisher.ev.created_at && ev.id < bisher.ev.id)) {
      beste.set(k.adresse, { ev, k });
    }
  }
  return new Map([...beste].map(([a, { k }]) => [a, k]));
}

/** Was Provider zu einem Modell anbieten: wie viele, und der günstigste Preis je 1.000 Tokens. */
export interface ModellAngebot {
  provider: number;
  preisMsat?: number;
}

/** Angebote je Modell (Kleinschreibung als Schlüssel) aus den Fähigkeiten der Provider. */
export function modellAngebote(caps: readonly Pick<ProviderCapabilities, "pubkey" | "models" | "textRatePerKTokenMsat">[]): Map<string, ModellAngebot> {
  const out = new Map<string, { provider: Set<string>; preisMsat?: number }>();
  for (const c of caps) {
    const preis = Number.isSafeInteger(c.textRatePerKTokenMsat) && c.textRatePerKTokenMsat >= 0 ? c.textRatePerKTokenMsat : undefined;
    for (const m of new Set((c.models ?? []).map(schluessel))) {
      const a = out.get(m) ?? { provider: new Set<string>() };
      a.provider.add(c.pubkey);
      if (preis !== undefined && (a.preisMsat === undefined || preis < a.preisMsat)) a.preisMsat = preis;
      out.set(m, a);
    }
  }
  return new Map([...out].map(([m, a]) => [m, { provider: a.provider.size, ...(a.preisMsat !== undefined ? { preisMsat: a.preisMsat } : {}) }]));
}

export interface VergleichsZeile {
  modell: string;
  /** Je abonniertem Katalog (gleiche Reihenfolge): steht das Modell darin? */
  in: boolean[];
  /** Notizen der Kuratoren, je Katalog. */
  notizen: Array<string | undefined>;
  provider: number;
  preisMsat?: number;
}

/**
 * Kataloge nebeneinander: jedes Modell aus einem der Kataloge, in wie vielen
 * es steht, wie viele Provider es anbieten und zu welchem Preis. Sortiert nach
 * Zahl der Kataloge, dann Providern – nie nach einer Vorliebe des Projekts.
 */
export function vergleicheKataloge(
  kataloge: readonly ModellKatalog[],
  angebote: ReadonlyMap<string, ModellAngebot>,
): { zeilen: VergleichsZeile[]; gemeinsam: string[]; nurIn: string[][] } {
  const zeilen = new Map<string, VergleichsZeile>();
  kataloge.forEach((k, i) => {
    for (const e of k.modelle) {
      const key = schluessel(e.modell);
      const z = zeilen.get(key) ?? {
        modell: e.modell,
        in: kataloge.map(() => false),
        notizen: kataloge.map(() => undefined),
        provider: angebote.get(key)?.provider ?? 0,
        ...(angebote.get(key)?.preisMsat !== undefined ? { preisMsat: angebote.get(key)!.preisMsat } : {}),
      };
      z.in[i] = true;
      z.notizen[i] = e.notiz;
      zeilen.set(key, z);
    }
  });
  const anzahl = (z: VergleichsZeile) => z.in.filter(Boolean).length;
  const sortiert = [...zeilen.values()].sort((a, b) => anzahl(b) - anzahl(a) || b.provider - a.provider || a.modell.localeCompare(b.modell));
  return {
    zeilen: sortiert,
    gemeinsam: kataloge.length >= 2 ? sortiert.filter((z) => z.in.every(Boolean)).map((z) => z.modell) : [],
    nurIn: kataloge.map((_, i) => sortiert.filter((z) => z.in[i] && anzahl(z) === 1).map((z) => z.modell)),
  };
}
