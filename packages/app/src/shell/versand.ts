/**
 * Verkehrsmuster in der App (Schritt 6.4).
 *
 * Direktnachrichten: jede Kopie (an den Empfänger, an dich, an Geräte) geht
 * mit eigener Zufallsverzögerung hinaus – bis `maxVerzoegerungSek()`
 * (Settings → Datenschutz, Standard 30 s). Die Nachricht steht sofort im
 * eigenen Verlauf; nur das Hinausgehen wartet. Verlässt du die Seite, geht
 * alles Wartende sofort hinaus – lieber ein Muster als eine verlorene Nachricht.
 *
 * Abrufe: ein gemeinsamer Takt mit zufälligem Abstand (`abrufTakt`) statt
 * fester Zeitgeber je Funktion.
 */
import { AbrufTakt, zufallsVerzoegerung } from "@freedomstack/protocol";
import { toast } from "./ui.js";

export const LS_VERSAND_VERZOEGERUNG = "freedom.versand.verzoegerung";
export const VERZOEGERUNG_STANDARD_SEK = 30;
const ERLAUBT = [0, 5, 30, 120];

export function maxVerzoegerungSek(s: Pick<Storage, "getItem"> = localStorage): number {
  const n = Number(s.getItem(LS_VERSAND_VERZOEGERUNG) ?? VERZOEGERUNG_STANDARD_SEK);
  return ERLAUBT.includes(n) ? n : VERZOEGERUNG_STANDARD_SEK;
}

const wartend = new Map<number, { los: () => Promise<void>; uhr: ReturnType<typeof setTimeout> }>();
let zaehler = 0;

const melde = (e: unknown) => toast(`Nachricht nicht zugestellt: ${(e as Error).message}`, true);

/** Später senden – mit eigener Zufallsverzögerung; ohne Verzögerung sofort. */
export function versendeVerzoegert(los: () => Promise<void>, maxSek = maxVerzoegerungSek()): void {
  const ms = zufallsVerzoegerung(maxSek * 1000);
  if (ms === 0) {
    void los().catch(melde);
    return;
  }
  const id = ++zaehler;
  wartend.set(id, {
    los,
    uhr: setTimeout(() => {
      wartend.delete(id);
      void los().catch(melde);
    }, ms),
  });
}

/** Alles Wartende sofort senden (beim Verlassen der Seite). */
export function sendeWartendeSofort(): number {
  const alle = [...wartend.values()];
  wartend.clear();
  for (const w of alle) {
    clearTimeout(w.uhr);
    void w.los().catch(melde);
  }
  return alle.length;
}

export const wartendeSendungen = (): number => wartend.size;

/** Gemeinsamer Abruftakt: etwa alle 30 s (15–45 s), die Abrufe melden sich mit `jedenNten` an. */
export const abrufTakt = new AbrufTakt(30_000);

/** Beim Start: Wartendes beim Verlassen senden und den Takt anwerfen. */
export function starteVerkehr(): void {
  addEventListener("pagehide", () => sendeWartendeSofort());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") sendeWartendeSofort(); });
  abrufTakt.start();
}
