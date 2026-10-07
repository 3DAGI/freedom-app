/**
 * Onboarding: was fehlt gerade, und was ist der nächste sinnvolle Schritt.
 *
 * DAS PROBLEM
 * Ein Kunde braucht heute eine Lightning-Wallet, ein Provider eine
 * Ollama-Installation. Beides sind Hürden, an denen die meisten Menschen
 * abbrechen — nicht weil sie es nicht könnten, sondern weil sie an dem Punkt
 * noch nicht wissen, warum es sich lohnt.
 *
 * DIE REIHENFOLGE IST DIE EIGENTLICHE ENTSCHEIDUNG
 * Wer zuerst nach einer Wallet fragt, verliert die Leute, die noch nicht
 * wissen, ob das Ding überhaupt etwas taugt. Deshalb: **erst benutzen, dann
 * einrichten.** Der Free-Tier existiert genau dafür, wird bisher aber nirgends
 * erklärt — er ist eingebaut und unsichtbar.
 *
 * WAS HIER NICHT PASSIERT
 * Keine Fortschrittsleiste mit Häkchen für alles. Eine Liste von acht offenen
 * Punkten schreckt ab, obwohl man sieben davon nie braucht. Es gibt immer
 * genau EINEN empfohlenen nächsten Schritt, und der hängt davon ab, was der
 * Nutzer vorhat.
 */
import { t } from "./i18n.js";

export type Intent = "unbekannt" | "nutzen" | "verdienen" | "kommunizieren";

export interface Readiness {
  /** Identität vorhanden (wird automatisch erzeugt). */
  hasIdentity: boolean;
  /** Merkphrase bestätigt — ohne sie ist alles bei Datenverlust weg. */
  backedUp: boolean;
  /** Tresor eingerichtet — sonst liegt der Schlüssel im Klartext im Browser. */
  hasVault: boolean;
  /** Irgendeine Zahlungsmöglichkeit verbunden. */
  hasWallet: boolean;
  /** Schon einmal etwas gemacht. */
  hasUsedOnce: boolean;
  /**
   * Gratis-Tarif erschoepft – ein Provider hat eine Anfrage ohne Gebot
   * abgelehnt (8.1a). Einen Zaehler gibt es nicht: Wie viel gratis geht,
   * entscheidet jeder Provider selbst.
   */
  gratisErschoepft: boolean;
  /**
   * Liegt die Merkphrase noch auf diesem Geraet, weil sie noch nicht bestaetigt
   * ist (8.1a)? Sonst bleibt als Sicherung nur die Datei mit dem Schluessel.
   */
  merkphraseDa?: boolean;
}

export type StepId =
  | "los"
  | "sichern"
  | "tresor"
  | "wallet"
  | "provider-anleitung"
  | "fertig";

export interface NextStep {
  id: StepId;
  title: string;
  body: string;
  /** Beschriftung des Knopfs. Leer, wenn nichts zu tun ist. */
  action?: string;
  /** Darf der Nutzer diesen Schritt überspringen? */
  skippable: boolean;
  /** Wie dringend — steuert, ob es als Hinweis oder als Warnung erscheint. */
  urgency: "info" | "hinweis" | "warnung";
}

/**
 * Der eine nächste Schritt.
 *
 * Reihenfolge bewusst: Nutzen vor Einrichten, Sichern vor Bezahlen. Wer noch
 * nie etwas gemacht hat, wird nicht nach einer Wallet gefragt — er hat noch
 * keinen Grund, eine einzurichten.
 */
