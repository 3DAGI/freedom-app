/**
 * Was der Datenschutzbericht behaupten darf (Schritt 1.5 im Ausbauplan).
 *
 * Jede Aussage hat einen Status. "belegt" darf nur stehen, wenn ein Leak-Test
 * das Verhalten prueft – test/privacy-facts.test.ts erzwingt das. "offen"
 * nennt bekannte Luecken mit dem Schritt, der sie schliesst. So kann der
 * Bericht nichts versprechen, was der Code nicht haelt.
 */
export interface PrivacyFact {
  id: string;
  aussage: string;
  status: "belegt" | "offen";
  /** Bei "offen": der Schritt im Ausbauplan, der die Luecke schliesst. */
  schritt?: string;
}

export const PRIVACY_FACTS: readonly PrivacyFact[] = [
  { id: "dm-inhalt", aussage: "Direktnachrichten: Der Inhalt ist Ende-zu-Ende-verschlüsselt.", status: "belegt" },
  { id: "dm-absender", aussage: "Direktnachrichten: Relays sehen nicht, wer schreibt – nur, dass du Post bekommst.", status: "belegt" },
  { id: "dm-kein-kind4", aussage: "Die App sendet keine Direktnachrichten im alten Format (Kind 4) mehr.", status: "belegt" },
  { id: "dm-forward-secrecy", aussage: "Direktnachrichten haben Forward Secrecy.", status: "offen", schritt: "2.2b" },
  { id: "anhaenge", aussage: "Anhänge liegen verschlüsselt auf den Speicher-Servern.", status: "offen", schritt: "2.4" },
  { id: "raeume", aussage: "Räume sind Ende-zu-Ende-verschlüsselt.", status: "offen", schritt: "2.3" },
  { id: "ki-prompt", aussage: "KI-Anfragen sind für Relays nicht lesbar.", status: "offen", schritt: "3.1" },
  { id: "ip", aussage: "Relays sehen deine IP-Adresse nicht.", status: "offen", schritt: "6.1/6.2" },
];

/** Klartext fuer den Datenschutzbericht der App. */
export function privacyFactsText(facts: readonly PrivacyFact[] = PRIVACY_FACTS): string {
  const belegt = facts.filter((f) => f.status === "belegt").map((f) => `✓ ${f.aussage}`);
  const offen = facts
    .filter((f) => f.status === "offen")
    .map((f) => `○ Noch nicht: ${f.aussage}${f.schritt ? ` (Ausbauplan ${f.schritt})` : ""}`);
  return ["Durch Tests belegt:", ...belegt, "", "Bekannte Lücken:", ...offen].join("\n");
}
