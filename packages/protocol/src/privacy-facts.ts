/**
 * Was der Datenschutzbericht behaupten darf (Schritt 1.5 im Ausbauplan).
 *
 * Jede Aussage hat einen Status. "belegt" darf nur stehen, wenn ein Leak-Test
 * das Verhalten prueft – test/privacy-facts.test.ts erzwingt das. "offen"
 * nennt bekannte Luecken mit dem Schritt, der sie schliesst. "grenze" nennt,
 * was bewusst nicht geschlossen wird, mit Grund (seit 4.9). So kann der
 * Bericht nichts versprechen, was der Code nicht haelt.
 *
 * Jede Aussage verweist auf ihre Regel aus `LEAK_REGELN` (leak-rules.ts). Nur
 * Forward Secrecy, IP-Adresse und die Abfrage eines Werbe-Namens (11.2b) haben
 * keine: Ein Mitschnitt der Events kann sie nicht pruefen. Die App-Szenarien stehen in packages/app/test/leak/.
 *
 * Die IP-Adresse prueft die App stattdessen je Sitzung (seit 6.2, `ipFaktFuer`):
 * "geprueft" steht nie in der festen Liste, nur als Ergebnis dieser Pruefung.
 */
export interface PrivacyFact {
  id: string;
  aussage: string;
  /** "geprueft": nur fuer diese Sitzung festgestellt (6.2), nie in PRIVACY_FACTS. */
  status: "belegt" | "offen" | "grenze" | "geprueft";
  /** Bei "offen": der Schritt im Ausbauplan, der die Luecke schliesst. */
  schritt?: string;
  /** Bei "offen": was du jetzt selbst tun kannst (aus einer Pruefung dieser Sitzung). */
  hinweis?: string;
  /** Bei "grenze": warum sie bleibt. */
  grund?: string;
  /** Die Leak-Regel, die die Aussage prueft (Name aus LEAK_REGELN). */
  regel?: string;
}

