/**
 * Kopfgelder am Issue (Schritt E10b1, Entscheidung E10 B, an Spur C übergeben 09.10.2026):
 * zeigen, anlegen, den Stand setzen. Ein Kopfgeld (38061, `kopfgeld.ts`) sagt einen Betrag in
 * sats, in SOL oder in beiden zu; bezahlt wird direkt vom Geldgeber an den, der es erledigt –
 * nichts wird verwahrt. Bezahlen per Klick seit E10b2 (`kopfgeld-zahlung.ts`).
 *
 * Der Stand kommt nur aus `kopfgelderZuIssue()` (je Geldgeber und Kennung der neueste);
 * anlegen und den Stand setzen nur der Geldgeber selbst über `signiere()`. Nur an öffentlichen
 * Issues – für private Räume gibt es keinen Baustein, dort bietet die Seite nichts an. Titel und
 * Beschreibung kommen von Fremden: nur DOM und `textContent`.
 */
import type { Kopfgeld, KopfgeldStand } from "@freedomstack/protocol";
import { t } from "../../i18n.js";
import { satsText, solText } from "../../preis-anzeige.js";
import { fehlerText } from "../../protokoll-texte.js";
import type { IssueZeile, RepoKarte } from "../../repo-ansicht.js";
import { bestaetige, dialog } from "../dialog.js";
import { ensurePool, frageBeiAutoren, solRpcUrl, signiere, state } from "../state.js";
import { toast } from "../ui.js";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, klasse?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (klasse) e.className = klasse;
  return e;
}

function knopf(text: string, tun: () => void): HTMLButtonElement {
  const b = el("button", text, "ghost mini kopfgeld-knopf");
  b.type = "button";
  b.addEventListener("click", tun);
  return b;
}

const STAND_TEXT: Record<KopfgeldStand, string> = {
  offen: "kopf.standOffen", vergeben: "kopf.standVergeben", erledigt: "kopf.standErledigt", zurueckgezogen: "kopf.standZurueck",
};

/** Betrag in beiden zugesagten Währungen – nur, was der Geldgeber zugesagt hat, nichts umgerechnet. */
export function kopfgeldBetrag(k: Pick<Kopfgeld, "msat" | "lamports">): string {
  return [k.msat !== undefined ? satsText(k.msat) : "", k.lamports !== undefined ? solText(k.lamports) : ""].filter(Boolean).join(" + ");
}

/**
 * Die Karte „Kopfgelder“ unter einem öffentlichen Issue – lädt die Kopfgelder selbst (38061 mit
 * `#e` = Issue) und zeichnet sich nach jeder Änderung neu.
 */
export function kopfgeldKarte(z: IssueZeile, k: RepoKarte, name: (pk: string) => string): HTMLElement {
  const karte = el("section", undefined, "kopfgelder");
  karte.setAttribute("aria-label", t("kopf.titel"));
  const zeichne = async (): Promise<void> => {
    const liste = el("div", t("kopf.lade"), "kopfgeld-liste mono-sm");
    const neu = knopf(t("kopf.aussetzen"), () => void setzeAus(z, k, zeichne));
    neu.classList.add("kopfgeld-neu");
    karte.replaceChildren(el("h4", t("kopf.titel"), "kopfgeld-titel"), liste, ...(state.keypair ? [neu] : []));
    try {
      const { KIND_KOPFGELD, kopfgelderZuIssue } = await import("@freedomstack/protocol");
      const events = await (await ensurePool()).query({ kinds: [KIND_KOPFGELD], "#e": [z.issue.id], limit: 200 });
      const kopfgelder = kopfgelderZuIssue(events, z.issue.id);
      liste.replaceChildren(...(kopfgelder.length
        ? kopfgelder.map((kg) => kopfgeldZeile(kg, z, name, zeichne))
        : [el("p", t("kopf.keine"), "muted")]));
    } catch (e) {
      liste.textContent = fehlerText(e);
    }
  };
  void zeichne();
  return karte;
}

