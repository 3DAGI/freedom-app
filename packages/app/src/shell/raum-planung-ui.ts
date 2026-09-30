/**
 * Umfragen und Termine im Kanal eines privaten Raums (Sammlung Neuordnung,
 * B-15b). Über dem Verlauf stehen die Umfragen und Termine des Kanals: eine
 * Antwort antippen stimmt ab (bei Mehrfachwahl dazu oder weg), bei Terminen
 * zusagen, vielleicht oder absagen. Anlegen über zwei Knöpfe neben dem
 * Eingabefeld – nur, wer in den Kanal schreiben darf.
 *
 * Alles geht nur als inneres Event in die MLS-Gruppe (`mlsSendeEvent()`),
 * gezählt wird nur über `raumUmfragen()`/`raumTermine()`; gezeigt nur als
 * Text (Fremddaten).
 */
import {
  type RaumTermin, type RaumUmfrage, type TerminStatus, raumStimme, raumTermin, raumTerminAntwort, raumTermine, raumUmfrage, raumUmfragen,
} from "@freedomstack/protocol";
import { gebietsschema, t } from "../i18n.js";
import { fehlerText } from "../protokoll-texte.js";
import { TERMIN_DAUERN, UMFRAGE_ENDEN, anteile, antwortenAus, neueWahl, pruefeUmfrage, terminAus, terminWann, umfrageEnde } from "../planung-ansicht.js";
import { bestaetige, dialog } from "./dialog.js";
import { mlsSendeEvent } from "./mls-konto.js";
import { type PrivaterRaum, loescheImRaum } from "./raum-mls.js";
import { toast } from "./ui.js";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, klasse?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (klasse) e.className = klasse;
  return e;
}

function knopf(text: string, klasse: string, tun: () => void): HTMLButtonElement {
  const b = el("button", text);
  b.className = `ghost mini ${klasse}`;
  b.type = "button";
  b.addEventListener("click", tun);
  return b;
}

async function senden(tun: () => Promise<boolean>, neu: () => void): Promise<void> {
  try {
    if (!(await tun())) return toast(t("komm.nichtGesendet"), true);
    neu();
  } catch (e) {
    toast(fehlerText(e), true);
  }
}

/** Löschen: der Autor seine, ein Moderator jede – wie bei Nachrichten. */
function loeschKnopf(raum: PrivaterRaum, id: string, von: string, neu: () => void): HTMLButtonElement[] {
  if (von !== raum.ich && !raum.admins.includes(raum.ich)) return [];
  return [knopf(t("komm.loeschen"), "planung-loeschen", async () => {
    if (!(await bestaetige({ titel: t("raum.planungLoeschen"), text: t("raum.planungLoeschenText"), ok: t("komm.loeschen"), gefahr: true }))) return;
    await senden(() => loescheImRaum(raum, id), neu);
  })];
}

function umfrageKarte(raum: PrivaterRaum, u: RaumUmfrage, name: (pk: string) => string, neu: () => void): HTMLElement {
  const karte = el("section", undefined, "planung-karte");
  karte.dataset.umfrage = u.id;
  const kopf = el("div", t(u.mehrfach ? "raum.umfrageMehrfachVon" : "raum.umfrageVon", { name: name(u.von) }), "planung-kopf mono-sm muted");
  const frage = el("h4", u.frage, "planung-frage");
  const liste = el("div", undefined, "planung-optionen");
  const prozent = anteile(u);
  u.optionen.forEach((o, i) => {
    const b = knopf("", "planung-option", () => void senden(() => mlsSendeEvent(raum.gruppe, raumStimme(raum.gruppe, u.id, neueWahl(u, o.id))), neu));
    b.disabled = u.beendet;
    b.setAttribute("aria-pressed", String(!!u.meine?.includes(o.id)));
    const balken = el("span", undefined, "planung-balken");
    balken.style.width = `${prozent[i]}%`;
    b.append(balken, el("span", o.text, "planung-option-text"), el("span", t("raum.umfrageStimmen", { n: o.stimmen }), "planung-zahl mono-sm"));
    liste.append(b);
  });
  const fuss = el("div", [
    t("raum.umfrageTeilnehmer", { n: u.teilnehmer }),
    u.endet === undefined ? "" : t(u.beendet ? "raum.umfrageBeendet" : "raum.umfrageEndet", { wann: new Date(u.endet * 1000).toLocaleString(gebietsschema()) }),
  ].filter(Boolean).join(" · "), "planung-fuss mono-sm muted");
  fuss.append(...loeschKnopf(raum, u.id, u.von, neu));
  karte.append(kopf, frage, liste, fuss);
  return karte;
}

const ANTWORTEN: [TerminStatus, string, keyof Pick<RaumTermin, "zusagen" | "vielleicht" | "absagen">][] = [
  ["accepted", "raum.terminZusagen", "zusagen"], ["tentative", "raum.terminVielleicht", "vielleicht"], ["declined", "raum.terminAbsagen", "absagen"],
];

