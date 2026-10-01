/**
 * Tab Agent, Unter-Reiter Modelle und Repos: Modelle im Netz ankündigen und
 * vorhalten, Repositories über das Speichernetz.
 *
 * Aus app.ts verschoben (Schritt 1.0) – wörtlich, ohne Logikänderung. Die
 * Liste der Bundles steht seit C.3a auf der Seite „Repos“ (`repos.ts`,
 * „Bundle laden“ in `repo-seite.ts`).
 */
import { NostrEvent, type ModelEntry, type ModellKatalog } from "@freedomstack/protocol";
import { t } from "../../i18n.js";
import { fehlerText } from "../../protokoll-texte.js";
import { LS_KATALOGE, katalogKennung, katalogRang, leseAbos, leseKatalogEingabe, mitAbo, ohneAbo } from "../../modell-kataloge.js";
import { ausMsat } from "../../preis-anzeige.js";
import { pkShort } from "../../shell-logic.js";
import { aktualisiereKurs, aktuellerKurs } from "../marktkurs.js";
import { alleAngebote, alsGeraet, ensurePool, signiere, state } from "../state.js";
import { dialog } from "../dialog.js";
import { $, el, toast } from "../ui.js";

/**
 * Verfügbarkeit eines Modells in der Sprache der Oberfläche (8.16e) – aus den
 * Zahlen, wie `buildRegistry()` sie bewertet; dessen `note` ist Deutsch.
 */
export function modellNotiz(m: Pick<ModelEntry, "seeders" | "missingFiles">): string {
  if (m.missingFiles.length > 0) return m.seeders === 0 ? t("agent.notizWeg") : t("agent.notizFehlen", { n: m.missingFiles.length, seeder: m.seeders });
  if (m.seeders >= 5) return t("agent.notizGut", { n: m.seeders });
  return m.seeders >= 2 ? t("agent.notizKnapp", { n: m.seeders }) : t("agent.notizEiner");
}

/** Modelle im Netz anzeigen. */
export async function zeigeModelle(): Promise<void> {
  const box = $("#models-list");
  if (!box) return;
  try {
    const { buildRegistry, KIND_MODEL_MANIFEST, KIND_MODEL_SEED, modelsAtRisk } = await import("@freedomstack/protocol");
    const pool = await ensurePool();
    const evs = await pool.query({ kinds: [KIND_MODEL_MANIFEST, KIND_MODEL_SEED], limit: 1000 });
    const r = buildRegistry(evs);
    // Namen und Quantisierung kommen aus fremden Manifesten – nur als Text (C-6)
    box.replaceChildren(...(r.models.length === 0
      ? [el("span", t("agent.keineModelle"), "muted")]
      : r.models.slice(0, 20).map((m) => {
          const zeile = el("div", undefined, "usage-row");
          zeile.append(
            el("span", m.manifest.quant ? `${m.manifest.name} · ${m.manifest.quant}` : m.manifest.name),
            el("span", modellNotiz(m), m.availability === "gut" ? "ok" : m.availability === "knapp" ? "warn" : "err"),
          );
          return zeile;
        })));
    // Gefaehrdete zuerst nennen (8.8) – die Liste oben ist nach Seedern sortiert und schneidet sie sonst ab.
    const gefaehrdet = modelsAtRisk(r.models);
    if (gefaehrdet.length > 0) {
      const z = document.createElement("div");
      z.className = "warn";
      z.textContent = t("agent.gefaehrdet", {
        namen: gefaehrdet.slice(0, 5).map((m) => m.manifest.name).join(", "),
        mehr: gefaehrdet.length > 5 ? t("agent.undWeitere", { n: gefaehrdet.length - 5 }) : "",
      });
      box.prepend(z);
    }
  } catch (e) {
    box.textContent = t("agent.nichtAbrufbar", { fehler: fehlerText(e) });
  }
}

/**
 * Ein Modell ankuendigen.
 *
 * Ohne diesen Weg bleibt der Katalog fuer immer leer — das Protokoll konnte
 * Manifeste lesen, aber niemand konnte eines erzeugen.
 */
export async function kuendigeModellAn(): Promise<void> {
  if (!state.keypair) return;
  const dateiZeilen = (text: string) => text.split("\n").map((z) => {
    const [name, sha256, size] = z.trim().split(/\s+/);
    return { name, sha256: (sha256 ?? "").toLowerCase(), sizeBytes: Number(size) };
  }).filter((f) => f.name && /^[0-9a-f]{64}$/.test(f.sha256) && f.sizeBytes > 0);
  // Dialog statt prompt() (C-1b): eine Zeile ohne Prüfsumme meldet sich im Dialog, die Eingabe bleibt
  const w = await dialog({
    titel: t("agent.modellAnkuendigen"),
    text: t("agent.dateienHinweis"),
    felder: [
      { art: "text", name: "id", label: t("agent.modellKennungFrage"), pflicht: true, mono: true },
      { art: "textarea", name: "dateien", label: t("agent.dateienFrage"), pflicht: true, mono: true },
    ],
    pruefe: (w) => (dateiZeilen(String(w.dateien)).length ? null : t("agent.keineZeileBrauchbar")),
    ok: t("agent.ankuendigen"),
  });
  if (!w) return;
  const id = String(w.id);
  const files = dateiZeilen(String(w.dateien));
  if (!id.trim() || files.length === 0) return;

  try {
    const { buildModelManifest } = await import("@freedomstack/protocol");
    await (await ensurePool()).publish(await signiere(buildModelManifest({
      modelId: id.trim(), name: id.trim(), files, publisherPubkey: state.keypair.pk,
    } as never)));
    toast(t("agent.dateienAngekuendigt", { n: files.length }));
    void zeigeModelle();
  } catch (e) {
    toast(fehlerText(e), true);
  }
}

