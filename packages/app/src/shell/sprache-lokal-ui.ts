/**
 * Karte „Text aus Sprache auf diesem Gerät“ in Einstellungen › Geräte (Sammlung B-38c3): Adresse eines whisper-server
 * auf diesem Rechner eintragen, „prüfen und merken“ fragt ihn erst dann (`pruefeSprachServer()`) – gemerkt wird nur eine
 * Adresse, die geantwortet hat. Danach gehen „Als Text“ und Diktieren dorthin statt zum Knoten.
 */
import { lokaleKiAdresse } from "@freedomstack/protocol";
import { t } from "../i18n.js";
import { LS_SPRACHE_LOKAL, SPRACHE_LOKAL_STANDARD, lokaleSprachAdresse, pruefeSprachServer } from "../sprache-lokal.js";
import { zeigeDiktieren } from "./diktieren-ui.js";

const STAND_TEXT = { laedt: "set.spracheLokalLaedt", "nicht-erreichbar": "set.spracheLokalNichtErreichbar", fremd: "set.spracheLokalFremd" } as const;

export function wireSpracheLokal(): void {
  const feld = document.getElementById("sprache-lokal-adresse") as HTMLInputElement | null;
  const pruefen = document.getElementById("sprache-lokal-pruefen") as HTMLButtonElement | null;
  const vergessen = document.getElementById("sprache-lokal-vergessen") as HTMLButtonElement | null;
  const stand = document.getElementById("sprache-lokal-stand");
  if (!feld || !pruefen || !vergessen || !stand) return;
  const gemerkt = lokaleSprachAdresse(localStorage);
  feld.value = gemerkt ?? "";
  vergessen.hidden = !gemerkt;
  pruefen.addEventListener("click", async () => {
    const roh = feld.value.trim() || SPRACHE_LOKAL_STANDARD;
    pruefen.disabled = true;
    stand.textContent = t("set.spracheLokalFragt");
    try {
      const s = await pruefeSprachServer(roh);
      const adresse = lokaleKiAdresse(roh) ?? roh;
      if (s !== "bereit") {
        stand.textContent = t(STAND_TEXT[s], { adresse });
        return;
      }
      localStorage.setItem(LS_SPRACHE_LOKAL, adresse);
      feld.value = adresse;
      vergessen.hidden = false;
      stand.textContent = t("set.spracheLokalBereit", { adresse });
      zeigeDiktieren();
    } finally {
      pruefen.disabled = false;
    }
  });
  vergessen.addEventListener("click", () => {
    localStorage.removeItem(LS_SPRACHE_LOKAL);
    feld.value = "";
    vergessen.hidden = true;
    stand.textContent = t("set.spracheLokalVergessenOk");
    zeigeDiktieren();
  });
}
