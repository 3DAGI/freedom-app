/**
 * Marktkurs SOL/sats in der App (Schritt 4.4b): aus den Kurs-Events der
 * Liquiditaetsgeber, eine Stimme je Absender, zehn Minuten zwischengespeichert.
 * Die Kurszeile im Wallet-Tab zeigt Quellen und Warnungen.
 */
import { KIND_PRICE_TICKER, type MarktKurs, marktKurs } from "@freedomstack/protocol";
import { kursZeile } from "../preis-anzeige.js";
import { ensurePool } from "./state.js";

const HALTEN_MS = 10 * 60_000;
let kurs: MarktKurs | undefined;
let geholtUm = 0;
let laeuft: Promise<MarktKurs | undefined> | null = null;

/** Der zuletzt geholte Kurs (synchron, fuer Anzeigen). */
export function aktuellerKurs(): MarktKurs | undefined {
  return kurs;
}

/** Kurs holen, wenn der letzte aelter als zehn Minuten ist. */
export function aktualisiereKurs(): Promise<MarktKurs | undefined> {
  if (Date.now() - geholtUm < HALTEN_MS) return Promise.resolve(kurs);
  laeuft ??= (async () => {
    try {
      const pool = await ensurePool();
      kurs = marktKurs(await pool.query({ kinds: [KIND_PRICE_TICKER], limit: 100 }), Math.floor(Date.now() / 1000));
      geholtUm = Date.now();
    } catch { /* Relays nicht erreichbar: alter Kurs bleibt, Anzeige sagt es */ }
    laeuft = null;
    zeigeKurs();
    return kurs;
  })();
  return laeuft;
}

/** Kurszeile im Wallet-Tab (textContent). */
export function zeigeKurs(): void {
  const el = document.querySelector<HTMLElement>("#kurs-info");
  if (!el) return;
  const z = kursZeile(kurs);
  el.textContent = z.text;
  el.className = z.warnung ? "mono-sm warn" : "mono-sm";
}
