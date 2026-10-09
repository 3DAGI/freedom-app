/**
 * Namen von Kontakten (C-33, Nutzertest C-8, C-2, R-2, G-4): Veröffentlichte Namen
 * (Profil, Kind 0) erschienen nirgends – Liste, Raum, Umfrage und Repo zeigten den
 * gekürzten Schlüssel, und „Anfrage · …“ blieb, auch nachdem man geantwortet und
 * den Kontakt geprüft hatte. Ohne DOM, damit es sich testen lässt.
 *
 * Ein selbst gewählter Name ist eine Behauptung (`naming.ts`): Er steht mit „~“ vor
 * dem Namen – wie bei Messengern für Namen, die nicht aus dem eigenen Adressbuch
 * kommen. Ein eigener Name (Petname) gilt ohne Zeichen.
 */
import { inspectName } from "@freedomstack/protocol";
import { pkShort } from "./shell-logic.js";
import { t } from "./i18n.js";
import { kommunikation } from "./texte/kommunikation.js";

/** Was die App je Unterhaltung über den Namen weiß. */
export interface KontaktNamen {
  id: string;
  /** Eigener Name oder ein Platzhalter (gekürzter Schlüssel, „Anfrage · …“ vor C-33). */
  name: string;
  /** Noch nicht beantwortet und nicht geprüft – jemand Fremdes schrieb zuerst. */
  anfrage?: boolean;
  /** Selbst gewählter Name aus dem Profil des Kontakts (bereinigt). */
  profil?: string;
}

/** Den Namen aus einem Profil (Kind 0) lesen – Fremddaten: nur Text, kurz, ohne unsichtbare Zeichen. */
export function profilNameAus(ev: { content: string }): string | undefined {
  let p: unknown;
  try { p = JSON.parse(ev.content); } catch { return undefined; }
  if (!p || typeof p !== "object") return undefined;
  const o = p as Record<string, unknown>;
  const roh = [o.display_name, o.displayName, o.name].find((x) => typeof x === "string" && x.trim());
  if (typeof roh !== "string") return undefined;
  // Höchstens 40 Zeichen; unsichtbare Zeichen oder gemischte Schriften (Verwechslung) → kein Name
  const r = inspectName(roh.trim().slice(0, 40));
  return r.suspicious ? undefined : r.clean;
}

/** Je Schlüssel der Name aus dem neuesten Profil. */
export function neuesteProfilNamen(events: readonly { pubkey: string; created_at: number; content: string }[]): Map<string, string> {
  const neueste = new Map<string, { created_at: number; content: string }>();
  for (const ev of events) {
    const da = neueste.get(ev.pubkey);
    if (!da || ev.created_at > da.created_at) neueste.set(ev.pubkey, ev);
  }
  const namen = new Map<string, string>();
  for (const [pk, ev] of neueste) {
    const name = profilNameAus(ev);
    if (name) namen.set(pk, name);
  }
  return namen;
}

/** „Anfrage · …“ aus der Zeit vor C-33 – in beiden Sprachen, je nachdem, wann sie entstand. */
export function istAnfrageName(name: string, pk: string): boolean {
  const vorlage = kommunikation["komm.anfrage"]!;
  return [vorlage.de, vorlage.en].some((v) => name === v.replace("{pk}", pkShort(pk)));
}

/** Kein eigener Name, sondern nur ein Platzhalter für den Schlüssel. */
export function istPlatzhalterName(name: string, pk: string): boolean {
  return !name.trim() || name === pkShort(pk) || name === pk.slice(0, 12) + "…" || istAnfrageName(name, pk);
}

/** Noch eine Anfrage? Neue tragen `anfrage`, alte erkennt man am Namen. */
export function istAnfrage(c: KontaktNamen): boolean {
  return c.anfrage ?? istAnfrageName(c.name, c.id);
}

/** Der Name ohne Anfrage-Zusatz: eigener Name, sonst „~Profilname“, sonst der gekürzte Schlüssel. */
export function kontaktKurzName(c: KontaktNamen): string {
  if (!istPlatzhalterName(c.name, c.id)) return c.name;
  return c.profil ? `~${c.profil}` : pkShort(c.id);
}

/** Wie die App den Kontakt nennt – mit „Anfrage · “, solange man nicht geantwortet oder geprüft hat. */
export function kontaktAnzeige(c: KontaktNamen): string {
  const kurz = kontaktKurzName(c);
  return istAnfrage(c) ? t("komm.anfrage", { pk: kurz }) : kurz;
}

/** Der Anfangsbuchstabe für das runde Zeichen – nie das „~“ und nie „A“ von „Anfrage“. */
export function kontaktInitiale(c: KontaktNamen): string {
  // Nach Zeichen, nicht nach UTF-16-Einheiten – sonst zerfällt ein Emoji zur Hälfte
  return (Array.from(kontaktKurzName(c).replace(/^~/, ""))[0] ?? "?").toUpperCase();
}