/** Melden, dass man ein Modell vorhaelt. */
export async function haltevorModell(): Promise<void> {
  if (!state.keypair) return;
  const w = await dialog({
    titel: t("agent.modellVorhalten"),
    felder: [
      { art: "text", name: "id", label: t("agent.welchesModell"), pflicht: true, mono: true },
      { art: "text", name: "dateien", label: t("agent.welcheDateien"), mono: true },
    ],
    ok: t("agent.vorhaltenMelden"),
  });
  const id = String(w?.id ?? "");
  if (!id.trim()) return;
  const dateien = String(w?.dateien ?? "");

  try {
    const { buildModelSeed, buildRegistry, KIND_MODEL_MANIFEST } =
      await import("@freedomstack/protocol");
    const pool = await ensurePool();

    // Teilbestaende sind ausdruecklich erlaubt: Wer nur die Haelfte hat,
    // traegt trotzdem bei.
    let liste = dateien.split(",").map((x) => x.trim()).filter(Boolean);
    if (liste.length === 0) {
      const evs = await pool.query({ kinds: [KIND_MODEL_MANIFEST], limit: 500 });
      const m = buildRegistry(evs).models.find((x) => x.manifest.modelId === id.trim());
      if (!m) {
        toast(t("agent.keinManifest"), true);
        return;
      }
      liste = m.manifest.files.map((f) => f.name);
    }

    await pool.publish(await signiere(buildModelSeed(
      id.trim(), state.keypair.pk, liste,
      localStorage.getItem("freedom.region") ?? undefined)));
    toast(t("agent.dateienGemeldet", { n: liste.length }));
    void zeigeModelle();
  } catch (e) {
    toast(fehlerText(e), true);
  }
}

// ------------------------------------------------- Modellkataloge (5.7 mit 8.8)

/** Die zuletzt geladenen abonnierten Kataloge – fuer die Reihenfolge im Modell-Dropdown. */
let abonnierteKataloge: ModellKatalog[] = [];

/** In wie vielen abonnierten Katalogen steht ein Modell? Leer, solange keine geladen sind. */
export function katalogRangJetzt(): Map<string, number> {
  return katalogRang(abonnierteKataloge);
}

function neu<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function knopf(text: string, aktion: () => void): HTMLButtonElement {
  const b = neu("button", text, "ghost");
  b.style.cssText = "width:auto;padding:2px 8px;margin-left:6px";
  b.addEventListener("click", aktion);
  return b;
}

function speichereAbos(abos: string[]): void {
  localStorage.setItem(LS_KATALOGE, JSON.stringify(abos));
}

/**
 * Kataloge anzeigen: abonnierte, ihr Vergleich mit den Angeboten der Provider
 * (Anzahl, guenstigster Preis in sats und SOL) und gefundene zum Abonnieren.
 * Alle Texte ueber `textContent` – Kataloge sind Fremddaten.
 */
