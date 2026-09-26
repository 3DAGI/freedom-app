/**
 * Stichprobe gegen einen zweiten RPC-Anbieter in der App (Schritt 5.8).
 *
 * `RpcPool.stichprobe()` vergleicht zwei Anbieter; hier steht, wann die App
 * das tut und was sie dazu sagt. In den Settings („erreichbarkeit prüfen“)
 * ohne Adresse, in der Wallet höchstens alle zehn Minuten mit einer
 * zufälligen eigenen Adresse – je Stichprobe nur eine, damit kein Anbieter
 * mehrere Adressen zusammen sieht (4.9c).
 */
import type { StichprobeErgebnis } from "@freedomstack/protocol";

/** Mindestabstand zweier Stichproben aus der Wallet-Ansicht. */
export const STICHPROBE_ABSTAND_MS = 10 * 60_000;

export function stichprobeFaellig(letzte: number | undefined, jetzt: number): boolean {
  return letzte === undefined || jetzt - letzte >= STICHPROBE_ABSTAND_MS;
}

/** Eine eigene Adresse für die Stichprobe – zufällig, nie mehrere. */
export function stichprobenKonto(adressen: readonly string[], zufall: () => number = Math.random): string | undefined {
  if (adressen.length === 0) return undefined;
  return adressen[Math.min(adressen.length - 1, Math.floor(zufall() * adressen.length))];
}

const WAS: Record<StichprobeErgebnis["verglichen"][number], string> = {
  netz: "Netz",
  blockhash: "letzter Blockhash",
  kontostand: "Kontostand",
};

/**
 * Text für die Anzeige (immer über `textContent`): `warnung`, wenn sich die
 * Anbieter widersprechen; `offen`, wenn sich nichts vergleichen ließ – das ist
 * keine Entwarnung.
 */
export function stichprobeText(r: StichprobeErgebnis): { text: string; stufe: "ok" | "warnung" | "offen" } {
  if (r.warnungen.length > 0) {
    return { text: `Achtung, RPC-Anbieter widersprechen sich: ${r.warnungen.join(" ")}`, stufe: "warnung" };
  }
  const geprueft = r.verglichen.filter((v) => v !== "netz");
  if (geprueft.length > 0) {
    const verb = geprueft.length === 1 ? "stimmt" : "stimmen";
    return { text: `Stichprobe ${r.anbieter.join(" ↔ ")}: ${geprueft.map((v) => WAS[v]).join(" und ")} ${verb} überein.`, stufe: "ok" };
  }
  return { text: `Stichprobe nicht möglich: ${r.hinweise.join("; ") || "keine Antwort"}`, stufe: "offen" };
}
