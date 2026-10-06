/**
 * Datenschutzbericht in der Sprache der Oberfläche (8.16g2b1) – ohne DOM.
 *
 * Das Protokoll bewertet: `auditPrivacy()` (Befunde, Reihenfolge nach Schwere),
 * `summarizePrivacy()` (Punktzahl, Zählung) und `faktenDieserSitzung()`
 * (belegte Aussagen, Lücken, Grenzen). Die App bildet die Sätze über die
 * Kennungen neu – die deutsche Fassung ist wortgleich mit `privacyReport()`
 * und `privacyFactsText()`; `app/test/i18n.test.ts` prüft das und dass jede
 * Kennung einen Text hat.
 */
import {
  auditPrivacy, faktenDieserSitzung, summarizePrivacy,
  type OnionPruefung, type PrivacyConfig, type PrivacyFact, type PrivacyFinding,
} from "@freedomstack/protocol";
import { t } from "./i18n.js";

/** Befund → Titel, wer was sieht, was hilft. */
const BEFUND: Record<string, readonly [string, string, string]> = {
  "ip-klar": ["ds.tIp", "ds.bIpKlarSieht", "ds.bIpKlarHilft"],
  "sol-swaps": ["ds.tSolTx", "ds.bSolSwapsSieht", "ds.bSolSwapsHilft"],
  "sol-profil": ["ds.tSolProfil", "ds.bSolProfilSieht", "ds.bSolProfilHilft"],
  "ln-profil": ["ds.tLnProfil", "ds.bLnProfilSieht", "ds.bLnProfilHilft"],
  "nwc-relay-fremd": ["ds.tNwcRelay", "ds.bNwcRelayFremdSieht", "ds.bNwcRelayFremdHilft"],
  "absender-sichtbar": ["ds.tAbsender", "ds.bAbsenderSichtbarSieht", "ds.bAbsenderSichtbarHilft"],
  "kanaele-offen": ["ds.tKanaele", "ds.bKanaeleOffenSieht", "ds.bKanaeleOffenHilft"],
  "profilbild": ["ds.tProfilbild", "ds.bProfilbildSieht", "ds.bProfilbildHilft"],
  "aufbewahrung": ["ds.tAufbewahrung", "ds.bAufbewahrungSieht", "ds.bAufbewahrungHilft"],
  "relay-fremd": ["ds.tRelay", "ds.bRelayFremdSieht", "ds.bRelayFremdHilft"],
  "lightning": ["ds.tLn", "ds.bLightningSieht", "ds.bLightningHilft"],
  "sicherung": ["ds.tSicherung", "ds.bSicherungSieht", "ds.bSicherungHilft"],
  "dm-inhalt": ["ds.tDirekt", "ds.bDmInhaltSieht", "ds.bDmInhaltHilft"],
  "lightning-anbieter": ["ds.tLnAnbieter", "ds.bLightningAnbieterSieht", "ds.bLightningAnbieterHilft"],
  "absender-verborgen": ["ds.tAbsender", "ds.bAbsenderVerborgenSieht", "ds.bAbsenderVerborgenHilft"],
  "kanaele-verschluesselt": ["ds.tKanaele", "ds.bKanaeleVerschluesseltSieht", "ds.bKanaeleVerschluesseltHilft"],
  "relay-eigen": ["ds.tRelay", "ds.bRelayEigenSieht", "ds.bRelayEigenHilft"],
  "ip-tor": ["ds.tIp", "ds.bIpTorSieht", "ds.bIpTorHilft"],
  "ip-mixnet": ["ds.tIp", "ds.bIpMixnetSieht", "ds.bIpMixnetHilft"],
};