export const PRIVACY_FACTS: readonly PrivacyFact[] = [
  { id: "dm-inhalt", aussage: "Direktnachrichten: Der Inhalt ist Ende-zu-Ende-verschlüsselt.", status: "belegt", regel: "kein-klartext" },
  { id: "dm-absender", aussage: "Direktnachrichten: Relays sehen nicht, wer schreibt – nur, dass du Post bekommst.", status: "belegt", regel: "autor-verborgen" },
  { id: "dm-kein-kind4", aussage: "Die App sendet keine Direktnachrichten im alten Format (Kind 4) mehr.", status: "belegt", regel: "kein-kind4" },
  { id: "kontakte", aussage: "Deine Kontaktliste veröffentlicht die App nicht – auf Wunsch liegt sie verschlüsselt auf den Relays.", status: "belegt", regel: "kein-klartext" },
  { id: "abdeckung-zelle", aussage: "Abdeckungskarte: Nur die gerundete Zelle verlässt das Gerät, nie der genaue Standort.", status: "belegt", regel: "kein-klartext" },
  { id: "abdeckung-schluessel", aussage: "Ein Eintrag in die Abdeckungskarte trägt einen Wegwerfschlüssel, nicht deine Identität, und läuft nach 7 Tagen ab – auf den Relays ist er aber einzeln sichtbar.", status: "belegt", regel: "autor-verborgen" },
  { id: "dm-mls", aussage: "Direktnachrichten an Kontakte, die MLS können, laufen über MLS (Marmot): Relays sehen eine zufällige Gruppen-Id und für jede Nachricht einen neuen Schlüssel – nie dich, nie den Kontakt.", status: "belegt", regel: "mls-gruppe" },
  { id: "anhaenge", aussage: "Anhänge liegen verschlüsselt auf den Speicher-Servern – öffnen kann sie nur, wer die Nachricht lesen kann.", status: "belegt", regel: "upload-verschluesselt" },
  { id: "relay-anmeldung", aussage: "Bei Relays meldet sich die App (NIP-42) nur an, wenn der Relay es verlangt – nur bei deinen eigenen Relays und bei Relays mit gekauftem Zugang, mit deinem Schlüssel, nie mit einem Sitzungsschlüssel und nie als veröffentlichtes Event. Freedom-Relays geben Umschläge nur an den angemeldeten Empfänger heraus.", status: "belegt", regel: "anmeldung-nicht-offen" },
  { id: "versand-einzeln", aussage: "Direktnachrichten (NIP-17): Die Kopien einer Nachricht – an den Empfänger, an dich, an deine Geräte – gehen einzeln mit zufälliger Verzögerung hinaus (Standard bis 30 Sekunden, einstellbar), damit ein Relay sie nicht im selben Augenblick ankommen sieht. Abfragen laufen gebündelt mit zufälligem Abstand.", status: "belegt", regel: "kopien-entkoppelt" },
  { id: "raum-meldung", aussage: "Meldungen in privaten Räumen gehen versiegelt nur an die Moderatoren – weder die Relays noch die anderen Mitglieder sehen, wer was meldet. Moderatoren entfernen Mitglieder per Schlüsselwechsel, nicht über eine öffentliche Sperrliste.", status: "belegt", regel: "autor-verborgen" },
  { id: "raeume", aussage: "Private Räume – der Standard – sind Ende-zu-Ende-verschlüsselt (MLS): Relays sehen weder Namen noch Kanäle noch Nachrichten, und keine Nachricht trägt deinen Schlüssel. Öffentliche Räume und Communities liest jeder mit; öffentlich legt die App einen Raum nur auf ausdrücklichen Wunsch an.", status: "belegt", regel: "mls-gruppe" },
  { id: "raum-repos", aussage: "Repos privater Räume gibt es nur in der MLS-Gruppe: Ankündigung, Bundle-Schlüssel, Patches, Issues, Kommentare und Status sind innere Events – Relays sehen verschlüsselte Gruppen-Nachrichten, Speicherknoten nur das verschlüsselte Bundle.", status: "belegt", regel: "raum-repo-privat" },
  { id: "ki-prompt", aussage: "KI-Anfragen sind für Relays nicht lesbar.", status: "belegt", regel: "kein-klartext-prompt" },
  { id: "ki-kunde", aussage: "KI-Anfragen verraten Relays nicht, wer fragt – der Provider sieht nur einen Schlüssel je Sitzung.", status: "belegt", regel: "kunde-verborgen" },
  { id: "ki-antwort", aussage: "KI-Antworten sind für Relays nicht lesbar.", status: "belegt", regel: "kein-klartext" },
  { id: "ki-lokal", aussage: "Mit „Dieses Gerät“ in der Modellwahl geht die Frage nur an das Modell auf deinem Rechner (localhost) – an kein Relay, an keinen Provider und ohne Zahlung.", status: "belegt", regel: "kein-klartext-prompt" },
  { id: "ki-zahlung", aussage: "Anfragen, Antworten, Sitzungen und Belege deiner KI-Nutzung zeigen Relays keine Beträge, Rechnungen oder Adressen.", status: "belegt", regel: "keine-zahlungsdaten" },
  { id: "ruf-kontakte", aussage: "Deine Erfahrung mit Providern – wie viele Antworten du bei wem bezahlt hast, in welchem Umfang, bestätigte Reklamationen – liegt nur im Tresor. Mit Kontakten teilt die App sie nur, wenn du zustimmst, und nur versiegelt: je Kontakt ein eigener Umschlag, einer nach dem anderen; Relays sehen weder Provider noch Beträge noch dich. Deine Kontakte sehen deine Zusammenfassung.", status: "belegt", regel: "autor-verborgen" },
  { id: "ki-reklamation", aussage: "Reklamationen sind nicht öffentlich – sie gehen versiegelt an den Provider und einen Prüfer aus deinem Netz; sein Urteil geht ebenso versiegelt nur an dich und den Provider.", status: "belegt", regel: "keine-zahlungsdaten" },
  { id: "sol-trinkgeld", aussage: "Belege für SOL-Trinkgeld sehen Relays nicht – sie gehen versiegelt an den Empfänger; öffentlich nur, wenn du es ausdrücklich wählst.", status: "belegt", regel: "keine-sol-adresse" },
  { id: "sol-trinkgeld-adresse", aussage: "Die Adresse für ein SOL-Trinkgeld fragt die App versiegelt beim Empfänger an; er gibt jedem Kontakt eine eigene. Die öffentliche Adresse aus einem Profil nimmt sie nur nach Warnung.", status: "belegt", regel: "keine-sol-adresse" },
  { id: "ln-oeffentlich", aussage: "Deine Lightning-Adresse steht nur in deinem öffentlichen Profil, wenn du es ausdrücklich einschaltest. Zaps sendet die App ohne deine Identität (anonym nach NIP-57) – die Quittung, die der Dienst des Empfängers veröffentlicht, nennt dich nicht.", status: "belegt", regel: "keine-ln-adresse" },
  { id: "ln-rechnung", aussage: "Ohne öffentliche Lightning-Adresse fragt die App einen Kontakt versiegelt nach einer Rechnung; seine App stellt sie mit seiner eigenen Wallet aus und antwortet ebenso versiegelt – Relays sehen weder Betrag noch Rechnung, und kein LNURL-Dienst ist beteiligt.", status: "belegt", regel: "kein-bolt11" },
  { id: "sol-adresse", aussage: "Deine Solana-Adresse steht in keinem öffentlichen Event, auch nicht beim Tausch – Anfrage und Antwort gehen versiegelt an den LP. (Ein Trinkgeld-Beleg, den du ausdrücklich öffentlich machst, führt über die Kette zu ihr.)", status: "belegt", regel: "keine-sol-adresse" },
  { id: "swap-rechnung", aussage: "Beim Tausch SOL → sats sehen Relays deine Lightning-Rechnung nicht.", status: "belegt", regel: "kein-bolt11" },
  { id: "sol-empfang", aussage: "Beim Tausch empfängst du SOL an einer frischen Adresse deiner eingebauten Wallet, nie an der Hauptadresse; für Trinkgeld gibt sie jedem Kontakt eine eigene.", status: "belegt", regel: "sol-adresse-frisch" },
  { id: "sol-frisch", aussage: "Gesendete SOL-Zahlungen kommen nicht von frischen Adressen – mehrere Zahlungen von derselben Adresse sind auf der Kette verknüpfbar.", status: "grenze", grund: "Eine frische Absenderadresse müsste erst aus einer bestehenden aufgefüllt werden, und das verknüpft beide (Entscheidung 4.9 A). Die App zahlt von einer einzelnen Adresse, legt nie zusammen und verrauscht runde Beträge.", regel: "sol-adresse-frisch" },
  { id: "zahlkanal", aussage: "Ein Zahlkanal steht öffentlich auf der Kette: deine zahlende SOL-Adresse, die des Providers, Einlage, Ablauf, die Empfänger der Anteile und jede Einlösung.", status: "grenze", grund: "Das Programm muss Einlage, Ablauf und Aufteilung prüfen und erzwingen – dafür stehen sie im Konto des Kanals. Welche Anfrage was kostete, sehen Relays nicht: Die Gutschriften reisen nur im versiegelten Kern der Anfrage.", regel: "keine-zahlungsdaten" },
  { id: "provider-adresse", aussage: "Betreibst du einen Knoten, hat er eine SOL-Adresse: Alle Zahlkanäle an ihn und seine Auszahlungen an deine Auszahlungsadresse stehen verbunden auf der Kette.", status: "grenze", grund: "Ein Zahlkanal ist an die Adresse des Providers gebunden – frische Adressen je Kunde bräuchten je Adresse einen eigenen Kanal, eine eigene Einlage und mehr Schlüssel auf dem Knoten (Entscheidung 4.5 A). Welche Anfrage über welchen Kanal lief, steht in keinem Event. Wer das nicht will, nimmt nur Lightning an.", regel: "keine-zahlungsdaten" },
  { id: "dm-forward-secrecy", aussage: "Forward Secrecy haben Direktnachrichten nur über MLS. An Kontakte ohne MLS, mit Ablauf, mit Bunker, ohne Tresor oder wenn eines eurer Geräte nicht in die MLS-Gruppe kommt, gehen sie per NIP-17 – ohne Forward Secrecy.", status: "grenze", grund: "NIP-17 kennt keine Forward Secrecy. Ohne KeyPackage des Kontakts käme eine MLS-Nachricht nicht an; mit Bunker fehlt der Schlüssel auf dem Gerät für den Kontobeweis; ohne Tresor läge der Schlüssel des MLS-Zustands offen im Browser; Ablauf trägt MLS hier nicht. Geräte sind eigene Mitglieder der Gruppe – fehlt einem das KeyPackage oder lässt sich die Gruppe nicht abgleichen (Einladung nicht zustellbar, eine andere App gründete sie ohne dich als Admin), geht die Nachricht per NIP-17, damit jedes Gerät sie bekommt." },
  { id: "mesh", aussage: "Nachrichten gibt die App über Funk und per Datei nur als verschlüsselte Umschläge weiter – ohne deinen Schlüssel und ohne Klartext. Eine Offline-SOL-Zahlung zeigt, wie später auf der Kette, Adressen und Betrag.", status: "belegt", regel: "mesh-verschluesselt" },
  { id: "nachfolge-anteile", aussage: "Die Teile deines Schlüssels für die Nachfolge gehen versiegelt an deine Vertrauten und bei der Übergabe versiegelt weiter – kein Relay sieht einen Teil.", status: "belegt", regel: "kein-klartext" },
  { id: "nachfolge-plan", aussage: "Wer deine Vertrauten für die Nachfolge sind, steht öffentlich in deinem Nachfolgeplan.", status: "grenze", grund: "Meldungen der Vertrauten und deine Lebenszeichen müssen für alle prüfbar sein – sonst liefe eine Übernahme unbemerkt. Wer das nicht will, richtet keine Nachfolge ein.", regel: "p-tags" },
  { id: "zustand-sicherung", aussage: "Die Sicherung deiner Unterhaltungen, Räume und Namen liegt verschlüsselt auf den Relays – ohne deinen Schlüssel, Wallet-Zugänge, laufende Tauschvorgänge und Gruppenschlüssel.", status: "belegt", regel: "kein-klartext" },
  { id: "speicher-abruf", aussage: "Fehlen Stücke einer Datei auf den Relays, fragt die App Speicherknoten versiegelt von einem Wegwerf-Schlüssel an – Relays sehen weder dich noch welche Datei.", status: "belegt", regel: "kein-klartext" },
  { id: "geraete-kopien", aussage: "Hat jemand mehrere Geräte, versiegelt die App jede Nachricht einzeln an jedes davon – Relays sehen weder Inhalt noch Absender.", status: "belegt", regel: "autor-verborgen" },
  { id: "geraete-vollmacht", aussage: "Welche Schlüssel deine Geräte sind, steht öffentlich in deinen Vollmachten; wer deinen Posteingang betreibt, sieht Umschläge an dich und deine Geräte zur selben Zeit ankommen.", status: "grenze", grund: "Kontakte müssen prüfen können, dass ein Gerät für dich spricht, und wissen, an welche Geräte sie versiegeln. Wer das nicht will, nutzt statt Geräteschlüsseln einen entfernten Signer (NIP-46).", regel: "p-tags" },
  { id: "ip", aussage: "Relays sehen deine IP-Adresse nicht.", status: "offen", schritt: "6.1" },
  { id: "relay-zugang", aussage: "Wer Zugang zu einem Relay kauft, verrät dem Betreiber Schlüssel und IP-Adresse; mit SOL auch die Absenderadresse – auf der Kette sieht jeder, dass sie diesen Relay bezahlt hat.", status: "grenze", grund: "Der Relay muss wissen, für welchen Schlüssel bezahlt wurde, und die Zahlung prüfen können. Mit Sats sieht er nur, dass bezahlt wurde. In keinem Event steht die Zahladresse; wer das alles nicht will, kauft keinen Zugang – offene Relays bleiben.", regel: "keine-sol-adresse" },
  { id: "werbe-name", aussage: "Kommst du über einen Werbelink mit Namen (name@domain), fragt die App diese Domain beim ersten Start einmal nach dem Schlüssel des Werbers – die Domain sieht dabei deine IP-Adresse und dass ihr Link geöffnet wurde.", status: "grenze", grund: "Nach NIP-05 nennt nur die Domain den Schlüssel zum Namen. Die App fragt genau diese eine Adresse, ohne Cookies und ohne Herkunftsangabe, folgt keiner Weiterleitung und fragt nie ein zweites Mal. Werbelinks mit Schlüssel fragen niemanden." },
  { id: "wecken", aussage: "Mit „Wecken“ in „Mein Knoten“ sieht der Push-Dienst deines Browsers (bei Chrome Google, bei Firefox Mozilla, bei Safari Apple), wann dein Knoten dich weckt – nicht, was kam und von wem. Die Push-Adresse geht nur versiegelt an deinen Knoten.", status: "grenze", grund: "Eine geschlossene App lässt sich nur über den Push-Dienst des Browsers wecken. Der Knoten schickt leere Meldungen ohne Absender; der Dienst sieht Zeitpunkt, Häufigkeit und die IP-Adresse deines Knotens. Ohne den Haken weckt nichts.", regel: "besitzer-versiegelt" },
];

