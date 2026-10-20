/**
 * Posteingang nach einer Pause mit dem eigenen Knoten abgleichen (B-35c, Entscheidung NG2 A vom 18.10.2026): fällig
 * beim Start, nach einer Zeit ohne Netz (`online`) und nach `pauseSek` im Hintergrund – sonst bringt das Abo (A-15a)
 * alles. Nur gekoppelt und nur, wenn das Relay des Knotens im eigenen Satz steht (B-9c3): dann ist es Posteingang,
 * und die App darf sich dort anmelden. Als Gerät nie – der Posteingang gehört der Person. Die Runde selbst rechnet
 * `posteingang-abgleich.ts`; Fehler bleiben still, die nächste Runde versucht es neu.
 */
import { normalizeRelayUrl, type NostrEvent } from "@freedomstack/protocol";
import { POSTEINGANG_ABGLEICH, abgleichSeit, gleichePosteingangAb } from "../posteingang-abgleich.js";
import { ladeEigeneRelays } from "../relay-satz.js";
import { knotenRelay } from "./knoten-weg-ui.js";
import { meineKopplung } from "./mein-knoten.js";
import { alsGeraet, frageAn, gleicheAbAn, posteingangVon, veroeffentlicheAn } from "./state.js";
import { geheim } from "./tresor.js";

/** Zeit der letzten vollständigen Runde (Sekunden) – im Tresor: Sie verrät, wann die App lief. */
export const LS_POSTEINGANG_RUNDE = "freedom.posteingang.knotenRunde";

let faellig = true;
let laeuft = false;
let lauscht = false;
let verborgenSeit: number | null = null;

/** Stille bemerken: wieder online, oder lange im Hintergrund (das Handy hält die Seite an). */
function bemerkeStille(): void {
  if (lauscht || typeof window === "undefined") return;
  lauscht = true;
  window.addEventListener("online", () => { faellig = true; });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") verborgenSeit = Date.now();
    else if (verborgenSeit !== null && Date.now() - verborgenSeit > POSTEINGANG_ABGLEICH.pauseSek * 1000) faellig = true;
  });
}

/**
 * Eine Runde, wenn sie fällig ist – aus dem Abgleich des Posteingangs (`syncDmInbox()`). Gibt die Umschläge zurück,
 * die der Aufrufer öffnet; als erledigt gilt die Runde erst, wenn alles Geholte beim Knoten liegt.
 */
export async function abgleichMitKnoten(ich: string): Promise<NostrEvent[]> {
  bemerkeStille();
  if (!faellig || laeuft || alsGeraet()) return [];
  const kopplung = meineKopplung();
  if (!kopplung) return [];
  laeuft = true;
  faellig = false;
  try {
    const url = await knotenRelay(kopplung.knoten);
    const eigene = ladeEigeneRelays(localStorage).map(normalizeRelayUrl);
    if (!url || !eigene.includes(normalizeRelayUrl(url))) return [];
    const veroeffentlicht = (await posteingangVon(ich)).map(normalizeRelayUrl);
    const jetzt = Math.floor(Date.now() / 1000);
    const letzte = Number(geheim.getItem(LS_POSTEINGANG_RUNDE)) || null;
    const r = await gleichePosteingangAb(ich, normalizeRelayUrl(url), veroeffentlicht.length > 0 ? veroeffentlicht : eigene,
      abgleichSeit(letzte, jetzt), { frage: frageAn, gleicheAb: gleicheAbAn, lege: (ev, u) => veroeffentlicheAn(ev, [u]) });
    // Tresor gesperrt: dann eben nicht gemerkt – die nächste Runde reicht weiter zurück
    if (r.vollstaendig) await geheim.setItem(LS_POSTEINGANG_RUNDE, String(jetzt)).catch(() => {});
    return r.umschlaege;
  } finally {
    laeuft = false;
  }
}
