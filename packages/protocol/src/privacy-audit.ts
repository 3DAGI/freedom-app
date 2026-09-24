/**
 * Datenschutz-Selbstauskunft: was in DIESER Konfiguration wirklich abfliesst.
 *
 * WARUM DAS MODUL EXISTIERT
 * „Anonym und sicher" ist keine Eigenschaft, sondern eine Behauptung, die von
 * Dutzenden Einstellungen abhaengt. Ein Nutzer, der glaubt, er sei anonym,
 * verhaelt sich anders als einer, der weiss, dass sein Provider seine IP
 * sieht — und der Unterschied kann teuer werden.
 *
 * Diese Auskunft rechnet aus, WER WAS sieht, und nennt es beim Namen. Sie ist
 * bewusst unangenehm: Ein Bericht, in dem alles gruen ist, waere entweder
 * gelogen oder nutzlos.
 *
 * DIE DREI SCHICHTEN, DIE UNABHAENGIG VONEINANDER LECKEN
 *
 *   1. **Inhalt** — was gesagt wird. Hier ist das System stark.
 *   2. **Netz** — wer von wo verbindet. Hier ist es schwach: Jedes Relay
 *      sieht die IP.
 *   3. **Kette** — was bezahlt wird. Hier ist es am schwaechsten, und das
 *      wird meist uebersehen: Eine Solana-Transaktion ist dauerhaft
 *      oeffentlich, mit Adresse, Betrag und Zeitpunkt.
 *
 * Ein Mixnetz verbessert ausschliesslich Schicht 2. Wer glaubt, es mache ihn
 * anonym, uebersieht Schicht 3 — und die ist bei einem System mit Zahlungen
 * oft die verraeterischste.
 */

export type Severity = "gut" | "hinweis" | "warnung" | "kritisch";

export interface PrivacyFinding {
  layer: "inhalt" | "netz" | "kette" | "geraet";
  title: string;
  severity: Severity;
  /** Wer genau was sieht. */
  whoSeesWhat: string;
  /** Was dagegen hilft — oder dass nichts hilft. */
  remedy: string;
}

export interface PrivacyConfig {
  /** Geschenkumschlag fuer Direktnachrichten. */
  giftWrap: boolean;
  /** Verschluesselte Kanaele statt offener. */
  encryptedChannels: boolean;
  /** Verbindung ueber Tor oder ein Mixnetz. */
  network: "klar" | "tor" | "mixnet";
  /** Eigene Relays statt fremder. */
  ownRelay: boolean;
  /** Solana-Adresse im Profil veroeffentlicht. */
  solanaInProfile: boolean;
  /** Swaps durchgefuehrt. */
  usesSwaps: boolean;
  /** Lightning ueber einen fremden Dienstleister. */
  custodialLightning: boolean;
  /** Ablaufende Nachrichten. */
  expiringMessages: boolean;
  /** Profilbild auf einem fremden Server. */
  externalAvatar: boolean;
  /** Zustandssicherung eingerichtet. */
  stateBackup: boolean;
}

export const DEFAULT_CONFIG: PrivacyConfig = {
  giftWrap: true,
  encryptedChannels: false,
  network: "klar",
  ownRelay: false,
  solanaInProfile: false,
  usesSwaps: false,
  custodialLightning: false,
  expiringMessages: false,
  externalAvatar: false,
  stateBackup: false,
};

/**
 * Bericht erstellen.
 *
 * Die Reihenfolge ist nach Schwere, nicht nach Schicht: Wer den Bericht nur
 * ueberfliegt, soll das Wichtigste zuerst sehen.
 */
