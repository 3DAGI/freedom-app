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
  /** Gratis-Kontingent noch offen. */
  freeTierLeft: number;
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
      title: "Stell einfach eine Frage",
      body:
        r.freeTierLeft > 0
          ? `Die ersten Anfragen sind kostenlos — du brauchst dafür nichts einzurichten. ` +
            `Danach entscheidest du, ob du eine Wallet verbindest.`
          : `Probier es aus. Falls gerade kein Gratis-Kontingent frei ist, findest du ` +
            `unter „Wallet" heraus, wie du bezahlst.`,
      action: "Zur KI",
      skippable: false,
      urgency: "info",
    };
  }

  // 2. Etwas gemacht, aber nicht gesichert? Das ist der teuerste offene Punkt.
  //    Erst JETZT fragen — vorher hatte der Nutzer nichts zu verlieren.
  if (!r.backedUp) {
    return {
      id: "sichern",
      title: "Sichere deinen Zugang",
      body:
        "Du hast jetzt eine Identität mit Verlauf und Reputation. Wenn du deine " +
        "Browserdaten löschst, ist beides weg — es gibt niemanden, der das " +
        "zurücksetzen kann. Zwölf Wörter aufschreiben genügt.",
      action: "Merkphrase anzeigen",
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
      title: "Schütze deinen Schlüssel",
      body:
        "Noch liegt dein Schlüssel unverschlüsselt im Browser — jede Erweiterung " +
        "mit Seitenzugriff kann ihn lesen. Eine Passphrase verschlüsselt ihn auf " +
        "diesem Gerät; beim Start fragt die App danach.",
      action: "Tresor einrichten",
      skippable: true,
      urgency: "hinweis",
    };
  }

  // 4. Verdienen wollen: die Hürde ist die Software, nicht die Wallet.
  if (intent === "verdienen") {
    return {
      id: "provider-anleitung",
      title: "Rechner vermieten",
      body:
        "Ein Befehl richtet alles ein: Modell, Dienst, Auszahlungsadresse. " +
        "Ohne eigene GPU lohnt es sich kaum — mit einer läuft er, während du " +
        "nichts damit machst.",
      action: "Anleitung",
      skippable: true,
      urgency: "info",
    };
  }

  // 5. Gratis aufgebraucht und keine Wallet: jetzt ist die Frage berechtigt.
  if (!r.hasWallet && r.freeTierLeft <= 0) {
    return {
      id: "wallet",
      title: "Wallet verbinden",
      body:
        "Das Gratis-Kontingent ist aufgebraucht. Zum Weitermachen brauchst du " +
        "eine Lightning-Wallet — verbinden dauert eine Minute und funktioniert " +
        "auf Handy und Rechner gleich.",
      action: "Verbinden",
      skippable: false,
      urgency: "hinweis",
    };
  }

  // 6. Wallet fehlt, aber noch Gratis übrig: erwähnen, nicht drängen.
  if (!r.hasWallet) {
    return {
      id: "wallet",
      title: "Später: Wallet verbinden",
      body:
        `Noch ${r.freeTierLeft} Gratis-Anfragen übrig. Danach brauchst du eine ` +
        `Wallet — du kannst das jetzt erledigen oder warten.`,
      action: "Verbinden",
      skippable: true,
      urgency: "info",
    };
  }

  return {
    id: "fertig",
    title: "Alles eingerichtet",
    body: "Identität gesichert, Wallet verbunden. Nichts weiter zu tun.",
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
      return {
        headline: "KI ohne Konto",
        points: [
          "Keine Anmeldung, keine E-Mail, keine Kreditkarte.",
          "Bezahlt wird pro Anfrage in Sats — die ersten sind gratis.",
          "Kein Anbieter, der dich sperren kann: Fällt einer aus, übernimmt ein anderer.",
        ],
      };
    case "verdienen":
      return {
        headline: "Rechenzeit vermieten",
        points: [
          "Deine GPU arbeitet, während du sie nicht brauchst.",
          "Auszahlung direkt an deine Lightning-Adresse, kein Zwischenkonto.",
          "In unterversorgten Regionen gibt es einen Aufschlag.",
        ],
      };
    case "kommunizieren":
      return {
        headline: "Nachrichten, die weiterlaufen",
        points: [
          "Verschlüsselt, ohne Telefonnummer.",
          "Läuft weiter, wenn das Netz ausfällt — über Funk oder per Datei.",
          "Deine Kontakte gehören dir, nicht einer Plattform.",
        ],
      };
    default:
      return {
        headline: "KI, Nachrichten und Zahlungen — ohne Anbieter dazwischen",
        points: [
          "Nichts einzurichten zum Ausprobieren.",
          "Läuft weiter, wenn einzelne Teile ausfallen.",
          "Du behältst deine Schlüssel.",
        ],
      };
  }
}

export interface ProviderCheck {
  ollama: boolean;
  lightningAddress: boolean;
  gpu: boolean;
}

/**
 * Was einem angehenden Provider noch fehlt — mit konkretem Befehl.
 *
 * „Installiere Ollama" ist keine Anleitung. Ein Befehl, den man kopieren kann,
 * ist eine.
 */
export function providerNextStep(c: ProviderCheck): { title: string; command?: string; body: string } {
  if (!c.lightningAddress) {
    return {
      title: "Zuerst: Auszahlungsadresse",
      body:
        "Ohne Lightning-Adresse gibt es niemanden, an den ausgezahlt werden " +
        "kann. Eine beliebige Wallet mit Adresse der Form name@anbieter.tld " +
        "genügt — das ist in fünf Minuten erledigt.",
    };
  }
  if (!c.ollama) {
    return {
      title: "Inferenz-Software fehlt",
      command: "curl -fsSL https://ollama.com/install.sh | sh",
      body:
        "Ollama führt die Modelle aus. Der Installer richtet danach alles " +
        "Weitere ein — oder du nimmst gleich das Container-Paket, das beides " +
        "zusammen startet.",
    };
  }
  if (!c.gpu) {
    return {
      title: "Läuft, aber langsam",
      body:
        "Ohne GPU rechnet der Knoten auf dem Prozessor. Das funktioniert, ist " +
        "aber so langsam, dass sich kaum ein Kunde dafür entscheidet. " +
        "Ehrlicher Hinweis vorab, statt später Enttäuschung.",
    };
  }
  return {
    title: "Bereit",
    command: "NODE_LUD16=du@wallet.cash bash <(curl -fsSL https://freedomstack.io/install.sh)",
    body: "Ein Befehl richtet Dienst, Modell und Region ein.",
  };
}
