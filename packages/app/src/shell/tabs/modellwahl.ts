/**
 * Agent › Modellwahl: Dropdown und Popover, Gruppe „Mein Knoten“ (B-9a),
 * „Dieses Gerät“ (B-1) – Namen nur als Text.
 *
 * Aus tabs/agent.ts verschoben (C-5d) – wörtlich, ohne Logikänderung.
 */
import { lokaleKiAdresse, type LokalesModell } from "@freedomstack/protocol";
import { t } from "../../i18n.js";
import { fehlerText } from "../../protokoll-texte.js";
import { iconEl } from "../../icons.js";
import { LS_LOKAL_AKTIV, lokalAktiv, lokaleAdresse, lokaleModelle, lokalerWahlwert, lokalesModellAus, setzeLokaleAdresse } from "../../ki-lokal.js";
import { dialog } from "../dialog.js";
import { pkShort } from "../../shell-logic.js";
import { ausMsat } from "../../preis-anzeige.js";
import { tierFuerListe } from "../../gratis-kontingent.js";
import { angebotVon, findProviders } from "../state.js";
import { aktualisiereKurs, aktuellerKurs } from "../marktkurs.js";
import { meineKopplung } from "../mein-knoten.js";
import { knotenModellAus, knotenWahlwert } from "../../knoten-wahl.js";
import { $, toast, el } from "../ui.js";
import { katalogRangJetzt } from "./agent-netz.js";
import { updateTokenEstimate } from "./agent-anzeige.js";
import { zeigeWerkzeugPreise } from "./agent-eingabe.js";

// ------------------------------------------------------------- Modell-Dropdown

/** Fuellt das Modell-Dropdown mit den Modellen der besten Provider des Tiers. */
export async function refreshModelDropdown(): Promise<void> {
  const sel = $("#ai-model") as HTMLInputElement | null;
  const btn = $("#ai-model-btn") as HTMLButtonElement | null;
  if (!sel || !btn) return;
  const current = sel.value;
  try {
    const [providers] = await Promise.all([findProviders(tierFuerListe(($("#ai-tier") as HTMLSelectElement).value)), aktualisiereKurs()]);
    // modelle + preise der top-provider sammeln (dedupe, haeufigkeit)
    const counts = new Map<string, { count: number; priceMsat: number; tools: Set<string> }>();
    for (const p of providers.slice(0, 5)) {
      for (const m of p.caps.models ?? []) {
        const cur = counts.get(m) ?? { count: 0, priceMsat: p.caps.textRatePerKTokenMsat ?? 1500, tools: new Set((p.caps.tools ?? []).map((t: any) => t.name ?? String(t))) };
        cur.count += 1;
        counts.set(m, cur);
      }
    }
    // Reihenfolge (5.7): erst, was in abonnierten Katalogen steht, dann nach
    // Zahl der Provider – keine feste Vorliebe des Projekts.
    const rang = katalogRangJetzt();
    const inKatalogen = (m: string) => rang.get(m.toLowerCase()) ?? 0;
    const entries = [...counts.entries()].sort((a, b) => inKatalogen(b[0]) - inKatalogen(a[0]) || b[1].count - a[1].count);
    (window as unknown as { __modelCatalog?: unknown }).__modelCatalog = entries;
    // Kosten je Werkzeug (8.7): guenstigstes Angebot, in sats und SOL
    zeigeWerkzeugPreise(providers.map((p) => p.caps));

    // Popover-Inhalt: Karten mit Name, Speed-Klasse, Preis/1k tokens, Provider-Count
    const pop = $("#model-popover");
    if (pop) {
      const speedOf = (m: string): { label: string; cls: string } => {
        if (m.includes("nemotron")) return { label: t("agent.schnell"), cls: "fast" };
        if (/(\d+)b/.test(m)) {
          const size = Number(RegExp.$1);
          if (size <= 8) return { label: t("agent.schnell"), cls: "fast" };
          if (size <= 15) return { label: t("agent.mittel"), cls: "mid" };
          return { label: t("agent.tief"), cls: "deep" };
        }
        return { label: t("agent.mittel"), cls: "mid" };
      };
      // Als DOM (C-6d): Modellnamen kommen aus Angeboten im Netz – nur als Text und als Eigenschaft
      const karte = (wert: string, name: string, speed: { label: string; cls: string }, sub: (string | Node)[]): HTMLButtonElement => {
        const b = el("button", undefined, "model-card");
        b.type = "button";
        if (current === wert) b.classList.add("selected");
        b.dataset.model = wert;
        const kopf = el("div", undefined, "mc-head");
        const tempo = el("span", speed.label, "mc-speed");
        tempo.classList.add(speed.cls);
        kopf.append(el("b", name), tempo);
        const unter = el("div", undefined, "mc-sub");
        unter.append(...sub);
        b.append(kopf, unter);
        return b;
      };
      pop.replaceChildren(
        el("div", t("agent.gruppeNetz"), "mc-gruppe"),
        karte("", t("agent.auto"), { label: t("agent.schnellste"), cls: "fast" }, [t("agent.autoSub")]),
        ...entries.map(([m, info]) => {
          // Beide Einheiten aus dem Marktkurs (4.4b) – vorher fest 150.000 sats/SOL.
          const preis = ausMsat(info.priceMsat, aktuellerKurs());
          const sub: (string | Node)[] = [t("agent.mcSub", { preis, n: info.count }) + katalogHinweis(inKatalogen(m))];
          if (info.tools.size) sub.push(" · ", iconEl("wrench", 11));
          return karte(m, m.split(":")[0]!, speedOf(m), sub);
        }),
      );
    }
    // button-label aktualisieren
    updateModelBtnLabel();
  } catch { /* dropdown bleibt bei auto */ } finally {
    zeigeLokalBereich();
    void zeigeKnotenBereich();
  }
}

