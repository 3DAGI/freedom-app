/**
 * Halten bei meinem Knoten (Sammlung B-9b2, Entscheidung L4 A): Nach jedem
 * verschlüsselten Upload bittet die App den gekoppelten Knoten, den Blob
 * dauerhaft zu halten (`halteBeiMeinemKnoten()`) – nur gekoppelt und mit Haken
 * (`freedom.knoten.halten`, Standard an), mit frischem Sitzungsschlüssel,
 * versiegelt mit Nachweis an genau dieses Manifest (`baueHalteAuftrag()`).
 * Eigenes Modul: `mein-knoten.ts` hält den Kopplungscode und schickt nichts
 * hinaus. Das Ergebnis nur als fester Text.
 */
import {
  KIND_DVM_BLOB_HALTEN, LocalSigner, baueHalteAuftrag, generateKeypair, getTag, leseHalteAntwort, openPrivateJobResponse,
} from "@freedomstack/protocol";
import { t } from "../i18n.js";
import { HALTEN_MAX_POW, HALTEN_TAKT_MS, HALTEN_ZEIT_MS, LS_HALTEN, ablehnungsGrund, halteErgebnis, haltenAn } from "../knoten-halten.js";
import { fehlerText } from "../protokoll-texte.js";
import { meineKopplung } from "./mein-knoten.js";
import { angebotVon } from "./state.js";
import { type KnotenWeg, wegZumKnoten } from "./knoten-weg-ui.js";
import { toast } from "./ui.js";

/** Auf die versiegelte Antwort zum Auftrag warten – Ergebnis 6076 oder Rückmeldung 7000; null nach der Frist. */
async function warteAufHalten(
  weg: KnotenWeg, sitzung: LocalSigner, requestId: string,
): Promise<{ ergebnis: string } | { abgelehnt: string } | null> {
  const seit = Math.floor(Date.now() / 1000) - 60;
  for (let t0 = Date.now(); Date.now() - t0 < HALTEN_ZEIT_MS;) {
    await new Promise((ok) => setTimeout(ok, HALTEN_TAKT_MS));
    const umschlaege = await weg.query({ kinds: [1059], "#p": [sitzung.publicKey()], since: seit }).catch(() => []);
    for (const w of umschlaege) {
      const a = await openPrivateJobResponse(w, sitzung);
      if (!a.ok || getTag(a.response, "e") !== requestId) continue;
      if (a.response.kind === KIND_DVM_BLOB_HALTEN + 1000) return { ergebnis: a.response.content };
      if (a.response.kind === 7000) return { abgelehnt: ablehnungsGrund(a.response.content) };
    }
  }
  return null;
}

/**
 * Nach einem verschlüsselten Upload: den gekoppelten Knoten bitten, den Blob
 * zu halten – nur gekoppelt und mit Haken. Scheitert es, gilt der Upload trotzdem.
 */
export async function halteBeiMeinemKnoten(r: { blobId: string; manifestEventId: string }): Promise<void> {
  const k = meineKopplung();
  if (!k || !haltenAn(localStorage)) return;
  try {
    const angebot = await angebotVon(k.knoten).catch(() => undefined);
    const powBits = angebot?.powBits !== undefined && angebot.powBits <= HALTEN_MAX_POW ? angebot.powBits : 0;
    const sitzung = new LocalSigner(generateKeypair().sk);
    // Alles über meinen Knoten (B-9c2): mit Haken nur über sein Relay – ohne Relay geht nichts hinaus
    const weg = await wegZumKnoten(k.knoten, sitzung);
    if (!weg) return toast(t("set.knotenOhneRelay"), true);
    let antwort: Awaited<ReturnType<typeof warteAufHalten>>;
    try {
      const { wrap, requestId } = await baueHalteAuftrag({ sitzung, kopplung: k, blobId: r.blobId, manifestId: r.manifestEventId, powBits });
      await weg.publish(wrap);
      antwort = await warteAufHalten(weg, sitzung, requestId);
    } finally {
      weg.schliesse();
    }
    if (!antwort) return toast(t("set.knotenHaltenSchweigt"), true);
    if ("abgelehnt" in antwort) return toast(t("set.knotenHaltenAbgelehnt", { grund: antwort.abgelehnt }), true);
    const gelesen = leseHalteAntwort(antwort.ergebnis);
    if (!gelesen) return toast(t("set.knotenHaltenSchweigt"), true);
    const e = halteErgebnis(gelesen);
    if (e.art === "alle") toast(t("set.knotenHaltenAlle", { n: e.gehalten }));
    else toast(t(e.art === "teilweise" ? "set.knotenHaltenTeil" : "set.knotenHaltenKeins", { n: e.gehalten, m: e.gesamt }), true);
  } catch (e) {
    toast(t("set.knotenHaltenFehler", { fehler: fehlerText(e) }), true);
  }
}

/** Haken in der Karte „Mein Knoten“ (einmal beim Start) – gemerkt als „1“/„0“, eine Einstellung, kein Geheimnis. */
export function wireKnotenHalten(): void {
  const halten = document.getElementById("knoten-halten") as HTMLInputElement | null;
  if (!halten) return;
  halten.checked = haltenAn(localStorage);
  halten.addEventListener("change", () => localStorage.setItem(LS_HALTEN, halten.checked ? "1" : "0"));
}
