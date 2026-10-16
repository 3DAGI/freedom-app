/**
 * Cashu-Pfand für KI-Aufträge (RM2c2, `docs/RM2-ENTWURF.md` V1, V4, V6).
 *
 * Nennt das Angebot eines Providers die Mint des eigenen Cashu-Topfs und seinen Pfand-Schlüssel,
 * trägt die Anfrage gesperrte Token im versiegelten Kern (`pfandTags()`):
 * so viele, dass übergeben mindestens abgerechnet plus der Anteil des Providers am Gebot ist
 * (`providerAnteilMsat()`, wie der Knoten). Nach der Antwort bucht die App den Anteil des Providers
 * im Topf, Lightning zahlt ihn nicht; die übrigen Anteile gehen wie bisher in die Kasse. Gemerkt wird
 * vor dem Senden. Fehlt etwas (keine Mint, andere Mint, zu wenig im Topf, Mint nicht erreichbar),
 * geht die Anfrage wie bisher – nie ein Fehler nur, weil kein Pfand ging.
 *
 * Im Abruftakt holt `pfandTakt()` einen abgebrochenen Tausch nach und nach der Frist zurück, was
 * der Provider nicht eingelöst hat.
 */
import { pfandTags, providerAnteilMsat, zahlbareAnteile, type Empfaenger } from "@freedomstack/protocol";
import { CashuTopf } from "../cashu-topf.js";
import { angebotVon } from "./state.js";
import { geheim, tresorOffen } from "./tresor.js";

/** Der Cashu-Topf der App (A-17c) – eine Mint, vom Nutzer gewählt (Oberfläche RM2d). */
export const cashuTopf = new CashuTopf(geheim, { tresorOffen });

/** Anfragen, deren Anteil des Providers der Pfand trägt: Anfrage → Provider und Sitzungsschlüssel. */
const perPfandAnfragen = new Map<string, { provider: string; sitzung: string }>();

/**
 * Pfand für eine Anfrage – oder `undefined`, wenn es keinen geben kann. `merke()` vor dem Senden:
 * die Token gelten dann als übergeben, die Anfrage als „per Pfand“.
 */
export async function pfandFuerAnfrage(
  provider: string, sitzung: string, empfaenger: Empfaenger, hoechstMsat: number,
): Promise<{ tags: string[][]; merke(requestId: string): Promise<void> } | undefined> {
  const mint = cashuTopf.mint();
  if (!mint || hoechstMsat <= 0 || !tresorOffen()) return undefined;
  const cashu = (await angebotVon(provider).catch(() => undefined))?.cashu;
  if (!cashu || !cashu.mints.includes(mint)) return undefined;
  const bedarfMsat = providerAnteilMsat(hoechstMsat, zahlbareAnteile(empfaenger, "lightning"));
  try {
    const p = await cashuTopf.pfandFuer({ provider, sitzung, an: cashu.schluessel, bedarfMsat });
    return {
      tags: pfandTags(p.pfand),
      merke: async (requestId) => {
        await p.merke();
        perPfandAnfragen.set(requestId, { provider, sitzung });
        // Nur die letzten – Antworten kommen gleich, nicht nach Tagen
        if (perPfandAnfragen.size > 200) perPfandAnfragen.delete(perPfandAnfragen.keys().next().value!);
      },
    };
  } catch {
    // Zu wenig im Topf, Mint nicht erreichbar, ein Tausch noch offen: ohne Pfand wie bisher
    return undefined;
  }
}

/** Trägt der Pfand diese Anfrage? (Aus dem Speicher dieser Sitzung.) */
export function perPfand(requestId: string): boolean {
  return perPfandAnfragen.has(requestId);
}

/** Antwort per Pfand: den Anteil des Providers im Topf buchen – höchstens bis zum Übergebenen. */
export async function pfandAntwort(requestId: string, providerMsat: number): Promise<number> {
  const a = perPfandAnfragen.get(requestId);
  if (!a) return 0;
  return cashuTopf.pfandVerbucht(a.provider, a.sitzung, providerMsat).catch(() => 0);
}

/** Im Abruftakt: einen abgebrochenen Tausch klären, nach der Frist zurückholen. Ohne Mint oder Tresor nichts. */
export async function pfandTakt(): Promise<void> {
  if (!cashuTopf.mint() || !tresorOffen()) return;
  if (cashuTopf.laufend()) await cashuTopf.nachholen();
  await cashuTopf.holePfandZurueck();
}