/** Aussage → Text und (bei Grenzen) Grund. */
const FAKT: Record<string, readonly [string, string?]> = {
  "dm-inhalt": ["ds.fDmInhalt"],
  "dm-absender": ["ds.fDmAbsender"],
  "dm-kein-kind4": ["ds.fDmKeinKind4"],
  "kontakte": ["ds.fKontakte"],
  "abdeckung-zelle": ["ds.fAbdeckungZelle"],
  "abdeckung-schluessel": ["ds.fAbdeckungSchluessel"],
  "dm-mls": ["ds.fDmMls"],
  "anhaenge": ["ds.fAnhaenge"],
  "relay-anmeldung": ["ds.fRelayAnmeldung"],
  "versand-einzeln": ["ds.fVersandEinzeln"],
  "raum-meldung": ["ds.fRaumMeldung"],
  "raeume": ["ds.fRaeume"],
  "raum-repos": ["ds.fRaumRepos"],
  "ki-prompt": ["ds.fKiPrompt"],
  "ki-kunde": ["ds.fKiKunde"],
  "ki-antwort": ["ds.fKiAntwort"],
  "ki-lokal": ["ds.fKiLokal"],
  "pruefung": ["ds.fPruefung"],
  "pruefrunde": ["ds.fPruefrunde", "ds.gPruefrunde"],
  "ki-platzhalter": ["ds.fKiPlatzhalter", "ds.gKiPlatzhalter"],
  "ki-verlauf": ["ds.fKiVerlauf", "ds.gKiVerlauf"],
  "ki-unterhaltung": ["ds.fKiUnterhaltung", "ds.gKiUnterhaltung"],
  "ki-zahlung": ["ds.fKiZahlung"],
  "ki-reklamation": ["ds.fKiReklamation"],
  "ruf-kontakte": ["ds.fRufKontakte"],
  "sol-trinkgeld": ["ds.fSolTrinkgeld"],
  "sol-trinkgeld-adresse": ["ds.fSolTrinkgeldAdresse"],
  "ln-oeffentlich": ["ds.fLnOeffentlich"],
  "ln-rechnung": ["ds.fLnRechnung"],
  "sol-adresse": ["ds.fSolAdresse"],
  "swap-rechnung": ["ds.fSwapRechnung"],
  "sol-empfang": ["ds.fSolEmpfang"],
  "sol-frisch": ["ds.fSolFrisch", "ds.gSolFrisch"],
  "zahlkanal": ["ds.fZahlkanal", "ds.gZahlkanal"],
  "provider-adresse": ["ds.fProviderAdresse", "ds.gProviderAdresse"],
  "dm-forward-secrecy": ["ds.fDmForwardSecrecy", "ds.gDmForwardSecrecy"],
  "mesh": ["ds.fMesh"],
  "nachfolge-anteile": ["ds.fNachfolgeAnteile"],
  "nachfolge-plan": ["ds.fNachfolgePlan", "ds.gNachfolgePlan"],
  "zustand-sicherung": ["ds.fZustandSicherung"],
  "speicher-abruf": ["ds.fSpeicherAbruf"],
  "geraete-kopien": ["ds.fGeraeteKopien"],
  "geraete-vollmacht": ["ds.fGeraeteVollmacht", "ds.gGeraeteVollmacht"],
  "ip": ["ds.fIp"],
  "relay-zugang": ["ds.fRelayZugang", "ds.gRelayZugang"],
  "werbe-name": ["ds.fWerbeName", "ds.gWerbeName"],
  "zeitanker": ["ds.fZeitanker", "ds.gZeitanker"],
  "wecken": ["ds.fWecken", "ds.gWecken"],
  "anruf-ip": ["ds.fAnrufIp"],
  "anruf-vermittler": ["ds.fAnrufVermittler", "ds.gAnrufVermittler"],
};

/** Hat jede Kennung einen Text? (für den Test – eine neue Aussage im Protokoll braucht einen hier) */
export const kenntBefund = (id: string): boolean => id in BEFUND;
export const kenntFakt = (id: string): boolean => id in FAKT;

/** Titel, wer was sieht, was hilft – unbekannte Kennung: die deutschen Sätze des Protokolls. */
function befund(f: PrivacyFinding): { titel: string; sieht: string; hilft: string } {
  const k = BEFUND[f.id];
  return k ? { titel: t(k[0]), sieht: t(k[1]), hilft: t(k[2]) } : { titel: f.title, sieht: f.whoSeesWhat, hilft: f.remedy };
}

