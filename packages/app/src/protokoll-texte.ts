/**
 * Sätze des Protokolls in der Sprache der Oberfläche (8.16f) – ohne DOM.
 *
 * Einige Bausteine des Protokolls liefern fertige deutsche Sätze (`healthNote`,
 * `busFactor().note`, `LAYER_LABEL`, `coverageAt().message`,
 * `coverageConsentText()`, `profileDisclosure()`, `inspectPicture().warning`,
 * `badgeSourceLabel()`, Titel und Stand der Aufgaben, seit 8.16g1
 * `wipeConfirmation()`). Die App bildet sie aus den Feldern neu; die deutsche
 * Fassung ist wortgleich mit der des Protokolls (`app/test/i18n.test.ts` prüft
 * das), damit jeder Client dieselbe Warnung zeigt.
 */
import {
  COVERAGE_GUELTIG_SECS, K_ANONYMITY, inspectPicture,
  type BadgeSource, type Contributor, type CoverageLayer, type LocalCoverage, type ProfileMetadata, type QuestId, type QuestProgress, type RepoOverview,
} from "@freedomstack/protocol";
import { t } from "./i18n.js";

const TAG = 86400;

/** „Lebt das noch?“ – wie `buildRepoOverview()` bewertet. */
export function repoZustand(o: Pick<RepoOverview, "health" | "contributors">, jetzt = Math.floor(Date.now() / 1000)): string {
  if (o.health === "unbekannt" || o.contributors.length === 0) return t("earn.repoUnbekannt");
  const tage = Math.floor((jetzt - Math.max(...o.contributors.map((c) => c.lastSeen))) / TAG);
  if (o.health === "aktiv") return t("earn.repoAktiv", { n: tage });
  if (o.health === "ruhig") return t("earn.repoRuhig", { n: tage });
  return t("earn.repoVerwaist", { n: Math.floor(tage / 30) });
}

/** Wie verteilt ist die Arbeit? – aus `busFactor().count` und der Zahl der Mitwirkenden. */
export function busFaktorText(anzahl: number, mitwirkende: readonly Contributor[]): string {
  if (mitwirkende.length === 0) return t("earn.busNiemand");
  if (anzahl === 1 && mitwirkende.length === 1) return t("earn.busAllein");
  if (anzahl === 1) return t("earn.busEineTraegt", { n: mitwirkende.length - 1 });
  return t("earn.busMehrere", { n: anzahl });
}

const EBENE: Record<CoverageLayer, string> = { online: "earn.ebeneOnline", lora: "earn.ebeneLora", bluetooth: "earn.ebeneBluetooth" };

/** Name einer Ebene (statt `LAYER_LABEL`). */
export const ebeneName = (l: CoverageLayer): string => t(EBENE[l]);

/** Grobe Stufe einer Zelle (statt `label`) – wie `buildCoverage()` sie bildet. */
export const zellenStufe = (knoten: number): string => t(knoten >= 20 ? "earn.stufeViele" : knoten >= 8 ? "earn.stufeMehrere" : "earn.stufeWenige");

/** „Funktioniert das bei mir?“ – aus den Feldern von `coverageAt()`. */
export function abdeckungHier(a: Pick<LocalCoverage, "online" | "lora" | "bluetooth">): string {
  const teile = [
    ...(a.online ? [t("earn.teilProvider")] : []),
    ...(a.lora ? [t("earn.teilFunk")] : []),
    ...(a.bluetooth ? [t("earn.teilBluetooth")] : []),
  ];
  if (teile.length === 0) return t("earn.hierNichts");
  const hinweis = !a.lora ? t("earn.hierOhneFunk") : !a.online ? t("earn.hierOhneProvider") : "";
  return t("earn.hierVorhanden", { teile: teile.join(t("zahl.und")) }) + hinweis;
}

/** Was vor dem Eintragen zu wissen ist – wie `coverageConsentText()`. */
export function abdeckungEinwilligung(layer: CoverageLayer): string {
  const werte = { k: K_ANONYMITY, tage: COVERAGE_GUELTIG_SECS / 86400 };
  const kern = layer === "bluetooth" ? "earn.einwilligungBluetooth" : layer === "online" ? "earn.einwilligungOnline" : "earn.einwilligungFunk";
  return `${t(kern, werte)}\n\n${t("earn.einwilligungRelays", werte)}`;
}

