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
  /** Feste Kennung je Befund und Fassung (seit 8.16g2b1) – die App bildet die Texte darüber in ihrer Sprache. */
  id: string;
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
  /** Lightning-Adresse im oeffentlichen Profil (seit 6.3 nur auf Wunsch). */
  lightningInProfile?: boolean;
  /** Wallet-Verbindung (NWC) auch ueber ein fremdes Relay – nicht eigenes, nicht .onion (6.3). */
  nwcFremdesRelay?: boolean;
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
    id: "dm-inhalt",
    layer: "inhalt",
    title: "Direktnachrichten",
    severity: "gut",
    whoSeesWhat: "Niemand außer dem Empfänger sieht den Inhalt (NIP-44).",
    remedy: "Nichts zu tun.",
  });

  f.push(cfg.giftWrap
    ? {
        id: "absender-verborgen", layer: "inhalt", title: "Absender von Direktnachrichten", severity: "gut",
        whoSeesWhat: "Relays sehen einen Wegwerfschlüssel, nicht dich.",
        remedy: "Nichts zu tun. Der EMPFÄNGER bleibt sichtbar — das ist unvermeidbar.",
      }
    : {
        id: "absender-sichtbar", layer: "inhalt", title: "Absender von Direktnachrichten", severity: "warnung",
        whoSeesWhat: "Jedes Relay sieht, WER mit WEM schreibt. Daraus lässt sich dein vollständiger Sozialgraph rekonstruieren.",
        remedy: "Geschenkumschlag einschalten.",
      });

  f.push(cfg.encryptedChannels
    ? {
        id: "kanaele-verschluesselt", layer: "inhalt", title: "Kanäle", severity: "gut",
        whoSeesWhat: "Relays sehen, DASS geschrieben wird, nicht was. Die Mitgliederliste ist öffentlich.",
        remedy: "Bedenke: Wer austritt, behält alles, was er vorher gelesen hat.",
      }
    : {
        id: "kanaele-offen", layer: "inhalt", title: "Kanäle", severity: "warnung",
        whoSeesWhat: "Offene Kanäle kann JEDER lesen, auch ohne diese App. Die Rechte regeln nur das Schreiben.",
        remedy: "Verschlüsselte Kanäle benutzen — kostet einen Schlüsselwechsel bei jedem Austritt.",
      });

  if (!cfg.expiringMessages) {
    f.push({
      id: "aufbewahrung", layer: "inhalt", title: "Aufbewahrung", severity: "hinweis",
      whoSeesWhat: "Alles bleibt dauerhaft auf allen Relays. Eine Nachricht von heute ist in drei Jahren noch abrufbar.",
      remedy: "Ablauf setzen. Das ist eine Bitte an die Relays, keine Garantie.",
    });
  }

  // ------------------------------------------------------------ Netz
  if (cfg.network === "klar") {
    f.push({
      id: "ip-klar", layer: "netz", title: "Deine IP-Adresse", severity: "kritisch",
      whoSeesWhat:
        "JEDES Relay, mit dem du dich verbindest, sieht deine IP — und damit " +
        "ungefähr, wo du bist und wer dein Anschlussinhaber ist. Das gilt auch " +
        "für alle Nachrichten, deren Inhalt und Absender verborgen sind.",
      remedy:
        "Über Tor verbinden und .onion-Relays bevorzugen. Kostet Geschwindigkeit, " +
        "löst aber den größten verbleibenden Abfluss.",
    });
  } else {
    f.push({
      id: cfg.network === "mixnet" ? "ip-mixnet" : "ip-tor",
      layer: "netz", title: "Deine IP-Adresse", severity: cfg.network === "mixnet" ? "gut" : "hinweis",
      whoSeesWhat: cfg.network === "mixnet"
        ? "Relays sehen die Adresse eines Exit-Gateways, nicht deine."
        : "Relays sehen einen Tor-Ausgang, nicht dich. Der Ausgang selbst sieht, wohin du willst.",
      remedy: cfg.network === "mixnet"
        ? "Bedenke: Wer Ein- und Ausgang gleichzeitig beobachtet, kann über Zeitmuster korrelieren."
        : "Ein Mixnetz wäre stärker gegen Beobachter, die das ganze Netz sehen.",
    });
  }

  f.push(cfg.ownRelay
    ? {
        id: "relay-eigen", layer: "netz", title: "Relay-Betreiber", severity: "gut",
        whoSeesWhat: "Dein eigenes Relay. Du bist niemandem ausgeliefert.",
        remedy: "Nichts zu tun.",
      }
    : {
        id: "relay-fremd", layer: "netz", title: "Relay-Betreiber", severity: "hinweis",
        whoSeesWhat: "Fremde Betreiber sehen deine Verbindungszeiten und dein Datenvolumen — auch wenn sie den Inhalt nicht lesen können.",
        remedy: "Ein eigenes Relay betreiben, oder wenigstens mehrere fremde nutzen.",
      });

  // ------------------------------------------------------------ Kette
  if (cfg.usesSwaps) {
    f.push({
      id: "sol-swaps", layer: "kette", title: "Solana-Transaktionen", severity: "kritisch",
      whoSeesWhat:
        "JEDE Swap-Transaktion steht dauerhaft und öffentlich in der Kette: " +
        "Adresse, Betrag, Zeitpunkt. Wer eine deiner Adressen kennt, sieht dein " +
        "gesamtes Verhalten — rückwirkend und für immer. Kein Mixnetz ändert daran etwas.",
      remedy:
        "Für jeden Swap eine frische Adresse. Beträge nicht runden. " +
        "Und die ehrlichste Maßnahme: keine Swaps für Dinge, die niemanden angehen.",
    });
  }

  if (cfg.lightningInProfile) {
    f.push({
      id: "ln-profil", layer: "kette", title: "Lightning-Adresse im Profil", severity: "warnung",
      whoSeesWhat:
        "Deine Lightning-Adresse steht öffentlich neben deiner Identität. Der Dienst dahinter " +
        "sieht jede Zahlung an dich, und jede Zap-Quittung verbindet Betrag und Zeitpunkt mit deinem Namen.",
      remedy: "Im Profil „Lightning-Adresse öffentlich zeigen“ ausschalten und neu speichern. Was schon veröffentlicht ist, bleibt.",
    });
  }

  if (cfg.nwcFremdesRelay) {
    f.push({
      id: "nwc-relay-fremd", layer: "netz", title: "Relay der Wallet-Verbindung", severity: "hinweis",
      whoSeesWhat:
        "Die Verbindung zu deiner Wallet (NWC) läuft über ein fremdes Relay. Es liest nicht mit, " +
        "sieht aber, wann und wie oft deine App mit der Wallet spricht – und deine IP-Adresse.",
      remedy: "In der Wallet ein eigenes oder ein .onion-Relay eintragen und „NWC nur über mein eigenes oder ein .onion-Relay“ einschalten.",
    });
  }

  if (cfg.solanaInProfile) {
    f.push({
      id: "sol-profil", layer: "kette", title: "Solana-Adresse im Profil", severity: "kritisch",
      whoSeesWhat:
        "Du hast deine Identität öffentlich mit einer Kettenadresse verknüpft. " +
        "Damit ist deine gesamte Transaktionshistorie einem Namen zugeordnet.",
      remedy: "Im Profil „SOL-Adresse öffentlich zeigen“ ausschalten und neu speichern. Was bereits veröffentlicht wurde, bleibt.",
    });
  }

  f.push(cfg.custodialLightning
    ? {
        id: "lightning-anbieter", layer: "kette", title: "Lightning-Anbieter", severity: "warnung",
        whoSeesWhat: "Dein Anbieter sieht jede Zahlung: Betrag, Zeitpunkt, Gegenseite. Er kennt vermutlich auch deine Identität.",
        remedy: "Eigener Knoten oder eine nicht-verwahrende Wallet.",
      }
    : {
        id: "lightning", layer: "kette", title: "Lightning", severity: "hinweis",
        whoSeesWhat: "Routing-Knoten auf dem Weg sehen Beträge und Zeitpunkte, nicht aber die Gegenseite.",
        remedy: "Das ist die Eigenschaft von Lightning, nicht von diesem System.",
      });

  // ----------------------------------------------------------- Geraet
  if (cfg.externalAvatar) {
    f.push({
      id: "profilbild", layer: "geraet", title: "Profilbild auf fremdem Server", severity: "warnung",
      whoSeesWhat: "Wer das Bild dort ablegt, sieht die IP-Adresse JEDES Menschen, der dein Profil ansieht.",
      remedy: "Bild ins eigene Netz legen (freedom-blob:).",
    });
  }

  if (!cfg.stateBackup) {
    f.push({
      id: "sicherung", layer: "geraet", title: "Zustandssicherung", severity: "hinweis",
      whoSeesWhat: "Kein Abfluss — aber bei Datenverlust sind Unterhaltungen und Räume weg.",
      remedy: "Sicherung einrichten. Sie ist verschlüsselt; auch Relays können sie nicht lesen.",
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
        ? `${warnungen} Schwachstelle(n). Inhalte sind geschützt, Metadaten nicht vollständig.`
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
  const behebt = ["Deine IP-Adresse gegenüber Relays", "Verbindungszeiten und Datenvolumen"];
  const behebtNicht: string[] = [
    "Alles auf der Kette — Solana-Transaktionen bleiben öffentlich",
    "Wer der Empfänger einer Nachricht ist",
    "Was in offenen Kanälen steht",
  ];
  if (cfg.custodialLightning) behebtNicht.push("Was dein Lightning-Anbieter über dich weiß");
  if (cfg.solanaInProfile) behebtNicht.push("Die Verknüpfung deines Profils mit einer Kettenadresse");

  return {
    fixes: behebt,
    doesNotFix: behebtNicht,
    verdict:
      cfg.network === "klar"
        ? "Ein Mixnetz wäre hier die größte einzelne Verbesserung — es schließt den " +
          "wichtigsten offenen Abfluss. Es macht dich aber nicht anonym, solange " +
          "Zahlungen auf einer öffentlichen Kette laufen."
        : "Du bist bereits über ein anonymisierendes Netz verbunden. Ein Wechsel zu " +
          "einem Mixnetz brächte Schutz gegen Beobachter, die das GANZE Netz sehen — " +
          "gegen alles andere nichts.",
  };
}

/**
 * Eine Zeile vorweg (Schritt 2.5): was bei Direktnachrichten verborgen ist
 * und was nicht. Die IP-Adresse bleibt sichtbar, solange die App nicht ueber
 * Tor oder ein Mixnetz laeuft – das kann eine Web-App nicht selbst herstellen.
 */
export function kurzfassung(cfg: PrivacyConfig): string {
  const verborgen = cfg.giftWrap ? "Inhalt, Absender: verborgen" : "Inhalt: verborgen; Absender: sichtbar";
  const ip = cfg.network === "klar" ? "IP-Adresse: sichtbar ohne Tor" : "IP-Adresse: hinter Tor/Mixnetz";
  return `Kurz: ${verborgen}; ${ip}`;
}

/** Bericht als Text. */
export function privacyReport(cfg: PrivacyConfig): string {
  const f = auditPrivacy(cfg);
  const s = summarizePrivacy(f);
  const zeilen = [
    `Datenschutz-Selbstauskunft — ${s.score} von 100`,
    s.headline,
    kurzfassung(cfg),
    "",
  ];
  for (const x of f) {
    const marke = x.severity === "kritisch" ? "!!" : x.severity === "warnung" ? "! " : x.severity === "hinweis" ? "· " : "ok";
    zeilen.push(`${marke} ${x.title}`, `   ${x.whoSeesWhat}`, `   → ${x.remedy}`, "");
  }
  if (s.biggestWin) zeilen.push(`Größter Gewinn: ${s.biggestWin}`);
  return zeilen.join("\n");
}
