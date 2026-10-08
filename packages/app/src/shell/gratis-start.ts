/**
 * Gratis-Start in der App (A-14b, G1): das Kontingent dieses Geräts und die
 * Gratis-Angebote der Provider. Das Kontingent liegt nur in `geheim` – der
 * Stand verrät, wie viel man fragt – und nie in der Sicherung.
 */
import type { GratisAngebot } from "@freedomstack/protocol";
import { GeraeteKontingent, tokensDerAntwort } from "../gratis-kontingent.js";
import { geheim } from "./tresor.js";

export const geraeteKontingent = new GeraeteKontingent(geheim);

/** Gratis-Angebot je Provider (Tag `gratis`, A-14a) – aus der Auswahl, nur im Speicher. */
export const gratisJeProvider = new Map<string, GratisAngebot>();

/** Eine Gratis-Antwort zählen – scheitert das Merken (Tresor gesperrt), fehlt der Eintrag, nie die Antwort. */
export async function zaehleGratisAntwort(usage: { promptTokens?: number; completionTokens?: number } | undefined): Promise<void> {
  await geraeteKontingent.buche(tokensDerAntwort(usage)).catch(() => undefined);
}