/** Was ein Profil preisgibt – wie `profileDisclosure()`. */
export function profilOffenlegung(p: Partial<ProfileMetadata>): string[] {
  const zeilen: string[] = [];
  if (p.name) zeilen.push(t("profil.offenName"));
  if (p.about) zeilen.push(t("profil.offenAbout"));
  const bild = inspectPicture(p.picture).kind;
  if (bild === "extern") zeilen.push(t("profil.bildExtern"));
  if (bild === "blob") zeilen.push(t("profil.offenBildNetz"));
  if (p.lud16) zeilen.push(t("profil.offenLud16"));
  if (p.website) zeilen.push(t("profil.offenWebsite"));
  if (p.chains?.solana) zeilen.push(t("profil.offenSolana"));
  if (zeilen.length === 0) zeilen.push(t("profil.offenLeer"));
  return zeilen;
}

/** Warnung zu einer Bildadresse – wie `inspectPicture().warning`. */
export function bildWarnung(url: string | undefined): string | undefined {
  const k = inspectPicture(url).kind;
  return k === "extern" ? t("profil.bildExtern") : k === "abgelehnt" ? t("profil.bildAbgelehnt") : undefined;
}

const AUFGABE: Record<QuestId, [string, string]> = {
  zugang_gesichert: ["profil.aufgabeZugang", "profil.aufgabeZugangText"],
  provider_7_tage: ["profil.aufgabeWoche", "profil.aufgabeWocheText"],
  provider_30_tage: ["profil.aufgabeMonat", "profil.aufgabeMonatText"],
  relay_betrieben: ["profil.aufgabeRelay", "profil.aufgabeRelayText"],
  modell_gespiegelt: ["profil.aufgabeModell", "profil.aufgabeModellText"],
  geworben_aktiv: ["profil.aufgabeGeworben", "profil.aufgabeGeworbenText"],
};

/** Titel und Beschreibung einer Aufgabe (statt `quest.title`/`quest.description`). */
export const aufgabeTitel = (id: QuestId): string => t(AUFGABE[id][0]);
export const aufgabeText = (id: QuestId): string => t(AUFGABE[id][1]);

/** Stand einer Aufgabe – wie `detail`, aus `zaehler`. */
export function aufgabeStand(q: Pick<QuestProgress, "quest" | "done" | "zaehler">): string {
  if (q.quest.id === "zugang_gesichert") return t(q.done ? "profil.standGesichert" : "profil.standUnbestaetigt");
  if (!q.zaehler) return t("profil.standOffen");
  const werte = { ist: q.zaehler.ist, soll: q.zaehler.soll };
  if (q.quest.id === "relay_betrieben") return t("profil.standRelay", werte);
  if (q.quest.id === "geworben_aktiv") return t("profil.standGeworben", werte);
  return t("profil.standTage", werte);
}

const QUELLE: Record<BadgeSource, string> = { verdient: "profil.quelleVerdient", verliehen: "profil.quelleVerliehen", selbst: "profil.quelleSelbst" };

/** Name der Herkunft eines Abzeichens (die Kennung bleibt die Klasse). */
export const abzeichenQuelle = (q: BadgeSource): string => t(QUELLE[q]);

/** Herkunftstext eines Abzeichens – wie `badgeSourceLabel()`. */
export function abzeichenHerkunft(b: { source: BadgeSource; basis?: string; definition: { issuerPubkey: string } }): string {
  if (b.source === "verdient") return t("profil.herkunftVerdient", { basis: b.basis ?? t("profil.ausEreignissen") });
  if (b.source === "verliehen") return t("profil.herkunftVerliehen", { von: b.definition.issuerPubkey.slice(0, 8) });
  return t("profil.herkunftSelbst");
}

/** Rückfrage vor der Notfall-Löschung – wie `wipeConfirmation()` (fester Text mit rechtlichem Hinweis). */
export const loeschRueckfrage = (): string => t("ein.wipeText");
