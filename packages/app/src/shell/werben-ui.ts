/**
 * Earn › Werben: eigene Adresse der App (Schritt 11.2a). Setzen nur mit
 * gültiger https-Adresse (`pruefeEigeneAdresse()`); danach trägt der Werbelink
 * (samt QR) diese Adresse. „Prüfen“ fragt die Adresse ab – nur auf Knopfdruck,
 * der Server sieht dabei die eigene IP – und sagt, ob dort eine bestätigte
 * Version liegt (5.2) und wohin der Hosting-Anteil geht (5.3a).
 */
import { t } from "../i18n.js";
import { LS_EIGENE_ADRESSE, eigeneBasis, pruefeEigeneAdresse, pruefeKopie, type KopieErgebnis } from "../eigene-adresse.js";
import { echtheitText } from "../protokoll-texte.js";
import { TRUSTED_SIGNERS, ladeManifeste } from "../release-signierer.js";
import { ensurePool } from "./state.js";
import { updateReferralLink } from "./tabs/earn.js";
import { $ } from "./ui.js";

const FALL = { leer: "earn.adresseLeer", ungueltig: "earn.adresseUngueltig", "kein-https": "earn.adresseKeinHttps", zugangsdaten: "earn.adresseZugang", lokal: "earn.adresseLokal" } as const;

/** Zwei Zeilen: was dort liegt, und wohin der Hosting-Anteil geht. */
function ergebnisZeilen(e: KopieErgebnis): HTMLElement[] {
  const kopie = document.createElement("div");
  if (e.pruefung) {
    kopie.textContent = t("earn.kopieDort", { text: echtheitText(e.pruefung, "freedom.html") });
    kopie.className = e.pruefung.status === "echt" ? "ok" : e.pruefung.status === "abweichend" ? "err" : "warn";
  } else {
    kopie.textContent = t(e.fall === "zu-gross" ? "earn.kopieZuGross" : "earn.kopieNichtErreichbar");
    kopie.className = "warn";
  }
  const hosting = document.createElement("div");
  hosting.textContent = e.hosting
    ? t("earn.hostingDort", { ziel: [e.hosting.lud16, e.hosting.sol].filter(Boolean).join(" · ") })
    : t("earn.hostingFehlt");
  return [kopie, hosting];
}

export function wireEigeneAdresse(): void {
  const feld = $("#werben-adresse") as HTMLInputElement | null;
  const setzen = $("#werben-adresse-setzen");
  const pruefen = $("#werben-adresse-pruefen") as HTMLButtonElement | null;
  const status = $("#werben-adresse-status");
  if (!feld || !setzen || !pruefen || !status) return;
  feld.value = eigeneBasis(localStorage) ?? "";
  const melde = (text: string, klasse = "") => { status.textContent = text; status.className = `mono-sm ${klasse}`; };

  setzen.addEventListener("click", () => {
    if (!feld.value.trim()) {
      localStorage.removeItem(LS_EIGENE_ADRESSE);
      melde(t("earn.adresseZurueck"));
    } else {
      const r = pruefeEigeneAdresse(feld.value);
      if (!r.ok) return melde(t(FALL[r.fall]), "err");
      localStorage.setItem(LS_EIGENE_ADRESSE, r.basis);
      feld.value = r.basis;
      melde(t("earn.adresseGesetzt"), "ok");
    }
    updateReferralLink();
  });

  // Nur auf Knopfdruck: die Abfrage nennt dem Server die eigene IP
  pruefen.addEventListener("click", async () => {
    const basis = eigeneBasis(localStorage);
    if (!basis) return melde(t("earn.adresseErst"), "warn");
    pruefen.disabled = true;
    melde(t("earn.adressePruefe"));
    try {
      const manifeste = await ensurePool().then(ladeManifeste).catch(() => []);
      const e = await pruefeKopie(basis, manifeste, TRUSTED_SIGNERS);
      status.className = "mono-sm";
      status.replaceChildren(...ergebnisZeilen(e));
    } finally {
      pruefen.disabled = false;
    }
  });
}
