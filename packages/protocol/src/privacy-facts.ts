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
 * Forward Secrecy und IP-Adresse haben keine: Ein Mitschnitt der Events kann
 * sie nicht pruefen. Die App-Szenarien stehen in packages/app/test/leak/.
 */
export interface PrivacyFact {
  id: string;
  aussage: string;
  status: "belegt" | "offen" | "grenze";
  /** Bei "offen": der Schritt im Ausbauplan, der die Luecke schliesst. */
  schritt?: string;
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
  { id: "dm-forward-secrecy", aussage: "Direktnachrichten haben Forward Secrecy.", status: "offen", schritt: "2.2b" },
  { id: "anhaenge", aussage: "Anhänge liegen verschlüsselt auf den Speicher-Servern – öffnen kann sie nur, wer die Nachricht lesen kann.", status: "belegt", regel: "upload-verschluesselt" },
  { id: "raeume", aussage: "Räume sind Ende-zu-Ende-verschlüsselt.", status: "offen", schritt: "2.3", regel: "kein-klartext" },
  { id: "ki-prompt", aussage: "KI-Anfragen sind für Relays nicht lesbar.", status: "belegt", regel: "kein-klartext-prompt" },
  { id: "ki-kunde", aussage: "KI-Anfragen verraten Relays nicht, wer fragt – der Provider sieht nur einen Schlüssel je Sitzung.", status: "belegt", regel: "kunde-verborgen" },
  { id: "ki-antwort", aussage: "KI-Antworten sind für Relays nicht lesbar.", status: "belegt", regel: "kein-klartext" },
  { id: "ki-zahlung", aussage: "Anfragen, Antworten, Sitzungen und Belege deiner KI-Nutzung zeigen Relays keine Beträge, Rechnungen oder Adressen.", status: "belegt", regel: "keine-zahlungsdaten" },
  { id: "ki-reklamation", aussage: "Reklamationen sind nicht öffentlich – sie gehen versiegelt an den Provider und einen Prüfer deiner Wahl.", status: "belegt", regel: "keine-zahlungsdaten" },
  { id: "sol-trinkgeld", aussage: "Belege für SOL-Trinkgeld sehen Relays nicht – sie gehen versiegelt an den Empfänger; öffentlich nur, wenn du es ausdrücklich wählst.", status: "belegt", regel: "keine-sol-adresse" },
  { id: "sol-trinkgeld-adresse", aussage: "Die Adresse für ein SOL-Trinkgeld fragt die App versiegelt beim Empfänger an; er gibt jedem Kontakt eine eigene. Die öffentliche Adresse aus einem Profil nimmt sie nur nach Warnung.", status: "belegt", regel: "keine-sol-adresse" },
  { id: "sol-adresse", aussage: "Deine Solana-Adresse steht in keinem öffentlichen Event, auch nicht beim Tausch – Anfrage und Antwort gehen versiegelt an den LP. (Ein Trinkgeld-Beleg, den du ausdrücklich öffentlich machst, führt über die Kette zu ihr.)", status: "belegt", regel: "keine-sol-adresse" },
  { id: "swap-rechnung", aussage: "Beim Tausch SOL → sats sehen Relays deine Lightning-Rechnung nicht.", status: "belegt", regel: "kein-bolt11" },
  { id: "sol-empfang", aussage: "Beim Tausch empfängst du SOL an einer frischen Adresse deiner eingebauten Wallet, nie an der Hauptadresse; für Trinkgeld gibt sie jedem Kontakt eine eigene.", status: "belegt", regel: "sol-adresse-frisch" },
  { id: "sol-frisch", aussage: "Gesendete SOL-Zahlungen kommen nicht von frischen Adressen – mehrere Zahlungen von derselben Adresse sind auf der Kette verknüpfbar.", status: "grenze", grund: "Eine frische Absenderadresse müsste erst aus einer bestehenden aufgefüllt werden, und das verknüpft beide (Entscheidung 4.9 A). Die App zahlt von einer einzelnen Adresse, legt nie zusammen und verrauscht runde Beträge.", regel: "sol-adresse-frisch" },
  { id: "mesh", aussage: "Über Funk und per Datei gibt die App nur verschlüsselte Umschläge weiter – ohne deinen Schlüssel und ohne Klartext.", status: "belegt", regel: "mesh-verschluesselt" },
  { id: "ip", aussage: "Relays sehen deine IP-Adresse nicht.", status: "offen", schritt: "6.1/6.2" },
];

/** Klartext fuer den Datenschutzbericht der App. */
export function privacyFactsText(facts: readonly PrivacyFact[] = PRIVACY_FACTS): string {
  const belegt = facts.filter((f) => f.status === "belegt").map((f) => `✓ ${f.aussage}`);
  const offen = facts
    .filter((f) => f.status === "offen")
    .map((f) => `○ Noch nicht: ${f.aussage}${f.schritt ? ` (Ausbauplan ${f.schritt})` : ""}`);
  const grenzen = facts.filter((f) => f.status === "grenze").map((f) => `△ ${f.aussage} ${f.grund ?? ""}`.trim());
  return ["Durch Tests belegt:", ...belegt, "", "Bekannte Lücken:", ...offen, ...(grenzen.length ? ["", "Bewusste Grenzen:", ...grenzen] : [])].join("\n");
}
