/**
 * Mein Knoten (Sammlung B-8c, L1 A): den eigenen Knoten koppeln – den
 * Kopplungscode aus `npm run koppeln` scannen oder einfügen. Er liegt nur in
 * `geheim` (`freedom.knoten.kopplung`, mit Tresor im Tresor) und nie in der
 * Sicherung (`SICHERUNG_NIE`). Anfragen an diesen Knoten tragen im
 * versiegelten Kern den Nachweis (`mitBesitzerNachweis()`, in `buildJobEvent()`)
 * und zahlen nichts – der Knoten rechnet sie gratis.
 *
 * Entkoppeln vergisst den Code nur auf diesem Gerät; ungültig für alle Geräte
 * wird er erst, wenn der Knoten ein neues Geheimnis erzeugt
 * (`npm run koppeln -- --neu`). Nur DOM und `textContent`.
 */
import { type Kopplung, kopplungscode, leseKopplungscode } from "@freedomstack/protocol";
import { t } from "../i18n.js";
import { bestaetige, dialog } from "./dialog.js";
import { geheim } from "./tresor.js";
import { pkShort } from "../shell-logic.js";
import { toast } from "./ui.js";

export const LS_KOPPLUNG = "freedom.knoten.kopplung";

/** Die Kopplung dieses Geräts – streng gelesen, sonst null. */
export function meineKopplung(): Kopplung | null {
  return leseKopplungscode(geheim.getItem(LS_KOPPLUNG) ?? "");
}

/** Gekoppelt mit genau diesem Knoten? Dann gehört der Nachweis in den Kern der Anfrage. */
export function kopplungFuer(knoten: string): Kopplung | null {
  const k = meineKopplung();
  return k && k.knoten === knoten ? k : null;
}

function zeigeStatus(): void {
  const k = meineKopplung();
  const status = document.getElementById("knoten-status");
  if (status) status.textContent = k ? t("set.knotenGekoppelt", { knoten: pkShort(k.knoten) }) : t("set.knotenNicht");
  const koppeln = document.getElementById("knoten-koppeln");
  if (koppeln) koppeln.textContent = t(k ? "set.knotenNeu" : "set.knotenKoppeln");
  document.getElementById("knoten-entkoppeln")?.toggleAttribute("hidden", !k);
}

async function koppeln(): Promise<void> {
  const w = await dialog({
    titel: t("set.knotenKoppeln"), text: t("set.knotenKoppelnText"), ok: t("set.knotenKoppeln"),
    felder: [{ art: "text", name: "code", label: t("set.knotenCode"), pflicht: true, mono: true, scannen: true, verdeckt: true }],
    pruefe: (v) => (leseKopplungscode(String(v.code ?? "")) ? null : t("set.knotenCodeFalsch")),
  });
  const k = w ? leseKopplungscode(String(w.code ?? "")) : null;
  if (!k) return;
  const alt = meineKopplung();
  if (alt && alt.knoten !== k.knoten
    && !await bestaetige({ titel: t("set.knotenKoppeln"), text: t("set.knotenErsetzen", { knoten: pkShort(alt.knoten) }), ok: t("set.knotenKoppeln") })) return;
  await geheim.setItem(LS_KOPPLUNG, kopplungscode(k));
  zeigeStatus();
  toast(t("set.knotenGekoppeltToast"));
}

async function entkoppeln(): Promise<void> {
  if (!await bestaetige({ titel: t("set.knotenEntkoppeln"), text: t("set.knotenEntkoppelnText"), ok: t("set.knotenEntkoppeln"), gefahr: true })) return;
  await geheim.removeItem(LS_KOPPLUNG);
  zeigeStatus();
}

/** Karte „Mein Knoten“ in Settings → Geräte (einmal beim Start). */
export function wireMeinKnoten(): void {
  document.getElementById("knoten-koppeln")?.addEventListener("click", () => void koppeln());
  document.getElementById("knoten-entkoppeln")?.addEventListener("click", () => void entkoppeln());
  zeigeStatus();
}