function terminKarte(raum: PrivaterRaum, termin: RaumTermin, name: (pk: string) => string, neu: () => void): HTMLElement {
  const karte = el("section", undefined, "planung-karte");
  karte.dataset.termin = termin.id;
  const teile: HTMLElement[] = [
    el("div", t("raum.terminVon", { name: name(termin.von) }), "planung-kopf mono-sm muted"),
    el("h4", termin.titel, "planung-frage"),
    el("div", terminWann(termin, gebietsschema()), "planung-wann"),
  ];
  if (termin.ort) teile.push(el("div", t("raum.terminOrt", { ort: termin.ort }), "planung-ort mono-sm"));
  if (termin.text) teile.push(el("p", termin.text, "planung-text"));
  const antworten = el("div", undefined, "planung-antworten");
  for (const [status, text, feld] of ANTWORTEN) {
    const b = knopf(t(text, { n: termin[feld] }), "planung-antwort", () => void senden(() => mlsSendeEvent(raum.gruppe, raumTerminAntwort(raum.gruppe, termin, status)), neu));
    b.setAttribute("aria-pressed", String(termin.meine === status));
    antworten.append(b);
  }
  const fuss = el("div", undefined, "planung-fuss mono-sm muted");
  fuss.append(...loeschKnopf(raum, termin.id, termin.von, neu));
  karte.append(...teile, antworten, fuss);
  return karte;
}

/** Umfragen und Termine des Kanals über dem Verlauf – ohne welche bleibt der Kasten weg. */
export function zeigePlanung(box: HTMLElement, raum: PrivaterRaum, kanal: string, name: (pk: string) => string, neu: () => void): void {
  const umfragen = raumUmfragen(raum.gruppe, raum.ereignisse, raum, { ich: raum.ich }).filter((u) => u.kanal === kanal);
  const termine = raumTermine(raum.gruppe, raum.ereignisse, raum, { ich: raum.ich }).filter((x) => x.kanal === kanal);
  box.replaceChildren(...termine.map((x) => terminKarte(raum, x, name, neu)), ...umfragen.map((u) => umfrageKarte(raum, u, name, neu)));
  box.classList.toggle("hidden", box.children.length === 0);
}

const UMFRAGE_FEHLER = { frage: "raum.umfrageFehlerFrage", zahl: "raum.umfrageFehlerZahl", lang: "raum.umfrageFehlerLang", doppelt: "raum.umfrageFehlerDoppelt" } as const;

/** Neue Umfrage im Kanal (Dialog, dann in die Gruppe). */
export async function neueUmfrage(raum: PrivaterRaum, kanal: string, neu: () => void): Promise<void> {
  const w = await dialog({
    titel: t("raum.umfrageNeu"), ok: t("raum.umfrageSenden"),
    felder: [
      { art: "text", name: "frage", label: t("raum.umfrageFrage"), pflicht: true },
      { art: "textarea", name: "antworten", label: t("raum.umfrageAntworten"), pflicht: true },
      { art: "mehrfach", name: "mehrfach", label: t("raum.umfrageArt"), optionen: [{ wert: "ja", text: t("raum.umfrageMehrfach") }] },
      { art: "wahl", name: "ende", label: t("raum.umfrageEnde"), wert: "0", optionen: UMFRAGE_ENDEN.map((h) => ({ wert: String(h), text: h ? t("raum.umfrageStunden", { n: h }) : t("raum.umfrageOhneEnde") })) },
    ],
    pruefe: (w) => {
      const f = pruefeUmfrage(String(w.frage ?? ""), antwortenAus(String(w.antworten ?? "")));
      return f ? t(UMFRAGE_FEHLER[f]) : null;
    },
  });
  if (!w) return;
  await senden(() => mlsSendeEvent(raum.gruppe, raumUmfrage(raum.gruppe, {
    kanal, frage: String(w.frage), optionen: antwortenAus(String(w.antworten)), mehrfach: (w.mehrfach as string[]).includes("ja"), endet: umfrageEnde(String(w.ende)),
  })), neu);
}

const TERMIN_FEHLER = { datum: "raum.terminFehlerDatum", uhrzeit: "raum.terminFehlerUhrzeit", dauer: "raum.terminFehlerDauer" } as const;

/** Neuer Termin im Kanal (Dialog, dann in die Gruppe). */
export async function neuerTermin(raum: PrivaterRaum, kanal: string, neu: () => void): Promise<void> {
  const w = await dialog({
    titel: t("raum.terminNeu"), ok: t("raum.terminSenden"),
    felder: [
      { art: "text", name: "titel", label: t("raum.terminTitel"), pflicht: true },
      { art: "text", name: "datum", label: t("raum.terminDatum"), pflicht: true, typ: "date" },
      { art: "text", name: "uhrzeit", label: t("raum.terminUhrzeit"), typ: "time" },
      { art: "wahl", name: "dauer", label: t("raum.terminDauer"), wert: "60", optionen: TERMIN_DAUERN.map((m) => ({ wert: String(m), text: m ? t("raum.terminMinuten", { n: m }) : t("raum.terminOhneEnde") })) },
      { art: "text", name: "ort", label: t("raum.terminOrtFeld") },
      { art: "textarea", name: "text", label: t("raum.terminBeschreibung") },
    ],
    pruefe: (w) => {
      const z = terminAus({ datum: String(w.datum ?? ""), uhrzeit: String(w.uhrzeit ?? ""), dauer: String(w.dauer ?? "0") });
      return "fehler" in z ? t(TERMIN_FEHLER[z.fehler]) : null;
    },
  });
  if (!w) return;
  const z = terminAus({ datum: String(w.datum), uhrzeit: String(w.uhrzeit ?? ""), dauer: String(w.dauer ?? "0") });
  if ("fehler" in z) return;
  const zeitzone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  await senden(() => mlsSendeEvent(raum.gruppe, raumTermin(raum.gruppe, {
    kanal, titel: String(w.titel), ...z, ort: String(w.ort ?? "") || undefined, text: String(w.text ?? "") || undefined,
    zeitzone: typeof z.beginn === "number" ? zeitzone : undefined,
  })), neu);
}