// ------------------------------------------------ Mein Knoten (B-9a)

/**
 * „Mein Knoten“ in der Modellwahl – nur, wenn dieses Gerät gekoppelt ist
 * (B-8c). Die Modelle kommen aus dem Angebot des Knotens; ohne Angebot bleibt
 * „Modell des Knotens“. Nur DOM mit textContent: Die Namen stehen im Angebot.
 */
async function zeigeKnotenBereich(): Promise<void> {
  const pop = $("#model-popover");
  if (!pop) return;
  const k = meineKopplung();
  const angebot = k ? await angebotVon(k.knoten).catch(() => undefined) : undefined;
  pop.querySelector(".knoten-bereich")?.remove();
  if (!k) return;
  const gewaehlt = ($("#ai-model") as HTMLInputElement | null)?.value ?? "";
  const bereich = document.createElement("div");
  bereich.className = "knoten-bereich";
  const kopf = document.createElement("div");
  kopf.className = "mc-gruppe";
  kopf.textContent = t("agent.gruppeKnoten");
  bereich.append(kopf);
  const modelle = angebot?.models?.length ? angebot.models : [""];
  for (const m of modelle) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "model-card";
    b.dataset.model = knotenWahlwert(m);
    if (gewaehlt === b.dataset.model) b.classList.add("selected");
    const head = document.createElement("div");
    head.className = "mc-head";
    const name = document.createElement("b");
    name.textContent = m ? m.split(":")[0]! : t("agent.knotenStandard");
    const marke = document.createElement("span");
    marke.className = "mc-speed lokal";
    marke.textContent = t("agent.knotenKurz");
    head.append(name, marke);
    const sub = document.createElement("div");
    sub.className = "mc-sub";
    sub.textContent = angebot ? t("agent.knotenModellSub", { knoten: pkShort(k.knoten) }) : t("agent.knotenOhneAngebot", { knoten: pkShort(k.knoten) });
    b.append(head, sub);
    bereich.append(b);
  }
  pop.insertBefore(bereich, pop.querySelector(".lokal-bereich"));
}

// ------------------------------------------------ KI auf diesem Gerät (B-1)

/** Stand der Suche nach einem Modell auf diesem Rechner – nur für diese Sitzung. */
export let lokal: { stand: "unbekannt" | "sucht" | "ok" | "fehlt"; modelle: LokalesModell[]; fehler?: string } = { stand: "unbekannt", modelle: [] };

/** „Dieses Gerät“ in der Modellwahl – nur DOM mit textContent: Die Namen kommen vom Modell-Dienst. */
function zeigeLokalBereich(): void {
  const pop = $("#model-popover");
  if (!pop) return;
  pop.querySelector(".lokal-bereich")?.remove();
  const bereich = document.createElement("div");
  bereich.className = "lokal-bereich";
  const kopf = document.createElement("div");
  kopf.className = "mc-gruppe";
  kopf.textContent = t("agent.gruppeGeraet");
  bereich.append(kopf);
  const gewaehlt = ($("#ai-model") as HTMLInputElement | null)?.value ?? "";
  const karte = (klasse: string, titel: string, text: string, wert?: string): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = klasse;
    const head = document.createElement("div");
    head.className = "mc-head";
    const name = document.createElement("b");
    name.textContent = titel;
    head.append(name);
    if (wert !== undefined) {
      b.dataset.model = wert;
      if (gewaehlt === wert) b.classList.add("selected");
      const marke = document.createElement("span");
      marke.className = "mc-speed lokal";
      marke.textContent = t("agent.lokalKurz");
      head.append(marke);
    }
    const sub = document.createElement("div");
    sub.className = "mc-sub";
    sub.textContent = text;
    b.append(head, sub);
    return b;
  };
  const adresse = lokaleAdresse(localStorage);
  if (lokal.stand === "ok" && lokal.modelle.length > 0) {
    for (const m of lokal.modelle) bereich.append(karte("model-card", m.name, t("agent.lokalModellSub"), lokalerWahlwert(m.name)));
  } else if (lokal.stand === "sucht") {
    bereich.append(karte("model-card lokal-suchen", t("agent.lokalSuchen"), t("agent.lokalSucht")));
  } else if (lokal.stand === "unbekannt") {
    bereich.append(karte("model-card lokal-suchen", t("agent.lokalSuchen"), t("agent.lokalSuchenSub")));
  } else {
    const grund = lokal.stand === "ok" ? t("agent.lokalKeine", { adresse }) : `${lokal.fehler ?? ""} ${t("agent.lokalOrigins", { herkunft: location.origin })}`;
    bereich.append(karte("model-card lokal-suchen", t("agent.lokalErneut"), grund));
  }
  const aendern = document.createElement("button");
  aendern.type = "button";
  aendern.className = "ghost mono-sm lokal-adresse";
  aendern.textContent = t("agent.lokalAdresse", { adresse });
  bereich.append(aendern);
  pop.append(bereich);
}

