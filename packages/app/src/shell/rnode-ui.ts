/**
 * RNode verbinden (B-32b1, RN-W6 A): Region wählen und bestätigen, dann über WebSerial verbinden. Die Werte kommen nur
 * aus `FUNK_REGIONEN` (Vorgabe der Region); gemerkt wird die bestätigte Wahl (`freedom.reticulum.funk`). Danach läuft
 * Reticulum über die RNode (B-32b2, `starteReticulum()`): Was an die eigene LXMF-Adresse kommt, geht wie Funk weiter
 * (`nimmFunkInhalt()`); eigene Nachrichten sendet die App über sie erst mit B-32b3. Ein zweiter Klick trennt.
 */
import { t } from "../i18n.js";
import {
  FUNK_REGIONEN, LS_RETICULUM_FUNK, funkWahlText, leseFunkWahl, maxSendeleistungDbm, verbindeRNode, type FunkWahl, type RNodePort,
} from "../rnode-funk.js";
import { dialog } from "./dialog.js";
import { geheim, tresorEingerichtet, tresorOffen } from "./tresor.js";
import { toast } from "./ui.js";

let verbunden: { stoppe(): Promise<void> } | null = null;
const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

const mhz = (hz: number): string => (hz / 1e6).toLocaleString(undefined, { maximumFractionDigits: 3 });

/** Die Region wählen und bestätigen – die Vorgabe der Region, nichts darüber. Abbrechen: null. */
export async function waehleFunkRegion(): Promise<FunkWahl | null> {
  const gemerkt = leseFunkWahl(localStorage.getItem(LS_RETICULUM_FUNK));
  const w = await dialog({
    titel: t("set.rnodeTitel"),
    text: t("set.rnodeText"),
    felder: [{
      art: "wahl", name: "region", label: t("set.rnodeRegion"), wert: gemerkt?.region ?? FUNK_REGIONEN[0]!.kennung,
      optionen: FUNK_REGIONEN.map((r) => ({
        wert: r.kennung,
        text: t("set.rnodeRegionZeile", { von: mhz(r.von), bis: mhz(r.bis), mw: r.maxErpMw, prozent: r.maxSendezeitProzent }),
        hinweis: t("set.rnodeVorgabe", {
          f: mhz(r.vorgabe.frequency), bw: r.vorgabe.bandwidth / 1000, sf: r.vorgabe.spreadingFactor, dbm: r.vorgabe.txPower,
          max: maxSendeleistungDbm(r), quelle: t(r.quelle),
        }),
      })),
    }],
    ok: t("set.rnodeBestaetigen"),
  });
  const region = FUNK_REGIONEN.find((r) => r.kennung === w?.region);
  if (!region) return null;
  const wahl: FunkWahl = { region: region.kennung, parameter: { ...region.vorgabe }, bestaetigt: Math.floor(Date.now() / 1000) };
  localStorage.setItem(LS_RETICULUM_FUNK, funkWahlText(wahl));
  return wahl;
}

/** Der Knopf „RNode“ im Funk-Bereich: bestätigen, Port wählen, verbinden – oder trennen. */
export async function rnodeKnopf(status: HTMLElement | null): Promise<void> {
  if (verbunden) {
    const r = verbunden;
    verbunden = null;
    await r.stoppe().catch(() => undefined);
    if (status) status.textContent = t("set.rnodeGetrennt");
    return;
  }
  const serial = (navigator as Navigator & { serial?: { requestPort(): Promise<RNodePort> } }).serial;
  if (!serial) return toast(t("set.keinGeraetezugriff"), true);
  // Die Identität liegt in `geheim` – ein gesperrter Tresor gäbe keine und nähme keine neue an
  if (tresorEingerichtet() && !tresorOffen()) return toast(t("ein.tresorGesperrt"), true);
  const wahl = await waehleFunkRegion();
  if (!wahl) return;
  try {
    const port = await serial.requestPort();
    const rnode = await verbindeRNode(port, wahl);
    try {
      const [{ reticulumIdentitaet }, { starteReticulum }, { nimmFunkInhalt }] = await Promise.all([
        import("../reticulum-umschlag.js"), import("../reticulum-funk.js"), import("./tabs/mesh.js"),
      ]);
      const funk = await starteReticulum({
        rnode, identitaet: await reticulumIdentitaet(geheim), parameter: wahl.parameter, beiEmpfang: nimmFunkInhalt,
      });
      verbunden = funk;
      const p = wahl.parameter;
      if (status) {
        status.textContent = t("set.rnodeVerbunden", {
          f: mhz(p.frequency), bw: p.bandwidth / 1000, sf: p.spreadingFactor, dbm: p.txPower,
          prozent: FUNK_REGIONEN.find((r) => r.kennung === wahl.region)!.maxSendezeitProzent, adresse: hex(funk.adresse),
        });
      }
    } catch (e) {
      await rnode.disconnect().catch(() => undefined);
      throw e;
    }
    toast(t("set.funkVerbunden"));
  } catch (e) {
    // Abgebrochene Portwahl (NotFoundError) ist kein Fehler; die Meldungen der Bibliothek zeigen wir nicht
    if ((e as { name?: string }).name === "NotFoundError") return;
    if (status) status.textContent = t("set.rnodeNicht");
  }
}
