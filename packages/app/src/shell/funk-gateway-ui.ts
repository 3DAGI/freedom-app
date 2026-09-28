/**
 * KI über Funk – Oberfläche (Schritt 7.4c3).
 *
 * Seite Netz → Mesh: Gateways suchen (Angebote mit `["funk","gateway"]`),
 * eines merken oder vergessen – solange die App Netz hat. Im Agenten erscheint
 * „über Funk“ nur mit gemerktem Gateway. Alles Fremde (Schlüssel, Datum) nur
 * über `textContent`.
 */
import { gebietsschema, t } from "../i18n.js";
import { fehlerText } from "../protokoll-texte.js";
import { pkShort } from "../shell-logic.js";
import { funkGateway, merkeFunkGateway, vergissFunkGateway } from "./ki-ueber-funk.js";
import { alleAngebote } from "./state.js";
import { toast } from "./ui.js";

const el = (id: string): HTMLElement | null => document.getElementById(id);

/** Stand zeigen: gemerktes Gateway, „vergessen“, die Wahl im Agenten. */
export function zeigeFunkGateway(): void {
  const g = funkGateway();
  const stand = el("funk-gateway-stand");
  if (stand) {
    stand.textContent = g
      ? t("set.funkGatewayGemerkt", { pk: pkShort(g.pubkey), datum: new Date(g.seit * 1000).toLocaleDateString(gebietsschema()) })
        + (g.kurs ? "" : t("set.funkGatewayNurGratis"))
      : t("set.funkGatewayKeins");
  }
  const vergessen = el("funk-gateway-vergessen") as HTMLButtonElement | null;
  if (vergessen) vergessen.disabled = !g;
  const wahl = el("ai-funk-wahl");
  if (wahl) wahl.style.display = g ? "" : "none";
  const haken = el("ai-funk") as HTMLInputElement | null;
  if (haken && !g) haken.checked = false;
}

export function wireFunkGateway(): void {
  zeigeFunkGateway();
  const suchen = el("funk-gateway-suchen");
  if (suchen) suchen.onclick = async () => {
    const liste = el("funk-gateway-liste");
    if (!liste) return;
    liste.textContent = t("set.funkGatewaySuche");
    try {
      const gateways = (await alleAngebote()).filter((c) => c.funkGateway);
      liste.replaceChildren();
      if (gateways.length === 0) {
        liste.textContent = t("set.funkGatewayKeineGefunden");
        return;
      }
      for (const c of gateways) {
        const b = document.createElement("button");
        b.className = "ghost";
        b.style.cssText = "width:auto;padding:6px 10px;margin:4px 6px 0 0";
        b.textContent = t("set.funkGatewayWahl", { pk: pkShort(c.pubkey) });
        b.onclick = async () => {
          try {
            if (!(await merkeFunkGateway(c))) return toast(t("set.funkGatewayUngeeignet"), true);
            toast(t("set.funkGatewayGespeichert"));
            zeigeFunkGateway();
          } catch (e) {
            toast(fehlerText(e), true);
          }
        };
        liste.appendChild(b);
      }
    } catch (e) {
      liste.textContent = fehlerText(e);
    }
  };
  const vergessen = el("funk-gateway-vergessen");
  if (vergessen) vergessen.onclick = async () => {
    await vergissFunkGateway().catch((e) => toast(fehlerText(e), true));
    zeigeFunkGateway();
  };
}
