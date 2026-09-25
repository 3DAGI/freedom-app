/**
 * SOL-Trinkgeld-Beleg in der App (Schritt 4.7b) – ohne DOM.
 *
 * Nach einem SOL-Trinkgeld geht der Beleg (Kind 9736) versiegelt an den
 * Empfaenger und als eigene Kopie; oeffentlich nur, wenn der Nutzer es
 * ausdruecklich will. Empfangene Belege prueft die App gegen die Kette –
 * angezeigt wird „belegt“ erst, wenn Empfaenger und Betrag dort stimmen.
 */
import {
  type NostrEvent, type SolPruefung, type SolTrinkgeld, type Signer,
  buildPrivateSolTrinkgeld, buildSolTrinkgeld, pruefeSolUeberweisung,
} from "@freedomstack/protocol";
import { ausLamports } from "./preis-anzeige.js";

type Veroeffentlicher = { publish(ev: NostrEvent): Promise<unknown> };

/** Beleg senden: versiegelt immer, oeffentlich nur auf Wunsch. Liefert die Zahl der Events. */
export async function sendeTrinkgeldBeleg(pool: Veroeffentlicher, signer: Signer, t: SolTrinkgeld, oeffentlich: boolean): Promise<number> {
  const wraps = await buildPrivateSolTrinkgeld(t, signer);
  for (const w of wraps) await pool.publish(w);
  if (!oeffentlich) return wraps.length;
  await pool.publish(await signer.signEvent(buildSolTrinkgeld(signer.publicKey(), t)));
  return wraps.length + 1;
}

/**
 * Prueft einen Beleg gegen die Kette, die die App gerade anspricht. Ein Beleg
 * fuer eine andere Kette laesst sich hier nicht pruefen – dann „unbestaetigt“.
 */
export async function pruefeTrinkgeld(
  t: SolTrinkgeld,
  kette: string,
  ladeTransaktion: (signatur: string) => Promise<unknown>,
): Promise<SolPruefung> {
  if (t.kette !== kette) return { status: "unbestaetigt", grund: `Beleg für ${t.kette}, eingestellt ist ${kette}` };
  try {
    return pruefeSolUeberweisung(await ladeTransaktion(t.signatur), { an: t.an, lamports: t.lamports });
  } catch (e) {
    return { status: "unbestaetigt", grund: `Kette nicht erreichbar (${(e as Error).name})` };
  }
}

/** Anzeige im Chat, z. B. „◎ Trinkgeld 0,002 SOL ≈ 310 sats · belegt ✓“. */
export function trinkgeldText(t: SolTrinkgeld, p: SolPruefung | undefined, kurs?: { satsProSol: number }, notiz = t.notiz): string {
  const stand = !p ? "wird geprüft …"
    : p.status === "belegt" ? "belegt ✓"
    : p.status === "unbestaetigt" ? `unbestätigt (${p.grund})`
    : `falsch: ${p.grund}`;
  return `◎ Trinkgeld ${ausLamports(t.lamports, kurs)} · ${stand}${notiz ? ` – „${notiz}“` : ""}`;
}