export function nextStep(r: Readiness, intent: Intent = "unbekannt"): NextStep {
  // 1. Noch nichts gemacht? Dann zuerst etwas erleben.
  if (!r.hasUsedOnce) {
    return {
      id: "los",
      title: t("ein.losTitel"),
      body: t(!r.gratisErschoepft ? "ein.losGratis" : "ein.losProbier"),
      action: t("ein.losAktion"),
      skippable: false,
      urgency: "info",
    };
  }

  // 2. Etwas gemacht, aber nicht gesichert? Das ist der teuerste offene Punkt.
  //    Erst JETZT fragen — vorher hatte der Nutzer nichts zu verlieren.
  if (!r.backedUp) {
    return {
      id: "sichern",
      title: t("ein.sichernTitel"),
      body: `${t("ein.sichernText")} ${t(r.merkphraseDa ? "ein.sichernWoerter" : "ein.sichernDatei")}`,
      action: t(r.merkphraseDa ? "ein.merkphraseAnzeigen" : "ein.dateiSpeichern"),
      skippable: true,
      urgency: "warnung",
    };
  }

  // 3. Gesichert, aber der Schlüssel liegt im Klartext im Browser? Jetzt die
  //    Passphrase — wie die Sicherung erst nach der ersten Nutzung (Entscheidung
  //    zu Schritt 1.2) und vor der Wallet, denn Wallet-Zugänge kommen in den Tresor.
  if (!r.hasVault) {
    return {
      id: "tresor",
      title: t("ein.tresorTitel"),
      body: t("ein.tresorText"),
      action: t("ein.tresorAktion"),
      skippable: true,
      urgency: "hinweis",
    };
  }

  // 4. Verdienen wollen: die Hürde ist die Software, nicht die Wallet.
  if (intent === "verdienen") {
    return {
      id: "provider-anleitung",
      title: t("ein.vermietenTitel"),
      body: t("ein.vermietenText"),
      action: t("ein.anleitung"),
      skippable: true,
      urgency: "info",
    };
  }

  // 5. Gratis aufgebraucht und keine Wallet: jetzt ist die Frage berechtigt.
  if (!r.hasWallet && r.gratisErschoepft) {
    return {
      id: "wallet",
      title: t("waehr.walletVerbinden"),
      body: t("ein.walletNoetig"),
      action: t("waehr.verbinden"),
      skippable: false,
      urgency: "hinweis",
    };
  }

  // 6. Wallet fehlt, aber noch Gratis übrig: erwähnen, nicht drängen.
  if (!r.hasWallet) {
    return {
      id: "wallet",
      title: t("ein.walletSpaeter"),
      body: t("ein.walletSpaeterText"),
      action: t("waehr.verbinden"),
      skippable: true,
      urgency: "info",
    };
  }

  return {
    id: "fertig",
    title: t("ein.fertigTitel"),
    body: t("ein.fertigText"),
    skippable: true,
    urgency: "info",
  };
}

/**
 * Erklärt, wozu die App gut ist — in der Sprache des jeweiligen Vorhabens.
 *
 * Eine einzige Erklärung für alle wäre entweder zu vage oder für die meisten
 * am Thema vorbei.
 */
export function pitchFor(intent: Intent): { headline: string; points: string[] } {
  switch (intent) {
    case "nutzen":
      return { headline: t("ein.pitchNutzen"), points: [t("ein.pitchNutzen1"), t("ein.pitchNutzen2"), t("ein.pitchNutzen3")] };
    case "verdienen":
      return { headline: t("ein.pitchVerdienen"), points: [t("ein.pitchVerdienen1"), t("ein.pitchVerdienen2"), t("ein.pitchVerdienen3")] };
    case "kommunizieren":
      return { headline: t("ein.pitchKommunizieren"), points: [t("ein.pitchKommunizieren1"), t("ein.pitchKommunizieren2"), t("ein.pitchKommunizieren3")] };
    default:
      return { headline: t("ein.pitch"), points: [t("ein.pitch1"), t("ein.pitch2"), t("ein.pitch3")] };
  }
}

/**
 * Woher der Provider-Installer kommt (C-21): von der Pages-Auslieferung dieses
 * Repositorys, gebaut aus demselben Stand wie die App (`build-site.sh`, mit
 * `install.sh.sha256` daneben). Bis 07.10.2026 stand hier `freedomstack.io` –
 * eine Domain, die niemand von uns besitzt: Wer sie registriert, hätte jedem,
 * der den Befehl kopiert, beliebigen Code untergeschoben.
 */
export const INSTALLER_URL = "https://3dagi.github.io/freedom-app/install.sh"; // kein UI-Text

/**
 * Der Befehl, mit dem ein Linux-Rechner zum Knoten wird (C-24) – gezeigt in
 * Earn › Hosten; dorthin führt auch der Einstieg „Rechner vermieten“.
 * „Installiere Ollama“ ist keine Anleitung, ein Befehl zum Kopieren schon: Der
 * Installer richtet Ollama, Modell und Dienst ein. Ohne `NODE_LUD16` – er fragt
 * die eigene Lightning-Adresse ab und bricht ohne sie ab; eine Beispieladresse
 * im Befehl führte zu einer falschen.
 */
export function providerBefehl(): string {
  return `bash <(curl -fsSL ${INSTALLER_URL})`; // kein UI-Text
}