export function auditPrivacy(cfg: PrivacyConfig): PrivacyFinding[] {
  const f: PrivacyFinding[] = [];

  // ---------------------------------------------------------- Inhalt
  f.push({
    layer: "inhalt",
    title: "Direktnachrichten",
    severity: "gut",
    whoSeesWhat: "Niemand ausser dem Empfaenger sieht den Inhalt (NIP-44).",
    remedy: "Nichts zu tun.",
  });

  f.push(cfg.giftWrap
    ? {
        layer: "inhalt", title: "Absender von Direktnachrichten", severity: "gut",
        whoSeesWhat: "Relays sehen einen Wegwerfschluessel, nicht dich.",
        remedy: "Nichts zu tun. Der EMPFAENGER bleibt sichtbar — das ist unvermeidbar.",
      }
    : {
        layer: "inhalt", title: "Absender von Direktnachrichten", severity: "warnung",
        whoSeesWhat: "Jedes Relay sieht, WER mit WEM schreibt. Daraus laesst sich dein vollstaendiger Sozialgraph rekonstruieren.",
        remedy: "Geschenkumschlag einschalten.",
      });

  f.push(cfg.encryptedChannels
    ? {
        layer: "inhalt", title: "Kanaele", severity: "gut",
        whoSeesWhat: "Relays sehen, DASS geschrieben wird, nicht was. Die Mitgliederliste ist oeffentlich.",
        remedy: "Bedenke: Wer austritt, behaelt alles, was er vorher gelesen hat.",
      }
    : {
        layer: "inhalt", title: "Kanaele", severity: "warnung",
        whoSeesWhat: "Offene Kanaele kann JEDER lesen, auch ohne diese App. Die Rechte regeln nur das Schreiben.",
        remedy: "Verschluesselte Kanaele benutzen — kostet einen Schluesselwechsel bei jedem Austritt.",
      });

  if (!cfg.expiringMessages) {
    f.push({
      layer: "inhalt", title: "Aufbewahrung", severity: "hinweis",
      whoSeesWhat: "Alles bleibt dauerhaft auf allen Relays. Eine Nachricht von heute ist in drei Jahren noch abrufbar.",
      remedy: "Ablauf setzen. Das ist eine Bitte an die Relays, keine Garantie.",
    });
  }

  // ------------------------------------------------------------ Netz
  if (cfg.network === "klar") {
    f.push({
      layer: "netz", title: "Deine IP-Adresse", severity: "kritisch",
      whoSeesWhat:
        "JEDES Relay, mit dem du dich verbindest, sieht deine IP — und damit " +
        "ungefaehr, wo du bist und wer dein Anschlussinhaber ist. Das gilt auch " +
        "fuer alle Nachrichten, deren Inhalt und Absender verborgen sind.",
      remedy:
        "Ueber Tor verbinden und .onion-Relays bevorzugen. Kostet Geschwindigkeit, " +
        "loest aber den groessten verbleibenden Abfluss.",
    });
  } else {
    f.push({
      layer: "netz", title: "Deine IP-Adresse", severity: cfg.network === "mixnet" ? "gut" : "hinweis",
      whoSeesWhat: cfg.network === "mixnet"
        ? "Relays sehen die Adresse eines Exit-Gateways, nicht deine."
        : "Relays sehen einen Tor-Ausgang, nicht dich. Der Ausgang selbst sieht, wohin du willst.",
      remedy: cfg.network === "mixnet"
        ? "Bedenke: Wer Ein- und Ausgang gleichzeitig beobachtet, kann ueber Zeitmuster korrelieren."
        : "Ein Mixnetz waere staerker gegen Beobachter, die das ganze Netz sehen.",
    });
  }

  f.push(cfg.ownRelay
    ? {
        layer: "netz", title: "Relay-Betreiber", severity: "gut",
        whoSeesWhat: "Dein eigenes Relay. Du bist niemandem ausgeliefert.",
        remedy: "Nichts zu tun.",
      }
    : {
        layer: "netz", title: "Relay-Betreiber", severity: "hinweis",
        whoSeesWhat: "Fremde Betreiber sehen deine Verbindungszeiten und dein Datenvolumen — auch wenn sie den Inhalt nicht lesen koennen.",
        remedy: "Ein eigenes Relay betreiben, oder wenigstens mehrere fremde nutzen.",
      });

  // ------------------------------------------------------------ Kette
  if (cfg.usesSwaps) {
    f.push({
      layer: "kette", title: "Solana-Transaktionen", severity: "kritisch",
      whoSeesWhat:
        "JEDE Swap-Transaktion steht dauerhaft und oeffentlich in der Kette: " +
        "Adresse, Betrag, Zeitpunkt. Wer eine deiner Adressen kennt, sieht dein " +
        "gesamtes Verhalten — rueckwirkend und fuer immer. Kein Mixnetz aendert daran etwas.",
      remedy:
        "Fuer jeden Swap eine frische Adresse. Betraege nicht runden. " +
        "Und die ehrlichste Massnahme: keine Swaps fuer Dinge, die niemanden angehen.",
    });
  }

  if (cfg.solanaInProfile) {
    f.push({
      layer: "kette", title: "Solana-Adresse im Profil", severity: "kritisch",
      whoSeesWhat:
        "Du hast deine Identitaet oeffentlich mit einer Kettenadresse verknuepft. " +
        "Damit ist deine gesamte Transaktionshistorie einem Namen zugeordnet.",
      remedy: "Adresse aus dem Profil entfernen. Was bereits veroeffentlicht wurde, bleibt.",
    });
  }

  f.push(cfg.custodialLightning
    ? {
        layer: "kette", title: "Lightning-Anbieter", severity: "warnung",
        whoSeesWhat: "Dein Anbieter sieht jede Zahlung: Betrag, Zeitpunkt, Gegenseite. Er kennt vermutlich auch deine Identitaet.",
        remedy: "Eigener Knoten oder eine nicht-verwahrende Wallet.",
      }
    : {
        layer: "kette", title: "Lightning", severity: "hinweis",
        whoSeesWhat: "Routing-Knoten auf dem Weg sehen Betraege und Zeitpunkte, nicht aber die Gegenseite.",
        remedy: "Das ist die Eigenschaft von Lightning, nicht von diesem System.",
      });

  // ----------------------------------------------------------- Geraet
  if (cfg.externalAvatar) {
    f.push({
      layer: "geraet", title: "Profilbild auf fremdem Server", severity: "warnung",
      whoSeesWhat: "Wer das Bild dort ablegt, sieht die IP-Adresse JEDES Menschen, der dein Profil ansieht.",
      remedy: "Bild ins eigene Netz legen (freedom-blob:).",
    });
  }

  if (!cfg.stateBackup) {
    f.push({
      layer: "geraet", title: "Zustandssicherung", severity: "hinweis",
      whoSeesWhat: "Kein Abfluss — aber bei Datenverlust sind Unterhaltungen und Raeume weg.",
      remedy: "Sicherung einrichten. Sie ist verschluesselt; auch Relays koennen sie nicht lesen.",
    });
  }

  const rang: Record<Severity, number> = { kritisch: 0, warnung: 1, hinweis: 2, gut: 3 };
  return f.sort((a, b) => rang[a.severity] - rang[b.severity]);
}

