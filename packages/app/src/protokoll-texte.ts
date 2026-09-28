/**
 * Sätze des Protokolls in der Sprache der Oberfläche (8.16f) – ohne DOM.
 *
 * Einige Bausteine des Protokolls liefern fertige deutsche Sätze (`healthNote`,
 * `busFactor().note`, `LAYER_LABEL`, `coverageAt().message`,
 * `coverageConsentText()`, `profileDisclosure()`, `inspectPicture().warning`,
 * `badgeSourceLabel()`, Titel und Stand der Aufgaben, seit 8.16g1
 * `wipeConfirmation()`, seit 8.16g2b2 die Sätze in Settings und im Chat:
 * Nachfolge, Sicherung, Schlüsselwechsel, Geräte, Echtheit, Weitergabe,
 * ohne Internet, Tor-Reihenfolge; seit 8.16g2b3a die Gründe aus Prüfungen:
 * Fristen, Relay-Aufträge, Offline-Überweisungen, Mesh-Inhalt, Überweisungen
 * auf der Kette, RPC-Stichprobe). Die App bildet sie aus den Feldern neu; die deutsche
 * Fassung ist wortgleich mit der des Protokolls (`app/test/i18n.test.ts` prüft
 * das), damit jeder Client dieselbe Warnung zeigt.
 */