/** Eine Zeile vorweg – wie `kurzfassung()`. */
function kurz(cfg: PrivacyConfig): string {
  return t("ds.kurz", {
    verborgen: t(cfg.giftWrap ? "ds.kurzVerborgen" : "ds.kurzSichtbar"),
    ip: t(cfg.network === "klar" ? "ds.kurzIpSichtbar" : "ds.kurzIpTor"),
  });
}

/** Der Bericht zu den Einstellungen – wie `privacyReport()`. */
export function berichtText(cfg: PrivacyConfig): string {
  const f = auditPrivacy(cfg);
  const s = summarizePrivacy(f);
  const kopf = s.critical > 0 ? t("ds.headKritisch", { n: s.critical }) : s.warnings > 0 ? t("ds.headWarn", { n: s.warnings }) : t("ds.headGut");
  const zeilen = [t("ds.kopf", { score: s.score }), kopf, kurz(cfg), ""];
  for (const x of f) {
    const b = befund(x);
    const marke = x.severity === "kritisch" ? "!!" : x.severity === "warnung" ? "! " : x.severity === "hinweis" ? "· " : "ok";
    zeilen.push(`${marke} ${b.titel}`, `   ${b.sieht}`, `   → ${b.hilft}`, "");
  }
  // Der eine Schritt, der am meisten brächte – wie `biggestWin`
  const schlimmstes = f.find((x) => x.severity === "kritisch") ?? f.find((x) => x.severity === "warnung");
  if (schlimmstes) {
    const b = befund(schlimmstes);
    zeilen.push(t("ds.gewinn", { text: `${b.titel}: ${b.hilft}` }));
  }
  return zeilen.join("\n");
}

/** Text einer Aussage – die Aussage „ip“ nach der .onion-Prüfung dieser Sitzung eigens. */
export function faktAussage(f: Pick<PrivacyFact, "id" | "status" | "aussage">): string {
  if (f.id === "ip" && f.status === "geprueft") return t("ds.ipGeprueft");
  const k = FAKT[f.id];
  return k ? t(k[0]) : f.aussage;
}

function faktGrund(f: PrivacyFact): string {
  const k = FAKT[f.id]?.[1];
  return k ? t(k) : f.grund ?? "";
}

/** Belegte Aussagen, Lücken und Grenzen – wie `privacyFactsText(faktenDieserSitzung(tor))`. */
export function faktenText(tor?: OnionPruefung): string {
  const facts = faktenDieserSitzung(tor);
  const hinweis = (f: PrivacyFact): string =>
    !f.hinweis ? "" : ` – ${f.id === "ip" && tor === "nicht-erreichbar" ? t("ds.ipNicht") : f.id === "ip" && tor === "keine-onion" ? t("ds.ipKeine") : f.hinweis}`;
  const belegt = facts.filter((f) => f.status === "belegt").map((f) => `✓ ${faktAussage(f)}`);
  const geprueft = facts.filter((f) => f.status === "geprueft").map((f) => `✓ ${faktAussage(f)}`);
  const offen = facts
    .filter((f) => f.status === "offen")
    .map((f) => `○ ${t("ein.nochNicht", { was: `${faktAussage(f)}${f.schritt ? t("ds.ausbauplan", { schritt: f.schritt }) : ""}${hinweis(f)}` })}`);
  const grenzen = facts.filter((f) => f.status === "grenze").map((f) => `△ ${faktAussage(f)} ${faktGrund(f)}`.trim());
  return [
    t("ds.belegt"), ...belegt,
    ...(geprueft.length ? ["", t("ds.geprueft"), ...geprueft] : []),
    "", t("ds.luecken"), ...offen,
    ...(grenzen.length ? ["", t("ds.grenzen"), ...grenzen] : []),
  ].join("\n");
}