export interface PrivacySummary {
  score: number;
  critical: number;
  warnings: number;
  headline: string;
  /** Der eine Schritt, der am meisten braechte. */
  biggestWin?: string;
}

/**
 * Zusammenfassung.
 *
 * Die Punktzahl ist bewusst streng: Mit Vorgabewerten liegt sie bei etwa der
 * Haelfte. Ein System, das sich selbst gute Noten gibt, ist als Auskunft
 * wertlos.
 */
export function summarizePrivacy(findings: PrivacyFinding[]): PrivacySummary {
  const kritisch = findings.filter((f) => f.severity === "kritisch").length;
  const warnungen = findings.filter((f) => f.severity === "warnung").length;
  const gut = findings.filter((f) => f.severity === "gut").length;

  const score = Math.max(0, Math.min(100,
    Math.round((gut * 100) / Math.max(1, findings.length)) - kritisch * 15 - warnungen * 5));

  const schlimmstes = findings.find((f) => f.severity === "kritisch")
    ?? findings.find((f) => f.severity === "warnung");

  return {
    score,
    critical: kritisch,
    warnings: warnungen,
    headline: kritisch > 0
      ? `${kritisch} schwerwiegende(r) Abfluss. Du bist NICHT anonym.`
      : warnungen > 0
        ? `${warnungen} Schwachstelle(n). Inhalte sind geschuetzt, Metadaten nicht vollstaendig.`
        : "Inhalt, Netz und Kette sind so gut abgesichert, wie es hier geht.",
    biggestWin: schlimmstes ? `${schlimmstes.title}: ${schlimmstes.remedy}` : undefined,
  };
}

/**
 * Was ein Mixnetz an diesem Bericht aendern wuerde.
 *
 * Eigene Funktion, weil die Frage regelmaessig kommt — und weil die Antwort
 * meist enttaeuscht: Es verbessert genau eine der drei Schichten.
 */
export function mixnetImpact(cfg: PrivacyConfig): {
  fixes: string[];
  doesNotFix: string[];
  verdict: string;
} {
  const behebt = ["Deine IP-Adresse gegenueber Relays", "Verbindungszeiten und Datenvolumen"];
  const behebtNicht: string[] = [
    "Alles auf der Kette — Solana-Transaktionen bleiben oeffentlich",
    "Wer der Empfaenger einer Nachricht ist",
    "Was in offenen Kanaelen steht",
  ];
  if (cfg.custodialLightning) behebtNicht.push("Was dein Lightning-Anbieter ueber dich weiss");
  if (cfg.solanaInProfile) behebtNicht.push("Die Verknuepfung deines Profils mit einer Kettenadresse");

  return {
    fixes: behebt,
    doesNotFix: behebtNicht,
    verdict:
      cfg.network === "klar"
        ? "Ein Mixnetz waere hier die groesste einzelne Verbesserung — es schliesst den " +
          "wichtigsten offenen Abfluss. Es macht dich aber nicht anonym, solange " +
          "Zahlungen auf einer oeffentlichen Kette laufen."
        : "Du bist bereits ueber ein anonymisierendes Netz verbunden. Ein Wechsel zu " +
          "einem Mixnetz braechte Schutz gegen Beobachter, die das GANZE Netz sehen — " +
          "gegen alles andere nichts.",
  };
}

/** Bericht als Text. */
export function privacyReport(cfg: PrivacyConfig): string {
  const f = auditPrivacy(cfg);
  const s = summarizePrivacy(f);
  const zeilen = [
    `Datenschutz-Selbstauskunft — ${s.score} von 100`,
    s.headline,
    "",
  ];
  for (const x of f) {
    const marke = x.severity === "kritisch" ? "!!" : x.severity === "warnung" ? "! " : x.severity === "hinweis" ? "· " : "ok";
    zeilen.push(`${marke} ${x.title}`, `   ${x.whoSeesWhat}`, `   → ${x.remedy}`, "");
  }
  if (s.biggestWin) zeilen.push(`Groesster Gewinn: ${s.biggestWin}`);
  return zeilen.join("\n");
}
