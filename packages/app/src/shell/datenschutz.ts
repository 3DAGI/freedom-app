/**
 * Datenschutzbericht (Settings → Datenschutz): bewertet die tatsaechlichen
 * Einstellungen mit privacy-audit.ts und haengt die belegten Aussagen und
 * bekannten Luecken aus privacy-facts.ts an – beides aus @freedomstack/protocol.
 *
 * Aus app.ts verschoben (Schritt 1.0) – wörtlich, ohne Logikänderung.
 */
import { geheim } from "./tresor.js";
import { $ } from "./ui.js";

/**
 * Datenschutzbericht anzeigen.
 *
 * Liest die TATSAECHLICHEN Einstellungen aus, statt eine Musterkonfiguration
 * zu bewerten. Ein Bericht, der nicht die eigene Lage beschreibt, wird nicht
 * gelesen.
 */
export async function zeigeDatenschutz(): Promise<void> {
  const box = $("#privacy-report");
  if (!box) return;
  try {
    const { privacyReport, summarizePrivacy, auditPrivacy, DEFAULT_CONFIG } =
      await import("@freedomstack/protocol");

    const netz = (($("#net-mode") as HTMLSelectElement | null)?.value ?? "klar") as
      "klar" | "tor" | "mixnet";
    const profil = JSON.parse(localStorage.getItem("freedom.profile") ?? "{}") as
      { picture?: string };

    const cfg = {
      ...DEFAULT_CONFIG,
      // Tor oder ein Mixnetz kann eine Web-App weder herstellen noch pruefen –
      // die Einstellung bevorzugt nur .onion-Relays. Bewertet wird deshalb
      // die direkte Verbindung (Schritt 6.2 im Ausbauplan).
      network: "klar",
      // Erst wahr, wenn der Sendepfad NIP-17 nutzt (Schritt 2.1). Vorher
      // meldete der Bericht einen Wegwerfschluessel, den es nicht gab.
      giftWrap: DMS_GIFT_WRAPPED,
      ownRelay: !!localStorage.getItem("freedom.ownRelay"),
      solanaInProfile: !!localStorage.getItem("freedom.solAddress"),
      usesSwaps: !!geheim.getItem("freedom.swapHistory"),
      externalAvatar: /^https:\/\//.test(profil.picture ?? ""),
      stateBackup: !!localStorage.getItem("freedom.backupAt"),
      expiringMessages: localStorage.getItem("freedom.expiry") !== null,
    };

    const s = summarizePrivacy(auditPrivacy(cfg as never));
    // Belegte Aussagen und bekannte Luecken kommen aus privacy-facts.ts – dort
    // erzwingen Tests, dass "belegt" nur steht, was ein Leak-Test prueft.
    const { privacyFactsText } = await import("@freedomstack/protocol");
    const hinweise: string[] = [privacyFactsText()];
    if (netz !== "klar") {
      hinweise.push(
        "Tor/Mixnetz: Die Einstellung bevorzugt nur .onion-Relays. Deine IP-Adresse ist nur verborgen, " +
        "wenn du die App selbst im Tor Browser bzw. hinter einem Mixnetz öffnest – das kann die App nicht prüfen.",
      );
    }
    box.textContent = privacyReport(cfg as never) + "\n\n" + hinweise.join("\n");
    box.className = s.critical > 0 ? "mono-sm err" : s.warnings > 0 ? "mono-sm warn" : "mono-sm ok";
  } catch (e) {
    box.textContent = `Bericht nicht erstellbar: ${(e as Error).message}`;
  }
}

/**
 * Werden Direktnachrichten als Gift-Wrap (NIP-59/NIP-17) verschickt?
 * Seit Schritt 2.1: ja – sendChatMessage() nutzt buildPrivateDm(). Der
 * Datenschutzbericht liest diesen Wert; test/dm-verdrahtung.test.ts prueft,
 * dass er zum Sendepfad passt.
 */
const DMS_GIFT_WRAPPED = true;
