/**
 * Status meines Knotens (Sammlung B-11b, Entscheidung L6 A – nur lesen): In
 * der Karte „Mein Knoten“ fragt „Status abfragen“ den gekoppelten Knoten
 * versiegelt mit Nachweis (`baueStatusAuftrag()`, frischer Sitzungsschlüssel)
 * – über den Weg aus B-9c2 (`wegZumKnoten()`), mit Haken also nur über sein
 * Relay. Gezeigt wird nur, was `leseKnotenStatus()` durchlässt, als Text.
 * Nur auf Knopfdruck, nie beim Start. Eigenes Modul: `mein-knoten.ts` hält
 * den Kopplungscode und schickt nichts hinaus.
 */
import {
  KIND_DVM_KNOTEN_STATUS, LocalSigner, baueStatusAuftrag, generateKeypair, getTag, leseKnotenStatus, openPrivateJobResponse,
} from "@freedomstack/protocol";
import { t } from "../i18n.js";
import { HALTEN_MAX_POW, ablehnungsGrund } from "../knoten-halten.js";
import { STATUS_TAKT_MS, STATUS_ZEIT_MS, statusZeilen } from "../knoten-status-ansicht.js";
import { fehlerText } from "../protokoll-texte.js";
import { aktuellerKurs } from "./marktkurs.js";
import { meineKopplung } from "./mein-knoten.js";
import { angebotVon } from "./state.js";
import { type KnotenWeg, wegZumKnoten } from "./knoten-weg-ui.js";
import { el } from "./ui.js";

/** Auf die versiegelte Antwort warten – Ergebnis 6077 oder Rückmeldung 7000; null nach der Frist. */
async function warteAufStatus(
  weg: KnotenWeg, sitzung: LocalSigner, requestId: string,
): Promise<{ ergebnis: string } | { abgelehnt: string } | null> {
  const seit = Math.floor(Date.now() / 1000) - 60;
  for (let t0 = Date.now(); Date.now() - t0 < STATUS_ZEIT_MS;) {
    await new Promise((ok) => setTimeout(ok, STATUS_TAKT_MS));
    const umschlaege = await weg.query({ kinds: [1059], "#p": [sitzung.publicKey()], since: seit }).catch(() => []);
    for (const w of umschlaege) {
      const a = await openPrivateJobResponse(w, sitzung);
      if (!a.ok || getTag(a.response, "e") !== requestId) continue;
      if (a.response.kind === KIND_DVM_KNOTEN_STATUS + 1000) return { ergebnis: a.response.content };
      if (a.response.kind === 7000) return { abgelehnt: ablehnungsGrund(a.response.content) };
    }
  }
  return null;
}

/** Zeilen in die Anzeige – nur als Text. */
function zeige(ziel: HTMLElement, zeilen: string[]): void {
  ziel.replaceChildren(...zeilen.map((z) => el("div", z)));
}

/** „Status abfragen“: einmal fragen, die Antwort als Zeilen zeigen. */
export async function zeigeKnotenStatus(): Promise<void> {
  const k = meineKopplung();
  const ziel = document.getElementById("knoten-status-anzeige");
  const knopf = document.getElementById("knoten-status-holen") as HTMLButtonElement | null;
  if (!k || !ziel || !knopf) return;
  knopf.disabled = true;
  zeige(ziel, [t("set.statusFragt")]);
  try {
    const angebot = await angebotVon(k.knoten).catch(() => undefined);
    const powBits = angebot?.powBits !== undefined && angebot.powBits <= HALTEN_MAX_POW ? angebot.powBits : 0;
    const sitzung = new LocalSigner(generateKeypair().sk);
    // Alles über meinen Knoten (B-9c2): mit Haken nur über sein Relay – ohne Relay geht nichts hinaus
    const weg = await wegZumKnoten(k.knoten, sitzung);
    if (!weg) return zeige(ziel, [t("set.knotenOhneRelay")]);
    let antwort: Awaited<ReturnType<typeof warteAufStatus>>;
    try {
      const { wrap, requestId } = await baueStatusAuftrag({ sitzung, kopplung: k, powBits });
      await weg.publish(wrap);
      antwort = await warteAufStatus(weg, sitzung, requestId);
    } finally {
      weg.schliesse();
    }
    if (!antwort) return zeige(ziel, [t("set.statusSchweigt")]);
    if ("abgelehnt" in antwort) return zeige(ziel, [t("set.statusAbgelehnt", { grund: antwort.abgelehnt })]);
    const s = leseKnotenStatus(antwort.ergebnis);
    zeige(ziel, s ? statusZeilen(s, aktuellerKurs()) : [t("set.statusUnlesbar")]);
  } catch (e) {
    zeige(ziel, [t("set.statusFehler", { fehler: fehlerText(e) })]);
  } finally {
    knopf.disabled = false;
  }
}

/** Knopf in der Karte „Mein Knoten“ (einmal beim Start) – gefragt wird erst beim Klick. */
export function wireKnotenStatus(): void {
  document.getElementById("knoten-status-holen")?.addEventListener("click", () => void zeigeKnotenStatus());
}