/**
 * Ergebnis der .onion-Pruefung der App (Schritt 6.2): Ein .onion-Relay
 * erreicht der Browser nur, wenn er ueber Tor laeuft.
 */
export type OnionPruefung = "erreichbar" | "nicht-erreichbar" | "keine-onion";

/**
 * Die Aussage „ip“ fuer diese Sitzung (Schritt 6.2). Eine Web-App kann Tor
 * nicht herstellen, aber pruefen: Erreicht sie ein .onion-Relay, laeuft der
 * Browser ueber Tor. Nur dann heisst es „IP-Adresse verborgen“ – als Pruefung
 * dieser Sitzung, nicht als Test-Beleg. Sonst bleibt die Luecke offen, mit dem
 * Weg, sie zu schliessen.
 */
export function ipFaktFuer(p: OnionPruefung): PrivacyFact {
  const ip = PRIVACY_FACTS.find((f) => f.id === "ip")!;
  if (p === "erreichbar") {
    return {
      id: "ip",
      aussage: "IP-Adresse verborgen: Diese Sitzung erreicht ein .onion-Relay, dein Browser läuft also über Tor – " +
        "Relays sehen einen Tor-Ausgang, nicht dich. Das gilt für jede Verbindung, wenn der ganze Browser über Tor " +
        "läuft (Tor Browser); leitest du nur .onion-Adressen über Tor, sehen andere Relays deine IP weiter.",
      status: "geprueft",
    };
  }
  return {
    ...ip,
    hinweis: p === "nicht-erreichbar"
      ? "Diese Sitzung erreicht kein .onion-Relay – dein Browser läuft wohl nicht über Tor (oder die geprüften Relays sind gerade aus). Native App oder Tor Browser nutzen."
      : "Prüfen ging nicht: Die App kennt kein .onion-Relay. Native App oder Tor Browser nutzen – dort ein .onion-Relay zum Prüfen eintragen.",
  };
}

