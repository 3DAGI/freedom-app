/**
 * Pruefauftraege (Schritt 5.6c): Jemand aus meinem Netz hat mich als Pruefer
 * einer Reklamation genannt. Die Reklamation kommt versiegelt in meinen
 * Posteingang (tabs/kommunikation.ts reicht sie hierher), ich lese Grund,
 * Notiz und – wenn der Kunde zugestimmt hat – Frage und Antwort und gebe ein
 * Urteil. Es geht versiegelt nur an den Kunden (seinen Sitzungsschluessel)
 * und den Provider und gilt nur zwischen ihnen.
 *
 * Der Inhalt bleibt nur im Speicher: Er traegt Klartext aus dem Auftrag eines
 * anderen. Nach dem Neuladen holt der Posteingang ihn wieder von den Relays;
 * gemerkt werden nur die IDs beantworteter Auftraege.
 */
import type { Dispute, NostrEvent, Resolution } from "@freedomstack/protocol";
import { t } from "../i18n.js";
import { fehlerText } from "../protokoll-texte.js";
import { pkShort } from "../shell-logic.js";
import { GRUND_TEXT, LS_PRUEFUNGEN_ERLEDIGT, erstattungFuer, leseErledigt, pruefauftragAus } from "../streitfall.js";
import { alsGeraet, angebotVon, ensurePool, state } from "./state.js";
import { dialog } from "./dialog.js";
import { toast } from "./ui.js";

const offen = new Map<string, Dispute & { id: string }>();

const erledigt = () => leseErledigt(localStorage.getItem(LS_PRUEFUNGEN_ERLEDIGT));

/** Posteingang: ist der Umschlag ein Pruefauftrag an mich, merken (aus tabs/kommunikation.ts). */
export async function alsPruefauftrag(w: NostrEvent): Promise<null> {
  const signer = state.signer;
  if (!signer || alsGeraet()) return null;
  const { openPrivateKundenEvent } = await import("@freedomstack/protocol");
  const r = await openPrivateKundenEvent(w, signer).catch(() => null);
  if (!r?.ok) return null;
  const d = pruefauftragAus(r.request, signer.publicKey());
  if (d && !offen.has(d.id) && !erledigt().includes(d.id)) {
    offen.set(d.id, d);
    zeigePruefauftraege();
  }
  return null;
}

function el(tag: string, text?: string, klasse?: string): HTMLElement {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (klasse) e.className = klasse;
  return e;
}

const URTEILE: Array<[Resolution, string]> = [
  ["erstattet", "agent.knopfKunde"],
  ["bestaetigt", "agent.knopfProvider"],
  ["geteilt", "agent.knopfTeilen"],
  ["unentschieden", "agent.knopfUnklar"],
];

/** Karte „Prüfaufträge“ (textContent) – verborgen, solange keiner offen ist. */
export function zeigePruefauftraege(): void {
  const box = document.getElementById("pruefauftraege");
  const liste = document.getElementById("pruefauftraege-liste");
  if (!box || !liste) return;
  box.classList.toggle("hidden", offen.size === 0);
  liste.replaceChildren(...[...offen.values()].map((d) => {
    const z = el("div", undefined, "usage-row");
    z.style.display = "block";
    z.append(el("div", t("agent.auftragZeile", { provider: pkShort(d.providerPubkey), grund: t(GRUND_TEXT[d.reason]), sats: Math.floor(d.amountMsat / 1000) })));
    if (d.note) z.append(el("div", t("agent.auftragNotiz", { notiz: d.note.slice(0, 500) }), "muted"));
    if (d.material) {
      const det = el("details");
      det.append(el("summary", t("agent.frageUndAntwort")), el("div", t("agent.auftragFrage", { text: d.material.frage })), el("div", t("agent.auftragAntwort", { text: d.material.antwort })));
      z.append(det);
    } else {
      z.append(el("div", t("agent.ohneMaterial"), "muted"));
    }
    for (const [ergebnis, schluessel] of URTEILE) {
      const b = el("button", t(schluessel), "ghost") as HTMLButtonElement;
      b.style.cssText = "width:auto;padding:3px 8px;margin:4px 4px 0 0";
      b.addEventListener("click", () => void urteile(d, ergebnis));
      z.append(b);
    }
    return z;
  }));
}

/** Urteil versiegelt an Kunde und Provider – nur zwischen ihnen. */
async function urteile(d: Dispute & { id: string }, ergebnis: Resolution): Promise<void> {
  const signer = state.signer;
  if (!signer || alsGeraet()) return;
  // Dialog statt prompt() (C-1e): die Begründung darf leer bleiben, Abbrechen sendet nichts
  const w = await dialog({
    titel: t("agent.urteilTitel"),
    felder: [{ art: "textarea", name: "notiz", label: t("agent.begruendungFrage") }],
    ok: t("agent.urteilSenden"),
  });
  if (!w) return;
  const notiz = String(w.notiz ?? "");
  try {
    const { buildPrivateUrteil, buildResolution } = await import("@freedomstack/protocol");
    const urteil = buildResolution({
      jobId: d.jobId, reviewerPubkey: signer.publicKey(), resolution: ergebnis, refundMsat: erstattungFuer(ergebnis, d.amountMsat), note: notiz.slice(0, 500),
    });
    const { wraps } = await buildPrivateUrteil({
      urteil, prueferSigner: signer, kundePk: d.customerPubkey, providerPk: d.providerPubkey,
      providerPowBits: (await angebotVon(d.providerPubkey).catch(() => undefined))?.powBits ?? 0,
    });
    const pool = await ensurePool();
    for (const w of wraps) await pool.publish(w);
    localStorage.setItem(LS_PRUEFUNGEN_ERLEDIGT, JSON.stringify([...erledigt(), d.id]));
    offen.delete(d.id);
    zeigePruefauftraege();
    toast(t("agent.urteilGesendet"));
  } catch (e) {
    toast(fehlerText(e), true);
  }
}