function kopfgeldZeile(kg: Kopfgeld, z: IssueZeile, name: (pk: string) => string, neu: () => Promise<void>): HTMLElement {
  const zeile = el("div", undefined, "kopfgeld-zeile");
  zeile.dataset.stand = kg.stand;
  const kopf = el("div", undefined, "kopfgeld-kopf");
  kopf.append(el("b", kopfgeldBetrag(kg), "kopfgeld-betrag"), el("span", ` ${t(STAND_TEXT[kg.stand], { name: kg.an ? name(kg.an) : "" })}`, "kopfgeld-stand"));
  zeile.append(kopf, el("div", `${kg.titel} · ${t("kopf.von", { name: name(kg.geldgeber) })}`, "kopfgeld-titelzeile muted"));
  if (kg.beschreibung.trim()) zeile.append(el("div", kg.beschreibung, "kopfgeld-text"));
  // Den Stand setzt nur der Geldgeber – andere sehen ihn nur
  if (state.keypair?.pk === kg.geldgeber) {
    const aktionen = el("div", undefined, "kopfgeld-aktionen");
    if (kg.stand === "offen") aktionen.append(knopf(t("kopf.vergeben"), () => void vergib(kg, z, name, neu)));
    if (kg.stand === "vergeben") {
      // Bezahlen per Klick (E10b2): direkt an die Person, danach „erledigt“
      const zahlen = knopf(t("kopf.bezahlen"), () => void bezahle(kg, name, neu, zahlen));
      zahlen.classList.add("kopfgeld-bezahlen");
      aktionen.append(zahlen);
      aktionen.append(knopf(t("kopf.erledigt"), () => void setzeStand(kg, "erledigt", kg.an, neu)));
      aktionen.append(knopf(t("kopf.wiederOffen"), () => void setzeStand(kg, "offen", undefined, neu)));
    }
    if (kg.stand === "offen" || kg.stand === "vergeben") aktionen.append(knopf(t("kopf.zurueckziehen"), () => void setzeStand(kg, "zurueckgezogen", undefined, neu)));
    if (aktionen.childElementCount) zeile.append(aktionen);
  }
  return zeile;
}

