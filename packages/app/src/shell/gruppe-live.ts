/**
 * MLS in der offenen Unterhaltung sofort (A-15b, Nutzertest 08.10.2026, Befund C-6): Gruppennachrichten
 * (Kind 445) gehen an die Relays der Gruppe, nicht an den Posteingang – das Abo für Post (A-15a) sieht sie
 * nicht, und der Abgleich holt sie höchstens einmal je Minute (gemessen ~55 s). Solange eine 1:1-Unterhaltung
 * über MLS offen ist, hält die App deshalb ein Abo an den Relays ihrer Gruppe; ein Treffer zieht
 * `mlsAbgleichen()` für diese Gruppe nach (`Nachziehen`: nie zwei Läufe zugleich).
 *
 * - Nur für die offene Unterhaltung, je eine Gruppe – eine andere beendet das Abo der vorigen.
 * - Der Filter (`#h`) geht nur an die Relays der Gruppe (`abonniereAn()`), wie beim Abgleich.
 * - Das Event selbst wird hier nicht ausgewertet – es stößt nur an; empfangen wird wie bisher.
 * - Ohne Konto (Bunker, ohne Tresor) gibt es kein Abo (`mlsGruppenAbo()` ist dann null).
 */
import { Nachziehen } from "../post-live.js";
import { mlsAbgleichen, mlsGruppenAbo } from "./mls-konto.js";
import { abonniereAn } from "./state.js";

let abo: { gruppe: string; stopp?: () => void } | null = null;

/** Die offene Unterhaltung hat diese Gruppe (oder keine): Abo an ihren Relays halten, sonst beenden. */
export async function lauscheAufGruppe(gruppe: string | null, neu: (gruppe: string) => void): Promise<void> {
  if (abo?.gruppe === gruppe) return;
  abo?.stopp?.();
  abo = null;
  if (!gruppe) return;
  const mein: { gruppe: string; stopp?: () => void } = { gruppe };
  abo = mein;
  const a = await mlsGruppenAbo(gruppe).catch(() => null);
  const nach = new Nachziehen(async () => {
    const zahlen = await mlsAbgleichen([gruppe]).catch(() => new Map<string, number>());
    if ((zahlen.get(gruppe) ?? 0) > 0) neu(gruppe);
  });
  const stopp = a && abo === mein ? await abonniereAn(a.filter, a.relays, () => nach.anstossen()).catch(() => null) : null;
  if (abo !== mein) stopp?.();
  else if (stopp) mein.stopp = stopp;
  else abo = null; // beim nächsten Öffnen neu
}