export async function zeigeKataloge(): Promise<void> {
  const aboBox = $("#kataloge-abos");
  const vergleichBox = $("#kataloge-vergleich");
  const gefundenBox = $("#kataloge-gefunden");
  if (!aboBox || !vergleichBox || !gefundenBox) return;
  try {
    const { KIND_MODELL_KATALOG, modellAngebote, neuesteKataloge, vergleicheKataloge } = await import("@freedomstack/protocol");
    const pool = await ensurePool();
    // Alle holen und selbst auswaehlen: Ein Filter nach Kurator verriete den Relays die Abos.
    const [evs, angebote] = await Promise.all([
      pool.query({ kinds: [KIND_MODELL_KATALOG], limit: 500 }),
      alleAngebote().catch(() => []),
      aktualisiereKurs().catch(() => undefined),
    ]);
    const alle = neuesteKataloge(evs);
    const abos = leseAbos(localStorage.getItem(LS_KATALOGE));
    abonnierteKataloge = abos.map((a) => alle.get(a)).filter((k): k is ModellKatalog => k !== undefined);

    aboBox.replaceChildren();
    if (abos.length === 0) aboBox.append(neu("div", t("agent.keinAbo"), "muted"));
    for (const a of abos) {
      const k = alle.get(a);
      const zeile = neu("div", k ? t("agent.katalogZeile", { titel: k.titel, kurator: pkShort(k.kurator), n: k.modelle.length }) : t("agent.katalogFehlt", { kennung: a.slice(6, 18) }), "usage-row");
      zeile.append(knopf(t("agent.abbestellen"), () => {
        speichereAbos(ohneAbo(leseAbos(localStorage.getItem(LS_KATALOGE)), a));
        void zeigeKataloge();
      }));
      aboBox.append(zeile);
    }

    vergleichBox.replaceChildren();
    if (abonnierteKataloge.length > 0) {
      const v = vergleicheKataloge(abonnierteKataloge, modellAngebote(angebote));
      const kurz = abonnierteKataloge.map((k) => k.titel);
      if (abonnierteKataloge.length >= 2) {
        vergleichBox.append(neu("div", [t("agent.gemeinsam", { n: v.gemeinsam.length }), ...kurz.map((titel, i) => t("agent.nurIn", { titel, n: v.nurIn[i]!.length }))].join(" · ")));
      }
      const tabelle = neu("table");
      tabelle.style.cssText = "width:100%;border-collapse:collapse;margin:6px 0";
      const kopf = neu("tr");
      for (const s of [t("agent.modell"), ...kurz, t("agent.provider"), t("agent.abTausend")]) kopf.append(neu("th", s));
      tabelle.append(kopf);
      const kurs = aktuellerKurs();
      for (const z of v.zeilen.slice(0, 100)) {
        const tr = neu("tr");
        tr.append(neu("td", z.modell));
        z.in.forEach((drin, i) => {
          const td = neu("td", drin ? "✓" : "–", drin ? "ok" : "muted");
          if (z.notizen[i]) td.title = z.notizen[i]!;
          tr.append(td);
        });
        tr.append(neu("td", String(z.provider), z.provider > 0 ? "" : "err"));
        tr.append(neu("td", z.preisMsat !== undefined ? ausMsat(z.preisMsat, kurs) : t("agent.keinAngebot")));
        tabelle.append(tr);
      }
      vergleichBox.append(tabelle);
    }

    gefundenBox.replaceChildren();
    const andere = [...alle.values()].filter((k) => !abos.includes(k.adresse)).sort((x, y) => y.createdAt - x.createdAt).slice(0, 20);
    gefundenBox.append(neu("div", andere.length === 0 ? t("agent.keineKataloge") : t("agent.gefundeneKataloge"), "muted"));
    for (const k of andere) {
      const beispiele = k.modelle.slice(0, 3).map((m) => m.modell).join(", ");
      const zeile = neu("div", t("agent.katalogZeile", { titel: k.titel, kurator: pkShort(k.kurator), n: k.modelle.length }) + (beispiele ? ` (${beispiele}${k.modelle.length > 3 ? ", …" : ""})` : ""), "usage-row");
      if (k.beschreibung) zeile.title = k.beschreibung;
      zeile.append(knopf(t("agent.abonnieren"), () => {
        try {
          speichereAbos(mitAbo(leseAbos(localStorage.getItem(LS_KATALOGE)), k.adresse));
          void zeigeKataloge();
        } catch (e) {
          toast(fehlerText(e), true);
        }
      }));
      gefundenBox.append(zeile);
    }
  } catch (e) {
    gefundenBox.textContent = t("agent.nichtAbrufbar", { fehler: fehlerText(e) });
  }
}

/** Einen eigenen Katalog veroeffentlichen – gleicher Titel ersetzt den alten. */
export async function veroeffentlicheKatalog(): Promise<void> {
  if (!state.keypair) return;
  if (alsGeraet()) {
    toast(t("agent.nurHauptKatalog"), true);
    return;
  }
  const w = await dialog({
    titel: t("agent.katalogVeroeffentlichenTitel"),
    text: t("agent.katalogBeispiel"),
    felder: [
      { art: "text", name: "titel", label: t("agent.katalogTitelFrage"), pflicht: true },
      { art: "textarea", name: "modelle", label: t("agent.katalogModelleFrage"), pflicht: true, mono: true },
    ],
    pruefe: (w) => (leseKatalogEingabe(String(w.modelle)).length ? null : t("dlg.pflicht")),
    ok: t("agent.veroeffentlichen"),
  });
  const titel = String(w?.titel ?? "");
  const eingabe = String(w?.modelle ?? "");
  if (!titel.trim() || !eingabe.trim()) return;
  try {
    const { baueModellKatalog } = await import("@freedomstack/protocol");
    const modelle = leseKatalogEingabe(eingabe);
    const ev = await signiere(baueModellKatalog({ kurator: state.keypair.pk, d: katalogKennung(titel), titel, modelle }));
    await (await ensurePool()).publish(ev);
    toast(t("agent.katalogVeroeffentlicht", { titel: titel.trim(), n: modelle.length }));
    void zeigeKataloge();
  } catch (e) {
    toast(fehlerText(e), true);
  }
}