import {
  COVERAGE_GUELTIG_SECS, K_ANONYMITY, inspectPicture,
  type BadgeSource, type Contributor, type CoverageLayer, type DevicePermission, type DeviceState, type KeyState, type Link, type LocalCoverage,
  type ProfileMetadata, type QuestId, type QuestProgress, type RepoOverview, type RestoreResult, type SuccessionState, type TorSortResult, type VerifyResult,
  type MeshFehler, type OfflineFehler, type RelayFehler, type SolFehler, type SolPruefung, type SolanaTxFehler,
  type StichprobeBefund, type StichprobeFehler, type StichprobeLuecke, type TimelockCheck,
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

// ------------------------------------------------ Settings und Chat (8.16g2b2)

const TAG_SECS = 86400;
const datum = (secs: number): string => new Date(secs * 1000).toISOString().slice(0, 10);

/** Rückfrage vor dem Einrichten der Nachfolge – wie `successionWarning()`. */
export const nachfolgeWarnung = (p: { guardians: number; threshold: number; graceDays: number }): string =>
  t("ps.nfWarnung", { schwelle: p.threshold, vertraute: p.guardians, tage: p.graceDays });

/** Stand der Nachfolge – wie `evaluateSuccession().message`. */
export function nachfolgeStand(st: SuccessionState, plan: { inactivityDays: number; threshold: number }): string {
  const tage = st.daysSinceHeartbeat;
  const n = st.claims.length;
  if (st.status === "aktiv") return t("ps.nfAktiv", { tage });
  if (st.status === "still") return t("ps.nfStill", { n, tage, frist: plan.inactivityDays });
  if (st.status === "ausgeloest") return t("ps.nfAusgeloest", { tage, n, schwelle: plan.threshold });
  if (st.status === "wartefrist") return t("ps.nfWartefrist", { rest: st.daysUntilRelease ?? 0 });
  return t("ps.nfFreigegeben", { schwelle: plan.threshold });
}

/** Was die Sicherung enthält und wann sie zuletzt lief – wie `backupInfo()`. */
export function sicherungInfo(sizeBytes: number, lastAt?: number, jetzt = Date.now() / 1000): string {
  const stand = lastAt
    ? t("ps.sichLetzte", { tage: Math.floor((jetzt - lastAt) / TAG_SECS), kb: Math.round(sizeBytes / 1024) })
    : t("ps.sichKeine");
  return t("ps.sichInfo", { stand });
}

/** Nach dem Sichern – wie `buildStateBackup().message` (`sizeBytes` ist die verschlüsselte Größe). */
export const sicherungGebaut = (sizeBytes: number): string => t("ps.sichGebaut", { kb: Math.round(sizeBytes / 1024) });

/** Ergebnis der Wiederherstellung – wie `restoreStateBackup().message`. */
export function wiederherstellungText(r: Pick<RestoreResult, "ok" | "fehler" | "version" | "backedUpAt">): string {
  if (r.ok) return t("ps.sichWieder", { stand: new Date((r.backedUpAt ?? 0) * 1000).toISOString().slice(0, 16).replace("T", " ") });
  if (r.fehler === "kein-ereignis") return t("ps.sichKeinEreignis");
  if (r.fehler === "version") return t("ps.sichVersion", { version: String(r.version) });
  return t("ps.sichUnlesbar");
}

/** Rückfrage vor dem Ersatzschlüssel – wie `rotationWarning()`. */
export const wechselWarnung = (): string => t("ps.wechselWarnung");
/** Anleitung für den Widerruf – wie `revocationInstructions()`. */
export const widerrufAnleitung = (): string => t("ps.widerrufAnleitung");

/** Stand des Schlüssels eines Kontakts – wie `resolveKey().message`. */
export function schluesselText(st: Pick<KeyState, "status" | "streit" | "vorbereitet" | "chainLength" | "distrustFrom">): string {
  if (st.status === "streitig") return st.streit === "zu-lang" ? t("ps.keyZuLang", { n: st.chainLength }) : t("ps.keyKreis");
  if (st.status === "gueltig") return t(st.vorbereitet ? "ps.keyVorbereitet" : "ps.keyOhne");
  if (st.status === "widerrufen") return t("ps.keyGestohlen", { seit: st.distrustFrom ? t("ps.keySeit", { datum: datum(st.distrustFrom) }) : "" });
  return t("ps.keyAbgeloest");
}

const RECHT: Record<DevicePermission, string> = {
  nachrichten: "ps.rechtNachrichten", raeume: "ps.rechtRaeume", zahlungen: "ps.rechtZahlungen", provider: "ps.rechtProvider", identitaet: "ps.rechtIdentitaet",
};

/** Name eines Rechts – statt `PERMISSION_LABEL`. */
export const rechtName = (p: DevicePermission): string => t(RECHT[p]);

/** Rückfrage vor einer Vollmacht – wie `deviceWarning()`. */
export function geraetWarnung(perms: DevicePermission[], tage: number): string {
  return [
    t("ps.geraetKopf", { n: perms.length, tage }),
    ...perms.map((p) => `  · ${rechtName(p)}`),
    "",
    t("ps.geraetHeisst"),
    "",
    t(perms.includes("zahlungen") ? "ps.geraetZahlt" : "ps.geraetZahltNicht"),
    t(perms.includes("identitaet") ? "ps.geraetIdent" : "ps.geraetIdentNicht"),
  ].join("\n");
}

/** Stand einer Vollmacht – wie `listDevices().message`. */
export function geraetStatusText(d: Pick<DeviceState, "status" | "revokedAt" | "expiresAt" | "permissions">, jetzt = Math.floor(Date.now() / 1000)): string {
  if (d.status === "entzogen") return t("ps.geraetEntzogen", { datum: datum(d.revokedAt ?? 0) });
  if (d.status === "abgelaufen") return t("ps.geraetAbgelaufen");
  const tage = Math.floor(((d.expiresAt ?? jetzt) - jetzt) / TAG_SECS);
  return tage < 14 ? t("ps.geraetLaeuftAb", { n: tage }) : t("ps.geraetAktiv", { n: d.permissions.size });
}

/** Ergebnis der Echtheitsprüfung – wie `verifyArtifact().message`. */
export function echtheitText(r: Pick<VerifyResult, "fall" | "version" | "bestaetigt" | "noetig">, datei: string): string {
  if (r.fall === "echt") return t("ps.echtOk", { version: r.version ?? "", n: r.bestaetigt ?? 0 });
  if (r.fall === "zu-wenig") return t("ps.echtZuWenig", { version: r.version ?? "", n: r.bestaetigt ?? 0, k: r.noetig ?? 0 });
  if (r.fall === "abweichend") return t("ps.echtAbweichend");
  if (r.fall === "ohne-namen") return t("ps.echtOhneNamen", { name: datei });
  return t("ps.echtKeinManifest");
}

/** Meldung zur fixierten Version – wie `pruefeFixierung().meldung`. */
export function fixierungText(status: "andere-echt" | "andere-unbestaetigt", fixVersion: string, laeuft?: string): string {
  return status === "andere-echt"
    ? t("ps.fixAndereEcht", { version: laeuft ?? "", fix: fixVersion })
    : t("ps.fixUnbestaetigt", { fix: fixVersion });
}

/** Begleittext zur weitergegebenen Datei – wie `sharingInstructions()`. */
export const weitergabeText = (hash: string, version: string): string => t("ps.weitergabe", { hash, version });

/** Hinweis ohne Netz – wie `OFFLINE_HINWEIS`. */
export const offlineHinweis = (): string => t("ps.offlineHinweis");

const WEG: Record<Link, string> = { lora: "ps.wegLora", bluetooth: "ps.wegBluetooth", datei: "ps.wegDatei" };

/** Name des Wegs – statt `LINK_LABEL`. */
export const wegName = (l: Link): string => t(WEG[l]);

/** Was ohne Internet geht – wie `offlineCapabilities()` (dieselbe Reihenfolge, dieselben Antworten). */
export function offlineFaehigkeiten(link: Link): { feature: string; works: boolean; note: string }[] {
  return [
    { feature: t("ps.ofDm"), works: true, note: t("ps.ofDmText") + (link === "lora" ? t("ps.ofDmFunk") : "") },
    { feature: t("ps.ofRaeume"), works: false, note: t("ps.ofRaeumeText") },
    { feature: t("ps.ofSol"), works: true, note: t("ps.ofSolText") },
    { feature: t("ps.ofEcash"), works: false, note: t("ps.ofEcashText") },
    { feature: t("ps.ofProfile"), works: false, note: t("ps.ofProfileText") },
    { feature: t("ps.ofGit"), works: false, note: t("ps.ofGitText") },
    { feature: t("ps.ofModelle"), works: false, note: t("ps.ofModelleText") },
    { feature: t("ps.ofLn"), works: false, note: t("ps.ofLnText") },
    { feature: t("ps.ofKi"), works: false, note: t("ps.ofKiText") },
  ];
}

/** Reihenfolge nach Tor – wie `sortByTorPreference().message`. */
export function torText(r: Pick<TorSortResult, "relays" | "onionCount">, pref: { onionOnly?: boolean; preferOnion?: boolean }): string {
  const n = r.onionCount;
  if (pref.onionOnly) return n === 0 ? t("ps.torKeineNur") : t("ps.torNur", { n });
  if (pref.preferOnion) return n > 0 ? t("ps.torZuerst", { n, klar: r.relays.length - n }) : t("ps.torKeine");
  return t("ps.torAlle", { n: r.relays.length, onion: n });
}

// ------------------------------------------------------------ Gründe aus Prüfungen (8.16g2b3a)

/** Verletzte Fristregel – wie `validateTimelockOrdering()`/`validateReverseTimelock()` (`reason`). */
export function fristGrund(r: Pick<TimelockCheck, "fall" | "reason" | "tLnSecs" | "tSolSecs" | "marginSecs" | "mindestSecs">): string {
  const min = r.mindestSecs ?? 0;
  switch (r.fall) {
    case "tsol": return t("pg.fristTsol");
    case "reihenfolge": return t("pg.fristReihenfolge", { ln: r.tLnSecs, sol: r.tSolSecs });
    case "puffer": return t("pg.fristPuffer", { puffer: r.marginSecs, min });
    case "cltv": return t("pg.fristCltv");
    case "vor-solana": return t("pg.fristVorSolana", { ln: r.tLnSecs, min, sol: r.tSolSecs });
    default: return r.reason ?? "";
  }
}

/** Werte zu einer abgelehnten Solana-Transaktion (`pruefeSolanaTx()` und alles, was darauf aufbaut). */
type TxWerte = { grund: string; bytes?: number; signatur?: number; signaturen?: number };

const TX: Record<SolanaTxFehler, string> = {
  "zu-gross": "pg.txZuGross",
  "ohne-signatur": "pg.txOhneSignatur",
  version: "pg.txVersion",
  unvollstaendig: "pg.txUnvollstaendig",
  signaturzahl: "pg.txSignaturzahl",
  "ohne-konten": "pg.txOhneKonten",
  signatur: "pg.txSignatur",
};
const txWerte = (r: TxWerte) => ({ bytes: r.bytes ?? 0, nr: r.signatur ?? 0, von: r.signaturen ?? 0 });

const OFFLINE: Record<Exclude<OfflineFehler, SolanaTxFehler>, string> = {
  unlesbar: "pg.txUnlesbar",
  anweisungen: "pg.ofAnweisungen",
  "kein-nonce": "pg.ofKeinNonce",
  "nonce-unvollstaendig": "pg.ofNonceUnvollstaendig",
  "keine-ueberweisung": "pg.txKeineUeberweisung",
  "ohne-zahler": "pg.ofOhneZahler",
  "zahler-verschieden": "pg.ofZahlerVerschieden",
  betrag: "pg.ofBetrag",
  "kein-nonce-wert": "pg.ofKeinNonceWert",
};

/** Warum eine Offline-Überweisung nicht taugt – wie `pruefeOfflineUeberweisung().grund`. */
export function offlineGrund(r: TxWerte & { fall?: OfflineFehler }): string {
  const k = r.fall ? (TX as Record<string, string>)[r.fall] ?? (OFFLINE as Record<string, string>)[r.fall] : undefined;
  return k ? t(k, txWerte(r)) : r.grund;
}

const MESH: Record<Exclude<MeshFehler, SolanaTxFehler>, string> = {
  klartext: "pg.meKlartext",
  "kein-event": "pg.meKeinEvent",
  "kein-umschlag": "pg.meKeinUmschlag",
  "umschlag-signatur": "pg.meUmschlagSignatur",
  "eigener-schluessel": "pg.meEigenerSchluessel",
};

/** Warum eine Nutzlast nicht über Mesh darf – wie `pruefeMeshInhalt().grund`. */
export function meshGrund(r: TxWerte & { fall?: MeshFehler }): string {
  const k = r.fall ? (TX as Record<string, string>)[r.fall] ?? (MESH as Record<string, string>)[r.fall] : undefined;
  return k ? t(k, txWerte(r)) : r.grund;
}

const RELAY: Record<RelayFehler, string> = {
  unlesbar: "pg.txUnlesbar",
  gebuehrenzahler: "pg.relGebuehr",
  anweisungen: "pg.relAnweisungen",
  programm: "pg.relProgramm",
  "keine-einloesung": "pg.relKeineEinloesung",
  "ohne-empfaenger": "pg.relOhneEmpfaenger",
  "relayer-konto": "pg.relKonto",
  "keine-ueberweisung": "pg.txKeineUeberweisung",
  "erstattung-weg": "pg.relErstattungWeg",
  "erstattung-klein": "pg.relErstattungKlein",
  unsigniert: "pg.relUnsigniert",
  signatur: "pg.relSignatur",
};

/** Warum der eigene Relay-Auftrag nicht taugt – wie `pruefeRelayAuftrag().grund`. */
export function relayGrund(r: { grund: string; fall?: RelayFehler; erstattung?: number; mindest?: number }): string {
  return r.fall ? t(RELAY[r.fall], { erstattung: r.erstattung ?? 0, mindest: r.mindest ?? 0 }) : r.grund;
}

const SOL: Record<SolFehler, string> = {
  "nicht-gefunden": "pg.solNichtGefunden",
  "ohne-ergebnis": "pg.solOhneErgebnis",
  gescheitert: "pg.solGescheitert",
  "ohne-referenz": "pg.solOhneReferenz",
  "kein-empfaenger": "pg.solKeinEmpfaenger",
  "zu-wenig": "pg.solZuWenig",
};

/**
 * Warum eine Überweisung (noch) nicht belegt ist – wie `pruefeSolUeberweisung().grund`.
 * Ohne `fall` stammt der Grund aus der App selbst und ist schon übersetzt.
 */
export function solGrund(p: Exclude<SolPruefung, { status: "belegt" }>): string {
  if (!p.fall) return p.grund;
  const w: Record<string, number> = p.status === "falsch" ? { lamports: p.lamports ?? 0, erwartet: p.erwartet ?? 0 } : {};
  return t(SOL[p.fall], w);
}

/** Warum ein Vergleich der Stichprobe ausfiel. */
const probeFehler = (f: StichprobeFehler): string =>
  f.art === "hinkt" ? t("pg.pbHinkt") : f.art === "unerwartet" ? t("pg.pbUnerwartet") : f.meldung;

/** Ein Widerspruch der Stichprobe – wie ein Eintrag in `StichprobeErgebnis.warnungen`. */
export function stichprobeBefund(b: StichprobeBefund): string {
  switch (b.art) {
    case "ketten": {
      const netz = (n?: string) => n ?? t("pg.pbUnbekanntesNetz");
      return t("pg.pbKetten", { a: b.a, netzA: netz(b.netzA), b: b.b, netzB: netz(b.netzB) });
    }
    case "blockhash": return t("pg.pbBlockhash", { von: b.von, bei: b.bei });
    case "kontostand": return t("pg.pbKontostand", { a: b.a, la: b.lamportsA, b: b.b, lb: b.lamportsB });
  }
}

/** Was sich nicht vergleichen ließ – wie ein Eintrag in `StichprobeErgebnis.hinweise`. */
export function stichprobeLuecke(l: StichprobeLuecke): string {
  switch (l.art) {
    case "anbieter": return `${l.name}: ${probeFehler(l.fehler)}`;
    case "kein-zweiter": return t("pg.pbKeinZweiter");
    case "blockhash": return t("pg.pbBlockhashOffen", { von: l.von, bei: l.bei, fehler: probeFehler(l.fehler) });
    case "adresse": return t("pg.pbAdresse");
    case "kontostand": return t("pg.pbKontostandOffen", { fehler: probeFehler(l.fehler) });
  }
}