/** Neues Kopfgeld am Issue – ein Betrag in sats, in SOL oder in beiden. */
async function setzeAus(z: IssueZeile, k: RepoKarte, neu: () => Promise<void>): Promise<void> {
  if (!state.keypair || !k.repo) return;
  const ganz = (s: unknown): number | undefined => {
    const n = Number(String(s ?? "").trim().replace(",", "."));
    return String(s ?? "").trim() && Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const w = await dialog({
    titel: t("kopf.aussetzen"), ok: t("kopf.aussetzenOk"), text: t("kopf.hinweis"),
    felder: [
      { art: "text", name: "titel", label: t("kopf.feldTitel"), wert: z.issue.betreff.slice(0, 200), pflicht: true },
      { art: "textarea", name: "text", label: t("kopf.feldText") },
      { art: "text", name: "sats", label: t("kopf.feldSats") },
      { art: "text", name: "sol", label: t("kopf.feldSol") },
    ],
    pruefe: (w) => {
      const sats = ganz(w.sats), sol = ganz(w.sol);
      if (sats === undefined && sol === undefined) return t("kopf.betragFehlt");
      if (sats !== undefined && !Number.isSafeInteger(sats)) return t("kopf.nurGanzeSats");
      return null;
    },
  });
  if (!w) return;
  const sats = ganz(w.sats), sol = ganz(w.sol);
  const kennung = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
  await veroeffentliche({
    kennung, titel: String(w.titel).trim(), beschreibung: String(w.text ?? ""), geldgeber: state.keypair.pk, stand: "offen",
    ...(sats !== undefined ? { msat: sats * 1000 } : {}), ...(sol !== undefined ? { lamports: Math.round(sol * 1e9) } : {}),
    issue: z.issue.id, repo: k.repo.adresse,
  }, t("kopf.ausgesetzt"), neu);
}

/** Vergeben an: wer am Issue beteiligt ist (Autorin, Kommentare) – nie man selbst. */
async function vergib(kg: Kopfgeld, z: IssueZeile, name: (pk: string) => string, neu: () => Promise<void>): Promise<void> {
  const kandidaten = [...new Set([z.issue.autor, ...z.kommentare.map((c) => c.autor)])].filter((pk) => pk !== kg.geldgeber);
  if (!kandidaten.length) { toast(t("kopf.niemand"), true); return; }
  const w = await dialog({
    titel: t("kopf.vergeben"), ok: t("kopf.vergebenOk"), text: t("kopf.vergebenText"),
    felder: [{ art: "wahl", name: "an", label: t("kopf.an"), optionen: kandidaten.map((pk) => ({ wert: pk, text: name(pk) })), wert: kandidaten[0], pflicht: true }],
  });
  const an = String(w?.an ?? "");
  if (!w || !kandidaten.includes(an)) return;
  await setzeStand(kg, "vergeben", an, neu);
}

/**
 * Bezahlen per Klick: einmal bestätigen, dann je Währung eine Zahlung aus der eigenen Wallet direkt an
 * die Person – nie von selbst wiederholt. Erst wenn alles bezahlt ist, steht das Kopfgeld auf „erledigt“.
 */
async function bezahle(kg: Kopfgeld, name: (pk: string) => string, neu: () => Promise<void>, knopf: HTMLButtonElement): Promise<void> {
  const an = kg.an;
  if (!an || !state.signer) return;
  const { bezahleKopfgeld, schonBezahlt } = await import("../../kopfgeld-zahlung.js");
  const { geheim } = await import("../tresor.js");
  const offen = schonBezahlt(kg, geheim);
  const rest = { ...(kg.msat !== undefined && !offen.msat ? { msat: kg.msat } : {}), ...(kg.lamports !== undefined && !offen.lamports ? { lamports: kg.lamports } : {}) };
  if (!(await bestaetige({ titel: t("kopf.bezahlenTitel"), text: t("kopf.bezahlenText", { betrag: kopfgeldBetrag(rest), name: name(an) }), ok: t("kopf.bezahlenOk") }))) return;
  knopf.disabled = true;
  try {
    const [{ zahle, parseProfileSafe }, { zahlschienen }, { solAdresseAusProfil }, { frageAdresseAn, gemerkteAdresse }, { frageRechnungAn }, { ketteAusRpc }, { veroeffentlicheDm }] = await Promise.all([
      import("@freedomstack/protocol"), import("../zahlschienen.js"), import("../../zap-zahlung.js"), import("../../trinkgeld-adresse.js"),
      import("../../ln-rechnung-anfrage.js"), import("../../wallet-standard.js"), import("./posteingang.js"),
    ]);
    const pool = await ensurePool();
    const signer = state.signer;
    // Profil auch an den Schreib-Relays der Person (5.4b); das neueste gilt
    const profil = (await frageBeiAutoren({ kinds: [0], authors: [an], limit: 1 })).sort((a, b) => b.created_at - a.created_at)[0];
    const kette = ketteAusRpc(await solRpcUrl());
    await bezahleKopfgeld(kg, {
      lud16: async () => (profil ? parseProfileSafe(profil).lud16 ?? "" : ""),
      frageRechnung: async (msat) => {
        toast(t("zahl.frageRechnung", { name: name(an) }));
        return frageRechnungAn({ pool, signer, empfaenger: an, betragMsat: msat, sende: veroeffentlicheDm });
      },
      solAdresse: async () => gemerkteAdresse(geheim, an, kette)
        ?? await frageAdresseAn({ pool, speicher: geheim, signer, empfaenger: an, kette, sende: veroeffentlicheDm }),
      solAusProfil: async () => {
        const oeffentlich = profil ? solAdresseAusProfil(profil.content) : "";
        return oeffentlich && await bestaetige({ titel: t("kopf.bezahlenTitel"), text: t("zahl.oeffentlicheAdresseFrage", { name: name(an) }), ok: t("zahl.trotzdemDorthin") }) ? oeffentlich : null;
      },
      zahle: (a) => zahle(zahlschienen(), a),
      speicher: geheim,
    });
    toast(t("kopf.bezahlt", { name: name(an) }));
    await setzeStand(kg, "erledigt", an, neu);
  } catch (e) {
    // Was schon bezahlt ist, bleibt gemerkt – ein neuer Klick zahlt nur den Rest
    toast(t("kopf.bezahlenFehler", { fehler: fehlerText(e) }), true);
    knopf.disabled = false;
  }
}

async function setzeStand(kg: Kopfgeld, stand: KopfgeldStand, an: string | undefined, neu: () => Promise<void>): Promise<void> {
  const { zeit: _zeit, an: _an, ...rest } = kg;
  void _zeit; void _an;
  await veroeffentliche({ ...rest, stand, ...(an ? { an } : {}) }, t("kopf.gesetzt", { stand: t(STAND_TEXT[stand], { name: "" }).trim() }), neu);
}

/** Nur der Geldgeber, signiert, öffentlich – wie das Issue selbst. */
async function veroeffentliche(k: Omit<Kopfgeld, "zeit">, meldung: string, neu: () => Promise<void>): Promise<void> {
  try {
    const { baueKopfgeld } = await import("@freedomstack/protocol");
    await (await ensurePool()).publish(await signiere(baueKopfgeld(k)));
    toast(meldung);
    await neu();
  } catch (e) {
    toast(fehlerText(e), true);
  }
}