/** Modelle auf diesem Rechner suchen – nur auf Wunsch; danach auch beim Öffnen der Wahl. */
async function sucheLokal(): Promise<void> {
  if (lokal.stand === "sucht") return;
  lokal = { stand: "sucht", modelle: [] };
  zeigeLokalBereich();
  try {
    const modelle = await lokaleModelle(lokaleAdresse(localStorage));
    localStorage.setItem(LS_LOKAL_AKTIV, "1");
    lokal = { stand: "ok", modelle };
  } catch (e) {
    lokal = { stand: "fehlt", modelle: [], fehler: fehlerText(e) };
  }
  zeigeLokalBereich();
}

/** Adresse des Modells ändern – nur eine auf diesem Rechner. */
async function aendereLokaleAdresse(): Promise<void> {
  const w = await dialog({
    titel: t("agent.lokalAdresseTitel"),
    felder: [{ name: "adresse", label: t("agent.lokalAdresseLabel"), art: "text", wert: lokaleAdresse(localStorage), pflicht: true, mono: true }],
    pruefe: (w) => (lokaleKiAdresse(String(w.adresse ?? "")) ? null : t("agent.lokalAdresseFremd")),
  });
  if (!w || !setzeLokaleAdresse(String(w.adresse), localStorage)) return;
  lokal = { stand: "unbekannt", modelle: [] };
  await sucheLokal();
}

/** „ · in 2 Katalogen“ – leer, wenn kein abonnierter Katalog das Modell nennt. */
function katalogHinweis(n: number): string {
  return n > 0 ? ` · ${t(n === 1 ? "agent.inKatalog" : "agent.inKatalogen", { n })}` : "";
}

/** Button-Label aus aktueller Modell-Wahl. */
function updateModelBtnLabel(): void {
  const sel = $("#ai-model") as HTMLInputElement | null;
  const btn = $("#ai-model-btn") as HTMLButtonElement | null;
  if (!sel || !btn) return;
  const v = sel.value;
  const lokalModell = lokalesModellAus(v);
  const knotenModell = knotenModellAus(v);
  // Als DOM (C-6d): Symbol, dann der Name als Text
  const [symbol, text] = lokalModell
    ? ["monitor", `${lokalModell} · ${t("agent.lokalKurz")}`]
    : knotenModell !== null
    ? ["server", `${knotenModell.split(":")[0] || t("agent.knotenStandard")} · ${t("agent.knotenKurz")}`]
    : v
    ? ["bot", v.split(":")[0]!]
    : ["bot", t("agent.autoSchnellste")];
  btn.replaceChildren(iconEl(symbol, 14), ` ${text}`);
}

/** Modell-Popover öffnen/schliessen. */
export function setupModelPicker(): void {
  const btn = $("#ai-model-btn") as HTMLButtonElement | null;
  const pop = $("#model-popover");
  if (!btn || !pop) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    pop.classList.toggle("hidden");
    if (pop.classList.contains("hidden")) return;
    // Mein Knoten (B-9a): auch gleich nach dem Koppeln, ohne dass die Modelle des Netzes neu geladen werden
    void zeigeKnotenBereich();
    if (lokalAktiv(localStorage)) void sucheLokal();
  });
  // Karten-Klicks (delegiert, da Inhalt dynamisch)
  pop.addEventListener("click", async (e) => {
    const ziel = e.target as HTMLElement;
    if (ziel.closest(".lokal-suchen")) { e.stopPropagation(); void sucheLokal(); return; }
    if (ziel.closest(".lokal-adresse")) { e.stopPropagation(); void aendereLokaleAdresse(); return; }
    const card = ziel.closest(".model-card") as HTMLElement | null;
    if (!card) return;
    const sel = $("#ai-model") as HTMLInputElement;
    sel.value = card.dataset.model ?? "";
    updateModelBtnLabel();
    pop.classList.add("hidden");
    const knotenModell = knotenModellAus(sel.value);
    toast(knotenModell !== null ? t("agent.modellGewaehlt", { modell: knotenModell.split(":")[0] || t("agent.knotenKurz") })
      : sel.value ? t("agent.modellGewaehlt", { modell: lokalesModellAus(sel.value) ?? sel.value.split(":")[0] ?? "" }) : t("agent.modellAuto"));
    updateTokenEstimate();
  });
  // klick außerhalb schließt
  document.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest(".model-picker-wrap")) pop.classList.add("hidden");
  });
}
