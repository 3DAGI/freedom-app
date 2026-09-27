/**
 * Datenschutzbericht (Settings → Datenschutz): bewertet die tatsaechlichen
 * Einstellungen mit privacy-audit.ts und haengt die belegten Aussagen und
 * bekannten Luecken aus privacy-facts.ts an – beides aus @freedomstack/protocol.
 *
 * Aus app.ts verschoben (Schritt 1.0) – wörtlich, ohne Logikänderung.
 *
 * Seit 6.2 prueft der Bericht, ob der Browser ueber Tor laeuft (ein
 * .onion-Relay erreichbar ist) – nur dann heisst es „IP-Adresse verborgen“.
 */
import type { OnionPruefung } from "@freedomstack/protocol";
import { LS_ONION_PRUEFRELAY, onionKandidaten, pruefeOnion } from "../onion-pruefung.js";
import { ladeEigeneRelays } from "../relay-satz.js";
import { geheim } from "./tresor.js";
import { $ } from "./ui.js";

let onion: { kandidaten: string; ergebnis: Promise<OnionPruefung>; fertig: boolean } | null = null;

/**
 * .onion-Pruefung dieser Sitzung (6.2): einmal je Liste der Kandidaten –
 * eingetragenes Pruef-Relay, eigener Satz, entdeckte Relays; `erneut` prueft neu.
 */
export function onionPruefung(erneut = false): Promise<OnionPruefung> {
  let bekannt: unknown[] = [];
  try {
    const a = JSON.parse(localStorage.getItem("freedom.relays") ?? "[]") as unknown;
    if (Array.isArray(a)) bekannt = a;
  } catch { /* keine */ }
  const kandidaten = onionKandidaten(localStorage.getItem(LS_ONION_PRUEFRELAY), [...ladeEigeneRelays(localStorage), ...bekannt]);
  const schluessel = kandidaten.join(" ");
  if (!onion || erneut || onion.kandidaten !== schluessel) {
    const neu = { kandidaten: schluessel, ergebnis: pruefeOnion(kandidaten, (u) => new WebSocket(u)), fertig: kandidaten.length === 0 };
    void neu.ergebnis.then(() => { neu.fertig = true; });
    onion = neu;
  }
  return onion.ergebnis;
}

let bericht = 0;

/**
 * Datenschutzbericht anzeigen.
 *
 * Liest die TATSAECHLICHEN Einstellungen aus, statt eine Musterkonfiguration
 * zu bewerten. Ein Bericht, der nicht die eigene Lage beschreibt, wird nicht
 * gelesen.
 */
export async function zeigeDatenschutz(erneut = false): Promise<void> {
  const box = $("#privacy-report");
  if (!box) return;
  const nr = ++bericht;
  try {
    const { privacyReport, summarizePrivacy, auditPrivacy, DEFAULT_CONFIG, faktenDieserSitzung } =
      await import("@freedomstack/protocol");
    const pruefung = onionPruefung(erneut);
    if (!onion?.fertig) {
      box.textContent = "Prüfe, ob dieser Browser ein .onion-Relay erreicht (höchstens 10 Sekunden) …";
      box.className = "mono-sm muted";
    }
    const tor = await pruefung;
    // Ein spaeterer Aufruf (andere Einstellung, erneut pruefen) hat Vorrang.
    if (nr !== bericht) return;

    const netz = (($("#net-mode") as HTMLSelectElement | null)?.value ?? "klar") as
      "klar" | "tor" | "mixnet";
    const profil = JSON.parse(localStorage.getItem("freedom.profile") ?? "{}") as
      { picture?: string };

    const cfg = {
      ...DEFAULT_CONFIG,
      // Tor kann eine Web-App nicht herstellen, aber pruefen (6.2): Erreicht
      // sie ein .onion-Relay, laeuft der Browser ueber Tor. Sonst – auch bei
      // „Mixnetz“, das sie nicht pruefen kann – gilt die direkte Verbindung.
      network: tor === "erreichbar" ? "tor" : "klar",
      // Erst wahr, wenn der Sendepfad NIP-17 nutzt (Schritt 2.1). Vorher
      // meldete der Bericht einen Wegwerfschluessel, den es nicht gab.
      giftWrap: DMS_GIFT_WRAPPED,
      ownRelay: !!localStorage.getItem("freedom.ownRelay"),
      solanaInProfile: !!localStorage.getItem("freedom.solAddress"),
      usesSwaps: !!geheim.getItem("freedom.swapHistory"),
      externalAvatar: /^https:\/\//.test(profil.picture ?? ""),
      stateBackup: !!localStorage.getItem("freedom.backupAt"),
      // Aufbewahrung (2.5): nur „gut“, wenn JEDE Direktnachrichten-Unterhaltung abläuft.
      expiringMessages: alleDmsLaufenAb(),
    };

    const s = summarizePrivacy(auditPrivacy(cfg as never));
    // Belegte Aussagen und bekannte Luecken kommen aus privacy-facts.ts – dort
    // erzwingen Tests, dass "belegt" nur steht, was ein Leak-Test prueft.
    // Die Aussage „ip“ ersetzt das Ergebnis der .onion-Pruefung dieser Sitzung (6.2).
    const { privacyFactsText } = await import("@freedomstack/protocol");
    const hinweise: string[] = [privacyFactsText(faktenDieserSitzung(tor))];
    if (netz === "mixnet") {
      hinweise.push(
        "Mixnetz: Ob du eines nutzt, kann die App nicht prüfen. Deine IP-Adresse ist nur verborgen, " +
        "wenn du die App selbst hinter einem Mixnetz öffnest – der Bericht rechnet deshalb mit der direkten Verbindung.",
      );
    }
    if (tor === "erreichbar" && netz === "klar") {
      hinweise.push("Tipp: Dein Browser läuft über Tor. Mit „.onion-Relays bevorzugen“ gehen Verbindungen zuerst an Onion-Dienste – ohne Tor-Ausgang dazwischen.");
    }
    box.textContent = privacyReport(cfg as never) + "\n\n" + hinweise.join("\n");
    box.className = s.critical > 0 ? "mono-sm err" : s.warnings > 0 ? "mono-sm warn" : "mono-sm ok";
  } catch (e) {
    if (nr !== bericht) return;
    box.textContent = `Bericht nicht erstellbar: ${(e as Error).message}`;
  }
}

/** Laufen alle DM-Unterhaltungen ab (NIP-40, Schritt 2.5)? Ohne DMs: nein. */
function alleDmsLaufenAb(): boolean {
  try {
    const dms = (JSON.parse(geheim.getItem("freedom.chats") ?? "[]") as Array<{ type?: string; ablaufSecs?: number }>)
      .filter((c) => c.type === "dm");
    return dms.length > 0 && dms.every((c) => Number(c.ablaufSecs) > 0);
  } catch {
    return false;
  }
}

/**
 * Werden Direktnachrichten als Gift-Wrap (NIP-59/NIP-17) verschickt?
 * Seit Schritt 2.1: ja – sendChatMessage() nutzt buildPrivateDm(). Der
 * Datenschutzbericht liest diesen Wert; test/dm-verdrahtung.test.ts prueft,
 * dass er zum Sendepfad passt.
 */
const DMS_GIFT_WRAPPED = true;
