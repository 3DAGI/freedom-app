/**
 * Kontostand oben im Wallet (C-50a): Die Stände kommen von dort, wo die App sie ohnehin holt
 * (NWC, Browser-Wallet, eingebaute Wallet) – hier nur gesammelt und gezeigt, nichts zusätzlich
 * abgefragt, nichts gespeichert. Rechnen tut `gesamtStand()`.
 */
import { gesamtStand } from "../wallet-gesamt.js";
import { gebietsschema, t } from "../i18n.js";
import { aktuellerKurs } from "./marktkurs.js";

type Konto = "ln" | "solBrowser" | "solEingebaut";
/** `undefined`: kein solches Konto, `null`: Konto da, Stand gerade nicht abrufbar. */
const stand: Partial<Record<Konto, number | null>> = {};

export function merkeStand(konto: Konto, wert: number | null | undefined): void {
  if (wert === undefined) delete stand[konto];
  else stand[konto] = wert;
  zeigeGesamt();
}

/** „Tauschen“ und „Hinterlegen“ öffnen ihren Reiter (Empfangen und Senden verdrahten `wireEmpfangen()`/`wireSenden()`). */
export function wireWalletAktionen(): void {
  document.querySelectorAll<HTMLElement>("#wallet-gesamt [data-subtab-ziel]").forEach((b) => {
    b.addEventListener("click", () => document.querySelector<HTMLElement>(`[data-subtab-group="wallet"] [data-subtab="${b.dataset.subtabZiel}"]`)?.click());
  });
  zeigeGesamt();
}

export function zeigeGesamt(): void {
  const zahl = document.getElementById("wg-zahl");
  const einheit = document.getElementById("wg-einheit");
  const zusatz = document.getElementById("wg-zusatz");
  if (!zahl || !einheit || !zusatz) return;
  const sol = (["solBrowser", "solEingebaut"] as const).filter((k) => k in stand);
  const bekannt = sol.map((k) => stand[k]).filter((x): x is number => typeof x === "number");
  const kurs = aktuellerKurs();
  // Stand der Solana-Zeile (C-50b): Browser-Wallet und eingebaute zusammen, ohne Stand „—“
  const solStand = document.getElementById("sol-stand");
  if (solStand) solStand.textContent = bekannt.length ? `${(bekannt.reduce((a, b) => a + b, 0) / 1e9).toLocaleString(gebietsschema(), { maximumFractionDigits: 4 })} SOL` : "—";
  const g = gesamtStand({
    lnMsat: "ln" in stand ? stand.ln : undefined,
    solLamports: sol.length === 0 ? undefined : bekannt.length ? bekannt.reduce((a, b) => a + b, 0) : null,
    fehlt: bekannt.length < sol.length && bekannt.length > 0,
  }, kurs);
  if (!g) {
    zahl.textContent = "—";
    einheit.textContent = "";
    zusatz.textContent = t("wallet.keinKonto");
    return;
  }
  zahl.textContent = g.betrag;
  einheit.textContent = g.einheit;
  zusatz.textContent = [g.zusatz, g.summe ? "" : t("wallet.ohneKursSumme"), g.vollstaendig ? "" : t("wallet.unvollstaendig")]
    .filter(Boolean).join(" · ");
}