/** Die Aussagen mit dem Ergebnis der .onion-Pruefung dieser Sitzung (ohne Pruefung: unveraendert). */
export function faktenDieserSitzung(p?: OnionPruefung, facts: readonly PrivacyFact[] = PRIVACY_FACTS): PrivacyFact[] {
  return p ? facts.map((f) => (f.id === "ip" ? ipFaktFuer(p) : f)) : [...facts];
}

/** Klartext fuer den Datenschutzbericht der App. */
export function privacyFactsText(facts: readonly PrivacyFact[] = PRIVACY_FACTS): string {
  const belegt = facts.filter((f) => f.status === "belegt").map((f) => `✓ ${f.aussage}`);
  const geprueft = facts.filter((f) => f.status === "geprueft").map((f) => `✓ ${f.aussage}`);
  const offen = facts
    .filter((f) => f.status === "offen")
    .map((f) => `○ Noch nicht: ${f.aussage}${f.schritt ? ` (Ausbauplan ${f.schritt})` : ""}${f.hinweis ? ` – ${f.hinweis}` : ""}`);
  const grenzen = facts.filter((f) => f.status === "grenze").map((f) => `△ ${f.aussage} ${f.grund ?? ""}`.trim());
  return [
    "Durch Tests belegt:", ...belegt,
    ...(geprueft.length ? ["", "In dieser Sitzung geprüft:", ...geprueft] : []),
    "", "Bekannte Lücken:", ...offen,
    ...(grenzen.length ? ["", "Bewusste Grenzen:", ...grenzen] : []),
  ].join("\n");
}
