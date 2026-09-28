/**
 * Verdienen-Tab, Einnahmen je Schiene (Schritt 4.5b).
 *
 * - Lightning: die Leistungs-Events des Knotens (38010) – was der Knoten
 *   selbst meldet (`loadEarnings()` in `tabs/earn.ts`).
 * - SOL: die Zahlkanäle an die Adresse, die das Angebot des Knotens nennt –
 *   von der Kette (`verdienst.ts`), dazu das Guthaben dieser Adresse.
 *
 * Der Knoten ist der gemerkte Schlüssel (`freedom.earn.knoten`, öffentlich,
 * kein Geheimnis) oder die eigene Identität. Die Kette fragt die App erst,
 * wenn der Tab offen ist – nie beim Start: Die Abfrage nennt dem RPC-Anbieter
 * die Adresse des Knotens. Fremdes nur über textContent.
 */
import { KANAL_PROGRAMM_ID } from "@freedomstack/protocol";
import { encodeNpub } from "../identity.js";
import { gebietsschema, t } from "../i18n.js";
import { solText } from "../preis-anzeige.js";
import { fehlerText } from "../protokoll-texte.js";
import { pkShort } from "../shell-logic.js";
import { fasseKanaeleZusammen, kanaeleDesKnotens, knotenAusEingabe } from "../verdienst.js";
import { programmBereit } from "../zahlkanal.js";
import { angebotVon, solRpcUrl, state } from "./state.js";
import { $ } from "./ui.js";

export const LS_EARN_KNOTEN = "freedom.earn.knoten";

const HEX64 = /^[0-9a-f]{64}$/;

/** Der Schlüssel des eigenen Knotens: gemerkt, sonst die eigene Identität. */
export function knotenSchluessel(): string | undefined {
  try {
    const k = localStorage.getItem(LS_EARN_KNOTEN);
    if (k && HEX64.test(k)) return k;
  } catch { /* kein Speicher */ }
  return state.keypair?.pk;
}

/** npub oder Hex merken; leer heißt wieder die eigene Identität. Wirft bei Ungültigem. */
export function setzeKnoten(eingabe: string): void {
  const hex = knotenAusEingabe(eingabe);
  if (hex) localStorage.setItem(LS_EARN_KNOTEN, hex);
  else localStorage.removeItem(LS_EARN_KNOTEN);
}

/** SOL-Einnahmen: Kanäle an die Adresse des Knotens, Fristen, Guthaben. */
export async function zeigeSolEinnahmen(): Promise<void> {
  const statusEl = $("#earn-sol-status");
  const liste = $("#earn-kanaele");
  if (!statusEl || !liste) return;
  liste.replaceChildren();
  const knoten = knotenSchluessel();
  if (!knoten) return;
  const melde = (text: string): void => { statusEl.textContent = text; };
  melde(t("earn.lade"));
  try {
    const angebot = await angebotVon(knoten).catch(() => undefined);
    if (!angebot?.kanal) return melde(t("earn.solKeinKanal"));
    if (angebot.kanal.programm !== KANAL_PROGRAMM_ID) return melde(t("earn.solAnderesProgramm"));
    const { Connection, PublicKey } = await import("@solana/web3.js");
    const conn = new Connection(await solRpcUrl(), "confirmed");
    if (!(await programmBereit(conn))) return melde(t("earn.solProgrammFehlt"));
    const adresse = angebot.kanal.adresse;
    const [kanaele, guthaben] = await Promise.all([
      kanaeleDesKnotens(conn, adresse),
      conn.getBalance(new PublicKey(adresse), "confirmed"),
    ]);
    const u = fasseKanaeleZusammen(kanaele, Math.floor(Date.now() / 1000));
    const datum = (s: number): string => new Date(s * 1000).toLocaleString(gebietsschema());
    melde(t("earn.solStand", {
      adresse: pkShort(adresse), deins: solText(Number(u.deins)), laufend: u.laufend,
      frist: u.naechsteFrist ? datum(u.naechsteFrist) : "—", guthaben: solText(guthaben),
    }));
    for (const z of u.kanaele) {
      const zeile = document.createElement("div");
      zeile.textContent = z.laeuft
        ? t("earn.kanalLaeuft", { eingezahlt: solText(Number(z.eingezahlt)), deins: solText(Number(z.deins)), offen: solText(Number(z.offen)), bis: datum(z.ablauf) })
        : t("earn.kanalVorbei", { deins: solText(Number(z.deins)), bis: datum(z.ablauf) });
      liste.appendChild(zeile);
    }
  } catch (e) {
    melde(t("waehr.fehler", { fehler: fehlerText(e) }));
  }
}

/** Eingabe des Knotens; „Aktualisieren“ holt auch die SOL-Seite neu. */
export function wireVerdienst(neuLaden: () => void): void {
  const feld = $("#earn-knoten") as HTMLInputElement | null;
  if (!feld) return;
  try {
    const k = localStorage.getItem(LS_EARN_KNOTEN);
    if (k && HEX64.test(k)) feld.value = encodeNpub(k);
  } catch { /* kein Speicher */ }
  feld.onchange = () => {
    try {
      setzeKnoten(feld.value);
    } catch (e) {
      $("#earn-sol-status").textContent = fehlerText(e);
      return;
    }
    neuLaden();
    void zeigeSolEinnahmen();
  };
  $("#earn-refresh")?.addEventListener("click", () => void zeigeSolEinnahmen());
}
